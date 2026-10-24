# Responsive & Screen-Size Audit Report (`responsive-ui.md`) — `[RESOLVED & VERIFIED]`

## 1. Summary (Resolution Update)
**Status: ALL P0/P1/P2 FINDINGS RESOLVED & VERIFIED.**
1. **Responsive Navigation Shell (`frontend/app/layout.tsx`, `frontend/app/sidebar-nav.tsx`)**: Replaced the permanently pinned `w-64` (`256px`) sidebar with a responsive 3-tier navigation layout (`flex-col md:flex-row`): a compact horizontal top bar below `md` (`768px`), a `w-16` (`64px`) icon rail from `md` to `xl` (`768px–1279px`), and the full `w-64` (`256px`) sidebar at `xl+` (`>=1280px`).
2. **Container-Query Settings & Deferred Dashboard Split (`frontend/app/page.tsx`, `frontend/src/components/clip-settings.tsx`)**: Deferred the Dashboard's 2-column preview split until `xl:` (`grid-cols-1 xl:grid-cols-[1fr_340px] 2xl:grid-cols-[1fr_400px]`), made the YouTube URL row stack cleanly on narrow viewports (`flex-col sm:flex-row` with `min-w-0`), and wrapped `ClipSettings` in `@container` using `@lg:grid-cols-3` and `@md:grid-cols-2` container queries.
3. **Auto-Fill Grid, Short-Height Modal Scrolling & DPI-Aware Typography (`frontend/app/clips/page.tsx`, `frontend/src/components/caption-style-picker.tsx`, `frontend/app/window-init.tsx`, `frontend/app/job-progress.tsx`)**: Converted the Clips Studio grid to `grid-cols-[repeat(auto-fill,minmax(220px,1fr))]`, added `max-h-[60vh] overflow-y-auto` to the sticky settings drawer, constrained `CaptionStylePicker` and `ClipModalViewer` 9:16 video players on `<768px` / `1366x768` viewports, guarded `WindowInit` maximize with `sessionStorage`, added `focus-within:opacity-100` to player overlay controls, and promoted `text-[8px]`–`text-[11px]` micro-labels to `text-xs` (`12px`).

*(Original Audit Summary)*: Clip Robin's desktop shell (`frontend/src-tauri/tauri.conf.json:18-19`) enforces a minimum window size of `960x640` and launches maximized (`1280x800`), while its Next.js layout permanently pinned a `256px` (`w-64`) sidebar (`frontend/app/layout.tsx:30`). Because the sidebar never collapsed into a drawer or compact rail, viewports between `320px` and `768px` (or high-DPI Windows laptops at `150%–200%` scaling) left as little as `64px–512px` for the main content pane, causing horizontal clipping and grid crowding. Furthermore, `lg:` (`1024px`) and `sm:` (`640px`) Tailwind breakpoints evaluated against the **full window width** rather than the remaining main-pane width (`windowWidth - 256px`), causing premature multi-column expansion on `1024px–1280px` screens and vertical clipping inside fixed-height modals (`h-[88vh]`, `max-h-[90vh]`) on `1366x768` laptops.

---

## 2. Findings, Ranked by Severity

### Behavior Matrix Across Target Widths & Scaling

