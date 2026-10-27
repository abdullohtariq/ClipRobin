import { invoke, isTauri } from "@tauri-apps/api/core";

const WEB_API_URL = "http://127.0.0.1:8000";
let desktopApiUrl: Promise<string> | undefined;

function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== "object" || payload === null || !("detail" in payload)) {
    return fallback;
  }
  const detail = payload.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (typeof item !== "object" || item === null || !("msg" in item)) {
        return [];
      }
      return typeof item.msg === "string" ? [item.msg] : [];
    });
    return messages.length > 0 ? messages.join("; ") : fallback;
  }
  return fallback;
}

async function getApiUrl(): Promise<string> {
  if (!isTauri()) {
    return WEB_API_URL;
  }
  if (!desktopApiUrl) {
    desktopApiUrl = invoke<number>("backend_port")
      .then((port) => `http://127.0.0.1:${port}`)
      .catch((error) => {
        desktopApiUrl = undefined;
        throw error;
      });
  }
  return desktopApiUrl;
}

export type DownloadResponse = {
  project_id: string;
  status: string;
  file: string;
  title?: string;
  duration?: number;
};

export type TranscriptionResponse = {
  project_id: string;
  status: string;
  text_file: string;
  json_file: string;
  segments: number;
};

export type LocalTranscriptionJob = {
  project_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  step: string;
  progress: number;
  error?: string;
  result?: TranscriptionResponse;
};

export type Clip = {
  id: string;
  title: string;
  start: number;
  end: number;
  duration: number;
  reason?: string;
  file: string;
  top_line?: string;
  framing_mode?: FramingMode;
  caption_style?: CaptionStyle;
  caption_animation?: CaptionAnimation;
  status: string;
};

export type ClipGenerationJob = {
  job_id: string;
  project_id: string;
  status: "queued" | "processing" | "cancelling" | "cancelled" | "completed" | "failed";
  step: string;
  progress: number;
  completed_clips: number;
  total_clips: number;
  error?: string;
  clips?: Clip[];
  ready_clips?: Clip[];
};

export type ActiveJob = {
  id: string;
  kind: "download" | "transcription" | "generation";
  project_id: string;
  status: "queued" | "downloading" | "processing" | "cancelling";
  step: string;
  progress: number;
  completed_clips?: number;
  total_clips?: number;
  title?: string;
  ready_clips?: Clip[];
};

export type DownloadJob = {
  project_id: string;
  status: "queued" | "downloading" | "processing" | "completed" | "failed";
  step: string;
  progress: number;
  file?: string;
  title?: string;
  error?: string;
};

export type Project = {
  project_id: string;
  title?: string;
  created_at: string;
  source_type: string;
  clips: number;
  status: string;
};

export async function getActiveJobs(): Promise<ActiveJob[]> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/jobs/active`);
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not check active job progress"));
  }
  const result = await response.json() as { jobs: ActiveJob[] };
  return result.jobs;
}

export async function getDownloadJob(projectId: string): Promise<DownloadJob> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/download/${encodeURIComponent(projectId)}`);
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not check download progress"));
  }
  return response.json();
}

export async function downloadVideo(
  url: string,
  onProgress?: (job: DownloadJob) => void,
): Promise<DownloadResponse> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Video download failed"));
  }

  const initial = await response.json() as DownloadJob;
  onProgress?.(initial);

  if (initial.status === "completed") {
    return {
      project_id: initial.project_id,
      status: "downloaded",
      file: initial.file || "source.mp4",
      title: initial.title,
    };
  }

  let job: DownloadJob = initial;
  while (job.status !== "completed" && job.status !== "failed") {
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    job = await getDownloadJob(initial.project_id);
    onProgress?.(job);
  }

  if (job.status === "failed") {
    throw new Error(job.error || "Video download failed");
  }

  return {
    project_id: job.project_id,
    status: "downloaded",
    file: job.file || "source.mp4",
    title: job.title,
  };
}

