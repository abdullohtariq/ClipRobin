const encoder = new TextEncoder();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(secret, bytes) {
  const result = await crypto.subtle.sign("HMAC", await hmacKey(secret), bytes);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validSignature(secret, bytes, signature) {
  if (!secret || typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const digest = Uint8Array.from(signature.match(/../g), (byte) => Number.parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", await hmacKey(secret), digest, bytes);
}

export function checkoutClaim(accountId, storeId, testMode) {
  return encoder.encode(`cliprobin-checkout-v1:${storeId}:${testMode}:${accountId}`);
}

export function accountIdFrom(value) {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

export function subscriptionExpiry(status, attributes) {
  const value = status === "active" ? attributes.renews_at
    : status === "cancelled" ? attributes.ends_at : null;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export function checkoutUrl(value) {
  if (typeof value !== "string") throw new Error("Missing billing URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".lemonsqueezy.com") || url.username || url.password || url.port) {
    throw new Error("Invalid billing URL");
  }
  return url.href;
}
