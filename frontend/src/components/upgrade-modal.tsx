"use client";

import React, { useState } from "react";
import { useSubscription, PLAN_FEATURES } from "@/src/lib/subscription-context";
import { PaddleSandboxModal } from "./paddle-sandbox-modal";
import { openPaddleCheckout } from "@/src/lib/paddle";

export function UpgradeModal() {
  const {
    isPro,
    upgradeModalOpen,
    upgradeReason,
    closeUpgradeModal,
    upgradeToPro,
    downgradeToFree,
  } = useSubscription();

  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly" | "lifetime">("yearly");
  const [licenseInput, setLicenseInput] = useState("");
  const [showLicenseField, setShowLicenseField] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [activationSuccess, setActivationSuccess] = useState(false);
  const [isPaddleModalOpen, setIsPaddleModalOpen] = useState(false);

  if (!upgradeModalOpen) return null;

  const handleInstantUpgrade = async () => {
    setIsUpgrading(true);
    const opened = await openPaddleCheckout({
      planType: billingCycle,
      userEmail: "creator@cliprobin.test",
      onSuccess: (txnId) => {
        upgradeToPro(`ROBIN-PRO-${txnId.toUpperCase()}`);
        setIsUpgrading(false);
        setActivationSuccess(true);
        setTimeout(() => {
          setActivationSuccess(false);
          closeUpgradeModal();
        }, 1200);
      },
    });
    if (!opened) {
      await new Promise((r) => setTimeout(r, 400));
      await upgradeToPro();
      setIsUpgrading(false);
      setActivationSuccess(true);
      setTimeout(() => {
        setActivationSuccess(false);
        closeUpgradeModal();
      }, 1200);
    }
  };

  const handleLicenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseInput.trim()) return;
    setIsUpgrading(true);
    await new Promise((r) => setTimeout(r, 400));
    await upgradeToPro(licenseInput.trim());
    setIsUpgrading(false);
    setActivationSuccess(true);
    setTimeout(() => {
      setActivationSuccess(false);
      closeUpgradeModal();
    }, 1200);
  };

  const pricing: Record<"monthly" | "yearly" | "lifetime", { price: string; period: string; note: string; badge?: string }> = {
    monthly: { price: "$19", period: "/ month", note: "Billed monthly, cancel anytime" },
    yearly: { price: "$12", period: "/ month", note: "$144 billed annually (Save 36%)", badge: "Most Popular" },
    lifetime: { price: "$79", period: "one-time", note: "Lifetime updates & local license", badge: "Best Value" },
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-fade-in"
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-700/80 bg-[#121216] p-6 sm:p-8 shadow-2xl shadow-emerald-950/20 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={closeUpgradeModal}
          className="absolute top-4 right-4 p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-colors cursor-pointer"
          aria-label="Close dialog"
        >
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header with Icon */}
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-xl shadow-inner shrink-0">
            ✦
          </div>
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
              Clip Robin Pro
            </div>
            <h2 id="upgrade-modal-title" className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Supercharge Your Video Clipping
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400">
              Unlock Gemini AI hooks, unlimited subtitle styles, and custom brand watermarks.
            </p>
          </div>
        </div>

        {/* Reason Alert (if triggered by a specific feature) */}
        {upgradeReason && (
          <div className="mt-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center gap-3">
            <div className="size-7 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 text-xs shrink-0">
              🔒
            </div>
            <div className="text-xs">
              <span className="font-semibold text-amber-200">{upgradeReason} is a Pro Feature. </span>
              <span className="text-amber-300/80">Upgrade your plan below to unlock instant access.</span>
            </div>
          </div>
        )}

        {/* Billing cycle toggle */}
        <div className="mt-6 flex items-center justify-center">
          <div className="inline-flex rounded-xl bg-zinc-900/90 p-1 border border-zinc-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setBillingCycle("monthly")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                billingCycle === "monthly"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle("yearly")}
              className={`relative px-3 py-1.5 rounded-lg transition-all ${
                billingCycle === "yearly"
                  ? "bg-emerald-500 text-zinc-950 font-bold shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Annual (Save 36%)
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle("lifetime")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                billingCycle === "lifetime"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Lifetime License
            </button>
          </div>
        </div>

        {/* Pricing Banner */}
        <div className="mt-5 rounded-2xl border-2 border-emerald-500/50 bg-gradient-to-b from-emerald-950/30 to-zinc-900/60 p-5 relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-white tracking-tight">
                  {pricing[billingCycle].price}
                </span>
                <span className="text-xs font-medium text-zinc-400">
                  {pricing[billingCycle].period}
                </span>
                {pricing[billingCycle].badge && (
                  <span className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-bold text-emerald-300">
                    {pricing[billingCycle].badge}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-400">{pricing[billingCycle].note}</p>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={handleInstantUpgrade}
                disabled={isUpgrading || isPro}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 text-zinc-950 font-bold text-xs sm:text-sm transition-all duration-150 shadow-lg shadow-emerald-500/20 hover:scale-[1.02] cursor-pointer flex items-center justify-center gap-2"
              >
                {isUpgrading ? (
                  <span>Activating Pro...</span>
                ) : isPro ? (
                  <span>✓ Pro Plan Active</span>
                ) : (
                  <span>Upgrade to Pro Now</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Success toast inside modal */}
        {activationSuccess && (
          <div className="mt-3 p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold text-center animate-fade-in">
            🎉 Clip Robin Pro successfully activated! Enjoy AI hooks, custom watermarks, and all subtitle styles!
          </div>
        )}

        {/* Feature Comparison Table */}
        <div className="mt-6 border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/40">
          <div className="grid grid-cols-12 bg-zinc-900/70 p-3 border-b border-zinc-800 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
            <div className="col-span-6 sm:col-span-7">Capability</div>
            <div className="col-span-3 sm:col-span-2 text-center">Free</div>
            <div className="col-span-3 text-center text-emerald-400">Pro</div>
          </div>

          <div className="divide-y divide-zinc-800/60 text-xs">
            {PLAN_FEATURES.map((feature, idx) => (
              <div
                key={idx}
                className={`grid grid-cols-12 p-3 items-center ${
                  feature.highlight ? "bg-emerald-500/[0.02]" : ""
                }`}
              >
                <div className="col-span-6 sm:col-span-7 font-medium text-zinc-200">
                  {feature.name}
                </div>
                <div className="col-span-3 sm:col-span-2 text-center text-zinc-500">
                  {typeof feature.free === "boolean" ? (
                    feature.free ? (
                      <span className="text-zinc-400">✓</span>
                    ) : (
                      <span className="text-zinc-600">✕</span>
                    )
                  ) : (
                    <span className="text-[11px] text-zinc-400">{feature.free}</span>
                  )}
                </div>
                <div className="col-span-3 text-center text-emerald-400 font-semibold">
                  {typeof feature.pro === "boolean" ? (
                    feature.pro ? (
                      <span>✓</span>
                    ) : (
                      <span>✕</span>
                    )
                  ) : (
                    <span className="text-[11px] text-emerald-300">{feature.pro}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alternative: Enter License Key or Downgrade (for testing) */}
        <div className="mt-6 pt-4 border-t border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          {!showLicenseField ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowLicenseField(true)}
                className="text-zinc-400 hover:text-zinc-200 underline cursor-pointer text-left"
              >
                Have a license key? Enter key
              </button>
              <span className="text-zinc-700">•</span>
              <button
                type="button"
                onClick={() => setIsPaddleModalOpen(true)}
                className="text-emerald-400 hover:text-emerald-300 underline cursor-pointer text-left"
              >
                💳 Paddle Sandbox Config
              </button>
            </div>
          ) : (
            <form onSubmit={handleLicenseSubmit} className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="text"
                placeholder="ROBIN-PRO-XXXX"
                value={licenseInput}
                onChange={(e) => setLicenseInput(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-white uppercase placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs"
              >
                Activate
              </button>
            </form>
          )}

          {isPro && (
            <button
              type="button"
              onClick={downgradeToFree}
              className="text-zinc-500 hover:text-rose-400 text-xs transition-colors cursor-pointer text-left sm:text-right"
            >
              Downgrade to Free (Testing)
            </button>
          )}
        </div>
      </div>
      <PaddleSandboxModal isOpen={isPaddleModalOpen} onClose={() => setIsPaddleModalOpen(false)} />
    </div>
  );
}
