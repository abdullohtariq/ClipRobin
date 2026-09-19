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

export async function checkBackend() {
  const response = await fetch(`${API_URL}/api/health`);

  if (!response.ok) {
    throw new Error("Backend is not responding");
  }

  return response.json();
}

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
