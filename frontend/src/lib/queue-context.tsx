"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  downloadVideo,
  generateClips,
  getLocalTranscriptionJob,
  transcribeLocalVideo,
  transcribeVideo,
  updateProjectTitle,
  deleteProject,
  Clip,
  FramingMode,
  CaptionStyle,
} from "@/src/lib/api";
import { ClipDuration } from "@/src/components/clip-settings";
import { sanitizeProjectName } from "@/src/lib/project-name-utils";

export type QueueSource =
  | { kind: "file"; file: File; name: string; size: number }
  | { kind: "youtube"; url: string; videoLabel?: string };

export interface QueueSettings {
  framingMode: FramingMode;
  clipDurationSeconds: ClipDuration;
  clipCount: number;
  generationMode: "random" | "ai";
  captionStyle: CaptionStyle;
  showCaptions: boolean;
  showWatermark: boolean;
}

export interface QueueItem {
  id: string;
  projectName: string;
  source: QueueSource;
  settings: QueueSettings;
  status: "queued" | "processing" | "done" | "failed";
  progress: number;
  step: string;
  projectId?: string;
  readyClips?: Clip[];
  error?: string;
  createdAt: number;
}

interface QueueContextType {
  queue: QueueItem[];
  activeItem: QueueItem | null;
  queueCount: number;
  maxQueueSize: number;
  isAtLimit: boolean;
  addToQueue: (payload: {
    projectName: string;
    source: QueueSource;
    settings: QueueSettings;
  }) => { success: boolean; id?: string; error?: string };
  removeFromQueue: (id: string) => void;
  cancelRunningItem: (id: string) => Promise<void>;
  renameQueueItem: (id: string, newName: string) => Promise<void>;
  clearCompletedItems: () => void;
}

const MAX_QUEUE_SIZE = 10;
const STORAGE_KEY = "cliprobin_video_queue_history";

const QueueContext = createContext<QueueContextType | null>(null);

