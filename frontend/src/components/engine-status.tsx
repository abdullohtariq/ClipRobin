"use client";

import React, { useCallback, useEffect, useState } from "react";
import { checkEngineHealth } from "@/src/lib/api";
import { Badge } from "@/src/components/ui/badge";

type EngineHealthState = "checking" | "ready" | "unavailable";

export function EngineStatus({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "badge";
}) {
  const [state, setState] = useState<EngineHealthState>("checking");
  const [checkingNow, setCheckingNow] = useState(false);

  const probe = useCallback(async () => {
    setCheckingNow(true);
    const ok = await checkEngineHealth();
    setState(ok ? "ready" : "unavailable");
    setCheckingNow(false);
  }, []);

  useEffect(() => {
    let active = true;
    const runProbe = async () => {
      const ok = await checkEngineHealth();
      if (active) {
        setState(ok ? "ready" : "unavailable");
      }
    };
    void runProbe();

    const intervalMs = state === "unavailable" ? 5000 : 15000;
    const timer = window.setInterval(() => {
      void runProbe();
    }, intervalMs);

    const onFocusOrOnline = () => {
      void runProbe();
    };
    window.addEventListener("focus", onFocusOrOnline);
    window.addEventListener("online", onFocusOrOnline);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocusOrOnline);
      window.removeEventListener("online", onFocusOrOnline);
    };
  }, [state]);

  if (variant === "badge") {
    if (state === "ready") {
      return (
        <Badge variant="emerald" size="md">
          Local Engine Ready
        </Badge>
      );
    }
    if (state === "checking") {
      return (
        <Badge variant="neutral" size="md">
          Checking Engine…
        </Badge>
      );
    }
    return (
      <div className="inline-flex items-center gap-2">
        <Badge variant="danger" size="md">
          Engine Unavailable
        </Badge>
        <button
          type="button"
          onClick={() => void probe()}
          disabled={checkingNow}
          className="text-xs font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-2 focus-ring cursor-pointer disabled:opacity-50"
        >
          {checkingNow ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }

  const label =
    state === "ready"
      ? "Local Engine Ready"
      : state === "checking"
      ? "Checking Engine…"
      : "Engine Unavailable";

  const dotClass =
    state === "ready"
      ? "bg-[#10b981] animate-pulse"
      : state === "checking"
      ? "bg-zinc-400 animate-pulse"
      : "bg-red-500";

  return (
    <div
      className="flex items-center justify-between xl:justify-start gap-2 text-xs text-zinc-400"
      title={label}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`size-2 rounded-full shrink-0 ${dotClass}`} />
        <span className="hidden xl:inline truncate">{label}</span>
      </div>
      {state === "unavailable" && (
        <button
          type="button"
          onClick={() => void probe()}
          disabled={checkingNow}
          className="hidden xl:inline text-[11px] font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer shrink-0 disabled:opacity-50"
        >
          Retry
        </button>
      )}
    </div>
  );
}