| Viewport / Environment | Effective Main Pane (`W - 256px`) | Overall Behavior Summary |
| :--- | :--- | :--- |
| **320px, 375px, 414px** (Mobile / Narrow Split) | `64px`, `119px`, `158px` | **Broken (P0)**: Permanently pinned `w-64` (`256px`) sidebar consumes 62%–80% of the viewport (`frontend/app/layout.tsx:30`); main content is crushed and controls overflow horizontally. |
| **768px** (Tablet / 1536px @ 200% DPI) | `512px` | **Degraded (P0/P1)**: `sm:` (`640px`) breakpoints fire because `768px >= 640px`, forcing 2-column and 3-column grids (`frontend/src/components/clip-settings.tsx:86,164`) into a `512px` content column (`~145px` per card). |
| **1024px** (Compact Desktop / 1536px @ 150% DPI) | `768px` | **Degraded (P1)**: `lg:grid-cols-[1fr_380px]` on Dashboard (`frontend/app/page.tsx:698`) reserves `380px` for the preview aside + `32px` gap + `80px` padding, leaving only `276px` for the left settings column (`ClipSettings` 3-column row overflows). |
| **1280px** (Default Tauri Window / 1920px @ 150% DPI) | `1024px` | **Mostly Functional (P1/P2)**: Dashboard left column gets `~532px`; Clips Studio `lg:grid-cols-4` (`frontend/app/clips/page.tsx:1137`) renders 4 cards at `~224px` each, causing action button text (`"Download"` + `"Edit top line"`) to wrap or crowd (`frontend/app/clips/page.tsx:431-451`). |
| **1366x768** (Short-Height Laptop @ 100% / 125% DPI) | `1110px` × `768px` | **Degraded (P1)**: `CaptionStylePicker` (`h-[88vh]`, `frontend/src/components/caption-style-picker.tsx:377`) and `ClipModalViewer` (`max-h-[90vh]`, `frontend/app/clips/page.tsx:489`) crowd vertical space; sticky toolbar (`frontend/app/clips/page.tsx:880`) + expanded settings drawer cover ~55% of the `768px` viewport height. |
| **1440px, 1920px, 2560px** (Standard / QHD / Ultrawide) | `1184px`, `1664px`, `2304px` | **Good (P2 polish)**: `max-w-[1560px]` centers content cleanly on Dashboard and Clips Studio; minor sub-12px typography (`text-[8px]`–`text-[11px]`) reduces legibility at 100% scaling on high-resolution displays. |

---

### Detailed Findings

#### [P0-1] Permanent `w-64` (`256px`) Sidebar Never Collapses on Narrow Widths or High-DPI Scaling
- **Page / Component**: `RootLayout` (`frontend/app/layout.tsx`) & `SidebarNav` (`frontend/app/sidebar-nav.tsx`)
- **Screen Size Where It Breaks**: `320px`, `375px`, `414px`, `768px`, and `1920x1080` at `200%` Windows DPI scaling (`960x540` effective CSS pixels).
- **What the User Sees**: The left sidebar is permanently `256px` wide (`w-64 shrink-0`). At `320px–414px` (or窄 split-screen windows), the main content area (`flex-1 min-w-0`) is squeezed to `64px–158px`, rendering every page unusable. Even at Tauri's `minWidth: 960` (`frontend/src-tauri/tauri.conf.json:18`), the sidebar consumes **26.7%** of the window width (`704px` remaining).
- **Root Cause**: `frontend/app/layout.tsx:30` hardcodes `<aside className="w-64 h-screen border-r border-[#232326] bg-[#0a0a0a] p-6 shrink-0 flex flex-col justify-between z-20 overflow-y-auto">` with no responsive collapse (`md:w-16 xl:w-64` or mobile drawer).
- **Exact Fix**:
  - In `frontend/app/layout.tsx:30`, collapse the sidebar to an icon rail below `xl` (`1280px`) and hide/drawer it below `md` (`768px`):
    ```tsx
    <aside className="hidden md:flex md:w-16 xl:w-64 h-screen border-r border-[#232326] bg-[#0a0a0a] p-3 xl:p-6 shrink-0 flex-col justify-between z-20 overflow-y-auto transition-[width] duration-150">
    ```
  - In `frontend/app/sidebar-nav.tsx:64,73`, hide text labels when in icon-rail mode (`hidden xl:inline`) and center icons (`justify-center xl:justify-start`), plus add a compact top mobile navigation bar (`md:hidden`) in `frontend/app/layout.tsx:60`.
- **Priority**: **P0**

---

