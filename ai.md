# Clip Robin — AI Context, Codebase Audit & Engineering Handbook

> **Clip Robin v0.1.30 engineering handbook.** Section 5 separates current audit findings from the historical changelog. Use the open findings and their acceptance checks when planning fixes or assessing release readiness.
>
> **Do NOT delete or overwrite this file.** Maintain and update this context as the project evolves.

---

## 1. Executive Summary & Core Philosophy

**Clip Robin** is an open-source, local-first Windows desktop application designed to discover, extract, subtitle, and export short-form video clips (for YouTube Shorts, TikTok, and Instagram Reels) from long-form video content.

### Core Architectural Principles
1. **Local by Default**: Media extraction, audio ripping, transcription, active-speaker face tracking, clip slicing, and subtitle/watermark burn-in execute entirely on the user's local machine via FFmpeg, CTranslate2 (`faster-whisper`), OpenCV YuNet ONNX, and Python.
2. **Optional cloud analysis.** The Studio's AI Hook Finder uses Gemini and sends timestamped transcript text with the user's configured key. The direct `/api/analyze` route also has OpenAI and DeepSeek adapters. Media processing runs locally. YouTube link intake contacts YouTube, and a user-initiated YouTube upload sends the selected rendered clip to YouTube. The first Whisper run may need to download model files.
3. **Explicit Desktop Boundaries**: Built as a three-tier hybrid desktop architecture:
   - **Frontend**: Next.js 16 (`16.3.5`, React `19.2.8`, Tailwind CSS v4, TypeScript 5, static export `output: "export"`).
   - **Desktop Shell**: Tauri v2 (`2.12.3` Rust crate & `@tauri-apps/api`, NSIS Windows bundle, dynamic port IPC, signed updater).
   - **Local Backend**: FastAPI (Python 3.12+, Uvicorn, `faster-whisper`, `yt-dlp`, OpenCV YuNet ONNX, `httpx`, FFmpeg 7+/9+).

---

## 2. High-Level Architecture & System Topology

```mermaid
flowchart TD
    subgraph DesktopShell["Tauri Desktop Shell (Rust - Windows)"]
        Tauri["Tauri App (lib.rs)"]
        TauriAutoUpdate["tauri-plugin-updater"]
        TauriPortFinder["Dynamic Port Allocator (TCP 127.0.0.1:0)"]
    end

    subgraph Frontend["Frontend (Next.js 16.3.5 / React 19.2.8)"]
        UI["App Router Pages (/, /projects, /clips, /settings, /subscription)"]
        Providers["QueueProvider & SubscriptionProvider"]
        ClipSettings["Unified ClipSettings, CaptionStylePicker & CustomWatermarkSettings"]
        SocialModals["YouTube / TikTok / Instagram Export Modals"]
        ApiClient["Typed API Client (src/lib/api.ts)"]
        JobPoller["Adaptive Job Progress Widget (job-progress.tsx)"]
        UpdateNotice["Update Notice (update-notice.tsx)"]
    end

    subgraph Backend["Python Backend (FastAPI / Uvicorn)"]
        Main["FastAPI Gateway & .env Loader (app/main.py)"]
        Routes["Local media and project API routers"]
        ProjMgr["Project Manager (services/project_manager.py)"]
        Downloader["Downloader (services/downloader.py via yt-dlp)"]
        Transcriber["Transcriber (services/transcriber.py via faster-whisper)"]
        MockAnalyzer["Mock Analyzer v2 (services/mock_analyzer.py)"]
        AIAnalyzer["AI Analyzer & Dev Mode (ai_analyzer.py & ai_developer_mode.py)"]
        SmartFraming["Smart Framing v5 (services/smart_framing.py via YuNet ONNX)"]
        ClipGen["Clip Generator (services/clip_generator.py)"]
        VideoEditor["Video Editor & ASS Captions (video_editor.py & ass_captions.py)"]
        YouTubeSvc["YouTube Uploader (services/youtube_uploader.py)"]
    end

    subgraph External["External Services & Runtimes"]
        FFmpegProc["FFmpeg & FFprobe Executables"]
        LocalModels["Hugging Face Whisper Cache (%APPDATA%/models)"]
        CloudLLM["Gemini in Studio; Gemini, OpenAI, or DeepSeek via /api/analyze"]
        YouTubeAPI["YouTube CDN & YouTube Data API v3"]
        AccountService["Supabase Auth, Postgres and billing function"]
        PaymentProvider["Lemon Squeezy hosted checkout and signed webhooks"]
    end

    UI --> Providers --> ClipSettings --> ApiClient
    UI --> SocialModals --> ApiClient
    ApiClient -- "HTTP 127.0.0.1:{port}" --> Main
    TauriPortFinder -- "Allocates port & spawns sidecar" --> Main
    ApiClient -- "Tauri IPC (backend_port)" --> Tauri
    Providers -. "Sign-in and verified plan" .-> AccountService
    AccountService -. "Server creates checkout" .-> PaymentProvider
    PaymentProvider -. "Signed subscription events" .-> AccountService
    Main --> Routes
    Routes --> ProjMgr
    Routes --> Downloader --> YouTubeAPI
    Routes --> Transcriber --> LocalModels
    Routes --> MockAnalyzer
    Routes --> AIAnalyzer -. "Opt-in BYOK transcript" .-> CloudLLM
    Routes --> YouTubeSvc -. "OAuth2 Resumable Upload" .-> YouTubeAPI
    Routes --> ClipGen --> SmartFraming
    ClipGen --> VideoEditor --> FFmpegProc
```

---

## 3. Repository File Structure & Module Index

