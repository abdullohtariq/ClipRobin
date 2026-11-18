import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkoutClaim, sign } from "../../../supabase/functions/cliprobin-billing/protocol.mjs";

const accountId = "e5056252-4ab4-4e75-9474-903e405cf551";
const otherId = "68911547-523b-4f8b-a40c-980ebf0fbb3c";
const organizationId = "822cb1a7-aa97-43d9-b4ed-bfa8582c25db";
const productId = "b4852c1a-9840-4ba5-9b76-062297d19c03";
const customerId = "fc684218-c58f-414f-b04d-42d773725ac3";
const checkoutId = "224661fe-9648-4cd4-a1bc-30de55b8cb27";
const orderId = "646051fa-3b64-41b4-b6e7-0eb53e1b70aa";
const hookKey = Buffer.alloc(32, 7);
const claimSecret = "disposable-checkout-claim-secret-for-tests";
const checkoutUrl = "https://sandbox.polar.sh/checkout/test";
const env = {
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_ANON_KEY: "public-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
  POLAR_ACCESS_TOKEN: "provider-test-key",
  POLAR_WEBHOOK_SECRET: `whsec_${hookKey.toString("base64")}`,
  CLIPROBIN_CHECKOUT_SECRET: claimSecret,
  POLAR_ORGANIZATION_ID: organizationId,
  POLAR_PRODUCT_ID: productId,
  CLIPROBIN_BILLING_TEST_USER_ID: accountId,
  CLIPROBIN_GEMINI_API_KEY: "simulated-key",
  CLIPROBIN_GEMINI_MONTHLY_BUDGET_CENTS: "500",
};

let handler;
globalThis.Deno = { env: { get: (key) => env[key] }, serve: (callback) => { handler = callback; } };
await import("../../../supabase/functions/cliprobin-billing/index.ts");
delete globalThis.Deno;

function request(action, token, fields = {}) {
  return new Request("https://db.example.test/functions/v1/cliprobin-billing", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify({ ...fields, action, account_id: otherId }),
  });
}