#### [P0-2] Dashboard `lg:grid-cols-[1fr_380px]` Crushes Left Settings Column at `1024px–1180px`
- **Page / Component**: Dashboard (`frontend/app/page.tsx`) & `ClipSettings` (`frontend/src/components/clip-settings.tsx`)
- **Screen Size Where It Breaks**: `1024px` width (and `1280px` at `125%` Windows scaling = `1024px` CSS px).
- **What the User Sees**: At `1024px` viewport width, the `lg:` breakpoint activates. Subtracting `256px` sidebar + `80px` horizontal padding (`lg:px-10` = `40px` × 2) + `32px` grid gap (`gap-8`) + `380px` right preview column leaves only **`276px`** for the entire left column! Inside that `276px` column, `ClipSettings` renders a 3-column grid (`sm:grid-cols-3`, `frontend/src/components/clip-settings.tsx:86`) and 3 framing `OptionCard`s (`sm:grid-cols-3`, `frontend/src/components/clip-settings.tsx:164`), squeezing each control to **`~70px` wide**, clipping button labels (`"12s"`, `"30s"`, `"60s"`, `"90s"`, `"Random"`, `"AI Soon"`) and overflowing the card borders.
- **Root Cause**:
  - `frontend/app/page.tsx:698`: `<div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] gap-8 items-start">` triggers the 2-column split at `1024px` (`lg:`), ignoring the `256px` sidebar offset.
  - `frontend/src/components/clip-settings.tsx:86`: `<div className={onClipCountChange ? "grid grid-cols-1 sm:grid-cols-3 gap-3.5" : ...}>` uses viewport `sm:` (`640px`) instead of container queries (`@container` / `@md:grid-cols-3`) or `xl:grid-cols-3`.
- **Exact Fix**:
  - In `frontend/app/page.tsx:698`, delay the side-by-side preview split until `xl:` (`1280px`) and reduce the aside width at `xl:`:
    ```tsx
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] 2xl:grid-cols-[1fr_400px] gap-6 xl:gap-8 items-start">
    ```
  - In `frontend/src/components/clip-settings.tsx:84,86,164`, wrap the root in `@container` and replace `sm:grid-cols-3` with `@lg:grid-cols-3` (or `md:grid-cols-2 2xl:grid-cols-3`):
    ```tsx
    <div className={`@container space-y-5 ${className}`}>
      <div className={onClipCountChange ? "grid grid-cols-1 @xl:grid-cols-3 gap-3.5" : "grid grid-cols-1 @md:grid-cols-2 gap-4"}>
    ```
- **Priority**: **P0**

---

#### [P1-1] `CaptionStylePicker` Fixed `h-[88vh]` & Non-Wrapping Header/Footer Overflow on Short Laptops (`1366x768`) and Narrow Screens (`< 640px`)
- **Page / Component**: `CaptionStylePicker` Modal (`frontend/src/components/caption-style-picker.tsx`)
- **Screen Size Where It Breaks**: Short heights (`1366x768`, `960x640` Tauri min-height, `1920x1080` at `150%` DPI = `1280x720`) and widths `320px–640px`.
- **What the User Sees**:
  1. Below `md` (`768px`), the modal switches to `flex-col` (`frontend/src/components/caption-style-picker.tsx:412`). Because the right preview pane (`frontend/src/components/caption-style-picker.tsx:509`) has `flex-shrink-0` and contains a `max-w-[190px]` 9:16 video (`~338px` tall) plus metadata card (`~110px`), the bottom preview pane consumes `~480px` of vertical height, leaving **`0px–40px`** for the top style-card list (`flex-1 min-h-0`) on `640px–768px` tall screens! Users cannot see or scroll the caption style cards.
  2. The modal header (`frontend/src/components/caption-style-picker.tsx:380`) and footer (`frontend/src/components/caption-style-picker.tsx:602`) lack `flex-wrap`, causing `"Show platform safe zones"` checkbox and `"Selected style: ..."` text to collide with action buttons at `< 480px`.
