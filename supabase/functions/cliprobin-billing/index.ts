import { accountIdFrom, billingUrl, checkoutClaim, sign, subscriptionExpiry, validPolarWebhook, validSignature } from "./protocol.mjs";
import { generateHooks } from "./hooks.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const polarToken = Deno.env.get("POLAR_ACCESS_TOKEN") ?? "";
const webhookSecret = Deno.env.get("POLAR_WEBHOOK_SECRET") ?? "";
const claimSecret = Deno.env.get("CLIPROBIN_CHECKOUT_SECRET") ?? "";
const organizationId = accountIdFrom(Deno.env.get("POLAR_ORGANIZATION_ID"));
const productId = accountIdFrom(Deno.env.get("POLAR_PRODUCT_ID")) ?? "";
const testAccountId = accountIdFrom(Deno.env.get("CLIPROBIN_BILLING_TEST_USER_ID")) ?? "";
const environment = Deno.env.get("POLAR_ENVIRONMENT") ?? "sandbox";
const testMode = environment === "sandbox";
const geminiKey = Deno.env.get("CLIPROBIN_GEMINI_API_KEY") ?? "";
const budget = Number(Deno.env.get("CLIPROBIN_GEMINI_MONTHLY_BUDGET_CENTS") ?? "0") * 10_000;
const hooksConfigured = Boolean(geminiKey && Number.isInteger(budget) && budget > 0 && budget <= 2_147_483_647);
const checkoutReturnUrl = Deno.env.get("CLIPROBIN_CHECKOUT_RETURN_URL") ?? "";
const configured = Boolean(polarToken && webhookSecret.startsWith("whsec_") && claimSecret.length >= 32 &&
  organizationId && productId && (testMode ? testAccountId : environment === "production"));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

type Subscription = {
  provider_id: string; status: string; active_until: string | null; period_started_at: string | null;
  refunded_period_started_at: string | null;
};
type Checkout = {
  attempt_id: string; user_id: string; url: string | null; provider_checkout_id: string | null;
  checkout_state: "open" | "pending" | null; expires_at: string; check_after: string;
};
type CheckoutState = "open" | "pending" | "preparing" | null;
const manageableStatuses = ["active", "trialing", "past_due", "unpaid", "paused"];

function json(data: object, status = 200) {
  return Response.json(data, { status, headers: cors });
}

