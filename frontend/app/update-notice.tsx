"use client";

import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";

const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const PENDING_UPDATE_VERSION_KEY = "cliprobin.pendingUpdateVersion";

function compareVersions(left: string, right: string): number | null {
  const leftMatch = left.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  const rightMatch = right.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!leftMatch || !rightMatch) {
    return null;
  }

  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftMatch[index]) - Number(rightMatch[index]);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }

  if (leftMatch[4] === rightMatch[4]) {
    return 0;
  }
  if (!leftMatch[4]) {
    return 1;
  }
  if (!rightMatch[4]) {
    return -1;
  }
  return leftMatch[4].localeCompare(rightMatch[4], undefined, { numeric: true });
}

export default function UpdateNotice() {
  const [update, setUpdate] = useState<Awaited<ReturnType<typeof check>>>(null);
  const [pendingUpdateVersion, setPendingUpdateVersion] = useState<string | null>(null);
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
          if (availableUpdate) {
            localStorage.setItem(PENDING_UPDATE_VERSION_KEY, availableUpdate.version);
            setPendingUpdateVersion(availableUpdate.version);
            setUpdate(availableUpdate);
          } else {
            const pendingVersion = localStorage.getItem(PENDING_UPDATE_VERSION_KEY);
            if (pendingVersion) {
              const installedVersion = await getVersion();
              if (!isActive) {
                return;
              }
              const comparison = compareVersions(installedVersion, pendingVersion);
              if (comparison !== null && comparison >= 0) {
                localStorage.removeItem(PENDING_UPDATE_VERSION_KEY);
                setPendingUpdateVersion(null);
              } else {
                setPendingUpdateVersion(pendingVersion);
              }
            }
            setUpdate(null);
          }
          setError(null);
        }
      } catch (checkError) {
        console.error("Failed to check for Clip Robin updates.", checkError);
        if (isActive) {
          const rememberedVersion = localStorage.getItem(PENDING_UPDATE_VERSION_KEY);
          if (rememberedVersion) {
            setPendingUpdateVersion(rememberedVersion);
          }
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

  if (!update && !pendingUpdateVersion && !error) {
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
        ) : pendingUpdateVersion ? (
          <>
            <p className="font-semibold">
              Clip Robin {pendingUpdateVersion} is still available.
            </p>
            <p className="mt-1 text-sky-200">
              This update reminder will stay here until you update.
            </p>
            {error && (
              <p className="mt-1 text-rose-300">
                Could not check for updates: {error}
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