- **Root Cause**:
  - `frontend/src/components/caption-style-picker.tsx:377`: `className="... w-[min(1100px,94vw)] max-h-[min(88vh,900px)] h-[88vh] ..."`
  - `frontend/src/components/caption-style-picker.tsx:412`: `flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden` paired with line `509`: `w-full md:w-[280px] lg:w-[320px] ... flex-shrink-0`.
- **Exact Fix**:
  - In `frontend/src/components/caption-style-picker.tsx:412`, allow the whole body to scroll vertically on `< md` (`overflow-y-auto md:overflow-hidden`) and constrain the preview video height on short viewports (`max-h-[38vh] md:max-h-[46vh] aspect-[9/16] w-auto mx-auto` at line `519`).
  - Add `flex-wrap gap-3` to header (`line 380`) and footer (`line 602`).
- **Priority**: **P1**

---

#### [P1-2] `ClipModalViewer` 9:16 Video Player Overflows Vertically on `640px–768px` Heights
- **Page / Component**: `ClipModalViewer` (`frontend/app/clips/page.tsx`)
- **Screen Size Where It Breaks**: `960x640` (Tauri minimum), `1366x768` laptops, and `< 768px` widths where `flex-col` stacks the video above the details pane.
- **What the User Sees**: The 9:16 video container (`frontend/app/clips/page.tsx:501`) is `aspect-[9/16] w-full max-w-[280px] shrink-0`, which computes to **`498px` tall** (`280 * 16 / 9`). Inside a modal with `max-h-[90vh]` and `p-6` (`48px` vertical padding), at `640px` window height (`90vh = 576px`), `498px + 48px = 546px` almost completely fills the modal. When stacked vertically (`flex-col` below `768px`), the details pane (`frontend/app/clips/page.tsx:514`) and the `"Export with Save As Dialog"` button (`line 545`) are pushed completely off-screen and clipped by `overflow-hidden` on the modal container (`line 489`).
- **Root Cause**: `frontend/app/clips/page.tsx:489` uses `overflow-hidden max-h-[90vh]` with a fixed `max-w-[280px]` 9:16 container (`line 501`) that does not scale with viewport height (`max-h-[65vh]`).
- **Exact Fix**:
  - In `frontend/app/clips/page.tsx:489`, change `overflow-hidden` to `overflow-y-auto md:overflow-hidden`.
  - In `frontend/app/clips/page.tsx:501`, constrain the 9:16 player by both height and width:
    ```tsx
    <div className="relative aspect-[9/16] max-h-[55vh] md:max-h-[75vh] w-auto max-w-[280px] shrink-0 rounded-xl overflow-hidden bg-black border border-zinc-800 shadow-xl">
    ```
- **Priority**: **P1**

---

#### [P1-3] Clips Studio Grid Breakpoints (`sm:2 md:3 lg:4 xl:5 2xl:6`) Overcrowd Cards on `768px–1440px` Viewports
- **Page / Component**: `ProjectClipsContent` & `ProClipCard` (`frontend/app/clips/page.tsx`)
- **Screen Size Where It Breaks**: `768px`, `1024px`, `1280px`, `1440px`.
- **What the User Sees**:
  - Because `256px` is taken by the sidebar and `48px–80px` by horizontal padding (`px-6 lg:px-10`), at `1024px` (`lg:grid-cols-4`), 4 clip cards are crammed into `688px` (`~160px` per card).
  - At `1280px` (`xl:grid-cols-5`), 5 clip cards are crammed into `944px` (`~176px` per card).
  - Inside `ProClipCard` (`frontend/app/clips/page.tsx:431-451`), the bottom action row (`"Download"` + `"Add top line"` / `"Edit top line"`) sits in a single `flex items-center justify-between gap-2` row without `flex-wrap`. At `< 210px` card width, the two buttons collide or wrap awkwardly onto two lines with uneven heights.
  - Furthermore, the hover overlay controls (`frontend/app/clips/page.tsx:351`) use `opacity-0 group-hover/player:opacity-100`, making the play/pause button and scrubber invisible on touchscreens or keyboard navigation unless focused.