export async function transcribeVideo(
  projectId: string,
): Promise<LocalTranscriptionJob> {
  const apiUrl = await getApiUrl();
  const response = await fetch(
    `${apiUrl}/api/projects/${projectId}/transcribe`,
    { method: "POST" },
  );

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Video transcription failed"));
  }

  return response.json();
}

export async function transcribeLocalVideo(
  video: File,
  onUploadProgress: (progress: number) => void,
): Promise<LocalTranscriptionJob> {
  const apiUrl = await getApiUrl();
  const formData = new FormData();
  formData.append("video", video);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${apiUrl}/api/local-video/transcribe`);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      let result: LocalTranscriptionJob & { detail?: string };
      try {
        result = JSON.parse(request.responseText);
      } catch {
        reject(new Error("The server returned an invalid upload response"));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(getApiErrorMessage(result, "Local video upload failed")));
        return;
      }
      resolve(result);
    });
    request.addEventListener("error", () => reject(new Error("Could not connect to the backend")));
    request.addEventListener("abort", () => reject(new Error("Video upload was cancelled")));
    request.send(formData);
  });
}

export async function transcribeLocalVideoFromPath(
  filePath: string,
): Promise<LocalTranscriptionJob> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/local-video/from-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: filePath }),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not start transcription from file path"));
  }
  return response.json();
}

export async function getLocalTranscriptionJob(
  projectId: string,
): Promise<LocalTranscriptionJob> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/local-video/jobs/${projectId}`);
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not check transcription progress"));
  }
  return response.json();
}

export type FramingMode = "standard" | "square_rounded" | "true_9_16";
export type CaptionStyle =
  | "clean"
  | "punch"
  | "robin"
  | "pill"
  | "karaoke"
  | "classic"
  | "bold_emerald"
  | "clean_gold";
export type CaptionAnimation = "pop" | "grow" | "sweep" | "fade" | "glide";

export type AnimationInfo = {
  id: CaptionAnimation;
  name: string;
  description: string;
};

export type CaptionStyleInfo = {
  id: CaptionStyle;
  name: string;
  description: string;
  font_family: string;
  font_file: string;
  text_case: "normal" | "upper";
  primary_color: string;
  accent_color: string | null;
  outline_width: number;
  shadow_depth: number;
  border_style: number;
  box_opacity: number;
  default_animation: CaptionAnimation;
  allowed_animations: CaptionAnimation[];
  allowed_animations_detail?: AnimationInfo[];
};

export async function generateClips(
  projectId: string,
  showSubtitles: boolean = true,
  onProgress?: (job: ClipGenerationJob) => void,
  clipDurationSeconds: 12 | 15 | 30 | 60 | 90 = 30,
  showWatermark: boolean = false,
  framingMode?: FramingMode,
  captionStyle?: CaptionStyle,
  captionAnimation?: CaptionAnimation,
  clipCount?: number,
  generationMode: "random" | "ai" = "random",
): Promise<{ clips: Clip[]; cancelled: boolean }> {
  const apiUrl = await getApiUrl();
  const framingQuery = framingMode ? `&framing_mode=${encodeURIComponent(framingMode)}` : "";
  const captionQuery = captionStyle ? `&caption_style=${encodeURIComponent(captionStyle)}` : "";
  const animQuery = captionAnimation ? `&caption_animation=${encodeURIComponent(captionAnimation)}` : "";
  const countQuery = typeof clipCount === "number" && clipCount > 0 ? `&clip_count=${clipCount}` : "";
  const modeQuery = `&generation_mode=${encodeURIComponent(generationMode)}`;
  const response = await fetch(
    `${apiUrl}/api/projects/${projectId}/generate-clips?show_subtitles=${showSubtitles}&clip_duration_seconds=${clipDurationSeconds}&show_watermark=${showWatermark}${framingQuery}${captionQuery}${animQuery}${countQuery}${modeQuery}`,
    { method: "POST" },
  );
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Clip generation failed"));
  }
  const { job_id: jobId } = await response.json() as { job_id: string };
  onProgress?.({
    job_id: jobId,
    project_id: projectId,
    status: "queued",
    step: "Preparing clip analysis",
    progress: 0,
    completed_clips: 0,
    total_clips: 0,
  });
  let job: ClipGenerationJob;
  do {
    const jobResponse = await fetch(
      `${apiUrl}/api/projects/${projectId}/generation-jobs/${jobId}`,
    );
    if (!jobResponse.ok) {
      const payload: unknown = await jobResponse.json().catch(() => null);
      throw new Error(getApiErrorMessage(payload, "Could not check clip generation progress"));
    }
    job = await jobResponse.json() as ClipGenerationJob;
    onProgress?.(job);
    if (job.status === "failed") {
      throw new Error(job.error ?? "Clip generation failed");
    }
    if (job.status === "cancelled") {
      return { clips: [], cancelled: true };
    }
    if (job.status !== "completed") {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
  } while (job.status !== "completed");

  return { clips: job.clips ?? [], cancelled: false };
}

