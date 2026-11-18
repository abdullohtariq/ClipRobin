# Clip Robin — AI Context, Codebase Audit & Engineering Handbook

> **Clip Robin v0.1.32 engineering handbook.** Section 5 records current audit findings and their acceptance checks.
>
> **Do NOT delete or overwrite this file.** Maintain and update this context as the project evolves.

---

## 1. Executive Summary & Core Philosophy

**Clip Robin** is an open-source, local-first Windows desktop application designed to discover, extract, subtitle, and export short-form video clips (for YouTube Shorts, TikTok, and Instagram Reels) from long-form video content.

### Core Architectural Principles
1. **Local by Default**: Media extraction, audio ripping, transcription, active-speaker face tracking, clip slicing, and subtitle/watermark burn-in execute entirely on the user's local machine via FFmpeg, CTranslate2 (`faster-whisper`), OpenCV YuNet ONNX, and Python.
2. **Optional cloud analysis.** The Studio's AI Hook Finder uses Gemini and sends timestamped transcript text with the user's configured key. The direct `/api/analyze` route also has OpenAI and DeepSeek adapters. Media processing runs locally. YouTube link intake contacts YouTube, and a user-initiated YouTube upload sends the selected rendered clip to YouTube. The first Whisper run may need to download model files.
3. **Explicit Desktop Boundaries**: Built as a three-tier hybrid desktop architecture:
   - **Frontend**: Next.js 16 (`16.4.6`, React `19.2.8`, Tailwind CSS v4, TypeScript 5, static export `output: "export"`).
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

    subgraph Frontend["Frontend (Next.js 16.4.6 / React 19.2.8)"]
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
        PaymentProvider["Polar Sandbox hosted checkout and signed webhooks"]
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
│   │   ├── check-version.mjs          # Verifies package.json, Cargo.toml & tauri.conf.json match (0.1.32)
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
│   │   ├── Cargo.toml                 # Rust crate manifest (v0.1.32)
│   │   └── tauri.conf.json            # Tauri bundle & updater configuration (v0.1.32)
│   ├── package.json                   # Frontend manifest (v0.1.32)
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

Accounts use the hosted `cliprobin-billing` function. The current source connects that function to Polar Sandbox and restricts test checkout and portal sessions to one designated Supabase account. Polar sends signed lifecycle events to `/webhook`. See the [database and billing setup](supabase/README.md) for the schema, secrets, and deployment steps.

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

The November 10, 2026 audit covered the `v0.1.29` checkout. Fixes and regression coverage below were implemented on the `fixes` branch (`v0.1.30` docs alignment). **Reproduced** means observed in browser or exercised in production code with disposable data. Controlled tests inject failures or detections where noted and do not touch production accounts, customer projects, or private footage.

#### P0 Regeneration can delete or mix existing exports — Resolved on `fixes`

- **Original issue.** Regenerating with previously exported clips present could delete committed MP4s on cancellation or leave mixed new/old files on failure because `analysis.json` and finished files were written directly into the live project directory.
- **Implementation.** Each generation run writes `analysis.json` and rendered MP4s into a job-owned `.staging_{job_id}` workspace and commits the full set atomically (`_commit_staged_generation`) once rendering completes. Staged previews serve exclusively via `?stage_job_id=`, cancel/failure/startup orphan cleanup only removes `.staging_*` directories owned by that job, and active job/stage checks scope by `(project_id, project_dir, project_uid)`. Project-level serialization locks protect commit, cleanup, top-line edits, and single-clip reframes while preserving existing `top_line` overlays and ZIP/MP4 parity.
- **Verification.** Covered by [`backend/tests/test_audit_regressions.py`](backend/tests/test_audit_regressions.py) through the real route worker: cancel before first render, cancel mid-second render, forced render failure, orphan `.staging_*` cleanup at reload, byte-for-byte hash preservation, ZIP contents parity, and full replacement upon successful regeneration.
- **Code.** [Renderer and rollback](backend/app/services/clip_generator.py) · [Generation routes and clip list](backend/app/routes/clips.py) · [Existing renderer tests](backend/tests/test_clip_generator.py)

#### P0 Provider-controlled clip IDs can escape the output directory — Resolved on `fixes`

- **Original issue.** External/AI-supplied clip IDs were kept in generated filenames without local ID allocation or full producer-path containment validation, allowing path traversal out of the project clips directory.
- **Implementation.** AI response validation (`ai_analyzer.py`) preserves provider identifiers only as `provider_clip_id` metadata while allocating safe local filesystem IDs. Both staging and committed output construction in `clip_generator.py` and `video_editor.py` verify strict resolved path containment (`_validate_output_containment`) and treat cached `analysis.json` files as untrusted input while migrating safe legacy IDs cleanly.
- **Verification.** Covered by [`backend/tests/test_audit_regressions.py`](backend/tests/test_audit_regressions.py) against `..`, Windows/POSIX separators, drive-qualified (`C:\...`) and UNC (`\\server\share\...`) IDs, duplicate IDs, and malformed cached analyses with external sentinel MP4 integrity checks.
- **Code.** [AI response validation](backend/app/services/ai_analyzer.py) · [Clip path construction](backend/app/services/clip_generator.py) · [Renderer](backend/app/services/video_editor.py)

