from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.health import router as health_router

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


@app.get("/")
def root():
	return {
		"app": "Clip Robin",
		"status": "running"
	}
