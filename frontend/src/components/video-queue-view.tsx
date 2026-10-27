"use client";

import React, { useState } from "react";
import Link from "next/link";
import { QueueItem, useVideoQueue } from "@/src/lib/queue-context";
import { Badge } from "@/src/components/ui/badge";
import { IconButton } from "@/src/components/ui/icon-button";

interface VideoQueueViewProps {
  onAddAnotherVideo?: () => void;
  className?: string;
}

export function VideoQueueView({ onAddAnotherVideo, className = "" }: VideoQueueViewProps) {
  const {
    queue,
    queueCount,
    maxQueueSize,
    isAtLimit,
    removeFromQueue,
    cancelRunningItem,
    renameQueueItem,
    clearCompletedItems,
  } = useVideoQueue();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  if (queue.length === 0) return null;

  const handleStartRename = (item: QueueItem) => {
    setEditingId(item.id);
    setEditingName(item.projectName);
  };

  const handleSaveRename = (id: string) => {
    if (editingName.trim()) {
      void renameQueueItem(id, editingName.trim());
    }
    setEditingId(null);
  };

  const hasFinishedItems = queue.some((item) => ["done", "failed"].includes(item.status));

  return (
    <section
      aria-label="Video processing queue"
      className={`rounded-2xl border border-zinc-800 bg-[#121215] p-5 shadow-sm space-y-4 animate-fade-in ${className}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[#10b981]">
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white">Video Queue</h2>
              <Badge variant={isAtLimit ? "amber" : "emerald"} size="sm">
                {queueCount}/{maxQueueSize}
              </Badge>
            </div>
            <p className="text-xs text-zinc-400">
              Videos process sequentially one by one in the order added
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasFinishedItems && (
            <button
              type="button"
              onClick={clearCompletedItems}
              className="px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              Clear finished
            </button>
          )}

          {/* Add another video CTA */}
          {onAddAnotherVideo && (
            <div className="relative group">
              <button
                type="button"
                onClick={onAddAnotherVideo}
                disabled={isAtLimit}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all focus-ring flex items-center gap-1.5 ${
                  isAtLimit
                    ? "bg-zinc-800/60 text-zinc-500 border border-zinc-800 cursor-not-allowed"
                    : "bg-[#10b981] text-zinc-950 hover:bg-[#059669] shadow-sm cursor-pointer"
                }`}
              >
                <span>+</span>
                <span>Add another video</span>
              </button>

              {isAtLimit && (
                <div className="absolute right-0 top-full mt-1.5 hidden group-hover:block z-30 w-56 rounded-lg border border-amber-500/30 bg-zinc-900 p-2 text-[11px] text-amber-300 shadow-xl">
                  Queue limit reached (10/10). Wait for existing videos to complete before adding more.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Queue items list */}
      <div className="space-y-2.5 pt-1">
        {queue.map((item, index) => {
          const isProcessing = item.status === "processing";
          const isQueued = item.status === "queued";
          const isDone = item.status === "done";
          const isFailed = item.status === "failed";
          const isEditing = editingId === item.id;

          return (
            <div
              key={item.id}
              className={`rounded-xl border p-3.5 transition-all duration-150 ${
                isProcessing
                  ? "border-emerald-500/30 bg-emerald-950/10 shadow-sm"
                  : isFailed
                  ? "border-red-500/30 bg-red-950/10"
                  : isDone
                  ? "border-zinc-800 bg-[#0e0e11]"
                  : "border-zinc-800/80 bg-[#0c0c0e]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                {/* Project Info & Editable Name */}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5 min-w-0 flex-1 max-w-sm">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveRename(item.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                          maxLength={60}
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveRename(item.id)}
                          className="p-1 rounded text-emerald-400 hover:text-emerald-300 transition-colors"
                          title="Save name"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
                          title="Cancel"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <h3 className="text-xs font-semibold text-white truncate" title={item.projectName}>
                          {item.projectName}
                        </h3>
                        <button
                          type="button"
                          onClick={() => handleStartRename(item)}
                          className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
                          title="Rename project"
                        >
                          <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Metadata subtitle */}
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <span>
                      {item.source.kind === "youtube"
                        ? "YouTube Import"
                        : `${item.source.name}`}
                    </span>
                    <span>•</span>
                    <span>{item.settings.clipDurationSeconds}s clips</span>
                    <span>•</span>
                    <span>{item.settings.clipCount} {item.settings.clipCount === 1 ? "clip" : "clips"}</span>
                    {item.projectId && (
                      <>
                        <span>•</span>
                        <span className="font-mono text-zinc-500">{item.projectId}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Status & Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {isProcessing && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-xs font-medium text-emerald-400">
                      <span className="size-1.5 rounded-full bg-[#10b981] animate-pulse" />
                      <span>{item.progress}%</span>
                    </span>
                  )}

                  {isQueued && (
                    <Badge variant="neutral" size="sm">
                      Queued (#{index + 1})
                    </Badge>
                  )}

                  {isDone && (
                    <Badge variant="emerald" size="sm">
                      ✓ Ready
                    </Badge>
                  )}

                  {isFailed && (
                    <Badge variant="danger" size="sm">
                      Failed
                    </Badge>
                  )}

                  {/* Action buttons */}
                  {isQueued && (
                    <IconButton
                      label="Remove from queue"
                      tooltip="Remove from queue"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFromQueue(item.id)}
                      icon={
                        <svg className="size-3.5 text-zinc-400 hover:text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      }
                    />
                  )}

                  {isProcessing && (
                    <button
                      type="button"
                      onClick={() => void cancelRunningItem(item.id)}
                      className="px-2 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-[11px] font-medium text-red-300 hover:bg-red-500/20 transition-colors"
                    >
                      Cancel
                    </button>
                  )}

                  {isDone && item.projectId && (
                    <Link
                      href={`/clips?project=${encodeURIComponent(item.projectId)}`}
                      className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-emerald-400 transition-colors"
                    >
                      View Clips &rarr;
                    </Link>
                  )}
                </div>
              </div>

              {/* Progress bar and step details for processing items */}
              {isProcessing && (
                <div className="mt-2.5 space-y-1.5 pt-1 border-t border-zinc-800/60">
                  <div
                    role="progressbar"
                    aria-label="Queue item progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={item.progress}
                    className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"
                  >
                    <div
                      className="h-full rounded-full bg-[#10b981] transition-[width] duration-300 ease-out"
                      style={{ width: `${Math.max(4, item.progress)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="truncate">{item.step}</span>
                    <span className="font-mono text-emerald-400/90 shrink-0">{item.progress}%</span>
                  </div>
                </div>
              )}

              {/* Error snippet if failed */}
              {isFailed && item.error && (
                <div className="mt-2 text-[11px] text-red-300 bg-black/40 p-2 rounded border border-red-500/20 break-words">
                  {item.error}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
