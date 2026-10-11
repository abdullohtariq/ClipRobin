"use client";

import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";

const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

export default function UpdateNotice() {
  const [update, setUpdate] = useState<Awaited<ReturnType<typeof check>>>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isTauri() || process.env.NODE_ENV !== "production") {
      return;
    }

    let isActive = true;
    let isChecking = false;

    const checkForUpdates = async () => {
      if (isChecking) {
        return;
      }

      isChecking = true;
      try {
        const availableUpdate = await check();
        if (isActive) {
          setUpdate(availableUpdate);
          setError(null);
        }
      } catch (checkError) {
        console.error("Failed to check for Clip Robin updates.", checkError);
        if (isActive) {
          setError(
            checkError instanceof Error
              ? checkError.message
              : String(checkError),
          );
        }
      } finally {
        isChecking = false;
      }
    };

    void checkForUpdates();
    const interval = window.setInterval(
      () => void checkForUpdates(),
      UPDATE_CHECK_INTERVAL,
    );

    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, [retryCount]);

  const installUpdate = async () => {
    if (!update) {
      return;
    }

    setIsInstalling(true);
    setError(null);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (installError) {
      console.error("Failed to install the Clip Robin update.", installError);
      setError(
        installError instanceof Error
          ? installError.message
          : String(installError),
      );
      setIsInstalling(false);
    }
  };

  if (!update && !error) {
    return null;
  }

  return (
    <section
      aria-live="polite"
      className="m-6 mb-0 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sky-800 bg-sky-950/70 p-4 text-sm text-sky-100"
    >
      <div>
        {update ? (
          <>
            <p className="font-semibold">
              Clip Robin {update.version} is available.
            </p>
            {update.body && (
              <p className="mt-1 whitespace-pre-wrap text-sky-200">
                {update.body}
              </p>
            )}
            {error && (
              <p className="mt-1 text-rose-300">
                Update failed: {error}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-semibold">Could not check for updates.</p>
            <p className="mt-1 text-sky-200">{error}</p>
          </>
        )}
      </div>

      {update ? (
        <button
          type="button"
          onClick={installUpdate}
          disabled={isInstalling}
          className="rounded-lg bg-sky-200 px-4 py-2 font-semibold text-sky-950 hover:bg-white disabled:cursor-wait disabled:opacity-70"
        >
          {isInstalling ? "Installing update…" : "Update and restart"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setRetryCount((count) => count + 1);
          }}
          className="rounded-lg border border-sky-700 px-4 py-2 font-semibold hover:bg-sky-900"
        >
          Check again
        </button>
      )}
    </section>
  );
}
