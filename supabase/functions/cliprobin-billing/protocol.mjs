const encoder = new TextEncoder();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hmacKey(secret) {
  return crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(secret, bytes) {
  const result = await crypto.subtle.sign("HMAC", await hmacKey(encoder.encode(secret)), bytes);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validSignature(secret, bytes, signature) {
  if (!secret || typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const digest = Uint8Array.from(signature.match(/../g), (byte) => Number.parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", await hmacKey(encoder.encode(secret)), digest, bytes);
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function validPolarWebhook(secret, body, headers) {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !/^\d+$/.test(timestamp) || !signatures ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const prefix = encoder.encode(`${id}.${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.byteLength);
  signed.set(prefix);
  signed.set(new Uint8Array(body), prefix.length);
  const key = await hmacKey(fromBase64(secret.slice("whsec_".length)));
  for (const signature of signatures.split(/\s+/)) {
    const match = /^v1,([A-Za-z0-9+/]{43}=)$/.exec(signature);
    if (match && await crypto.subtle.verify("HMAC", key, fromBase64(match[1]), signed)) return true;
  }
  return false;
}

export function checkoutClaim(accountId, productId, testMode = true) {
  return encoder.encode(`cliprobin-polar-${testMode ? "sandbox" : "production"}-v1:${productId}:${accountId}`);
}

export function accountIdFrom(value) {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

export function subscriptionExpiry(status, subscription) {
  if (subscription.ended_at) return null;
  const value = status === "active" ? subscription.ends_at ?? subscription.current_period_end : null;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export function billingUrl(value, testMode = true) {
  if (typeof value !== "string") throw new Error("Missing billing URL");
  const url = new URL(value);
  const origin = testMode ? "https://sandbox.polar.sh" : "https://polar.sh";
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) {
    throw new Error("Invalid billing URL");
  }
  return url.href;
}