```text
ClipRobin/
├── .github/
│   └── workflows/
│       └── release-tauri.yml          # Automated Windows NSIS signed release pipeline on tag push
├── backend/
│   ├── app/
│   │   ├── routes/
│   │   │   ├── __init__.py
│   │   │   ├── analysis.py            # GET /api/ai/status, POST /api/ai/config, /api/ai/developer-mode, /api/analyze
│   │   │   ├── caption_styles.py      # GET /api/caption-styles (6 styles x 5 animations registry)
│   │   │   ├── clips.py               # Generate clips, poll/cancel jobs, serve MP4s, top-line CRUD, Win32 Save As & ZIP
│   │   │   ├── download.py            # POST /api/download, GET /api/download/{id} (yt-dlp YouTube intake)
│   │   │   ├── health.py              # GET /api/health
│   │   │   ├── jobs.py                # GET /api/jobs/active (Aggregated download, transcription & generation jobs)
│   │   │   ├── local_video.py         # POST /api/local-video/transcribe, /from-path, GET /api/local-video/jobs/{id}
│   │   │   ├── projects.py            # GET /api/projects, PATCH /api/projects/{id}, DELETE /api/projects/{id}
│   │   │   ├── transcription.py       # POST /api/projects/{id}/transcribe (Re-transcribes missing or partial transcripts)
│   │   │   ├── watermark.py           # GET/DELETE /api/watermark, POST /upload, GET /image, POST /settings
│   │   │   └── youtube.py             # /api/youtube/{status,config,auth-url,oauth/callback,disconnect,upload}
│   │   ├── models/                   # Bundled face_detection_yunet_2023mar.onnx
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── ai_analyzer.py         # Gemini, OpenAI, and DeepSeek REST integrations
│   │   │   ├── ai_developer_mode.py   # Atomic local Gemini BYOK key storage & AI Developer Mode toggle
│   │   │   ├── ass_captions.py        # ASS subtitle compiler, 2-word chunks, karaoke & hardlinked font staging
│   │   │   ├── caption_styles.py      # 6 Styles x 5 Animations registry, aliases & script-aware font resolver
│   │   │   ├── clip_generator.py      # Incremental analysis cache, language forwarding & progressive MP4 rendering
│   │   │   ├── downloader.py          # Cancellable yt-dlp wrapper with FFmpeg path injection & Win32 window hiding
│   │   │   ├── mock_analyzer.py       # Deterministic duration-based transcript chunker (analyzer_version: 2)
│   │   │   ├── process_utils.py       # Win32 CREATE_NO_WINDOW & STARTF_USESHOWWINDOW subprocess helper
│   │   │   ├── project_manager.py     # Single directory scan for sequential IDs, metadata & clips paths
│   │   │   ├── smart_framing.py       # True 9:16 active-speaker director (YuNet ONNX + VAD + dual tracked/static cache)
│   │   │   ├── transcriber.py         # faster-whisper CTranslate2 transcription with bounded WAV & cancellation
│   │   │   ├── video_editor.py        # FFmpeg filtergraph builder, cached corner masks, custom watermark & opacity
│   │   │   └── youtube_uploader.py    # Google OAuth2 client, token refresh lock & chunked resumable Shorts uploader
│   │   ├── __init__.py
│   │   └── main.py                    # FastAPI app, zero-dependency .env loader, CORS & router mounting
│   ├── assets/
│   │   ├── caption_preview/           # Fixed word-timing fixture for deterministic preview renders
│   │   └── fonts/                     # Bundled OFL fonts (Montserrat, Anton, Poppins, Noto Sans, Arabic, Devanagari)
│   ├── bin/                           # Optional bundled ffmpeg.exe & ffprobe.exe binaries (gitignored)
│   ├── scripts/
│   │   └── build_caption_previews.py  # Build-time 360x640 moving preview MP4, poster JPG & manifest generator
│   ├── tests/                         # 161 tests passed across 22 test_*.py files in the v0.1.29 audit
│   │   ├── __init__.py
│   │   ├── test_ai_analyzer.py
│   │   ├── test_ass_captions.py
│   │   ├── test_audit_regressions.py  # v0.1.28 & v0.1.29 security, caching, O(N) smoothing, partial transcript & framing tests
│   │   ├── test_caption_previews.py
│   │   ├── test_caption_styles.py
│   │   ├── test_clip_counter.py
│   │   ├── test_clip_generator.py
│   │   ├── test_mock_analyzer.py
│   │   ├── test_process_utils.py
│   │   ├── test_project_manager.py
│   │   ├── test_routes_analysis.py
│   │   ├── test_routes_clips.py
│   │   ├── test_routes_download.py
│   │   ├── test_routes_health.py
│   │   ├── test_routes_jobs.py
│   │   ├── test_routes_local_video.py
│   │   ├── test_routes_projects.py
│   │   ├── test_routes_watermark.py
│   │   ├── test_routes_webhooks.py
│   │   ├── test_smart_framing.py
│   │   ├── test_transcriber_shim.py
│   │   └── test_youtube.py
│   ├── data/
│   │   └── projects/                  # Default development project storage root (sibling to runtime configs)
│   ├── .env.example                   # Template for AI provider keys, Whisper overrides & YouTube credentials
│   ├── icon.ico                       # Windows application icon for PyInstaller windowed sidecar
│   ├── requirements.txt               # References ../requirements/backend.txt
│   └── run.py                         # Uvicorn / PyInstaller bootstrapper reading CLIPROBIN_API_PORT
├── docs/
│   └── reports/                       # Historical engineering audit reports (playback, responsive-ui, settings-mismatch)
├── frontend/
│   ├── app/
│   │   ├── clips/
│   │   │   ├── loading.tsx            # Clips Studio route skeleton boundary
│   │   │   └── page.tsx               # Clips Studio player grid, modal viewer, top-line editor, social export & ZIP
│   │   ├── projects/
│   │   │   ├── loading.tsx            # Projects route skeleton boundary
│   │   │   └── page.tsx               # Project library, inline rename, regenerate panel, face-tracking toggle
│   │   ├── settings/page.tsx          # Persisted preferences, Gemini AI Developer Mode, YouTube OAuth, custom watermark
│   │   ├── subscription/page.tsx      # Account sign-in, Free/Pro plan, and hosted billing
│   │   ├── favicon.ico
│   │   ├── globals.css                # Tailwind v4 @theme tokens, scrollbars & reduced-motion utilities
│   │   ├── job-progress.tsx           # Visibility-aware adaptive active job status widget
│   │   ├── layout.tsx                 # Root layout, SubscriptionProvider, QueueProvider, responsive sidebar
│   │   ├── page.tsx                   # Dashboard (Upload / YouTube intake, queue workflow, live 9:16 preview)
│   │   ├── sidebar-nav.tsx            # Responsive 3-tier navigation + subscription badge
│   │   ├── update-notice.tsx          # Tauri signed auto-update notification banner
│   │   └── window-init.tsx            # Tauri startup window maximization helper
│   ├── public/
│   │   ├── caption-previews/          # Pre-rendered 360x640 MP4 moving previews, JPG posters & manifest.json
│   │   ├── logo-mark.svg              # Brand bird logo mark
│   │   └── watermark.png              # Default fallback watermark asset
│   ├── scripts/
│   │   ├── __tests__/
│   │   │   ├── project-name-utils.test.mjs # Project name validation & duplicate-check unit tests (4 tests)
│   │   │   └── version-scripts.test.mjs    # Manifest version synchronization unit tests (2 tests)
│   │   ├── check-version.mjs          # Verifies package.json, Cargo.toml & tauri.conf.json match (0.1.30)
│   │   ├── set-version.mjs            # Updates version across all 3 manifests simultaneously
│   │   └── take_screenshots.mjs       # Playwright visual snapshot utility
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                    # Shared primitives (badge, checkbox, icon-button, option-card, segmented-control, status-pill, toggle-row, tooltip)
│   │   │   ├── caption-style-picker.tsx     # Single-video responsive 2-pane modal picker with Pro gating
│   │   │   ├── clip-settings.tsx            # Unified clip settings (mode, duration, count, framing, face tracking, captions, watermark)
│   │   │   ├── custom-watermark-settings.tsx# Custom PNG/JPG/WebP brand logo uploader, position & opacity sync
│   │   │   ├── instagram-upload-modal.tsx   # Guided Instagram Reels export & caption copy modal
│   │   │   ├── live-moving-captions.tsx     # Visibility & reduced-motion aware live 9:16 caption preview
│   │   │   ├── paddle-sandbox-modal.tsx     # Sandbox checkout / webhook simulator for local development
│   │   │   ├── skeletons.tsx                # Shimmer loading skeletons across Dashboard, Projects & Clips
│   │   │   ├── subscription-badge.tsx       # Sidebar plan pill & upgrade trigger
│   │   │   ├── tiktok-upload-modal.tsx      # Guided TikTok export & caption copy modal
│   │   │   ├── upgrade-modal.tsx            # Link from gated features to Account & Plans
│   │   │   ├── video-queue-view.tsx         # Multi-video batch queue view with live progress & cancellation
│   │   │   └── youtube-upload-modal.tsx     # Direct YouTube Shorts OAuth2 resumable upload modal
│   │   ├── hooks/
│   │   │   └── use-ai-developer-status.ts   # Event-driven & visibility-aware AI Developer Mode status hook
│   │   └── lib/
│   │       ├── api.ts                       # Typed HTTP client, Tauri port discovery, AbortSignal & custom events
│   │       ├── account.ts                   # Supabase client and authenticated billing requests
│   │       ├── project-name-utils.ts        # Stateless filename-safe project rename validator
│   │       ├── queue-context.tsx            # Multi-video processing queue with AbortController & backend job cancel
│   │       └── subscription-context.tsx     # Auth state, verified plan refresh & UI feature gates
│   ├── src-tauri/
│   │   ├── capabilities/default.json  # Tauri v2 permissions for updater, process & core windowing
│   │   ├── nsis/installer-hooks.nsh   # Windows NSIS installer lifecycle hooks
│   │   ├── src/
│   │   │   ├── lib.rs                 # Ephemeral port binding, cliprobin-api sidecar spawn & cleanup
│   │   │   └── main.rs                # Desktop entry point
│   │   ├── Cargo.toml                 # Rust crate manifest (v0.1.30)
│   │   └── tauri.conf.json            # Tauri bundle & updater configuration (v0.1.30)
│   ├── package.json                   # Frontend manifest (v0.1.30)
│   ├── tsconfig.json
│   └── next.config.ts                 # Static export configuration (`output: "export"`)
├── requirements/
│   └── backend.txt                    # Pinned Python dependencies
├── clip_robin_watermark.png           # High-resolution brand watermark asset
├── watermark.png                      # Root default watermark image
├── .gitignore
├── ai.md                              # This engineering handbook
├── README.md                          # Product overview, setup & release workflow
├── website.md                         # Marketing & landing page blueprint
└── setup.ps1                          # One-command Windows development bootstrap script
```

---

## 4. API Surface, Environment Variables & On-Disk Data Contract

### 4.1 Complete Backend HTTP API Reference

