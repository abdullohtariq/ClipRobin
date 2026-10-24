import json
import logging
import os
import time
from pathlib import Path
from typing import Any
import httpx

logger = logging.getLogger(__name__)

# Scopes required for uploading clips and viewing channel metadata
YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
]

AUTH_URL_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"
CHANNELS_ENDPOINT = "https://www.googleapis.com/youtube/v3/channels"
UPLOAD_INIT_ENDPOINT = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"


def _get_data_dir() -> Path:
    from app.services.project_manager import get_projects_dir
    data_dir = get_projects_dir().parent
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def get_config_file() -> Path:
    return _get_data_dir() / "youtube_config.json"


def get_auth_file() -> Path:
    return _get_data_dir() / "youtube_auth.json"


class YouTubeService:
    def __init__(
        self,
        config_file: Path | None = None,
        auth_file: Path | None = None,
        client: httpx.Client | None = None,
    ):
        self.config_file = config_file or get_config_file()
        self.auth_file = auth_file or get_auth_file()
        self._client = client

    def _get_client(self) -> httpx.Client:
        if self._client is not None:
            return self._client
        return httpx.Client(timeout=120.0)

    # -------------------------------------------------------------------------
    # Configuration (Client ID & Client Secret)
    # -------------------------------------------------------------------------
    def get_config(self) -> dict[str, Any]:
        client_id = os.environ.get("CLIPROBIN_YOUTUBE_CLIENT_ID", "").strip()
        client_secret = os.environ.get("CLIPROBIN_YOUTUBE_CLIENT_SECRET", "").strip()

        if self.config_file.is_file():
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    client_id = data.get("client_id", client_id).strip()
                    client_secret = data.get("client_secret", client_secret).strip()
            except Exception as e:
                logger.warning(f"Failed to read YouTube config: {e}")

        is_configured = bool(client_id and client_secret)
        preview = ""
        if client_id:
            if len(client_id) > 16:
                preview = f"{client_id[:8]}...{client_id[-8:]}"
            else:
                preview = client_id

        return {
            "client_id": client_id,
            "client_secret": client_secret,
            "configured": is_configured,
            "client_id_preview": preview,
        }

    def save_config(self, client_id: str, client_secret: str) -> dict[str, Any]:
        client_id = client_id.strip()
        client_secret = client_secret.strip()
        if not client_id or not client_secret:
            raise ValueError("Both Client ID and Client Secret are required.")

        payload = {"client_id": client_id, "client_secret": client_secret}
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_file, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

        return self.get_config()

    @staticmethod
    def parse_client_secret_json(raw_json: str | dict[str, Any]) -> tuple[str, str]:
        """Extract client_id and client_secret from Google Cloud Console JSON."""
        data = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
        
        # Check standard Google JSON structures ("installed" or "web")
        root = data.get("installed") or data.get("web") or data
        client_id = root.get("client_id", "").strip()
        client_secret = root.get("client_secret", "").strip()

        if not client_id or not client_secret:
            raise ValueError("Could not find valid 'client_id' and 'client_secret' in the provided JSON.")

        return client_id, client_secret

    # -------------------------------------------------------------------------
    # Authentication & Tokens
    # -------------------------------------------------------------------------
    def get_auth_data(self) -> dict[str, Any] | None:
        if not self.auth_file.is_file():
            return None
        try:
            with open(self.auth_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to read YouTube auth file: {e}")
            return None

    def save_auth_data(self, auth_data: dict[str, Any]) -> None:
        self.auth_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.auth_file, "w", encoding="utf-8") as f:
            json.dump(auth_data, f, indent=2)

    def clear_auth(self) -> None:
        auth_data = self.get_auth_data()
        if auth_data:
            token = auth_data.get("refresh_token") or auth_data.get("access_token")
            if token:
                try:
                    client = self._get_client()
                    client.post(REVOKE_ENDPOINT, params={"token": token}, timeout=5.0)
                except Exception as e:
                    logger.debug(f"Revoke token call failed (non-fatal): {e}")

        if self.auth_file.is_file():
            try:
                self.auth_file.unlink()
            except Exception as e:
                logger.warning(f"Failed to delete YouTube auth file: {e}")

    def get_status(self) -> dict[str, Any]:
        config = self.get_config()
        auth_data = self.get_auth_data()

        is_authenticated = bool(
            auth_data and (auth_data.get("access_token") or auth_data.get("refresh_token"))
        )

        channel_info = None
        if is_authenticated and auth_data:
            channel_info = auth_data.get("channel")

        return {
            "configured": config["configured"],
            "client_id_preview": config["client_id_preview"],
            "authenticated": is_authenticated,
            "channel": channel_info,
        }

    # -------------------------------------------------------------------------
    # OAuth2 Flow
    # -------------------------------------------------------------------------
    def get_auth_url(self, redirect_uri: str, state: str = "cliprobin_yt_oauth") -> str:
        config = self.get_config()
        if not config["configured"]:
            raise ValueError(
                "YouTube OAuth is not configured. Please supply Google Client ID and Secret in settings or modal."
            )

        params = {
            "client_id": config["client_id"],
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(YOUTUBE_SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
        return str(httpx.URL(AUTH_URL_ENDPOINT, params=params))

    def exchange_code(self, code: str, redirect_uri: str) -> dict[str, Any]:
        config = self.get_config()
        if not config["configured"]:
            raise ValueError("YouTube OAuth Client ID and Secret are not configured.")

        client = self._get_client()
        token_response = client.post(
            TOKEN_ENDPOINT,
            data={
                "client_id": config["client_id"],
                "client_secret": config["client_secret"],
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
        )

        if token_response.status_code != 200:
            error_text = token_response.text
            try:
                error_json = token_response.json()
                error_text = error_json.get("error_description") or error_json.get("error") or error_text
            except Exception:
                pass
            raise ValueError(f"Failed to exchange Google OAuth code: {error_text}")

        token_data = token_response.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)
        expires_at = time.time() + float(expires_in)

        # Retain existing refresh token if Google didn't return a new one
        existing = self.get_auth_data() or {}
        if not refresh_token and existing.get("refresh_token"):
            refresh_token = existing["refresh_token"]

        # Fetch channel information
        channel_info = self._fetch_channel_info(access_token)

        auth_payload = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
            "channel": channel_info,
            "updated_at": time.time(),
        }
        self.save_auth_data(auth_payload)
        return auth_payload

    def _fetch_channel_info(self, access_token: str) -> dict[str, Any]:
        client = self._get_client()
        resp = client.get(
            CHANNELS_ENDPOINT,
            params={"part": "snippet,contentDetails", "mine": "true"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code != 200:
            logger.warning(f"Could not fetch YouTube channel info: {resp.status_code} {resp.text}")
            return {
                "id": "",
                "title": "YouTube Account",
                "handle": "",
                "thumbnail": "",
            }

        data = resp.json()
        items = data.get("items", [])
        if not items:
            return {
                "id": "",
                "title": "Connected Account (No Channel Created)",
                "handle": "",
                "thumbnail": "",
            }

        item = items[0]
        snippet = item.get("snippet", {})
        thumbnails = snippet.get("thumbnails", {})
        thumbnail_url = (
            thumbnails.get("default", {}).get("url")
            or thumbnails.get("medium", {}).get("url")
            or ""
        )
        return {
            "id": item.get("id", ""),
            "title": snippet.get("title", "YouTube Channel"),
            "handle": snippet.get("customUrl", ""),
            "thumbnail": thumbnail_url,
        }

    def get_valid_access_token(self) -> str:
        auth_data = self.get_auth_data()
        if not auth_data:
            raise ValueError("Not connected to YouTube. Please connect your YouTube account first.")

        access_token = auth_data.get("access_token")
        refresh_token = auth_data.get("refresh_token")
        expires_at = auth_data.get("expires_at", 0)

        # If token is valid for at least another 60 seconds, use it
        if access_token and (expires_at - time.time() > 60):
            return access_token

        # Needs refresh
        if not refresh_token:
            if access_token:
                return access_token
            raise ValueError("No refresh token available. Please reconnect your YouTube account.")

        config = self.get_config()
        if not config["configured"]:
            raise ValueError("YouTube OAuth configuration missing. Cannot refresh token.")

        client = self._get_client()
        resp = client.post(
            TOKEN_ENDPOINT,
            data={
                "client_id": config["client_id"],
                "client_secret": config["client_secret"],
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        if resp.status_code != 200:
            raise ValueError(f"Failed to refresh YouTube access token: {resp.text}")

        token_data = resp.json()
        new_access_token = token_data.get("access_token")
        expires_in = token_data.get("expires_in", 3600)
        auth_data["access_token"] = new_access_token
        auth_data["expires_at"] = time.time() + float(expires_in)
        auth_data["updated_at"] = time.time()
        self.save_auth_data(auth_data)
        return new_access_token

    # -------------------------------------------------------------------------
    # Video Upload (Resumable Upload)
    # -------------------------------------------------------------------------
    def upload_video(
        self,
        video_path: Path,
        title: str,
        description: str = "",
        tags: list[str] | None = None,
        privacy_status: str = "private",
        made_for_kids: bool = False,
        category_id: str = "22",
    ) -> dict[str, Any]:
        """Upload video file to YouTube via resumable upload protocol."""
        if not video_path.is_file():
            raise FileNotFoundError(f"Video file not found at {video_path}")

        file_size = video_path.stat().st_size
        if file_size <= 0:
            raise ValueError(f"Video file at {video_path} is empty (0 bytes).")

        access_token = self.get_valid_access_token()
        client = self._get_client()

        # Clean tags
        final_tags = [t.strip() for t in (tags or []) if t.strip()]
        if "#shorts" not in [t.lower() for t in final_tags] and "shorts" not in [t.lower() for t in final_tags]:
            final_tags.append("shorts")

        metadata = {
            "snippet": {
                "title": title[:100],  # YouTube title limit is 100 chars
                "description": description[:5000],  # Description limit is 5000 chars
                "tags": final_tags,
                "categoryId": category_id,
            },
            "status": {
                "privacyStatus": privacy_status.lower(),  # "public", "private", "unlisted"
                "selfDeclaredMadeForKids": bool(made_for_kids),
            },
        }

        # Step 1: Initialize Resumable Upload
        init_headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": str(file_size),
            "X-Upload-Content-Type": "video/mp4",
        }

        init_resp = client.post(
            UPLOAD_INIT_ENDPOINT,
            headers=init_headers,
            content=json.dumps(metadata),
        )

        if init_resp.status_code not in (200, 201):
            error_msg = init_resp.text
            try:
                err_data = init_resp.json()
                error_msg = err_data.get("error", {}).get("message") or error_msg
            except Exception:
                pass
            raise ValueError(f"YouTube upload initialization failed ({init_resp.status_code}): {error_msg}")

        upload_url = init_resp.headers.get("Location")
        if not upload_url:
            raise ValueError("YouTube API did not return an upload Location header.")

        # Step 2: Upload Video File Content
        with open(video_path, "rb") as video_file:
            upload_headers = {
                "Content-Type": "video/mp4",
                "Content-Length": str(file_size),
            }
            # Stream upload using httpx
            upload_resp = client.put(
                upload_url,
                headers=upload_headers,
                content=video_file.read(),  # Read into memory/bytes for upload
            )

        if upload_resp.status_code not in (200, 201):
            error_msg = upload_resp.text
            try:
                err_data = upload_resp.json()
                error_msg = err_data.get("error", {}).get("message") or error_msg
            except Exception:
                pass
            raise ValueError(f"YouTube upload failed ({upload_resp.status_code}): {error_msg}")

        resp_data = upload_resp.json()
        video_id = resp_data.get("id")
        if not video_id:
            raise ValueError("YouTube API response did not contain a video ID.")

        youtube_url = f"https://youtu.be/{video_id}"
        shorts_url = f"https://www.youtube.com/shorts/{video_id}"

        return {
            "success": True,
            "video_id": video_id,
            "youtube_url": youtube_url,
            "shorts_url": shorts_url,
            "title": resp_data.get("snippet", {}).get("title", title),
            "privacy_status": resp_data.get("status", {}).get("privacyStatus", privacy_status),
        }


# Singleton service instance
default_youtube_service = YouTubeService()

