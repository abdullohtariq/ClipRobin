import { accountIdFrom, checkoutClaim, checkoutUrl, sign, subscriptionExpiry, validSignature } from "./protocol.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const lemonKey = Deno.env.get("LEMON_SQUEEZY_API_KEY") ?? "";
const webhookSecret = Deno.env.get("LEMON_SQUEEZY_WEBHOOK_SECRET") ?? "";
const claimSecret = Deno.env.get("CLIPROBIN_CHECKOUT_SECRET") ?? "";
const storeId = Deno.env.get("LEMON_SQUEEZY_STORE_ID") ?? "";
const variantId = Deno.env.get("LEMON_SQUEEZY_VARIANT_ID") ?? "";
const testMode = Deno.env.get("LEMON_SQUEEZY_MODE") !== "live";
const configured = Boolean(lemonKey && webhookSecret && claimSecret.length >= 32 && /^\d+$/.test(storeId) && /^\d+$/.test(variantId));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

type Subscription = { provider_id: string; status: string; active_until: string | null };

function json(data: object, status = 200) {
  return Response.json(data, { status, headers: cors });
}

async function db(path: string, body?: object) {
  const result = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!result.ok) throw new Error(`Billing database HTTP ${result.status}`);
  return result.status === 204 ? null : result.json();
}

async function lemon(path: string, body?: object) {
  const result = await fetch(`https://api.lemonsqueezy.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${lemonKey}`,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  if (!result.ok) throw new Error(`Billing provider HTTP ${result.status}`);
  return (await result.json()).data;
}

async function handleWebhook(request: Request) {
  if (!configured) return json({ error: "Billing is not configured" }, 503);
  if (Number(request.headers.get("content-length")) > 256_000) return json({ error: "Payload too large" }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength > 256_000) return json({ error: "Payload too large" }, 413);
  if (!await validSignature(webhookSecret, body, request.headers.get("x-signature"))) {
    return json({ error: "Invalid webhook signature" }, 401);
  }

  const event = JSON.parse(new TextDecoder().decode(body));
  const eventName = event?.meta?.event_name;
  const id = event?.data?.id;
  if (typeof eventName !== "string" || !eventName.startsWith("subscription_") || event?.data?.type !== "subscriptions" ||
      typeof id !== "string" || !/^\d+$/.test(id)) return json({ received: true });
  const delivered = event.data.attributes;
  if (String(delivered?.store_id) !== storeId || delivered?.test_mode !== testMode) return json({ received: true });

  const custom = event.meta?.custom_data;
  const claimedAccount = accountIdFrom(custom?.account_id);
  const owner = claimedAccount && await validSignature(
    claimSecret, checkoutClaim(claimedAccount, storeId, testMode), custom?.account_claim,
  ) ? claimedAccount : null;

  // Read the current provider state so late or reordered webhook deliveries cannot grant stale access.
  const subscription = await lemon(`subscriptions/${id}`);
  const attributes = subscription?.attributes;
  if (subscription?.id !== id || String(attributes?.store_id) !== storeId || attributes?.test_mode !== testMode) {
    return json({ received: true });
  }
  const status = String(attributes.variant_id) === variantId ? attributes.status : "unsupported_variant";
  if (typeof status !== "string" || !Number.isFinite(Date.parse(attributes.updated_at))) {
    throw new Error("Incomplete subscription response");
  }
  await db("rpc/sync_billing_subscription", {
    p_provider_id: id,
    p_user_id: owner,
    p_test_mode: testMode,
    p_status: status,
    p_active_until: subscriptionExpiry(status, attributes),
    p_updated_at: attributes.updated_at,
  });
  return json({ received: true });
}

async function handleAccount(request: Request) {
  const token = request.headers.get("authorization");
  if (!token?.startsWith("Bearer ")) return json({ error: "Sign in first" }, 401);
  const auth = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: token },
    signal: AbortSignal.timeout(8000),
  });
  if (auth.status === 401 || auth.status === 403) return json({ error: "Sign in again" }, 401);
  if (!auth.ok) throw new Error(`Account service HTTP ${auth.status}`);
  const user = await auth.json();
  const accountId = accountIdFrom(user?.id);
  if (!accountId) return json({ error: "Sign in again" }, 401);

  const action = (await request.json())?.action;
  if (action !== "plan" && action !== "portal" && action !== "checkout") return json({ error: "Unknown billing action" }, 400);
  const query = new URLSearchParams({
    user_id: `eq.${accountId}`,
    test_mode: `eq.${testMode}`,
    select: "provider_id,status,active_until",
    order: "provider_updated_at.desc",
  });
  const subscriptions: Subscription[] = await db(`billing_subscriptions?${query}`);
  const now = Date.now();
  const active = subscriptions.find((item) => item.active_until && Date.parse(item.active_until) > now);
  const manageable = active ?? subscriptions.find((item) => ["active", "on_trial", "past_due", "unpaid", "paused"].includes(item.status));
  if (action === "plan") {
    return json({
      tier: active ? "pro" : "free",
      status: (manageable ?? subscriptions[0])?.status ?? null,
      activeUntil: active?.active_until ?? null,
      checkoutAvailable: configured && !manageable,
      portalAvailable: configured && subscriptions.length > 0,
      testMode,
    });
  }
  if (!configured) return json({ error: "Billing is not configured" }, 503);
  if (action === "portal") {
    const item = manageable ?? subscriptions[0];
    if (!item) return json({ error: "No subscription found" }, 404);
    const subscription = await lemon(`subscriptions/${item.provider_id}`);
    if (String(subscription?.attributes?.store_id) !== storeId || subscription?.attributes?.test_mode !== testMode) {
      return json({ error: "Subscription unavailable" }, 404);
    }
    return json({ url: checkoutUrl(subscription.attributes.urls?.customer_portal) });
  }
  if (manageable) return json({ error: "Manage your existing subscription first" }, 409);

  const attempt = { p_user_id: accountId, p_test_mode: testMode, p_attempt_id: crypto.randomUUID() };
  const reservation = await db("rpc/reserve_billing_checkout", attempt);
  if (!reservation.reserved) {
    return reservation.url ? json({ url: checkoutUrl(reservation.url) })
      : json({ error: "Checkout is being prepared. Try again in a moment." }, 409);
  }

  const claim = await sign(claimSecret, checkoutClaim(accountId, storeId, testMode));
  const expiresAt = new Date(now + 20 * 60_000).toISOString();
  const checkout = await lemon("checkouts", {
    data: {
      type: "checkouts",
      attributes: {
        test_mode: testMode,
        expires_at: expiresAt,
        product_options: { enabled_variants: [Number(variantId)] },
        checkout_options: { skip_trial: true },
        checkout_data: { email: user.email, custom: { account_id: accountId, account_claim: claim } },
      },
      relationships: {
        store: { data: { type: "stores", id: storeId } },
        variant: { data: { type: "variants", id: variantId } },
      },
    },
  });
  if (checkout?.attributes?.test_mode !== testMode) throw new Error("Unexpected checkout mode");
  const url = checkoutUrl(checkout.attributes.url);
  const completed = await db("rpc/complete_billing_checkout", { ...attempt, p_url: url, p_expires_at: expiresAt });
  return completed ? json({ url }) : json({ error: "Checkout was replaced. Try again." }, 409);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceKey || !publicKey) return json({ error: "Account service is not configured" }, 503);
  try {
    return await (new URL(request.url).pathname.endsWith("/webhook") ? handleWebhook(request) : handleAccount(request));
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON" }, 400);
    console.error("Billing request failed", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "Billing is temporarily unavailable. Try again shortly." }, 503);
  }
});
