# Clip Robin — Frontend & Desktop Shell (`frontend/`)

This directory contains the **Next.js 16 (`16.3.5`) / React 19 (`19.2.8`)** user interface and the **Tauri v2 (`2.12.3`)** Windows desktop shell for **Clip Robin (v0.1.29)**.

For full system architecture, backend contracts, and on-disk schemas, see the root [`README.md`](../README.md) and [`ai.md`](../ai.md).

---

## Architecture Highlights

- **Static Desktop Export (`next.config.ts`)**: Builds with `output: "export"` into `frontend/out/`, which Tauri bundles directly into the native Windows WebView2 binary.
- **Dynamic Backend Port Discovery (`src/lib/api.ts`)**:
  - In web development (`npm run dev`), talks to `NEXT_PUBLIC_API_URL` or `http://127.0.0.1:8000`.
  - Inside Tauri desktop builds, invokes the Rust `backend_port` IPC command (`src-tauri/src/lib.rs`) to resolve the ephemeral loopback port bound by the spawned `cliprobin-api` sidecar.
- **Global State Providers (`app/layout.tsx`)**:
  - `SubscriptionProvider` (`src/lib/subscription-context.tsx`): Manages Free vs Pro tier gating, Paddle Billing v2 checkout (`src/lib/paddle.ts`), offline `ROBIN-PRO-*` license keys, and `/api/webhooks/paddle/status` synchronization.
  - `QueueProvider` (`src/lib/queue-context.tsx`): Orchestrates multi-video intake (YouTube URLs & local files), sequential transcription + clip generation, `AbortController` cancellation, and live progress updates.
- **Adaptive & Visibility-Aware Polling**: Background status hooks (`app/job-progress.tsx`, `app/projects/page.tsx`, `src/hooks/use-ai-developer-status.ts`) pause automatically when `document.hidden` is true, back off when idle (`4000ms`), accelerate while active (`1000ms`), and wake immediately on custom DOM events (`cliprobin:job-started`, `cliprobin:ai-status-changed`).

---

## Routes (`app/`)

| Route | File | Description |
| :--- | :--- | :--- |
| `/` | `app/page.tsx` | **Dashboard**: Local file drag-and-drop & YouTube URL tabs, unified `ClipSettings`, multi-video queue view, and sticky live 9:16 phone preview. |
| `/clips` | `app/clips/page.tsx` | **Clips Studio**: Responsive 9:16 player grid, exclusive audio coordination, `ClipModalViewer`, Top-Line hook editor, Regenerate toolbar, Save As MP4/ZIP export, and YouTube / TikTok / Instagram modals. |
| `/projects` | `app/projects/page.tsx` | **Projects Library**: Inline project rename (`PATCH /api/projects/{id}`), status badges, per-project regeneration panel (framing, duration, face tracking, captions, watermark), and safe deletion. |
| `/settings` | `app/settings/page.tsx` | **Settings**: Default clip preferences, Gemini **AI Developer Mode** (BYOK), Google OAuth2 YouTube channel connection, and custom brand watermark upload/position/opacity controls. |
| `/subscription` | `app/subscription/page.tsx` | **Subscription**: Free vs Pro feature comparison, Paddle Billing v2 checkout, and license key management. |

---

## Scripts & Verification

Run all commands from `frontend/` (on Windows PowerShell with restricted execution policies, invoke `npm.cmd` and `npx.cmd`):

```powershell
# Start Next.js dev server on http://localhost:3000
npm.cmd run dev

# Launch Tauri v2 Windows desktop app in dev mode
npx.cmd tauri dev

# Run Node unit tests (manifest sync + project-name validation)
npm.cmd test

# Type-check TypeScript without emitting files
npx.cmd tsc --noEmit

# Run ESLint across app/ and src/
npm.cmd run lint

# Verify version parity across package.json, Cargo.toml & tauri.conf.json
npm.cmd run version:check

# Bump version across all 3 manifests simultaneously
npm.cmd run version:set -- 0.1.29

# Build static production export into frontend/out/
npm.cmd run build
```

---

## Environment Variables (Optional)

Create `frontend/.env.local` for optional web/checkout overrides:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_PADDLE_ENV=sandbox
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_...
NEXT_PUBLIC_PADDLE_PRO_MONTHLY_PRICE_ID=pri_...
NEXT_PUBLIC_PADDLE_PRO_YEARLY_PRICE_ID=pri_...
```
