"""
skill_curator.py — Auto-Curator de compétences & Gestionnaire de Cycle de Vie des Skills.
Inspiré directement de Hermes Agent (tools/skill_usage.py & tools/skill_ledger.py).

Gère :
  1. Suivi d'utilisation (.usage.json) :
     - use_count, last_used_at, created_at, pinned.
  2. Cycle de vie non-destructif :
     - active : utilisé sous 14 jours (ou épinglé).
     - stale : inactif depuis > 14 jours.
     - archived : inactif depuis > 30 jours (déplacé ou étiqueté).
  3. Protection des compétences critiques :
     - Compétences épinglées (pinned=True).
     - Built-ins protégés fondamentaux.
  4. Journal d'audit append-only (.curator_ledger.jsonl) :
     - Traçabilité et historique de chaque transition et action utilisateur/agent.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("antigravity.skill_curator")

# Compétences built-in protégées en lecture seule
PROTECTED_SKILLS = frozenset({
    "agy-customizations",
    "antigravity-guide",
    "brainstorming",
    "using-superpowers",
    "executing-plans",
    "writing-plans",
    "systematic-debugging",
    "verification-before-completion",
})

STATE_ACTIVE = "active"
STATE_STALE = "stale"
STATE_ARCHIVED = "archived"


def _get_skills_dir() -> Path:
    # Répertoire global par défaut
    global_dir = Path.home() / ".gemini" / "config" / "skills"
    if global_dir.exists():
        return global_dir
    alt = Path.home() / ".antigravity" / "skills"
    alt.mkdir(parents=True, exist_ok=True)
    return alt


class SkillCurator:
    """Orchestrateur de maintenance et cycle de vie des compétences."""

    def __init__(self, skills_dir: Path | None = None):
        self.skills_dir = skills_dir or _get_skills_dir()
        self._lock = threading.RLock()
        self.usage_file = self.skills_dir / ".usage.json"
        self.ledger_file = self.skills_dir / ".curator_ledger.jsonl"
        self._init_storage()

    def _init_storage(self) -> None:
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        if not self.usage_file.exists():
            try:
                self.usage_file.write_text("{}", encoding="utf-8")
            except Exception as e:
                logger.debug(f"Impossible de créer .usage.json: {e}")

    def _load_usage(self) -> dict[str, Any]:
        if not self.usage_file.is_file():
            return {}
        try:
            return json.loads(self.usage_file.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _save_usage(self, data: dict[str, Any]) -> None:
        try:
            tmp = self.usage_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self.usage_file)
        except Exception as e:
            logger.warning(f"Erreur enregistrement usage skills: {e}")

    def _append_ledger(
        self,
        action: str,
        skill_name: str,
        actor: str = "curator",
        before: Any = None,
        after: Any = None,
        details: str = "",
    ) -> None:
        """Enregistre un événement immuable dans le ledger d'audit."""
        record = {
            "id": f"led_{uuid.uuid4().hex[:16]}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": action,
            "skill_name": skill_name,
            "actor": actor,
            "before": before,
            "after": after,
            "details": details,
        }
        try:
            with open(self.ledger_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except Exception as e:
            logger.debug(f"Erreur écriture ledger: {e}")

    def record_skill_usage(self, skill_name: str, actor: str = "agent") -> dict[str, Any]:
        """Incrémente le compteur d'utilisation et réactive la compétence si stale."""
        clean = skill_name.strip()
        with self._lock:
            data = self._load_usage()
            record = data.get(clean, {
                "use_count": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "pinned": clean in PROTECTED_SKILLS,
                "status": STATE_ACTIVE,
            })
            is_new = clean not in data
            before_status = record.get("status", STATE_ACTIVE)
            record["use_count"] = record.get("use_count", 0) + 1
            record["last_used_at"] = datetime.now(timezone.utc).isoformat()
            if is_new:
                self._append_ledger("register", clean, actor=actor, before=None, after=STATE_ACTIVE, details="Compétence enregistrée")
            elif record.get("status") in (STATE_STALE, STATE_ARCHIVED):
                record["status"] = STATE_ACTIVE
                self._append_ledger("reactivate", clean, actor=actor, before=before_status, after=STATE_ACTIVE, details="Réactivé suite à invocation")

            data[clean] = record
            self._save_usage(data)
            return record

    def toggle_pin(self, skill_name: str, pinned: bool | None = None, actor: str = "user") -> dict[str, Any]:
        """Bascule l'épinglage protecteur d'une compétence."""
        clean = skill_name.strip()
        with self._lock:
            data = self._load_usage()
            record = data.get(clean, {
                "use_count": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "pinned": False,
                "status": STATE_ACTIVE,
            })
            before_pin = record.get("pinned", False)
            new_pin = not before_pin if pinned is None else bool(pinned)
            record["pinned"] = new_pin
            if new_pin and record.get("status") != STATE_ACTIVE:
                record["status"] = STATE_ACTIVE

            data[clean] = record
            self._save_usage(data)
            self._append_ledger(
                "pin" if new_pin else "unpin",
                clean,
                actor=actor,
                before=before_pin,
                after=new_pin,
                details=f"Épinglage {'activé' if new_pin else 'désactivé'}"
            )
            return {"skill_name": clean, "pinned": new_pin, "status": record.get("status")}

    def sweep_lifecycle(self, stale_days: int = 14, archive_days: int = 30, actor: str = "curator") -> dict[str, Any]:
        """
        Balayage automatique du cycle de vie des compétences :
          - Active -> Stale après stale_days sans utilisation.
          - Stale -> Archived après archive_days sans utilisation.
          - Ne touche JAMAIS aux compétences épinglées ou protégées.
        """
        now = datetime.now(timezone.utc)
        stale_threshold = now - timedelta(days=stale_days)
        archive_threshold = now - timedelta(days=archive_days)

        with self._lock:
            data = self._load_usage()
            transitions = []

            for name, rec in list(data.items()):
                if rec.get("pinned") or name in PROTECTED_SKILLS:
                    continue

                status = rec.get("status", STATE_ACTIVE)
                last_used_str = rec.get("last_used_at") or rec.get("created_at")
                if not last_used_str:
                    continue

                try:
                    last_used = datetime.fromisoformat(last_used_str.replace("Z", "+00:00"))
                except Exception:
                    continue

                new_status = status
                if last_used < archive_threshold:
                    new_status = STATE_ARCHIVED
                elif last_used < stale_threshold:
                    new_status = STATE_STALE

                if new_status != status:
                    rec["status"] = new_status
                    transitions.append({"skill_name": name, "before": status, "after": new_status})
                    self._append_ledger("transition", name, actor=actor, before=status, after=new_status, details=f"Curation automatique ({stale_days}j/{archive_days}j)")

            if transitions:
                self._save_usage(data)

            return {
                "success": True,
                "timestamp": now.isoformat(),
                "total_skills": len(data),
                "transitions_count": len(transitions),
                "transitions": transitions,
            }

    def get_skill_telemetry(self, skill_name: str) -> dict[str, Any]:
        """Fournit la télémétrie détaillée d'une compétence."""
        clean = skill_name.strip()
        data = self._load_usage()
        rec = data.get(clean)
        if not rec:
            is_prot = clean in PROTECTED_SKILLS
            return {
                "skill_name": clean,
                "use_count": 0,
                "last_used_at": None,
                "created_at": None,
                "pinned": is_prot,
                "status": STATE_ACTIVE,
                "is_protected": is_prot,
            }
        return {
            "skill_name": clean,
            "use_count": rec.get("use_count", 0),
            "last_used_at": rec.get("last_used_at"),
            "created_at": rec.get("created_at"),
            "pinned": rec.get("pinned", False),
            "status": rec.get("status", STATE_ACTIVE),
            "is_protected": clean in PROTECTED_SKILLS,
        }

    def get_all_skills_telemetry(self) -> list[dict[str, Any]]:
        """Renvoie la télémétrie de l'ensemble des compétences enregistrées."""
        data = self._load_usage()
        # Scan également les dossiers réels de skills
        results = []
        found_names = set(data.keys())

        if self.skills_dir.is_dir():
            for child in self.skills_dir.iterdir():
                if child.is_dir() and not child.name.startswith("."):
                    found_names.add(child.name)

        for name in sorted(found_names):
            results.append(self.get_skill_telemetry(name))
        return results

    def get_ledger(self, limit: int = 50) -> list[dict[str, Any]]:
        """Lit les N dernières lignes du journal d'audit."""
        if not self.ledger_file.is_file():
            return []
        try:
            with open(self.ledger_file, "r", encoding="utf-8", errors="replace") as f:
                lines = [l.strip() for l in f if l.strip()]
            records = []
            for line in reversed(lines[-limit:]):
                try:
                    records.append(json.loads(line))
                except Exception:
                    continue
            return records
        except Exception as e:
            logger.debug(f"Erreur lecture ledger: {e}")
            return []


skill_curator = SkillCurator()