#### P1 Face Tracking Off still moves the crop — Resolved on `fixes` (multi-speaker footage validation ongoing)

- **Original issue.** `face_tracking=false` still scanned faces and moved horizontal crops; split-screen detection used opposite-half face proxies that cut into two-person shots; tracking cache omitted transcript revision; Dashboard preview ignored static anchor offsets.
- **Implementation.** Full `9:16` now defaults to **`Locked Crop`** (`tracking_mode="locked"`, adjustable `crop_anchor_x` with L/C/R presets) and performs zero face scanning. **`Speaker Cuts`** (`"cuts"`, legacy stationary-shot migration) and **`Follow Speaker`** (`"follow"`) are explicit separate modes. `smart_framing.py` detects true center split-screen dividers before clamping half-frames, keys tracking cache entries by media fingerprint + `transcript_revision` + tracking inputs, reports requested vs applied tracking mode and fallback reasons, adds `GET /api/projects/{id}/crop-preview`, and adds `POST /api/projects/{id}/clips/{clip_id}/reframe` for single-clip reframing without affecting sibling clips. Dashboard mirrors `crop_anchor_x` via CSS `object-position`.
- **Verification & limits.** Covered by [`backend/tests/test_audit_regressions.py`](backend/tests/test_audit_regressions.py) (zero detector invocation under `locked`, real divider vs ordinary two-person shot, `/crop-preview`, single-clip `/reframe`) and Playwright E2E Steps 3 & 6. Qualitative accuracy on diverse real multi-speaker webcam/B-roll footage remains subject to user real-footage validation.
- **Code.** [Framing and crop cache](backend/app/services/smart_framing.py) · [Dashboard](frontend/app/page.tsx) · [Projects](frontend/app/projects/page.tsx) · [Studio](frontend/app/clips/page.tsx) · [Current framing tests](backend/tests/test_smart_framing.py)

#### P1 AI fallback is reported and cached as successful AI analysis — Resolved on `fixes`

- **Original issue.** Provider failures silently fell back to deterministic interval clips while saving `generation_mode="ai"`, causing retries to reuse cached interval outputs and omitting failure reasons.
- **Implementation.** Metadata separately tracks `requested_generation_mode`, `applied_generation_mode`, `ai_provider`, `ai_model`, and sanitized `ai_fallback_reason` (stripping API keys and never logging raw transcript text). Subsequent AI generation requests bypass cached interval results when prior runs fell back (`force_reanalyze` / mode mismatch). Developer Mode validation runs uniformly after provider resolution across `clip_generator.py` and `routes/analysis.py`. Studio renders fallback banners with a **Retry AI Analysis** button, and Dashboard/Settings disclose before enabling AI that timestamped transcript text is transmitted to the user-configured LLM provider.
- **Verification.** Covered by [`backend/tests/test_audit_regressions.py`](backend/tests/test_audit_regressions.py) (401, 404, 429, malformed JSON, Developer Mode block, log key redaction, fallback reporting, retry bypass) and Playwright E2E Step 5 confirming `Time Slice` cards omit fake `8.5/10` / `"Mock analysis"` labels.
- **Code.** [Analysis and cache](backend/app/services/clip_generator.py) · [Provider requests and retries](backend/app/services/ai_analyzer.py) · [Direct analysis route](backend/app/routes/analysis.py)

#### P1 Verified billing requires hosted setup and sandbox testing — Local fixes complete; hosted sandbox pending

- **Original reproduction.** Earlier releases allowed local license-key spoofing and unauthenticated local webhook mutations; those paths are removed.
- **Current status.** Supabase Auth is hosted. Lemon Squeezy closed new store sign-ups on November 16, 2026. The current source integrates Polar checkout and its customer portal with signed webhooks, account-scoped links, and ordered billing updates. Sandbox is the default billing environment. `PLAN_FEATURES` matches actual `720×1280, 30 fps` renderer limits.
- **Plan and Gemini cost controls.** Pro is priced at $12 USD per month with 20 Hook Finder credits per billing period. Each fresh analysis uses one credit per started 30 minutes. `20261117000000_hook_credits.sql` reserves credits and a conservative spend estimate before Google receives a request, with $1 per-account and configurable project-wide limits. The function pins Gemini 3.5 Flash-Lite and records input, output, and thinking tokens. The existing local cache and bring-your-own-key path are available in the desktop app. The signed-in plan screen explains when checkout is unavailable and shows the credit balance when configured.
- **Verification.** `frontend/scripts/__tests__/billing.test.mjs` runs both migrations in embedded PostgreSQL and tests a full simulated cycle with Polar and Gemini responses. It exercises activation, account isolation, failed generation, concurrent requests, exhaustion, renewal, cancellation, and loss of access when the subscription ends.
- **Still needed.** Finish Polar Sandbox sign-in and create the organization, $12 recurring product, restricted API token and webhook. Apply the credit migration, configure secrets and the Google project budget, deploy the Edge Function, and verify checkout, credit use, and renewal against Polar Sandbox from a build that accepts Polar links. The `v0.1.30` installer accepts Lemon Squeezy links. Production requires an approved Polar organization and an updated app release. See the [setup and test instructions](supabase/README.md).
- **Code.** [Subscription context](frontend/src/lib/subscription-context.tsx) · [Plans page](frontend/app/subscription/page.tsx) · [Billing function](supabase/functions/cliprobin-billing/index.ts) · [Setup and acceptance](supabase/README.md)

