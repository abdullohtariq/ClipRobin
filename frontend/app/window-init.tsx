"use client";

import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function WindowInit() {
  useEffect(() => {
    if (isTauri()) {
      const alreadyInitialized = sessionStorage.getItem("cliprobin_window_maximized");
      if (!alreadyInitialized) {
        sessionStorage.setItem("cliprobin_window_maximized", "true");
        void getCurrentWindow().maximize().catch((error) => {
          console.warn("Could not maximize window on startup", error);
        });
      }
    }
  }, []);

  return null;
}

