from fastapi import APIRouter, HTTPException, Depends
from typing import List, Dict, Any, Optional
from app.api.auth import require_auth
from app.services.storage import list_artifacts, read_artifact_content

router = APIRouter(prefix="/api/artifacts", tags=["artifacts"])

@router.get("", response_model=List[Dict[str, Any]])
def get_artifacts(conversation_id: Optional[str] = None, _ = Depends(require_auth)):
    return list_artifacts(conversation_id=conversation_id)

@router.get("/{conversation_id}/{filename:path}")
def get_artifact_detail(conversation_id: str, filename: str, _ = Depends(require_auth)):
    try:
        content = read_artifact_content(conversation_id, filename)
        return {"conversation_id": conversation_id, "filename": filename, "content": content}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
