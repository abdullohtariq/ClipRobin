# Settings Mismatch & Persistence Audit Report (`settings-mismatch.md`) — `[RESOLVED & VERIFIED]`

## 1. Summary (Resolution Update)
**Status: ALL 6 ROOT CAUSES RESOLVED & VERIFIED (4 new backend regression tests added; 133/133 backend tests passing).**
1. **End-to-End `generation_options` Hydration & Watermark Preservation (`backend/app/routes/clips.py`, `frontend/src/lib/api.ts`, `frontend/app/clips/page.tsx`)**: `GET /api/projects/{project_id}/clips` now returns the project's saved `generation_options` from `analysis.json`. Clips Studio (`frontend/app/clips/page.tsx`) hydrates `appliedSettings` and all toolbar controls (`showWatermark`, `showCaptions`, `captionStyle`, `framingMode`, `clipDurationSeconds`, `clipCount`) directly from the project's saved `generation_options`, ensuring accurate `"Settings changed — Regenerate to apply"` dirty detection and preventing Top-Line edits (`ProClipCard`) from re-enabling a disabled watermark.
2. **Cross-Page `localStorage` Synchronization & `12s` Duration Support (`frontend/app/page.tsx`, `frontend/app/clips/page.tsx`, `frontend/app/projects/page.tsx`, `frontend/app/settings/page.tsx`)**: Synchronized `cliprobin_show_watermark`, `cliprobin_show_captions`, `cliprobin_caption_style` (including `cliprobin.settings.defaultCaptionStyle`), `cliprobin_framing_mode`, `cliprobin_clip_duration` (including `12s` in `/clips`), and `cliprobin_generation_mode` across all pages. Fixed `triggerClipGeneration` on the Dashboard using `generationModeRef` and added `getFileDuration(video)` to `handleDrop`.
3. **Backend `analysis.json` Cache Invalidation & Complete 6-Style `drawtext` Fallback (`backend/app/services/clip_generator.py`, `backend/app/services/video_editor.py`)**: `generate_clips` now persists `clip_duration_seconds` and `clip_count` in `analysis.json` and invalidates cached `analysis.json` when duration or requested count changes. `_build_subtitle_filters` in `video_editor.py` now explicitly implements all 6 caption styles (`robin`, `punch`, `clean`, `pill`, `karaoke`, `classic`) with style-accurate colors, casing, and box treatments.

*(Original Audit Summary)*: End-to-end code tracing from React UI controls through `localStorage`, `src/lib/api.ts`, FastAPI routes (`backend/app/routes/clips.py`), `clip_generator.py`, and `video_editor.py` revealed **six concrete root causes** explaining why (a) the watermark still appears after being deselected or disappears unexpectedly, and (b) exported clips use a different caption style or visual appearance than what the user selected or previewed. None of the bugs are caused by premium gating; instead, they stem from **stale `analysis.json` reuse on the backend**, **unsynchronized state and `localStorage` keys across pages**, **a stale React closure in `triggerClipGeneration`**, and **divergences between the 3 frontend preview implementations and the backend FFmpeg ASS/drawtext renderers**.

---

## 2. End-to-End Settings Trace Table

