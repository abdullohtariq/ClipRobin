import hashlib
import hmac
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)

SUBSCRIPTIONS_FILE = Path(__file__).resolve().parents[2] / "data" / "subscriptions.json"


def get_subscriptions_data() -> dict[str, Any]:
    SUBSCRIPTIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if SUBSCRIPTIONS_FILE.is_file():
        try:
            return json.loads(SUBSCRIPTIONS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"subscriptions": [], "active_plan": "free", "license_key": None}


def save_subscriptions_data(data: dict[str, Any]) -> None:
    SUBSCRIPTIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SUBSCRIPTIONS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def verify_paddle_signature(raw_body: bytes, signature_header: str | None, secret_key: str) -> bool:
    if not signature_header or not secret_key:
        return False
    try:
        parts = dict(item.split("=", 1) for item in signature_header.split(";"))
        ts = parts.get("ts")
        h1 = parts.get("h1")
        if not ts or not h1:
            return False

        # Verify timestamp isn't too old (allow up to 24 hours for sandbox replay)
        if abs(time.time() - int(ts)) > 86400:
            return False

        signed_payload = f"{ts}:{raw_body.decode('utf-8')}"
        computed_hash = hmac.new(
            secret_key.encode("utf-8"),
            signed_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        return hmac.compare_digest(computed_hash, h1)
    except Exception as e:
        logger.warning("Paddle signature verification error: %s", e)
        return False


@router.post("/paddle")
async def paddle_webhook_endpoint(
    request: Request,
    paddle_signature: str | None = Header(None, alias="Paddle-Signature"),
):
    raw_body = await request.body()
    secret_key = os.environ.get("PADDLE_WEBHOOK_SECRET_KEY", "").strip()

    # If secret key is configured, verify signature
    if secret_key:
        if not verify_paddle_signature(raw_body, paddle_signature, secret_key):
            logger.warning("Invalid Paddle webhook signature rejected")
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = payload.get("event_type")
    event_data = payload.get("data", {})
    logger.info("Received Paddle webhook: %s", event_type)

    subs = get_subscriptions_data()

    if event_type in {"transaction.completed", "subscription.activated", "subscription.created"}:
        customer_id = event_data.get("customer_id")
        subscription_id = event_data.get("id") or event_data.get("subscription_id")
        transaction_id = event_data.get("id") if event_type == "transaction.completed" else None
        plan_license = f"ROBIN-PRO-{hashlib.sha256(str(subscription_id or transaction_id or time.time()).encode()).hexdigest()[:12].upper()}"

        subs["active_plan"] = "pro"
        subs["license_key"] = plan_license
        subs["updated_at"] = time.time()
        subs["subscriptions"].append({
            "event": event_type,
            "subscription_id": subscription_id,
            "transaction_id": transaction_id,
            "customer_id": customer_id,
            "created_at": time.time(),
        })
        save_subscriptions_data(subs)
        logger.info("Activated Pro subscription via Paddle webhook: %s", plan_license)

    elif event_type in {"subscription.canceled", "subscription.past_due"}:
        subs["active_plan"] = "free"
        subs["updated_at"] = time.time()
        save_subscriptions_data(subs)
        logger.info("Subscription canceled or past due via Paddle webhook: %s", event_type)

    return {"status": "success", "event_type": event_type}


@router.get("/paddle/status")
def get_subscription_status():
    data = get_subscriptions_data()
    return {
        "active_plan": data.get("active_plan", "free"),
        "license_key": data.get("license_key"),
        "environment": os.environ.get("PADDLE_ENVIRONMENT", "sandbox"),
        "configured": bool(os.environ.get("PADDLE_CLIENT_TOKEN")),
    }
