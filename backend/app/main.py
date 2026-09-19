from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.analysis import router as analysis_router
from app.routes.download import router as download_router
from app.routes.health import router as health_router
from app.routes.local_video import router as local_video_router
from app.routes.transcription import router as transcription_router

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
app.include_router(analysis_router)
app.include_router(download_router)
app.include_router(local_video_router)
app.include_router(transcription_router)


@app.get("/")
def root():
	return {
		"app": "Clip Robin",
		"status": "running"
	}
