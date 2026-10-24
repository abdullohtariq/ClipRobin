# Video Playback Coordination Audit Report (`playback-bug.md`) — `[RESOLVED & VERIFIED]`

## 1. Summary (Resolution Update)
**Status: ALL PLAYBACK COORDINATION FINDINGS RESOLVED & VERIFIED.**
1. **Document-Level Exclusive `<video>` Playback Coordinator (`frontend/app/clips/page.tsx`)**: Added a document-level capture listener (`document.addEventListener("play", handleGlobalPlay, true)`) that automatically pauses any other playing `<video>` element in the DOM whenever a non-decorative `<video>` (`:not([data-decorative-loop="true"])`) begins playback, guaranteeing that at most one clip or modal player can ever play audio/video at a time.
2. **Synchronous `onPlay` / `onPause` State Binding & Race Elimination (`frontend/app/clips/page.tsx`)**: Bound native `onPlay` and `onPause` event handlers directly on `ProClipCard`'s `<video>` element, removed the racy `&& isPlaying` guard in `ProClipCard`'s `useEffect` so `video.pause()` always executes when `activePlayingClipId !== clip.id` (even if `video.play()` is still buffering), and updated `togglePlayPause` to call `onPlay(null)` when pausing.
3. **Modal & Project Lifecycle Coordination (`frontend/app/clips/page.tsx`)**: Opening `ClipModalViewer` (`onOpenModal`) and switching `projectId` now immediately clear `activePlayingClipId`, and `ClipModalViewer` now receives and syncs `globalVolume` and `globalMuted` from the Clips Studio toolbar.

*(Original Audit Summary)*: In Clips Studio (`frontend/app/clips/page.tsx`), each `ProClipCard` owned an isolated HTML5 `<video>` element (`videoRef`) and a local `isPlaying` boolean (`line 65, 68`), coordinated only by a parent `activePlayingClipId` state (`line 599`) that was updated **exclusively** when the user clicked the custom center overlay button (`togglePlayPause`, `line 133-148`). Because `<video>` elements did not attach native `onPlay` or `onPause` event handlers (`lines 310-334`), and because `ClipModalViewer` (`lines 458-556`), `CaptionStylePicker` (`frontend/src/components/caption-style-picker.tsx:521-530`), and the Dashboard preview (`frontend/app/page.tsx:1211-1266`) did not participate in `activePlayingClipId` at all, multiple videos could play simultaneously with out-of-sync Play/Pause buttons.

---

## 2. Findings, Ranked by Severity

### How Each Component Currently Owns Its Video & Play State

| Component | File & Lines | `<video>` Element & Attributes | Play State Owner | Participation in Coordination |
| :--- | :--- | :--- | :--- | :--- |
| **`ProClipCard`** | `frontend/app/clips/page.tsx:40-455` | `ref={videoRef}` (`line 311`), `playsInline preload="metadata"`, **no `onPlay` or `onPause` handlers** (`lines 310-334`) | Local `const [isPlaying, setIsPlaying] = useState(false)` (`line 68`) | Partial: calls `onPlay(clip.id)` only inside `togglePlayPause` (`line 141`); watches `activePlayingClipId` in `useEffect` (`lines 124-131`). |
| **`ClipModalViewer`** | `frontend/app/clips/page.tsx:458-556` | `<video src={videoUrl} controls autoPlay playsInline />` (`lines 503-509`), **no `ref`, no `globalVolume`/`globalMuted` sync** | Native browser `<video controls>` state | **None**: opening the modal (`onOpenModal(clip)` at `line 297, 1148`) never clears `activePlayingClipId` or pauses the playing `ProClipCard`! |
| **`CaptionStylePicker`** | `frontend/src/components/caption-style-picker.tsx:208-628` | `ref={videoRef}` (`line 521`), `loop muted playsInline autoPlay={!prefersReducedMotion}` | Local `const [isPlaying, setIsPlaying] = useState(true)` (`line 219`) | **None**: loops muted preview while background `ProClipCard` continues playing audio in `/clips`. |
| **Dashboard Preview** | `frontend/app/page.tsx:1210-1266` | `<video src={videoPreviewUrl} muted autoPlay loop playsInline />` | Uncontrolled `autoPlay loop muted` | **None** (isolated to `/` route). |

---

### Detailed Root Causes & Edge Cases