export async function cancelClipGeneration(
  projectId: string,
  jobId: string,
): Promise<ClipGenerationJob> {
  const apiUrl = await getApiUrl();
  const response = await fetch(
    `${apiUrl}/api/projects/${projectId}/generation-jobs/${jobId}/cancel`,
    { method: "POST" },
  );
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not cancel clip generation"));
  }
  return response.json();
}

export async function getLatestClipGenerationJob(
  projectId: string,
): Promise<ClipGenerationJob | null> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/projects/${projectId}/generation-jobs`);
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not check clip generation progress"));
  }
  const result = await response.json() as { job: ClipGenerationJob | null };
  return result.job;
}

export type ProjectGenerationOptions = {
  show_subtitles?: boolean;
  show_watermark?: boolean;
  framing_mode?: FramingMode;
  caption_style?: CaptionStyle;
  caption_animation?: CaptionAnimation | null;
  clip_duration_seconds?: number;
  clip_count?: number | null;
};

export async function getClips(projectId: string): Promise<{
  clips: Clip[];
  source_duration?: number;
  generation_options?: ProjectGenerationOptions;
}> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/projects/${projectId}/clips`);
  if (!response.ok) {
    throw new Error("Could not load clips");
  }
  return response.json();
}

export async function getProjects(): Promise<{ projects: Project[] }> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/projects`);
  if (!response.ok) {
    throw new Error("Could not load projects");
  }
  return response.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/projects/${projectId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not delete project"));
  }
}

export async function updateProjectTitle(
  projectId: string,
  title: string
): Promise<{ project_id: string; title: string }> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not update project title"));
  }
  return response.json();
}

export async function clipUrl(projectId: string, filename: string): Promise<string> {
  const apiUrl = await getApiUrl();
  return `${apiUrl}/api/projects/${projectId}/clips/${encodeURIComponent(filename)}`;
}

export async function clipDownloadUrl(projectId: string, filename: string): Promise<string> {
  return `${await clipUrl(projectId, filename)}?download=true`;
}

export async function clipsArchiveDownloadUrl(projectId: string): Promise<string> {
  const apiUrl = await getApiUrl();
  return `${apiUrl}/api/projects/${encodeURIComponent(projectId)}/clips/download-all`;
}

export async function setClipTopLine(
  projectId: string,
  clipId: string,
  topLine: string,
  options?: {
    show_watermark?: boolean;
    show_subtitles?: boolean;
    framing_mode?: FramingMode;
    caption_style?: CaptionStyle;
    caption_animation?: CaptionAnimation;
  },
): Promise<{ clip: Clip }> {
  const apiUrl = await getApiUrl();
  const response = await fetch(
    `${apiUrl}/api/projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(clipId)}/top-line`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        top_line: topLine,
        show_watermark: options?.show_watermark,
        show_subtitles: options?.show_subtitles,
        framing_mode: options?.framing_mode,
        caption_style: options?.caption_style,
        caption_animation: options?.caption_animation,
      }),
    },
  );
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not update clip top line"));
  }
  return response.json();
}

export async function removeClipTopLine(
  projectId: string,
  clipId: string,
  options?: {
    show_watermark?: boolean;
    show_subtitles?: boolean;
    framing_mode?: FramingMode;
    caption_style?: CaptionStyle;
    caption_animation?: CaptionAnimation;
  },
): Promise<{ clip: Clip }> {
  const apiUrl = await getApiUrl();
  const query = new URLSearchParams();
  if (options?.show_watermark !== undefined) {
    query.set("show_watermark", String(options.show_watermark));
  }
  if (options?.show_subtitles !== undefined) {
    query.set("show_subtitles", String(options.show_subtitles));
  }
  if (options?.framing_mode !== undefined) {
    query.set("framing_mode", options.framing_mode);
  }
  if (options?.caption_style !== undefined) {
    query.set("caption_style", options.caption_style);
  }
  if (options?.caption_animation !== undefined) {
    query.set("caption_animation", options.caption_animation);
  }
  const queryString = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(
    `${apiUrl}/api/projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(clipId)}/top-line${queryString}`,
    {
      method: "DELETE",
    },
  );
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not remove clip top line"));
  }
  return response.json();
}

export async function getCaptionStyles(): Promise<CaptionStyleInfo[]> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/caption-styles`);
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not load caption styles"));
  }
  return response.json();
}