async function db(path: string, body?: object, method = body ? "POST" : "GET") {
  const result = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json",
      ...(method === "PATCH" ? { Prefer: "return=representation" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!result.ok) throw new Error(`Billing database HTTP ${result.status}`);
  return result.status === 204 ? null : result.json();
}

async function polar(path: string, body?: object) {
  const host = testMode ? "sandbox-api.polar.sh" : "api.polar.sh";
  const result = await fetch(`https://${host}/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${polarToken}`,
      "Polar-Version": "2026-10",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  if (!result.ok) throw new Error(`Billing provider HTTP ${result.status}`);
  return result.json();
}

function currentPeriodRefund(order: Record<string, unknown>, subscription: Record<string, unknown>) {
  if (order.status !== "refunded" || order.subscription_id !== subscription.id ||
      order.customer_id !== subscription.customer_id || order.product_id !== subscription.product_id) return false;
  const billed = Date.parse(String(order.created_at));
  const start = Date.parse(String(subscription.current_period_start));
  const end = Date.parse(String(subscription.current_period_end));
  if (!Number.isFinite(billed) || !Number.isFinite(start) || !Number.isFinite(end) || billed >= end) return false;
  if (order.billing_reason === "subscription_cycle") return billed >= start;
  // A first invoice may precede activation. Identify it by checkout and the initial billing period.
  const started = Date.parse(String(subscription.started_at));
  return order.billing_reason === "subscription_create" && accountIdFrom(order.checkout_id) !== null &&
    order.checkout_id === subscription.checkout_id && started >= start && started < end;
}

async function syncSubscription(id: string, subscription: Awaited<ReturnType<typeof polar>>, refund?: Record<string, unknown>) {
  const accountId = accountIdFrom(subscription?.customer?.external_id);
  if (subscription?.id !== id || subscription.customer?.organization_id !== organizationId ||
      !accountId || (testMode && accountId !== testAccountId)) {
    return false;
  }
  const status = subscription.product_id === productId ? subscription.status : "unsupported_product";
  const updatedAt = subscription.modified_at ?? subscription.created_at;
  if (typeof status !== "string" || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error("Incomplete subscription response");
  }
  const owner = status !== "unsupported_product" && await validSignature(
    claimSecret, checkoutClaim(accountId, productId, testMode), subscription.metadata?.account_claim,
  ) ? accountId : null;
  const snapshot = {
    p_provider_id: id,
    p_user_id: owner,
    p_test_mode: testMode,
    p_status: status === "active" && subscription.cancel_at_period_end === true ? "cancelled" : status,
    p_active_until: subscriptionExpiry(status, subscription),
    p_updated_at: updatedAt,
    p_period_started_at: Number.isFinite(Date.parse(subscription.current_period_start)) ? subscription.current_period_start : null,
  };
  if (refund) {
    if (!owner || !currentPeriodRefund(refund, subscription)) return false;
    await db("rpc/sync_billing_refund", { ...snapshot, p_order_id: refund.id });
  } else {
    await db("rpc/sync_billing_period", snapshot);
  }
  return Boolean(owner);
}

async function handleWebhook(request: Request) {
  if (!configured) return json({ error: "Billing is not configured" }, 503);
  if (Number(request.headers.get("content-length")) > 256_000) return json({ error: "Payload too large" }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength > 256_000) return json({ error: "Payload too large" }, 413);
  if (!await validPolarWebhook(webhookSecret, body, request.headers)) {
    return json({ error: "Invalid webhook signature" }, 401);
  }

  const event = JSON.parse(new TextDecoder().decode(body));
  const id = accountIdFrom(event?.data?.id);
  if (!id || typeof event?.type !== "string") return json({ received: true });
  // Fetch current state for delayed or reordered events.
  if (event.type.startsWith("subscription.")) {
    const subscription = await polar(`subscriptions/${id}`);
    const verified = await syncSubscription(id, subscription);
    const checkoutId = accountIdFrom(subscription.checkout_id);
    if (verified && checkoutId && subscription.status === "active") {
      await db(`billing_checkout_sessions?test_mode=eq.${testMode}&provider_checkout_id=eq.${checkoutId}`,
        closedCheckout(), "PATCH");
    }
  } else if (event.type === "order.refunded") {
    const order = await polar(`orders/${id}`);
    const subscriptionId = accountIdFrom(order.subscription_id);
    if (order.id === id && order.status === "refunded" && order.product_id === productId && subscriptionId) {
      await syncSubscription(subscriptionId, await polar(`subscriptions/${subscriptionId}`), order);
    }
  }
  return json({ received: true });
}

function checkoutPath(accountId: string) {
  return `billing_checkout_sessions?user_id=eq.${accountId}&test_mode=eq.${testMode}`;
}

function closedCheckout() {
  return { provider_checkout_id: null, checkout_state: null, url: null, expires_at: new Date().toISOString() };
}

function checkoutLink(value: unknown) {
  try {
    return billingUrl(value, testMode);
  } catch {
    return null;
  }
}

function checkoutState(row?: Checkout): CheckoutState {
  if (!row) return null;
  const unexpired = Date.parse(row.expires_at) > Date.now();
  if (row.provider_checkout_id || checkoutLink(row.url)) {
    return row.checkout_state === "open" && unexpired ? "open" : "pending";
  }
  return unexpired ? "preparing" : null;
}

async function reconcileCheckout(row: Checkout) {
  if ((!row.provider_checkout_id && !checkoutLink(row.url)) || Date.parse(row.check_after) > Date.now()) return row;
  const path = `${checkoutPath(row.user_id)}&attempt_id=eq.${row.attempt_id}`;
  const [claimed]: Checkout[] = await db(`${path}&check_after=lte.${new Date().toISOString()}`,
    { check_after: new Date(Date.now() + 15_000).toISOString() }, "PATCH");
  if (!claimed) return row;
  if (!claimed.provider_checkout_id && !checkoutLink(claimed.url)) return claimed;

  let update: object = { checkout_state: "pending" };
  try {
    const query = new URLSearchParams({ organization_id: organizationId!, external_customer_id: row.user_id, product_id: productId, limit: "100" });
    const checkout = claimed.provider_checkout_id ? await polar(`checkouts/${claimed.provider_checkout_id}`)
      : (await polar(`checkouts/?${query}`)).items?.find((item: { url: string }) => checkoutLink(item.url) === checkoutLink(claimed.url));
    const id = accountIdFrom(checkout?.id);
    const belongsToAccount = id && (!claimed.provider_checkout_id || id === claimed.provider_checkout_id) &&
      checkout.external_customer_id === row.user_id &&
      checkout.products?.some((product: { id: string; organization_id: string }) => product.id === productId && product.organization_id === organizationId) &&
      await validSignature(claimSecret, checkoutClaim(row.user_id, productId, testMode), checkout.metadata?.account_claim);
    if (belongsToAccount) {
      update = { ...update, provider_checkout_id: id };
      if (checkout.status === "expired" || checkout.status === "failed") update = closedCheckout();
      if (checkout.status === "open" && Date.parse(checkout.expires_at) > Date.now()) {
        update = { ...update, checkout_state: "open", expires_at: checkout.expires_at };
      }
      const subscriptionId = accountIdFrom(checkout.subscription_id);
      if (checkout.status === "succeeded" && subscriptionId) {
        const subscription = await polar(`subscriptions/${subscriptionId}`);
        if (subscription.checkout_id === id && subscription.customer?.external_id === row.user_id &&
            await syncSubscription(subscriptionId, subscription) && subscription.status !== "incomplete") {
          update = closedCheckout();
        }
      }
    }
  } catch (error) {
    console.error("Checkout status temporarily unavailable", error instanceof Error ? error.name : "UnknownError");
  }
  // Avoid restoring a checkout if a webhook closed it while this request contacted Polar.
  const [updated]: Checkout[] = await db(`${path}&check_after=eq.${encodeURIComponent(claimed.check_after)}&url=not.is.null`, update, "PATCH");
  return updated;
}

async function checkoutHasCapacity() {
  if (testMode) return true;
  const params = { p_monthly_budget_micros: budget };
  if (await db("rpc/billing_checkout_has_capacity", params)) return true;
  const now = new Date().toISOString();
  const rows: Checkout[] = await db(`billing_checkout_sessions?test_mode=eq.${testMode}&expires_at=lte.${now}&check_after=lte.${now}&url=not.is.null&order=check_after.asc&limit=3`);
  if (!rows.length) return false;
  await Promise.all(rows.filter((row) => row.provider_checkout_id || checkoutLink(row.url)).map(reconcileCheckout));
  return await db("rpc/billing_checkout_has_capacity", params);
}

function returnUrls() {
  if (!checkoutReturnUrl) return {};
  const returnUrl = new URL(checkoutReturnUrl);
  if (returnUrl.protocol !== "https:" || returnUrl.username || returnUrl.password || returnUrl.search || returnUrl.hash) {
    throw new Error("Invalid account site URL");
  }
  return { success_url: returnUrl.href, return_url: returnUrl.href };
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

  if (Number(request.headers.get("content-length")) > 1_000_000) return json({ error: "Transcript is too large" }, 413);
  const raw = await request.arrayBuffer();
  if (raw.byteLength > 1_000_000) return json({ error: "Transcript is too large" }, 413);
  const body = JSON.parse(new TextDecoder().decode(raw));
  const action = body?.action;
  if (action !== "plan" && action !== "portal" && action !== "checkout" && action !== "hooks") return json({ error: "Unknown billing action" }, 400);
  if (!configured || (testMode && accountId !== testAccountId)) {
    if (action !== "plan") return json({ error: "Checkout is currently unavailable" }, 503);
    return json({ tier: "free", status: null, activeUntil: null, checkoutAvailable: false, portalAvailable: false,
      testMode, checkoutUnavailableReason: configured ? "sandbox_access" : "setup", hookCredits: null });
  }
  const query = new URLSearchParams({
    user_id: `eq.${accountId}`,
    test_mode: `eq.${testMode}`,
    select: "provider_id,status,active_until,period_started_at,refunded_period_started_at",
    order: "provider_updated_at.desc",
  });
  let row: Checkout | undefined;
  if (action === "plan" || action === "checkout") {
    [row] = await db(checkoutPath(accountId));
    if (row) row = await reconcileCheckout(row);
  }
  const rows: Subscription[] = await db(`billing_subscriptions?${query}`);
  const subscriptions = rows.filter((item) => accountIdFrom(item.provider_id));
  const now = Date.now();
  const withinPeriod = (item: Subscription) => item.active_until && Date.parse(item.active_until) > now &&
    ["active", "cancelled"].includes(item.status) &&
    (!item.period_started_at || Date.parse(item.period_started_at) <= now);
  const refunded = (item: Subscription) => item.refunded_period_started_at && item.refunded_period_started_at === item.period_started_at;
  const active = subscriptions.find((item) => !refunded(item) && withinPeriod(item));
  const manageable = active ?? subscriptions.find((item) => withinPeriod(item) || manageableStatuses.includes(item.status));
  const state = manageable ? null : checkoutState(row);
  const checkoutConfigured = testMode || hooksConfigured;
  if (action === "plan") {
    const hookCredits = hooksConfigured && active?.period_started_at ? {
      monthly: 20,
      ...await db("rpc/billing_hook_availability", { p_user_id: accountId, p_test_mode: testMode,
        p_period_started_at: active.period_started_at, p_monthly_budget_micros: budget }),
      resetsAt: active.active_until,
    } : null;
    const canStart = checkoutConfigured && !manageable && !state && await checkoutHasCapacity();
    const subscription = manageable ?? subscriptions[0];
    return json({
      tier: active ? "pro" : "free",
      status: subscription ? (refunded(subscription) && withinPeriod(subscription) ? "refunded" : subscription.status) : null,
      activeUntil: active?.active_until ?? null,
      checkoutAvailable: canStart || (checkoutConfigured && state === "open"),
      portalAvailable: subscriptions.length > 0,
      testMode,
      checkoutState: state,
      checkoutAttempt: state === "open" ? row?.attempt_id : null,
      checkoutUnavailableReason: manageable ? "subscription" : !checkoutConfigured ? "setup" : !state && !canStart ? "capacity" : null,
      hookCredits,
    });
  }
  if (action === "hooks") {
    if (!hooksConfigured) return json({ error: "Included Hook Finder is currently unavailable. You can use your own Gemini key or Fast Interval." }, 503);
    if (!active?.period_started_at) return json({ error: "An active Pro billing period is required for included Hook Finder credits." }, 403);
    const result = await generateHooks(body, { id: accountId, providerId: active.provider_id, periodStartedAt: active.period_started_at },
      { key: geminiKey, budget, testMode }, db);
    return json(result.data, result.status);
  }
  if (action === "portal") {
    const item = manageable ?? subscriptions[0];
    if (!item) return json({ error: "No subscription found" }, 404);
    const subscription = await polar(`subscriptions/${item.provider_id}`);
    const customerId = accountIdFrom(subscription?.customer_id);
    if (!customerId || subscription.id !== item.provider_id || subscription.customer?.organization_id !== organizationId ||
        subscription.customer.external_id !== accountId) {
      return json({ error: "Subscription unavailable" }, 404);
    }
    const session = await polar("customer-sessions/", { customer_id: customerId });
    return json({ url: billingUrl(session?.customer_portal_url, testMode) });
  }
  if (manageable) return active ? json({ state: "active" }) : json({ error: "Manage your existing subscription first" }, 409);
  if (state === "pending" || state === "preparing") return json({ state });
  if (!checkoutConfigured) return json({ error: "Pro checkout is still being configured." }, 503);
  if (state === "open") return json({ url: billingUrl(row?.url, testMode), attemptId: row?.attempt_id });

  const attemptId = crypto.randomUUID();
  const params = { p_user_id: accountId, p_test_mode: testMode, p_attempt_id: attemptId,
    p_monthly_budget_micros: testMode ? null : budget };
  let reservation = await db("rpc/hold_billing_checkout", params);
  if (reservation === "capacity" && await checkoutHasCapacity()) reservation = await db("rpc/hold_billing_checkout", params);
  if (reservation === "capacity") return json({ error: "New Pro subscriptions are paused while we increase Hook Finder capacity." }, 409);
  if (reservation !== "held") return json({ state: "preparing" });
  const path = `${checkoutPath(accountId)}&attempt_id=eq.${attemptId}&url=is.null`;
  try {
    const claim = await sign(claimSecret, checkoutClaim(accountId, productId, testMode));
    const checkout = await polar("checkouts/", {
      products: [productId],
      allow_trial: false,
      allow_discount_codes: false,
      external_customer_id: accountId,
      metadata: { account_claim: claim },
      ...returnUrls(),
    });
    const id = accountIdFrom(checkout?.id);
    const product = checkout?.products?.[0];
    const expiresAt = Date.parse(checkout?.expires_at);
    if (!id || checkout.status !== "open" || checkout.products?.length !== 1 || product?.id !== productId ||
        product.organization_id !== organizationId || product.is_recurring !== true || !(expiresAt > Date.now())) {
      throw new Error("Unexpected checkout response");
    }
    if (!testMode && (checkout.amount !== 1200 || checkout.currency !== "usd" ||
        product.recurring_interval !== "month" || product.recurring_interval_count !== 1)) {
      await db(path, closedCheckout(), "PATCH");
      return json({ error: "Pro checkout pricing is being configured. Try again later." }, 503);
    }
    const url = billingUrl(checkout.url, testMode);
    const [completed] = await db(path, { url, provider_checkout_id: id, checkout_state: "open", expires_at: checkout.expires_at,
      check_after: new Date().toISOString() }, "PATCH");
    return completed ? json({ url, attemptId }) : json({ state: "preparing" });
  } catch (error) {
    // A slot with no recorded link has not been shared with the customer.
    await db(path, closedCheckout(), "PATCH");
    throw error;
  }
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
