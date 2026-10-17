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
  }, []);

  const installUpdate = async () => {
    setIsInstalling(true);
    setError(null);
    try {
      if (update) {
        await update.downloadAndInstall();
        await relaunch();
      } else {
        const availableUpdate = await check();
        if (availableUpdate) {
          await availableUpdate.downloadAndInstall();
          await relaunch();
        } else {
          await relaunch();
        }
      }
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

  if (!update && !pendingUpdateVersion) {
    return null;
  }

  return (
    <section
      aria-live="polite"
      className="mx-6 mt-6 mb-0 flex items-center justify-between gap-4 rounded-[12px] border border-[#232326] bg-[#111113] p-4 text-sm text-zinc-200 shadow-sm transition-all duration-150"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#10b981]/10 text-[#10b981]">
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">
            Newer version is here :)
          </p>
          {error && (
            <p className="mt-0.5 text-xs text-red-400">
              {error}
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={installUpdate}
        disabled={isInstalling}
        className="shrink-0 rounded-[10px] bg-[#10b981] px-4 py-2 text-xs font-semibold text-zinc-950 transition-all duration-150 hover:bg-[#059669] disabled:cursor-wait disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#10b981]"
      >
        {isInstalling ? "Restarting..." : "Click here to restart"}
      </button>
    </section>
  );
}
