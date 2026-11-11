from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_local_sidecar_cannot_activate_or_return_legacy_subscription():
    response = client.post("/api/webhooks/paddle", json={"event_type": "transaction.completed"})
    assert response.status_code == 404
    assert client.get("/api/webhooks/paddle/status").status_code == 404
