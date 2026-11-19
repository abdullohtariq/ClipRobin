import { createClient, FunctionsHttpError } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const accountClient = url && key ? createClient(url, key, {
  auth: { flowType: "pkce", detectSessionInUrl: false },
}) : null;

const recoveryKey = "cliprobin:password-recovery";
const mailLinkError = "This account link has expired or has already been used. Request a new confirmation or password reset email.";

export type EmailCallback = { tokenHash: string; type: "email" | "recovery" };

type AuthCallback = { email: EmailCallback } | { code: string } | { error: string };

export function takeAuthCallback(): AuthCallback | null {
  const url = new URL(window.location.href);
  if (!/\/subscription\/?$/.test(url.pathname)) return null;
  const fragment = new URLSearchParams(url.hash.slice(1));
  const keys = ["error", "error_code", "error_description", "token_hash", "type", "code",
    "access_token", "refresh_token", "expires_in", "expires_at", "token_type", "provider_token", "provider_refresh_token"];
  const get = (key: string) => url.searchParams.get(key) ?? fragment.get(key);
  const type = get("type");
  const tokenHash = get("token_hash");
  const code = get("code");
  const error = get("error_code") ?? get("error");
  const errorDescription = get("error_description");
  if (!keys.some((key) => key !== "type" && get(key) !== null)) return null;
  for (const key of keys) {
    url.searchParams.delete(key);
    fragment.delete(key);
  }
  if (url.hash.includes("=")) url.hash = fragment.toString();
  window.history.replaceState(window.history.state, "", url);
  if (error) {
    if (error === "otp_expired") return { error: mailLinkError };
    const detail = errorDescription?.trim();
    return { error: detail ? `Sign-in failed (${error}): ${detail}` : "This sign-in link could not be opened. Start again from Account & Plans." };
  }
  if (tokenHash && (type === "email" || type === "recovery")) return { email: { tokenHash, type } };
  if (code) return { code };
  return { error: mailLinkError };
}

export function recoveryIsOpen(userId: string) {
  const [id, expiresAt] = (sessionStorage.getItem(recoveryKey) ?? "").split("/");
  return id === userId && Number(expiresAt) > Date.now();
}

export function saveRecovery(userId?: string) {
  if (userId) sessionStorage.setItem(recoveryKey, `${userId}/${Date.now() + 15 * 60_000}`);
  else sessionStorage.removeItem(recoveryKey);
}

export async function verifyEmailCallback(callback: EmailCallback) {
  if (!accountClient) return null;
  const { data, error } = await accountClient.auth.verifyOtp({ token_hash: callback.tokenHash, type: callback.type });
  if (error?.code === "otp_expired" || (!error && !data.session)) throw new Error(mailLinkError);
  if (error) throw error;
  return data.session;
}

export type AccountPlan = {
  tier: "free" | "pro";
  status: string | null;
  activeUntil: string | null;
  checkoutAvailable: boolean;
  portalAvailable: boolean;
  testMode: boolean;
  checkoutUnavailableReason?: "setup" | "sandbox_access" | "subscription" | "capacity" | null;
  checkoutState?: "open" | "pending" | "preparing" | null;
  checkoutAttempt?: string | null;
  hookCredits?: { monthly: number; remaining: number; availableNow?: number; resetsAt: string } | null;
};

export async function billingRequest<T>(action: "plan" | "checkout" | "portal", accessToken: string) {
  if (!accountClient) throw new Error("Accounts are not configured for this build.");
  const { data, error } = await accountClient.functions.invoke<T>("cliprobin-billing", {
    body: { action },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error instanceof FunctionsHttpError) {
    const payload = await error.context.json().catch(() => null);
    if (typeof payload?.error === "string") throw new Error(payload.error);
  }
  if (error || !data) throw new Error("Could not reach the account service. Try again shortly.");
  return data;
}
