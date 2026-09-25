"""
memory_store.py — Architecture de mémoire continue et profil utilisateur (USER.md + MEMORY.md).
Inspiré directement de l'architecture MemoryStore de Hermes Agent.

Caractéristiques :
  1. Deux cibles isolées :
     - `user` : profil utilisateur (`USER.md`), qui est l'utilisateur, préférences de dev.
     - `memory` : connaissances et spécificités apprises par l'agent sur le projet (`MEMORY.md`).
  2. Budgets stricts en caractères (indépendants du tokenizer) :
     - Défaut : 2500 caractères pour `memory`, 1500 caractères pour `user`.
  3. Snapshot immuable (*frozen snapshot*) au chargement :
     - Préserve le prompt cache Gemini/Anthropic sans rupture en cours de session.
  4. Actions atomiques avec verrouillage multi-processus :
     - `view`, `add`, `replace`, `remove`, `list`, `save_raw`.
  5. Détection de dérive et protection anti-injection / threat patterns.
"""

from __future__ import annotations

import logging
import os
import re
import threading
from contextlib import contextmanager, suppress
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("antigravity.memory")

# Verrouillage cross-processus : fcntl sur Unix, msvcrt sur Windows
fcntl = None
msvcrt = None
try:
    import fcntl
except ImportError:
    with suppress(ImportError):
        import msvcrt

ENTRY_DELIMITER = "\n§\n"

MEMORY_BLOCK_HEADERS = {
    "memory": "WORKSPACE MEMORY (Project Context & Technical Decisions)",
    "user": "USER PROFILE (Preferences, Style & Identity)",
}

DEFAULT_CHAR_LIMITS = {
    "memory": 2500,
    "user": 1500,
}

# Modèles d'injection et de menaces connus
THREAT_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior)\s+instructions", re.IGNORECASE),
    re.compile(r"system\s*prompt\s*override", re.IGNORECASE),
    re.compile(r"<\s*script\b", re.IGNORECASE),
    re.compile(r"javascript\s*:", re.IGNORECASE),
    re.compile(r"\b(eval|exec)\s*\(", re.IGNORECASE),
    re.compile(r"curl\s+-[Xskfd]\s+http", re.IGNORECASE),
]


def _scan_threats(content: str) -> Optional[str]:
    """Détecte les tentatives d'injection de prompt ou d'exfiltration persistantes."""
    for pattern in THREAT_PATTERNS:
        if pattern.search(content):
            return f"Security rejection: memory entry matches forbidden pattern '{pattern.pattern}'"
    return None


def _find_unique_match(entries: List[str], old_text: str) -> Tuple[Optional[int], bool]:
    """Trouve l'entrée correspondant à old_text (priorité absolue à l'égalité exacte)."""
    exact = [i for i, e in enumerate(entries) if e.strip() == old_text.strip()]
    if exact:
        return exact[0], False
    matches = [i for i, e in enumerate(entries) if old_text.strip().lower() in e.lower()]
    if len(matches) > 1:
        # Vérifie si toutes les correspondances sont identiques
        first_content = entries[matches[0]]
        if all(entries[idx] == first_content for idx in matches):
            return matches[0], False
        return None, True  # Ambigu
    if len(matches) == 1:
        return matches[0], False
    return None, False