export function QueueProvider({ children }: { children: React.ReactNode }) {
  // Start with empty queue on SSR and initial client hydration to prevent hydration mismatch
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [hasHydrated, setHasHydrated] = useState(false);

  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const isWorkerRunningRef = useRef(false);
  const isMountedRef = useRef(true);
  const activeAbortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Restore completed/failed items from localStorage only on client after initial hydration
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as QueueItem[];
        setQueue((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          const restored = parsed.filter(
            (item) => ["done", "failed"].includes(item.status) && !existingIds.has(item.id)
          );
          return [...prev, ...restored];
        });
      }
    } catch {
      // Ignore localStorage errors
    } finally {
      setHasHydrated(true);
    }
  }, []);

  // Sync finished items to localStorage (only after initial hydration to prevent wiping)
  useEffect(() => {
    if (!hasHydrated) return;
    try {
      const persistable = queue
        .filter((item) => ["done", "failed"].includes(item.status))
        .map((item) => {
          // If source had a File object, store metadata only
          if (item.source.kind === "file") {
            return {
              ...item,
              source: {
                kind: "file" as const,
                name: item.source.name,
                size: item.source.size,
                // omit actual File object for JSON safety
              },
            };
          }
          return item;
        });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable.slice(-20)));
    } catch {
      // Ignore quota errors
    }
  }, [queue, hasHydrated]);

  const updateItem = useCallback(
    (id: string, updater: Partial<QueueItem> | ((prev: QueueItem) => Partial<QueueItem>)) => {
      setQueue((prevQueue) => {
        const nextQueue = prevQueue.map((item) => {
          if (item.id !== id) return item;
          const updates = typeof updater === "function" ? updater(item) : updater;
          return { ...item, ...updates };
        });
        queueRef.current = nextQueue;
        return nextQueue;
      });
    },
    []
  );

  // Process a single queue item from start to finish
  const processQueueItem = useCallback(
    async (item: QueueItem) => {
      const { id, source, settings, projectName } = item;
      let assignedProjectId: string | null = null;
      let isCancelled = false;

      activeAbortRef.current = () => {
        isCancelled = true;
      };

      try {
        updateItem(id, {
          status: "processing",
          progress: 5,
          step: source.kind === "youtube" ? "Downloading from YouTube..." : "Uploading video...",
        });

        // Step A: Source Acquisition
        if (source.kind === "youtube") {
          const downloadRes = await downloadVideo(source.url, (job) => {
            if (isCancelled) return;
            updateItem(id, {
              progress: Math.min(25, 5 + Math.round(job.progress * 0.2)),
              step: job.step || "Downloading video...",
            });
          });

          if (isCancelled) throw new Error("Processing was cancelled by user");
          assignedProjectId = downloadRes.project_id;
          updateItem(id, { projectId: assignedProjectId });

          // Save custom project title if customized
          if (projectName && assignedProjectId) {
            await updateProjectTitle(assignedProjectId, projectName).catch(() => {});
          }

          // Step B: Transcription
          updateItem(id, {
            progress: 28,
            step: "Starting speech transcription...",
          });

          const transcriptionJob = await transcribeVideo(assignedProjectId);
          let currentJob = transcriptionJob;

          while (currentJob.status !== "completed" && currentJob.status !== "failed") {
            if (isCancelled) throw new Error("Processing was cancelled by user");
            await new Promise((res) => setTimeout(res, 600));
            currentJob = await getLocalTranscriptionJob(assignedProjectId);
            updateItem(id, {
              progress: 28 + Math.round((currentJob.progress || 0) * 0.32),
              step: currentJob.step || "Transcribing audio...",
            });
          }

          if (currentJob.status === "failed") {
            throw new Error(currentJob.error || "Speech transcription failed");
          }
        } else {
          // Local File Source
          const uploadRes = await transcribeLocalVideo(source.file, (uploadProg) => {
            if (isCancelled) return;
            updateItem(id, {
              progress: Math.min(25, Math.round(uploadProg * 0.25)),
              step: "Uploading video...",
            });
          });

          if (isCancelled) throw new Error("Processing was cancelled by user");
          assignedProjectId = uploadRes.project_id;
          updateItem(id, { projectId: assignedProjectId });

          // Save custom project title
          if (projectName && assignedProjectId) {
            await updateProjectTitle(assignedProjectId, projectName).catch(() => {});
          }

          let currentJob = uploadRes;
          while (currentJob.status !== "completed" && currentJob.status !== "failed") {
            if (isCancelled) throw new Error("Processing was cancelled by user");
            await new Promise((res) => setTimeout(res, 600));
            currentJob = await getLocalTranscriptionJob(assignedProjectId);
            updateItem(id, {
              progress: 25 + Math.round((currentJob.progress || 0) * 0.35),
              step: currentJob.step || "Transcribing audio...",
            });
          }

          if (currentJob.status === "failed") {
            throw new Error(currentJob.error || "Speech transcription failed");
          }
        }

        if (isCancelled) throw new Error("Processing was cancelled by user");

        // Step C: Clip Generation
        updateItem(id, {
          progress: 60,
          step: "Generating vertical clips with AI...",
        });

        const generation = await generateClips(
          assignedProjectId,
          settings.showCaptions,
          (stepJob) => {
            if (isCancelled) return;
            updateItem(id, {
              progress: 60 + Math.round((stepJob.progress || 0) * 0.38),
              step: stepJob.step || "Rendering clips...",
              readyClips: stepJob.ready_clips,
            });
          },
          settings.clipDurationSeconds,
          settings.showWatermark,
          settings.framingMode,
          settings.captionStyle,
          undefined,
          settings.clipCount,
          settings.generationMode
        );

        if (isCancelled || generation.cancelled) {
          throw new Error("Clip generation was cancelled by user");
        }

        // Finished Successfully
        updateItem(id, {
          status: "done",
          progress: 100,
          step: "Complete",
          readyClips: generation.clips,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Processing failed";
        updateItem(id, {
          status: "failed",
          step: "Failed",
          error: errorMsg,
        });
      } finally {
        activeAbortRef.current = null;
      }
    },
    [updateItem]
  );

  const processQueueItemRef = useRef(processQueueItem);
  useEffect(() => {
    processQueueItemRef.current = processQueueItem;
  }, [processQueueItem]);

  // FIFO Queue Runner: checks for next queued item and executes sequentially
  const kickWorkerRef = useRef<() => void>(() => {});
  useEffect(() => {
    kickWorkerRef.current = () => {
      if (isWorkerRunningRef.current || !isMountedRef.current) return;

      const nextItem = queueRef.current.find((item) => item.status === "queued");
      if (!nextItem) return;

      isWorkerRunningRef.current = true;
      void (async () => {
        try {
          await processQueueItemRef.current(nextItem);
        } catch (err) {
          console.error("Queue execution error:", err);
        } finally {
          isWorkerRunningRef.current = false;
          if (isMountedRef.current) {
            setTimeout(() => {
              kickWorkerRef.current();
            }, 150);
          }
        }
      })();
    };
  });

  const kickWorker = useCallback(() => {
    kickWorkerRef.current();
  }, []);

  // Monitor queue updates to kick off worker if queued items exist and worker is idle
  useEffect(() => {
    const hasQueuedItems = queue.some((item) => item.status === "queued");
    if (hasQueuedItems && !isWorkerRunningRef.current) {
      kickWorker();
    }
  }, [queue, kickWorker]);

  // Public Actions
  const addToQueue = useCallback(
    ({
      projectName,
      source,
      settings,
    }: {
      projectName: string;
      source: QueueSource;
      settings: QueueSettings;
    }) => {
      const activeCount = queueRef.current.filter((item) =>
        ["queued", "processing"].includes(item.status)
      ).length;

      if (activeCount >= MAX_QUEUE_SIZE) {
        return {
          success: false,
          error: `Queue limit reached (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE}). Please wait for current items to finish.`,
        };
      }

      // Ensure sanitized and deduplicated project name
      const existingNames = queueRef.current.map((item) => item.projectName);
      const cleanName = sanitizeProjectName(projectName, existingNames);

      const newItem: QueueItem = {
        id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        projectName: cleanName,
        source,
        settings,
        status: "queued",
        progress: 0,
        step: "Waiting in queue...",
        createdAt: Date.now(),
      };

      setQueue((prev) => {
        const next = [...prev, newItem];
        queueRef.current = next;
        return next;
      });

      // Kick worker
      setTimeout(() => {
        void kickWorker();
      }, 50);

      return { success: true, id: newItem.id };
    },
    [kickWorker]
  );

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => {
      const next = prev.filter((item) => item.id !== id || item.status !== "queued");
      queueRef.current = next;
      return next;
    });
  }, []);

  const cancelRunningItem = useCallback(
    async (id: string) => {
      const item = queueRef.current.find((q) => q.id === id);
      if (item && item.status === "processing") {
        if (activeAbortRef.current) {
          activeAbortRef.current();
        }
        if (item.projectId) {
          await deleteProject(item.projectId).catch(() => {});
        }
        updateItem(id, {
          status: "failed",
          step: "Cancelled",
          error: "Cancelled by user",
        });
      }
    },
    [updateItem]
  );

  const renameQueueItem = useCallback(
    async (id: string, newName: string) => {
      const item = queueRef.current.find((q) => q.id === id);
      if (!item) return;

      const otherNames = queueRef.current
        .filter((q) => q.id !== id)
        .map((q) => q.projectName);
      const cleanName = sanitizeProjectName(newName, otherNames);

      updateItem(id, { projectName: cleanName });

      if (item.projectId) {
        await updateProjectTitle(item.projectId, cleanName).catch(() => {});
      }
    },
    [updateItem]
  );

  const clearCompletedItems = useCallback(() => {
    setQueue((prev) => {
      const next = prev.filter((item) => ["queued", "processing"].includes(item.status));
      queueRef.current = next;
      return next;
    });
  }, []);

  const activeCount = queue.filter((item) =>
    ["queued", "processing"].includes(item.status)
  ).length;

  const activeItem = queue.find((item) => item.status === "processing") || null;

  return (
    <QueueContext.Provider
      value={{
        queue,
        activeItem,
        queueCount: activeCount,
        maxQueueSize: MAX_QUEUE_SIZE,
        isAtLimit: activeCount >= MAX_QUEUE_SIZE,
        addToQueue,
        removeFromQueue,
        cancelRunningItem,
        renameQueueItem,
        clearCompletedItems,
      }}
    >
      {children}
    </QueueContext.Provider>
  );
}

export function useVideoQueue() {
  const context = useContext(QueueContext);
  if (!context) {
    throw new Error("useVideoQueue must be used within a QueueProvider");
  }
  return context;
}