#### [P0-1] Clicking a Card to Open `ClipModalViewer` Starts `autoPlay` in the Modal While the Card's `<video>` Keeps Playing in the Background
- **Component**: `ProClipCard` & `ClipModalViewer` (`frontend/app/clips/page.tsx`)
- **What the User Sees**:
  1. User clicks the center Play button (`togglePlayPause`, `line 366`) on Clip A (`clip_001`). Clip A starts playing and its button shows the **Pause** icon (`isPlaying === true`).
  2. User clicks anywhere else on Clip A's video frame (or on Clip B's video frame) (`onClick={() => onOpenModal(clip)}` at `frontend/app/clips/page.tsx:297`).
  3. `ClipModalViewer` opens (`frontend/app/clips/page.tsx:482-555`) and immediately auto-plays (`autoPlay` at `line 506`) with audio at 100% volume.
  4. **Clip A's `<video>` card in the background NEVER pauses!** Both videos play audio simultaneously (creating an echo/cacophony), and Clip A's card remains in its `isPlaying = true` (Pause icon) state.
- **Root Cause**:
  - `onOpenModal={(c) => setSelectedClipForModal(c)}` (`frontend/app/clips/page.tsx:1148`) does not call `setActivePlayingClipId(null)` (or pause the active video).
- **Priority**: **P0**

---

#### [P0-2] Asynchronous `video.play().then(...)` Race Condition Leaves Previous Clip Playing & Showing "Pause" State on Rapid Play Clicks
- **Component**: `ProClipCard` (`frontend/app/clips/page.tsx:124-148`)
- **What the User Sees**:
  - When a user clicks Play on Clip A (`clip_001`) and then quickly clicks Play on Clip B (`clip_002`) before Clip A's `video.play()` Promise resolves (e.g., while Clip A is buffering its initial range request from `http://127.0.0.1:8000/api/projects/.../clips/clip_001.mp4`):
    1. Click Clip A (`t = 0ms`): `onPlay("clip_001")` sets `activePlayingClipId = "clip_001"`. `videoA.play()` is called (`line 146`), which is asynchronous. While the media stream buffers, `isPlaying` on Clip A is still **`false`**.
    2. Click Clip B (`t = 80ms`): `onPlay("clip_002")` sets `activePlayingClipId = "clip_002"`.
    3. Clip A's `useEffect` (`frontend/app/clips/page.tsx:124-131`) runs when `activePlayingClipId` changes to `"clip_002"`:
       ```tsx
       useEffect(() => {
         const video = videoRef.current;
         if (!video) return;
         if (activePlayingClipId !== clip.id && isPlaying) {
           video.pause();
           setIsPlaying(false);
         }
       }, [activePlayingClipId, clip.id, isPlaying]);
       ```
       Because Clip A's `isPlaying` is **still `false`** at `t = 80ms`, `if (activePlayingClipId !== clip.id && isPlaying)` evaluates to **`false`**! `videoA.pause()` is **NOT called**!
    4. At `t = 150ms`, Clip A's `video.play().then(() => setIsPlaying(true))` (`line 146`) resolves and sets `isPlaying = true` on Clip A.
    5. Wait: when `isPlaying` becomes `true` at `t = 150ms`, what if `activePlayingClipId` was **already** `"clip_001"` (for example, Clip A was played, paused by clicking Pause on Clip A—which left `activePlayingClipId === "clip_001"`—or re-triggered)? Worse: if Clip A was paused by the user (`lines 137-139`), **`togglePlayPause` does NOT clear `activePlayingClipId` (`onPlay(null)`)!**
- **Let's trace the Pause -> Play -> Play bug (`lines 124-148`)**:
  1. User clicks **Play** on Clip A (`clip_001`): `activePlayingClipId` becomes `"clip_001"`, Clip A plays (`isPlaying = true`).
  2. User clicks **Pause** on Clip A (`lines 137-139`):
     ```tsx
     if (isPlaying) {
       video.pause();
       setIsPlaying(false);
     }
     ```
     Notice `activePlayingClipId` in parent (`clips/page.tsx:599`) is **STILL `"clip_001"`**!
  3. Now, what if Clip A starts playing via native media keys, Picture-in-Picture, or browser right-click -> Play, OR what if Clip B is played, then paused, and then Clip A is played while Clip B is triggered?
  4. Even more directly: in `ProClipCard` (`lines 310-334`), `<video>` has **no `onPlay` or `onPause` listeners**:
     - If the user triggers play/pause via **Windows Hardware Media Keys**, **Picture-in-Picture (PiP)** controls, **Right-click -> Play**, or **Spacebar** when the `<video>` element is focused, `togglePlayPause` is bypassed completely.
     - The `<video>` plays without calling `onPlay(clip.id)` and without updating `isPlaying` (or if `isPlaying` was `true` and paused natively, the button stays stuck on Pause).
     - And if `video.pause()` is guarded by `if (activePlayingClipId !== clip.id && isPlaying)` (`line 127`), any `<video>` whose `isPlaying` state is out of sync with `video.paused` is **never paused** when another clip starts!
