"use client";

import { isTauri } from "@tauri-apps/api/core";
import { isAuthError } from "@supabase/supabase-js";
import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { accountClient, billingRequest, verifyEmailCallback } from "@/src/lib/account";
import { PLAN_FEATURES, useSubscription } from "@/src/lib/subscription-context";

const inputClass = "mt-1 w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3.5 py-2.5 text-sm text-[#f4f4f5] focus-ring";
const primaryClass = "inline-flex min-h-[40px] items-center justify-center rounded-xl bg-[#10b981] hover:bg-[#059669] px-4 py-2 text-xs font-bold text-zinc-950 transition-colors focus-ring cursor-pointer disabled:opacity-50";
const secondaryClass = "inline-flex min-h-[40px] items-center justify-center rounded-xl border border-zinc-700 bg-[#18181c] hover:bg-[#202026] px-4 py-2 text-xs font-medium text-zinc-200 transition-colors focus-ring cursor-pointer disabled:opacity-50";
const accountPageUrl = process.env.NEXT_PUBLIC_CLIPROBIN_ACCOUNT_URL;
const oauthProviders = [
  { id: "github", label: "GitHub", enabled: process.env.NEXT_PUBLIC_CLIPROBIN_GITHUB_AUTH === "1" },
  { id: "google", label: "Google", enabled: process.env.NEXT_PUBLIC_CLIPROBIN_GOOGLE_AUTH === "1" },
] as const;

type AuthMode = "sign-in" | "sign-up" | "reset";

