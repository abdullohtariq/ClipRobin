"use client";

import React, { useState, useEffect } from "react";
import { getPaddleConfig, savePaddleConfig, PaddleConfig, openPaddleCheckout } from "@/src/lib/paddle";
import { useSubscription } from "@/src/lib/subscription-context";

export interface PaddleSandboxModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PaddleSandboxModal({ isOpen, onClose }: PaddleSandboxModalProps) {
  const { upgradeToPro } = useSubscription();
  const [config, setConfig] = useState<PaddleConfig>(getPaddleConfig());
  const [isSaved, setIsSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setConfig(getPaddleConfig());
      setIsSaved(false);
      setTestStatus(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    savePaddleConfig(config);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const handleSimulateSandboxPurchase = async (plan: "monthly" | "yearly" | "lifetime") => {
    setTestStatus(`Initiating Paddle Sandbox checkout for ${plan}...`);
    // Attempt real Paddle SDK checkout if configured
    const opened = await openPaddleCheckout({
      planType: plan,
      userEmail: "creator@cliprobin.test",
      onSuccess: (txnId) => {
        upgradeToPro(`ROBIN-PRO-${txnId.toUpperCase()}`);
        setTestStatus("🎉 Paddle Sandbox checkout completed successfully!");
      },
    });

    if (!opened) {
      // If client token or price ID isn't entered yet, simulate completion so developer can test immediately
      await new Promise((r) => setTimeout(r, 600));
      const simulatedTxn = `txn_sbx_${Math.random().toString(36).substring(2, 9)}`;
      await upgradeToPro(`ROBIN-PRO-${simulatedTxn.toUpperCase()}`);
      setTestStatus(
        `🎉 Sandbox Test Checkout Completed (${simulatedTxn})! Clip Robin Pro has been activated.`
      );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paddle-sandbox-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in text-white"
    >
      <div
        className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-700/80 bg-[#121216] p-6 shadow-2xl text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center font-bold text-sm">
              💳
            </div>
            <div>
              <h3 id="paddle-sandbox-title" className="text-base font-bold text-white">
                Paddle Billing Sandbox Setup
              </h3>
              <p className="text-xs text-zinc-400">
                Test subscription checkout without real money or verification
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Quick Guide & Dashboard Links */}
        <div className="mt-4 p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 space-y-2 text-xs">
          <div className="font-bold text-emerald-300 flex items-center gap-1.5">
            <span>🛠️ Paddle Sandbox Steps (Quick Links):</span>
          </div>
          <ol className="list-decimal list-inside space-y-1 text-zinc-300">
            <li>
              <a
                href="https://sandbox-vendors.paddle.com/developer-tools/authentication"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 underline hover:text-emerald-300"
              >
                Get Client-Side Token
              </a>{" "}
              (starts with <code className="text-zinc-200 bg-zinc-900 px-1 rounded">test_...</code>)
            </li>
            <li>
              <a
                href="https://sandbox-vendors.paddle.com/products"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 underline hover:text-emerald-300"
              >
                Create Product &amp; Prices
              </a>{" "}
              (copy <code className="text-zinc-200 bg-zinc-900 px-1 rounded">pri_...</code> IDs)
            </li>
            <li>
              <a
                href="https://sandbox-vendors.paddle.com/notifications"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 underline hover:text-emerald-300"
              >
                Webhook URL
              </a>
              : <code className="text-zinc-200 bg-zinc-900 px-1 rounded">http://127.0.0.1:8000/api/webhooks/paddle</code>
            </li>
          </ol>
        </div>

        {/* Credentials Form */}
        <form onSubmit={handleSave} className="mt-4 space-y-3.5 text-xs">
          <div>
            <label className="block text-zinc-400 font-medium mb-1">
              Paddle Sandbox Client-Side Token
            </label>
            <input
              type="text"
              placeholder="test_xxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={config.clientToken}
              onChange={(e) => setConfig({ ...config, clientToken: e.target.value })}
              className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3 py-2 text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-zinc-400 font-medium mb-1">
                Monthly Price ID
              </label>
              <input
                type="text"
                placeholder="pri_01xxxxxxxx"
                value={config.monthlyPriceId}
                onChange={(e) => setConfig({ ...config, monthlyPriceId: e.target.value })}
                className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3 py-2 text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-zinc-400 font-medium mb-1">
                Yearly Price ID
              </label>
              <input
                type="text"
                placeholder="pri_01xxxxxxxx"
                value={config.yearlyPriceId}
                onChange={(e) => setConfig({ ...config, yearlyPriceId: e.target.value })}
                className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3 py-2 text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-zinc-400 font-medium mb-1">
                Lifetime Price ID
              </label>
              <input
                type="text"
                placeholder="pri_01xxxxxxxx"
                value={config.lifetimePriceId}
                onChange={(e) => setConfig({ ...config, lifetimePriceId: e.target.value })}
                className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0e] px-3 py-2 text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold transition-colors"
            >
              {isSaved ? "✓ Credentials Saved!" : "Save Sandbox Credentials"}
            </button>
          </div>
        </form>

        {/* Sandbox Test Trigger */}
        <div className="mt-5 pt-4 border-t border-zinc-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-300">Test Checkout Simulator:</span>
            <span className="text-[11px] text-zinc-400">Uses test card 4242 4242...</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleSimulateSandboxPurchase("monthly")}
              className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-xs text-zinc-200 transition-colors"
            >
              Test Monthly ($19)
            </button>
            <button
              type="button"
              onClick={() => handleSimulateSandboxPurchase("yearly")}
              className="px-3 py-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-semibold text-emerald-300 transition-colors"
            >
              Test Annual ($12/mo)
            </button>
            <button
              type="button"
              onClick={() => handleSimulateSandboxPurchase("lifetime")}
              className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-xs text-zinc-200 transition-colors"
            >
              Test Lifetime ($79)
            </button>
          </div>

          {testStatus && (
            <div className="mt-2 p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
              {testStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
