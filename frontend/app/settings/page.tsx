"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [directory, setDirectory] = useState("data/projects");
  const [openClips, setOpenClips] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(true);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white p-6 lg:p-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Settings</h1>
          <p className="mt-1.5 text-sm text-zinc-400">Local defaults for Clip Robin.</p>
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
                onChange={(event) => setDirectory(event.target.value)}
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
                  onClick={() => setOpenClips((prev) => !prev)}
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
                  onClick={() => setConfirmDelete((prev) => !prev)}
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
                <select id="settings-format-select" className="w-full rounded-[10px] border border-[#232326] bg-[#0a0a0a] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]">
                  <option>MP4</option>
                </select>
              </div>
              <div>
                <label htmlFor="settings-aspect-select" className="block text-xs font-medium text-zinc-400 mb-1.5">Aspect ratio</label>
                <select id="settings-aspect-select" className="w-full rounded-[10px] border border-[#232326] bg-[#0a0a0a] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]">
                  <option>9:16 (Vertical)</option>
                  <option>Original</option>
                  <option>16:9 (Horizontal)</option>
                </select>
              </div>
              <div>
                <label htmlFor="settings-quality-select" className="block text-xs font-medium text-zinc-400 mb-1.5">Quality</label>
                <select id="settings-quality-select" className="w-full rounded-[10px] border border-[#232326] bg-[#0a0a0a] px-3 py-2 text-xs text-white focus:border-[#10b981] focus:outline-none focus:ring-2 focus:ring-[#10b981]">
                  <option>High</option>
                  <option>Original</option>
                  <option>Standard</option>
                </select>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
