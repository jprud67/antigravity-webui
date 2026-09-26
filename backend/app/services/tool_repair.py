"""
tool_repair.py — Moteur de normalisation et réparation d'appels d'outils pour modèles locaux & compacts.
Inspiré directement de Antigravity Core (stream-normalizer & grammar-repair).

Fonctionnalités :
  1. Détection des tool calls fuyant dans le texte markdown brut :
     - Blocs code ```json ... ``` avec action/tool/function
     - Balises XML-like (<tool_call>...</tool_call>, <function=...>, [TOOL_CALL: ...])
     - Blocs shell implicites (```bash ... ```, ```sh ... ```)
  2. Réparation grammaticale du JSON tronqué ou mal formé :
     - Équilibrage des accolades/crochets manquants
     - Suppression des virgules traînantes (trailing commas)
     - Normalisation des booléens/None Python vers JSON (True/False/None -> true/false/null)
     - Remplacement des apostrophes simples en guillemets JSON valides
  3. Promotion transparente en événements de function calling natifs.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

logger = logging.getLogger("antigravity.tool_repair")

# Regex pour détecter les balises XMLish et JSON encapsulés
_XML_TOOL_CALL_RE = re.compile(
    r"<tool_call>\s*(.*?)\s*</tool_call>",
    re.DOTALL | re.IGNORECASE
)
_FUNCTION_TAG_RE = re.compile(
    r"<function=([a-zA-Z0-9_\-]+)>\s*(.*?)\s*</function>",
    re.DOTALL | re.IGNORECASE
)
_BRACKET_CALL_RE = re.compile(
    r"\[(?:TOOL_CALL|FUNCTION_CALL):\s*([a-zA-Z0-9_\-]+)\s*\((.*?)\)\]",
    re.DOTALL | re.IGNORECASE
)
_CODE_BLOCK_JSON_RE = re.compile(
    r"```(?:json|tool_call|function)?\s*\n\s*(\{[\s\S]*?\})\s*\n```",
    re.IGNORECASE
)
_CODE_BLOCK_SHELL_RE = re.compile(
    r"```(?:bash|sh|shell|powershell|cmd)\s*\n([\s\S]*?)\n```",
    re.IGNORECASE
)


def repair_malformed_json(raw_json: str) -> dict | None:
    """
    Tente de réparer et parser un flux JSON tronqué ou corrompu par un petit modèle.
    """
    text = raw_json.strip()
    if not text:
        return None

    # 1. Tentative directe
    try:
        val = json.loads(text)
        if isinstance(val, dict):
            return val
    except json.JSONDecodeError:
        pass

    # 2. Nettoyage des marqueurs Python et virgules traînantes
    cleaned = text
    cleaned = re.sub(r"\bTrue\b", "true", cleaned)
    cleaned = re.sub(r"\bFalse\b", "false", cleaned)
    cleaned = re.sub(r"\bNone\b", "null", cleaned)
    cleaned = re.sub(r",\s*([\]}])", r"\1", cleaned)

    try:
        val = json.loads(cleaned)
        if isinstance(val, dict):
            return val
    except json.JSONDecodeError:
        pass

    # 3. Remplacement des guillemets simples s'il s'agit de clés/valeurs façon dictionnaire Python
    if "'" in cleaned and '"' not in cleaned:
        single_quoted = re.sub(r"'\s*:\s*", '": ', cleaned)
        single_quoted = re.sub(r"{\s*'", '{"', single_quoted)
        single_quoted = re.sub(r",\s*'", ', "', single_quoted)
        single_quoted = re.sub(r":\s*'([^']*)'", r': "\1"', single_quoted)
        try:
            val = json.loads(single_quoted)
            if isinstance(val, dict):
                return val
        except json.JSONDecodeError:
            pass

    # 4. Équilibrage des accolades et crochets tronqués (fermeture automatique)
    open_braces = cleaned.count("{") - cleaned.count("}")
    open_brackets = cleaned.count("[") - cleaned.count("]")

    if open_braces > 0 or open_brackets > 0:
        balanced = cleaned.rstrip()
        # Supprime une éventuelle virgule finale
        if balanced.endswith(","):
            balanced = balanced[:-1].rstrip()
        # Ferme d'abord les guillemets non terminés si nombre impair
        if balanced.count('"') % 2 != 0:
            balanced += '"'
        for _ in range(open_brackets):
            balanced += "]"
        for _ in range(open_braces):
            balanced += "}"
        try:
            val = json.loads(balanced)
            if isinstance(val, dict):
                return val
        except json.JSONDecodeError:
            pass

    return None


def _extract_name_and_args(obj: dict) -> tuple[str | None, dict]:
    """Extrait le nom de l'outil et ses arguments depuis un objet standardisé ou arbitraire."""
    name = None
    args = {}

    for k in ("name", "tool", "function", "action", "tool_name", "type"):
        if isinstance(obj.get(k), str) and obj[k].strip():
            name = obj[k].strip()
            break
        elif isinstance(obj.get(k), dict) and isinstance(obj[k].get("name"), str):
            name = obj[k]["name"].strip()
            break

    # Arguments
    for arg_key in ("arguments", "parameters", "args", "params", "input", "inputs"):
        if arg_key in obj:
            candidate = obj[arg_key]
            if isinstance(candidate, dict):
                args = candidate
                break
            elif isinstance(candidate, str):
                parsed = repair_malformed_json(candidate)
                if parsed:
                    args = parsed
                    break

    # Si arguments est resté vide, les autres clés de l'objet (hors nom/action) sont considérées comme arguments
    if not args:
        reserved = {"name", "tool", "function", "action", "tool_name", "type", "call_id", "id"}
        args = {k: v for k, v in obj.items() if k not in reserved}

    return name, args


