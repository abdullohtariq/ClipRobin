import os
from pathlib import Path


def _load_dotenv_files() -> None:
	"""Load key=value pairs from backend/.env or repo .env without overriding existing env vars."""
	backend_dir = Path(__file__).resolve().parents[1]
	for env_path in (backend_dir / ".env", backend_dir.parent / ".env"):
		if not env_path.is_file():
			continue
		try:
			for raw_line in env_path.read_text(encoding="utf-8").splitlines():
				line = raw_line.strip()
				if not line or line.startswith("#") or "=" not in line:
					continue
				if line.startswith("export "):
					line = line[len("export "):].strip()
				key, value = line.split("=", 1)
				key = key.strip()
				value = value.strip()
				if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
					value = value[1:-1]
				if key:
					os.environ.setdefault(key, value)
		except OSError:
			pass


_load_dotenv_files()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.analysis import router as analysis_router
from app.routes.caption_styles import router as caption_styles_router
from app.routes.clips import router as clips_router
from app.routes.download import router as download_router
from app.routes.health import router as health_router
from app.routes.jobs import router as jobs_router
from app.routes.local_video import router as local_video_router
from app.routes.projects import router as projects_router
from app.routes.transcription import router as transcription_router
from app.routes.watermark import router as watermark_router
from app.routes.youtube import router as youtube_router

import hmac
import os

from fastapi import Request
from fastapi.responses import JSONResponse

app = FastAPI(title="Clip Robin API")

_BASE_ALLOWED_ORIGINS = [
	"http://localhost:3000",
	"http://127.0.0.1:3000",
	"tauri://localhost",
	"http://tauri.localhost",
	"https://tauri.localhost",
]


def _allowed_origins() -> list[str]:
	origins = list(_BASE_ALLOWED_ORIGINS)
	extra = os.environ.get("CLIPROBIN_ALLOWED_ORIGIN", "")
	for item in extra.split(","):
		cleaned = item.strip().rstrip("/")
		if cleaned and cleaned != "*" and cleaned.lower() != "null" and cleaned not in origins:
			origins.append(cleaned)
	return origins


def _allows_query_token(method: str, path: str) -> bool:
	if method != "GET":
		return False
	if path == "/api/watermark/image":
		return True
	return path.startswith("/api/projects/") and "/clips/" in path


@app.middleware("http")
async def enforce_local_api_security(request: Request, call_next):
	path = request.url.path
	method = request.method.upper()
	if path == "/api/youtube/oauth/callback" or (method == "GET" and path in {"/", "/api/health"}):
		return await call_next(request)

	origin = (request.headers.get("origin") or "").strip().rstrip("/")
	if origin and origin not in _allowed_origins():
		return JSONResponse(status_code=403, content={"detail": "Cross-origin request rejected"})

	fetch_site = (request.headers.get("sec-fetch-site") or "").strip().lower()
	if fetch_site == "cross-site":
		return JSONResponse(status_code=403, content={"detail": "Cross-site request rejected"})

	if method != "OPTIONS" and path.startswith("/api/"):
		expected_token = os.environ.get("CLIPROBIN_API_TOKEN", "").strip()
		if expected_token:
			provided_token = (request.headers.get("x-cliprobin-token") or "").strip()
			if not provided_token and _allows_query_token(method, path):
				provided_token = (request.query_params.get("token") or "").strip()
			if not provided_token or not hmac.compare_digest(provided_token, expected_token):
				return JSONResponse(status_code=401, content={"detail": "Unauthorized local API request"})

	return await call_next(request)


app.add_middleware(
	CORSMiddleware,
	allow_origins=_allowed_origins(),
	allow_credentials=True,
	allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
	allow_headers=["Content-Type", "Authorization", "X-ClipRobin-Token"],
)

app.include_router(health_router)
app.include_router(jobs_router)
app.include_router(analysis_router)
app.include_router(caption_styles_router)
app.include_router(clips_router)
app.include_router(download_router)
app.include_router(local_video_router)
app.include_router(projects_router)
app.include_router(transcription_router)
app.include_router(watermark_router)
app.include_router(youtube_router)


@app.get("/")
def root():
	return {
		"app": "Clip Robin",
		"status": "running"
	}
