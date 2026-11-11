"use client";

import { isTauri } from "@tauri-apps/api/core";
import { isAuthError } from "@supabase/supabase-js";
import { useState, type FormEvent } from "react";
import { accountClient, billingRequest } from "@/src/lib/account";
import { PLAN_FEATURES, useSubscription } from "@/src/lib/subscription-context";

const inputClass = "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm";
const primaryClass = "inline-block rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50";
const secondaryClass = "inline-block rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium disabled:opacity-50";
const accountPageUrl = process.env.NEXT_PUBLIC_CLIPROBIN_ACCOUNT_URL;
const oauthProviders = [
  { id: "github", label: "GitHub", enabled: process.env.NEXT_PUBLIC_CLIPROBIN_GITHUB_AUTH === "1" },
  { id: "google", label: "Google", enabled: process.env.NEXT_PUBLIC_CLIPROBIN_GOOGLE_AUTH === "1" },
] as const;

type AuthMode = "sign-in" | "sign-up" | "reset";

function AccountPanel() {
  const { authReady, session, recovering, setRecovering, plan, planError, refreshPlan } = useSubscription();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [billingLink, setBillingLink] = useState<{ accountId: string; url: string; action: "checkout" | "portal" } | null>(null);
  const [desktop] = useState(() => typeof window !== "undefined" && isTauri());

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      if (isAuthError(err) && err.code === "over_email_send_rate_limit") {
        setError("Supabase has reached its email limit. Use the confirmation link already sent, or try again later.");
      } else if (isAuthError(err) && err.code === "email_address_not_authorized") {
        setError("This email can’t receive account messages from this Supabase project. Ask the project owner to configure public email delivery.");
      } else {
        setError(err instanceof Error ? err.message : "Try again shortly.");
      }
    } finally {
      setBusy(false);
    }
  }

  function confirmationRedirect() {
    return accountPageUrl ?? (desktop ? undefined : `${window.location.origin}/subscription`);
  }

  function resendConfirmation() {
    const auth = accountClient?.auth;
    if (!auth || !unconfirmedEmail || unconfirmedEmail !== email.trim()) return;
    void run(async () => {
      const { error: resendError } = await auth.resend({
        type: "signup",
        email: unconfirmedEmail,
        options: { emailRedirectTo: confirmationRedirect() },
      });
      if (resendError) throw resendError;
      setMessage("Check your inbox and spam for the confirmation link, then return here to sign in.");
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountClient) return;
    const auth = accountClient.auth;
    void run(async () => {
      if (recovering) {
        const response = await auth.updateUser({ password });
        if (response.error) throw response.error;
        setRecovering(false);
        setMessage("Password updated.");
      } else if (mode === "reset") {
        const response = await auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/subscription` });
        if (response.error) throw response.error;
        setMessage("If an account exists, check your email and open the reset link in this browser.");
      } else if (mode === "sign-up") {
        const response = await auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: confirmationRedirect() } });
        if (response.error) throw response.error;
        if (!response.data.session) {
          setUnconfirmedEmail(email.trim());
          setMode("sign-in");
          setMessage("Check your inbox and spam for the confirmation link, then return here to sign in.");
        }
      } else {
        const response = await auth.signInWithPassword({ email: email.trim(), password });
        if (response.error?.code === "email_not_confirmed") {
          setUnconfirmedEmail(email.trim());
          setError("Confirm your email to sign in. Check your inbox and spam for the confirmation link.");
          return;
        }
        if (response.error) throw response.error;
        setUnconfirmedEmail(null);
      }
      setPassword("");
    });
  }

  function socialSignIn(provider: "github" | "google") {
    const auth = accountClient?.auth;
    if (!auth) return;
    void run(async () => {
      const response = await auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/subscription` } });
      if (response.error) throw response.error;
    });
  }

  function getBillingLink(action: "checkout" | "portal") {
    if (!session) return;
    setBillingLink(null);
    void run(async () => {
      const result = await billingRequest<{ url: string }>(action, session.access_token);
      const url = new URL(result.url);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".lemonsqueezy.com") || url.username || url.password || url.port) {
        throw new Error("Checkout returned an invalid link.");
      }
      setBillingLink({ accountId: session.user.id, url: url.href, action });
    });
  }

  const auth = accountClient?.auth;
  if (!auth) return <p className="text-sm text-zinc-300">Account sign-in is unavailable in this build. You can still create and export clips on the Free plan.</p>;
  if (!authReady) return <p role="status" className="text-sm text-zinc-300">Checking sign-in…</p>;

  const accountForm = !session || recovering;
  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-300">{message}</p>}
      {accountForm ? (
        <>
          <form className="max-w-md space-y-4" onSubmit={submit}>
            <h2 className="font-semibold">{recovering ? "Choose a new password" : mode === "sign-up" ? "Create a free account" : mode === "reset" ? "Reset your password" : "Sign in with email"}</h2>
            {!recovering && <label className="block text-sm">Email<input className={inputClass} required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
            {(recovering || mode !== "reset") && (
              <label className="block text-sm">Password<input className={inputClass} required minLength={recovering || mode === "sign-up" ? 8 : undefined} type="password" autoComplete={recovering || mode === "sign-up" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className={primaryClass}>
                {busy ? "Please wait…" : recovering ? "Save password" : mode === "sign-up" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}
              </button>
              {!recovering && (
                <button type="button" disabled={busy} className={secondaryClass} onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(null); setMessage(null); setPassword(""); }}>
                  {mode === "sign-in" ? "Create a free account" : "Back to sign-in"}
                </button>
              )}
            </div>
          </form>
          {!recovering && mode === "sign-in" && (
            <div className="flex flex-wrap gap-3">
              {unconfirmedEmail && unconfirmedEmail === email.trim() && (
                <button type="button" disabled={busy} className={secondaryClass} onClick={resendConfirmation}>Resend confirmation email</button>
              )}
              {desktop ? accountPageUrl && <a href={accountPageUrl} target="_blank" rel="noopener noreferrer" className={secondaryClass}>Reset password in browser</a> : (
                <>
                  <button type="button" disabled={busy} className={secondaryClass} onClick={() => { setMode("reset"); setError(null); setMessage(null); setPassword(""); }}>Forgot password?</button>
                  {oauthProviders.filter((provider) => provider.enabled).map((provider) => (
                    <button key={provider.id} type="button" disabled={busy} className={secondaryClass} onClick={() => socialSignIn(provider.id)}>Continue with {provider.label}</button>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-300">Signed in as {session.user.email}</p>
          <p role="status" className="text-sm font-semibold">
            {planError ? "Could not verify your plan. Free features are available." : !plan ? "Checking your plan…" : plan.tier === "pro" ? "Pro is active" : "Free plan"}
            {plan?.status === "cancelled" && plan.activeUntil && ` until ${new Date(plan.activeUntil).toLocaleDateString()}`}
          </p>
          {planError && <p role="alert" className="text-sm text-rose-300">{planError}</p>}
          {plan?.testMode && plan.checkoutAvailable && <p className="text-sm text-amber-300">Test checkout. Use test payment details only.</p>}
          {plan && !plan.checkoutAvailable && !plan.portalAvailable && <p className="text-sm text-zinc-400">Paid checkout is currently unavailable.</p>}
          <div className="flex flex-wrap gap-2">
            {plan?.checkoutAvailable && <button type="button" disabled={busy} className={primaryClass} onClick={() => getBillingLink("checkout")}>Get Pro checkout link</button>}
            {plan?.portalAvailable && <button type="button" disabled={busy} className={secondaryClass} onClick={() => getBillingLink("portal")}>Manage billing</button>}
            <button type="button" disabled={busy} className={secondaryClass} onClick={() => void run(refreshPlan)}>Refresh plan</button>
            <button type="button" disabled={busy} className={secondaryClass} onClick={() => void run(async () => {
              const response = await auth.signOut({ scope: "local" });
              if (response.error) throw response.error;
              setBillingLink(null);
              setMode("sign-in");
            })}>Sign out</button>
          </div>
          {billingLink?.accountId === session.user.id && (
            <div className="space-y-2">
              <a className={primaryClass} href={billingLink.url} target="_blank" rel="noopener noreferrer">
                {billingLink.action === "portal" ? "Open billing portal" : "Open secure checkout"}
              </a>
              {billingLink.action === "checkout" && <p className="text-sm text-zinc-400">Return here after checkout and refresh your plan. Pro appears once the payment provider confirms your subscription.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SubscriptionPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Account &amp; Plans</h1>
        <p className="text-sm text-zinc-400">Create and export local clips for free. Sign in to manage your account and subscription.</p>
      </header>
      <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-5 sm:p-6" aria-label="Account">
        <AccountPanel />
      </section>
      <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-5 sm:p-6">
        <h2 className="mb-3 font-semibold">Compare plans</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-400"><tr><th scope="col" className="py-2">Feature</th><th scope="col">Free</th><th scope="col">Pro</th></tr></thead>
          <tbody>{PLAN_FEATURES.map(([feature, free, pro]) => (
            <tr key={feature} className="border-t border-zinc-800"><th scope="row" className="py-3 pr-3 font-medium">{feature}</th><td className="pr-3 text-zinc-300">{free}</td><td className="text-emerald-300">{pro}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </main>
  );
}