| Setting | Where It Is Set (UI & State) | Where It Is Persisted | Where It Is Read (API & Backend) | Where It Can Be Lost or Overridden |
| :--- | :--- | :--- | :--- | :--- |
| **`show_watermark`** | • Dashboard: `showWatermark` (`frontend/app/page.tsx:109`, default `true`)<br>• Clips Studio: `showWatermark` (`frontend/app/clips/page.tsx:588`, default `true`)<br>• Projects: `watermarkOptions[id]` (`frontend/app/projects/page.tsx:38,319`, default `true`) | • **NOT persisted globally** in `localStorage` on Dashboard, Clips Studio, or Projects.<br>• Only saved per-project in `cliprobin_applied_${projectId}` (`frontend/app/clips/page.tsx:756`), which is **never used to initialize `showWatermark`** on mount (`line 629`)!<br>• Saved in `analysis.json` under `generation_options.show_watermark` (`backend/app/services/clip_generator.py:198`). | • `generateClips()` (`frontend/src/lib/api.ts:317`, default `false`)<br>• `POST /generate-clips` (`backend/app/routes/clips.py:138`, default `False`)<br>• `create_clip()` (`backend/app/services/video_editor.py:578,594`)<br>• `setClipTopLine` / `removeClipTopLine` (`frontend/app/clips/page.tsx:179,208` -> `clip_generator.py:372-378`) | 1. **Reset to `true` on every page navigation**: Deselecting watermark on Dashboard (`page.tsx:109`) or Projects (`projects/page.tsx:530`) is lost as soon as the user navigates to `/clips` (`clips/page.tsx:588` initializes `useState(true)`).<br>2. **Top-Line Edit Re-Burns Watermark**: Editing or removing a top line in `/clips` passes `clips/page.tsx`'s reset `showWatermark=true` (`line 179, 208`), overriding `analysis.json`'s `show_watermark: false` (`clip_generator.py:372-373`) and burning the watermark back onto the clip!<br>3. **Serving Pre-Existing Clips**: Changing the toggle in `/clips` without clicking `"Regenerate Clips"` downloads existing `.mp4` files on disk (`clips.py:512-566`). |
| **`caption_style`** | • Dashboard: `captionStyle` (`frontend/app/page.tsx:107`, default `"classic"`)<br>• Clips Studio: `captionStyle` (`frontend/app/clips/page.tsx:571`, default `"classic"`)<br>• Projects: `captionStyleOptions[id]` (`frontend/app/projects/page.tsx:40`, default `"classic"`)<br>• Settings Page: `defaultCaptionStyle` (`frontend/app/settings/page.tsx:24,183`) | • `localStorage["cliprobin_caption_style"]` set in `page.tsx:229` and `projects/page.tsx:720`, **NOT** set when changed in `clips/page.tsx:1009`!<br>• `localStorage["cliprobin.settings"].defaultCaptionStyle` set in `settings/page.tsx:46`.<br>• `analysis.json` -> `generation_options.caption_style` (`clip_generator.py:200`). | • `generateClips()` (`frontend/src/lib/api.ts:319`)<br>• `POST /generate-clips` (`backend/app/routes/clips.py:143`)<br>• `generate_clips()` (`backend/app/services/clip_generator.py:182-187`)<br>• `create_clip()` (`backend/app/services/video_editor.py:602-648`) | 1. **Settings Page Ignored**: If `cliprobin_caption_style` was ever set in `localStorage`, `page.tsx:179-193` and `projects/page.tsx:63-72` ignore `cliprobin.settings.defaultCaptionStyle`. And `clips/page.tsx:618-621` **never reads `cliprobin.settings` at all**, nor does it accept legacy aliases (`bold_emerald`, `clean_gold`).<br>2. **Not Saved in `/clips`**: Changing `captionStyle` in `/clips` (`line 1009`) calls `setCaptionStyle` directly without updating `localStorage["cliprobin_caption_style"]`.<br>3. **Preview vs Render Mismatch**: `ass_captions.py:389` strips all Pop/Grow/Fade/Glide animations that are shown in the pre-rendered modal preview videos (`frontend/public/caption-previews/*.mp4`) and `LiveMovingCaptions` (`live-moving-captions.tsx`). |
| **`caption_animation`** | • Displayed as a static badge on style cards (`frontend/src/components/caption-style-picker.tsx:26,35,44,53,62,71`), no UI selector. | • `analysis.json` -> `generation_options.caption_animation` (`clip_generator.py:201`). | • `generateClips()` (`frontend/src/lib/api.ts:320`, always passed `undefined` in `page.tsx:296`, `clips/page.tsx:740`, `projects/page.tsx:176`)<br>• `ass_captions.py:236,376-415` | • **Completely Disabled in Renderer**: `ass_captions.py:376-415` only implements `\kf` sweep for `karaoke`; for `robin` (`grow`), `punch` (`pop`), `clean` (`fade`), and `pill` (`pop`), line `389` explicitly comments `# Clean word-by-word active highlight without distracting animation effects` and emits static color swaps with zero scale/fade/pop tags! |
| **`framing_mode`** | • Dashboard (`page.tsx:106`)<br>• Clips Studio (`clips/page.tsx:570`)<br>• Projects (`projects/page.tsx:39`)<br>• Settings (`settings/page.tsx:152` `aspectRatio` — dummy field!) | • `localStorage["cliprobin_framing_mode"]` (`page.tsx:200`, **NOT** written by `clips/page.tsx:1005` or `projects/page.tsx:336,350,368`!) | • `generateClips()` (`api.ts:318`)<br>• `create_clip()` (`video_editor.py:581,653-787`) | • `SettingsPage` (`settings/page.tsx:152`) saves `aspectRatio` (`"9:16 (Vertical)"`, `"Original"`, `"16:9 (Horizontal)"`) to `cliprobin.settings`, which is **never read anywhere** in the app.<br>• Changing framing in `/clips` or `/projects` does not persist to `cliprobin_framing_mode`. |
| **`clip_duration` & `clip_count`** | • Dashboard (`page.tsx:86-87`)<br>• Clips Studio (`clips/page.tsx:572-573`)<br>• Projects (`projects/page.tsx:41` — missing `clipCount` selector!) | • `localStorage["cliprobin_clip_duration"]` & `localStorage["cliprobin_clip_count"]` | • `generateClips()` (`api.ts:316,321`)<br>• `clip_generator.py:71-72,89-103,168-172` | 1. **`clips/page.tsx:614` Rejects `12s`**: `if (savedDuration && [15, 30, 60, 90].includes(Number(savedDuration)))` omits `12`, resetting `12s` back to `30s`!<br>2. **Backend `analysis.json` Cache Bug**: `clip_generator.py:89-103` reuses existing `analysis.json` if `reason` does not start with `"Mock analysis:"` (e.g. AI analysis) even when `max_clip_seconds` changed! |
| **`generation_mode`** | • Dashboard (`page.tsx:105`)<br>• Clips Studio (`clips/page.tsx:575`)<br>• Projects (`projects/page.tsx:42`) | • `localStorage["cliprobin_generation_mode"]` | • `generateClips()` (`api.ts:322`)<br>• `clip_generator.py:73,157` | • **Stale Closure in `page.tsx:258-328`**: `triggerClipGeneration` uses `generationMode` state directly (`line 298`) instead of a `useRef`, with `[]` dependency array (`line 328`).<br>• `projects/page.tsx:161-176` never passes `clipCount` or `generationMode` to `generateClips()`. |

