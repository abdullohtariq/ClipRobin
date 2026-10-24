"use client";

import { useCallback, useEffect, useState } from "react";
import { AIDeveloperStatus, getAIDeveloperStatus } from "@/src/lib/api";

export function useAIDeveloperStatus() {
  const [status, setStatus] = useState<AIDeveloperStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getAIDeveloperStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleFocus = () => void refresh();
    window.addEventListener("focus", handleFocus);
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.clearInterval(interval);
    };
  }, [refresh]);

  return { status, refresh };
}
