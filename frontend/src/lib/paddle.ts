"use client";

import { initializePaddle, Paddle } from "@paddle/paddle-js";

export interface PaddleConfig {
  clientToken: string;
  environment: "sandbox" | "production";
  monthlyPriceId: string;
  yearlyPriceId: string;
  lifetimePriceId: string;
  webhookSecret?: string;
}

const STORAGE_KEY = "cliprobin_paddle_config";

export const DEFAULT_PADDLE_CONFIG: PaddleConfig = {
  clientToken: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN || "",
  environment: "sandbox",
  monthlyPriceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_MONTHLY || "",
  yearlyPriceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_YEARLY || "",
  lifetimePriceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_LIFETIME || "",
};

let paddleInstance: Paddle | null = null;
let initPromise: Promise<Paddle | null> | null = null;
let activeCheckoutCallbacks: {
  onSuccess?: (transactionId: string) => void;
  onClose?: () => void;
} | null = null;

export function getPaddleConfig(): PaddleConfig {
  if (typeof window === "undefined") return DEFAULT_PADDLE_CONFIG;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_PADDLE_CONFIG, ...JSON.parse(saved) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_PADDLE_CONFIG;
}

export function savePaddleConfig(config: Partial<PaddleConfig>): PaddleConfig {
  const current = getPaddleConfig();
  const next = { ...current, ...config };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  // Reset paddle instance so it reinitializes with new token
  paddleInstance = null;
  initPromise = null;
  return next;
}

export async function getPaddleInstance(): Promise<Paddle | null> {
  if (paddleInstance) return paddleInstance;
  if (initPromise) return initPromise;

  const config = getPaddleConfig();
  const token = config.clientToken.trim();

  if (!token) {
    return null;
  }

  initPromise = (async () => {
    try {
      const p = await initializePaddle({
        environment: config.environment,
        token: token,
        eventCallback: (event) => {
          if (!event || !activeCheckoutCallbacks) return;
          if (event.name === "checkout.completed") {
            const data = event.data as { transaction_id?: string; id?: string } | undefined;
            const txnId =
              data?.transaction_id ||
              data?.id ||
              `txn_${Math.random().toString(36).substring(2, 10)}`;
            const cb = activeCheckoutCallbacks.onSuccess;
            activeCheckoutCallbacks = null;
            cb?.(txnId);
          } else if (event.name === "checkout.closed") {
            const cb = activeCheckoutCallbacks.onClose;
            activeCheckoutCallbacks = null;
            cb?.();
          }
        },
      });
      paddleInstance = p || null;
      return paddleInstance;
    } catch (err) {
      console.warn("Failed to initialize Paddle SDK:", err);
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

export interface CheckoutOptions {
  planType: "monthly" | "yearly" | "lifetime";
  userEmail?: string;
  onSuccess?: (transactionId: string) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

export async function openPaddleCheckout(options: CheckoutOptions): Promise<boolean> {
  const config = getPaddleConfig();
  const priceId =
    options.planType === "monthly"
      ? config.monthlyPriceId
      : options.planType === "yearly"
      ? config.yearlyPriceId
      : config.lifetimePriceId;

  const paddle = await getPaddleInstance();

  // If Paddle SDK is loaded and we have a valid priceId, open native Paddle Checkout overlay
  if (paddle && priceId.trim()) {
    try {
      activeCheckoutCallbacks = {
        onSuccess: options.onSuccess,
        onClose: options.onClose,
      };
      paddle.Checkout.open({
        items: [{ priceId: priceId.trim(), quantity: 1 }],
        customer: options.userEmail ? { email: options.userEmail } : undefined,
        settings: {
          displayMode: "overlay",
          theme: "dark",
          locale: "en",
        },
      });
      return true;
    } catch (err) {
      activeCheckoutCallbacks = null;
      console.error("Paddle checkout open error:", err);
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  return false;
}