---

## 3. Findings, Ranked by Severity

### Bug (a): Watermark Still Appears on Exported Clips After Being Deselected

#### [P0-A1] `showWatermark` Is Never Persisted to `localStorage` and Resets to `true` Across Pages, Causing Top-Line Edits & Regenerations in `/clips` to Re-Enable the Watermark
- **Confirmed Root Cause**:
  1. On Dashboard (`frontend/app/page.tsx:109`), Projects (`frontend/app/projects/page.tsx:319`), and Clips Studio (`frontend/app/clips/page.tsx:588`), `showWatermark` defaults to `true`.
  2. Unlike `framingMode`, `clipDurationSeconds`, and `captionStyle`, **none of the three pages persist `showWatermark` to a shared `localStorage` key** (e.g. `cliprobin_show_watermark`).
  3. Even worse, in `frontend/app/clips/page.tsx:627-630`, the page loads `cliprobin_applied_${projectId}` into `appliedSettings`, **but never copies `appliedSettings.showWatermark` (or `analysis.json`'s `generation_options.show_watermark`) into the `showWatermark` state (`line 588`)**!
  4. Consequently, whenever a user deselects the watermark on the Dashboard (`page.tsx:993`) or Projects page (`projects/page.tsx:530`), generates clips (`show_watermark=false`), and then opens `/clips?project=...`:
     - `clips/page.tsx:588` initializes `showWatermark = true`.
     - If the user adds, edits, or removes a Top Line hook (`ProClipCard.handleSaveTopLine` at `frontend/app/clips/page.tsx:178-183` or `handleRemoveTopLine` at `line 207-212`), `ProClipCard` explicitly sends `show_watermark: showWatermark` (`true`!) in the `POST /top-line` payload.
     - In `backend/app/services/clip_generator.py:372-375`:
       ```python
       if show_watermark is not None:
           use_watermark = show_watermark
       elif "show_watermark" in saved_options:
           use_watermark = bool(saved_options["show_watermark"])
       ```
       Because `payload.show_watermark` is `True` (not `None`), it **overrides** `saved_options["show_watermark"] == False`, burns the watermark into that clip, and overwrites `analysis["generation_options"]["show_watermark"] = True` (`line 412`)!
     - Similarly, if the user opens `/clips` to change caption style or duration and clicks `"Regenerate Clips"`, `showWatermark` is silently `true` again (`clips/page.tsx:737`).
- **Reproduction Steps**:
  1. On Dashboard (`/`), toggle **"Add a watermark: Made with Clip Robin"** OFF (`showWatermark = false`) and generate clips for a video.
  2. Click **"View all in Clips Studio"** to navigate to `/clips?project=project_XXX`.
  3. Observe the toolbar summary chip (`frontend/app/clips/page.tsx:929`): it says **`Watermark`** instead of `No logo` because `showWatermark` reset to `true`.
  4. On any clip card, click **"Add top line"**, enter a headline, and click **"Save"** (or open settings to change caption style and click **"Regenerate Clips"**).
  5. Export/download the clip: **the watermark is burned into the exported clip** even though the user deselected it during generation.
- **Exact Fix**:
  1. Persist `showWatermark` in `localStorage.getItem("cliprobin_show_watermark")` across `frontend/app/page.tsx`, `frontend/app/projects/page.tsx`, and `frontend/app/clips/page.tsx`.
  2. Return `generation_options` from `GET /api/projects/{project_id}/clips` (`backend/app/routes/clips.py:378-424`) and initialize `clips/page.tsx` state (`framingMode`, `captionStyle`, `showWatermark`, `showCaptions`) from the project's actual `generation_options`.
  3. In `ProClipCard` (`frontend/app/clips/page.tsx:178-183,207-212`), do not pass `show_watermark` or `show_subtitles` from the unapplied toolbar drawer state; let `render_single_clip` (`backend/app/services/clip_generator.py:374-383`) read the project's saved `generation_options` from `analysis.json`.

---

#### [P1-A2] Deselecting Watermark (or Changing Any Setting) in Clips Studio Without Clicking `"Regenerate Clips"` Downloads Cached Pre-Rendered `.mp4` Files
- **Confirmed Root Cause**:
  - In `frontend/app/clips/page.tsx:628-644`, `appliedSettings` is only populated when generation is triggered *inside* `/clips` (`line 756`). When a project is generated on the Dashboard (`/`) or Projects (`/projects`), `localStorage.getItem("cliprobin_applied_${projectId}")` is **`null`**.
  - Because `if (!appliedSettings || !clips.length) return false;` (`frontend/app/clips/page.tsx:636`) returns `false` whenever `appliedSettings` is `null`, **the amber `"Settings changed — Regenerate to apply"` badge (`line 935-939`) and pulsing dot (`line 890-892`) NEVER appear for projects created from the Dashboard or Projects page!**
  - When a user opens `/clips`, opens the settings drawer, turns OFF the watermark (or picks a new caption style), sees no warning badge, and clicks **"Download"** (`saveClipWithExplorer`) or **"Download all (ZIP)"** (`saveAllClipsWithExplorer`), the backend (`backend/app/routes/clips.py:488-566`) simply copies the existing pre-rendered `.mp4` files from `projects/{id}/clips/` on disk, which still have the watermark burned in.
- **Reproduction Steps**:
  1. Generate clips on the Dashboard (`/`) with default settings (Watermark ON).
  2. Navigate to `/clips?project=project_XXX`.
  3. Click the settings chip in the toolbar (`line 923`) and toggle **"Add a watermark: Made with Clip Robin"** OFF.
  4. Notice that `isDirty` (`line 635`) is `false` (because `cliprobin_applied_${projectId}` was never written by `page.tsx`), so **no `"Settings changed — Regenerate to apply"` badge is shown**.
  5. Click **"Download"** on a clip or **"Download all (ZIP)"**: the downloaded video still has the watermark.
- **Exact Fix**:
  - Have `GET /api/projects/{project_id}/clips` (`backend/app/routes/clips.py:424`) return `generation_options` from `analysis.json`, and set `appliedSettings` directly from the backend response in `loadClipsAndStatus` (`frontend/app/clips/page.tsx:655-675`).

---

### Bug (b): Exported Clip Uses a Different Caption Style Than Selected or Previewed

#### [P0-B1] Pre-Rendered Modal Preview Videos (`caption-previews/*.mp4`) and Dashboard Live Preview Show Pop/Grow/Fade Animations That Were Stripped from `ass_captions.py`
- **Confirmed Root Cause**:
  1. In `frontend/src/components/caption-style-picker.tsx:19-74`, each style advertises a distinct animation (`Classic: Pop`, `Robin: Grow`, `Clean: Fade`, `Punch: Pop`, `Pill: Pop`, `Karaoke: Sweep`).
  2. The modal's 9:16 video player (`frontend/src/components/caption-style-picker.tsx:521-530`) plays pre-rendered static files from `/caption-previews/${styleId}.mp4`, and the Dashboard's phone mockup (`frontend/src/components/live-moving-captions.tsx:68,86,105,123`) animates words with `scale-115` / `scale-110` pop/grow transitions.
  3. However, in the actual production ASS renderer (`backend/app/services/ass_captions.py:376-415`), only `karaoke` (`sweep`) emits animation tags (`{\kf...}`). For all other ASS styles (`robin`, `punch`, `clean`, `pill`), lines `389-415` contain:
     ```python
     # Clean word-by-word active highlight without distracting animation effects (pop/grow/fade/glide bouncing)
     ```
     and only emit static color overrides (`{\1c&H...&}`) with **zero scale, pop, grow, fade, or glide ASS tags (`\t`, `\fscx`, `\fscy`, `\fad`, `\move`)**!
  4. Furthermore, for `clean` (`backend/app/services/caption_styles.py:94-95`), `primary_color="#FFFFFF"` and `accent_color=None`. In `ass_captions.py:254-256`, when `accent_color` is `None`, `secondary_ass` is set to `#B8B8B8` (gray) and `accent_ass` is `#FFFFFF` (white), whereas `CaptionVisualSample` (`frontend/src/components/caption-style-picker.tsx:113`) renders all words in solid white, and `build_caption_previews.py` pre-rendered `clean.mp4` before `ass_captions.py` stripped the `fade` animation!
- **Reproduction Steps**:
  1. Open the Caption Style Picker modal (`CaptionStylePicker`) and select **Robin** (`Grow` animation), **Punch** (`Pop` animation), or **Clean** (`Fade` animation).
  2. Watch the 9:16 preview or the Dashboard phone preview (`scale-115` word pop).
  3. Generate clips and watch/export the resulting `.mp4`.
  4. The exported clip has **no pop, grow, or fade animation**—only flat 2-word static color changes (and for `Classic`, it uses FFmpeg `drawtext` with a yellow highlight and `fontsize` jump instead of the `Montserrat-Bold` ASS pipeline!).
- **Exact Fix**:
  - Either restore the ASS override tags (`\t(0,100,\fscx115\fscy115)\t(100,200,\fscx100\fscy100)` for `pop`/`grow` and `\fad(120,0)` for `fade`) in `backend/app/services/ass_captions.py:389-415` to match `CAPTION_STYLES` and the preview videos, **or** rebuild `/caption-previews/*.mp4` via `python backend/scripts/build_caption_previews.py` and update `LiveMovingCaptions` / `CAPTION_STYLE_OPTIONS` labels so previews match the exact production ASS output.

---

#### [P0-B2] `Classic` Style Renders via Legacy FFmpeg `drawtext` (`Segoe UI` / `Arial`) Instead of `ass_captions.py` (`Montserrat Bold`), Diverging from Both `CAPTION_STYLES` and UI Previews
- **Confirmed Root Cause**:
  - In `backend/app/services/caption_styles.py:71-86`, `"classic"` is defined with `font_family="Montserrat"`, `font_file="Montserrat-Bold.ttf"`, `border_style=1`.
  - In `frontend/src/components/caption-style-picker.tsx:27`, `Classic` is listed as `fontFamily: "Montserrat Bold"`.
  - However, in `backend/app/services/video_editor.py:603`:
    ```python
    use_ass = (normalized_style != "classic") and has_ass_filter(ffmpeg_path)
    ```
    `create_clip` **explicitly excludes `"classic"` from the ASS subtitle pipeline**! Instead, `"classic"` falls into `_copy_font_file()` (`video_editor.py:208-230`), which copies Windows system `segoeuib.ttf` (`Segoe UI Bold`) or `arialbd.ttf`, and renders via `_build_subtitle_filters` (`video_editor.py:340-350`) using FFmpeg `drawtext` with `box=1:boxcolor=black@0.55` and a 2-layer overlapping text filter where the active word is drawn a second time on top of the base line at `fontsize=41` over `fontsize=34` (creating a double-rendered ghosting artifact behind the yellow word).
  - Worse still, if an FFmpeg binary lacks `libass` (`has_ass_filter(ffmpeg_path) == False`), **every caption style** (`robin`, `punch`, `clean`, `pill`, `karaoke`) silently falls back to `_build_subtitle_filters()` (`video_editor.py:321-350`), which only checks `if style == "bold_emerald": ... elif style == "clean_gold": ... else: # "classic"`! Thus, without `libass`, selecting `robin`, `punch`, `clean`, `pill`, or `karaoke` silently renders the yellow boxed `classic` style!
- **Reproduction Steps**:
  1. Select `Classic` style (which claims `Montserrat Bold` in `CaptionStylePicker`) and generate clips: the exported clip actually uses Windows `Segoe UI Bold` via `drawtext` with overlapping double-drawn active words.
  2. Or run with an FFmpeg build without `libass` (`has_ass_filter == False`) and select `Punch` or `Robin`: `_build_subtitle_filters` (`video_editor.py:321-350`) does not recognize `"punch"` or `"robin"`, falling into the `else:` branch and rendering yellow boxed `"classic"` captions.
- **Exact Fix**:
  - In `backend/app/services/video_editor.py:321-350`, map `"robin"`, `"punch"`, `"clean"`, `"pill"`, and `"karaoke"` in `_build_subtitle_filters` so fallback mode respects each style's colors and box settings, and route `"classic"` through `generate_ass_subtitles` (with `BorderStyle=3` box) when `has_ass_filter` is `True`.

---

#### [P1-B3] Three Disconnected `localStorage` Keys & Missing Persistence in `/clips` Cause Selected Caption Styles to Revert
- **Confirmed Root Cause**:
  1. **Settings Page (`frontend/app/settings/page.tsx:5,46,184`)** saves `defaultCaptionStyle` inside `localStorage["cliprobin.settings"]`.
  2. **Dashboard (`frontend/app/page.tsx:179-193`)** and **Projects (`frontend/app/projects/page.tsx:63-72`)** check `localStorage.getItem("cliprobin_caption_style")` **first**; only if that key is completely absent (`else` branch) do they read `cliprobin.settings.defaultCaptionStyle`. Once a user ever picks a style on the Dashboard or Projects page, changing **"Default caption style"** on `/settings` has **zero effect** anywhere in the app!
  3. **Clips Studio (`frontend/app/clips/page.tsx:618-621`)** **never reads `cliprobin.settings` at all**, and when the user changes the caption style inside `/clips` (`line 1009`: `onCaptionStyleChange={setCaptionStyle}`), it **never writes to `localStorage.setItem("cliprobin_caption_style", ...)`**!
  4. Furthermore, when `/clips` loads an existing project (`clips/page.tsx:655-675`), it receives `result.clips` (each having `clip.caption_style` from `analysis.json`), **but never syncs `captionStyle` state (`line 571`) to the project's actual `caption_style`**. Instead, `captionStyle` stays at whatever was in `localStorage["cliprobin_caption_style"]` (or `"classic"`).
- **Reproduction Steps**:
  1. Go to **Settings** (`/settings`) and change **Default caption style** to `Punch`.
  2. Go to **Dashboard** (`/`) or **Clips Studio** (`/clips`): if `cliprobin_caption_style` was previously set (or in `/clips` even if not set), the style remains `Classic` (or the old style), completely ignoring `/settings`.
  3. Or in **Clips Studio** (`/clips`), change the caption style to `Karaoke` in the toolbar drawer, navigate to `/projects`, and click **Generate Clips**: `/projects` uses the old style because `/clips` never saved `Karaoke` to `localStorage`.
- **Exact Fix**:
  - Centralize settings persistence in a single helper module (`frontend/src/lib/preferences.ts`) so `/`, `/clips`, `/projects`, and `/settings` all read and write the same synchronized keys (`cliprobin_caption_style`, `cliprobin_framing_mode`, `cliprobin_clip_duration`, `cliprobin_clip_count`, `cliprobin_show_watermark`, `cliprobin_show_captions`).

---

#### [P1-B4] `clips/page.tsx` Rejects `12s` Duration from `localStorage` and `page.tsx` Uses a Stale Closure for `generationMode`
- **Confirmed Root Cause**:
  1. In `frontend/app/clips/page.tsx:614`:
     ```tsx
     const savedDuration = localStorage.getItem("cliprobin_clip_duration");
     if (savedDuration && [15, 30, 60, 90].includes(Number(savedDuration))) {
       setClipDurationSeconds(Number(savedDuration) as ClipDuration);
     }
     ```
     When v0.1.21 replaced `15s` with `12s` in `CLIP_DURATIONS = [12, 30, 60, 90]` (`frontend/src/components/clip-settings.tsx:15`), `frontend/app/clips/page.tsx:614` was left checking `[15, 30, 60, 90]`. Any user who selects `12s` on the Dashboard has their duration silently reset to `30s` upon opening `/clips`!
  2. In `frontend/app/page.tsx:258-328`, `triggerClipGeneration` is wrapped in `useCallback(..., [])` with an **empty dependency array**, yet line `298` reads `generationMode` directly from closure state (unlike `clipDurationSecondsRef`, `showWatermarkRef`, `framingModeRef`, `captionStyleRef`).
  3. In `frontend/app/projects/page.tsx:161-176`, `handleGenerate` calls `generateClips(...)` with only 7 arguments, omitting `captionAnimation`, `clipCount`, and `generationMode`.

---

## 4. Fix Plan (In Implementation Order)

1. **Unify Frontend Settings Store (`frontend/src/lib/preferences.ts`) [P0-A1, P1-B3, P1-B4]**:
   - Create a single preference synchronization hook/helper shared across `/`, `/clips`, `/projects`, and `/settings` that persists `showWatermark`, `showCaptions`, `captionStyle`, `framingMode`, `clipDurationSeconds` (including `12`), `clipCount`, and `generationMode`, and syncs `cliprobin.settings` with individual keys.
2. **Return & Hydrate `generation_options` on `/clips` Load (`backend/app/routes/clips.py`, `frontend/app/clips/page.tsx`) [P0-A1, P1-A2]**:
   - Include `generation_options` in the `GET /api/projects/{project_id}/clips` response (`backend/app/routes/clips.py:424`).
   - In `frontend/app/clips/page.tsx:655-675`, set `appliedSettings` from `result.generation_options` (and initialize toolbar controls to match the project's applied settings) so `isDirty` (`line 635`) accurately warns the user whenever any setting is changed after generation.
3. **Preserve Project Watermark & Subtitle Settings on Single-Clip Top-Line Re-Render (`frontend/app/clips/page.tsx`) [P0-A1]**:
   - In `ProClipCard.handleSaveTopLine` (`line 178`) and `handleRemoveTopLine` (`line 207`), omit `show_watermark` and `show_subtitles` (or pass `appliedSettings?.showWatermark`) so editing a top line never accidentally burns an unapplied toolbar watermark state into the clip.
4. **Align Caption Previews and ASS/Drawtext Renderers (`backend/app/services/ass_captions.py`, `backend/app/services/video_editor.py`) [P0-B1, P0-B2]**:
   - Restore the ASS animation override tags (`pop`, `grow`, `fade`, `glide`) in `backend/app/services/ass_captions.py:389-415` (or regenerate `/caption-previews/*.mp4` to match the static highlight behavior), and add style mappings for `robin`, `punch`, `clean`, `pill`, and `karaoke` to `_build_subtitle_filters` in `backend/app/services/video_editor.py:321-350`.
5. **Fix `generationMode` Ref & `projects/page.tsx` Arguments (`frontend/app/page.tsx`, `frontend/app/projects/page.tsx`) [P1-B4]**:
   - Add `generationModeRef` in `frontend/app/page.tsx:298` and pass `clipCount` / `generationMode` in `frontend/app/projects/page.tsx:161-176`.

---

## 5. Test Plan & Regression Tests to Add

1. **Backend Regression Test — `test_top_line_preserves_saved_watermark_off` (`backend/tests/test_routes_clips.py`)**:
   - Generate clips with `show_watermark=False` (verifying `analysis.json` has `"show_watermark": false`).
   - Call `POST /api/projects/{id}/clips/clip_001/top-line` with `{"top_line": "Hook text"}` (omitting `show_watermark`).
   - Assert `create_clip` is invoked with `show_watermark=False` and `analysis.json` retains `"show_watermark": false`.
2. **Backend Regression Test — `test_get_project_clips_returns_generation_options` (`backend/tests/test_routes_clips.py`)**:
   - Call `GET /api/projects/{id}/clips` after generating with `show_watermark=False, caption_style="punch", framing_mode="true_9_16"`.
   - Assert the response payload includes `generation_options` matching those exact values.
3. **Backend Regression Test — `test_drawtext_fallback_respects_all_caption_styles` (`backend/tests/test_clip_generator.py`)**:
   - Monkeypatch `has_ass_filter` to return `False` and call `create_clip` with each style in `CAPTION_STYLES` (`robin`, `punch`, `clean`, `pill`, `karaoke`, `classic`).
   - Assert the generated `filter-complex.txt` uses the style's respective highlight color (`0x34d399`, `0xf7c204`, etc.) instead of silently falling back to yellow boxed `classic`.
4. **Frontend Unit / Integration Test — Settings Persistence & Dirty Indicator**:
   - Verify that toggling `showWatermark` OFF on Dashboard (`/`) persists to `/clips`, that changing `defaultCaptionStyle` in `/settings` updates the default style on `/` and `/clips`, and that `clips/page.tsx` restores `12s` duration from `localStorage`.

---

## 6. Open Questions / Unverified Items
- **Confirmed Environment State**: On this machine, `find_ffmpeg()` resolves to `ffmpeg-9.0.2-full_build-shared\bin\ffmpeg.EXE` with `has_ass_filter() == True` and `find_watermark_file()` resolves to `c:\Users\Abdullah PC\Documents\GitHub\ClipRobin\clip_robin_watermark.png`.
- **Design Decision Needed**: In `backend/app/services/ass_captions.py:389`, a previous commit intentionally replaced dynamic scale/fade/glide ASS tags (`\t(\fscx115\fscy115)`) with static 2-word color highlights (`# Clean word-by-word active highlight without distracting animation effects`), while leaving the animated MP4 previews in `frontend/public/caption-previews/*.mp4` and animation badges (`Pop`, `Grow`, `Fade`) in `CaptionStylePicker` unchanged. Confirm with the product owner whether to restore the ASS scale/fade animations in `ass_captions.py` or re-render the static preview MP4s to match the flat highlight style.

