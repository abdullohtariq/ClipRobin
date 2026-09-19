"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [directory, setDirectory] = useState("data/projects");
  const [openClips, setOpenClips] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(true);

  return (
    <main className="min-h-screen p-10">
      <h2 className="text-3xl font-semibold">Settings</h2>
      <p className="mt-2 text-zinc-400">Local defaults for Clip Robin.</p>

      <section className="mt-8 max-w-2xl space-y-6">
        <div>
          <h3 className="text-lg font-medium">General</h3>
          <label className="mt-3 block text-sm text-zinc-400">Default project directory</label>
          <input
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3"
          />
          <label className="mt-4 flex items-center gap-3 text-sm text-zinc-300">
            <input type="checkbox" checked={openClips} onChange={(event) => setOpenClips(event.target.checked)} />
            Automatically open generated clips
          </label>
          <label className="mt-3 flex items-center gap-3 text-sm text-zinc-300">
            <input type="checkbox" checked={confirmDelete} onChange={(event) => setConfirmDelete(event.target.checked)} />
            Confirm before deleting projects
          </label>
        </div>

        <div>
          <h3 className="text-lg font-medium">Video</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-zinc-400">Output format<select className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"><option>MP4</option></select></label>
            <label className="text-sm text-zinc-400">Aspect ratio<select className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"><option>Original</option><option>9:16</option><option>16:9</option></select></label>
            <label className="text-sm text-zinc-400">Quality<select className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"><option>Original</option><option>High</option><option>Standard</option></select></label>
          </div>
        </div>
      </section>
    </main>
  );
}
