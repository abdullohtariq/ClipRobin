"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  getYouTubeStatus,
  saveYouTubeConfig,
  saveYouTubeJsonConfig,
  getYouTubeAuthUrl,
  disconnectYouTube,
  uploadClipToYouTube,
  YouTubeStatusResponse,
  Clip,
} from "@/src/lib/api";

interface YouTubeUploadModalProps {
  clip: Clip;
  projectId: string;
  onClose: () => void;
}

export function YouTubeUploadModal({
  clip,
  projectId,
  onClose,
}: YouTubeUploadModalProps) {
  const [status, setStatus] = useState<YouTubeStatusResponse | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Configuration form state
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [useJsonPaste, setUseJsonPaste] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  // Connecting state
  const [isConnecting, setIsConnecting] = useState(false);

  // Upload form state
  const [title, setTitle] = useState(() => {
    const raw = clip.title || `Clip ${clip.id}`;
    return raw.toLowerCase().includes("#shorts") ? raw : `${raw} #shorts`;
  });
  const [description, setDescription] = useState(
    () => clip.reason ? `${clip.reason}\n\nCreated with Clip Robin` : "Created with Clip Robin",
  );
  const [tags, setTags] = useState("shorts, cliprobin");
  const [privacyStatus, setPrivacyStatus] = useState<"public" | "unlisted" | "private">("public");
  const [madeForKids, setMadeForKids] = useState(false);

  // Upload execution state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    videoId: string;
    shortsUrl: string;
    youtubeUrl: string;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Polling ref for OAuth popup
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setIsLoadingStatus(true);
      setStatusError(null);
      const res = await getYouTubeStatus();
      setStatus(res);
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load YouTube status";
      setStatusError(msg);
      return null;
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Listen for OAuth postMessage callback from the popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "CLIPROBIN_YOUTUBE_AUTH_SUCCESS") {
        void fetchStatus();
        setIsConnecting(false);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchStatus]);

  // Handle saving Google OAuth Credentials
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfigError(null);
    setIsSavingConfig(true);

    try {
      if (useJsonPaste) {
        if (!rawJson.trim()) {
          throw new Error("Please paste the contents of your Google client_secret_*.json file.");
        }
        const res = await saveYouTubeJsonConfig(rawJson);
        setStatus(res.status);
      } else {
        if (!clientId.trim() || !clientSecret.trim()) {
          throw new Error("Both Client ID and Client Secret are required.");
        }
        const res = await saveYouTubeConfig(clientId.trim(), clientSecret.trim());
        setStatus(res.status);
      }
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Handle Connect to Google / YouTube
  const handleConnect = async () => {
    setIsConnecting(true);
    setStatusError(null);

    try {
      const { auth_url } = await getYouTubeAuthUrl();
      // Open in centered popup window
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        auth_url,
        "cliprobin_yt_oauth",
        `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no`,
      );

      // Poll periodically in case postMessage is blocked by cross-origin policies
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        try {
          const curStatus = await getYouTubeStatus();
          if (curStatus.authenticated) {
            setStatus(curStatus);
            setIsConnecting(false);
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            if (popup && !popup.closed) popup.close();
          } else if (popup && popup.closed) {
            setIsConnecting(false);
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          }
        } catch {
          // ignore
        }
      }, 1500);
    } catch (err) {
      setIsConnecting(false);
      setStatusError(err instanceof Error ? err.message : "Could not open authorization window");
    }
  };

  // Handle Disconnect
  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect this YouTube account?")) return;
    try {
      setIsLoadingStatus(true);
      const res = await disconnectYouTube();
      setStatus(res.status);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setIsLoadingStatus(false);
    }
  };

  // Handle Upload
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setUploadError("Title is required.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await uploadClipToYouTube({
        project_id: projectId,
        clip_id: clip.id,
        title: title.trim(),
        description: description.trim(),
        tags: tagList,
        privacy_status: privacyStatus,
        made_for_kids: madeForKids,
      });

      setUploadResult({
        videoId: res.video_id,
        shortsUrl: res.shorts_url,
        youtubeUrl: res.youtube_url,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyLink = () => {
    if (!uploadResult) return;
    navigator.clipboard.writeText(uploadResult.shortsUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upload Clip to YouTube"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in-0 duration-150"
    >
      <div className="relative flex flex-col max-w-xl w-full rounded-2xl border border-zinc-800 bg-[#121215] shadow-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-6 py-4 bg-[#141418]">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg bg-[#FF0000]/15 flex items-center justify-center text-[#FF0000] border border-[#FF0000]/30 shadow-inner">
              <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                Upload to YouTube
              </h2>
              <p className="text-xs text-zinc-400">
                Publish clip directly to your YouTube channel as a Short
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="size-8 rounded-full bg-zinc-800/80 border border-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center focus-ring"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {isLoadingStatus ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3">
              <div className="size-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-zinc-400">Checking YouTube connection...</p>
            </div>
          ) : uploadResult ? (
            /* Upload Success View */
            <div className="text-center py-6 space-y-4">
              <div className="size-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto text-2xl font-bold">
                ✓
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Upload Successful!</h3>
                <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
                  Your clip has been uploaded to your YouTube channel. YouTube will process it into a Short shortly.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-left space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Video ID:</span>
                  <span className="font-mono text-zinc-200">{uploadResult.videoId}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Shorts URL:</span>
                  <a
                    href={uploadResult.shortsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:underline truncate max-w-[260px]"
                  >
                    {uploadResult.shortsUrl}
                  </a>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <a
                  href={uploadResult.shortsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 rounded-xl bg-[#FF0000] hover:bg-[#E50914] text-white text-xs font-bold transition-colors inline-flex items-center gap-1.5 focus-ring"
                >
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10 15l5.19-3L10 9v6m11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09L22 12c0 2.19-.16 3.8-.44 4.83-.25.9-.83 1.48-1.73 1.73-.47.13-1.33.22-2.65.28-1.3.07-2.49.1-3.59.1L12 22c-4.19 0-6.8-.16-7.83-.44-.9-.25-1.48-.83-1.73-1.73-.13-.47-.22-1.1-.28-1.9-.07-.8-.1-1.49-.1-2.09L2 12c0-2.19.16-3.8.44-4.83.25-.9.83-1.48 1.73-1.73.47-.13 1.33-.22 2.65-.28 1.3-.07 2.49-.1 3.59-.1L12 2c4.19 0 6.8.16 7.83.44.9.25 1.48.83 1.73 1.73z" />
                  </svg>
                  <span>Open on YouTube Shorts</span>
                </a>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium transition-colors focus-ring"
                >
                  {copiedLink ? "Link Copied!" : "Copy Link"}
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl border border-zinc-800 bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white text-xs font-medium transition-colors focus-ring"
                >
                  Done
                </button>
              </div>
            </div>
          ) : !status?.configured ? (
            /* Step 1: Configure OAuth Credentials */
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                <h3 className="text-xs font-bold text-amber-300">
                  Google OAuth Credentials Required
                </h3>
                <p className="text-xs text-amber-200/80 mt-1 leading-relaxed">
                  To connect your personal YouTube channel securely from your machine, you need a free Google Cloud OAuth Client ID with YouTube upload permissions.
                </p>
              </div>

              {/* Instructions Collapsible */}
              <div className="rounded-xl border border-zinc-800 bg-[#0d0d10] p-4 text-xs">
                <button
                  type="button"
                  onClick={() => setShowInstructions((prev) => !prev)}
                  className="w-full flex items-center justify-between text-zinc-300 font-semibold hover:text-white"
                >
                  <span>How to get free Google credentials in 2 minutes</span>
                  <span>{showInstructions ? "▲" : "▼"}</span>
                </button>

                {showInstructions && (
                  <ol className="list-decimal list-inside space-y-1.5 mt-3 text-zinc-400 pl-1">
                    <li>
                      Visit{" "}
                      <a
                        href="https://console.cloud.google.com/apis/credentials"
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-400 hover:underline"
                      >
                        Google Cloud Console Credentials
                      </a>
                    </li>
                    <li>Create a project (e.g. &ldquo;Clip Robin&rdquo;) and enable <strong>YouTube Data API v3</strong>.</li>
                    <li>
                      Under <strong>OAuth consent screen</strong>, select External and add scopes:
                      <code className="block mt-1 font-mono text-[11px] text-zinc-300 bg-zinc-900 p-1 rounded">
                        https://www.googleapis.com/auth/youtube.upload
                      </code>
                    </li>
                    <li>Create Credentials &rarr; <strong>OAuth client ID</strong> &rarr; Web application.</li>
                    <li>
                      Add Authorised redirect URI:
                      <code className="block mt-1 font-mono text-[11px] text-emerald-400 bg-zinc-900 p-1 rounded select-all">
                        http://127.0.0.1:8000/api/youtube/oauth/callback
                      </code>
                    </li>
                    <li>Copy Client ID &amp; Client Secret below, or paste the downloaded JSON.</li>
                  </ol>
                )}
              </div>

              {/* Toggle Manual vs Paste JSON */}
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setUseJsonPaste(false)}
                  className={`px-3 py-1 rounded-lg border text-xs font-medium ${
                    !useJsonPaste
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-800 text-zinc-400 hover:text-white"
                  }`}
                >
                  Enter Client ID &amp; Secret
                </button>
                <button
                  type="button"
                  onClick={() => setUseJsonPaste(true)}
                  className={`px-3 py-1 rounded-lg border text-xs font-medium ${
                    useJsonPaste
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-800 text-zinc-400 hover:text-white"
                  }`}
                >
                  Paste client_secret_*.json
                </button>
              </div>

              <form onSubmit={handleSaveConfig} className="space-y-3.5">
                {useJsonPaste ? (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Google OAuth JSON Content
                    </label>
                    <textarea
                      rows={5}
                      value={rawJson}
                      onChange={(e) => setRawJson(e.target.value)}
                      placeholder='{"installed":{"client_id":"...","client_secret":"..."}}'
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus-ring"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1">
                        Google Client ID
                      </label>
                      <input
                        type="text"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        placeholder="123456789-xxxx.apps.googleusercontent.com"
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1">
                        Google Client Secret
                      </label>
                      <input
                        type="password"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        placeholder="GOCSPX-xxxxxxxxxxxx"
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus-ring"
                      />
                    </div>
                  </>
                )}

                {configError && (
                  <p className="text-xs text-rose-400">{configError}</p>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={isSavingConfig}
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-zinc-950 font-bold text-xs transition-colors focus-ring"
                  >
                    {isSavingConfig ? "Saving..." : "Save & Proceed to Connect"}
                  </button>
                </div>
              </form>
            </div>
          ) : !status?.authenticated ? (
            /* Step 2: Connect Google Account / YouTube Channel */
            <div className="space-y-5 text-center py-4">
              <div className="size-16 rounded-full bg-zinc-800 border border-zinc-700 mx-auto flex items-center justify-center text-3xl">
                <svg className="size-8 text-[#FF0000]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </div>

              <div>
                <h3 className="text-base font-bold text-white">
                  Connect YouTube Channel
                </h3>
                <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto leading-relaxed">
                  Sign in with Google to grant permission to upload this clip directly to your YouTube channel.
                </p>
              </div>

              {status.client_id_preview && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/80 text-[11px] font-mono text-zinc-400">
                  <span>Client ID:</span>
                  <span className="text-zinc-200">{status.client_id_preview}</span>
                </div>
              )}

              {statusError && (
                <p className="text-xs text-rose-400">{statusError}</p>
              )}

              <div className="space-y-3">
                <button
                  type="button"
                  disabled={isConnecting}
                  onClick={handleConnect}
                  className="px-6 py-3 rounded-xl bg-white hover:bg-zinc-200 text-zinc-900 font-bold text-xs inline-flex items-center gap-2.5 shadow-lg transition-transform hover:scale-[1.02] focus-ring"
                >
                  <svg className="size-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>{isConnecting ? "Waiting for authorization..." : "Sign in with Google"}</span>
                </button>

                {isConnecting && (
                  <div className="pt-1 flex flex-col items-center gap-1 text-xs">
                    <p className="text-zinc-400">Complete authorization in the Google sign-in window.</p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleConnect}
                        className="text-emerald-400 hover:underline font-medium"
                      >
                        Reopen window
                      </button>
                      <span className="text-zinc-600">•</span>
                      <button
                        type="button"
                        onClick={() => setIsConnecting(false)}
                        className="text-zinc-400 hover:text-zinc-200 underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 rounded-xl border border-zinc-800 bg-[#0d0d10] text-left text-xs text-zinc-400 max-w-md mx-auto space-y-1">
                <span className="font-semibold text-zinc-300">Google Consent Screen Note:</span>
                <p>If your OAuth app is in <strong>Testing</strong> mode in Google Cloud Console, ensure your Google email is added under <strong>OAuth consent screen &rarr; Test users</strong>.</p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setStatus((prev) => prev ? { ...prev, configured: false } : null)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 underline"
                >
                  Change Google Client ID / Secret
                </button>
              </div>
            </div>
          ) : (
            /* Step 3: Connected & Ready to Upload Form */
            <form onSubmit={handleUpload} className="space-y-4">
              {/* Channel Info Bar */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20">
                <div className="flex items-center gap-3 min-w-0">
                  {status.channel?.thumbnail ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={status.channel.thumbnail}
                      alt={status.channel.title}
                      className="size-8 rounded-full border border-emerald-500/40 object-cover shrink-0"
                    />
                  ) : (
                    <div className="size-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0">
                      YT
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white truncate">
                        {status.channel?.title || "Connected YouTube Channel"}
                      </span>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 font-semibold px-1.5 py-0.2 rounded border border-emerald-500/30">
                        Connected
                      </span>
                    </div>
                    {status.channel?.handle && (
                      <p className="text-[11px] text-zinc-400 truncate">
                        {status.channel.handle}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="text-xs text-zinc-400 hover:text-rose-400 px-2 py-1 rounded hover:bg-zinc-800 transition-colors shrink-0"
                >
                  Disconnect
                </button>
              </div>

              {/* Title */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-zinc-300">
                    Shorts Title
                  </label>
                  <span className="text-[11px] font-mono text-zinc-500">
                    {title.length}/100
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus-ring"
                />
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-zinc-300">
                    Description
                  </label>
                  <span className="text-[11px] font-mono text-zinc-500">
                    {description.length}/5000
                  </span>
                </div>
                <textarea
                  rows={3}
                  maxLength={5000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus-ring"
                />
              </div>

              {/* Tags & Visibility Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Tags (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="shorts, viral, podcast"
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus-ring"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Visibility
                  </label>
                  <select
                    value={privacyStatus}
                    onChange={(e) => setPrivacyStatus(e.target.value as "public" | "unlisted" | "private")}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs text-zinc-100 focus-ring"
                  >
                    <option value="public">Public (Everyone can see)</option>
                    <option value="unlisted">Unlisted (Anyone with link)</option>
                    <option value="private">Private (Only you)</option>
                  </select>
                </div>
              </div>

              {/* Made for Kids */}
              <div className="pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={madeForKids}
                    onChange={(e) => setMadeForKids(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500/30"
                  />
                  <span className="text-xs text-zinc-300">
                    Made for Kids (COPPA requirement)
                  </span>
                </label>
              </div>

              {uploadError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
                  {uploadError}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isUploading}
                  className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors focus-ring"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-5 py-2.5 rounded-xl bg-[#FF0000] hover:bg-[#E50914] disabled:opacity-50 text-white text-xs font-bold transition-colors inline-flex items-center gap-2 shadow-lg focus-ring"
                >
                  {isUploading ? (
                    <>
                      <div className="size-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Uploading to YouTube...</span>
                    </>
                  ) : (
                    <>
                      <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                      </svg>
                      <span>Upload to YouTube</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
