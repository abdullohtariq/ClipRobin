# Clip Robin

Clip Robin is an open-source, local-first video clipping application for Windows.

The project is designed to keep media processing on the user's own hardware whenever possible, using paid AI APIs only for optional intelligence tasks such as semantic analysis, clip ranking, and title suggestions. This reduces recurring costs and gives users more privacy and control than an entirely cloud-based workflow.

## Repository Layout

```text
ClipRobin/
|- frontend/   Next.js UI and Tauri desktop application
|- backend/    Python processing services, in development
|- PROJECT_VISION.md
|- Guide.txt
```

## Technology

- Next.js for the user interface
- Tauri for the Windows desktop shell
- Python for planned local AI and video processing
- FFmpeg for local media operations
- Optional paid AI providers for selected intelligence features

## Current Status

Clip Robin is in active early development. The Next.js and Tauri foundation is available, and the Python backend is being established as the local processing layer.

See [PROJECT_VISION.md](PROJECT_VISION.md) for the product goals, architecture, privacy model, cost model, diagrams, and planned work.

## Development

Start the frontend from the `frontend` directory:

```powershell
cd frontend
npm install
npm run dev
```

The Windows desktop development command is:

```powershell
cd frontend
npx.cmd tauri dev
```

The Tauri build requires the Visual Studio C++ build tools and Windows SDK. See the shared VS Code terminal profile in `frontend/.vscode/settings.json` for the configured native build environment.

## License

The project is currently in development. Licensing details will be added before the first public release.
