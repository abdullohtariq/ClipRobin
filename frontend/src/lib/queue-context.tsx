"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  cancelClipGeneration,
  downloadVideo,
  generateClips,
  getActiveJobs,
  getClips,
  getLatestClipGenerationJob,
  getLocalTranscriptionJob,
  transcribeLocalVideo,
  transcribeVideo,
  updateProjectTitle,
  Clip,
  FramingMode,
  CaptionStyle,
  CaptionAnimation,
  RequestCancelledError,
  TrackingMode,
} from "@/src/lib/api";
import { ClipDuration } from "@/src/components/clip-settings";
import { sanitizeProjectName } from "@/src/lib/project-name-utils";

export type QueueSource =
  | { kind: "file"; file?: File; name: string; size: number }
  | { kind: "youtube"; url: string; videoLabel?: string };

export interface QueueSettings {
  framingMode: FramingMode;
  clipDurationSeconds: ClipDuration;
  clipCount: number;
  generationMode: "random" | "ai";
  captionStyle: CaptionStyle;
  captionAnimation?: CaptionAnimation | null;
  showCaptions: boolean;
  showWatermark: boolean;
  faceTracking?: boolean;
  trackingMode?: TrackingMode;
  cropAnchorX?: number;
}

export interface QueueItem {
  id: string;
  projectName: string;
  source: QueueSource;
  settings: QueueSettings;
  status: "queued" | "processing" | "done" | "failed" | "cancelled";
  progress: number;
  step: string;
  projectId?: string;
  generationJobId?: string;
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
  retryQueueItem: (id: string) => { success: boolean; error?: string };
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
  const lastPersistedSnapshotRef = useRef<string>("");
  const activeRunStateRef = useRef<{
    itemId: string;
    abortController: AbortController;
    getProjectId: () => string | null;
    getGenerationJobId: () => string | null;
    markCancelled: () => void;
  } | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updateItem = useCallback(
    (id: string, updater: Partial<QueueItem> | ((prev: QueueItem) => Partial<QueueItem>)) => {
      setQueue((prevQueue) =>
        prevQueue.map((item) => {
          if (item.id !== id) return item;
          const updates = typeof updater === "function" ? updater(item) : updater;
          return { ...item, ...updates };
        })
      );
    },
    []
  );