- **Root Cause**:
  - `frontend/app/clips/page.tsx:1106,1137,1203`: Hardcoded viewport column counts (`grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6`) instead of CSS Grid `auto-fill` with a safe minimum card width (`minmax(220px, 1fr)`). Note that the comment on `line 1104` even says `Responsive 220px auto-fill`, but the class string uses fixed breakpoint columns!
- **Exact Fix**:
  - In `frontend/app/clips/page.tsx:1106,1137,1203`, replace the fixed column classes with:
    ```tsx
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
    ```
  - In `frontend/app/clips/page.tsx:351`, add `focus-within:opacity-100` alongside `group-hover/player:opacity-100`.
- **Priority**: **P1**

---

#### [P1-4] Sticky Toolbar + Expanded `ClipSettings` Drawer Covers >55% of Viewport Height on `768px` Screens
- **Page / Component**: Clips Studio Sticky Toolbar (`frontend/app/clips/page.tsx`)
- **Screen Size Where It Breaks**: `960x640` and `1366x768` (or `1920x1080` at `150%` DPI scaling).
- **What the User Sees**: When the user clicks the settings summary chip (`frontend/app/clips/page.tsx:923`) to open `isSettingsOpen`, the drawer expands *inside* `<section className="sticky top-4 z-30 ...">` (`line 880`). The expanded drawer (`~380px` tall) plus toolbar (`~60px`) stays pinned to the top of the screen while scrolling, leaving less than `250px` of vertical space at the bottom of a `640px–768px` window to actually view the clips grid.
- **Root Cause**: `frontend/app/clips/page.tsx:880-1016` nests the collapsible `ClipSettings` drawer inside the `sticky top-4` container without a `max-h` or independent scroll.
- **Exact Fix**:
  - In `frontend/app/clips/page.tsx:994`, constrain the open settings drawer height on short screens:
    ```tsx
    <div className="pt-3 border-t border-zinc-800/80 max-h-[60vh] overflow-y-auto pr-1 animate-in fade-in-0 duration-150">
    ```
- **Priority**: **P1**

---

#### [P1-5] `JobProgress` Floating Flyout Fixed `w-84` (`336px`) Overflows Narrow Viewports & Overlaps Bottom-Right Controls
- **Page / Component**: `JobProgress` (`frontend/app/job-progress.tsx`)
- **Screen Size Where It Breaks**: `320px`, `375px` widths; overlaps pagination/bottom cards on `960x640`.
- **What the User Sees**: The floating job status flyout (`frontend/app/job-progress.tsx:66`) uses `w-84` (`336px`) anchored at `fixed bottom-5 right-5 z-50` (`line 63`). On `320px–375px` viewports, `336px + 20px = 356px` overflows the left edge of the screen. Additionally, `job.title.slice(0, 24)` (`line 102`) hard-truncates in JS rather than using CSS `truncate`.
- **Root Cause**: `frontend/app/job-progress.tsx:66`: `w-84` without `max-w-[calc(100vw-2.5rem)]`.
- **Exact Fix**:
  - In `frontend/app/job-progress.tsx:66`, replace `w-84` with `w-84 max-w-[calc(100vw-2.5rem)]`.
- **Priority**: **P1**

---