#### Account, payment, and credit audit (November 18, 2026)

**Hosted checks.** The existing confirmed account stayed signed in and refreshed to Free in the local app connected to the real Supabase project. The Pro card showed $12/month and disabled checkout with an explanation. Supabase has email signup and confirmation enabled, uses the built-in mail sender, and has Google and GitHub disabled. The Site URL is `http://localhost:3000`. Both allowed account redirects point to loopback addresses. The dashboard listed the original subscription and checkout tables. `billing_hook_requests` and the required custom Polar and Gemini settings were absent. Polar Sandbox was at sign-in.

**Local checks.** The static frontend built successfully. All 13 Node tests and 65 Python tests in the account-adjacent analysis and clip-generation suites passed. Isolated browser tests covered signup prompts, resend, invalid credentials, unconfirmed email, email delivery and rate-limit errors, session persistence, sign-out, a failed plan refresh and retry, checkout link validation, the portal link, Pro activation and balance, cancellation, and the account screen at 390 px. Same-browser password recovery passed on the exported frontend with three simulated response speeds. The development preview missed the reset form with the immediate response and passed with delayed responses. The browser test used simulated Auth email callbacks.

**Credit and payment checks.** The real migrations ran against embedded PostgreSQL with simulated Polar and Gemini APIs. Checkout rejected a production price mismatch. The cycle covered activation, concurrent reservations, exhaustion, invalid or oversized input, failed Gemini output, renewal, failed payment and recovery, cancellation, and expiration. A 30-minute source used one credit and a 30-minute-and-one-second source used two. A synthetic video also rendered through the real local clip route with a simulated Hook Finder response. Changing captions reused the hooks. An out-of-credits response switched generation to Fast Interval and preserved the reason in the job status. These checks incurred no payments, provider calls for Gemini, or outgoing account emails.

