"use client";

import { useEffect, useState } from "react";

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
        </div>
      </div>
    </main>
  );
}
