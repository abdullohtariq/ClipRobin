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

app = FastAPI(title="Clip Robin API")

app.add_middleware(
	CORSMiddleware,
	allow_origins=[
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		"tauri://localhost",
		"http://tauri.localhost",
		"https://tauri.localhost",
	],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
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