| Priority | Finding | Work before launch |
| --- | --- | --- |
| Blocker | New public accounts cannot reliably receive confirmation or reset email. Supabase's built-in sender is restricted to project team addresses and is rate-limited. Loopback redirects only reach the account screen when a local server is running on the customer's computer. | Configure an SMTP sender, publish Account & Plans at an HTTPS address, and put its exact URL in Supabase's redirect allowlist and `NEXT_PUBLIC_CLIPROBIN_ACCOUNT_URL` for the desktop build. Test signup, resend, confirmation, and reset with a non-team inbox. [Supabase email delivery](https://supabase.com/docs/guides/auth/auth-smtp) · [Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls) |
| Blocker | Paid checkout and included credits are unavailable in the hosted project. The current GitHub `v0.1.30` source accepts Lemon Squeezy billing links. | Finish Polar Sandbox onboarding and create the $12 monthly product and signed webhook. Apply the Hook Finder migration before deploying the updated function. Configure the restricted Polar credentials and the dedicated Gemini key and budget. Verify sandbox checkout from the updated Windows build before publishing it. Verify a second account stays Free. [Setup steps](supabase/README.md) · [Polar Sandbox](https://polar.sh/docs/integrate/sandbox) |
| High | Expired email links and links opened in another browser returned to sign-in with no explanation. Desktop offers password reset only when the build has a hosted Account & Plans URL. Web sign-in with Google or GitHub requires the providers and frontend flags. | Display safe callback errors with an expired-link or wrong-browser recovery action. Test a fresh reset, an expired link, a different browser, and restart during recovery on the packaged app. Keep the email route usable regardless of optional social sign-in. [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow) |
| High | A simulated payment already recorded by Polar left Clip Robin on Free until the signed subscription event was delivered. **Refresh plan** reads Supabase's last subscription state. Repeated refreshes did not recover a missing notification. | Add a payment-pending screen, a server-side way to reconcile the expected checkout against Polar, and help for a confirmed payment that is still pending in the app. Store the checkout identifier and prevent a replacement charge while the first checkout is unresolved. Verify delayed delivery, replay, and repeated checkout attempts. [Polar webhook delivery and redelivery](https://polar.sh/docs/integrate/webhooks/delivery) |
| High | A simulated order refund left Pro and its credits available while Polar still reported the subscription as active. A failed renewal removed Pro and showed the billing portal, and a later active event restored it. | Define when a current-period refund should end access. Until an entitlement change is implemented, verify the corresponding subscription cancellation or revocation in Polar after any applicable refund. Test full and partial refunds, an older-order refund, and recovery from a failed renewal. [Polar refund behavior](https://polar.sh/docs/api-reference/refunds/create) |
| High | The project spend cap correctly stopped Gemini, but **Account & Plans** still showed the unused per-account credits. At the documented $5 budget and $0.02 reserved per credit, the shared project can reserve 250 credits per UTC month, equivalent to 12 full 20-credit allowances with 10 left, before counting failed attempts. | Size the paid pilot to the shared budget, show temporary service exhaustion separately from the customer's credit balance, and account for this shared limit when accepting new subscriptions. Verify the cap and alerts with the provider configuration before allowing paid upgrades. |
| Medium | **Open secure checkout** stayed visible after the same account refreshed to Pro. A simulated provider outage also held the checkout slot until its 30-second reservation expired. | Clear or hide the old link when checkout is no longer available. Show confirmed or pending payment after returning from Polar and make retry feedback explain a checkout that is still being prepared. |

**External acceptance still open.** Test delivery to an ordinary inbox, initial sign-in from a fresh Windows installation, checkout in the external browser, a successful and declined test card, any verification challenge Polar displays, receipt and portal access, a renewal or failed-renewal event from Polar, and use of the hosted credit function with the intended capped Gemini project. No cloud configuration was changed during the audit.

#### Account and billing fixes (November 18, 2026)

| Audit item | Fix in the working copy | Hosted acceptance |
| --- | --- | --- |
| Public signup and reset email | The Account & Plans export can be uploaded to Cloudflare Pages at its free HTTPS address. The Clip Robin confirmation and reset templates send customers to that page. Customers confirm the action on the page before the app sends the one-time token to Supabase. The template works across browsers and keeps the token in the URL fragment until the page reads it. | Publish the account page, configure an SMTP sender and the exact HTTPS redirect, and install both templates. Verify signup, resend, and reset with a non-team inbox. |
| Expired links and password recovery | Account & Plans displays errors for expired, used, or wrong-browser links. It explicitly exchanges legacy PKCE codes after registering the password-recovery listener. After verification it keeps a short account-scoped recovery marker so a page reload can reopen the password form. The Windows build uses Tauri's browser opener for the configured account URL and for Polar links. | Verify the two email link formats and a reset from an installed Windows build. Legacy PKCE requires the browser that requested the link. Configure each optional social provider in Supabase before enabling its sign-in button. |
| Missing or delayed checkout notification | The billing function records the Polar checkout ID. It checks the provider state on plan refresh, validates the purchase with the signed Clip Robin account claim, and syncs the matching subscription. Confirmed checkouts stay pending until Polar records the payment. Repeated clicks reuse an open link and cannot create a new checkout while Polar reports the previous one unresolved. The app hides the old link when the attempt or plan changes. A failed attempt to create a link releases its slot immediately. | Deploy the new SQL and function. Verify a declined test card and a successful sandbox payment with webhook delivery paused. Re-enable delivery and replay the event. |
| Refunds and billing portal | The function verifies the order and subscription directly with Polar for an `order.refunded` event. A full refund for the current subscription period ends Pro and its included credits immediately, while the billing portal stays available. The database persists the affected period so a replayed active subscription event cannot restore it. Partial and older refunds preserve the current plan. A later paid period gets a new allowance. | Enable `order.refunded` delivery and `orders:read`. Test a full first-order refund, full renewal refund, a partial refund, an old-order refund, and access to the portal. Manage cancellation in Polar when appropriate. |
| Shared Gemini budget | The UI shows the balance and the amount available now. The server checks both before reserving a generation and deducts a shared spending reservation for every attempt. Production checkout holds room for current subscriptions and unresolved checkouts before it offers another paid plan. At $5/month, 12 full 20-credit allowances fit before counting additional attempts or usage at differing points in each customer's billing cycle. | Set a dedicated Gemini key and a matching provider-side budget. Check the ledger against actual Gemini usage during the pilot. |

**Verification.** All 13 Node tests passed, including the real migrations in embedded PostgreSQL. The combined scenario covered simultaneous production checkout reservations, immediate retry after a failed provider request, confirmation pending, activation without a webhook, credit reservation and exhaustion, a Gemini error, cancellation, a partial refund, a full current refund, an older invoice refund, and renewal. The 65 related Python tests passed. Deno type checking, ESLint on the changed frontend routes, version manifest checks, and both static builds passed. The packaged account site was served and tested in Edge at 390 px with simulated Supabase and billing responses. The browser covered signup, resend, invalid credentials, expired and wrong-browser links, cross-browser confirmation and password reset, reload during recovery, pending checkout, Pro activation, the portal link, the credit-cap notice, refund, and sign-out. The 58-file ZIP is in `frontend/build/ClipRobin-Account-Site.zip`. These tests incurred no checkout or Gemini charges.

**Dependencies.** Next.js and its ESLint configuration were updated to 16.4.6, and the locked source-map dependency was updated to 1.2.2. The production dependency audit reported zero vulnerabilities after those updates. [Next.js advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j) · [Source map advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)

**Hosted steps pending.** Supabase CLI access needs owner sign-in. The Windows browser connection stopped because it could not verify the dashboard address. Publish the package to the free HTTPS host and configure Supabase email delivery and redirects. Apply `20261117000000_hook_credits.sql` and `20261118000000_billing_reliability.sql` in order, then deploy `cliprobin-billing`. Configure the account URL in the desktop build and in Polar's checkout return settings. Add the Polar Sandbox credentials and connect the capped Gemini project before running the full hosted checkout cycle. The existing `v0.1.30` release predates these changes. Local Windows packaging requires the MSVC linker. [Deployment and verification steps](supabase/README.md)

#### v0.1.32 face tracking and Windows packaging

- **Smart Framing.** Speaker Cuts and Follow Speaker use the bundled YuNet detector with new face geometry checks, camera-cut detection, and suppression of brief cuts to a listener. Divider detection requires a visible edge near the center across most of the frame. Locked Crop uses the chosen anchor without scanning faces. The change invalidates old tracking caches.
- **Model distribution.** The Windows installer packages OpenCV's MIT-licensed YuNet model and its copyright notice. The SCRFD and 106-point landmark integration is available for source experiments with an explicitly configured `CLIPROBIN_FACE_MODEL_DIR`, a local `onnxruntime` install, and model files the experimenter has rights to use. [YuNet license](backend/app/models/YUNET-LICENSE.txt) · [InsightFace model terms](https://github.com/deepinsight/insightface/tree/master/python-package#license)
- **Release check.** The v0.1.31 build stopped when the packaged backend failed to start. Uvicorn's log formatter needs a standard output stream during startup. The v0.1.32 package preserves those streams so Tauri can log to disk, and Tauri starts the engine without displaying a console window. GitHub Actions verifies health and an authenticated jobs request before building the signed NSIS installer and updater metadata. Public account email and Polar checkout require the hosted configuration above.

#### P1 Queue recovery, silent sources, and project ownership — Resolved on `fixes`

- **Original issue.** Page reload lost queued progress state, cancellation called `deleteProject()`, no retry button existed, deleted highest project IDs could be reused by late background jobs, and silent videos without an audio track failed in intake because `has_audio_stream()` raised `TypeError` when called without `ffmpeg_path`.
- **Implementation.** `QueueProvider` persists recoverable state, reconciles `processing` items on startup against `/api/jobs/active`, `/generation-jobs`, and `/clips`, separates `cancelled` from `failed`, preserves projects on cancellation, and provides **Retry** (with clear file re-selection messaging if raw `File` objects are gone). `project_manager.py` persists a monotonic `.next_project_seq` counter so deleted project IDs are not reused, writes a per-project `project_uid` UUID into `metadata.json` checked by `verify_project_ownership()`, and scopes generation & cancellation by `(project_id, project_dir, project_uid)`. `has_audio_stream(video_path, ffmpeg_path=None)` resolves `find_ffmpeg()` automatically so silent sources skip Whisper cleanly, mark `has_audio=False`, and slice via time-based segments rendered with `-an`.
- **Verification.** Covered by [`backend/tests/test_audit_regressions.py`](backend/tests/test_audit_regressions.py) (non-reused IDs, real FFmpeg silent video intake skipping Whisper & slicing time-based clips) and Playwright E2E Steps 4–5 (real silent H.264 upload -> `✓ Ready` -> Studio playback).
- **Code.** [Queue state and cancellation](frontend/src/lib/queue-context.tsx) · [Queue UI](frontend/src/components/video-queue-view.tsx) · [Project IDs](backend/app/services/project_manager.py) · [Download worker](backend/app/routes/download.py) · [Transcription](backend/app/services/transcriber.py)

#### P1 Local API and release security — Hardened on `fixes` (Tauri native build/keyring pending MSVC host)

- **Original issue.** Localhost API lacked per-session authentication and `Sec-Fetch-Site` enforcement, Tauri CSP was `null`, and watermark uploads only checked file magic bytes.
- **Implementation.** `backend/app/main.py` applies `enforce_local_api_security` inside outermost `CORSMiddleware`, rejecting disallowed `Origin` headers and `Sec-Fetch-Site: cross-site` (exempting `/api/youtube/oauth/callback`), and requiring `hmac.compare_digest` verification of `CLIPROBIN_API_TOKEN` via `X-ClipRobin-Token` header (or `?token=` strictly on read-only media GET routes). `frontend/src-tauri/src/lib.rs` generates a per-launch 32-byte `BCryptGenRandom` hex token for the sidecar + `backend_token` command (`src/lib/api.ts`), and `tauri.conf.json` configures a restrictive CSP (`frame-src 'none'; object-src 'none'; base-uri 'self'`). `routes/watermark.py` fully decodes uploads with Pillow (`Image.open().verify()` + decode, max `4096×4096`) before atomically replacing existing watermarks.
- **Verification & limits.** Verified by [`backend/tests/test_audit_regressions.py`](backend/tests/test_audit_regressions.py) & [`test_routes_watermark.py`](backend/tests/test_routes_watermark.py) (`Origin`, `Sec-Fetch-Site`, token auth, corrupt/oversized PNG preservation). Native `cargo` build/linking could not run on this workstation because MSVC `link.exe` is unavailable; OS-backed keyring storage for long-lived credentials and signed NSIS installer smoke tests remain for a MSVC-equipped Windows build host.
- **Code.** [FastAPI configuration](backend/app/main.py) · [Tauri shell](frontend/src-tauri/src/lib.rs) · [Tauri configuration](frontend/src-tauri/tauri.conf.json) · [Watermark upload](backend/app/routes/watermark.py) · [Updater UI](frontend/app/update-notice.tsx)

#### P2 Export, Settings, and social actions overstate current capabilities — Resolved on `fixes`

- **Original issue.** Copy claimed `1080×1920` / `4K 60FPS Ultra`, Settings stored dead preferences (`Video Defaults`, `Default project directory`, auto-open), and TikTok/Instagram modals exposed unused `Direct API` credential prompts while masking save/copy failures.
- **Implementation.** UI copy across Clip Settings, Settings, `PLAN_FEATURES`, and social modals now matches the actual `720×1280, 30 fps H.264/AAC MP4` export pipeline. Dead Settings controls and `Direct API` tabs/localStorage state were removed; TikTok/Instagram modals are clearly labeled **Prepare for TikTok** and **Prepare for Instagram** and surface export/clipboard errors directly in UI alerts.
- **Verification.** Verified via Playwright E2E Steps 7 & 10 and unit tests.
- **Code.** [Renderer](backend/app/services/video_editor.py) · [Settings](frontend/app/settings/page.tsx) · [Clip settings](frontend/src/components/clip-settings.tsx) · [Plan copy](frontend/src/lib/subscription-context.tsx) · [TikTok](frontend/src/components/tiktok-upload-modal.tsx) · [Instagram](frontend/src/components/instagram-upload-modal.tsx)

#### P2 GUI controls, state, and accessibility — Resolved on `fixes`

| Area | Fix implemented on `fixes` | Verification |
| --- | --- | --- |
| Local source **Change** | Kept `<input type="file">` mounted permanently outside conditional branches with a keyboard/mouse-accessible **Change** button (`app/page.tsx`). | Playwright Step 2 tests both mouse click and keyboard `Enter` replacement. |
| Studio stale project leakage | Keyed `<ProjectClipsContent key={projectId}>`, added request `AbortController`, and guarded mutating actions with `loadedProjectId === projectId` (`app/clips/page.tsx`). | Playwright Step 9 verifies switching between newly uploaded silent project and `project_001` cleanly with zero stale leak. |
| Dialogs, keyboard & switches | Built shared `<ModalDialog>` wrapper (`showModal()`, Escape, focus return, `overscroll-behavior: contain` per CSS) for all 5 dialogs; fixed `CaptionStylePicker` arrow navigation to cycle preview smoothly within `radiogroup` without yanking focus into `UpgradeModal`; labeled switches across Settings & Projects. | Playwright Steps 7, 8 & 10 exercise `<dialog>` Escape dismissal, `ArrowRight` across Locked/Free options in `CaptionStylePicker`, and named switch lookup. |
| Interval badges & card layout | Replaced fake `8.5/10` / `Mock analysis` with applied method (`Time Slice` / `Fast Interval`) and timestamps; placed clip index & duration badges above the player frame clear of watermarks and gave `<h3>` titles a dedicated row. | Playwright Step 5 asserts zero `8.5/10` or `Mock analysis` strings on `Time Slice` clips. |
| Live Engine Status | Added [`EngineStatus`](frontend/src/components/engine-status.tsx) backed by `GET /api/health`, displaying `Checking Engine…`, `Local Engine Ready`, or `Engine Unavailable` with manual `Retry`. | Playwright Step 1 verifies `Local Engine Ready`, and `--offline-check` verifies `Engine Unavailable` + `Retry` when backend stops. |

- **Code.** [Dashboard](frontend/app/page.tsx) · [Studio](frontend/app/clips/page.tsx) · [Modal dialog](frontend/src/components/ui/modal-dialog.tsx) · [Caption picker](frontend/src/components/caption-style-picker.tsx) · [Engine status](frontend/src/components/engine-status.tsx) · [Settings](frontend/app/settings/page.tsx) · [App layout](frontend/app/layout.tsx)

#### Release checklist remaining items

1. **MSVC Windows Build & Packaged Verification.** On a Windows build machine with MSVC `link.exe`, build the Tauri NSIS bundle and smoke-test launch, dynamic port + `X-ClipRobin-Token` auth handshake, updater notice, native Save As dialogs, and first-run Whisper model setup.
2. **Hosted Billing & Live External Flows.** Run Polar Sandbox checkout and webhook verification with Supabase Auth, real Gemini/YouTube OAuth test accounts, and qualitative multi-speaker real-footage framing evaluation.
3. **Keep release documentation aligned.** Verify `ai.md`, `README.md`, `frontend/README.md`, and `website.md` remain synchronized on every version bump via `npm run version:check`.

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

### Verification Results (`fixes` branch / v0.1.30)

| Check | Result and scope |
| --- | --- |
| Backend tests | **167 passed** across **22 `test_*.py` files** (including 6 new multi-scenario P0/P1 audit regression tests in `tests/test_audit_regressions.py` with real FFmpeg media). |
| Frontend tests & static checks | **11 passed** (`node --test` across `frontend/tests/`), TypeScript (`npx tsc --noEmit`), ESLint (`npm run lint`), and `npm run version:check` (`0.1.30`) all exited 0. |
| Production web build | `npm run build -- --webpack` exited 0 and exported static pages for `/`, `/clips`, `/projects`, `/settings`, `/subscription`, and `/_not-found`. |
| Playwright E2E browser walkthrough | **10/10 online steps + offline Engine Unavailable check exited 0** in headless Microsoft Edge against isolated ephemeral FastAPI (`uvicorn`) + static `frontend/out` + real FFmpeg silent & speech test videos: verified `EngineStatus`, mounted `Change` mouse + keyboard replacement, `Locked Crop` default + `25%` anchor CSS preview, silent video intake + `Time Slice` generation, single-clip `/reframe` (`0.75`), native `<ModalDialog>` `Prepare for TikTok` + `Escape`, `CaptionStylePicker` arrow navigation across `Classic` -> `Robin` -> `Clean` without `UpgradeModal` focus hijack, bidirectional project switching without stale leakage, Settings `720×1280` honesty + switch labels, and backend stop/offline `Engine Unavailable` UI. Zero unexpected HTTP `>=400` responses or page errors (filtering out Next 16 static-export `.__PAGE__.txt?_rsc=` prefetch probes that fall back cleanly to `.html`). |
| Native & external boundaries | Rust compilation (`cargo check --offline`) blocked locally because MSVC `link.exe` is unavailable on this workstation; Windows NSIS packaging, native `backend_token` IPC startup, native Save As dialogs, and auto-updater remain unverified until built on an MSVC host. Live YouTube OAuth, Gemini API keys, hosted Polar Sandbox checkout with Supabase, and qualitative multi-speaker real-footage evaluation still need manual verification. |

For a clean setup, install `pytest` as a development dependency before running the backend suite (`setup.ps1` installs backend runtime dependencies).

### Backend Test Inventory (22 Files — 167 Passing Tests)

| Test File | Target Modules | Key Coverage |
| :--- | :--- | :--- |
| `tests/test_audit_regressions.py` | Full-stack v0.1.28–v0.1.30 & `fixes` P0/P1 regressions | Chronological job sequence, mock v2 cache + `top_line` retention + language forwarding, partial transcript re-transcription, $O(N)$ `_smooth_and_simplify_segment` + `shots_tracked`/`shots_static` cache, isolated watermark decode/settings, YouTube OAuth XSS escaping + path traversal block, isolated atomic `gemini_config.json`, intro teaser relocation, real split-screen divider detection vs two-person shot, clip versioning + `no-cache`, **P0.1** route cancel/fail/orphan staging preservation + ZIP parity, **P0.2** traversal/drive/UNC + poisoned cached `analysis.json` containment, **P1.1** `Locked Crop` zero face scan + `/crop-preview` + single-clip `/reframe`, **P1.2** Dev Mode gate + 401/404/429/bad-JSON + log redaction + retry bypass, **P1.3/P1.4** non-reused IDs + real FFmpeg silent intake skipping Whisper, **P1.5** corrupt PNG preservation + CORS/`Sec-Fetch-Site`/`CLIPROBIN_API_TOKEN` enforcement. |
| `tests/test_ai_analyzer.py` | `services.ai_analyzer` | Transcript validation, overlap clamping, Gemini/OpenAI/DeepSeek formatting, markdown JSON parsing, boundary snapping, provider ID preservation & safe local ID allocation. |
| `tests/test_ass_captions.py` | `services.ass_captions` | ASS time formatting, escaping, hex-to-ASS BGR conversion, safe vertical positioning across all 25+ style/animation pairs, top-line overlay, font hardlink staging, karaoke tags. |
| `tests/test_caption_previews.py` | `scripts.build_caption_previews` | SHA-256 manifest freshness, existence of all MP4 previews & JPG posters, total size ceiling (`<=10 MB`). |
| `tests/test_caption_styles.py` | `services.caption_styles` | 6 styles registry, legacy aliases, animation defaults, bundled OFL & RTL/Devanagari font resolution. |
| `tests/test_clip_counter.py` | `clip_generator`, `mock_analyzer`, `clips` | `12s` slicing, `max_clips`/`clip_count` enforcement, `source_duration` metadata/ffprobe probing. |
| `tests/test_clip_generator.py` | `services.clip_generator`, `video_editor` | Job-owned `.staging_*` isolation, atomic commit & rollback, watermark and top-line burn-in, special-character escaping, 16:9/1:1/9:16 filtergraphs, silent render `-an` handling. |
| `tests/test_mock_analyzer.py` | `services.mock_analyzer` | Deterministic duration chunking, trailing orphan prevention, `analyzer_version: 2` schema. |
| `tests/test_process_utils.py` | `services.process_utils` | Windows `CREATE_NO_WINDOW` and `SW_HIDE` subprocess flags. |
| `tests/test_project_manager.py` | `services.project_manager` | Monotonic `.next_project_seq` sequential IDs, `project_uid` ownership verification, path traversal rejection, `CLIPROBIN_PROJECTS_DIR` override, `.staging_*` / `.rendering_*` exclusion. |
| `tests/test_routes_analysis.py` | `routes.analysis` | `/api/analyze`, `/api/ai/status`, `/api/ai/config`, `/api/ai/developer-mode` validation & error codes. |
| `tests/test_routes_clips.py` | `routes.clips` | Duration/framing/style/animation/tracking validation, 409 duplicate job guard, top-line CRUD, single-clip `/reframe`, `/crop-preview`, Save-As dialog MP4 & ZIP export, `?stage_job_id=` preview & `generation_options` hydration. |
| `tests/test_routes_download.py` | `routes.download` | YouTube host allowlist (`youtube.com`, `m.youtube.com`, `youtu.be`), failure cleanup, friendly local-file fallback message. |
| `tests/test_routes_health.py` | `routes.health` | `GET /api/health` returns `200` and `{"status": "healthy"}`. |
| `tests/test_routes_jobs.py` | `routes.jobs` | Aggregated active download, transcription, and generation job snapshots. |
| `tests/test_routes_local_video.py` | `routes.local_video` | Extension allowlist, multipart upload & `/from-path` transcription queueing, FIFO job eviction. |
| `tests/test_routes_projects.py` | `routes.projects` | Project listing, `PATCH` title rename in `metadata.json`, active job cancellation before `DELETE`. |
| `tests/test_routes_watermark.py` | `routes.watermark` | Custom watermark upload, full Pillow PNG decode & bounds validation, retrieval, deletion, position/opacity settings. |
| `tests/test_routes_webhooks.py` | Local API | Removed Paddle routes cannot activate or disclose a legacy subscription. Hosted billing behavior has separate frontend Node tests with provider and Auth fixtures. |
| `tests/test_smart_framing.py` | `services.smart_framing` | YuNet ONNX resolution, IoU tracking, VAD correlation, `locked`/`cuts`/`follow` crop expressions, divider detection, transcript-revision-aware cache. |
| `tests/test_transcriber_shim.py` | `services.transcriber` | CTranslate2 / `faster-whisper` transcription wrapper, silent-stream pre-check, bounded audio extraction, cancellation. |
| `tests/test_youtube.py` | `services.youtube_uploader`, `routes.youtube` | Google OAuth config/JSON parsing, auth URL state, token exchange/refresh, chunked resumable upload. |

---

## 7. Residual Edge Cases & Operational Notes

1. **Media & Codec Nuances**:
   - **Silent videos**: Videos without an audio stream skip Whisper at intake via `has_audio_stream()`, record empty segments (`has_audio=False`), slice cleanly via `Time Slice` intervals, and render with FFmpeg `-an`.
   - **10-Bit HDR Footage**: Converted via `format=yuv420p`; extreme BT.2020 HDR sources without tonemapping may appear slightly desaturated compared to SDR sources.
   - **RTL & Indic Scripts**: Supported in all 5 ASS-backed styles (`robin`, `clean`, `punch`, `pill`, `karaoke`) via `transcript.json` `"language"` forwarding into `NotoSansArabic-Bold.ttf` / `NotoSansDevanagari-Bold.ttf`. Note that legacy `"classic"` uses FFmpeg `drawtext`, so non-Latin creators should prefer `"robin"` or `"clean"`.
2. **External Network Boundaries**:
   - **YouTube Anti-Bot Challenges**: If YouTube blocks `yt-dlp` on restricted networks, `routes/download.py` surfaces clear guidance to drop a local video file instead.
   - **Cloud LLM errors**: Transient HTTP `429` and selected `5xx` responses trigger retries and candidate model fallback; terminal errors or Developer Mode restrictions surface readable fallback reasons (`ai_fallback_reason`) in Studio and allow explicit retry without serving stale interval caches.
3. **Storage & Lifecycle**:
   - **Project ID allocation & ownership**: `create_project()` uses a monotonic `.next_project_seq` file so deleted project IDs are not reused, writes a `project_uid` UUID into `metadata.json`, and guards project mutations/cleanup via `verify_project_ownership()`.
   - **Disk Space**: High-bitrate exports write to `%APPDATA%/com.cliprobin.desktop/projects` in desktop builds; users with low `C:` free space can override `CLIPROBIN_PROJECTS_DIR`.

---

## 8. AI Pair Programming Rules of Engagement

When modifying or extending the Clip Robin codebase, all AI models and contributors must observe the following constraints:

1. **Maintain the Local-First Privacy Boundary**: Keep raw video, audio tracks, and filesystem paths on device unless the user explicitly initiates an upload. Opt-in Hook Finder sends timestamped transcript text to Gemini through either the included-credit service or the user's own API key.
2. **Preserve Documentation Integrity**: Preserve existing docstrings, type annotations, and comments. Keep `ai.md`, `README.md`, `frontend/README.md`, and `website.md` synchronized when routes, versions, or schemas change.
3. **Cross-Platform & Frozen-Build Path Hygiene**: Always resolve runtime mutable files via `get_projects_dir()` / `CLIPROBIN_PROJECTS_DIR` (never write mutable state under `Path(__file__)`, which points to ephemeral `_MEIPASS` in PyInstaller builds). Use atomic temp-file + `os.replace()` for JSON persistence.
4. **Non-Blocking & Cancellable Execution**: Offload heavy media/network operations (`yt-dlp`, `faster-whisper`, `ffmpeg`, `cv2`) from request threads and honor `threading.Event` cancellation promptly.
5. **Version Manifest Synchronization**: Whenever bumping the application version, run `npm run version:set -- <x.y.z>` and `npm run version:check` inside `frontend/` so `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` stay strictly aligned.
