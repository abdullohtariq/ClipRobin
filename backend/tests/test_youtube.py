import json
from pathlib import Path
from unittest.mock import MagicMock
import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.youtube_uploader import YouTubeService, default_youtube_service


@pytest.fixture
def temp_youtube_service(tmp_path: Path):
    config_file = tmp_path / "yt_config.json"
    auth_file = tmp_path / "yt_auth.json"
    service = YouTubeService(config_file=config_file, auth_file=auth_file)
    return service


def test_youtube_config_save_and_get(temp_youtube_service: YouTubeService):
    status = temp_youtube_service.get_status()
    assert status["configured"] is False
    assert status["authenticated"] is False

    temp_youtube_service.save_config("client-1234567890.apps.googleusercontent.com", "secret-xyz")
    status = temp_youtube_service.get_status()
    assert status["configured"] is True
    assert "..." in status["client_id_preview"]

    cfg = temp_youtube_service.get_config()
    assert cfg["client_id"] == "client-1234567890.apps.googleusercontent.com"
    assert cfg["client_secret"] == "secret-xyz"


def test_parse_client_secret_json():
    # Installed application format
    installed_format = json.dumps({
        "installed": {
            "client_id": "test-id.apps.googleusercontent.com",
            "client_secret": "test-secret",
        }
    })
    cid, sec = YouTubeService.parse_client_secret_json(installed_format)
    assert cid == "test-id.apps.googleusercontent.com"
    assert sec == "test-secret"

    # Web application format
    web_format = json.dumps({
        "web": {
            "client_id": "web-id.apps.googleusercontent.com",
            "client_secret": "web-secret",
        }
    })
    cid, sec = YouTubeService.parse_client_secret_json(web_format)
    assert cid == "web-id.apps.googleusercontent.com"
    assert sec == "web-secret"


def test_get_auth_url(temp_youtube_service: YouTubeService):
    with pytest.raises(ValueError, match="not configured"):
        temp_youtube_service.get_auth_url("http://127.0.0.1:8000/api/youtube/oauth/callback")

    temp_youtube_service.save_config("test-client-id", "test-secret")
    url = temp_youtube_service.get_auth_url("http://127.0.0.1:8000/api/youtube/oauth/callback")
    assert "https://accounts.google.com/o/oauth2/v2/auth" in url
    assert "client_id=test-client-id" in url
    assert "youtube.upload" in url
    assert "access_type=offline" in url


def test_exchange_code(temp_youtube_service: YouTubeService):
    temp_youtube_service.save_config("test-client-id", "test-secret")

    def custom_transport(request: httpx.Request) -> httpx.Response:
        if "oauth2.googleapis.com/token" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "access_token": "mock-access-token",
                    "refresh_token": "mock-refresh-token",
                    "expires_in": 3600,
                    "token_type": "Bearer",
                },
            )
        if "googleapis.com/youtube/v3/channels" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "UC1234567890",
                            "snippet": {
                                "title": "My Test Channel",
                                "customUrl": "@testchannel",
                                "thumbnails": {"default": {"url": "https://img.youtube.com/thumb.jpg"}},
                            },
                        }
                    ]
                },
            )
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(custom_transport))
    temp_youtube_service._client = client

    auth_data = temp_youtube_service.exchange_code(
        code="auth-code-123", redirect_uri="http://127.0.0.1:8000/api/youtube/oauth/callback"
    )
    assert auth_data["access_token"] == "mock-access-token"
    assert auth_data["refresh_token"] == "mock-refresh-token"
    assert auth_data["channel"]["title"] == "My Test Channel"
    assert auth_data["channel"]["handle"] == "@testchannel"

    status = temp_youtube_service.get_status()
    assert status["authenticated"] is True
    assert status["channel"]["title"] == "My Test Channel"


def test_upload_video(temp_youtube_service: YouTubeService, tmp_path: Path):
    temp_youtube_service.save_config("test-client-id", "test-secret")
    temp_youtube_service.save_auth_data({
        "access_token": "valid-token",
        "refresh_token": "refresh-token",
        "expires_at": 9999999999.0,
        "channel": {"title": "Test Channel"},
    })

    test_video = tmp_path / "test_clip.mp4"
    test_video.write_bytes(b"FAKE_MP4_CONTENT_FOR_TESTING")

    def upload_transport(request: httpx.Request) -> httpx.Response:
        # Step 1: Resumable Init (POST)
        if request.method == "POST" and "uploadType=resumable" in str(request.url):
            return httpx.Response(
                200,
                headers={"Location": "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=mock123"},
            )
        # Step 2: Upload content (PUT)
        if request.method == "PUT" and "upload_id=mock123" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "id": "mock_yt_video_id_999",
                    "snippet": {"title": "My Clip Title #shorts"},
                    "status": {"privacyStatus": "private"},
                },
            )
        return httpx.Response(404)

    temp_youtube_service._client = httpx.Client(transport=httpx.MockTransport(upload_transport))

    res = temp_youtube_service.upload_video(
        video_path=test_video,
        title="My Clip Title #shorts",
        description="Check this out",
        privacy_status="private",
    )
    assert res["success"] is True
    assert res["video_id"] == "mock_yt_video_id_999"
    assert res["shorts_url"] == "https://www.youtube.com/shorts/mock_yt_video_id_999"
    assert res["youtube_url"] == "https://youtu.be/mock_yt_video_id_999"


def test_youtube_api_routes(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(default_youtube_service, "config_file", tmp_path / "yt_cfg.json")
    monkeypatch.setattr(default_youtube_service, "auth_file", tmp_path / "yt_auth.json")
    test_client = TestClient(app)

    # Status endpoint
    resp = test_client.get("/api/youtube/status")
    assert resp.status_code == 200
    assert "configured" in resp.json()
    assert "authenticated" in resp.json()

    # Save config endpoint
    resp = test_client.post(
        "/api/youtube/config",
        json={"client_id": "test-cid.apps.googleusercontent.com", "client_secret": "test-sec"},
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    # Auth URL endpoint
    resp = test_client.get("/api/youtube/auth-url")
    assert resp.status_code == 200
    assert "auth_url" in resp.json()

    # Disconnect endpoint
    resp = test_client.post("/api/youtube/disconnect")
    assert resp.status_code == 200
    assert resp.json()["status"]["authenticated"] is False