  // Restore persisted queue state and reconcile active backend jobs on client hydration
  useEffect(() => {
    let restoredItems: QueueItem[] = [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        lastPersistedSnapshotRef.current = stored;
        const parsed = JSON.parse(stored) as QueueItem[];
        restoredItems = parsed.map((item) => {
          if (item.status === "queued" && item.source.kind === "file" && !item.projectId) {
            return {
              ...item,
              status: "failed" as const,
              step: "Interrupted by reload",
              error: "Page reloaded before local upload started. Re-select the video file to retry.",
            };
          }
          return item;
        });
        setQueue((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          const merged = restoredItems.filter((item) => !existingIds.has(item.id));
          return [...prev, ...merged];
        });
      }
    } catch {
      // Ignore localStorage errors
    } finally {
      setHasHydrated(true);
    }

    // Reconcile items that were processing when the window reloaded
    void (async () => {
      const processingItems = restoredItems.filter((item) => item.status === "processing");
      if (processingItems.length === 0) return;

      const activeBackendJobs = await getActiveJobs().catch(() => []);
      const activeByProject = new Map(activeBackendJobs.map((j) => [j.project_id, j]));

      for (const item of processingItems) {
        if (!isMountedRef.current) return;
        const pid = item.projectId;
        if (!pid) {
          updateItem(item.id, {
            status: "failed",
            step: "Interrupted before project creation",
            error: "Processing was interrupted before the project was created. Retry to restart.",
          });
          continue;
        }

        const liveJob = activeByProject.get(pid);
        if (liveJob) {
          // Track live backend job cleanly until completion
          let polling = true;
          while (polling && isMountedRef.current) {
            await new Promise((r) => setTimeout(r, 900));
            const latestActive = await getActiveJobs().catch(() => []);
            const current = latestActive.find((j) => j.project_id === pid);
            if (current) {
              updateItem(item.id, {
                progress: current.kind === "generation"
                  ? 60 + Math.round((current.progress || 0) * 0.38)
                  : Math.max(10, Math.round((current.progress || 0) * 0.58)),
                step: current.step || item.step,
                readyClips: current.ready_clips ?? item.readyClips,
                generationJobId: current.kind === "generation" ? current.id : item.generationJobId,
              });
            } else {
              polling = false;
            }
          }
        }

        if (!isMountedRef.current) return;
        const genJob = await getLatestClipGenerationJob(pid).catch(() => null);
        if (genJob?.status === "completed") {
          const clipsData = await getClips(pid).catch(() => ({ clips: genJob.clips ?? [] }));
          updateItem(item.id, {
            status: "done",
            progress: 100,
            step: "Complete",
            readyClips: clipsData.clips,
          });
        } else if (genJob?.status === "cancelled") {
          updateItem(item.id, {
            status: "cancelled",
            step: "Cancelled",
            error: undefined,
          });
        } else if (genJob?.status === "failed") {
          updateItem(item.id, {
            status: "failed",
            step: "Failed",
            error: genJob.error || "Clip generation failed.",
          });
        } else {
          const clipsData = await getClips(pid).catch(() => null);
          if (clipsData && clipsData.clips.length > 0) {
            updateItem(item.id, {
              status: "done",
              progress: 100,
              step: "Complete",
              readyClips: clipsData.clips,
            });
          } else {
            updateItem(item.id, {
              status: "failed",
              step: "Interrupted by reload",
              error: "Background session ended before clips completed. Click Retry to resume.",
            });
          }
        }
      }
    })();
  }, [updateItem]);

  // Sync queue items to localStorage (omitting non-serializable File handles)
  useEffect(() => {
    if (!hasHydrated) return;
    try {
      const persistable = queue.map((item) => {
        if (item.source.kind === "file") {
          return {
            ...item,
            source: {
              kind: "file" as const,
              name: item.source.name,
              size: item.source.size,
            },
          };
        }
        return item;
      });
      const serialized = JSON.stringify(persistable.slice(-20));
      if (serialized !== lastPersistedSnapshotRef.current) {
        lastPersistedSnapshotRef.current = serialized;
        localStorage.setItem(STORAGE_KEY, serialized);
      }
    } catch {
      // Ignore quota errors
    }
  }, [queue, hasHydrated]);

  // Process a single queue item from start to finish
  const processQueueItem = useCallback(
    async (item: QueueItem) => {
      const { id, source, settings, projectName } = item;
      let assignedProjectId: string | null = null;
      let activeGenerationJobId: string | null = null;
      let isCancelled = false;
      const abortController = new AbortController();

      activeRunStateRef.current = {
        itemId: id,
        abortController,
        getProjectId: () => assignedProjectId,
        getGenerationJobId: () => activeGenerationJobId,
        markCancelled: () => {
          isCancelled = true;
          abortController.abort();
        },
      };

      try {
        updateItem(id, {
          status: "processing",
          progress: 5,
          step: source.kind === "youtube" ? "Downloading from YouTube..." : "Uploading video...",
          error: undefined,
        });

        // If retrying a project whose transcript is already ready, skip re-intake cleanly
        let resumeToClips = false;
        if (item.projectId) {
          const prevTransJob = await getLocalTranscriptionJob(item.projectId, abortController.signal).catch(() => null);
          if (prevTransJob?.status === "completed") {
            assignedProjectId = item.projectId;
            resumeToClips = true;
          }
        }

        // Step A: Source Acquisition
        if (!resumeToClips && source.kind === "youtube") {
          const downloadRes = await downloadVideo(
            source.url,
            (job) => {
              if (isCancelled) return;
              updateItem(id, {
                progress: Math.min(25, 5 + Math.round(job.progress * 0.2)),
                step: job.step || "Downloading video...",
              });
            },
            {
              signal: abortController.signal,
              onProjectCreated: (pid) => {
                assignedProjectId = pid;
                updateItem(id, { projectId: pid });
              },
            }
          );

          if (isCancelled) throw new RequestCancelledError("Cancelled by user");
          assignedProjectId = downloadRes.project_id;
          updateItem(id, { projectId: assignedProjectId });

          // Save custom project title if customized
          const latestName = queueRef.current.find((q) => q.id === id)?.projectName || projectName;
          if (latestName && assignedProjectId) {
            await updateProjectTitle(assignedProjectId, latestName).catch(() => {});
          }

          // Step B: Transcription
          updateItem(id, {
            progress: 28,
            step: "Starting speech transcription...",
          });

          const transcriptionJob = await transcribeVideo(assignedProjectId, abortController.signal);
          let currentJob = transcriptionJob;

          while (
            currentJob.status !== "completed" &&
            currentJob.status !== "failed" &&
            currentJob.status !== "cancelled"
          ) {
            if (isCancelled) throw new RequestCancelledError("Cancelled by user");
            await new Promise((res) => setTimeout(res, 600));
            if (isCancelled) throw new RequestCancelledError("Cancelled by user");
            currentJob = await getLocalTranscriptionJob(assignedProjectId, abortController.signal);
            updateItem(id, {
              progress: 28 + Math.round((currentJob.progress || 0) * 0.32),
              step: currentJob.step || "Transcribing audio...",
            });
          }

          if (currentJob.status === "cancelled" || isCancelled) {
            throw new RequestCancelledError("Cancelled by user");
          }
          if (currentJob.status === "failed") {
            throw new Error(currentJob.error || "Speech transcription failed");
          }
        } else if (!resumeToClips && source.kind === "file") {
          if (!source.file) {
            throw new Error("Local file handle cleared after reload. Please re-select the video file.");
          }
          const uploadRes = await transcribeLocalVideo(
            source.file,
            (uploadProg) => {
              if (isCancelled) return;
              updateItem(id, {
                progress: Math.min(25, Math.round(uploadProg * 0.25)),
                step: "Uploading video...",
              });
            },
            abortController.signal
          );

          if (isCancelled) throw new RequestCancelledError("Cancelled by user");
          assignedProjectId = uploadRes.project_id;
          updateItem(id, { projectId: assignedProjectId });

          // Save custom project title
          const latestName = queueRef.current.find((q) => q.id === id)?.projectName || projectName;
          if (latestName && assignedProjectId) {
            await updateProjectTitle(assignedProjectId, latestName).catch(() => {});
          }

          let currentJob = uploadRes;
          while (
            currentJob.status !== "completed" &&
            currentJob.status !== "failed" &&
            currentJob.status !== "cancelled"
          ) {
            if (isCancelled) throw new RequestCancelledError("Cancelled by user");
            await new Promise((res) => setTimeout(res, 600));
            if (isCancelled) throw new RequestCancelledError("Cancelled by user");
            currentJob = await getLocalTranscriptionJob(assignedProjectId, abortController.signal);
            updateItem(id, {
              progress: 25 + Math.round((currentJob.progress || 0) * 0.35),
              step: currentJob.step || "Transcribing audio...",
            });
          }

          if (currentJob.status === "cancelled" || isCancelled) {
            throw new RequestCancelledError("Cancelled by user");
          }
          if (currentJob.status === "failed") {
            throw new Error(currentJob.error || "Speech transcription failed");
          }
        }

        if (isCancelled || !assignedProjectId) throw new RequestCancelledError("Cancelled by user");

        // Step C: Clip Generation
        updateItem(id, {
          progress: 60,
          step: "Generating vertical clips...",
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
          settings.captionAnimation || undefined,
          settings.clipCount,
          settings.generationMode,
          settings.faceTracking,
          {
            signal: abortController.signal,
            trackingMode: settings.trackingMode,
            cropAnchorX: settings.cropAnchorX,
            onJobCreated: (jid) => {
              activeGenerationJobId = jid;
              updateItem(id, { generationJobId: jid });
            },
          }
        );

        if (isCancelled || generation.cancelled) {
          isCancelled = true;
          throw new RequestCancelledError("Cancelled by user");
        }

        // Finished Successfully
        updateItem(id, {
          status: "done",
          progress: 100,
          step: "Complete",
          readyClips: generation.clips,
          error: undefined,
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("cliprobin:queue-item-completed", {
              detail: { projectId: assignedProjectId, itemId: id },
            })
          );
        }
      } catch (err) {
        const cancelledErr =
          isCancelled ||
          err instanceof RequestCancelledError ||
          (err instanceof DOMException && err.name === "AbortError");
        if (cancelledErr) {
          updateItem(id, {
            status: "cancelled",
            step: "Cancelled",
            error: undefined,
          });
        } else {
          const errorMsg = err instanceof Error ? err.message : "Processing failed";
          updateItem(id, {
            status: "failed",
            step: "Failed",
            error: errorMsg,
          });
        }
      } finally {
        if (activeRunStateRef.current?.itemId === id) {
          activeRunStateRef.current = null;
        }
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
      const next = prev.filter((item) => item.id !== id || item.status === "processing");
      queueRef.current = next;
      return next;
    });
  }, []);

  const cancelRunningItem = useCallback(
    async (id: string) => {
      const item = queueRef.current.find((q) => q.id === id);
      if (item && item.status === "processing") {
        const runState =
          activeRunStateRef.current?.itemId === id ? activeRunStateRef.current : null;
        const pid = runState?.getProjectId() || item.projectId || null;
        const jobId = runState?.getGenerationJobId() || item.generationJobId || null;

        runState?.markCancelled();

        updateItem(id, {
          status: "cancelled",
          step: "Cancelled",
          error: undefined,
        });

        // Cancel active backend generation without deleting saved projects or committed clips
        if (pid && jobId) {
          await cancelClipGeneration(pid, jobId).catch(() => {});
        }
      }
    },
    [updateItem]
  );

  const retryQueueItem = useCallback(
    (id: string): { success: boolean; error?: string } => {
      const item = queueRef.current.find((q) => q.id === id);
      if (!item || !["failed", "cancelled"].includes(item.status)) {
        return { success: false, error: "Only failed or cancelled items can be retried." };
      }
      if (item.source.kind === "file" && !item.source.file && !item.projectId) {
        const msg = "Local file handle was cleared when the page reloaded. Please re-select the video file.";
        updateItem(id, { error: msg });
        return { success: false, error: msg };
      }
      updateItem(id, {
        status: "queued",
        progress: 0,
        step: "Waiting in queue...",
        error: undefined,
      });
      setTimeout(() => {
        void kickWorker();
      }, 50);
      return { success: true };
    },
    [kickWorker, updateItem]
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

  const activeCount = useMemo(
    () => queue.filter((item) => ["queued", "processing"].includes(item.status)).length,
    [queue]
  );

  const activeItem = useMemo(
    () => queue.find((item) => item.status === "processing") || null,
    [queue]
  );

  const contextValue = useMemo<QueueContextType>(
    () => ({
      queue,
      activeItem,
      queueCount: activeCount,
      maxQueueSize: MAX_QUEUE_SIZE,
      isAtLimit: activeCount >= MAX_QUEUE_SIZE,
      addToQueue,
      removeFromQueue,
      cancelRunningItem,
      retryQueueItem,
      renameQueueItem,
      clearCompletedItems,
    }),
    [
      queue,
      activeItem,
      activeCount,
      addToQueue,
      removeFromQueue,
      cancelRunningItem,
      retryQueueItem,
      renameQueueItem,
      clearCompletedItems,
    ]
  );

  return <QueueContext.Provider value={contextValue}>{children}</QueueContext.Provider>;
}

export function useVideoQueue() {
  const context = useContext(QueueContext);
  if (!context) {
    throw new Error("useVideoQueue must be used within a QueueProvider");
  }
  return context;
}