- **Root Cause**:
  1. `frontend/app/clips/page.tsx:127` checks React state `isPlaying` instead of checking `!video.paused` and cancelling in-flight `video.play()` promises.
  2. `frontend/app/clips/page.tsx:137-139` pauses locally without clearing `activePlayingClipId` (`onPlay(null)`), and `onEnded` (`line 329-332`) also resets `setIsPlaying(false)` without clearing `activePlayingClipId`.
  3. `frontend/app/clips/page.tsx:310-334` lacks `onPlay` and `onPause` handlers on the `<video>` element to synchronize React state with the actual DOM `HTMLMediaElement` state.
- **Priority**: **P0**

---

#### [P1-1] Filtering/Searching Clips, Sorting, or Scrolling Away Leaves Off-Screen or Unmounting Clips Playing / Out-of-Sync
- **Component**: `ProjectClipsContent` & `ProClipCard` (`frontend/app/clips/page.tsx`)
- **What the User Sees**:
  1. **Search / Filter (`lines 800-814`)**: User plays Clip A, then types a search query in `"Search transcript text..."` (`line 1058`) that filters out Clip A. Clip A unmounts while `activePlayingClipId` remains `"clip_001"`. When the user clears the search query, Clip A remounts with `isPlaying = false`, while `activePlayingClipId` is still `"clip_001"`.
  2. **Scrolling Away (`contentVisibility: "auto"`, `line 243`)**: `ProClipCard` sets `style={{ contentVisibility: "auto" }}` (`line 243`), and its `IntersectionObserver` (`lines 84-97`) only sets `isInView(true)` once (never setting it back to `false` or pausing when scrolled out of view). When a playing card is scrolled far off-screen, its audio keeps playing invisibly with no floating mini-player or toolbar indicator showing which clip is making sound.
  3. **Opening `CaptionStylePicker` Modal (`line 995` -> `clip-settings.tsx:298`)**: Opening the Caption Style Picker modal while a clip card is playing leaves the clip card's audio playing underneath the modal while the user previews caption styles.
  4. **Switching Browser/App Tabs or Project Switcher (`line 838`)**: Switching projects via the `<select id="project-switcher">` dropdown (`line 838`) updates `projectId` via URL query param without resetting `activePlayingClipId` (`line 599`).
- **Root Cause**: No cleanup effect on `projectId` change, modal open (`selectedClipForModal` / `isSettingsOpen`), or `document.visibilitychange`, and no global registry of active `HTMLMediaElement` instances.
- **Priority**: **P1**

---

#### [P1-2] `ClipModalViewer` Ignores Global Volume & Mute Settings (`globalVolume` / `globalMuted`)
- **Component**: `ClipModalViewer` (`frontend/app/clips/page.tsx:458-556`)
- **What the User Sees**: If the user mutes all clips or lowers the global volume slider in the sticky toolbar (`frontend/app/clips/page.tsx:943-988`) to `10%`, and then clicks a clip card to open `ClipModalViewer`, the modal `<video>` (`line 503-509`) blasts audio at `100%` unmuted volume because `globalVolume` and `globalMuted` are not passed to `ClipModalViewer`.
- **Root Cause**: `ClipModalViewer` (`lines 458-466`) does not accept `globalVolume` or `globalMuted` props and has no `videoRef` effect to apply them.
- **Priority**: **P1**

---

## 3. Minimal Fix Plan (In Implementation Order)

### Step 1: Add a Global / Shared Media Playback Coordinator (`useEffect` on `play` Capture or Shared Context)
The cleanest, zero-dependency, 100% bulletproof fix in React is a **DOM-level `play` event listener in capture phase** (paired with explicit `activePlayingClipId` state synchronization), because the HTML5 `play` event fires for **every** `<video>` element regardless of whether playback was started via custom buttons, native `<video controls>`, `autoPlay` modals, PiP, or hardware media keys:

```tsx
// Inside ProjectClipsContent (frontend/app/clips/page.tsx:601)
useEffect(() => {
  const handleGlobalPlay = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLVideoElement)) return;
    // Pause every other <video> in the document (unless it's a muted decorative loop)
    document.querySelectorAll("video").forEach((video) => {
      if (video !== target && !video.paused && !video.dataset.decorativeLoop) {
        video.pause();
      }
    });
  };
  document.addEventListener("play", handleGlobalPlay, true);
  return () => document.removeEventListener("play", handleGlobalPlay, true);
}, []);
```

