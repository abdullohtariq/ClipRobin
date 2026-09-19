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
): Promise<TranscriptionResponse> {
  const formData = new FormData();
  formData.append("video", video);

  const response = await fetch(`${API_URL}/api/local-video/transcribe`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Local video transcription failed");
  }

  return response.json();
}

export async function generateClips(projectId: string): Promise<{ clips: Clip[] }> {
  const response = await fetch(
    `${API_URL}/api/projects/${projectId}/generate-clips`,
    { method: "POST" },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Clip generation failed");
  }
  return response.json();
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

export function clipUrl(projectId: string, filename: string): string {
  return `${API_URL}/api/projects/${projectId}/clips/${encodeURIComponent(filename)}`;
}