#### [P2-1] Dashboard YouTube URL Input + Button Row Lacks `flex-wrap` on Narrow Containers
- **Page / Component**: Dashboard Step 1 (`frontend/app/page.tsx`)
- **Screen Size Where It Breaks**: `< 480px` container width (`320px–414px` viewports or `768px` with `w-64` sidebar).
- **What the User Sees**: The YouTube URL `<input>` and `"Download video"` `<button>` (`frontend/app/page.tsx:779-816`) are inside `<div className="flex gap-2.5">` without `flex-wrap` or `min-w-0` on the input. On narrow containers, the input's minimum intrinsic width pushes the `"Download video"` button past the card border.
- **Root Cause**: `frontend/app/page.tsx:779`: `<div className="flex gap-2.5">` and `line 796`: `className="flex-1 ..."` (missing `min-w-0` and `flex-col sm:flex-row`).
- **Exact Fix**:
  - In `frontend/app/page.tsx:779`, change to `<div className="flex flex-col sm:flex-row gap-2.5">` and add `min-w-0` to the `<input>` at `line 796`.
- **Priority**: **P2**

---

#### [P2-2] Sub-12px Micro-Typography Across Pages Hurts Legibility at 100% DPI & High-Res (`1920px–2560px`) Displays
- **Page / Component**: Multiple components (`frontend/app/page.tsx`, `frontend/app/clips/page.tsx`, `frontend/app/projects/page.tsx`, `frontend/src/components/caption-style-picker.tsx`, `frontend/app/job-progress.tsx`, `frontend/app/layout.tsx`)
- **Screen Size Where It Breaks**: `1920x1080` and `2560x1440` at `100%` scaling; also violates the 12px (`text-xs`) minimum legibility guideline noted in `ai.md`.
- **What the User Sees**: Over 50 occurrences of `text-[7px]`, `text-[8px]`, `text-[9px]`, `text-[10px]`, and `text-[11px]` are used for interactive or informational UI elements—e.g.:
  - `frontend/app/layout.tsx:43` (`text-[11px]` subtitle)
  - `frontend/app/job-progress.tsx:75,100,133,141,211` (`text-[9px]`, `text-[10px]`, `text-[11px]`)
  - `frontend/app/projects/page.tsx:344,360,376,419,476,481,598,621,644,654,658` (`text-[9px]`, `text-[10px]`, `text-[11px]`)
  - `frontend/app/clips/page.tsx:354,357,383,421,424,1041` (`text-[10px]`, `text-[11px]`)
- **Root Cause**: Hardcoded arbitrary Tailwind pixel font sizes (`text-[9px]`, `text-[10px]`, `text-[11px]`) instead of `text-xs` (`12px` / `0.75rem`) which scales properly with root font-size and Windows text scaling.
- **Exact Fix**: Promote non-decorative `text-[9px]`, `text-[10px]`, and `text-[11px]` labels to `text-xs` (`12px`), keeping micro-sizes only inside scaled phone mockups (`frontend/app/page.tsx:1227,1279` and `frontend/src/components/live-moving-captions.tsx`).
- **Priority**: **P2**

---

#### [P2-3] Touch / Click Target Sizes Below `32px–44px` Accessibility Minimums
- **Page / Component**: `ProClipCard`, `SettingsPage`, `Projects`, `ClipSettings`
- **Screen Size Where It Breaks**: Touch-enabled Windows laptops / tablets at `125%–200%` scaling.
- **What the User Sees**:
  - Toggle switches (`h-5 w-9` = `20px × 36px`) in `frontend/app/settings/page.tsx:99,118`, `frontend/app/projects/page.tsx:393,534`, `frontend/src/components/clip-settings.tsx:233`, and `frontend/src/components/ui/toggle-row.tsx:51` have only a `20px` vertical hit target.
  - Clear search buttons (`✕`) in `frontend/app/clips/page.tsx:1069` and `frontend/src/components/caption-style-picker.tsx:441` have no padding (`~12px × 12px` hit box).
  - Dismiss alert button in `frontend/app/page.tsx:853` is `size-3.5` with `p-0.5` (`18px × 18px`).
- **Exact Fix**: Add `min-h-[32px] min-w-[32px] flex items-center justify-center` hit areas (or invisible `after:absolute after:-inset-2` touch target expansion) to switches and clear/dismiss icon buttons.
- **Priority**: **P2**

---

