import logging
from pathlib import Path
from typing import Any
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.services.project_manager import get_clips_directory, get_project_directory
from app.services.youtube_uploader import default_youtube_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/youtube", tags=["youtube"])

DEFAULT_CALLBACK_PATH = "/api/youtube/oauth/callback"


class YouTubeConfigPayload(BaseModel):
    client_id: str = Field(..., description="Google OAuth 2.0 Client ID")
    client_secret: str = Field(..., description="Google OAuth 2.0 Client Secret")


class YouTubeJsonConfigPayload(BaseModel):
    raw_json: str = Field(..., description="Raw contents of Google client_secret_*.json")


class YouTubeUploadPayload(BaseModel):
    project_id: str
    clip_id: str
    title: str = Field(..., min_length=1, max_length=100)
    description: str = Field(default="", max_length=5000)
    tags: list[str] = Field(default_factory=lambda: ["shorts", "cliprobin"])
    privacy_status: str = Field(default="private", pattern=r"^(public|private|unlisted)$")
    made_for_kids: bool = False


@router.get("/status")
def get_youtube_status() -> dict[str, Any]:
    """Return YouTube OAuth configuration and connection status."""
    return default_youtube_service.get_status()


@router.post("/config")
def save_youtube_config(payload: YouTubeConfigPayload) -> dict[str, Any]:
    """Save Google OAuth Client ID and Secret."""
    try:
        updated = default_youtube_service.save_config(payload.client_id, payload.client_secret)
        return {
            "success": True,
            "status": default_youtube_service.get_status(),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/config/paste-json")
def save_youtube_json_config(payload: YouTubeJsonConfigPayload) -> dict[str, Any]:
    """Parse and save client credentials from Google Cloud Console JSON."""
    try:
        client_id, client_secret = default_youtube_service.parse_client_secret_json(payload.raw_json)
        default_youtube_service.save_config(client_id, client_secret)
        return {
            "success": True,
            "status": default_youtube_service.get_status(),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/auth-url")
def get_youtube_auth_url(request: Request, redirect_uri: str | None = None) -> dict[str, str]:
    """Generate the Google OAuth2 authorization URL."""
    try:
        if not redirect_uri:
            # Construct standard backend callback URL
            host = request.headers.get("host", "127.0.0.1:8000")
            scheme = request.url.scheme
            redirect_uri = f"{scheme}://{host}{DEFAULT_CALLBACK_PATH}"

        auth_url = default_youtube_service.get_auth_url(redirect_uri=redirect_uri)
        return {"auth_url": auth_url, "redirect_uri": redirect_uri}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Error creating YouTube auth URL")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/oauth/callback", response_class=HTMLResponse)
def youtube_oauth_callback(
    request: Request,
    code: str | None = None,
    error: str | None = None,
    state: str | None = None,
):
    """Handle Google OAuth2 redirect callback."""
    if error:
        return HTMLResponse(
            status_code=400,
            content=f"""
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>YouTube Authorization Error</title>
              <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c0c0e; color: #f43f5e; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
                .card {{ background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 32px; max-width: 440px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }}
                h2 {{ color: #ffffff; margin-top: 0; font-size: 20px; }}
                p {{ color: #a1a1aa; font-size: 14px; line-height: 1.5; }}
                button {{ margin-top: 20px; padding: 10px 20px; border-radius: 8px; border: none; background: #27272a; color: #fff; cursor: pointer; font-weight: 600; }}
              </style>
            </head>
            <body>
              <div class="card">
                <h2>Authorization Failed</h2>
                <p>Google returned an error: <strong>{error}</strong></p>
                <button onclick="window.close()">Close Window</button>
              </div>
            </body>
            </html>
            """,
        )

    if not code:
        return HTMLResponse(
            status_code=400,
            content="""
            <!DOCTYPE html>
            <html>
            <body style="font-family: sans-serif; background: #0c0c0e; color: #fff; text-align: center; padding: 40px;">
              <h2>Missing Authorization Code</h2>
              <p>Google did not provide an authorization code.</p>
              <button onclick="window.close()">Close Window</button>
            </body>
            </html>
            """,
        )

    # Reconstruct the exact redirect_uri that was used
    host = request.headers.get("host", "127.0.0.1:8000")
    scheme = request.url.scheme
    redirect_uri = f"{scheme}://{host}{DEFAULT_CALLBACK_PATH}"

    try:
        auth_data = default_youtube_service.exchange_code(code=code, redirect_uri=redirect_uri)
        channel = auth_data.get("channel") or {}
        channel_title = channel.get("title", "YouTube Channel")

        return HTMLResponse(
            content=f"""
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>YouTube Connected — Clip Robin</title>
              <style>
                body {{
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  background: #09090b;
                  color: #ffffff;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  height: 100vh;
                  margin: 0;
                }}
                .card {{
                  background: #141417;
                  border: 1px solid #27272a;
                  border-radius: 20px;
                  padding: 40px;
                  max-width: 460px;
                  text-align: center;
                  box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7);
                }}
                .icon {{
                  width: 56px;
                  height: 56px;
                  border-radius: 50%;
                  background: rgba(16, 185, 129, 0.15);
                  color: #10b981;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  margin: 0 auto 20px;
                  font-size: 28px;
                }}
                h2 {{ margin: 0 0 8px; font-size: 22px; font-weight: 700; }}
                .channel-name {{ color: #10b981; font-weight: 600; font-size: 16px; margin-bottom: 12px; }}
                p {{ color: #a1a1aa; font-size: 14px; line-height: 1.5; margin: 0 0 24px; }}
                button {{
                  padding: 12px 24px;
                  border-radius: 10px;
                  border: none;
                  background: #10b981;
                  color: #09090b;
                  font-size: 14px;
                  font-weight: 700;
                  cursor: pointer;
                  transition: background 0.15s;
                }}
                button:hover {{ background: #059669; }}
              </style>
              <script>
                // Notify parent window that authentication was successful
                try {{
                  if (window.opener) {{
                    window.opener.postMessage({{ type: 'CLIPROBIN_YOUTUBE_AUTH_SUCCESS' }}, '*');
                  }}
                }} catch (e) {{}}
                // Auto-close after 2.5 seconds
                setTimeout(() => {{
                  try {{ window.close(); }} catch (e) {{}}
                }}, 2500);
              </script>
            </head>
            <body>
              <div class="card">
                <div class="icon">✓</div>
                <h2>Connected to YouTube!</h2>
                <div class="channel-name">{channel_title}</div>
                <p>Your Google account has been linked with YouTube upload permissions. You can now close this tab and return to Clip Robin.</p>
                <button onclick="window.close()">Return to Clip Robin</button>
              </div>
            </body>
            </html>
            """,
        )
    except Exception as e:
        logger.exception("Failed to exchange OAuth code")
        return HTMLResponse(
            status_code=500,
            content=f"""
            <!DOCTYPE html>
            <html>
            <body style="font-family: sans-serif; background: #0c0c0e; color: #fff; text-align: center; padding: 40px;">
              <h2 style="color: #f43f5e;">Authentication Failed</h2>
              <p style="color: #a1a1aa;">{str(e)}</p>
              <button onclick="window.close()" style="margin-top: 20px; padding: 10px 20px;">Close Window</button>
            </body>
            </html>
            """,
        )


@router.post("/disconnect")
def disconnect_youtube() -> dict[str, Any]:
    """Disconnect YouTube account and remove stored tokens."""
    default_youtube_service.clear_auth()
    return {
        "success": True,
        "status": default_youtube_service.get_status(),
    }


@router.post("/upload")
def upload_clip_to_youtube(payload: YouTubeUploadPayload) -> dict[str, Any]:
    """Upload a rendered clip to YouTube as a video or Short."""
    try:
        project_dir = get_project_directory(payload.project_id)
    except (ValueError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="Project not found.")

    clips_dir = get_clips_directory(payload.project_id)
    
    # Try clip_id.mp4 or check if clip_id already has .mp4
    candidate_name = payload.clip_id if payload.clip_id.endswith(".mp4") else f"{payload.clip_id}.mp4"
    clip_path = clips_dir / candidate_name
    
    if not clip_path.is_file():
        # Fallback: check all .mp4 files in clips directory that start with clip_id
        matches = list(clips_dir.glob(f"{payload.clip_id}*.mp4"))
        if matches:
            clip_path = matches[0]
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Clip file '{candidate_name}' not found in project clips directory.",
            )

    try:
        upload_result = default_youtube_service.upload_video(
            video_path=clip_path,
            title=payload.title,
            description=payload.description,
            tags=payload.tags,
            privacy_status=payload.privacy_status,
            made_for_kids=payload.made_for_kids,
        )
        return upload_result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Unexpected error during YouTube upload for clip {payload.clip_id}")
        raise HTTPException(status_code=500, detail=str(e))
