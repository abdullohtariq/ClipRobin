"use client";

import { useCallback, useEffect, useState } from "react";
import { AIDeveloperStatus, getAIDeveloperStatus } from "@/src/lib/api";

function isSameStatus(a: AIDeveloperStatus | null, b: AIDeveloperStatus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.gemini_configured === b.gemini_configured &&
    a.youtube_authenticated === b.youtube_authenticated &&
    a.developer_mode === b.developer_mode &&
    a.ai_enabled === b.ai_enabled &&
    a.reason === b.reason
  );
}

export function useAIDeveloperStatus() {
  const [status, setStatus] = useState<AIDeveloperStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getAIDeveloperStatus();
      setStatus((prev) => (isSameStatus(prev, next) ? prev : next));
    } catch {
      setStatus((prev) => (prev === null ? prev : null));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleFocus = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    };
    const handleStatusEvent = (event: Event) => {
      const custom = event as CustomEvent<AIDeveloperStatus | undefined>;
      if (custom.detail && typeof custom.detail === "object") {
        setStatus((prev) => (isSameStatus(prev, custom.detail!) ? prev : custom.detail!));
      } else {
        void refresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    window.addEventListener("cliprobin:ai-status-changed", handleStatusEvent);
    const interval = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    }, 15000);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
      window.removeEventListener("cliprobin:ai-status-changed", handleStatusEvent);
      window.clearInterval(interval);
    };
  }, [refresh]);

  return { status, refresh };
}
