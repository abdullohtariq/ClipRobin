"use client";

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";

export type SubscriptionTier = "free" | "pro";

export interface PlanFeature {
  name: string;
  free: string | boolean;
  pro: string | boolean;
  highlight?: boolean;
}

export const PLAN_FEATURES: PlanFeature[] = [
  {
    name: "Gemini AI Hook Finder",
    free: false,
    pro: "Unlimited (BYOK / Direct)",
    highlight: true,
  },
  {
    name: "Virality Score & Hook Reason",
    free: false,
    pro: true,
    highlight: true,
  },
  {
    name: "Custom Brand Watermark (Logo Upload)",
    free: false,
    pro: true,
    highlight: true,
  },
  {
    name: "Remove Watermark (Clean Export)",
    free: false,
    pro: true,
    highlight: true,
  },
  {
    name: "Subtitle Styles Available",
    free: "2 Basic (Classic & Clean)",
    pro: "All Viral Styles (Robin, Punch, Pill, Karaoke...)",
    highlight: true,
  },
  {
    name: "Pro Subtitle Customizer (Colors & Sizing)",
    free: false,
    pro: true,
  },
  {
    name: "Local Offline Transcription (Whisper)",
    free: true,
    pro: true,
  },
  {
    name: "AI Face Tracking (9:16 Auto-reframe)",
    free: true,
    pro: true,
  },
  {
    name: "YouTube Shorts Direct Upload",
    free: true,
    pro: true,
  },
  {
    name: "Export Quality",
    free: "1080p Standard",
    pro: "4K 60FPS Ultra",
  },
];

export const FREE_ALLOWED_CAPTION_STYLES = ["classic", "clean"] as const;

interface SubscriptionContextType {
  tier: SubscriptionTier;
  isPro: boolean;
  isFree: boolean;
  licenseKey: string | null;
  upgradeModalOpen: boolean;
  upgradeReason: string | null;
  openUpgradeModal: (reason?: string) => void;
  closeUpgradeModal: () => void;
  upgradeToPro: (key?: string) => Promise<boolean>;
  downgradeToFree: () => void;
  canUseAiHooks: boolean;
  canUseCustomWatermark: boolean;
  canRemoveWatermark: boolean;
  isCaptionStyleAllowed: (styleId: string) => boolean;
}

const STORAGE_TIER_KEY = "cliprobin_subscription_tier";
const STORAGE_LICENSE_KEY = "cliprobin_license_key";

const SubscriptionContext = createContext<SubscriptionContextType | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [tier, setTier] = useState<SubscriptionTier>("free");
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedTier = localStorage.getItem(STORAGE_TIER_KEY) as SubscriptionTier | null;
      const savedKey = localStorage.getItem(STORAGE_LICENSE_KEY);
      if (savedTier === "pro") {
        setTier("pro");
      } else {
        setTier("free");
      }
      if (savedKey) {
        setLicenseKey(savedKey);
      }
    } catch {
      // ignore
    }
  }, []);

  const openUpgradeModal = useCallback((reason?: string) => {
    setUpgradeReason(reason || null);
    setUpgradeModalOpen(true);
  }, []);

  const closeUpgradeModal = useCallback(() => {
    setUpgradeModalOpen(false);
    setUpgradeReason(null);
  }, []);

  const upgradeToPro = useCallback(async (key?: string): Promise<boolean> => {
    try {
      const activeKey = key?.trim() || `ROBIN-PRO-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      localStorage.setItem(STORAGE_TIER_KEY, "pro");
      localStorage.setItem(STORAGE_LICENSE_KEY, activeKey);
      setTier("pro");
      setLicenseKey(activeKey);
      closeUpgradeModal();
      return true;
    } catch {
      return false;
    }
  }, [closeUpgradeModal]);

  const downgradeToFree = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_TIER_KEY, "free");
      localStorage.removeItem(STORAGE_LICENSE_KEY);
      setTier("free");
      setLicenseKey(null);
    } catch {
      // ignore
    }
  }, []);

  const isPro = tier === "pro";
  const isFree = !isPro;

  const canUseAiHooks = isPro;
  const canUseCustomWatermark = isPro;
  const canRemoveWatermark = isPro;

  const isCaptionStyleAllowed = useCallback((styleId: string): boolean => {
    if (isPro) return true;
    return (FREE_ALLOWED_CAPTION_STYLES as readonly string[]).includes(styleId);
  }, [isPro]);

  const value = useMemo(
    () => ({
      tier,
      isPro,
      isFree,
      licenseKey,
      upgradeModalOpen,
      upgradeReason,
      openUpgradeModal,
      closeUpgradeModal,
      upgradeToPro,
      downgradeToFree,
      canUseAiHooks,
      canUseCustomWatermark,
      canRemoveWatermark,
      isCaptionStyleAllowed,
    }),
    [
      tier,
      isPro,
      isFree,
      licenseKey,
      upgradeModalOpen,
      upgradeReason,
      openUpgradeModal,
      closeUpgradeModal,
      upgradeToPro,
      downgradeToFree,
      canUseAiHooks,
      canUseCustomWatermark,
      canRemoveWatermark,
      isCaptionStyleAllowed,
    ]
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextType {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error("useSubscription must be used within a SubscriptionProvider");
  }
  return context;
}
