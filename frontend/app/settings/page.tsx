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
import { CaptionStylePicker } from "@/src/components/caption-style-picker";
import { CAPTION_STYLE_OPTIONS, normalizeCaptionStyle } from "@/src/lib/caption-styles";
import { ToggleRow } from "@/src/components/ui/toggle-row";
import { ConfirmDialog } from "@/src/components/ui/confirm-dialog";

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
  const { isPro, plan, openUpgradeModal, isCaptionStyleAllowed } = useSubscription();

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
  const [confirmDisconnectYtOpen, setConfirmDisconnectYtOpen] = useState(false);
  const [isCaptionPickerOpen, setIsCaptionPickerOpen] = useState(false);

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

  const executeDisconnectYt = async () => {
    setConfirmDisconnectYtOpen(false);
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
    const syncFromStorage = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        const activeStyle = localStorage.getItem("cliprobin_caption_style");
        const candidate = normalizeCaptionStyle(parsed.defaultCaptionStyle || activeStyle);
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
    <main className="min-h-screen bg-[#09090b] text-[#f4f4f5] p-4 md:p-8 xl:p-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3 pb-6 border-b border-zinc-800/80">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#f4f4f5]">Settings</h1>
            <p className="mt-1 text-sm text-zinc-400">Local defaults, brand watermark, and integrations.</p>
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
          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[#f4f4f5]">Account &amp; Subscription</h2>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${
                  isPro
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-300"
                }`}
              >
                <span className={`size-1.5 rounded-full ${isPro ? "bg-emerald-400" : "bg-amber-400"}`} />
                {isPro ? "Clip Robin Pro Active" : "Free Starter Plan"}
              </span>
            </div>

            <p className="text-xs text-zinc-400">
              {isPro
                ? "Full access to Gemini AI Hooks, custom brand watermarks, and all subtitle styles."
                : "Free tier processes video locally for free. Pro unlocks Gemini AI hook detection, watermark removal, and all caption styles."}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3.5 space-y-1">
                <div className="font-semibold text-emerald-400">Included on Free</div>
                <p className="text-zinc-400 leading-relaxed">
                  Local transcription, Fast Interval slicing, all 9:16 framing modes, Classic &amp; Clean captions, and MP4/ZIP exports.
                </p>
              </div>
              <div className="rounded-xl border border-amber-400/25 bg-[#0c0c0e] p-3.5 space-y-1">
                <div className="font-semibold text-amber-300">Included on Pro · $12/mo</div>
                <p className="text-zinc-300 leading-relaxed">
                  AI Hook Finder (20 credits/mo or own Gemini key), Robin/Punch/Pill/Karaoke styles, watermark removal &amp; custom logo.
                </p>
              </div>
            </div>

            <Link href="/subscription" className="min-h-[38px] inline-flex items-center rounded-xl border border-zinc-700 bg-[#18181c] hover:bg-[#202026] px-4 py-2 text-xs font-semibold text-zinc-200 transition-colors focus-ring">
              Manage account and plan
            </Link>
          </section>

          {/* General & Defaults Section */}
          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-[#f4f4f5]">General &amp; Defaults</h2>

            <ToggleRow
              label="Confirm before deleting projects"
              description="Show a confirmation dialog before removing local project files."
              checked={confirmDelete}
              onChange={(checked) => updateSetting("confirmDelete", checked)}
              className="bg-[#0c0c0e]"
            />

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="settings-caption-style-select" className="block text-xs font-medium text-zinc-300">
                  Default caption style
                </label>
                <button
                  type="button"
                  onClick={() => setIsCaptionPickerOpen(true)}
                  className="text-xs font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-2 cursor-pointer focus-ring"
                >
                  Preview styles
                </button>
              </div>
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
                className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3.5 py-2.5 text-xs text-white focus:border-[#10b981] focus-ring"
              >
                {CAPTION_STYLE_OPTIONS.map((styleOpt) => {
                  const lockedSuffix = !isPro && !isCaptionStyleAllowed(styleOpt.id) ? " — PRO" : "";
                  return (
                    <option key={styleOpt.id} value={styleOpt.id}>
                      {`${styleOpt.name} (${styleOpt.fontFamily})${lockedSuffix}`}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="rounded-xl border border-zinc-800/80 bg-[#0c0c0e] p-3.5 text-xs text-zinc-400 flex flex-wrap items-center justify-between gap-2">
              <span>Output encoding specification</span>
              <span className="font-mono text-zinc-200">720×1280 · 30 fps H.264/AAC MP4</span>
            </div>
          </section>

          {/* Custom Watermark & Brand Logo Section */}
          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm space-y-4">
            <div>
              <h2 className="text-base font-semibold text-[#f4f4f5]">Brand Watermark &amp; Logo</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Customize or replace the watermark shown in the safe zones of your vertical clips.
              </p>
            </div>
            <CustomWatermarkSettings />
          </section>

          {/* AI Developer Mode */}
          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#f4f4f5]">AI Developer Mode</h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-amber-400/25 bg-amber-400/10 text-amber-300 text-xs font-semibold">
                  Pro
                </span>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${aiDevStatus?.ai_enabled ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-zinc-800/60 border-zinc-700 text-zinc-400"}`}>
                {aiDevStatus?.ai_enabled ? "Active" : "Off"}
              </span>
            </div>

            <p className="text-xs text-zinc-400">
              Requires Clip Robin Pro for AI Hook Finder in Studio. Pro uses included Hook Finder credits when available, or enable Developer Mode to use your own Gemini key.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3">
                <div className="text-zinc-500">Gemini API key</div>
                <div className={aiDevStatus?.gemini_configured ? "mt-1 font-medium text-emerald-400" : "mt-1 font-medium text-zinc-300"}>
                  {aiDevStatus?.gemini_configured ? "Saved locally" : "Not configured"}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3">
                <div className="text-zinc-500">Hook Finder with your key</div>
                <div className={aiDevStatus?.ai_enabled ? "mt-1 font-medium text-emerald-400" : "mt-1 font-medium text-zinc-300"}>
                  {aiDevStatus?.ai_enabled ? "Active & Ready" : "Disabled"}
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveGeminiKey} className="space-y-3">
              <div>
                <label htmlFor="gemini-api-key" className="block text-xs font-medium text-zinc-300 mb-1.5">Gemini API key</label>
                <input
                  id="gemini-api-key"
                  type="password"
                  autoComplete="new-password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder={aiDevStatus?.gemini_configured ? "Key saved; enter a new key to replace it" : "Paste your Gemini API key"}
                  className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3.5 py-2.5 text-xs text-white focus:border-[#10b981] focus-ring"
                />
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-xs text-emerald-400 hover:text-emerald-300 hover:underline">
                  Get a Gemini API key in Google AI Studio
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <button type="submit" disabled={geminiSaving || !geminiApiKey.trim()} className="min-h-[38px] px-4 py-2 rounded-xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold text-zinc-950 transition-colors focus-ring cursor-pointer">
                  {geminiSaving ? "Saving…" : aiDevStatus?.gemini_configured ? "Replace Gemini key" : "Save Gemini key"}
                </button>
                <button
                  type="button"
                  onClick={handleDeveloperModeToggle}
                  disabled={developerModeSaving || (!aiDevStatus?.developer_mode && !aiDevStatus?.gemini_configured)}
                  className={`min-h-[38px] px-4 py-2 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-ring cursor-pointer ${aiDevStatus?.developer_mode ? "border-zinc-700 bg-[#18181c] hover:bg-[#202026] text-zinc-200" : "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"}`}
                >
                  {developerModeSaving ? "Updating…" : aiDevStatus?.developer_mode ? "Disable Developer Mode" : "Enable Developer Mode"}
                </button>
              </div>
            </form>

            {aiSettingsError && <p role="alert" className="text-xs text-red-400">{aiSettingsError}</p>}
            {!aiSettingsError && !aiDevStatus?.ai_enabled && !plan?.hookCredits && <p className="text-xs text-amber-300/90">{aiDevStatus?.reason || "Checking Gemini status..."}</p>}
            {plan?.hookCredits && !aiDevStatus?.ai_enabled && (
              <p className="text-xs text-emerald-300">
                {plan.hookCredits.availableNow ?? plan.hookCredits.remaining} included Hook Finder credits available now.{" "}
                {(plan.hookCredits.availableNow ?? plan.hookCredits.remaining) < plan.hookCredits.remaining &&
                  `Your balance is ${plan.hookCredits.remaining}. You can use your own Gemini key or Fast Interval while the spending limit is in effect.`}
              </p>
            )}
            {aiDevStatus?.ai_enabled && <p className="text-xs text-emerald-300">Hook Finder uses your Gemini key. Turn off Developer Mode to use included credits when available.</p>}
          </section>

          {/* YouTube Integration Section */}
          <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="size-6 rounded-md bg-[#FF0000]/15 flex items-center justify-center text-[#FF0000] border border-[#FF0000]/30">
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                </div>
                <h2 className="text-base font-semibold text-[#f4f4f5]">YouTube Integration</h2>
              </div>

              {ytStatus?.authenticated ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
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
                    <p className="text-xs text-zinc-400">{ytStatus.channel?.handle || ytStatus.channel?.id}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setConfirmDisconnectYtOpen(true)}
                  className="px-3 py-1.5 rounded-xl border border-zinc-700 bg-[#18181c] hover:bg-[#202026] text-xs text-zinc-300 hover:text-white transition-colors focus-ring cursor-pointer"
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
                    className="min-h-[38px] px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-bold transition-colors inline-flex items-center gap-2 focus-ring cursor-pointer"
                  >
                    <span>{ytConnecting ? "Waiting for sign in…" : "Sign in with Google"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setYtStatus((prev) => prev ? { ...prev, configured: false } : null)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 underline cursor-pointer"
                  >
                    Edit Credentials
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveYtConfig} className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Google OAuth Client ID
                  </label>
                  <input
                    type="text"
                    value={ytClientId}
                    onChange={(e) => setYtClientId(e.target.value)}
                    placeholder="xxxx.apps.googleusercontent.com"
                    className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3.5 py-2.5 text-xs text-white focus:border-[#10b981] focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Google OAuth Client Secret
                  </label>
                  <input
                    type="password"
                    value={ytClientSecret}
                    onChange={(e) => setYtClientSecret(e.target.value)}
                    placeholder="GOCSPX-xxxx"
                    className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3.5 py-2.5 text-xs text-white focus:border-[#10b981] focus-ring"
                  />
                </div>
                {ytError && <p className="text-xs text-red-400">{ytError}</p>}
                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={ytSaving}
                    className="min-h-[38px] px-4 py-2 rounded-xl bg-[#10b981] hover:bg-[#059669] text-xs font-bold text-zinc-950 transition-colors focus-ring cursor-pointer"
                  >
                    {ytSaving ? "Saving…" : "Save Credentials"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>

        <CaptionStylePicker
          isOpen={isCaptionPickerOpen}
          onClose={() => setIsCaptionPickerOpen(false)}
          selectedStyle={(defaultCaptionStyle as CaptionStyle) || "classic"}
          onSelect={(style) => {
            if (!isCaptionStyleAllowed(style)) {
              openUpgradeModal("Pro Subtitle Styles");
              return;
            }
            updateSetting("defaultCaptionStyle", style);
          }}
        />

        <ConfirmDialog
          open={confirmDisconnectYtOpen}
          title="Disconnect YouTube channel?"
          description="Remove the connected YouTube OAuth session from this device? You can sign in again at any time."
          confirmLabel="Disconnect"
          variant="danger"
          onConfirm={() => void executeDisconnectYt()}
          onCancel={() => setConfirmDisconnectYtOpen(false)}
        />
      </div>
    </main>
  );
}