function webhook(data, key = hookKey, timestamp = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(data);
  const id = "msg_clip_robin_test";
  const signature = key && createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("https://db.example.test/functions/v1/cliprobin-billing/webhook", {
    method: "POST",
    headers: signature ? { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${signature}` } : {},
    body,
  });
}

const subscription = {
  id: "da0cfd22-bf92-467e-b6cd-82eefac0a894",
  product_id: productId,
  customer_id: customerId,
  customer: { organization_id: organizationId, external_id: accountId },
  status: "active",
  modified_at: "2026-11-10T00:00:00Z",
  current_period_start: "2026-11-10T00:00:00Z",
  current_period_end: "2026-12-10T00:00:00Z",
};

test("account endpoints require sign-in and ignore caller-supplied account IDs", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    if (url.pathname === "/auth/v1/user") {
      return init.headers.Authorization === "Bearer account-token"
        ? Response.json({ id: accountId, email: "owner@example.test" })
        : init.headers.Authorization === "Bearer other-token" ? Response.json({ id: otherId })
        : new Response(null, { status: 401 });
    }
    assert.equal(url.searchParams.get("user_id"), `eq.${accountId}`);
    assert.equal(url.searchParams.get("test_mode"), "eq.true");
    return Response.json([]);
  });
  assert.equal((await handler(request("plan"))).status, 401);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal((await handler(request("plan", "invalid"))).status, 401);
  const result = await handler(request("plan", "account-token"));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).checkoutAvailable, true);
  const otherPlan = await handler(request("plan", "other-token"));
  assert.equal((await otherPlan.json()).checkoutAvailable, false);
  assert.equal((await handler(request("checkout", "other-token"))).status, 503);
  assert.equal(fetch.mock.callCount(), 6);
});

test("checkout uses the verified user, configured recurring product and sandbox mode", async (t) => {
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: accountId, email: "owner@example.test" });
    if (url.pathname === "/rest/v1/billing_subscriptions") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/hold_billing_checkout") {
      assert.equal(JSON.parse(init.body).p_user_id, accountId);
      return Response.json("held");
    }
    if (url.pathname === "/rest/v1/billing_checkout_sessions") {
      if (init.method === "GET") return Response.json([]);
      const session = JSON.parse(init.body);
      assert.equal(url.searchParams.get("user_id"), `eq.${accountId}`);
      assert.equal(session.url, checkoutUrl);
      assert.equal(session.provider_checkout_id, checkoutId);
      assert.equal(session.expires_at, expiresAt);
      return Response.json([session]);
    }
    assert.equal(url.href, "https://sandbox-api.polar.sh/v1/checkouts/");
    assert.equal(init.headers["Polar-Version"], "2026-10");
    const data = JSON.parse(init.body);
    assert.deepEqual(data.products, [productId]);
    assert.equal(data.allow_trial, false);
    assert.equal(data.external_customer_id, accountId);
    assert.equal(data.metadata.account_claim, await sign(claimSecret, checkoutClaim(accountId, productId)));
    return Response.json({
      id: checkoutId,
      status: "open",
      products: [{ id: productId, organization_id: organizationId, is_recurring: true }],
      expires_at: expiresAt,
      url: checkoutUrl,
    });
  });
  const result = await handler(request("checkout", "account-token"));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).url, checkoutUrl);
});

test("an existing checkout is reused without another provider request", async (t) => {
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: accountId });
    if (url.pathname === "/rest/v1/billing_subscriptions") return Response.json([]);
    assert.equal(url.pathname, "/rest/v1/billing_checkout_sessions");
    return Response.json([{ attempt_id: checkoutId, url: checkoutUrl, provider_checkout_id: checkoutId, checkout_state: "open",
      expires_at: new Date(Date.now() + 60_000).toISOString(), check_after: new Date(Date.now() + 10_000).toISOString() }]);
  });
  const result = await handler(request("checkout", "account-token"));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).url, checkoutUrl);
});

test("missing, invalid and expired Polar signatures are rejected before provider access", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected provider call"); });
  const event = { type: "subscription.created", data: subscription };
  assert.equal((await handler(webhook(event, null))).status, 401);
  assert.equal((await handler(webhook(event, "wrong-secret"))).status, 401);
  assert.equal((await handler(webhook(event, hookKey, Math.floor(Date.now() / 1000) - 301))).status, 401);
  assert.equal(fetch.mock.callCount(), 0);
});

test("webhook verifies the current subscription, checkout ownership and expiration", async (t) => {
  const endsAt = "2026-12-10T00:00:00Z";
  const current = {
    ...subscription,
    ends_at: endsAt,
    cancel_at_period_end: true,
    metadata: { account_claim: await sign(claimSecret, checkoutClaim(accountId, productId)) },
  };
  let recorded;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "sandbox-api.polar.sh") {
      assert.equal(url.pathname, `/v1/subscriptions/${subscription.id}`);
      return Response.json(current);
    }
    assert.equal(url.pathname, "/rest/v1/rpc/sync_billing_period");
    recorded = JSON.parse(init.body);
    return new Response(null, { status: 204 });
  });
  const event = { type: "subscription.updated", data: { ...subscription, status: "incomplete" } };
  assert.equal((await handler(webhook(event))).status, 200);
  assert.equal(recorded.p_user_id, accountId);
  assert.equal(recorded.p_status, "cancelled");
  assert.equal(recorded.p_test_mode, true);
  assert.equal(recorded.p_period_started_at, subscription.current_period_start);
  assert.equal(recorded.p_active_until, endsAt);

  current.status = "past_due";
  assert.equal((await handler(webhook(event))).status, 200);
  assert.equal(recorded.p_active_until, null);
  current.metadata.account_claim = await sign(claimSecret, checkoutClaim(otherId, productId));
  assert.equal((await handler(webhook(event))).status, 200);
  assert.equal(recorded.p_user_id, null);

  current.customer = { ...subscription.customer, external_id: otherId };
  recorded = undefined;
  assert.equal((await handler(webhook(event))).status, 200);
  assert.equal(recorded, undefined);
});

test("portal session belongs to the current account and uses the sandbox host", async (t) => {
  const portalUrl = "https://sandbox.polar.sh/clip-robin/portal?customer_session_token=fixture";
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const { pathname } = new URL(input);
    if (pathname === "/auth/v1/user") return Response.json({ id: accountId });
    if (pathname === "/rest/v1/billing_subscriptions") return Response.json([{ provider_id: subscription.id, status: "active" }]);
    if (pathname === `/v1/subscriptions/${subscription.id}`) return Response.json(subscription);
    assert.equal(pathname, "/v1/customer-sessions/");
    assert.deepEqual(JSON.parse(init.body), { customer_id: customerId });
    return Response.json({ customer_portal_url: portalUrl });
  });
  const response = await handler(request("portal", "account-token"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, portalUrl);
});

test("billing cycle reconciles a missing webhook, handles refunds and enforces credit limits", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);`);
  for (const migration of ["20261110000000_account_subscriptions.sql", "20261117000000_hook_credits.sql", "20261118000000_billing_reliability.sql"]) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  }
  await db.query("insert into auth.users (id) values ($1), ($2)", [accountId, otherId]);
  const permission = await db.query("select has_function_privilege('authenticated', 'public.reserve_billing_hook(uuid,uuid,text,boolean,timestamptz,integer,integer)', 'execute') as allowed");
  assert.equal(permission.rows[0].allowed, false);
  const holds = await Promise.all([accountId, otherId].map((id) =>
    db.query("select public.hold_billing_checkout($1,false,$2,400000) as state", [id, crypto.randomUUID()])));
  assert.deepEqual(holds.map((hold) => hold.rows[0].state).sort(), ["capacity", "held"]);
  await db.exec("delete from public.billing_checkout_sessions");

  let current;
  let currentOrder;
  let checkoutStatus = "open";
  let failCreate = true;
  let checkoutCreates = 0;
  let failGemini = false;
  let generated = 0;
  const signedClaim = await sign(claimSecret, checkoutClaim(accountId, productId));
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    const { pathname } = url;
    if (pathname === "/auth/v1/user") {
      return Response.json({ id: init.headers.Authorization === "Bearer account-token" ? accountId : otherId });
    }
    if (pathname === "/rest/v1/billing_subscriptions") {
      const result = await db.query("select * from public.billing_subscriptions where user_id = $1 and test_mode = true order by provider_updated_at desc",
        [url.searchParams.get("user_id").slice(3)]);
      return Response.json(result.rows);
    }
    if (pathname === "/rest/v1/billing_checkout_sessions") {
      const values = [];
      const parameter = (value) => `$${values.push(value)}`;
      const set = init.method === "PATCH" ? Object.entries(JSON.parse(init.body)).map(([key, value]) => `${key} = ${parameter(value)}`).join(", ") : "";
      const conditions = Array.from(url.searchParams, ([key, value]) => {
        if (value === "is.null") return `${key} is null`;
        if (value === "not.is.null") return `${key} is not null`;
        const operator = value.startsWith("lte.") ? "<=" : "=";
        return `${key} ${operator} ${parameter(value.slice(value.indexOf(".") + 1))}`;
      });
      const query = set ? `update public.billing_checkout_sessions set ${set}` : "select * from public.billing_checkout_sessions";
      const result = await db.query(`${query} where ${conditions.join(" and ")} ${set ? "returning *" : ""}`, values);
      return Response.json(result.rows);
    }
    if (pathname.startsWith("/rest/v1/rpc/")) {
      const name = pathname.split("/").at(-1);
      const args = Object.entries(JSON.parse(init.body));
      const parameters = args.map(([key], index) => `${key} => $${index + 1}`).join(", ");
      const result = await db.query(`select public.${name}(${parameters}) as value`, args.map(([, value]) => value));
      return ["sync_billing_period", "sync_billing_refund", "finish_billing_hook"].includes(name) ? new Response(null, { status: 204 }) : Response.json(result.rows[0].value);
    }
    if (url.hostname === "sandbox-api.polar.sh") {
      if (pathname === `/v1/subscriptions/${subscription.id}`) return Response.json(current);
      if (pathname === `/v1/orders/${orderId}`) return Response.json(currentOrder);
      if (init.method === "POST") {
        assert.equal(pathname, "/v1/checkouts/");
        checkoutCreates++;
        if (failCreate) return new Response(null, { status: 503 });
      } else assert.equal(pathname, `/v1/checkouts/${checkoutId}`);
      return Response.json({
        id: checkoutId, status: checkoutStatus, subscription_id: checkoutStatus === "succeeded" ? subscription.id : null,
        metadata: { account_claim: signedClaim }, external_customer_id: accountId,
        products: [{ id: productId, organization_id: organizationId, is_recurring: true }],
        expires_at: new Date(Date.now() + 60_000).toISOString(), url: checkoutUrl,
      });
    }
    assert.equal(url.hostname, "generativelanguage.googleapis.com");
    assert.equal(init.headers["x-goog-api-key"], "simulated-key");
    if (pathname.endsWith(":countTokens")) return Response.json({ totalTokens: 18_000 });
    assert.match(pathname, /gemini-3\.5-flash-lite:generateContent$/);
    generated++;
    if (failGemini) return new Response(null, { status: 503 });
    return Response.json({
      candidates: [{ content: { parts: [{ text: '{"clips":[{"title":"Sample hook","start":0,"end":30,"score":8,"reason":"A complete thought"}]}' }] } }],
      usageMetadata: { promptTokenCount: 18_000, candidatesTokenCount: 550, thoughtsTokenCount: 200 },
    });
  });

  const plan = async () => (await handler(request("plan", "account-token"))).json();
  const hooks = (durationSeconds, token = "account-token") => handler(request("hooks", token, {
    durationSeconds, clipSeconds: 30, clipCount: 3, segments: [{ start: 0, end: 30, text: "A complete thought" }],
  }));
  const send = async (type) => assert.equal((await handler(webhook({ type, data: { id: current.id } }))).status, 200);
  const refund = async () => assert.equal((await handler(webhook({ type: "order.refunded", data: { id: orderId } }))).status, 200);
  const checkAgain = () => db.exec("update public.billing_checkout_sessions set check_after = now() - interval '1 second'");

  assert.equal((await plan()).checkoutAvailable, true);
  assert.equal((await hooks(1800)).status, 403);
  assert.equal((await handler(request("checkout", "account-token"))).status, 503);
  failCreate = false;
  assert.equal((await handler(request("checkout", "account-token"))).status, 200);
  checkoutStatus = "confirmed";
  assert.equal((await plan()).checkoutState, "pending");
  assert.deepEqual(await (await handler(request("checkout", "account-token"))).json(), { state: "pending" });
  assert.equal(checkoutCreates, 2);
  assert.equal((await plan()).tier, "free");
  const firstEnd = Date.now() + 86_400_000;
  const firstStart = new Date(firstEnd - 30 * 86_400_000).toISOString();
  current = { ...subscription, current_period_start: firstStart, current_period_end: new Date(firstEnd).toISOString(),
    checkout_id: checkoutId, started_at: firstStart, modified_at: firstStart, metadata: { account_claim: signedClaim } };
  checkoutStatus = "succeeded";
  await checkAgain();
  const activated = await plan();
  assert.equal(activated.tier, "pro");
  assert.equal(activated.checkoutState, null);
  assert.equal(activated.checkoutAvailable, false);
  assert.equal(activated.hookCredits.remaining, 20);
  assert.deepEqual(await (await handler(request("checkout", "account-token"))).json(), { state: "active" });
  assert.equal((await hooks(1800, "other-account")).status, 503);

  failGemini = true;
  assert.equal((await hooks(1800)).status, 502);
  assert.equal((await plan()).hookCredits.remaining, 20);
  failGemini = false;
  const firstRun = await hooks(1801);
  assert.equal(firstRun.status, 200);
  assert.equal((await firstRun.json()).creditsUsed, 2);
  const attempts = await Promise.all([hooks(1800 * 18), hooks(1800 * 18)]);
  assert.deepEqual(attempts.map((result) => result.status).sort(), [200, 402]);
  assert.equal((await plan()).hookCredits.remaining, 0);
  assert.equal((await hooks(1800)).status, 402);
  assert.equal(generated, 3);
  const ledger = await db.query("select output_tokens from public.billing_hook_requests where state = 'complete'");
  assert.deepEqual(ledger.rows, [{ output_tokens: 750 }, { output_tokens: 750 }]);
  await send("subscription.updated");
  assert.equal((await plan()).hookCredits.remaining, 0);

  currentOrder = { id: orderId, subscription_id: current.id, customer_id: customerId, product_id: productId,
    billing_reason: "subscription_create", checkout_id: checkoutId, status: "partially_refunded", created_at: firstStart };
  await refund();
  assert.equal((await plan()).tier, "pro");
  currentOrder.status = "refunded";
  await refund();
  assert.equal((await plan()).status, "refunded");
  assert.equal((await plan()).portalAvailable, true);
  assert.equal((await plan()).tier, "free");
  assert.equal((await hooks(1800)).status, 403);
  await send("subscription.updated");
  assert.equal((await plan()).tier, "free");
  const renewedAt = Date.now() - 1000;
  current = { ...current, current_period_start: new Date(renewedAt).toISOString(),
    current_period_end: new Date(renewedAt + 30 * 86_400_000).toISOString(), modified_at: new Date(renewedAt).toISOString() };
  await send("subscription.cycled");
  await refund();
  assert.equal((await plan()).hookCredits.remaining, 20);
  await db.query(`insert into public.billing_hook_requests (id, user_id, test_mode, period_started_at, credits, reserved_micros, state)
    values ($1, $2, false, now(), 1, 4580000, 'failed')`, [crypto.randomUUID(), otherId]);
  const budgetLimited = (await plan()).hookCredits;
  assert.equal(budgetLimited.remaining, 20);
  assert.equal(budgetLimited.availableNow, 0);
  assert.equal((await hooks(1800)).status, 429);

  const [capacity, blocked] = await Promise.all([
    db.query("select public.billing_checkout_has_capacity(5000000) as result"),
    db.query("select public.hold_billing_checkout($1,false,$2,5000000) as result", [otherId, crypto.randomUUID()]),
  ]);
  assert.equal(capacity.rows[0].result, false);
  assert.equal(blocked.rows[0].result, "capacity");

  current = { ...current, cancel_at_period_end: true, ends_at: current.current_period_end,
    modified_at: new Date(renewedAt + 1000).toISOString() };
  await send("subscription.canceled");
  const canceled = await plan();
  assert.equal(canceled.status, "cancelled");
  assert.equal(canceled.tier, "pro");
  assert.equal(canceled.hookCredits.remaining, 20);
  currentOrder = { ...currentOrder, billing_reason: "subscription_cycle", checkout_id: null, created_at: current.current_period_start };
  await refund();
  assert.equal((await plan()).status, "refunded");
  current = { ...current, status: "canceled", ended_at: new Date().toISOString(), modified_at: new Date(renewedAt + 2000).toISOString() };
  await send("subscription.revoked");
  assert.equal((await plan()).tier, "free");
  assert.equal((await hooks(1800)).status, 403);
  assert.equal(generated, 3);
});
