# Clip Robin — Frontend & Desktop Shell (`frontend/`)

This directory contains the **Next.js 16 (`16.4.6`) / React 19 (`19.2.8`)** user interface and the **Tauri v2 (`2.12.3`)** Windows desktop shell for **Clip Robin**.

For full system architecture, backend contracts, and on-disk schemas, see the root [`README.md`](../README.md) and [`ai.md`](../ai.md).

---

## Architecture Highlights

- **Static Desktop Export (`next.config.ts`)**: Builds with `output: "export"` into `frontend/out/`, which Tauri bundles directly into the native Windows WebView2 binary.
- **Dynamic Backend Port & Token Security (`src/lib/api.ts`)**:
  - In web development (`npm run dev`), talks to `http://127.0.0.1:8000` with explicit local origin and `Sec-Fetch-Site` validation on the backend.
  - Inside Tauri desktop builds, invokes the Rust `backend_port` and `backend_token` IPC commands (`src-tauri/src/lib.rs`) to resolve the ephemeral loopback port and per-launch API token (`X-ClipRobin-Token` / media query token) under a strict CSP (`tauri.conf.json`).
- **Global State Providers (`app/layout.tsx`)**:
  - `SubscriptionProvider` (`src/lib/subscription-context.tsx`) reads the signed-in user's plan from the hosted Supabase billing function. Free local editing works without an account.
  - `QueueProvider` (`src/lib/queue-context.tsx`): Orchestrates multi-video intake (YouTube URLs & local files), persists recoverable queue state and reconciles active backend jobs across reloads, cleanly separates `cancelled` from `failed` items with retry support without deleting existing projects, and runs sequential transcription + staged clip generation.
- **Adaptive & Visibility-Aware Polling**: Background status hooks (`app/job-progress.tsx`, `app/projects/page.tsx`, `src/hooks/use-ai-developer-status.ts`) pause automatically when `document.hidden` is true, back off when idle (`4000ms`), accelerate while active (`1000ms`), and wake immediately on custom DOM events (`cliprobin:job-started`, `cliprobin:ai-status-changed`).

---

## Routes (`app/`)

| Route | File | Description |
| :--- | :--- | :--- |
| `/` | `app/page.tsx` | **Dashboard**: Local file drag-and-drop & YouTube URL tabs, unified `ClipSettings`, multi-video queue view, and sticky live 9:16 phone preview. |
| `/clips` | `app/clips/page.tsx` | **Clips Studio**: Responsive `720×1280` 9:16 player grid, exclusive audio coordination, accessible native `<dialog>` `ClipModalViewer`, single-clip **Reframe** & crop preview, Top-Line hook editor, staged regeneration toolbar, Save As MP4/ZIP export, and YouTube / Prepare for TikTok & Instagram modals. |
| `/projects` | `app/projects/page.tsx` | **Projects Library**: Inline project rename (`PATCH /api/projects/{id}`), status badges, per-project regeneration panel (framing, 9:16 tracking mode, duration, captions, watermark), cancellation preserving prior clips, and safe deletion. |
| `/settings` | `app/settings/page.tsx` | **Settings**: Verified local preferences (confirm delete, default caption style), output specification summary, Gemini **AI Developer Mode** (BYOK with transcript disclosure), Google OAuth2 YouTube channel connection, and validated PNG/JPG/WebP brand watermark upload/position/opacity controls. |
| `/subscription` | `app/subscription/page.tsx` | Email sign-in, optional browser OAuth, Free and Pro plan comparison, and hosted Lemon Squeezy checkout and billing management. |

---

## Scripts & Verification

Run all commands from `frontend/` (on Windows PowerShell with restricted execution policies, invoke `npm.cmd` and `npx.cmd`):

```powershell
# Start Next.js dev server on http://localhost:3000
npm.cmd run dev

# Launch Tauri v2 Windows desktop app in dev mode
npx.cmd tauri dev

# Run Node unit tests, including the mocked billing flow (Node 24)
npm.cmd test

# Type-check TypeScript without emitting files
npx.cmd tsc --noEmit

# Run ESLint across app/ and src/
npm.cmd run lint

# Verify version parity across package.json, Cargo.toml & tauri.conf.json
npm.cmd run version:check

# Bump version across all 3 manifests simultaneously
npm.cmd run version:set -- 0.1.31

# Build static production export into frontend/out/
npm.cmd run build
```

---

## Environment Variables (Optional)

Copy [`.env.example`](.env.example) to `frontend/.env.local` to enable account sign-in. The [Supabase and Polar setup](../supabase/README.md) covers the public account page, email delivery, and server-only payment settings.
