import logging
import re
from pathlib import Path
from typing import Any, TypedDict

from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import require_auth
from app.config import GEMINI_DIR, HOME

logger = logging.getLogger("antigravity.skills")
router = APIRouter(prefix="/api/skills", tags=["skills"])

class SkillDirInfo(TypedDict):
    type: str
    dir: Path


def get_skill_dirs() -> list[SkillDirInfo]:
    dirs: list[SkillDirInfo] = []
    seen: set[str] = set()

    candidates: list[tuple[str, Path]] = [
        ("user", HOME / ".gemini" / "config" / "skills"),
        ("user", GEMINI_DIR.parent / "config" / "skills"),
        ("hermes", HOME / ".hermes" / "skills"),
        ("builtin", GEMINI_DIR / "builtin" / "skills"),
    ]
    for s_type, p in candidates:
        try:
            resolved = str(p.resolve())
        except Exception:
            resolved = str(p)
        if resolved not in seen:
            seen.add(resolved)
            dirs.append({"type": s_type, "dir": p})
    return dirs


SKILL_DIRS: list[SkillDirInfo] = get_skill_dirs()

def parse_skill_md(skill_file: Path) -> dict[str, Any]:
    name = skill_file.parent.name
    description = ""
    content = ""
    try:
        with open(skill_file, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        
        # Parse YAML frontmatter if present
        fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", content, re.DOTALL)
        if fm_match:
            fm_text = fm_match.group(1)
            body = fm_match.group(2)
            lines = fm_text.splitlines()
            i = 0
            while i < len(lines):
                line = lines[i]
                if line.startswith("name:"):
                    name = line.split(":", 1)[1].strip().strip('"').strip("'")
                elif line.startswith("description:"):
                    val = line.split(":", 1)[1].strip()
                    if val in (">-", ">", "|", "|-"):
                        desc_parts = []
                        i += 1
                        while i < len(lines) and (lines[i].startswith("  ") or lines[i].startswith("\t") or not lines[i].strip()):
                            stripped = lines[i].strip()
                            if stripped:
                                desc_parts.append(stripped)
                            i += 1
                        description = " ".join(desc_parts).strip()
                        continue
                    else:
                        description = val.strip('"').strip("'")
                i += 1
            if not description and body:
                description = body.strip().split("\n")[0][:160]
        else:
            # First heading / paragraph
            lines = content.strip().splitlines()
            for l in lines:
                cleaned = l.strip("#").strip()
                if cleaned:
                    description = cleaned
                    break
    except Exception as e:
        logger.warning(f"Error parsing {skill_file}: {e}")

    return {
        "name": name,
        "description": description or "Pas de description disponible.",
        "content": content
    }

@router.get("")
def list_skills(_ = Depends(require_auth)) -> list[dict[str, Any]]:
    skills: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for s_info in get_skill_dirs():
        base_dir = s_info["dir"]
        s_type = s_info["type"]
        if not base_dir.exists():
            continue

        for folder in sorted(base_dir.iterdir()):
            if not folder.is_dir() or folder.name in seen_ids:
                continue
            skill_md = folder / "SKILL.md"
            if skill_md.exists():
                meta = parse_skill_md(skill_md)
                has_scripts = (folder / "scripts").exists()
                has_examples = (folder / "examples").exists()
                stat = skill_md.stat()

                seen_ids.add(folder.name)
                skills.append({
                    "id": folder.name,
                    "name": meta["name"],
                    "description": meta["description"],
                    "type": s_type,
                    "path": str(folder),
                    "has_scripts": has_scripts,
                    "has_examples": has_examples,
                    "last_modified": stat.st_mtime,
                    "enabled": True  # All discovered skills in these folders are active
                })

    return skills

@router.get("/{skill_id}")
def get_skill_detail(skill_id: str, _ = Depends(require_auth)):
    safe_id = Path(skill_id).name
    if not safe_id or safe_id != skill_id or ".." in skill_id:
        raise HTTPException(status_code=400, detail="Identifiant de skill non valide")

    for s_info in get_skill_dirs():
        base_dir = Path(s_info["dir"])
        target = base_dir / safe_id / "SKILL.md"
        if target.exists():
            meta = parse_skill_md(target)
            return {
                "id": safe_id,
                "name": meta["name"],
                "description": meta["description"],
                "content": meta["content"],
                "type": s_info["type"],
                "path": str(target.parent)
            }
            
    raise HTTPException(status_code=404, detail="Skill introuvable")
