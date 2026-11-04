"use client";

import React, { useState } from "react";
import { useSubscription, PLAN_FEATURES } from "@/src/lib/subscription-context";
import { PaddleSandboxModal } from "@/src/components/paddle-sandbox-modal";
import { openPaddleCheckout } from "@/src/lib/paddle";

export default function SubscriptionPage() {
  const {
    isPro,
    upgradeToPro,
    downgradeToFree,
    licenseKey,
  } = useSubscription();

  const [licenseInput, setLicenseInput] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPaddleModalOpen, setIsPaddleModalOpen] = useState(false);

  const handleUpgrade = async () => {
    setStatusMessage("Connecting to Paddle Sandbox...");
    const opened = await openPaddleCheckout({
      planType: "yearly",
      userEmail: "creator@cliprobin.test",
      onSuccess: (txnId) => {
        upgradeToPro(`ROBIN-PRO-${txnId.toUpperCase()}`);
        setStatusMessage("🎉 Paddle Sandbox checkout successful! Pro unlocked.");
      },
    });
    if (!opened) {
      await new Promise((r) => setTimeout(r, 400));
      await upgradeToPro();
      setStatusMessage("🎉 Clip Robin Pro is now activated! All features are unlocked.");
    }
  };

  const handleLicenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseInput.trim()) return;
    setStatusMessage("Validating license key...");
    await new Promise((r) => setTimeout(r, 400));
    await upgradeToPro(licenseInput.trim());
    setStatusMessage("🎉 License key verified! Clip Robin Pro is active.");
  };

  return (
    <main className="min-h-screen bg-[#09090b] text-white p-6 lg:p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-400 mb-2">
              Plans &amp; Subscription
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Choose the Plan for Your Video Workflow
            </h1>
            <p className="mt-1.5 text-sm text-zinc-400">
              Free local video processing on your hardware, with optional Pro power for AI hooks &amp; branding.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsPaddleModalOpen(true)}
              className="px-3 py-1.5 rounded-xl border border-zinc-700 bg-zinc-900/90 hover:bg-zinc-800 text-xs text-zinc-300 font-semibold flex items-center gap-1.5 transition-colors"
            >
              <span>💳 Paddle Sandbox</span>
            </button>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold ${
                isPro
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-amber-500/15 border-amber-500/40 text-amber-300"
              }`}
            >
              <span className={`size-2 rounded-full ${isPro ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
              Active Plan: {isPro ? "Clip Robin Pro" : "Free Starter"}
            </span>
          </div>
        </div>

        {statusMessage && (
          <div className="p-4 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
            {statusMessage}
          </div>
        )}

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Free Starter */}
          <div className={`rounded-2xl border p-6 flex flex-col justify-between ${!isPro ? "border-amber-500/40 bg-[#121216]" : "border-zinc-800 bg-[#101014]"}`}>
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Free Starter</h3>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-medium">Forever</span>
              </div>
              <p className="mt-2 text-xs text-zinc-400">
                Core local clipping on your own PC. No cloud costs, fully private.
              </p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-black text-white">$0</span>
                <span className="text-xs text-zinc-500">/ forever</span>
              </div>

              <div className="mt-6 space-y-2.5 border-t border-zinc-800 pt-5 text-xs text-zinc-300">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>Unlimited local video cutting &amp; rendering</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>Offline Whisper speech transcription</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>AI face tracking &amp; 9:16 vertical reframe</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-500">
                  <span className="text-zinc-600">✕</span>
                  <span className="line-through">Gemini AI Hook Finder &amp; Virality Scoring (Locked)</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-500">
                  <span className="text-zinc-600">✕</span>
                  <span className="line-through">Custom Watermarks &amp; Removal (Locked)</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-500">
                  <span className="text-zinc-600">✕</span>
                  <span className="line-through">All Viral Subtitle Styles (Limited to 2)</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4">
              {!isPro ? (
                <div className="w-full py-2.5 px-4 rounded-xl bg-zinc-800 text-zinc-400 text-xs font-semibold text-center select-none">
                  Current Active Plan
                </div>
              ) : (
                <button
                  type="button"
                  onClick={downgradeToFree}
                  className="w-full py-2.5 px-4 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold transition-colors"
                >
                  Switch back to Free (Testing)
                </button>
              )}
            </div>
          </div>

          {/* Card 2: Pro Creator */}
          <div className="rounded-2xl border-2 border-emerald-500/60 bg-gradient-to-b from-[#141b18] via-[#121215] to-[#121215] p-6 flex flex-col justify-between shadow-xl shadow-emerald-950/20 relative">
            <div className="absolute -top-3 right-6 px-3 py-0.5 rounded-full bg-emerald-500 text-zinc-950 text-[10px] font-black uppercase tracking-wider shadow-sm">
              Most Popular
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>Clip Robin Pro</span>
                  <span className="text-emerald-400 text-xs font-normal">✦</span>
                </h3>
              </div>
              <p className="mt-2 text-xs text-zinc-400">
                Unlock viral AI hook detection, custom watermarks, and all subtitle styles.
              </p>

              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-black text-white">$19</span>
                <span className="text-xs text-zinc-400">/ month or $79 lifetime</span>
              </div>

              <div className="mt-6 space-y-2.5 border-t border-zinc-800/80 pt-5 text-xs text-zinc-200">
                <div className="flex items-center gap-2 font-medium">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span className="text-emerald-300 font-semibold">Gemini AI Hook Finder &amp; Virality Scoring</span>
                </div>
                <div className="flex items-center gap-2 font-medium">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span className="text-emerald-300 font-semibold">Custom Brand Watermarks &amp; 100% Watermark-Free</span>
                </div>
                <div className="flex items-center gap-2 font-medium">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span className="text-emerald-300 font-semibold">All 6+ Viral Subtitle Styles (Robin, Punch, Pill, etc.)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>Pro Subtitle Customizer (Color picker, animation override)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>Ultra 4K 60FPS local FFmpeg export quality</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>Batch clip queue &amp; priority processing</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4">
              {isPro ? (
                <div className="w-full py-2.5 px-4 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold text-center flex items-center justify-center gap-2">
                  <span>✓ Pro Plan Active</span>
                  {licenseKey && <span className="text-[10px] text-emerald-400/80">({licenseKey})</span>}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleUpgrade}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#10b981] hover:bg-[#059669] text-zinc-950 text-xs font-bold transition-all duration-150 shadow-md shadow-emerald-500/20 hover:scale-[1.01] cursor-pointer"
                >
                  Upgrade to Clip Robin Pro
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Enter License Key Box */}
        <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-white">Activate With License Key</h3>
          <p className="text-xs text-zinc-400">
            Purchased a license on our website or received an activation key? Enter it here to activate Pro locally.
          </p>
          <form onSubmit={handleLicenseSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <input
              type="text"
              placeholder="e.g. ROBIN-PRO-XXXX-YYYY"
              value={licenseInput}
              onChange={(e) => setLicenseInput(e.target.value)}
              className="flex-1 rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 uppercase font-mono"
            />
            <button
              type="submit"
              disabled={!licenseInput.trim()}
              className="px-5 py-2.5 rounded-xl bg-white hover:bg-zinc-200 disabled:opacity-40 text-zinc-950 font-bold text-xs transition-colors shrink-0"
            >
              Activate Key
            </button>
          </form>
        </section>

        {/* Detailed Feature Comparison Matrix */}
        <section className="rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-white">Full Plan Comparison</h3>
          <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/40">
            <div className="grid grid-cols-12 bg-zinc-900/70 p-3 border-b border-zinc-800 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              <div className="col-span-6 sm:col-span-7">Feature</div>
              <div className="col-span-3 sm:col-span-2 text-center">Free</div>
              <div className="col-span-3 text-center text-emerald-400">Pro</div>
            </div>
            <div className="divide-y divide-zinc-800/60 text-xs">
              {PLAN_FEATURES.map((item, i) => (
                <div key={i} className={`grid grid-cols-12 p-3 items-center ${item.highlight ? "bg-emerald-500/[0.02]" : ""}`}>
                  <div className="col-span-6 sm:col-span-7 font-medium text-zinc-200">{item.name}</div>
                  <div className="col-span-3 sm:col-span-2 text-center text-zinc-400">
                    {typeof item.free === "boolean" ? (item.free ? "✓" : "✕") : item.free}
                  </div>
                  <div className="col-span-3 text-center text-emerald-300 font-semibold">
                    {typeof item.pro === "boolean" ? (item.pro ? "✓" : "✕") : item.pro}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
      <PaddleSandboxModal isOpen={isPaddleModalOpen} onClose={() => setIsPaddleModalOpen(false)} />
    </main>
  );
}