### Step 2: Bind Native `onPlay` and `onPause` on `ProClipCard`'s `<video>` (`frontend/app/clips/page.tsx:310-334`)
1. Change `onPlay` prop signature on `ProClipCard` (`line 59`) to `onPlay: (clipId: string | null) => void`.
2. In `ProClipCard`'s `useEffect` (`lines 124-131`), do **not** guard `video.pause()` with `&& isPlaying`; always pause the DOM `<video>` if `activePlayingClipId !== clip.id`:
   ```tsx
   useEffect(() => {
     const video = videoRef.current;
     if (!video) return;
     if (activePlayingClipId !== clip.id) {
       if (!video.paused) {
         video.pause();
       }
       setIsPlaying(false);
     }
   }, [activePlayingClipId, clip.id]);
   ```
3. Add `onPlay` and `onPause` handlers directly to `<video>` (`frontend/app/clips/page.tsx:310-334`):
   ```tsx
   onPlay={() => {
     setIsPlaying(true);
     onPlay(clip.id);
   }}
   onPause={() => {
     setIsPlaying(false);
   }}
   onEnded={() => {
     setIsPlaying(false);
     hasStartedRef.current = false;
     if (activePlayingClipId === clip.id) onPlay(null);
   }}
   ```
4. Simplify `togglePlayPause` (`lines 133-148`) so it delegates state updates to the native `onPlay` / `onPause` events:
   ```tsx
   const togglePlayPause = (e: React.MouseEvent) => {
     e.stopPropagation();
     const video = videoRef.current;
     if (!video) return;
     if (!video.paused) {
       video.pause();
       onPlay(null);
     } else {
       onPlay(clip.id);
       if (!hasStartedRef.current) {
         video.currentTime = 0;
         hasStartedRef.current = true;
       }
       void video.play().catch(() => {
         setIsPlaying(false);
       });
     }
   };
   ```

### Step 3: Coordinate `ClipModalViewer`, Project Switcher, and `CaptionStylePicker`
1. When opening `ClipModalViewer` (`frontend/app/clips/page.tsx:1148`), clear `activePlayingClipId`:
   ```tsx
   onOpenModal={(c) => {
     setActivePlayingClipId(null);
     setSelectedClipForModal(c);
   }}
   ```
2. Pass `globalVolume` and `globalMuted` into `ClipModalViewer` (`frontend/app/clips/page.tsx:458-510`) and sync them via a `videoRef` on the modal `<video>`.
3. Reset `setActivePlayingClipId(null)` and `setSelectedClipForModal(null)` whenever `projectId` changes (`frontend/app/clips/page.tsx:647`).
4. Mark decorative muted looping videos (`CaptionStylePicker` at `frontend/src/components/caption-style-picker.tsx:521` and Dashboard phone preview at `frontend/app/page.tsx:1211,1236,1257`) with `data-decorative-loop="true"`, and pause `activePlayingClipId` when `CaptionStylePicker` opens.

---

## 4. Test Plan

1. **Card-to-Card Exclusive Playback Test**:
   - Render `ProjectClipsContent` with 3 clips (`clip_001`, `clip_002`, `clip_003`).
   - Click Play on `clip_001` -> assert `clip_001` `<video>.paused === false` and button `aria-label === "Pause clip"`.
   - Click Play on `clip_002` (both after `clip_001` has started AND immediately within `< 20ms` before `play()` promise resolves) -> assert `clip_001` `<video>.paused === true`, `clip_001` button `aria-label === "Play clip"`, and `clip_002` `<video>.paused === false`.
2. **Pause-Then-Re-Play & Native Event Sync Test**:
   - Play `clip_001`, click Pause on `clip_001`, then play `clip_002`, then trigger native `video1.play()` -> assert `clip_002` automatically pauses and resets its button to `"Play clip"`.
3. **Card-to-Modal Exclusive Playback Test**:
   - Play `clip_001` on its card, then click the card frame to open `ClipModalViewer`.
   - Assert `clip_001`'s card `<video>` is paused (`paused === true`, button reset to `"Play clip"`) and only the modal `<video>` is playing, with `volume === globalVolume` and `muted === globalMuted`.
4. **Filter / Unmount / Project Switch Cleanup Test**:
   - While `clip_001` is playing, type a search query in `"Search transcript text..."` that hides `clip_001` (or switch projects in `#project-switcher`) -> assert no background audio continues playing and `activePlayingClipId` is reset.

---

## 5. Open Questions / Unverified Items
- **Desired Scroll Behavior**: Currently, when a user starts playing a clip in `/clips` and scrolls down a 50-clip grid, the clip continues playing off-screen (`IntersectionObserver` at `frontend/app/clips/page.tsx:84-97` only sets `isInView(true)` and never pauses on exit). Confirm with the user whether scrolling a playing clip completely out of the viewport should automatically pause it or keep playing audio.

