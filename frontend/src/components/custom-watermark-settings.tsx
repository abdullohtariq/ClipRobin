"use client";

import React, { useEffect, useState, useRef } from "react";
import { getWatermarkStatus, uploadCustomWatermark, deleteCustomWatermark, WatermarkStatus } from "@/src/lib/api";
import { useSubscription } from "@/src/lib/subscription-context";

export interface CustomWatermarkSettingsProps {
  onSettingsChange?: () => void;
}

export function CustomWatermarkSettings({ onSettingsChange }: CustomWatermarkSettingsProps) {
  const { isPro, openUpgradeModal } = useSubscription();
  const [status, setStatus] = useState<WatermarkStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState("top_right");
  const [opacity, setOpacity] = useState(100);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const res = await getWatermarkStatus();
      setStatus(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    try {
      const savedPos = localStorage.getItem("cliprobin_watermark_position");
      if (savedPos) setPosition(savedPos);
      const savedOp = localStorage.getItem("cliprobin_watermark_opacity");
      if (savedOp) setOpacity(Number(savedOp));
    } catch {}
  }, []);

  const handlePositionChange = (newPos: string) => {
    setPosition(newPos);
    try {
      localStorage.setItem("cliprobin_watermark_position", newPos);
    } catch {}
    onSettingsChange?.();
  };

  const handleOpacityChange = (newOp: number) => {
    setOpacity(newOp);
    try {
      localStorage.setItem("cliprobin_watermark_opacity", String(newOp));
    } catch {}
    onSettingsChange?.();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isPro) {
      openUpgradeModal("Custom Brand Watermarks");
      return;
    }

    try {
      setUploading(true);
      setError(null);
      await uploadCustomWatermark(file);
      await loadStatus();
      onSettingsChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload watermark image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    if (!confirm("Remove custom watermark and restore default branding?")) return;
    try {
      setLoading(true);
      await deleteCustomWatermark();
      await loadStatus();
      onSettingsChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove custom watermark");
    } finally {
      setLoading(false);
    }
  };

  if (!isPro) {
    return (
      <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">🏷️</span>
            <span className="text-xs font-bold text-amber-200">Custom Brand Watermark</span>
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/40">
              PRO
            </span>
          </div>
          <button
            type="button"
            onClick={() => openUpgradeModal("Custom Brand Watermarks")}
            className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors"
          >
            Upgrade to Unlock
          </button>
        </div>
        <p className="text-[11px] text-zinc-400">
          Upload your own PNG/JPG transparent logo to replace the Clip Robin watermark on all your exported clips.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 rounded-xl border border-zinc-800 bg-[#0d0d10]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">🏷️</span>
          <span className="text-xs font-bold text-white">Custom Brand Watermark</span>
          <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/40">
            PRO ACTIVE
          </span>
        </div>
      </div>

      {/* Uploaded image status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40">
        <div className="flex items-center gap-3">
          {status?.has_custom_watermark ? (
            <div className="size-12 rounded-lg bg-zinc-950 border border-emerald-500/30 p-1 flex items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="http://127.0.0.1:8000/api/watermark/image"
                alt="Custom watermark"
                className="max-h-full max-w-full object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            </div>
          ) : (
            <div className="size-12 rounded-lg bg-zinc-950 border border-zinc-800 p-1 flex items-center justify-center text-xs font-mono text-zinc-500">
              Logo
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-white">
              {status?.has_custom_watermark
                ? `Custom Logo: ${status.custom_filename}`
                : "Default Clip Robin Brandmark"}
            </div>
            <p className="text-[11px] text-zinc-400">
              {status?.has_custom_watermark
                ? "Active on newly generated clips"
                : "Upload transparent PNG or SVG logo for your personal brand"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelected}
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors"
          >
            {uploading ? "Uploading..." : status?.has_custom_watermark ? "Replace Logo" : "Upload Logo"}
          </button>

          {status?.has_custom_watermark && (
            <button
              type="button"
              disabled={loading}
              onClick={handleDelete}
              className="px-2.5 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-semibold transition-colors"
              title="Reset to default branding"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {/* Position and Opacity Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <div>
          <label className="block text-[11px] font-semibold text-zinc-300 mb-1.5">
            Logo Position
          </label>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {[
              { id: "top_right", label: "Top Right (Recommended)" },
              { id: "top_left", label: "Top Left" },
              { id: "bottom_right", label: "Bottom Right" },
              { id: "bottom_left", label: "Bottom Left" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handlePositionChange(p.id)}
                className={`px-2.5 py-1.5 rounded-lg border text-left truncate transition-colors ${
                  position === p.id
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-300 font-semibold"
                    : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-[11px] font-semibold text-zinc-300">
              Logo Opacity
            </label>
            <span className="text-[11px] font-mono text-zinc-400">{opacity}%</span>
          </div>
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={opacity}
            onChange={(e) => handleOpacityChange(Number(e.target.value))}
            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
          <div className="flex justify-between text-[10px] text-zinc-500 mt-1 font-mono">
            <span>20% (Subtle)</span>
            <span>100% (Solid)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
