const API_URL = "http://127.0.0.1:8000";

export type DownloadResponse = {
  project_id: string;
  status: string;
  file: string;
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
};

export type Project = {
  project_id: string;
  created_at: string;
  source_type: string;
  clips: number;
  status: string;
};

export async function downloadVideo(url: string): Promise<DownloadResponse> {
  const response = await fetch(`${API_URL}/api/download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error("Video download failed");
  }

  return response.json();
}

export async function transcribeVideo(
  projectId: string,
): Promise<TranscriptionResponse> {
  const response = await fetch(
    `${API_URL}/api/projects/${projectId}/transcribe`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw new Error("Video transcription failed");
  }

  return response.json();
}

export async function transcribeLocalVideo(
  video: File,
  onUploadProgress: (progress: number) => void,
): Promise<LocalTranscriptionJob> {
  const formData = new FormData();
  formData.append("video", video);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}/api/local-video/transcribe`);
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
        reject(new Error(result.detail ?? "Local video upload failed"));
        return;
      }
      resolve(result);
    });
    request.addEventListener("error", () => reject(new Error("Could not connect to the backend")));
    request.addEventListener("abort", () => reject(new Error("Video upload was cancelled")));
    request.send(formData);
  });
}

export async function getLocalTranscriptionJob(
  projectId: string,
): Promise<LocalTranscriptionJob> {
  const response = await fetch(`${API_URL}/api/local-video/jobs/${projectId}`);
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Could not check transcription progress");
  }
  return response.json();
}

export async function generateClips(
  projectId: string,
  showSubtitles: boolean = true,
  onProgress?: (job: ClipGenerationJob) => void,
): Promise<{ clips: Clip[]; cancelled: boolean }> {
  const response = await fetch(
    `${API_URL}/api/projects/${projectId}/generate-clips?show_subtitles=${showSubtitles}`,
    { method: "POST" },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Clip generation failed");
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
      `${API_URL}/api/projects/${projectId}/generation-jobs/${jobId}`,
    );
    if (!jobResponse.ok) {
      const detail = await jobResponse.json().catch(() => null);
      throw new Error(detail?.detail ?? "Could not check clip generation progress");
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
  const response = await fetch(
    `${API_URL}/api/projects/${projectId}/generation-jobs/${jobId}/cancel`,
    { method: "POST" },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Could not cancel clip generation");
  }
  return response.json();
}

export async function getLatestClipGenerationJob(
  projectId: string,
): Promise<ClipGenerationJob | null> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/generation-jobs`);
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Could not check clip generation progress");
  }
  const result = await response.json() as { job: ClipGenerationJob | null };
  return result.job;
}

export async function getClips(projectId: string): Promise<{ clips: Clip[] }> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/clips`);
  if (!response.ok) {
    throw new Error("Could not load clips");
  }
  return response.json();
}

export async function getProjects(): Promise<{ projects: Project[] }> {
  const response = await fetch(`${API_URL}/api/projects`);
  if (!response.ok) {
    throw new Error("Could not load projects");
  }
  return response.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/projects/${projectId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Could not delete project");
  }
}

export function clipUrl(projectId: string, filename: string): string {
  return `${API_URL}/api/projects/${projectId}/clips/${encodeURIComponent(filename)}`;
}

export function clipDownloadUrl(projectId: string, filename: string): string {
  return `${clipUrl(projectId, filename)}?download=true`;
}
