import { createClient, FunctionsHttpError } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const accountClient = url && key ? createClient(url, key, {
  auth: { flowType: "pkce" },
}) : null;

export type AccountPlan = {
  tier: "free" | "pro";
  status: string | null;
  activeUntil: string | null;
  checkoutAvailable: boolean;
  portalAvailable: boolean;
  testMode: boolean;
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