class MemoryStore:
    """Store de mémoire curatée borné en caractères, persisté sur disque."""

    def __init__(
        self,
        memory_char_limit: int = 2500,
        user_char_limit: int = 1500,
        workspace_dir: Path | str | None = None,
        config_dir: Path | str | None = None,
    ):
        self.memory_char_limit = memory_char_limit
        self.user_char_limit = user_char_limit
        self.workspace_dir = Path(workspace_dir) if workspace_dir else Path.cwd()
        
        if config_dir:
            self.config_dir = Path(config_dir)
        else:
            self.config_dir = Path.home() / ".gemini" / "config"
            if not self.config_dir.exists():
                alt = Path.home() / ".antigravity"
                alt.mkdir(parents=True, exist_ok=True)
                self.config_dir = alt

        self.memory_entries: List[str] = []
        self.user_entries: List[str] = []
        self._system_prompt_snapshot: Dict[str, str] = {"memory": "", "user": ""}
        self._lock = threading.RLock()
        
        # Charge l'état initial
        self.load_from_disk()

    def set_workspace(self, workspace_dir: Path | str) -> None:
        """Met à jour le workspace actif et recharge MEMORY.md."""
        with self._lock:
            self.workspace_dir = Path(workspace_dir)
            self._load_target("memory")
            self._update_snapshot_target("memory")

    def _path_for(self, target: str) -> Path:
        """Détermine le chemin physique selon la cible."""
        if target == "user":
            self.config_dir.mkdir(parents=True, exist_ok=True)
            return self.config_dir / "USER.md"
        else:
            # Pour la mémoire workspace
            ws = self.workspace_dir.resolve()
            if ws.is_dir():
                return ws / "MEMORY.md"
            fallback = self.config_dir / "memory"
            fallback.mkdir(parents=True, exist_ok=True)
            return fallback / "MEMORY.md"

    @contextmanager
    def _file_lock(self, path: Path):
        """Verrouille le fichier pour les écritures concurrentes."""
        lock_path = path.with_suffix(path.suffix + ".lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        if fcntl is None and msvcrt is None:
            yield
            return
        
        if msvcrt and (not lock_path.exists() or lock_path.stat().st_size == 0):
            with suppress(Exception):
                lock_path.write_text(" ", encoding="utf-8")

        with open(lock_path, "r+" if msvcrt else "a+", encoding="utf-8") as fd:
            try:
                if fcntl:
                    fcntl.flock(fd, fcntl.LOCK_EX)
                elif msvcrt:
                    fd.seek(0)
                    msvcrt.locking(fd.fileno(), msvcrt.LK_LOCK, 1)
                yield
            finally:
                with suppress(Exception):
                    if fcntl:
                        fcntl.flock(fd, fcntl.LOCK_UN)
                    elif msvcrt:
                        fd.seek(0)
                        msvcrt.locking(fd.fileno(), msvcrt.LK_UNLCK, 1)

    def _parse_entries(self, text: str) -> List[str]:
        """Découpe le texte markdown en entrées distinctes."""
        if not text or not text.strip():
            return []
        if ENTRY_DELIMITER in text:
            raw_parts = text.split(ENTRY_DELIMITER)
        elif "\n---\n" in text:
            raw_parts = text.split("\n---\n")
        else:
            # Traite comme paragraphes ou puces
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            if all(l.startswith(("- ", "* ", "• ")) for l in lines):
                return [re.sub(r"^[-*•]\s*", "", l) for l in lines]
            return [text.strip()]
            
        entries = []
        for part in raw_parts:
            cleaned = part.strip()
            # Nettoie les en-têtes markdown éventuels résiduels
            if cleaned.startswith("#"):
                cleaned = re.sub(r"^#+\s+[^\n]+\n*", "", cleaned).strip()
            if cleaned:
                entries.append(cleaned)
        return entries

    def _render_entries(self, entries: List[str]) -> str:
        """Formate les entrées pour l'écriture fichier."""
        if not entries:
            return ""
        return ENTRY_DELIMITER.join(entries) + "\n"

    def _render_block(self, target: str, entries: List[str]) -> str:
        """Rend le bloc structuré pour injection dans le system prompt."""
        if not entries:
            return ""
        header = MEMORY_BLOCK_HEADERS.get(target, f"{target.upper()} MEMORY")
        items = "\n".join(f"- {e}" for e in entries)
        return f"### {header}\n{items}\n"

    def _load_target(self, target: str) -> None:
        path = self._path_for(target)
        if not path.is_file():
            if target == "user":
                self.user_entries = []
            else:
                self.memory_entries = []
            return
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
            entries = self._parse_entries(content)
            # Dédoublonnage en conservant l'ordre
            entries = list(dict.fromkeys(entries))
            if target == "user":
                self.user_entries = entries
            else:
                self.memory_entries = entries
        except Exception as e:
            logger.warning(f"Impossible de lire le fichier mémoire {path}: {e}")

    def _update_snapshot_target(self, target: str) -> None:
        entries = self.user_entries if target == "user" else self.memory_entries
        # Sanitize pour le snapshot
        sanitized = []
        for e in entries:
            threat = _scan_threats(e)
            if threat:
                sanitized.append(f"[BLOCKED: Contenu bloqué par sécurité : {threat}]")
            else:
                sanitized.append(e)
        self._system_prompt_snapshot[target] = self._render_block(target, sanitized)

    def load_from_disk(self) -> None:
        """Charge l'état depuis le disque et fige le snapshot du prompt système."""
        with self._lock:
            for t in ("user", "memory"):
                self._load_target(t)
                self._update_snapshot_target(t)

    def get_system_prompt_snapshot(self) -> str:
        """Renvoie le snapshot gelé pour injection dans le prompt de session."""
        parts = []
        if self._system_prompt_snapshot.get("user"):
            parts.append(self._system_prompt_snapshot["user"])
        if self._system_prompt_snapshot.get("memory"):
            parts.append(self._system_prompt_snapshot["memory"])
        if not parts:
            return ""
        return "\n## CONTINUOUS AGENT MEMORY\n" + "\n".join(parts)

    def refresh_snapshot(self) -> str:
        """Rafraîchit explicitement le snapshot (ex: action manuelle utilisateur)."""
        with self._lock:
            for t in ("user", "memory"):
                self._update_snapshot_target(t)
            return self.get_system_prompt_snapshot()

    def get_entries(self, target: str) -> List[str]:
        return list(self.user_entries if target == "user" else self.memory_entries)

    def get_char_limit(self, target: str) -> int:
        return self.user_char_limit if target == "user" else self.memory_char_limit

    def get_char_count(self, target: str) -> int:
        entries = self.get_entries(target)
        return len(ENTRY_DELIMITER.join(entries))

    def get_status(self) -> Dict[str, Any]:
        """Fournit la télémétrie complète pour l'API et l'UI."""
        with self._lock:
            user_count = self.get_char_count("user")
            user_limit = self.get_char_limit("user")
            mem_count = self.get_char_count("memory")
            mem_limit = self.get_char_limit("memory")
            
            user_path = self._path_for("user")
            mem_path = self._path_for("memory")

            user_raw = user_path.read_text(encoding="utf-8", errors="replace") if user_path.is_file() else ""
            mem_raw = mem_path.read_text(encoding="utf-8", errors="replace") if mem_path.is_file() else ""

            return {
                "user": {
                    "path": str(user_path),
                    "exists": user_path.is_file(),
                    "entries": self.user_entries,
                    "entry_count": len(self.user_entries),
                    "char_count": user_count,
                    "char_limit": user_limit,
                    "percentage": min(100, round((user_count / user_limit) * 100, 1)) if user_limit > 0 else 0,
                    "raw": user_raw,
                },
                "memory": {
                    "path": str(mem_path),
                    "exists": mem_path.is_file(),
                    "workspace": str(self.workspace_dir),
                    "entries": self.memory_entries,
                    "entry_count": len(self.memory_entries),
                    "char_count": mem_count,
                    "char_limit": mem_limit,
                    "percentage": min(100, round((mem_count / mem_limit) * 100, 1)) if mem_limit > 0 else 0,
                    "raw": mem_raw,
                },
                "snapshot_available": bool(self.get_system_prompt_snapshot()),
            }

    def _persist(self, target: str, entries: List[str]) -> None:
        path = self._path_for(target)
        rendered = self._render_entries(entries)
        # Écriture atomique avec remplacement de fichier temporaire
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(rendered, encoding="utf-8")
        os.replace(tmp_path, path)
        if target == "user":
            self.user_entries = entries
        else:
            self.memory_entries = entries

    def add(self, target: str, content: str) -> Dict[str, Any]:
        """Ajoute une nouvelle entrée en respectant les quotas."""
        content = content.strip()
        if not content:
            return {"success": False, "error": "Le contenu ne peut pas être vide."}
        threat = _scan_threats(content)
        if threat:
            return {"success": False, "error": threat}

        target = "user" if target.lower() in ("user", "user.md", "profile") else "memory"
        path = self._path_for(target)

        with self._lock, self._file_lock(path):
            self._load_target(target)
            entries = self.get_entries(target)
            if content in entries:
                return {
                    "success": True,
                    "message": "Entrée déjà existante (aucun doublon créé).",
                    "status": self.get_status()[target]
                }
            new_entries = entries + [content]
            total_chars = len(ENTRY_DELIMITER.join(new_entries))
            limit = self.get_char_limit(target)
            if total_chars > limit:
                return {
                    "success": False,
                    "error": (
                        f"Limite de mémoire dépassée ({total_chars}/{limit} caractères). "
                        "Veuillez consolider ou supprimer d'anciennes entrées avant d'en ajouter."
                    ),
                    "current_entries": entries,
                    "char_count": len(ENTRY_DELIMITER.join(entries)),
                    "char_limit": limit,
                }
            self._persist(target, new_entries)
            return {
                "success": True,
                "message": f"Entrée ajoutée à {target}.",
                "status": self.get_status()[target]
            }

    def replace(self, target: str, old_text: str, new_content: str) -> Dict[str, Any]:
        """Remplace une entrée existante par un nouveau contenu consolidé."""
        old_text = old_text.strip()
        new_content = new_content.strip()
        if not old_text or not new_content:
            return {"success": False, "error": "old_text et new_content sont requis."}
        threat = _scan_threats(new_content)
        if threat:
            return {"success": False, "error": threat}

        target = "user" if target.lower() in ("user", "user.md", "profile") else "memory"
        path = self._path_for(target)

        with self._lock, self._file_lock(path):
            self._load_target(target)
            entries = self.get_entries(target)
            idx, is_ambiguous = _find_unique_match(entries, old_text)
            if is_ambiguous:
                return {
                    "success": False,
                    "error": f"Plusieurs entrées correspondent à '{old_text}'. Précisez le texte exact.",
                    "current_entries": entries
                }
            if idx is None:
                return {
                    "success": False,
                    "error": f"Aucune entrée ne correspond à '{old_text}'.",
                    "current_entries": entries
                }
            
            new_entries = list(entries)
            new_entries[idx] = new_content
            total_chars = len(ENTRY_DELIMITER.join(new_entries))
            limit = self.get_char_limit(target)
            if total_chars > limit:
                return {
                    "success": False,
                    "error": f"La consolidation dépasse le budget ({total_chars}/{limit} caractères).",
                    "current_entries": entries
                }
            self._persist(target, new_entries)
            return {
                "success": True,
                "message": f"Entrée mise à jour dans {target}.",
                "replaced_index": idx,
                "status": self.get_status()[target]
            }

    def remove(self, target: str, old_text: str) -> Dict[str, Any]:
        """Supprime une entrée spécifique."""
        old_text = old_text.strip()
        if not old_text:
            return {"success": False, "error": "old_text requis pour la suppression."}

        target = "user" if target.lower() in ("user", "user.md", "profile") else "memory"
        path = self._path_for(target)

        with self._lock, self._file_lock(path):
            self._load_target(target)
            entries = self.get_entries(target)
            idx, is_ambiguous = _find_unique_match(entries, old_text)
            if is_ambiguous:
                return {
                    "success": False,
                    "error": f"Plusieurs entrées correspondent à '{old_text}'. Précisez le texte exact.",
                    "current_entries": entries
                }
            if idx is None:
                return {
                    "success": False,
                    "error": f"Aucune entrée ne correspond à '{old_text}'.",
                    "current_entries": entries
                }
            removed = entries.pop(idx)
            self._persist(target, entries)
            return {
                "success": True,
                "message": f"Entrée supprimée de {target}.",
                "removed_entry": removed,
                "status": self.get_status()[target]
            }

    def save_raw(self, target: str, raw_markdown: str) -> Dict[str, Any]:
        """Écrit directement le texte brut et le réanalyse proprement."""
        threat = _scan_threats(raw_markdown)
        if threat:
            return {"success": False, "error": threat}

        target = "user" if target.lower() in ("user", "user.md", "profile") else "memory"
        path = self._path_for(target)

        with self._lock, self._file_lock(path):
            entries = self._parse_entries(raw_markdown)
            total_chars = len(ENTRY_DELIMITER.join(entries))
            limit = self.get_char_limit(target)
            if total_chars > limit:
                return {
                    "success": False,
                    "error": f"Le contenu ({total_chars} caractères) dépasse le quota de {limit} caractères."
                }
            self._persist(target, entries)
            return {
                "success": True,
                "message": f"Fichier {target} enregistré avec succès ({len(entries)} entrées).",
                "status": self.get_status()[target]
            }


# Instance singleton globale partagée
memory_store = MemoryStore()
