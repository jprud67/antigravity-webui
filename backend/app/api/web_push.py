"""API router for Web Push notifications."""

from typing import Optional
from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.services.web_push import (
    get_or_create_vapid_keys,
    save_subscription,
    remove_subscription,
    list_subscriptions,
    send_web_push_notification,
)

router = APIRouter(prefix="/api/push", tags=["push"])


class SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeRequest(BaseModel):
    endpoint: str
    keys: SubscriptionKeys
    user_agent: Optional[str] = None


class UnsubscribeRequest(BaseModel):
    endpoint: str


class SendTestPushRequest(BaseModel):
    title: Optional[str] = "Antigravity Test"
    body: Optional[str] = "Notification Web Push de test réussie !"
    url: Optional[str] = "/"


@router.get("/vapid-public-key")
def api_get_vapid_public_key():
    """Retrieve VAPID public key for browser PushManager subscription."""
    keys = get_or_create_vapid_keys()
    return {"public_key": keys["public_key"]}


@router.get("/subscriptions")
def api_list_subscriptions():
    """List all registered push subscriptions."""
    subs = list_subscriptions()
    return {"subscriptions": subs, "count": len(subs)}


@router.post("/subscribe")
def api_subscribe(req: SubscribeRequest, request: Request):
    """Register browser push subscription."""
    ua = req.user_agent or request.headers.get("user-agent", "")
    ok = save_subscription(
        endpoint=req.endpoint,
        p256dh=req.keys.p256dh,
        auth=req.keys.auth,
        user_agent=ua
    )
    return {"success": ok}


@router.post("/unsubscribe")
def api_unsubscribe(req: UnsubscribeRequest):
    """Remove browser push subscription."""
    ok = remove_subscription(req.endpoint)
    return {"success": ok}


@router.post("/test")
def api_test_push(req: SendTestPushRequest):
    """Send a test push notification to all subscribers."""
    res = send_web_push_notification(
        title=req.title or "Antigravity Test",
        body=req.body or "Notification Web Push de test réussie !",
        url=req.url or "/"
    )
    return res
