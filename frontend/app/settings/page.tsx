"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  getYouTubeStatus,
  saveYouTubeConfig,
  getYouTubeAuthUrl,
  disconnectYouTube,
  YouTubeStatusResponse,
} from "@/src/lib/api";

const SETTINGS_STORAGE_KEY = "cliprobin.settings";

interface AppSettings {
  directory: string;
  openClips: boolean;
  confirmDelete: boolean;
  outputFormat: string;
  aspectRatio: string;
  quality: string;
  defaultCaptionStyle: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  directory: "data/projects",
  openClips: true,
  confirmDelete: true,
  outputFormat: "MP4",
  aspectRatio: "9:16 (Vertical)",
  quality: "High",
  defaultCaptionStyle: "classic",
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isSaved, setIsSaved] = useState(false);

  // YouTube OAuth state
  const [ytStatus, setYtStatus] = useState<YouTubeStatusResponse | null>(null);
  const [ytLoading, setYtLoading] = useState(true);
  const [ytClientId, setYtClientId] = useState("");
  const [ytClientSecret, setYtClientSecret] = useState("");
  const [ytSaving, setYtSaving] = useState(false);
  const [ytConnecting, setYtConnecting] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const ytPollRef = useRef<NodeJS.Timeout | null>(null);

  const loadYtStatus = useCallback(async () => {
    try {
      setYtLoading(true);
      const res = await getYouTubeStatus();
      setYtStatus(res);
    } catch {
      // ignore
    } finally {
      setYtLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadYtStatus();
    const handleMsg = (e: MessageEvent) => {
      if (e.data?.type === "CLIPROBIN_YOUTUBE_AUTH_SUCCESS") {
        void loadYtStatus();
        setYtConnecting(false);
      }
    };
    window.addEventListener("message", handleMsg);
    return () => {
      window.removeEventListener("message", handleMsg);
      if (ytPollRef.current) clearInterval(ytPollRef.current);
    };
  }, [loadYtStatus]);

  const handleSaveYtConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytClientId.trim() || !ytClientSecret.trim()) {
      setYtError("Both Client ID and Client Secret are required.");
      return;
    }
    setYtSaving(true);
    setYtError(null);
    try {
      const res = await saveYouTubeConfig(ytClientId.trim(), ytClientSecret.trim());
      setYtStatus(res.status);
    } catch (err) {
      setYtError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setYtSaving(false);
    }
  };

  const handleConnectYt = async () => {
    setYtConnecting(true);
    setYtError(null);
    try {
      const { auth_url } = await getYouTubeAuthUrl();
      const popup = window.open(auth_url, "cliprobin_yt_oauth", "width=600,height=700");
      if (ytPollRef.current) clearInterval(ytPollRef.current);
      ytPollRef.current = setInterval(async () => {
        try {
          const s = await getYouTubeStatus();
          if (s.authenticated) {
            setYtStatus(s);
            setYtConnecting(false);
            if (ytPollRef.current) clearInterval(ytPollRef.current);
            if (popup && !popup.closed) popup.close();
          } else if (popup && popup.closed) {
            setYtConnecting(false);
            if (ytPollRef.current) clearInterval(ytPollRef.current);
          }
        } catch {
          // ignore
        }
      }, 1500);
    } catch (err) {
      setYtConnecting(false);
      setYtError(err instanceof Error ? err.message : "Could not open authorization window");
    }
  };

  const handleDisconnectYt = async () => {
    if (!confirm("Disconnect YouTube channel?")) return;
    try {
      setYtLoading(true);
      const res = await disconnectYouTube();
      setYtStatus(res.status);
    } catch (err) {
      setYtError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setYtLoading(false);
    }
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      const activeStyle = localStorage.getItem("cliprobin_caption_style");
      setSettings({
        ...DEFAULT_SETTINGS,
        ...parsed,
        defaultCaptionStyle: parsed.defaultCaptionStyle || activeStyle || DEFAULT_SETTINGS.defaultCaptionStyle,
      });
    } catch {
      // Ignore JSON parse errors
    }
  }, []);

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
        if (key === "defaultCaptionStyle") {
          localStorage.setItem("cliprobin_caption_style", String(value));
        }
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2000);
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const { directory, openClips, confirmDelete, outputFormat, aspectRatio, quality, defaultCaptionStyle } = settings;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white p-6 lg:p-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Settings</h1>
            <p className="mt-1.5 text-sm text-zinc-400">Local defaults for Clip Robin.</p>
          </div>
          {isSaved && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 transition-all duration-150">
              <svg className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
              </svg>
              Saved
            </span>
          )}
        </header>

        <div className="space-y-6">
          <section className="rounded-[12px] border border-[#232326] bg-[#111113] p-6 shadow-sm transition-all duration-150 space-y-5">
            <h2 className="text-base font-semibold text-white">General</h2>
            <div>
              <label htmlFor="settings-directory-input" className="block text-xs font-medium text-zinc-400 mb-1.5">
                Default project directory
              </label>
              <input
                id="settings-directory-input"
                value={directory}
                onChange={(event) => updateSetting("directory", event.target.value)}
                className="w-full rounded-[10px] border border-[#232326] bg-[#0a0a0a] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 transition-all duration-150 focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
              />
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-3.5">
                <span className="text-xs text-zinc-300">Automatically open generated clips</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={openClips}
                  onClick={() => updateSetting("openClips", !openClips)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                    openClips ? "bg-[#10b981]" : "bg-zinc-800"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-150 ease-in-out ${
                      openClips ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between rounded-[10px] border border-[#232326] bg-[#0a0a0a] p-3.5">
                <span className="text-xs text-zinc-300">Confirm before deleting projects</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={confirmDelete}
                  onClick={() => updateSetting("confirmDelete", !confirmDelete)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#10b981] ${
                    confirmDelete ? "bg-[#10b981]" : "bg-zinc-800"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm transition duration-150 ease-in-out ${
                      confirmDelete ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-[12px] border border-[#232326] bg-[#111113] p-6 shadow-sm transition-all duration-150 space-y-4">
            <h2 className="text-base font-semibold text-white">Video Defaults</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="settings-format-select" className="block text-xs font-medium text-zinc-400 mb-1.5">Output format</label>
                <select
                  id="settings-format-select"
                  value={outputFormat}
                  onChange={(e) => updateSetting("outputFormat", e.target.value)}
                  className="w-full rounded-[10px] border border-[#232326] bg-[#0a0a0a] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                >
                  <option value="MP4">MP4</option>
                  <option value="MOV">MOV</option>
                  <option value="MKV">MKV</option>
                </select>
              </div>
              <div>
                <label htmlFor="settings-aspect-select" className="block text-xs font-medium text-zinc-400 mb-1.5">Aspect ratio</label>
                <select
                  id="settings-aspect-select"
                  value={aspectRatio}
                  onChange={(e) => updateSetting("aspectRatio", e.target.value)}
                  className="w-full rounded-[10px] border border-[#232326] bg-[#0a0a0a] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                >
                  <option value="9:16 (Vertical)">9:16 (Vertical)</option>
                  <option value="Original">Original</option>
                  <option value="16:9 (Horizontal)">16:9 (Horizontal)</option>
                </select>
              </div>
              <div>
                <label htmlFor="settings-quality-select" className="block text-xs font-medium text-zinc-400 mb-1.5">Quality</label>
                <select
                  id="settings-quality-select"
                  value={quality}
                  onChange={(e) => updateSetting("quality", e.target.value)}
                  className="w-full rounded-[10px] border border-[#232326] bg-[#0a0a0a] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                >
                  <option value="High">High</option>
                  <option value="Original">Original</option>
                  <option value="Standard">Standard</option>
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-[12px] border border-[#232326] bg-[#111113] p-6 shadow-sm transition-all duration-150 space-y-4">
            <h2 className="text-base font-semibold text-white">Caption Defaults</h2>
            <div>
              <label htmlFor="settings-caption-style-select" className="block text-xs font-medium text-zinc-400 mb-1.5">Default caption style</label>
              <select
                id="settings-caption-style-select"
                value={defaultCaptionStyle}
                onChange={(e) => updateSetting("defaultCaptionStyle", e.target.value)}
                className="w-full rounded-[10px] border border-[#232326] bg-[#0a0a0a] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
              >
                <option value="classic">Classic (Original Clip Robin word-by-word)</option>
                <option value="robin">Robin (Signature viral all-caps)</option>
                <option value="punch">Punch (High-impact Anton all-caps)</option>
                <option value="clean">Clean (Minimalist Montserrat Bold)</option>
                <option value="pill">Pill (Translucent dark box)</option>
                <option value="karaoke">Karaoke (Smooth sweep fill)</option>
              </select>
            </div>
          </section>

          {/* YouTube Integration Section */}
          <section className="rounded-[12px] border border-[#232326] bg-[#111113] p-6 shadow-sm transition-all duration-150 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-6 rounded-md bg-[#FF0000]/15 flex items-center justify-center text-[#FF0000] border border-[#FF0000]/30">
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                </div>
                <h2 className="text-base font-semibold text-white">YouTube Integration</h2>
              </div>

              {ytStatus?.authenticated ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Connected
                </span>
              ) : ytStatus?.configured ? (
                <span className="text-xs text-amber-400 font-medium">Configured (Not Signed In)</span>
              ) : (
                <span className="text-xs text-zinc-500">Not Connected</span>
              )}
            </div>

            <p className="text-xs text-zinc-400">
              Connect your Google account with YouTube permissions to upload clips directly as YouTube Shorts.
            </p>

            {ytLoading ? (
              <div className="py-4 text-xs text-zinc-500">Loading YouTube status...</div>
            ) : ytStatus?.authenticated ? (
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20">
                <div className="flex items-center gap-3">
                  {ytStatus.channel?.thumbnail ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={ytStatus.channel.thumbnail}
                      alt={ytStatus.channel.title}
                      className="size-9 rounded-full border border-emerald-500/40 object-cover"
                    />
                  ) : (
                    <div className="size-9 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                      YT
                    </div>
                  )}
                  <div>
                    <h3 className="text-xs font-bold text-white">{ytStatus.channel?.title || "Connected Channel"}</h3>
                    <p className="text-[11px] text-zinc-400">{ytStatus.channel?.handle || ytStatus.channel?.id}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDisconnectYt}
                  className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 hover:text-white transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : ytStatus?.configured ? (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>Google Client ID:</span>
                  <span className="font-mono text-zinc-300">{ytStatus.client_id_preview}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={ytConnecting}
                    onClick={handleConnectYt}
                    className="px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-bold transition-colors inline-flex items-center gap-2"
                  >
                    <span>{ytConnecting ? "Waiting for sign in..." : "Sign in with Google"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setYtStatus((prev) => prev ? { ...prev, configured: false } : null)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 underline"
                  >
                    Edit Credentials
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveYtConfig} className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Google OAuth Client ID
                  </label>
                  <input
                    type="text"
                    value={ytClientId}
                    onChange={(e) => setYtClientId(e.target.value)}
                    placeholder="xxxx.apps.googleusercontent.com"
                    className="w-full rounded-[10px] border border-[#232326] bg-[#0a0a0a] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Google OAuth Client Secret
                  </label>
                  <input
                    type="password"
                    value={ytClientSecret}
                    onChange={(e) => setYtClientSecret(e.target.value)}
                    placeholder="GOCSPX-xxxx"
                    className="w-full rounded-[10px] border border-[#232326] bg-[#0a0a0a] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
                  />
                </div>
                {ytError && <p className="text-xs text-rose-400">{ytError}</p>}
                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={ytSaving}
                    className="px-4 py-2 rounded-xl bg-[#10b981] hover:bg-[#059669] text-xs font-bold text-zinc-950 transition-colors"
                  >
                    {ytSaving ? "Saving..." : "Save Credentials"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
