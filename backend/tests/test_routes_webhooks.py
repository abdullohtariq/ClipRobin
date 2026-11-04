import json
import time
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_paddle_webhook_flow(tmp_path, monkeypatch):
    test_subs_file = tmp_path / "subscriptions.json"
    monkeypatch.setattr("app.routes.webhooks.SUBSCRIPTIONS_FILE", test_subs_file)
    monkeypatch.setenv("PADDLE_WEBHOOK_SECRET_KEY", "")

    # 1. Initially status is free
    status_res = client.get("/api/webhooks/paddle/status")
    assert status_res.status_code == 200
    assert status_res.json()["active_plan"] == "free"

    # 2. Simulate Paddle transaction.completed webhook
    payload = {
        "event_id": "evt_test123",
        "event_type": "transaction.completed",
        "data": {
            "id": "txn_test999",
            "customer_id": "ctm_test001",
            "status": "completed",
        },
    }
    hook_res = client.post("/api/webhooks/paddle", json=payload)
    assert hook_res.status_code == 200
    assert hook_res.json()["status"] == "success"

    # 3. Status should now be pro
    status_res2 = client.get("/api/webhooks/paddle/status")
    assert status_res2.status_code == 200
    assert status_res2.json()["active_plan"] == "pro"
    assert status_res2.json()["license_key"].startswith("ROBIN-PRO-")
