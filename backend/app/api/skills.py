import re
import logging
from pathlib import Path
from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from app.config import GEMINI_DIR, HOME
from app.api.auth import require_auth

logger = logging.getLogger("antigravity.skills")
router = APIRouter(prefix="/api/skills", tags=["skills"])

SKILL_DIRS = [
    {"type": "user", "dir": HOME / ".gemini" / "config" / "skills"},
    {"type": "hermes", "dir": HOME / ".hermes" / "skills"},
    {"type": "builtin", "dir": GEMINI_DIR / "builtin" / "skills"},
]

def parse_skill_md(skill_file: Path) -> Dict[str, Any]:
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
            for line in fm_text.splitlines():
                if line.startswith("name:"):
                    name = line.split(":", 1)[1].strip().strip('"').strip("'")
                elif line.startswith("description:"):
                    description = line.split(":", 1)[1].strip().strip('"').strip("'")
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
def list_skills(_ = Depends(require_auth)):
    skills = []
    
    for s_info in SKILL_DIRS:
        base_dir = s_info["dir"]
        s_type = s_info["type"]
        if not base_dir.exists():
            continue

        for folder in base_dir.iterdir():
            if not folder.is_dir():
                continue
            skill_md = folder / "SKILL.md"
            if skill_md.exists():
                meta = parse_skill_md(skill_md)
                has_scripts = (folder / "scripts").exists()
                has_examples = (folder / "examples").exists()
                stat = skill_md.stat()

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

    for s_info in SKILL_DIRS:
        base_dir = s_info["dir"]
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