#### [P2-4] Redundant Window Maximize Call Causes Startup Layout Flash in Tauri
- **Page / Component**: `WindowInit` (`frontend/app/window-init.tsx`) & `tauri.conf.json` (`frontend/src-tauri/tauri.conf.json`)
- **Screen Size Where It Breaks**: Tauri Desktop startup on all monitors.
- **What the User Sees**: `frontend/src-tauri/tauri.conf.json:20` already configures `"maximized": true` natively at window creation, yet `frontend/app/window-init.tsx:9-13` calls `getCurrentWindow().maximize()` again inside a client `useEffect` after React hydration. If a user un-maximizes/restores the window before hydration finishes or triggers a full-page reload while in a restored `1280x800` window, `WindowInit` forcibly re-maximizes the window.
- **Root Cause**: Duplicate window maximize logic in `frontend/app/window-init.tsx:8-14` vs `frontend/src-tauri/tauri.conf.json:20`.
- **Exact Fix**: Rely on `"maximized": true` in `tauri.conf.json:20` and remove or guard `WindowInit` with `sessionStorage.getItem("cliprobin_window_initialized")` so manual window restore/resize states persist across reloads.
- **Priority**: **P2**

---

## 3. Fix Plan (In Implementation Order)

1. **Make Sidebar Responsive (`frontend/app/layout.tsx`, `frontend/app/sidebar-nav.tsx`) [P0-1]**:
   - Collapse `<aside>` to a `64px` (`md:w-16 xl:w-64`) icon rail below `1280px` (`xl`) and a compact top bar below `768px` (`md`).
2. **Adopt Container Queries & Delay Dashboard Split (`frontend/app/page.tsx`, `frontend/src/components/clip-settings.tsx`) [P0-2]**:
   - Change Dashboard's 2-column grid (`frontend/app/page.tsx:698`) from `lg:grid-cols-[1fr_380px]` to `xl:grid-cols-[1fr_340px] 2xl:grid-cols-[1fr_400px]`.
   - Add `@container` to `ClipSettings` (`frontend/src/components/clip-settings.tsx:84`) and switch internal grids from `sm:grid-cols-3` to `@xl:grid-cols-3`.
3. **Replace Fixed Breakpoint Columns in Clips Studio with CSS Grid `auto-fill` (`frontend/app/clips/page.tsx`) [P1-3]**:
   - Update lines `1106`, `1137`, and `1203` to `grid-cols-[repeat(auto-fill,minmax(220px,1fr))]`.
4. **Fix Modal & Sticky Drawer Vertical Overflow on `768px` Laptop Screens (`frontend/src/components/caption-style-picker.tsx`, `frontend/app/clips/page.tsx`) [P1-1, P1-2, P1-4]**:
   - Constrain 9:16 modal video previews with `max-h-[55vh] md:max-h-[75vh] w-auto` and allow modal bodies to scroll on short viewports.
   - Add `max-h-[60vh] overflow-y-auto` to the collapsible `ClipSettings` drawer in `frontend/app/clips/page.tsx:994`.
5. **Clamp Floating Flyout & Input Rows (`frontend/app/job-progress.tsx`, `frontend/app/page.tsx`) [P1-5, P2-1]**:
   - Add `max-w-[calc(100vw-2.5rem)]` to `JobProgress` flyout (`frontend/app/job-progress.tsx:66`) and `flex-col sm:flex-row` to the YouTube URL row (`frontend/app/page.tsx:779`).
6. **Standardize Minimum Font Sizes (`text-xs`) & Hit Targets [P2-2, P2-3, P2-4]**:
   - Replace non-mockup `text-[9px]–text-[11px]` classes with `text-xs` (`12px`), expand switch/icon button hit targets to `>= 32px`, and guard `WindowInit` with `sessionStorage`.

---

## 4. Test Plan

