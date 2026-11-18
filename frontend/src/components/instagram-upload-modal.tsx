"use client";

import React, { useEffect, useState } from "react";
import { Clip, clipUrl, saveClipWithExplorer } from "@/src/lib/api";
import { ModalDialog } from "@/src/components/ui/modal-dialog";

interface InstagramUploadModalProps {
  clip: Clip;
  projectId: string;
  onClose: () => void;
}

export function InstagramUploadModal({
  clip,
  projectId,
  onClose,
}: InstagramUploadModalProps) {
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const [caption, setCaption] = useState(() => {
    const rawTitle = clip.title || `Clip ${clip.id}`;
    const reasonSnippet =
      clip.reason && clip.selection_method === "ai" ? `\n\n${clip.reason}` : "";
    return `${rawTitle}${reasonSnippet}\n\n#reels #reelsinstagram #viral #trending #explorepage #cliprobin`;
  });

  useEffect(() => {
    let active = true;
    clipUrl(projectId, clip.file, clip.v)
      .then((url) => {
        if (active) setVideoUrl(url);
      })
      .catch(() => {
        if (active) setActionError("Could not load clip preview URL.");
      });
    return () => {
      active = false;
    };
  }, [clip, projectId]);

  const handleCopyCaption = async () => {
    setActionError(null);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable in this browser.");
      }
      await navigator.clipboard.writeText(caption);
      setCopiedCaption(true);
      setTimeout(() => setCopiedCaption(false), 2500);
    } catch (err) {
      setCopiedCaption(false);
      setActionError(
        err instanceof Error
          ? err.message
          : "Could not copy caption to clipboard. Select and copy manually.",
      );
    }
  };

  const handleSaveVideo = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveSuccess(false);
    setActionError(null);
    try {
      const res = await saveClipWithExplorer(projectId, clip.file, `${clip.id}_reel.mp4`);
      if (res.saved) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not export video file.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenInstagram = () => {
    window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
  };

  return (
    <ModalDialog
      open={true}
      onClose={() => {
        if (!isSaving) onClose();
      }}
      ariaLabelledBy="instagram-modal-title"
      className="max-w-xl"
    >
      <div className="relative flex flex-col w-full rounded-2xl border border-zinc-800 bg-[#121215] shadow-2xl overflow-hidden max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-6 py-4 bg-zinc-900/50">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] flex items-center justify-center text-white shadow-md">
              <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
              </svg>
            </div>
            <div>
              <h2 id="instagram-modal-title" className="text-base font-bold text-white flex items-center gap-2">
                Prepare for Instagram
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-pink-950/80 text-pink-400 border border-pink-800/60">
                  9:16 Export
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Save the MP4 file, copy your caption, and post a Reel on Instagram
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            aria-label="Close dialog"
            className="size-8 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors focus-ring disabled:opacity-50 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(92vh-96px)]">
          <div className="flex items-center gap-3 p-3 rounded-xl border border-zinc-800 bg-zinc-900/60">
            {videoUrl && (
              <div className="relative aspect-[9/16] w-12 h-20 rounded-lg overflow-hidden bg-black shrink-0 border border-zinc-700/80">
                <video src={videoUrl} className="size-full object-cover" muted />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{clip.title}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Duration: {Math.round(clip.end - clip.start)}s • 720×1280 (9:16 MP4)
              </p>
              {clip.top_line && (
                <p className="text-[11px] text-pink-400 font-medium truncate mt-1">
                  Hook: &quot;{clip.top_line}&quot;
                </p>
              )}
            </div>
          </div>

          {actionError && (
            <div
              role="alert"
              className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200"
            >
              {actionError}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="instagram-caption" className="text-xs font-medium text-zinc-300">
                Caption &amp; Hashtags
              </label>
              <button
                type="button"
                onClick={handleCopyCaption}
                className="text-xs font-medium text-pink-400 hover:text-pink-300 flex items-center gap-1 transition-colors cursor-pointer focus-ring rounded px-1"
              >
                {copiedCaption ? (
                  <>
                    <svg className="size-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="text-emerald-400">Copied to clipboard!</span>
                  </>
                ) : (
                  <>
                    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                    </svg>
                    <span>Copy Caption</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              id="instagram-caption"
              rows={4}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-white placeholder-zinc-500 focus:border-pink-500 focus:outline-none"
              placeholder="Enter Instagram Reels caption and hashtags..."
            />
          </div>

          <div className="space-y-2 pt-1">
            <p className="text-xs font-semibold text-zinc-300">Export &amp; Upload Steps:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleSaveVideo}
                disabled={isSaving}
                className="p-3 rounded-xl border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-xs font-bold text-white transition-all flex items-center justify-center gap-2 focus-ring cursor-pointer disabled:opacity-50"
              >
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                <span>
                  {saveSuccess ? "Saved to Computer!" : isSaving ? "Saving..." : "1. Save Video File"}
                </span>
              </button>

              <button
                type="button"
                onClick={handleOpenInstagram}
                className="p-3 rounded-xl bg-gradient-to-r from-[#f09433] via-[#dc2743] to-[#bc1888] hover:opacity-95 text-xs font-bold text-white transition-all flex items-center justify-center gap-2 shadow-lg shadow-pink-950/30 focus-ring cursor-pointer"
              >
                <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                </svg>
                <span>2. Open Instagram Web</span>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 space-y-2 text-xs text-zinc-400">
            <p className="font-semibold text-zinc-300">Manual publish workflow:</p>
            <ol className="list-decimal list-inside space-y-1 pl-1">
              <li>Save the 9:16 MP4 video file to your computer.</li>
              <li>Open Instagram Web, click <strong>+ Create</strong>, and select the saved file.</li>
              <li>Copy your caption above and paste it into the Reels caption field.</li>
            </ol>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
