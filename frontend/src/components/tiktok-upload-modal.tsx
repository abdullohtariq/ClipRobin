"use client";

import React, { useState, useEffect } from "react";
import { Clip, clipUrl, saveClipWithExplorer } from "@/src/lib/api";

interface TikTokUploadModalProps {
  clip: Clip;
  projectId: string;
  onClose: () => void;
}

export function TikTokUploadModal({
  clip,
  projectId,
  onClose,
}: TikTokUploadModalProps) {
  const [activeTab, setActiveTab] = useState<"studio" | "api">("studio");
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Formatted caption with viral TikTok hashtags
  const [caption, setCaption] = useState(() => {
    const rawTitle = clip.title || `Clip ${clip.id}`;
    const reasonSnippet = clip.reason ? `\n\n${clip.reason}` : "";
    return `${rawTitle}${reasonSnippet}\n\n#fyp #viral #trending #shorts #cliprobin`;
  });

  // Direct API State (persisted in localStorage for convenience)
  const [clientKey, setClientKey] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [apiStatus, setApiStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    clipUrl(projectId, clip.file).then((url) => {
      if (active) setVideoUrl(url);
    });

    const savedKey = localStorage.getItem("cliprobin_tiktok_client_key");
    const savedSecret = localStorage.getItem("cliprobin_tiktok_client_secret");
    if (savedKey) setClientKey(savedKey);
    if (savedSecret) setClientSecret(savedSecret);

    return () => {
      active = false;
    };
  }, [clip, projectId]);

  const handleCopyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopiedCaption(true);
      setTimeout(() => setCopiedCaption(false), 2500);
    } catch {
      // Fallback
      setCopiedCaption(false);
    }
  };

  const handleSaveVideo = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const res = await saveClipWithExplorer(projectId, clip.file, `${clip.id}_tiktok.mp4`);
      if (res.saved) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error("Failed to save video:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenStudio = () => {
    window.open("https://www.tiktok.com/creator-center/upload?from=webapp", "_blank", "noopener,noreferrer");
  };

  const handleSaveApiKeys = () => {
    localStorage.setItem("cliprobin_tiktok_client_key", clientKey.trim());
    localStorage.setItem("cliprobin_tiktok_client_secret", clientSecret.trim());
    setApiStatus("Credentials saved locally. Direct posting requires an approved TikTok Developer App with video.upload scope.");
    setTimeout(() => setApiStatus(null), 5000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tiktok-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in-0 duration-150"
    >
      <div className="relative flex flex-col max-w-xl w-full rounded-2xl border border-zinc-800 bg-[#121215] shadow-2xl overflow-hidden max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-6 py-4 bg-zinc-900/50">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-black border border-zinc-700/80 flex items-center justify-center text-white shadow-inner">
              <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.46 6.27 6.27 0 0 0 1.96-4.46V8.71a8.28 8.28 0 0 0 5.1 1.77V7.03a4.88 4.88 0 0 1-1.29-.34z" />
              </svg>
            </div>
            <div>
              <h2 id="tiktok-modal-title" className="text-base font-bold text-white flex items-center gap-2">
                Upload to TikTok
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-800/60">
                  9:16 Vertical
                </span>
              </h2>
              <p className="text-xs text-zinc-400">Share your short-form vertical video to TikTok</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="size-8 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors focus-ring"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-zinc-800 bg-zinc-950/40 px-6 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab("studio")}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "studio"
                ? "border-[#25F4EE] text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>TikTok Web Studio</span>
            <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 text-[10px] border border-emerald-800/50">
              Recommended
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("api")}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "api"
                ? "border-[#25F4EE] text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>Direct API (Developer)</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(92vh-160px)]">
          {/* Clip Summary Preview */}
          <div className="flex items-center gap-3 p-3 rounded-xl border border-zinc-800 bg-zinc-900/60">
            {videoUrl && (
              <div className="relative aspect-[9/16] w-12 h-20 rounded-lg overflow-hidden bg-black shrink-0 border border-zinc-700/80">
                <video src={videoUrl} className="size-full object-cover" muted />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{clip.title}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Duration: {Math.round(clip.end - clip.start)}s • 1080×1920 (9:16)
              </p>
              {clip.top_line && (
                <p className="text-[11px] text-emerald-400 font-medium truncate mt-1">
                  Hook: &quot;{clip.top_line}&quot;
                </p>
              )}
            </div>
          </div>

          {activeTab === "studio" ? (
            <div className="space-y-4">
              {/* Step 1: Caption & Hashtags */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="tiktok-caption" className="text-xs font-medium text-zinc-300">
                    Caption & Viral Hashtags
                  </label>
                  <button
                    type="button"
                    onClick={handleCopyCaption}
                    className="text-xs font-medium text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
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
                  id="tiktok-caption"
                  rows={4}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-white placeholder-zinc-500 focus:border-cyan-500 focus:outline-none"
                  placeholder="Enter TikTok caption and hashtags..."
                />
              </div>

              {/* Step 2: Actions */}
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold text-zinc-300">Publish Workflow:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleSaveVideo}
                    disabled={isSaving}
                    className="p-3 rounded-xl border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-xs font-bold text-white transition-all flex items-center justify-center gap-2 focus-ring"
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
                    onClick={handleOpenStudio}
                    className="p-3 rounded-xl bg-black border border-[#25F4EE]/50 hover:border-[#25F4EE] hover:bg-zinc-900 text-xs font-bold text-white transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-950/20 focus-ring"
                  >
                    <svg className="size-4 text-[#25F4EE]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.46 6.27 6.27 0 0 0 1.96-4.46V8.71a8.28 8.28 0 0 0 5.1 1.77V7.03a4.88 4.88 0 0 1-1.29-.34z" />
                    </svg>
                    <span>2. Open TikTok Studio</span>
                  </button>
                </div>
              </div>

              {/* Instructions checklist */}
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 space-y-2 text-xs text-zinc-400">
                <p className="font-semibold text-zinc-300">How to publish via TikTok Studio:</p>
                <ol className="list-decimal list-inside space-y-1 pl-1">
                  <li>Click <strong>&quot;1. Save Video File&quot;</strong> to export the 9:16 clip.</li>
                  <li>Click <strong>&quot;2. Open TikTok Studio&quot;</strong> to launch the web uploader.</li>
                  <li>Drag and drop your exported MP4 video into TikTok Studio.</li>
                  <li>Click <strong>&quot;Copy Caption&quot;</strong> above and paste into TikTok&apos;s caption box.</li>
                </ol>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs text-amber-300 space-y-1">
                <p className="font-semibold">TikTok Content Posting API (Beta)</p>
                <p className="text-zinc-400">
                  Direct automated uploading requires an approved TikTok Developer App with the{" "}
                  <code className="text-amber-200">video.upload</code> scope. If you don&apos;t have API approval yet, use the{" "}
                  <strong>TikTok Web Studio</strong> tab above.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label htmlFor="tiktok-key" className="text-xs font-medium text-zinc-300">
                    TikTok Client Key
                  </label>
                  <input
                    id="tiktok-key"
                    type="text"
                    value={clientKey}
                    onChange={(e) => setClientKey(e.target.value)}
                    placeholder="awxxxxxxx..."
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-2.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="tiktok-secret" className="text-xs font-medium text-zinc-300">
                    TikTok Client Secret
                  </label>
                  <input
                    id="tiktok-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="Enter Client Secret"
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-2.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                {apiStatus && (
                  <p className="text-xs text-cyan-400 bg-cyan-950/40 border border-cyan-800/40 p-2.5 rounded-xl">
                    {apiStatus}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleSaveApiKeys}
                  className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition-colors focus-ring"
                >
                  Save TikTok API Configuration
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