| Method & Path | Module | Purpose |
| :--- | :--- | :--- |
| `GET /` | `app.main` | Root service status (`{"app": "Clip Robin", "status": "running"}`). |
| `GET /api/health` | `routes.health` | Liveness probe (`{"status": "healthy"}`). |
| `GET /api/caption-styles` | `routes.caption_styles` | Lists all 6 caption styles, allowed animations, colors, and defaults. |
| `GET /api/jobs/active` | `routes.jobs` | Aggregated active download, transcription, and clip generation jobs. |
| `POST /api/download` | `routes.download` | Starts background `yt-dlp` YouTube video download (`202` queued). |
| `GET /api/download/{project_id}` | `routes.download` | Polls YouTube download progress, title, and status. |
| `POST /api/local-video/transcribe` | `routes.local_video` | Uploads local media file (`multipart/form-data`), creates project, queues Whisper. |
| `POST /api/local-video/from-path` | `routes.local_video` | Creates project from local disk path (hardlink/copy) and queues Whisper. |
| `GET /api/local-video/jobs/{project_id}` | `routes.local_video` | Polls transcription job progress and status. |
| `POST /api/projects/{id}/transcribe` | `routes.transcription` | Queues full transcription if missing or if existing transcript has `is_complete: false`. |
| `GET /api/projects` | `routes.projects` | Lists all projects with `title`, `source_type`, `clips`, `created_at`, and `status`. |
| `PATCH /api/projects/{id}` | `routes.projects` | Atomically updates project `title` inside `metadata.json` while preserving other fields. |
| `DELETE /api/projects/{id}` | `routes.projects` | Cancels active download/transcription/generation jobs and deletes project folder (`204`). |
| `POST /api/projects/{id}/generate-clips` | `routes.clips` | Starts progressive background clip rendering (`12, 15, 30, 60, 90`s; framing; style; face tracking). |
| `GET /api/projects/{id}/generation-jobs` | `routes.clips` | Returns latest generation job ordered chronologically (`created_seq`, `created_at`). |
| `GET /api/projects/{id}/generation-jobs/{job_id}` | `routes.clips` | Polls specific generation job status and progressive `ready_clips`. |
| `POST /api/projects/{id}/generation-jobs/{job_id}/cancel` | `routes.clips` | Signals cancellation. The current cleanup can delete previously rendered MP4s. See [regeneration safety](#p0-regeneration-can-delete-or-mix-existing-exports). |
| `GET /api/projects/{id}/clips` | `routes.clips` | Lists rendered clips, `generation_options` (incl. `face_tracking`), and `source_duration`. |
| `GET /api/projects/{id}/clips/{filename}` | `routes.clips` | Streams rendered MP4 clip (`video/mp4`). |
| `POST /api/projects/{id}/clips/{clip_id}/top-line` | `routes.clips` | Burns or updates a custom <=15-word top-line hook on a single clip. |
| `DELETE /api/projects/{id}/clips/{clip_id}/top-line` | `routes.clips` | Removes top-line hook and re-renders the single clip cleanly. |
| `POST /api/projects/{id}/clips/{clip_id}/save-dialog` | `routes.clips` | Opens native Win32 `GetSaveFileNameW` Save As dialog and exports MP4. |
| `GET /api/projects/{id}/clips/download-all` | `routes.clips` | Streams a ZIP archive containing all rendered clips in the project. |
| `POST /api/projects/{id}/clips/download-all-dialog` | `routes.clips` | Opens native Save As dialog and writes ZIP archive directly to disk. |
| `GET /api/ai/status` | `routes.analysis` | Returns Gemini key configuration, YouTube auth status, and `ai_enabled` state. |
| `POST /api/ai/config` | `routes.analysis` | Validates and atomically persists local Gemini API key (`gemini_config.json`). |
| `POST /api/ai/developer-mode` | `routes.analysis` | Enables or disables AI Developer Mode (`ai_enabled`). |
| `POST /api/analyze` | `routes.analysis` | Evaluates a transcript with Gemini, OpenAI, or DeepSeek and optionally saves `analysis.json`. |
| `GET /api/watermark` | `routes.watermark` | Returns custom/default watermark availability, cache-busted `custom_url`, `position`, `opacity`. |
| `POST /api/watermark/settings` | `routes.watermark` | Persists watermark `position` (`top_right`, `top_left`, `bottom_right`, `bottom_left`, `center`) and `opacity` (`20–100`). |
| `POST /api/watermark/upload` | `routes.watermark` | Validates PNG/JPG/WebP magic bytes (<=10 MB) and saves custom brand logo. |
| `GET /api/watermark/image` | `routes.watermark` | Serves the active custom watermark image with `Cache-Control: no-cache`. |
| `DELETE /api/watermark` | `routes.watermark` | Deletes the custom watermark image and reverts to default watermark. |
| `GET /api/youtube/status` | `routes.youtube` | Returns Google OAuth client configuration and connected YouTube channel info. |
| `POST /api/youtube/config` | `routes.youtube` | Saves Google OAuth `client_id` and `client_secret`. |
| `POST /api/youtube/config/paste-json` | `routes.youtube` | Extracts credentials from pasted Google Cloud `client_secret_*.json`. |
| `GET /api/youtube/auth-url` | `routes.youtube` | Generates CSRF-state-protected Google OAuth2 consent URL. |
| `GET /api/youtube/oauth/callback` | `routes.youtube` | HTML-escaped OAuth2 callback page exchanging `code` for offline tokens. |
| `POST /api/youtube/disconnect` | `routes.youtube` | Clears stored YouTube OAuth tokens (`youtube_auth.json`). |
| `POST /api/youtube/upload` | `routes.youtube` | Streams rendered clip in 256 KB chunks to YouTube Data API v3 resumable upload. |

Accounts and subscriptions use the hosted `cliprobin-billing` function. Signed-in clients can read their plan, create a hosted checkout, or request a customer portal link. Lemon Squeezy sends signed lifecycle events to the function's `/webhook` endpoint. See the [database and billing setup](supabase/README.md) for the schema and deployment steps.

### 4.2 Environment Variables

`backend/app/main.py` automatically loads `backend/.env` and root `.env` at startup using `os.environ.setdefault(...)`:

| Variable | Layer | Description |
| :--- | :--- | :--- |
| `CLIPROBIN_API_PORT` | Backend / Tauri | Loopback port bound by Uvicorn (`8000` in dev, dynamic `127.0.0.1:0` in Tauri). |
| `CLIPROBIN_PROJECTS_DIR` | Backend / Tauri | Root directory for projects (`backend/data/projects` in dev, `%APPDATA%/com.cliprobin.desktop/projects` in desktop). Gemini, YouTube, and watermark settings resolve under its parent directory. |
| `CLIPROBIN_FFMPEG_PATH` | Backend | Explicit override path to `ffmpeg` executable. |
| `CLIPROBIN_WATERMARK_PATH` | Backend | Explicit override path to fallback watermark image. |
| `WHISPER_MODEL` | Backend | `faster-whisper` model name or path. The code defaults to `tiny`. |
| `WHISPER_COMPUTE_TYPE` | Backend | CTranslate2 compute precision override (default `int8` on CPU). |
| `AI_PROVIDER` | Backend | Default provider for direct analysis when the caller leaves it unspecified. Studio generation explicitly selects Gemini. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Backend | Gemini key and optional primary model override. The source defaults to `gemini-3.5-flash-lite` and builds a candidate list with `gemini-3.8-flash` and `gemini-3.1-flash-lite`. `backend/.env.example` explicitly sets `gemini-3.8-flash`. Fallback depends on the failure type. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Backend | OpenAI API key and model override. |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | Backend | DeepSeek API key and model override. |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | Backend | Optional env fallback for Google OAuth2 YouTube uploader credentials. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Frontend | Project URL and public key for account sign-in and billing requests. |
| `NEXT_PUBLIC_CLIPROBIN_ACCOUNT_URL` | Frontend | Optional hosted Account & Plans URL for email confirmation and desktop password recovery. |
| `NEXT_PUBLIC_CLIPROBIN_GITHUB_AUTH` / `NEXT_PUBLIC_CLIPROBIN_GOOGLE_AUTH` | Frontend | Set to `1` after configuring the corresponding browser OAuth provider. |

The web client uses `http://127.0.0.1:8000` for the media API. Tauri obtains its sidecar port through `backend_port`. Billing secrets stay in the hosted function, which defaults to test mode.

### 4.3 On-Disk Data Contract

All runtime data resolves relative to `$DATA_ROOT = Path(CLIPROBIN_PROJECTS_DIR).parent` (`backend/data` in dev, `%APPDATA%/com.cliprobin.desktop` in packaged desktop builds so PyInstaller `_MEIPASS` temp cleanup never loses user credentials or custom watermarks):

```text
$DATA_ROOT/
├── gemini_config.json              # Local Gemini API key & developer_mode boolean (atomic write)
├── youtube_config.json             # Google OAuth2 client_id & client_secret
├── youtube_auth.json               # YouTube access_token, refresh_token & channel profile
├── watermarks/
│   ├── custom_watermark.{png|jpg|webp} # Validated custom brand watermark asset
│   └── watermark_settings.json     # Persisted {"position": "...", "opacity": 20..100}
└── projects/
    └── project_001/
        ├── metadata.json           # {"title": "...", "source_type": "YouTube|Local Video", "duration": 184.2, "url": "..."}
        ├── source.mp4              # Primary media (.mp4, .mov, .mkv, .webm, .avi)
        ├── analysis.json           # analyzer_version: 2, clip candidates, per-clip overrides & generation_options
        ├── tracking_analysis.json  # v5 YuNet + VAD cache with both shots_tracked & shots_static + scanned_duration
        ├── transcription/
        │   ├── transcript.txt      # Plain-text timestamped transcript
        │   └── transcript.json     # Segments + word timestamps + language + is_complete + covered_duration
        └── clips/
            ├── clip_001.mp4        # Final vertical 720x1280 H.264 + AAC rendered clip
            └── ...
```

### JSON Schemas

#### 1. `transcription/transcript.json`
```json
{
  "language": "en",
  "language_probability": 0.985,
  "is_complete": true,
  "covered_duration": 184.2,
  "segments": [
    {
      "start": 0.0,
      "end": 4.12,
      "text": "Here is an interesting fact about programming.",
      "words": [
        { "start": 0.0, "end": 0.35, "text": "Here" },
        { "start": 0.36, "end": 0.52, "text": "is" }
      ]
    }
  ]
}
```

#### 2. `analysis.json`
```json
{
  "analyzer_version": 2,
  "clips": [
    {
      "id": "clip_001",
      "title": "The Golden Rule of Debugging",
      "start": 12.4,
      "end": 42.8,
      "score": 92,
      "reason": "Clear problem statement followed by a surprising solution.",
      "top_line": "",
      "framing_mode": "true_9_16",
      "caption_style": "robin",
      "caption_animation": "grow",
      "face_tracking": true
    }
  ],
  "generation_options": {
    "show_subtitles": true,
    "show_watermark": false,
    "framing_mode": "true_9_16",
    "caption_style": "robin",
    "caption_animation": "grow",
    "clip_duration_seconds": 30,
    "clip_count": 3,
    "generation_mode": "random",
    "face_tracking": true
  }
}
```

---

## 5. Codebase Bugs, Vulnerabilities & Implementation Status

### Open findings and implementation plan

The November 10, 2026 audit covered the v0.1.29 checkout. Findings remain open unless an implementation update is recorded. **Reproduced** means the audit observed the behavior in the browser or exercised the relevant production code with disposable test data. **Source review** means the behavior or risk was identified from code and still needs a targeted reproduction. The controlled tests injected outcomes or detections where noted. They did not use production accounts, customer projects, or private footage.

#### P0 Regeneration can delete or mix existing exports

- **Reproduced.** With previously exported clips present, the real generation job worker was canceled during a controlled render. The renderer attempted to restore the previous files. The route's cancellation cleanup then removed the MP4s from the project's clip directory, leaving no previously exported clips. In separate forced render failures, a new clip replaced part of the old generation, and the clip list could show newly requested settings against an older file.
- **Cause.** `analysis.json` is written before rendering finishes. Individual files are published into the live clip directory as they finish. The renderer's rollback and the route's cleanup both operate on that directory. Studio and ZIP export read the same live files and metadata.
- **Work needed.** Give each generation a staging area owned by its job. Stage files and matching metadata together, then publish a complete generation with one recoverable commit step. If progressive preview stays, identify staged clips separately from committed exports. Scope cancel, failure, and startup recovery to job-owned files. Serialize publication and single-clip edits for the same project. Preserve user-authored top lines and use the committed generation for MP4, ZIP, and playback.
- **Acceptance.** Start with two playable clips and saved settings. Cancel before the first render, cancel during the second, fail the second, and interrupt the app before commit. Reopen each time and verify the old file hashes, settings, clip count, playback, and ZIP contents. A successful regeneration replaces the set and updates playback URLs together. Run through the route worker to include its cleanup.
- **Code.** [Renderer and rollback](backend/app/services/clip_generator.py) · [Generation routes and clip list](backend/app/routes/clips.py) · [Existing renderer tests](backend/tests/test_clip_generator.py)

#### P0 Provider-controlled clip IDs can escape the output directory

- **Reproduced with a stubbed renderer.** An AI response supplied a relative-path clip ID. The actual analyzer validator accepted it, and the real output path and replacement logic overwrote a disposable MP4 outside the project's clips directory. The impact is bounded by the file type and the local process's permissions.
- **Cause.** Analysis fills in a missing ID but retains a supplied one. Generation uses that value in staging and final filenames, and the renderer creates the requested parent directory. Validation in clip-serving endpoints does not protect this producer path.
- **Work needed.** Allocate unique, filesystem-safe clip IDs locally and keep provider identifiers separate from file paths. Validate output containment for both staging and final paths before file creation or replacement. Treat cached analyses as untrusted input too. Preserve existing safe IDs where needed to retain top lines and existing links. Migrate or reject invalid legacy values without touching files outside the project.
- **Acceptance.** Exercise generation with traversal, Windows and POSIX separators, drive-qualified and UNC paths, duplicate IDs, and a cached malformed analysis. Verify sentinel files outside the project are byte-for-byte unchanged. Verify existing safe clips still render, play, export, and retain their top lines.
- **Code.** [AI response validation](backend/app/services/ai_analyzer.py) · [Clip path construction](backend/app/services/clip_generator.py) · [Renderer](backend/app/services/video_editor.py)

#### P1 Face Tracking Off still moves the crop

- **Reproduced with controlled detections.** With `face_tracking=false`, the pipeline still invoked the face scanner and produced two horizontal crop positions. `_build_shots()` can switch subjects and ease between positions. The UI calls this a static or fixed-center crop. The Dashboard preview uses a centered CSS crop for both switch positions and can still say tracking is enabled when the summary reads `9:16 Static`.
- **Framing risk.** The split-screen clamp uses detected faces on opposite halves as a proxy for a divider. A controlled ordinary two-person shot with faces near the middle caused the crop to cut into the chosen face. A missing detector or no usable detections can fall back to center while the UI still displays the requested tracking mode. Low-resolution faces, side profiles, occlusion, overlapping speech, and B-roll need real-footage validation. The current speech and mouth-motion heuristic is approximate. Source review also found that the tracking cache keys on media properties without a transcript revision, even though speaker selection depends on transcript timing.
- **Current workaround.** Choose **16:9 Letterbox** to preserve the source framing within a vertical canvas.
- **Work needed.** Default new full-bleed projects to **Locked Crop**, with an adjustable horizontal anchor and no face scan. Offer **Follow Speaker** explicitly. If a separate **Speaker Cuts** mode is added, keep the crop stationary between cuts. The existing Off behavior can be labeled **Less Motion** until true locking is available. Store per-project settings and per-clip overrides separately from the new-project default. Preserve old projects' effective behavior during migration. Add a short preview derived from the renderer's crop decisions, report requested versus applied mode and fallback reason, and expose a single-clip reframe action. Detect a real divider or explicit split layout before clamping by halves. Key tracking results by source, transcript revision, and relevant framing inputs.
- **Acceptance.** Assert that Locked Crop never invokes the detector and holds the same coordinates across the export. Compare preview coordinates with the rendered result. Use real footage of one stationary and one moving speaker, two people sharing a camera, a 50/50 video call, interruptions, profiles and occlusion, slides or B-roll, and portrait input. Check face containment, cut frequency, fallback labels, and whether reframing one clip leaves other clips intact. Existing helper tests cover crop logic but provide limited evidence about rendered footage.
- **Code.** [Framing and crop cache](backend/app/services/smart_framing.py) · [Dashboard](frontend/app/page.tsx) · [Projects](frontend/app/projects/page.tsx) · [Studio](frontend/app/clips/page.tsx) · [Current framing tests](backend/tests/test_smart_framing.py)

#### P1 AI fallback is reported and cached as successful AI analysis

- **Reproduced with a simulated provider failure.** AI Hook Finder completed with deterministic interval clips. The saved generation mode remained `ai`, so a retry with the same options reused those results without calling the provider again. The Studio generation route uses Gemini. OpenAI and DeepSeek are adapters for direct analysis.
- **Work needed.** Store requested and applied modes separately, along with provider and model for actual AI results. Expose a bounded, user-readable failure reason and a retry action that bypasses interval results. Decide which transient failures can try another model. Surface invalid credentials and invalid models directly. Apply the Developer Mode gate after provider resolution wherever Gemini requires it. Tell the user before enabling cloud analysis that timestamped transcript text is sent to the configured provider. Keep keys and transcript content out of diagnostic logs.
- **Acceptance.** Exercise a bad key, missing model, timeout, rate limit, malformed response, and successful retry. Verify that interval fallback is labeled correctly in job state, clip cards, and saved metadata, and that a corrected key triggers a real provider attempt. Verify offline interval generation makes no provider request.
- **Code.** [Analysis and cache](backend/app/services/clip_generator.py) · [Provider requests and retries](backend/app/services/ai_analyzer.py) · [Direct analysis route](backend/app/routes/analysis.py)

#### P1 Verified billing requires hosted setup and sandbox testing

- **Original reproduction.** A deliberately invalid key activated Pro and showed “License key verified.” Checkout fallback also granted Pro locally, and the local webhook could update a shared record. These paths were removed from the implementation.
- **Implementation update.** Supabase Auth identifies the customer. A server-owned subscription record determines Pro access. Lemon Squeezy checkout is tied to that account, and the hosted webhook verifies the signature, fetches current provider state, and ignores stale database updates. A browser redirect alone cannot grant Pro. The current implementation covers one recurring variant.
- **Still needed.** Provision the user's hosted project and merchant test store, configure Auth and SMTP or browser OAuth, and verify checkout and cancellation in sandbox. Verify a second account remains on Free, repeated events are harmless, and expired, paused, and past-due subscriptions downgrade. Reconcile any earlier real purchases from verified payment records. Live merchant activation remains separate from sandbox.
- **Code.** [Subscription context](frontend/src/lib/subscription-context.tsx) · [Plans page](frontend/app/subscription/page.tsx) · [Billing function](supabase/functions/cliprobin-billing/index.ts) · [Setup and acceptance](supabase/README.md)

#### P1 Queue recovery, silent sources, and project ownership are incomplete

- **Observed.** A fresh 27-second synthetic video took over 90 seconds to finish transcription in the audit environment. The run completed, but the queue spent a long time showing a single progress stage. The checked-in workflow also depends on successful transcription before slicing. A direct decoder check of the silent local fixture failed; the FFmpeg `-an` rendering path only covers rendering once clip ranges exist.
- **Source review.** The queue lacks a Retry action and does not reliably recover active entries after a refresh or restart. Dashboard cancellation can delete a project created by the queue and show it as failed. Project IDs are allocated from the largest existing numeric suffix and can be reused after deletion. A delayed worker may then act on the reused path or job ID.
- **Work needed.** Persist recoverable job state and reconcile it with backend jobs at startup. Keep Cancelled separate from Failed, and allow explicit retries with clear instructions when the original file must be reselected. Protect saved projects during queue cancellation. Give projects non-reused identities and scope cleanup to the job that owns the files. Probe audio at intake. Support time-only slicing without captions for media without speech, or give a clear preflight error. Report model loading, audio extraction, and transcription separately, and measure timing on representative hardware before changing defaults.
- **Acceptance.** Refresh and restart during upload, transcription, and generation. Retry one failed item without disturbing the next. Delete the newest project, start a new one, and verify late cleanup cannot affect it. Try no audio stream, an audio stream with silence, ordinary speech, and a first run with a missing model cache. Confirm that cancellation and recovery preserve completed exports.
- **Code.** [Queue state and cancellation](frontend/src/lib/queue-context.tsx) · [Queue UI](frontend/src/components/video-queue-view.tsx) · [Project IDs](backend/app/services/project_manager.py) · [Download worker](backend/app/routes/download.py) · [Transcription](backend/app/services/transcriber.py)

#### P1 Local API and release security need dedicated review

- **Source review.** The loopback API relies on CORS and has no per-session authentication. CORS alone does not authorize state changes, and the Tauri webview CSP is disabled. The sidecar reads and writes local files and stores provider and OAuth credentials. Watermark upload checks size and file signatures, with no full image decode before replacement. These are separate from the reproduced AI ID issue.
- **Work needed.** Keep the sidecar loopback-only. Define the trust boundary for browser development and the packaged app, then protect sensitive reads and mutations with a scoped sidecar session and explicit origin handling. Add a restrictive desktop CSP and allow only required external connections. Move secrets to OS-backed storage where practical. Decode images and bound dimensions before replacing a valid watermark. Define how updates defer or recover in-flight jobs.
- **Acceptance.** Confirm that an unrelated page cannot read sensitive state or trigger a state change, approved UI operations still work in web and packaged modes, malformed and oversized images leave the previous watermark intact, and updates preserve or recover active work. Use synthetic files and credentials for the security tests.
- **Code.** [FastAPI configuration](backend/app/main.py) · [Tauri configuration](frontend/src-tauri/tauri.conf.json) · [Watermark upload](backend/app/routes/watermark.py) · [Updater UI](frontend/app/update-notice.tsx)

#### P2 Export, Settings, and social actions overstate current capabilities

- **Reproduced.** An MP4 rendered and played at **720×1280, 30 fps**. The clip settings say `1080×1920`, and the plan comparison advertises higher output quality, including `4K 60FPS Ultra` for Pro. Source review found that project directory, auto-open, output container, aspect ratio, and quality preferences are saved but do not drive the corresponding workflow. The advertised caption color and size controls are absent from the render contract. Caption presets, supported animations, and watermark settings are separate features.
- **Source review.** TikTok and Instagram are guided save-and-upload flows. Their developer fields retain unused credentials in browser storage. Some save and copy failures are only logged or otherwise give little feedback. Website copy should reflect the Free plan's required watermark.
- **Work needed.** Display the actual output dimensions, format, and frame rate. Remove or disable unsupported settings and plan claims until they affect the renderer. Label the social actions **Prepare for TikTok** and **Prepare for Instagram**, remove unused credential fields, and surface export and clipboard errors. Keep the existing YouTube flow distinct and validate it with a test account.
- **Acceptance.** Compare the UI and actual file metadata for each supported mode and plan. Where a setting remains visible, change it, restart, and demonstrate its effect. Exercise successful and canceled Save As, unwritable paths, failed clipboard copy, and guided social handoff without credential prompts.
- **Code.** [Renderer](backend/app/services/video_editor.py) · [Settings](frontend/app/settings/page.tsx) · [Clip settings](frontend/src/components/clip-settings.tsx) · [Plan copy](frontend/src/lib/subscription-context.tsx) · [TikTok](frontend/src/components/tiktok-upload-modal.tsx) · [Instagram](frontend/src/components/instagram-upload-modal.tsx)

#### P2 GUI controls, state, and accessibility

| Finding and evidence | Work needed | Acceptance |
| --- | --- | --- |
| **Reproduced.** Local source **Change** opens no chooser after selection. The input is mounted only before a source is selected. | Keep the input mounted and give the upload target a keyboard-accessible control. | Replace an existing source with a mouse and keyboard. Canceling the picker keeps the selected file and settings. |
| **Source review.** Switching Studio projects can display stale clip cards or settings while actions already use the new project ID. Late async responses can write old results into the new view. | Reset or key the view by project ID, ignore stale responses, and disable actions until the displayed data belongs to that project. | Delay the second project's response, switch during a running job, and verify playback, export, and editing target the clip actually displayed. |
| **Source review.** Caption picker intercepts arrows globally, and custom dialogs lack complete focus handling. Some switches lack accessible names. | Scope shortcuts to the focused group, move focus with selection, and use consistent dialog focus entry, containment, Escape, and return. Name every switch. | Complete file selection, caption selection, playback, and modal dismissal by keyboard. Check screen-reader labels and reduced motion. |
| **Reproduced.** A Fast Interval result showed `8.5/10` and “Mock analysis.” At desktop width the clip title truncated to “Here...” and the duration badge overlapped the watermark. | Show the applied selection method and time range for interval clips. Give the title its own line and place player overlays outside the branded area. | Verify the card and preview at narrow and desktop widths with long titles, different watermark positions, and both AI and interval clips. |
| **Source review.** “Local Engine Ready” is hardcoded in the sidebar and Dashboard. | Drive it from the health check and surface connecting, unavailable, and retry states. | Start the frontend with the sidecar stopped, start the sidecar later, then stop it again while the app is open. |

- **Code.** [Dashboard](frontend/app/page.tsx) · [Studio](frontend/app/clips/page.tsx) · [Caption picker](frontend/src/components/caption-style-picker.tsx) · [Settings](frontend/app/settings/page.tsx) · [App layout](frontend/app/layout.tsx)

#### Release order and verification

1. **Protect existing media.** Close both P0 issues first. Include their route-level regressions in CI before signing or publishing a release.
2. **Make framing predictable.** Add true Locked Crop, fix the split-screen assumption, and validate real rendered examples with the crop preview and per-clip override.
3. **Make claims match output.** Correct AI fallback labels, Pro activation, export and settings claims, and social handoff labels. Fix source replacement and stale project actions alongside queue recovery.
4. **Verify the packaged app.** On a clean Windows environment with the Visual C++ linker, build and install the signed package. Smoke-test launch, health, first-run model setup, local import and transcription, generation, playback and seek, cancellation with a previous generation, native MP4/ZIP Save As, restart recovery, and update while a job is active. Pin and verify the downloaded FFmpeg archive, document test dependencies, and make backend tests, frontend checks, and the packaged smoke test release gates. Use separate test accounts for YouTube, Gemini, and Lemon Squeezy.
5. **Keep release documentation aligned.** Update the README, frontend README, website copy, and environment examples when the fixes ship. Use current code and the release smoke results to record supported behavior, verification limits, and remaining gaps.

### Historical milestones

The numbered entries below describe earlier changes. They do not close the current findings above.

### 🔴 Critical Severity (Showstoppers)

#### 1. AI Analyzer Schema Mismatch Causes `KeyError: 'id'` in Clip Generation `[RESOLVED]`
- **Files**: `backend/app/services/ai_analyzer.py` & `backend/app/services/clip_generator.py`.
- **Status**: **RESOLVED & VERIFIED**.
- **Fix**: `validate_analysis()` in `ai_analyzer.py` automatically synthesizes sequential IDs (`f"clip_{index:03d}"`) if the LLM output omits them. In addition, `clip_generator.py` uses fallback resolution `clip_id = clip.get("id") or f"clip_{index:03d}"` so it never raises `KeyError`.
- **Test**: `backend/tests/test_ai_analyzer.py::test_validate_analysis_injects_missing_clip_id`.
- **Open follow-up.** Missing-ID handling is implemented. Supplied IDs still need [output containment](#p0-provider-controlled-clip-ids-can-escape-the-output-directory).

#### 2. AI Analyzer Rejects Real LLM Timestamps via Exact Floating-Point Equality `[RESOLVED]`
- **File**: `backend/app/services/ai_analyzer.py`.
- **Status**: **RESOLVED & VERIFIED**.
- **Fix**: Added boundary snapping with a tolerance window (`abs(candidate - boundary) <= TOLERANCE`) so LLM candidate timestamps matching transcript boundaries within 0.75s snap cleanly to exact segment floats without false-positive 422/502 rejections.
- **Test**: `backend/tests/test_ai_analyzer.py::test_validate_analysis_snaps_floating_point_boundaries`.

#### 3. Overlapping Transcript Segments Crash Analysis `[RESOLVED]`
- **Files**: `backend/app/services/ai_analyzer.py` & `backend/app/services/mock_analyzer.py`.
- **Status**: **RESOLVED & VERIFIED**.
- **Fix**: Segment normalization in both analyzers clamps overlapping segments dynamically (`start = max(start, previous_end)`). `validate_transcript()` clones normalized segments rather than mutating caller dicts in place.
- **Tests**: `backend/tests/test_ai_analyzer.py::test_validate_transcript_clamps_overlapping_segments` and `backend/tests/test_mock_analyzer.py`.

#### 4. `CLIPROBIN_PROJECTS_DIR` Environment Variable Ignored in Route Handlers & Config Stores `[RESOLVED]`
- **Files**: `backend/app/routes/analysis.py`, `backend/app/routes/transcription.py`, `backend/app/routes/projects.py`, `backend/app/routes/watermark.py`, `backend/app/routes/webhooks.py`, `backend/app/services/youtube_uploader.py`, `backend/app/services/ai_developer_mode.py`.
- **Status**: **RESOLVED & VERIFIED**.
- **Fix**: All project paths and sibling runtime config files (`gemini_config.json`, `youtube_config.json`, `youtube_auth.json`, `subscriptions.json`, `watermarks/`) resolve dynamically from `get_projects_dir()`, respecting `%APPDATA%` in Tauri builds and isolated `tmp_path` directories in automated tests.
- **Tests**: `backend/tests/test_project_manager.py` and `backend/tests/test_audit_regressions.py`.

#### 5. Hardcoded `source.mp4` Assumption Breaks MOV, MKV, and WebM Files `[RESOLVED]`
- **Files**: `backend/app/routes/transcription.py`, `backend/app/services/clip_generator.py`, `backend/app/routes/projects.py`.
- **Status**: **RESOLVED & VERIFIED**.
- **Fix**: Replaced hardcoded `source.mp4` checks with filtered `project_directory.glob("source.*")` excluding `.part`, `.ytdl`, `.tmp`, `.json`, and `.txt`.
- **Test**: `backend/tests/test_routes_local_video.py`.

---

### 🟠 High Severity (Functional & Concurrency Defects)

#### 6. Deleting Project During Processing Crashes Windows File System `[RESOLVED]`
- **File**: `backend/app/routes/projects.py`.
- **Status**: **RESOLVED & VERIFIED**.
- **Fix**: `_cancel_active_jobs()` signals `CANCEL_EVENTS` (clip generation), `TRANSCRIPTION_CANCEL_EVENTS` (Whisper), and `DOWNLOAD_CANCEL_EVENTS` (`yt-dlp`) before `_safe_rmtree()` removes the directory with retry and read-only permission clearing.
- **Test**: `backend/tests/test_routes_projects.py`.
- **Open follow-up.** Signaling cancellation before deletion does not establish exclusive job ownership of the path. See [project ownership and recovery](#p1-queue-recovery-silent-sources-and-project-ownership-are-incomplete).

#### 7. Progressive Clip Generation & Staging `[PARTIAL]`
- **Files**: `backend/app/services/clip_generator.py`, `backend/app/routes/clips.py`, `backend/app/routes/jobs.py`.
- **Current behavior.** Each clip is rendered to `.rendering_{clip_id}.mp4` and individually published as `{clip_id}.mp4`. `ready_clips` exposes progressive results. Clip files and `analysis.json` have separate commit points, and cancellation can delete restored files. See [regeneration safety](#p0-regeneration-can-delete-or-mix-existing-exports).

#### 8. Video Filtergraph Architecture & Complex Graph Integration `[UPDATED]`
- **File**: `backend/app/services/video_editor.py`.
- **Status**: **UPDATED & STABILIZED**.
- **Implementation**: Modularized `_build_subtitle_filters()` and ASS burn-in filtergraphs written to script files (`-/filter_complex` / `-filter_complex_script`) with `-map [v] -map 0:a?` and `yuv420p` chroma alignment.

#### 9. Missing Audio Track `[RENDERER HANDLES IT; INTAKE OPEN]`
- **File**: `backend/app/services/video_editor.py`.
- **Current behavior.** `has_audio_stream()` probes the source and the renderer can use `-an` once clip ranges exist. Silent video can still fail earlier in transcription. See [silent source intake](#p1-queue-recovery-silent-sources-and-project-ownership-are-incomplete).

#### 10. Font File Resolution & Zero-Copy Staging `[RESOLVED & OPTIMIZED]`
- **Files**: `backend/app/services/video_editor.py`, `backend/app/services/ass_captions.py`.
- **Status**: **RESOLVED & OPTIMIZED**.
- **Fix**: `_copy_font_file()` and `stage_caption_fonts()` stage system and bundled OFL fonts using `os.link()` hardlinks first before falling back to `shutil.copyfile()`, eliminating repeated multi-MB font copies per rendered clip.

#### 11. Synchronous Blocking Routes in Background Processing `[RESOLVED]`
- **Files**: `backend/app/routes/download.py`, `backend/app/routes/clips.py`, `backend/app/routes/local_video.py`.
- **Status**: **RESOLVED & VERIFIED**.
- **Fix**: Long-running downloads, transcriptions, and renders execute in background tasks with thread-safe locks, cancellation events, and bounded LRU/FIFO job eviction (`MAX_COMPLETED_JOBS = 50`).

#### 12–15. Skeleton UI Smoothing, Window Maximization, Persisted Settings & Windows MIME Fallbacks `[IMPLEMENTED WITH GAPS]`
- **Implementation.** The UI includes skeletons, window initialization, settings persistence, and extension-based validation. Several persisted preferences have no runtime effect. See [export and Settings](#p2-export-settings-and-social-actions-overstate-current-capabilities).

---

### 🟢 UI/UX Enhancements & Feature Milestones (v0.1.16 – v0.1.28)

#### 16–35. Core Studio Capabilities (v0.1.16 – v0.1.25) `[RESOLVED / IMPLEMENTED]`
- **16–20**: Pinned responsive sidebar, configurable watermark burn-in, Fast Interval vs AI Hook Finder modes, Top-Line headline hook editor (`<=15` words), and native Windows File Explorer Save As export for single MP4s and batch ZIPs.
- **21–24**: 1:1 Rounded Square (`660x660`), True 9:16 YuNet ONNX + VAD active-speaker framing, 16:9 Rounded Card (`672x378`), and Tauri/NSIS/PyInstaller brand icons & `--windowed` console suppression.
- **25–30**: 6 caption styles (`classic`, `robin`, `clean`, `punch`, `pill`, `karaoke`), 2-words-per-line high-contrast highlights, gap bridging, 0.42 MB pre-rendered moving previews in `CaptionStylePicker`, and transparent Top-Line hooks on True 9:16.
- **31–35**: Win32 `CREATE_NO_WINDOW` subprocess suppression, 14 smart-framing edge-case guards, dynamic clip counter (`12s, 15s, 30s, 60s, 90s`), container-query responsive UI, exclusive `<video>` playback coordination, YouTube Data API v3 Shorts OAuth uploader, and dual-tab Dashboard intake redesign.

#### 36. Multi-Video Batch Queue, Inline Project Renaming, TikTok/Instagram Flows & Face Tracking Toggle (v0.1.26) `[IMPLEMENTED WITH GAPS]`
- **Files**: `frontend/src/lib/queue-context.tsx`, `frontend/src/components/video-queue-view.tsx`, `frontend/src/lib/project-name-utils.ts`, `frontend/app/projects/page.tsx`, `frontend/app/clips/page.tsx`, `frontend/src/components/tiktok-upload-modal.tsx`, `frontend/src/components/instagram-upload-modal.tsx`, `backend/app/routes/projects.py`, `backend/app/services/smart_framing.py`.
- **Features**:
  - **Multi-Video Processing Queue (`QueueProvider`)**. Sequential local-file and YouTube intake includes per-item status, progress, and cancellation. Retry and restart recovery remain open.
  - **Inline Project Renaming**: `PATCH /api/projects/{id}` persists custom project titles in `metadata.json` with stateless illegal-character & Windows reserved-name validation (`project-name-utils.ts`).
  - **Face Tracking Toggle on True 9:16**. The toggle switches between smooth tracking and a shot-based mode that can still reframe.
  - **Guided TikTok and Instagram Reels Export**. These flows prepare files for manual upload. YouTube has a separate direct upload implementation.

#### 37. Pro Subscription System, Paddle Billing v2, Custom Brand Watermarks & AI Developer Mode (v0.1.27) `[BILLING PROTOTYPE REPLACED]`
- **Features**:
  - **Subscription and Feature Gating**. The former Paddle prototype used a local Free/Pro plan and accepted arbitrary license text. See the [current verified billing implementation](#p1-verified-billing-requires-hosted-setup-and-sandbox-testing).
  - **Custom Brand Watermarks**: Upload custom PNG/JPG/WebP brand logos (`<=10 MB`) with configurable canvas position (`top_right`, `top_left`, `bottom_right`, `bottom_left`, `center`) and opacity (`20%–100%`) burned directly into rendered clips via FFmpeg `colorchannelmixer`.
  - **Local AI Developer Mode (BYOK)**. The Settings toggle and key configuration are backed by `gemini_config.json`. See [current model defaults](#42-environment-variables) and [fallback behavior](#p1-ai-fallback-is-reported-and-cached-as-successful-ai-analysis).

#### 38. Full-Stack Security, Reliability & Correctness Hardening (v0.1.28) `[RESOLVED & VERIFIED]`
- **Files**: Across 22 backend modules and 24 frontend modules; regression-tested in `backend/tests/test_audit_regressions.py` and `frontend/scripts/__tests__/project-name-utils.test.mjs`.
- **Status**: **RESOLVED & VERIFIED**.
- **Fixes Implemented**:
  - **Fixed `NameError: shutil` in `transcriber.py`**: Restored `import shutil` and added `cancel_event` checks before, during, and after Whisper segment iteration.
  - **Fixed PyInstaller Save-As Dialog Crash (`clips.py`)**: Replaced `[sys.executable, "-c", "import tkinter..."]` (which re-launched the FastAPI server binary in frozen builds) with native Win32 `ctypes.windll.comdlg32.GetSaveFileNameW` (`OPENFILENAMEW`).
  - **Fixed PyInstaller `_MEIPASS` Data Loss**: Moved `watermarks/`, `subscriptions.json`, `gemini_config.json`, `youtube_config.json`, and `youtube_auth.json` resolution to `get_projects_dir().parent` with atomic temp-file + `os.replace` writes.
  - **Security Hardening**: HTML-escaped reflected `error`, `channel_title`, and exception strings in `youtube_oauth_callback` (preventing reflected XSS); added OAuth `state` validation; blocked path traversal and glob metacharacters (`*`, `?`, `[`, `]`) in `/api/youtube/upload` and clip routes; removed SVG upload vector and added PNG/JPEG/WebP magic-byte validation + bounded `read(MAX_FILE_SIZE + 1)` in `/api/watermark/upload`; enforced fail-closed Paddle webhook verification when `PADDLE_ENVIRONMENT == "production"`.
  - **Partial Transcript & Mock Cache Integrity**: Recorded `"is_complete"` and `"covered_duration"` in `transcript.json` so early-exit transcripts are never reused for longer clip counts or full re-transcriptions; bumped `mock_analyzer.py` to `analyzer_version: 2` so caption/framing edits reuse cached analysis while preserving user `top_line` hooks across re-analysis.
  - **Chronological Job Ordering & Retry Recovery**: Added monotonic `created_seq` + `created_at` ordering in `get_latest_clip_generation_job` (replacing random UUID key order) and separated `pollIntervalId` from `retryTimeoutId` in `frontend/app/clips/page.tsx`.
  - **Stateless Project Rename Regex & Dynamic Desktop Port URLs**: Replaced stateful `/g` regex `.test()` in `project-name-utils.ts` and replaced hardcoded `127.0.0.1:8000` URLs in YouTube OAuth, custom watermark previews, and Paddle sandbox modals with dynamic Tauri-compatible `getApiBaseUrl()` / `resolveWatermarkImageUrl()`.

#### 39. Full-Stack Performance & Efficiency Optimizations (v0.1.28) `[IMPLEMENTED]`
- **Optimizations Implemented**:
  - **Camera Trajectory Smoothing (`smart_framing.py`)**. `_smooth_and_simplify_segment` uses bisect lookups and prefix sums. `_scan_faces` can bound the decode with `-t {max_duration + 1.0}`. The two shot lists can be reused from a compatible cache. A cache miss can still scan faces in either mode.
  - **Zero-Copy Hardlinks & Persistent Media Caches (`video_editor.py`, `ass_captions.py`, `local_video.py`)**: Cached 4× supersampled rounded-corner alpha masks in `tempfile.gettempdir() / "cliprobin_masks"`, cached `has_audio_stream` and `probe_video_duration` by `(resolved_path, st_mtime_ns, st_size)`, hardlinked (`os.link`) local video imports and staged fonts before falling back to `shutil.copyfile`, and bounded Whisper WAV extraction with `-t {max_duration + 5.0}`.
  - **Streaming & Connection Reuse (`youtube_uploader.py`, `ai_analyzer.py`)**: Streamed YouTube MP4 uploads in 256 KB file chunks instead of loading entire videos into RAM, and reused persistent `httpx.Client` connections across API calls and retries.
  - **Frontend CPU/GPU & Polling Efficiency**: Mounted only a single `<video>` preview element in `CaptionStylePicker` via `matchMedia`, paused `LiveMovingCaptions` `380ms` timer when hidden or `prefers-reduced-motion` is active, switched `job-progress.tsx`, `projects/page.tsx`, and `use-ai-developer-status.ts` to visibility-aware adaptive polling with equality bailouts and custom DOM event wakeups (`cliprobin:job-started`, `cliprobin:ai-status-changed`), disconnected `ProClipCard` `IntersectionObserver` once visible, and isolated `isActivePlaying` boolean props + memoized callbacks so play/pause changes only re-render the affected card.

#### 40. Clip Playback Cache-Busting, Long-Form Context Relocation & Split-Screen 9:16 Framing (v0.1.29) `[IMPLEMENTED WITH FRAMING LIMITATIONS]`
- **Files**: `backend/app/routes/clips.py`, `backend/app/services/clip_generator.py`, `backend/app/services/ai_analyzer.py`, `backend/app/services/smart_framing.py`, `backend/app/services/video_editor.py`, `frontend/src/lib/api.ts`, `frontend/app/clips/page.tsx`, `frontend/src/lib/subscription-context.tsx`, `backend/tests/test_audit_regressions.py`.
- **Fixes Implemented**:
  - **Fixed "Clip Unavailable" / 416 Range Errors on Regenerated Clips**: Appended dynamic version tokens (`v={mtime_ns}_{size}`) to clips in `/api/projects/{id}/clips` and client media URLs (`clipUrl`), sent `Cache-Control: no-cache` in `serve_clip`, and added automatic video player retry and dynamic URL re-resolution upon regeneration in `frontend/app/clips/page.tsx`.
  - **Intro Teaser Soundbite Relocation (`_relocate_and_expand_clip_bounds`)**: Detected 4-second teaser soundbites selected from pre-roll intro highlight montages (<120s of video) and automatically relocated them to their full conversation exchange later in the transcript, expanding setup and payoff context.
  - **Split-Screen 9:16 Center Seam Clamp (`_clamp_split_screen_target`)**. The crop stays within a presumed speaker half when faces are detected on opposite sides. That assumption can crop a face in shared-camera footage. See [face tracking](#p1-face-tracking-off-still-moves-the-crop).
  - **Incremental Tail-Resuming for Face Tracking**: Added `start_offset` and duration check fixes in `smart_framing.py` so partial tracking analyses resume from where they stopped rather than re-decoding the entire video.
  - **Burned-in Letterbox Auto-Detection (`_detect_letterbox_vertical_crop`)**: Added FFmpeg `cropdetect` helper to automatically crop out burned-in horizontal letterbox bars from 16:9 source segments in `true_9_16` mode.

---

## 6. Automated Test Suite Inventory

### November 10, 2026 audit results

| Check | Result and scope |
| --- | --- |
| Backend tests | **161 passed** across **22 `test_*.py` files**. The successful run used an isolated test directory after the first attempt hit temporary-file permission errors. |
| Frontend tests | **6 passed** across two test files. TypeScript, ESLint, and the v0.1.29 manifest version check passed. |
| Local web walkthrough | The backend health check passed. Local file selection, invalid YouTube URL feedback, queue submission, Projects, Settings, and Plans were exercised. The dashboard fit a 390 px viewport without horizontal overflow. |
| Real media | A 27-second synthetic source completed local transcription after more than 90 seconds. Generation was submitted separately after transcription. An independent prepared-transcript project verified FFmpeg rendering, browser playback, an HTTP `206` byte-range response, and the ZIP endpoint. The checked MP4 was `720×1280` at 30 fps. |
| Production web build | The default Turbopack build failed in the audit environment. The restricted run could not fetch Inter from Google Fonts. A rerun with network access hit a Turbopack CSS worker error. `npm run build -- --webpack` succeeded and produced `/`, `/clips`, `/projects`, `/settings`, `/subscription`, and `/_not-found`. |
| Native and external flows | Rust compilation stopped because `link.exe` was unavailable. The Windows installer, native Save As dialogs, and updater remain unverified. Live YouTube, Gemini, Paddle, and real-footage speaker tracking remain unverified. |

Use the acceptance checks in [the open findings](#open-findings-and-implementation-plan) to close gaps that the existing suites missed. For a clean setup, install `pytest` as a development dependency before running the backend suite. `setup.ps1` installs backend runtime dependencies.

### Backend Test Inventory (22 Files — 161 Passing Tests)

| Test File | Target Modules | Key Coverage |
| :--- | :--- | :--- |
| `tests/test_audit_regressions.py` | Full-stack v0.1.28 & v0.1.29 regressions | Chronological job sequence, mock v2 cache + `top_line` retention + language forwarding, partial transcript re-transcription, $O(N)$ `_smooth_and_simplify_segment` + dual `shots_tracked`/`shots_static` cache, isolated watermark settings + magic-byte validation, YouTube OAuth XSS escaping + path traversal block, isolated atomic `gemini_config.json`, intro teaser relocation, split-screen center-seam clamping, clip versioning + `no-cache`. |
| `tests/test_ai_analyzer.py` | `services.ai_analyzer` | Transcript validation, overlap clamping, Gemini/OpenAI/DeepSeek formatting, markdown JSON parsing, boundary snapping, ID & score synthesis. |
| `tests/test_ass_captions.py` | `services.ass_captions` | ASS time formatting, escaping, hex-to-ASS BGR conversion, safe vertical positioning across all 25+ style/animation pairs, top-line overlay, font hardlink staging, karaoke tags. |
| `tests/test_caption_previews.py` | `scripts.build_caption_previews` | SHA-256 manifest freshness, existence of all MP4 previews & JPG posters, total size ceiling (`<=10 MB`). |
| `tests/test_caption_styles.py` | `services.caption_styles` | 6 styles registry, legacy aliases, animation defaults, bundled OFL & RTL/Devanagari font resolution. |
| `tests/test_clip_counter.py` | `clip_generator`, `mock_analyzer`, `clips` | `12s` slicing, `max_clips`/`clip_count` enforcement, `source_duration` metadata/ffprobe probing. |
| `tests/test_clip_generator.py` | `services.clip_generator`, `video_editor` | Service-level backup and rollback cases, progressive `.rendering_*.mp4` staging, watermark and top-line burn-in, special-character escaping, 16:9/1:1/9:16 filtergraphs, and silent render `-an` handling. The route-level cancellation and same-filename rollback gaps are open. |
| `tests/test_mock_analyzer.py` | `services.mock_analyzer` | Deterministic duration chunking, trailing orphan prevention, `analyzer_version: 2` schema. |
| `tests/test_process_utils.py` | `services.process_utils` | Windows `CREATE_NO_WINDOW` and `SW_HIDE` subprocess flags. |
| `tests/test_project_manager.py` | `services.project_manager` | `os.scandir` sequential ID creation, path traversal rejection, `CLIPROBIN_PROJECTS_DIR` override, `.rendering_*` exclusion. |
| `tests/test_routes_analysis.py` | `routes.analysis` | `/api/analyze`, `/api/ai/status`, `/api/ai/config`, `/api/ai/developer-mode` validation & error codes. |
| `tests/test_routes_clips.py` | `routes.clips` | Duration/framing/style/animation validation, 409 duplicate job guard, top-line CRUD, Save-As dialog MP4 & ZIP export, `face_tracking` & `generation_options` hydration. |
| `tests/test_routes_download.py` | `routes.download` | YouTube host allowlist (`youtube.com`, `m.youtube.com`, `youtu.be`), failure cleanup, friendly local-file fallback message. |
| `tests/test_routes_health.py` | `routes.health` | `GET /api/health` returns `200` and `{"status": "healthy"}`. |
| `tests/test_routes_jobs.py` | `routes.jobs` | Aggregated active download, transcription, and generation job snapshots. |
| `tests/test_routes_local_video.py` | `routes.local_video` | Extension allowlist, multipart upload & `/from-path` transcription queueing, FIFO job eviction. |
| `tests/test_routes_projects.py` | `routes.projects` | Project listing, `PATCH` title rename in `metadata.json`, active job cancellation before `DELETE`. |
| `tests/test_routes_watermark.py` | `routes.watermark` | Custom watermark upload, retrieval, deletion, position/opacity settings, size/type checks. |
| `tests/test_routes_webhooks.py` | Local API | Removed Paddle routes cannot activate or disclose a legacy subscription. Hosted billing behavior has separate frontend Node tests with provider and Auth fixtures. |
| `tests/test_smart_framing.py` | `services.smart_framing` | YuNet ONNX resolution, IoU tracking, VAD correlation, crop expressions, and synthetic framing cases. Real-footage acceptance is tracked in Section 5. |
| `tests/test_transcriber_shim.py` | `services.transcriber` | CTranslate2 / `faster-whisper` transcription wrapper, bounded audio extraction, cancellation. |
| `tests/test_youtube.py` | `services.youtube_uploader`, `routes.youtube` | Google OAuth config/JSON parsing, auth URL state, token exchange/refresh, chunked resumable upload. |

---

## 7. Residual Edge Cases & Operational Notes

1. **Media & Codec Nuances**:
   - **Silent videos.** The renderer can use `-an` when clip ranges already exist. The default intake path can fail before that point because it expects audio for transcription.
   - **10-Bit HDR Footage**: Converted via `format=yuv420p`; extreme BT.2020 HDR sources without tonemapping may appear slightly desaturated compared to SDR sources.
   - **RTL & Indic Scripts**: Supported in all 5 ASS-backed styles (`robin`, `clean`, `punch`, `pill`, `karaoke`) via `transcript.json` `"language"` forwarding into `NotoSansArabic-Bold.ttf` / `NotoSansDevanagari-Bold.ttf`. Note that legacy `"classic"` uses FFmpeg `drawtext`, so non-Latin creators should prefer `"robin"` or `"clean"`.
2. **External Network Boundaries**:
   - **YouTube Anti-Bot Challenges**: If YouTube blocks `yt-dlp` on restricted networks, `routes/download.py` surfaces clear guidance to drop a local video file instead.
   - **Cloud LLM errors.** Transient HTTP `429` and selected `5xx` responses can trigger retries and candidate model fallback. Other failures can exit the candidate loop and reach the interval fallback described in Section 5.
3. **Storage & Lifecycle**:
   - **Project ID allocation.** `create_project()` scans existing IDs and uses `max_num + 1`. Deleting the highest-numbered project can make its ID available again. Use the project ownership acceptance checks in Section 5 before claiming safe reuse behavior.
   - **Disk Space**: High-bitrate exports write to `%APPDATA%/com.cliprobin.desktop/projects` in desktop builds; users with low `C:` free space can override `CLIPROBIN_PROJECTS_DIR`.

---

## 8. AI Pair Programming Rules of Engagement

When modifying or extending the Clip Robin codebase, all AI models and contributors must observe the following constraints:

1. **Maintain the Local-First Privacy Boundary**: Never transmit raw video, audio tracks, or local filesystem paths to external network endpoints unless explicitly initiated by the user (e.g., direct YouTube Shorts upload). Only sanitized text transcripts may be sent to user-configured LLM providers.
2. **Preserve Documentation Integrity**: Preserve existing docstrings, type annotations, and comments. Keep `ai.md`, `README.md`, `frontend/README.md`, and `website.md` synchronized when routes, versions, or schemas change.
3. **Cross-Platform & Frozen-Build Path Hygiene**: Always resolve runtime mutable files via `get_projects_dir()` / `CLIPROBIN_PROJECTS_DIR` (never write mutable state under `Path(__file__)`, which points to ephemeral `_MEIPASS` in PyInstaller builds). Use atomic temp-file + `os.replace()` for JSON persistence.
4. **Non-Blocking & Cancellable Execution**: Offload heavy media/network operations (`yt-dlp`, `faster-whisper`, `ffmpeg`, `cv2`) from request threads and honor `threading.Event` cancellation promptly.
5. **Version Manifest Synchronization**: Whenever bumping the application version, run `npm run version:set -- <x.y.z>` and `npm run version:check` inside `frontend/` so `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` stay strictly aligned.
