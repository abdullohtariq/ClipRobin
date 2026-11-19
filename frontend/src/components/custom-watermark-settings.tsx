"use client";

import React, { useEffect, useState, useRef } from "react";
import {
  getWatermarkStatus,
  uploadCustomWatermark,
  deleteCustomWatermark,
  updateWatermarkSettings,
  resolveWatermarkImageUrl,
  WatermarkPosition,
  WatermarkStatus,
} from "@/src/lib/api";
import { useSubscription } from "@/src/lib/subscription-context";
import { ConfirmDialog } from "./ui/confirm-dialog";

export interface CustomWatermarkSettingsProps {
  onSettingsChange?: () => void;
}

const VALID_POSITIONS: WatermarkPosition[] = [
  "top_right",
  "top_left",
  "bottom_right",
  "bottom_left",
];

export function CustomWatermarkSettings({ onSettingsChange }: CustomWatermarkSettingsProps) {
  const { isPro, openUpgradeModal } = useSubscription();
  const [status, setStatus] = useState<WatermarkStatus | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<WatermarkPosition>("top_right");
  const [opacity, setOpacity] = useState(100);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const opacitySyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const res = await getWatermarkStatus();
      setStatus(res);
      const resolvedUrl = await resolveWatermarkImageUrl(res.custom_url);
      setImageUrl(resolvedUrl);
      if (res.position && VALID_POSITIONS.includes(res.position)) {
        setPosition(res.position);
        try {
          localStorage.setItem("cliprobin_watermark_position", res.position);
        } catch {}
      }
      if (typeof res.opacity === "number" && res.opacity >= 20 && res.opacity <= 100) {
        setOpacity(res.opacity);
        try {
          localStorage.setItem("cliprobin_watermark_opacity", String(res.opacity));
        } catch {}
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    try {
      const savedPos = localStorage.getItem("cliprobin_watermark_position") as WatermarkPosition | null;
      if (savedPos && VALID_POSITIONS.includes(savedPos)) {
        setPosition(savedPos);
      }
      const savedOp = localStorage.getItem("cliprobin_watermark_opacity");
      if (savedOp) {
        const parsedOp = Number(savedOp);
        if (Number.isFinite(parsedOp) && parsedOp >= 20 && parsedOp <= 100) {
          setOpacity(parsedOp);
        }
      }
    } catch {}
    void loadStatus();
    return () => {
      if (opacitySyncTimerRef.current) {
        clearTimeout(opacitySyncTimerRef.current);
      }
    };
  }, []);

  const persistSettingsToBackend = (nextPos: WatermarkPosition, nextOp: number) => {
    void updateWatermarkSettings(nextPos, nextOp).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to save watermark settings");
    });
  };

  const handlePositionChange = (newPos: WatermarkPosition) => {
    setPosition(newPos);
    setError(null);
    try {
      localStorage.setItem("cliprobin_watermark_position", newPos);
    } catch {}
    persistSettingsToBackend(newPos, opacity);
    onSettingsChange?.();
  };

  const handleOpacityChange = (newOp: number) => {
    const clamped = Math.max(20, Math.min(100, Math.round(newOp)));
    setOpacity(clamped);
    setError(null);
    try {
      localStorage.setItem("cliprobin_watermark_opacity", String(clamped));
    } catch {}
    if (opacitySyncTimerRef.current) {
      clearTimeout(opacitySyncTimerRef.current);
    }
    opacitySyncTimerRef.current = setTimeout(() => {
      persistSettingsToBackend(position, clamped);
    }, 250);
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

  const executeDelete = async () => {
    setConfirmResetOpen(false);
    try {
      setLoading(true);
      setError(null);
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
      <div className="p-4 rounded-xl border border-zinc-800 bg-[#0c0c0e] space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#f4f4f5]">Custom Brand Watermark</span>
            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-xs font-semibold border border-amber-500/30">
              Pro
            </span>
          </div>
          <button
            type="button"
            onClick={() => openUpgradeModal("Custom Brand Watermarks")}
            className="px-3 py-1.5 rounded-xl bg-[#10b981] hover:bg-[#059669] text-zinc-950 font-bold text-xs transition-colors focus-ring cursor-pointer"
          >
            Upgrade to unlock
          </button>
        </div>
        <p className="text-xs text-zinc-400">
          Upload your own PNG, JPG, or WebP transparent logo to replace the Clip Robin watermark on exported clips.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 rounded-xl border border-zinc-800 bg-[#0c0c0e]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white">Custom Brand Watermark</span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-xs font-semibold border border-emerald-500/30">
            Active
          </span>
        </div>
      </div>

      {/* Uploaded image status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-zinc-800 bg-[#121215]">
        <div className="flex items-center gap-3">
          {status?.has_custom_watermark && imageUrl ? (
            <div className="size-12 rounded-lg bg-zinc-950 border border-emerald-500/30 p-1 flex items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
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
            <p className="text-xs text-zinc-400">
              {status?.has_custom_watermark
                ? "Active on newly generated clips"
                : "Upload a transparent PNG, JPG, or WebP logo"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelected}
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded-xl border border-zinc-700 bg-[#18181c] hover:bg-[#202026] text-xs font-semibold text-zinc-200 transition-colors focus-ring cursor-pointer"
          >
            {uploading ? "Uploading…" : status?.has_custom_watermark ? "Replace Logo" : "Upload Logo"}
          </button>

          {status?.has_custom_watermark && (
            <button
              type="button"
              disabled={loading}
              onClick={() => setConfirmResetOpen(true)}
              className="px-2.5 py-1.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold transition-colors focus-ring cursor-pointer"
              title="Reset to default branding"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Position and Opacity Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
            Logo Position
          </label>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {(
              [
                { id: "top_right", label: "Top Right" },
                { id: "top_left", label: "Top Left" },
                { id: "bottom_right", label: "Bottom Right" },
                { id: "bottom_left", label: "Bottom Left" },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handlePositionChange(p.id)}
                className={`px-2.5 py-1.5 rounded-lg border text-left truncate transition-colors focus-ring cursor-pointer ${
                  position === p.id
                    ? "border-[#10b981] bg-[#10b981]/15 text-emerald-300 font-semibold"
                    : "border-zinc-800 bg-[#121215] text-zinc-400 hover:text-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-semibold text-zinc-300">
              Logo Opacity
            </label>
            <span className="text-xs font-mono text-zinc-400">{opacity}%</span>
          </div>
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={opacity}
            onChange={(e) => handleOpacityChange(Number(e.target.value))}
            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#10b981]"
          />
          <div className="flex justify-between text-xs text-zinc-500 mt-1 font-mono">
            <span>20%</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmResetOpen}
        title="Remove custom watermark?"
        description="Remove your custom brand logo and restore the default Clip Robin watermark?"
        confirmLabel="Remove logo"
        variant="danger"
        onConfirm={() => void executeDelete()}
        onCancel={() => setConfirmResetOpen(false)}
      />
    </div>
  );
}
