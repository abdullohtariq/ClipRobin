"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  CaptionStyle,
  getYouTubeStatus,
  saveYouTubeConfig,
  getYouTubeAuthUrl,
  disconnectYouTube,
  saveGeminiApiKey,
  setAIDeveloperMode,
  YouTubeStatusResponse,
} from "@/src/lib/api";
import { useAIDeveloperStatus } from "@/src/hooks/use-ai-developer-status";
import { useSubscription } from "@/src/lib/subscription-context";
import { CustomWatermarkSettings } from "@/src/components/custom-watermark-settings";

const SETTINGS_STORAGE_KEY = "cliprobin.settings";

interface AppSettings {
  confirmDelete: boolean;
  defaultCaptionStyle: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  confirmDelete: true,
  defaultCaptionStyle: "classic",
};

export default function SettingsPage() {
  const { status: aiDevStatus, refresh: refreshAiStatus } = useAIDeveloperStatus();
  const { isPro, openUpgradeModal, isCaptionStyleAllowed } = useSubscription();

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
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [developerModeSaving, setDeveloperModeSaving] = useState(false);
  const [aiSettingsError, setAiSettingsError] = useState<string | null>(null);

  const handleSaveGeminiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!geminiApiKey.trim()) return;
    setGeminiSaving(true);
    setAiSettingsError(null);
    try {
      await saveGeminiApiKey(geminiApiKey.trim());
      setGeminiApiKey("");
      await refreshAiStatus();
    } catch (err) {
      setAiSettingsError(err instanceof Error ? err.message : "Could not save the Gemini key.");
    } finally {
      setGeminiSaving(false);
    }
  };

  const handleDeveloperModeToggle = async () => {
    if (!aiDevStatus) return;
    setDeveloperModeSaving(true);
    setAiSettingsError(null);
    try {
      await setAIDeveloperMode(!aiDevStatus.developer_mode);
      await refreshAiStatus();
    } catch (err) {
      setAiSettingsError(err instanceof Error ? err.message : "Could not update Developer Mode.");
    } finally {
      setDeveloperModeSaving(false);
    }
  };

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
      let pollTicks = 0;
      ytPollRef.current = setInterval(async () => {
        pollTicks += 1;
        if (pollTicks > 200) {
          setYtConnecting(false);
          if (ytPollRef.current) clearInterval(ytPollRef.current);
          return;
        }
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
    const normalizeStyle = (raw?: string | null): CaptionStyle => {
      if (raw === "bold_emerald") return "robin";
      if (raw === "clean_gold") return "clean";
      if (raw && ["classic", "robin", "clean", "punch", "pill", "karaoke"].includes(raw)) {
        return raw as CaptionStyle;
      }
      return "classic";
    };

    const syncFromStorage = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        const activeStyle = localStorage.getItem("cliprobin_caption_style");
        const candidate = normalizeStyle(parsed.defaultCaptionStyle || activeStyle);
        const safeStyle = isCaptionStyleAllowed(candidate) ? candidate : "classic";
        const nextSettings: AppSettings = {
          confirmDelete: parsed.confirmDelete !== false,
          defaultCaptionStyle: safeStyle,
        };
        setSettings(nextSettings);
      } catch {
        // Ignore JSON parse errors
      }
    };

    syncFromStorage();
  }, [isCaptionStyleAllowed]);

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

  const { confirmDelete, defaultCaptionStyle } = settings;

  return (
    <main className="min-h-screen bg-[#09090b] text-white p-6 lg:p-10">
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
          {/* Subscription & License Section */}
          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm transition-all duration-150 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-6 rounded-md bg-amber-500/15 flex items-center justify-center text-amber-300 border border-amber-500/30 text-xs font-bold">
                  ★
                </div>
                <h2 className="text-base font-semibold text-white">Account &amp; Subscription</h2>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${
                  isPro
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-300"
                }`}
              >
                <span className={`size-1.5 rounded-full ${isPro ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                {isPro ? "Clip Robin Pro Active" : "Free Starter Plan"}
              </span>
            </div>

            <p className="text-xs text-zinc-400">
              {isPro
                ? "You have full access to Gemini AI Hooks, custom brand watermarks, and all subtitle styles."
                : "Free tier processes video locally for free. Upgrade to Pro to unlock Gemini AI hook detection, remove watermarks, and use custom brand logos."}
            </p>

            <Link href="/subscription" className="inline-block rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800">
              Manage account and plan
            </Link>
          </section>

          {/* Custom Watermark & Brand Logo Section */}
          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm transition-all duration-150 space-y-4">
            <h2 className="text-base font-semibold text-white">Brand Watermark &amp; Logo</h2>
            <p className="text-xs text-zinc-400">
              Customize or replace the watermark that appears in the safe zones of your exported vertical clips.
            </p>
            <CustomWatermarkSettings />
          </section>
          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm transition-all duration-150 space-y-4">
            <h2 className="text-base font-semibold text-white">General &amp; Export Behavior</h2>

            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3.5">
              <div>
                <span className="text-xs font-medium text-zinc-200">Confirm before deleting projects</span>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Show a confirmation prompt before removing local project files.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Confirm before deleting projects"
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

            <div className="rounded-xl border border-zinc-800/80 bg-[#0c0c0e] p-3.5 text-xs text-zinc-400 flex flex-wrap items-center justify-between gap-2">
              <span>Output encoding specification</span>
              <span className="font-mono text-zinc-200">720×1280 • 30 fps H.264/AAC MP4</span>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm transition-all duration-150 space-y-4">
            <h2 className="text-base font-semibold text-white">Caption Defaults</h2>
            <div>
              <label htmlFor="settings-caption-style-select" className="block text-xs font-medium text-zinc-400 mb-1.5">Default caption style</label>
              <select
                id="settings-caption-style-select"
                value={defaultCaptionStyle}
                onChange={(e) => {
                  const nextVal = e.target.value as CaptionStyle;
                  if (!isCaptionStyleAllowed(nextVal)) {
                    openUpgradeModal("Pro Subtitle Styles");
                    return;
                  }
                  updateSetting("defaultCaptionStyle", nextVal);
                }}
                className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
              >
                <option value="classic">Classic (Original Clip Robin word-by-word)</option>
                <option value="clean">Clean (Minimalist Montserrat Bold)</option>
                <option value="robin">{isPro ? "Robin (Signature viral all-caps)" : "Robin (Signature viral all-caps) — PRO"}</option>
                <option value="punch">{isPro ? "Punch (High-impact Anton all-caps)" : "Punch (High-impact Anton all-caps) — PRO"}</option>
                <option value="pill">{isPro ? "Pill (Translucent dark box)" : "Pill (Translucent dark box) — PRO"}</option>
                <option value="karaoke">{isPro ? "Karaoke (Smooth sweep fill)" : "Karaoke (Smooth sweep fill) — PRO"}</option>
              </select>
            </div>
          </section>

          {/* AI Developer Mode */}
          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm transition-all duration-150 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-6 rounded-md bg-violet-500/15 flex items-center justify-center text-violet-300 border border-violet-400/30 text-sm">✦</div>
                <h2 className="text-base font-semibold text-white">AI Developer Mode</h2>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${aiDevStatus?.ai_enabled ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-zinc-800/60 border-zinc-700 text-zinc-400"}`}>
                {aiDevStatus?.ai_enabled ? "Enabled" : "Locked"}
              </span>
            </div>

            <p className="text-xs text-zinc-400">
              Gemini finds high-engagement clip moments. When AI Hook Finder runs, timestamped transcript text is sent to Gemini over HTTPS; your API key stays local on this computer.
            </p>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="text-zinc-500">Gemini API key</div>
                <div className={aiDevStatus?.gemini_configured ? "mt-1 font-medium text-emerald-400" : "mt-1 font-medium text-zinc-300"}>
                  {aiDevStatus?.gemini_configured ? "Saved locally" : "Not configured"}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="text-zinc-500">AI Hook Finder</div>
                <div className={aiDevStatus?.ai_enabled ? "mt-1 font-medium text-emerald-400" : "mt-1 font-medium text-zinc-300"}>
                  {aiDevStatus?.ai_enabled ? "Active & Ready" : "Disabled"}
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveGeminiKey} className="space-y-3">
              <div>
                <label htmlFor="gemini-api-key" className="block text-xs font-medium text-zinc-400 mb-1.5">Gemini API key</label>
                <input
                  id="gemini-api-key"
                  type="password"
                  autoComplete="new-password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder={aiDevStatus?.gemini_configured ? "Key saved; enter a new key to replace it" : "Paste your free-tier Gemini API key"}
                  className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-xs text-violet-300 hover:text-violet-200 hover:underline">
                  Get a Gemini API key in Google AI Studio
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={geminiSaving || !geminiApiKey.trim()} className="px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-400 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold text-white transition-colors">
                  {geminiSaving ? "Saving..." : aiDevStatus?.gemini_configured ? "Replace Gemini key" : "Save Gemini key"}
                </button>
                <button
                  type="button"
                  onClick={handleDeveloperModeToggle}
                  disabled={developerModeSaving || (!aiDevStatus?.developer_mode && !aiDevStatus?.gemini_configured)}
                  className={`px-4 py-2 rounded-xl border text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${aiDevStatus?.developer_mode ? "border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200" : "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"}`}
                >
                  {developerModeSaving ? "Updating..." : aiDevStatus?.developer_mode ? "Disable Developer Mode" : "Enable Developer Mode"}
                </button>
              </div>
            </form>

            {aiSettingsError && <p role="alert" className="text-xs text-rose-400">{aiSettingsError}</p>}
            {!aiSettingsError && !aiDevStatus?.ai_enabled && <p className="text-xs text-amber-300/90">{aiDevStatus?.reason || "Checking Gemini status..."}</p>}
            {aiDevStatus?.ai_enabled && <p className="text-xs text-emerald-300">AI generation is unlocked. The AI Hook Finder option is available in clip settings.</p>}
          </section>

          {/* YouTube Integration Section */}
          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm transition-all duration-150 space-y-4">
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
                    className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
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
                    className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]"
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
