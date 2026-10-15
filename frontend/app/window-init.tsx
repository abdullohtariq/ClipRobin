"use client";

import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function WindowInit() {
  useEffect(() => {
    if (isTauri()) {
      void getCurrentWindow().maximize().catch((error) => {
        console.warn("Could not maximize window on startup", error);
      });
    }
  }, []);

  return null;
}