class ToolRepairEngine:
    """Moteur de surveillance et réparation automatique d'appels d'outils."""

    def __init__(self):
        self.total_scanned = 0
        self.total_repaired = 0

    def repair_and_extract(
        self,
        raw_text: str,
        allowed_tools: list[str] | None = None,
        promote_shell: bool = True,
    ) -> tuple[str, list[dict[str, Any]], bool]:
        """
        Analyse raw_text. Si des tool calls non natifs sont détectés, les répare,
        les extrait sous format standardisé et nettoie le texte visible.
        
        Renvoie : (cleaned_text, tool_calls, was_repaired)
        """
        self.total_scanned += 1
        allowed_lower = {t.lower(): t for t in allowed_tools} if allowed_tools else {}
        extracted_calls: list[dict[str, Any]] = []
        cleaned_text = raw_text

        # 1. Détection des balises <tool_call> ... </tool_call>
        for match in _XML_TOOL_CALL_RE.finditer(raw_text):
            inner = match.group(1).strip()
            parsed = repair_malformed_json(inner)
            if parsed:
                name, args = _extract_name_and_args(parsed)
                if name:
                    real_name = allowed_lower.get(name.lower(), name)
                    extracted_calls.append({
                        "id": f"call_{uuid.uuid4().hex[:24]}",
                        "name": real_name,
                        "arguments": args,
                    })
                    cleaned_text = cleaned_text.replace(match.group(0), "")

        # 2. Détection des balises <function=name> ... </function>
        for match in _FUNCTION_TAG_RE.finditer(cleaned_text):
            fname = match.group(1).strip()
            inner = match.group(2).strip()
            args = repair_malformed_json(inner) or {}
            real_name = allowed_lower.get(fname.lower(), fname)
            extracted_calls.append({
                "id": f"call_{uuid.uuid4().hex[:24]}",
                "name": real_name,
                "arguments": args,
            })
            cleaned_text = cleaned_text.replace(match.group(0), "")

        # 3. Détection des blocs code JSON : ```json { ... } ```
        for match in _CODE_BLOCK_JSON_RE.finditer(cleaned_text):
            inner = match.group(1).strip()
            parsed = repair_malformed_json(inner)
            if parsed:
                name, args = _extract_name_and_args(parsed)
                # On valide qu'il ressemble réellement à un appel d'outil
                is_tool = False
                if name and allowed_lower:
                    if name.lower() in allowed_lower:
                        is_tool = True
                elif name and any(k in parsed for k in ("action", "tool", "function", "arguments", "parameters")):
                    is_tool = True

                if is_tool and name:
                    real_name = allowed_lower.get(name.lower(), name)
                    extracted_calls.append({
                        "id": f"call_{uuid.uuid4().hex[:24]}",
                        "name": real_name,
                        "arguments": args,
                    })
                    cleaned_text = cleaned_text.replace(match.group(0), "")

        # 4. Détection des blocs code shell isolés si run_command est dans les outils autorisés
        if promote_shell and (not allowed_tools or "run_command" in allowed_lower):
            # Ne promeut que si aucun autre tool_call n'a déjà été trouvé et que le texte est court ou dominé par le bloc
            if not extracted_calls:
                for match in _CODE_BLOCK_SHELL_RE.finditer(cleaned_text):
                    cmd = match.group(1).strip()
                    # On ignore les scripts très longs ou explicatifs
                    if cmd and "\n" not in cmd and len(cmd) < 300:
                        cmd_name = allowed_lower.get("run_command", "run_command")
                        extracted_calls.append({
                            "id": f"call_{uuid.uuid4().hex[:24]}",
                            "name": cmd_name,
                            "arguments": {
                                "CommandLine": cmd,
                                "Cwd": ".",
                                "WaitMsBeforeAsync": 5000,
                                "toolSummary": f"Exécution commande `{cmd[:30]}`",
                                "toolAction": "Running command"
                            },
                        })
                        cleaned_text = cleaned_text.replace(match.group(0), "").strip()
                        break

        cleaned_text = re.sub(r"\n{3,}", "\n\n", cleaned_text).strip()
        was_repaired = len(extracted_calls) > 0
        if was_repaired:
            self.total_repaired += 1

        return cleaned_text, extracted_calls, was_repaired

    def get_stats(self) -> dict[str, Any]:
        return {
            "total_scanned": self.total_scanned,
            "total_repaired": self.total_repaired,
            "repair_rate": round((self.total_repaired / self.total_scanned * 100), 2) if self.total_scanned > 0 else 0.0,
        }


tool_repair_engine = ToolRepairEngine()
