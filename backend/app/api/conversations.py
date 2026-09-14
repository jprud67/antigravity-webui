from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from app.services.storage import list_conversations, get_conversation_transcript

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

@router.get("", response_model=List[Dict[str, Any]])
def get_conversations(limit: int = 100):
    return list_conversations(limit=limit)

@router.get("/{conversation_id}")
def get_conversation(conversation_id: str):
    transcript = get_conversation_transcript(conversation_id)
    if not transcript:
        # Check if conversation exists in db
        convs = [c for c in list_conversations() if c["conversation_id"] == conversation_id]
        if not convs:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"conversation_id": conversation_id, "meta": convs[0], "steps": []}
    return {"conversation_id": conversation_id, "steps": transcript}