1. **Automated Viewport Matrix Sweep (Playwright)**:
   - Parameterize a Playwright test across widths `[320, 375, 414, 768, 1024, 1280, 1440, 1920, 2560]` × heights `[640, 768, 900, 1080]` on `/`, `/clips`, `/projects`, and `/settings`.
   - Assert `document.documentElement.scrollWidth <= document.documentElement.clientWidth` (zero horizontal overflow) at every size.
2. **Component Bounding-Box Assertions**:
   - On Dashboard (`/`), assert that every button inside `ClipSettings` (`12s`, `30s`, `60s`, `90s`, `16:9 Rounded`, `1:1 Rounded`, `True 9:16`) has `boundingBox().width >= 64` and zero text clipping (`scrollWidth <= clientWidth`) at `1024x768` and `1280x800`.
   - On Clips Studio (`/clips`), open `CaptionStylePicker` and `ClipModalViewer` at `1366x768` and `960x640`; assert that the primary action buttons (`"Apply style"`, `"Export with Save As Dialog"`, `"Close"`) are within the viewport bounds (`rect.bottom <= window.innerHeight`) or reachable via scroll.
3. **Windows Display Scaling Verification**:
   - Test Tauri window resize down to minimum size (`minWidth`, `minHeight`) on Windows 11 with display scaling set to `100%`, `125%`, `150%`, and `200%`.

---

## 5. Recommended Tauri Window Constraints & Breakpoint Strategy

### Recommended `tauri.conf.json` Window Settings
In `frontend/src-tauri/tauri.conf.json:14-23`:
- **Current**: `"width": 1280, "height": 800, "minWidth": 960, "minHeight": 640`
- **Recommended**:
  - Keep `"minWidth": 1024` and `"minHeight": 680` if the `256px` sidebar remains expanded, **OR** keep `"minWidth": 900, "minHeight": 640` once the sidebar collapses to a `64px` rail below `1280px` (`xl`).
  - Why: On a `1920x1080` monitor at `150%` Windows DPI scaling (the default on many 14"–15" 1080p/2.8K Windows laptops), the entire desktop work area is `1280x672` CSS pixels (after the `48px` Windows taskbar). A `minHeight` of `640` safely fits inside `672px` without forcing the window bottom behind the Windows taskbar, while collapsing the sidebar below `1280px` guarantees `>= 836px` of main content width even at minimum window width.

### Recommended Breakpoint Strategy
1. **Use `@container` Queries for All Main-Pane Components**:
   - Add `@container` to the `<main>` wrapper on `/`, `/clips`, `/projects`, and `/settings`.
   - Because Tailwind v4 natively supports CSS container queries (`@sm:`, `@md:`, `@lg:`, `@xl:`, `@2xl:`), components inside `<main>` will respond to the **actual available content width** rather than `window.innerWidth` (eliminating the `256px` sidebar offset bug).
2. **Shell Breakpoints (Viewport-Based)**:
   - `< 768px` (`< md`): Top compact navigation bar / slide-over drawer; single-column stacked layouts.
   - `768px – 1279px` (`md` to `xl`): `64px` (`w-16`) icon-only sidebar rail with tooltips; single-column Dashboard with collapsible/bottom preview; `auto-fill` `minmax(220px, 1fr)` Clips grid (3–4 columns).
   - `>= 1280px` (`xl+`): Full `256px` (`w-64`) sidebar with labels; 2-column Dashboard (`1fr` settings + `340px–400px` sticky 9:16 preview); 4–6 column Clips grid up to `max-w-[1560px]`.

---

## 6. Open Questions / Unverified Items
- **HYPOTHESIS**: On dual-monitor Windows setups with mixed DPI scaling (e.g., Monitor 1 at `150%` laptop panel, Monitor 2 at `100%` external 1080p monitor), dragging the Tauri WebView2 window between monitors while `CaptionStylePicker` is open may briefly miscalculate `88vh` until a resize event settles. Confirming this requires a physical dual-monitor mixed-DPI Windows test rig.

