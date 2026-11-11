"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { accountClient, billingRequest, type AccountPlan } from "@/src/lib/account";

export const PLAN_FEATURES = [
  ["Local transcription and Fast Interval clips", "Included", "Included"],
  ["MP4 and ZIP export", "Included", "Included"],
  ["Caption styles", "Classic and Clean", "All styles"],
  ["Gemini AI Hook Finder with your API key", "—", "Included"],
  ["Custom logo and watermark removal", "—", "Included"],
] as const;

const FREE_ALLOWED_CAPTION_STYLES = ["classic", "clean"];

type PlanResult = { accountId: string; plan: AccountPlan | null; error: string | null };

function useSubscriptionState() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!accountClient);
  const [recovering, setRecovering] = useState(false);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const accountId = session?.user.id;
  const accessToken = session?.access_token;
  const current = accountId && result?.accountId === accountId ? result : null;
  const plan = current?.plan ?? null;
  const isPro = plan?.tier === "pro";
  const invalidateRequests = useCallback(() => { requestVersion.current++; }, []);

  useEffect(() => {
    const listener = accountClient?.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        invalidateRequests();
        setResult(null);
        setRecovering(false);
      }
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => listener?.data.subscription.unsubscribe();
  }, [invalidateRequests]);

  const refreshPlan = useCallback(async () => {
    if (!accountId || !accessToken) return;
    const version = ++requestVersion.current;
    try {
      const nextPlan = await billingRequest<AccountPlan>("plan", accessToken);
      if (version === requestVersion.current) setResult({ accountId, plan: nextPlan, error: null });
    } catch (error) {
      if (version === requestVersion.current) {
        setResult({ accountId, plan: null, error: error instanceof Error ? error.message : "Could not check your plan." });
      }
    }
  }, [accountId, accessToken]);

  useEffect(() => {
    if (!accountId) return;
    void refreshPlan();
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void refreshPlan();
    };
    const interval = window.setInterval(refreshIfVisible, 60_000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      invalidateRequests();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [accountId, invalidateRequests, refreshPlan]);

  const openUpgradeModal = useCallback((reason?: string) => {
    setUpgradeReason(reason ?? null);
    setUpgradeModalOpen(true);
  }, []);
  const closeUpgradeModal = useCallback(() => setUpgradeModalOpen(false), []);
  const isCaptionStyleAllowed = useCallback((style: string) => isPro || FREE_ALLOWED_CAPTION_STYLES.includes(style), [isPro]);

  return {
    authReady, session, recovering, setRecovering, plan, isPro, planError: current?.error,
    refreshPlan, upgradeModalOpen, upgradeReason, openUpgradeModal, closeUpgradeModal, isCaptionStyleAllowed,
  };
}

const SubscriptionContext = createContext<ReturnType<typeof useSubscriptionState> | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const value = useSubscriptionState();
  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) throw new Error("useSubscription requires SubscriptionProvider");
  return context;
}