export async function saveClipWithExplorer(
  projectId: string,
  clipIdOrFilename: string,
  defaultFilename?: string,
): Promise<{ saved: boolean; path?: string; cancelled?: boolean }> {
  const cleanName =
    defaultFilename ||
    (clipIdOrFilename.endsWith(".mp4") ? clipIdOrFilename : `${clipIdOrFilename}.mp4`);

  // 1. Try modern File System Access API (Native Windows Save File Picker in Chrome/Edge/WebView2)
  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const picker = (window as unknown as {
        showSaveFilePicker: (options: {
          suggestedName: string;
          types: Array<{ description: string; accept: Record<string, string[]> }>;
        }) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
          name: string;
        }>;
      }).showSaveFilePicker;

      const fileHandle = await picker({
        suggestedName: cleanName,
        types: [
          {
            description: "MP4 Video (*.mp4)",
            accept: { "video/mp4": [".mp4"] },
          },
        ],
      });

      const downloadUrl = await clipDownloadUrl(projectId, clipIdOrFilename);
      const res = await fetch(downloadUrl);
      if (!res.ok) {
        throw new Error("Could not download clip stream");
      }
      const blob = await res.blob();
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { saved: true, path: fileHandle.name };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return { saved: false, cancelled: true };
      }
      // If permission or browser unsupported, fall through to backend dialog
    }
  }

  // 2. Fallback to backend native Windows File Explorer Save dialog
  const apiUrl = await getApiUrl();
  const cleanId = clipIdOrFilename.replace(/\.mp4$/, "");
  const response = await fetch(
    `${apiUrl}/api/projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(cleanId)}/save-dialog`,
    { method: "POST" },
  );
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not open save dialog"));
  }
  return response.json();
}