function AccountPanel() {
  const { authReady, session, recovering, setRecovering, emailCallback, setEmailCallback, callbackError,
    setCallbackError, plan, planError, refreshPlan } = useSubscription();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [billingLink, setBillingLink] = useState<{ accountId: string; url: string; action: "checkout" | "portal"; attemptId?: string } | null>(null);
  const [desktop] = useState(() => typeof window !== "undefined" && isTauri());
  const watchingCheckout = Boolean(plan?.checkoutState);

  useEffect(() => {
    if (!watchingCheckout) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPlan();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [refreshPlan, watchingCheckout]);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setMessage(null);
    setCallbackError(null);
    setPassword("");
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      if (isAuthError(err) && err.code === "over_email_send_rate_limit") {
        setError("Too many account emails were sent. Check for the latest email or try again in a few minutes.");
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
    return accountPageUrl || (desktop ? undefined : window.location.origin + window.location.pathname);
  }

  function openInBrowser(event: MouseEvent<HTMLAnchorElement>) {
    if (!desktop) return;
    event.preventDefault();
    const url = event.currentTarget.href;
    void run(async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      try {
        await openUrl(url);
      } catch {
        throw new Error("Clip Robin couldn’t open your browser. Copy the link and open it in your browser.");
      }
    });
  }

  function confirmEmailLink() {
    if (!emailCallback) return;
    void run(async () => {
      const verifiedSession = await verifyEmailCallback(emailCallback);
      if (!verifiedSession) return;
      setEmailCallback(null);
      changeMode("sign-in");
      if (emailCallback.type === "recovery") setRecovering(verifiedSession.user.id);
      else {
        setRecovering();
        setMessage("Email confirmed. You can also sign in on your other devices.");
      }
    });
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
        setRecovering();
        setMessage("Password updated.");
      } else if (mode === "reset") {
        const response = await auth.resetPasswordForEmail(email.trim(), { redirectTo: confirmationRedirect() });
        if (response.error) throw response.error;
        setMessage("If an account exists, a reset link has been sent. Check your inbox and spam.");
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
      const response = await auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin + window.location.pathname } });
      if (response.error) throw response.error;
    });
  }

  function getBillingLink(action: "checkout" | "portal") {
    if (!session) return;
    setBillingLink(null);
    void run(async () => {
      const result = await billingRequest<{ url?: string; attemptId?: string; state?: "pending" | "preparing" | "active" }>(action, session.access_token);
      if (result.state) {
        await refreshPlan();
        if (result.state === "preparing") setMessage("Checkout is being prepared. Try again in a moment.");
        return;
      }
      if (!result.url) throw new Error("The billing service did not return a link. Try again shortly.");
      const url = new URL(result.url);
      const origin = plan?.testMode ? "https://sandbox.polar.sh" : "https://polar.sh";
      if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) {
        throw new Error("Checkout returned an invalid link.");
      }
      setBillingLink({ accountId: session.user.id, url: url.href, action, attemptId: result.attemptId });
      if (action === "checkout") void refreshPlan();
    });
  }

  const auth = accountClient?.auth;
  if (!auth) return <p className="text-sm text-zinc-300">Account sign-in is unavailable in this build. You can still create and export clips on the Free plan.</p>;
  if (!authReady) return <p role="status" className="text-sm text-zinc-300">Checking sign-in…</p>;

  const accountForm = !session || recovering || (!desktop && mode === "reset");
  const credits = plan?.hookCredits;
  const usableCredits = credits?.availableNow ?? credits?.remaining;
  const showBillingLink = billingLink?.accountId === session?.user.id && (billingLink?.action === "portal"
    ? plan?.portalAvailable
    : plan?.checkoutAvailable && (billingLink?.attemptId
      ? plan.checkoutState === "open" && billingLink.attemptId === plan.checkoutAttempt
      : plan.checkoutState === undefined));
  return (
    <div className="space-y-4">
      {callbackError && <p role="alert" className="text-sm text-red-300">{callbackError}</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-300">{message}</p>}
      {emailCallback ? (
        <div className="space-y-3">
          <h2 className="font-semibold">{emailCallback.type === "recovery" ? "Confirm password reset" : "Confirm your Clip Robin email"}</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={primaryClass} onClick={confirmEmailLink}>
              {busy ? "Checking link…" : emailCallback.type === "recovery" ? "Continue to reset password" : "Confirm email"}
            </button>
            <button type="button" disabled={busy} className={secondaryClass} onClick={() => {
              setEmailCallback(null);
              changeMode(emailCallback.type === "recovery" ? "reset" : "sign-in");
            }}>{emailCallback.type === "recovery" ? "Request a new reset link" : "Back to sign-in"}</button>
          </div>
        </div>
      ) : accountForm ? (
        <>
          <form className="max-w-md space-y-4" onSubmit={submit}>
            <h2 className="font-semibold">{recovering ? "Choose a new password" : mode === "sign-up" ? "Create a free account" : mode === "reset" ? "Reset your password" : "Sign in with email"}</h2>
            {!recovering && (mode === "sign-in" || mode === "sign-up") && (
              <>
                {!desktop && oauthProviders.some((provider) => provider.enabled) && (
                  <div className="space-y-3">
                    <div className="flex flex-col gap-2">
                      {oauthProviders.filter((provider) => provider.enabled).map((provider) => (
                        <button
                          key={provider.id}
                          type="button"
                          disabled={busy}
                          onClick={() => socialSignIn(provider.id)}
                          className="min-h-[42px] w-full inline-flex items-center justify-center gap-2.5 rounded-xl border border-zinc-700 bg-[#18181c] hover:bg-[#202026] px-4 py-2 text-xs font-semibold text-[#f4f4f5] transition-colors focus-ring cursor-pointer disabled:opacity-50"
                        >
                          {provider.id === "google" ? (
                            <svg className="size-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                              <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65z" />
                              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.94-2.91l-3.87-3c-1.07.72-2.44 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.1A12 12 0 0 0 12 24z" />
                              <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.62H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.38l4-3.1z" />
                              <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.1C6.22 6.87 8.87 4.76 12 4.76z" />
                            </svg>
                          ) : null}
                          <span>Continue with {provider.label}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span className="h-px flex-1 bg-zinc-800" />
                      <span>or with email</span>
                      <span className="h-px flex-1 bg-zinc-800" />
                    </div>
                  </div>
                )}
                {desktop && accountPageUrl && oauthProviders.some((provider) => provider.enabled) && (
                  <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] p-3 space-y-2">
                    <p className="text-xs text-zinc-400">
                      Create or manage your account with Google in your browser, then sign in here with your email and password.
                    </p>
                    <a
                      href={accountPageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={secondaryClass}
                      onClick={openInBrowser}
                    >
                      Continue with Google in browser
                    </a>
                  </div>
                )}
              </>
            )}
            {!recovering && <label className="block text-sm">Email<input className={inputClass} required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
            {(recovering || mode !== "reset") && (
              <label className="block text-sm">Password<input className={inputClass} required minLength={recovering || mode === "sign-up" ? 8 : undefined} type="password" autoComplete={recovering || mode === "sign-up" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className={primaryClass}>
                {busy ? "Please wait…" : recovering ? "Save password" : mode === "sign-up" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}
              </button>
              {!recovering && (
                <button type="button" disabled={busy} className={secondaryClass} onClick={() => changeMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
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
              {desktop ? accountPageUrl && <a href={accountPageUrl} target="_blank" rel="noopener noreferrer" className={secondaryClass} onClick={openInBrowser}>Reset password in browser</a> : (
                <button type="button" disabled={busy} className={secondaryClass} onClick={() => changeMode("reset")}>Forgot password?</button>
              )}
            </div>
          )}
          {desktop && !accountPageUrl && !recovering && mode === "sign-in" && (
            <p className="text-sm text-zinc-400">Password reset is unavailable in this build.</p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-300">Signed in as {session.user.email}</p>
          <p role="status" className="text-sm font-semibold">
            {planError ? "Could not verify your plan. Free features are available." : !plan ? "Checking your plan…" : plan.tier === "pro" ? (plan.testMode ? "Test Pro is active" : "Pro is active") : "Free plan"}
            {plan?.status === "cancelled" && plan.activeUntil && ` until ${new Date(plan.activeUntil).toLocaleDateString()}`}
          </p>
          {planError && <p role="alert" className="text-sm text-red-300">{planError}</p>}
          {credits && (
            <div className="space-y-1 text-sm text-zinc-300">
              <p>{credits.remaining} of {credits.monthly} Gemini Hook Finder credits left.
                {plan?.status === "cancelled" ? "" : ` Credits reset on ${new Date(credits.resetsAt).toLocaleDateString()}.`}</p>
              {usableCredits !== undefined && usableCredits < credits.remaining && (
                <p className="text-amber-300">{usableCredits === 0
                  ? "Included Hook Finder has reached a spending limit and is temporarily unavailable."
                  : `A spending limit currently allows ${usableCredits} of your remaining credits to be used.`}
                  {" "}You can use Fast Interval or add your own Gemini key in Settings.</p>
              )}
            </div>
          )}
          {plan?.tier === "pro" && !credits && (
            <p className="text-sm text-amber-300">Included Hook Finder credits are temporarily unavailable. You can use Fast Interval or add your own Gemini key in Settings.</p>
          )}
          {plan?.checkoutState === "pending" && (
            <p role="status" className="text-sm text-amber-300">We’re checking your checkout with Polar. This page updates automatically. If you received a receipt and your plan still says Free, use the support contact on your receipt.</p>
          )}
          {plan && plan.tier === "free" && plan.checkoutUnavailableReason !== "subscription" && plan.checkoutState !== "pending" && (
            <div className="space-y-3 rounded-xl border border-zinc-700 p-4">
              <h2 className="font-semibold">Clip Robin Pro <span className="ml-2 text-sm font-normal text-zinc-300">$12/month</span></h2>
              <p className="text-sm text-zinc-300">20 Gemini Hook Finder credits per billing cycle, watermark-free exports, custom logos, and all caption styles.</p>
              <button type="button" disabled={busy || !plan.checkoutAvailable} className={primaryClass}
                aria-describedby={plan.checkoutAvailable ? undefined : "checkout-unavailable"} onClick={() => getBillingLink("checkout")}>
                {plan.checkoutState === "open" ? "Resume checkout" : plan.testMode && plan.checkoutAvailable ? "Test Pro checkout" : "Upgrade to Pro"}
              </button>
              {!plan.checkoutAvailable && (
                <p id="checkout-unavailable" className="text-sm text-zinc-400">{plan.checkoutState === "preparing"
                  ? "Checkout is being prepared. This page will check again shortly."
                  : plan.checkoutUnavailableReason === "sandbox_access"
                    ? "Checkout is in testing and available to the designated test account. Your Free plan is active."
                    : plan.checkoutUnavailableReason === "capacity"
                      ? "New Pro subscriptions are paused while we increase Hook Finder capacity. Your Free plan is active."
                      : "Upgrades open once payment setup is complete. Your Free plan is active."}</p>
              )}
              {plan.testMode && plan.checkoutAvailable && <p className="text-sm text-amber-300">Polar Sandbox accepts test payment details.</p>}
            </div>
          )}
          {plan?.tier === "free" && plan.checkoutUnavailableReason === "subscription" && (
            <p className="text-sm text-zinc-300">{plan.status === "refunded"
              ? "Pro access and included credits have ended for this refunded billing period. Use Manage billing to review your subscription."
              : "Manage your existing subscription to restore access to Pro."}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {plan?.portalAvailable && <button type="button" disabled={busy} className={secondaryClass} onClick={() => getBillingLink("portal")}>Manage billing</button>}
            <button type="button" disabled={busy} className={secondaryClass} onClick={() => void run(refreshPlan)}>Refresh plan</button>
            {!desktop && <button type="button" disabled={busy} className={secondaryClass} onClick={() => changeMode("reset")}>Reset password</button>}
            <button type="button" disabled={busy} className={secondaryClass} onClick={() => void run(async () => {
              const response = await auth.signOut({ scope: "local" });
              if (response.error) throw response.error;
              setBillingLink(null);
              setMode("sign-in");
            })}>Sign out</button>
          </div>
          {showBillingLink && billingLink && (
            <div className="space-y-2">
              <a className={primaryClass} href={billingLink.url} target="_blank" rel="noopener noreferrer" onClick={openInBrowser}>
                {billingLink.action === "portal" ? "Open billing portal" : "Open secure checkout"}
              </a>
              {billingLink.action === "checkout" && <p className="text-sm text-zinc-400">Return here after checkout. Your plan updates when Polar confirms your subscription.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SubscriptionPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8 xl:p-10">
      <header className="space-y-1 pb-6 border-b border-zinc-800/80">
        <h1 className="text-2xl font-bold tracking-tight text-[#f4f4f5]">Account &amp; Plans</h1>
        <p className="text-sm text-zinc-400">Create and export local clips for free. Sign in to manage your account and Pro subscription.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_1fr] gap-6 items-start">
        <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm" aria-label="Account">
          <AccountPanel />
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[#f4f4f5]">Free vs Pro</h2>
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 font-semibold text-emerald-300">
                Free · $0
              </span>
              <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-0.5 font-semibold text-amber-300">
                Pro · $12/month
              </span>
            </div>
          </div>

          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="text-zinc-400">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Feature</th>
                <th scope="col" className="py-2 pr-3 font-medium">Free</th>
                <th scope="col" className="py-2 font-medium text-amber-300">Pro</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_FEATURES.map(([feature, free, pro]) => (
                <tr key={feature} className="border-t border-zinc-800">
                  <th scope="row" className="py-3 pr-3 font-medium text-[#f4f4f5]">{feature}</th>
                  <td className="py-3 pr-3 text-zinc-400">{free}</td>
                  <td className="py-3 text-emerald-300 font-medium">{pro}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-xs text-zinc-400">
            Hook Finder uses 1 credit per started 30 minutes of source video. Local clipping and exports have no monthly video quota.
          </p>
        </section>
      </div>
    </main>
  );
}
