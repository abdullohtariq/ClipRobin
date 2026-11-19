"use client";

import { isAuthError, type Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { accountClient, billingRequest, recoveryIsOpen, saveRecovery, takeAuthCallback, type AccountPlan, type EmailCallback } from "@/src/lib/account";

export const PLAN_FEATURES = [
  ["Local transcription & Fast Interval clips", "Included", "Included"],
  ["Output resolution & format", "720×1280, 30 fps MP4", "720×1280, 30 fps MP4"],
  ["MP4 and ZIP export", "Included", "Included"],
  ["Watermark", "Default Clip Robin mark", "Removable or custom logo"],
  ["Caption styles", "Classic and Clean", "All 18 styles"],
  ["Gemini AI Hook Finder", "—", "20 included credits per billing cycle, or use your own Gemini key"],
] as const;

const FREE_ALLOWED_CAPTION_STYLES = ["classic", "clean"];

type PlanResult = { accountId: string; plan: AccountPlan | null; error: string | null };

function useSubscriptionState() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!accountClient);
  const [recovering, setRecoveryOpen] = useState(false);
  const [checkingCallback, setCheckingCallback] = useState(false);
  const [emailCallback, setEmailCallback] = useState<EmailCallback | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const callbackRead = useRef(false);
  const accountId = session?.user.id;
  const accessToken = session?.access_token;
  const current = accountId && result?.accountId === accountId ? result : null;
  const plan = current?.plan ?? null;
  const isPro = plan?.tier === "pro";
  const invalidateRequests = useCallback(() => { requestVersion.current++; }, []);
  const setRecovering = useCallback((userId?: string) => {
    saveRecovery(userId);
    setRecoveryOpen(Boolean(userId));
  }, []);

  useEffect(() => {
    if (!accountClient) return;
    const auth = accountClient.auth;
    const listener = auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        invalidateRequests();
        setResult(null);
        setRecovering();
      }
      if (event === "PASSWORD_RECOVERY" && nextSession) setRecovering(nextSession.user.id);
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        setRecoveryOpen(Boolean(nextSession && recoveryIsOpen(nextSession.user.id)));
      }
      setSession(nextSession);
      setAuthReady(true);
    });
    if (!callbackRead.current) {
      callbackRead.current = true;
      const callback = takeAuthCallback();
      if (callback && "error" in callback) setCallbackError(callback.error);
      if (callback && "email" in callback) setEmailCallback(callback.email);
      if (callback && "code" in callback) {
        setCheckingCallback(true);
        void (async () => {
          try {
            const { data, error } = await auth.exchangeCodeForSession(callback.code);
            if (error || !data.session) throw error ?? new Error("No session returned");
            setSession(data.session);
          } catch (err) {
            const detail = err instanceof Error ? err.message.trim() : "";
            const invalidLink = isAuthError(err) && [
              "bad_code_verifier", "pkce_code_verifier_not_found", "flow_state_not_found", "flow_state_expired", "otp_expired",
            ].includes(err.code ?? "");
            setCallbackError(
              invalidLink || !detail
                ? "This account link has expired or was opened in a different browser. Start sign-in again in this browser, or request a new email link."
                : `Could not finish sign-in: ${detail}`
            );
          } finally {
            setCheckingCallback(false);
          }
        })();
      }
    }
    return () => listener.data.subscription.unsubscribe();
  }, [invalidateRequests, setRecovering]);

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
    window.addEventListener("cliprobin:hook-usage-changed", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      invalidateRequests();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("cliprobin:hook-usage-changed", refreshIfVisible);
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
    authReady: authReady && !checkingCallback, session, recovering, setRecovering, emailCallback, setEmailCallback,
    callbackError, setCallbackError, plan, isPro, planError: current?.error,
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