export async function saveAllClipsWithExplorer(
  projectId: string,
): Promise<{ saved: boolean; path?: string; cancelled?: boolean }> {
  const defaultZipName = `${projectId}-clips.zip`;

  // 1. Try modern File System Access API
  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const picker = (window as unknown as {
        showSaveFilePicker: (options: {
          suggestedName: string;
          types: Array<{ description: string; accept: Record<string, string[]> }>;
        }) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
          name: string;
        }>;
      }).showSaveFilePicker;

      const fileHandle = await picker({
        suggestedName: defaultZipName,
        types: [
          {
            description: "ZIP Archive (*.zip)",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });

      const downloadUrl = await clipsArchiveDownloadUrl(projectId);
      const res = await fetch(downloadUrl);
      if (!res.ok) {
        throw new Error("Could not download archive stream");
      }
      const blob = await res.blob();
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { saved: true, path: fileHandle.name };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return { saved: false, cancelled: true };
      }
    }
  }

  // 2. Fallback to backend native Windows File Explorer Save dialog
  const apiUrl = await getApiUrl();
  const response = await fetch(
    `${apiUrl}/api/projects/${encodeURIComponent(projectId)}/clips/download-all-dialog`,
    { method: "POST" },
  );
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Could not open save dialog"));
  }
  return response.json();
}


// ---------------------------------------------------------------------------
// YouTube Data API v3 OAuth & Direct Upload Integration
// ---------------------------------------------------------------------------

export interface YouTubeChannelInfo {
  id: string;
  title: string;
  handle?: string;
  thumbnail?: string;
}

export interface YouTubeStatusResponse {
  configured: boolean;
  client_id_preview?: string;
  authenticated: boolean;
  channel?: YouTubeChannelInfo | null;
}

export interface YouTubeUploadPayload {
  project_id: string;
  clip_id: string;
  title: string;
  description?: string;
  tags?: string[];
  privacy_status?: "public" | "private" | "unlisted";
  made_for_kids?: boolean;
}

export interface YouTubeUploadResult {
  success: boolean;
  video_id: string;
  youtube_url: string;
  shorts_url: string;
  title: string;
  privacy_status: string;
}

export interface AIDeveloperStatus {
  gemini_configured: boolean;
  youtube_authenticated: boolean;
  developer_mode: boolean;
  ai_enabled: boolean;
  reason: string | null;
}

export async function getAIDeveloperStatus(): Promise<AIDeveloperStatus> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/ai/status`, { cache: "no-store" });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Failed to get AI Developer Mode status"));
  }
  return response.json();
}

export async function saveGeminiApiKey(apiKey: string): Promise<AIDeveloperStatus> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/ai/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Failed to save Gemini API key"));
  }
  const payload = await response.json();
  return payload.status as AIDeveloperStatus;
}

export async function setAIDeveloperMode(enabled: boolean): Promise<AIDeveloperStatus> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/ai/developer-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Failed to update AI Developer Mode"));
  }
  const payload = await response.json();
  return payload.status as AIDeveloperStatus;
}

export async function getYouTubeStatus(): Promise<YouTubeStatusResponse> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/youtube/status`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Failed to get YouTube status"));
  }
  return response.json();
}

export async function saveYouTubeConfig(
  clientId: string,
  clientSecret: string,
): Promise<{ success: boolean; status: YouTubeStatusResponse }> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/youtube/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Failed to save YouTube configuration"));
  }
  return response.json();
}

export async function saveYouTubeJsonConfig(
  rawJson: string,
): Promise<{ success: boolean; status: YouTubeStatusResponse }> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/youtube/config/paste-json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw_json: rawJson }),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Failed to parse Google credentials JSON"));
  }
  return response.json();
}

export async function getYouTubeAuthUrl(redirectUri?: string): Promise<{ auth_url: string; redirect_uri: string }> {
  const apiUrl = await getApiUrl();
  const query = redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : "";
  const response = await fetch(`${apiUrl}/api/youtube/auth-url${query}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Failed to generate YouTube authorization URL"));
  }
  return response.json();
}

export async function disconnectYouTube(): Promise<{ success: boolean; status: YouTubeStatusResponse }> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/youtube/disconnect`, {
    method: "POST",
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, "Failed to disconnect YouTube"));
  }
  return response.json();
}

export async function uploadClipToYouTube(payload: YouTubeUploadPayload): Promise<YouTubeUploadResult> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/youtube/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const resPayload: unknown = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(resPayload, "YouTube video upload failed"));
  }
  return response.json();
}
