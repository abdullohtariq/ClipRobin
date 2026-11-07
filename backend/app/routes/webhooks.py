import hashlib
import hmac
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request

from app.services.project_manager import get_projects_dir

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)

# Module-level override hook (None resolves dynamically to app data dir next to projects/)
SUBSCRIPTIONS_FILE: Path | None = None
_SUBS_LOCK = threading.Lock()


def _get_subscriptions_file() -> Path:
    if SUBSCRIPTIONS_FILE is not None:
        return SUBSCRIPTIONS_FILE
    return get_projects_dir().parent / "subscriptions.json"


def get_subscriptions_data() -> dict[str, Any]:
    subs_file = _get_subscriptions_file()
    subs_file.parent.mkdir(parents=True, exist_ok=True)
    if subs_file.is_file():
        try:
            loaded = json.loads(subs_file.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            pass
    return {"subscriptions": [], "active_plan": "free", "license_key": None}


def save_subscriptions_data(data: dict[str, Any]) -> None:
    subs_file = _get_subscriptions_file()
    subs_file.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(data, indent=2)
    tmp = subs_file.with_name(f".subscriptions.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_text(serialized, encoding="utf-8")
        os.replace(tmp, subs_file)
    except OSError:
        tmp.unlink(missing_ok=True)
        subs_file.write_text(serialized, encoding="utf-8")


def verify_paddle_signature(raw_body: bytes, signature_header: str | None, secret_key: str) -> bool:
    if not signature_header or not secret_key:
        return False
    try:
        parts = dict(item.split("=", 1) for item in signature_header.split(";") if "=" in item)
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
    paddle_env = os.environ.get("PADDLE_ENVIRONMENT", "sandbox").strip().lower()

    if paddle_env == "production" and not secret_key:
        raise HTTPException(status_code=503, detail="Paddle webhook secret key is not configured")

    # If secret key is configured, verify signature
    if secret_key:
        if not verify_paddle_signature(raw_body, paddle_signature, secret_key):
            logger.warning("Invalid Paddle webhook signature rejected")
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Payload must be a JSON object")
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = payload.get("event_type")
    event_data = payload.get("data", {}) if isinstance(payload.get("data"), dict) else {}
    logger.info("Received Paddle webhook: %s", event_type)

    with _SUBS_LOCK:
        subs = get_subscriptions_data()
        if not isinstance(subs.get("subscriptions"), list):
            subs["subscriptions"] = []

        if event_type in {"transaction.completed", "subscription.activated", "subscription.created"}:
            customer_id = event_data.get("customer_id")
            subscription_id = event_data.get("id") or event_data.get("subscription_id")
            transaction_id = event_data.get("id") if event_type == "transaction.completed" else None
            plan_license = (
                f"ROBIN-PRO-"
                f"{hashlib.sha256(str(subscription_id or transaction_id or time.time()).encode()).hexdigest()[:12].upper()}"
            )

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

        elif event_type in {"subscription.canceled", "subscription.past_due", "subscription.paused"}:
            subs["active_plan"] = "free"
            subs["updated_at"] = time.time()
            save_subscriptions_data(subs)
            logger.info("Subscription deactivated via Paddle webhook: %s", event_type)

    return {"status": "success", "event_type": event_type}


@router.get("/paddle/status")
def get_subscription_status():
    with _SUBS_LOCK:
        data = get_subscriptions_data()
    return {
        "active_plan": data.get("active_plan", "free"),
        "license_key": data.get("license_key"),
        "environment": os.environ.get("PADDLE_ENVIRONMENT", "sandbox"),
        "configured": bool(os.environ.get("PADDLE_CLIENT_TOKEN")),
    }
