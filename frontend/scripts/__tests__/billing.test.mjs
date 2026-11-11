import assert from "node:assert/strict";
import { test } from "node:test";
import { checkoutClaim, sign } from "../../../supabase/functions/cliprobin-billing/protocol.mjs";

const encoder = new TextEncoder();
const accountId = "e5056252-4ab4-4e75-9474-903e405cf551";
const otherId = "68911547-523b-4f8b-a40c-980ebf0fbb3c";
const hookSecret = "test-webhook-secret";
const claimSecret = "disposable-checkout-claim-secret-for-tests";
const env = {
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_ANON_KEY: "public-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
  LEMON_SQUEEZY_API_KEY: "provider-test-key",
  LEMON_SQUEEZY_WEBHOOK_SECRET: hookSecret,
  CLIPROBIN_CHECKOUT_SECRET: claimSecret,
  LEMON_SQUEEZY_STORE_ID: "10",
  LEMON_SQUEEZY_VARIANT_ID: "20",
};

let handler;
globalThis.Deno = { env: { get: (key) => env[key] }, serve: (callback) => { handler = callback; } };
await import("../../../supabase/functions/cliprobin-billing/index.ts");
delete globalThis.Deno;

function request(action, token) {
  return new Request("https://db.example.test/functions/v1/cliprobin-billing", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify({ action, account_id: otherId }),
  });
}

async function webhook(data, secret = hookSecret) {
  const body = JSON.stringify(data);
  return new Request("https://db.example.test/functions/v1/cliprobin-billing/webhook", {
    method: "POST",
    headers: secret ? { "X-Signature": await sign(secret, encoder.encode(body)) } : {},
    body,
  });
}

const subscription = {
  id: "30", type: "subscriptions",
  attributes: { store_id: 10, variant_id: 20, test_mode: true, status: "active", updated_at: "2026-11-10T00:00:00Z" },
};

test("account endpoints require sign-in and ignore caller-supplied account IDs", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    if (url.pathname === "/auth/v1/user") {
      return init.headers.Authorization === "Bearer account-token"
        ? Response.json({ id: accountId, email: "owner@example.test" })
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
  assert.equal((await result.json()).tier, "free");
});

test("checkout uses the verified user, configured recurring variant and sandbox mode", async (t) => {
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: accountId, email: "owner@example.test" });
    if (url.pathname === "/rest/v1/billing_subscriptions") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/reserve_billing_checkout") return Response.json({ reserved: true });
    if (url.pathname === "/rest/v1/rpc/complete_billing_checkout") {
      const attempt = JSON.parse(init.body);
      assert.equal(attempt.p_user_id, accountId);
      assert.equal(attempt.p_url, "https://shop.lemonsqueezy.com/checkout/test");
      return Response.json(true);
    }
    assert.equal(url.href, "https://api.lemonsqueezy.com/v1/checkouts");
    const { data } = JSON.parse(init.body);
    assert.equal(data.relationships.variant.data.id, "20");
    assert.equal(data.attributes.test_mode, true);
    assert.equal(data.attributes.checkout_data.custom.account_id, accountId);
    assert.equal(data.attributes.checkout_data.custom.account_claim, await sign(claimSecret, checkoutClaim(accountId, "10", true)));
    return Response.json({ data: { attributes: { test_mode: true, url: "https://shop.lemonsqueezy.com/checkout/test" } } });
  });
  const result = await handler(request("checkout", "account-token"));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).url, "https://shop.lemonsqueezy.com/checkout/test");
});

test("an existing checkout is reused without another provider request", async (t) => {
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: accountId });
    if (url.pathname === "/rest/v1/billing_subscriptions") return Response.json([]);
    assert.equal(url.pathname, "/rest/v1/rpc/reserve_billing_checkout");
    return Response.json({ reserved: false, url: "https://shop.lemonsqueezy.com/checkout/previous" });
  });
  const result = await handler(request("checkout", "account-token"));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).url, "https://shop.lemonsqueezy.com/checkout/previous");
});

test("unsigned, forged and cross-mode webhooks cannot access billing records", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected provider call"); });
  const event = { meta: { event_name: "subscription_created" }, data: subscription };
  assert.equal((await handler(await webhook(event, null))).status, 401);
  assert.equal((await handler(await webhook(event, "wrong-secret"))).status, 401);
  const liveEvent = { ...event, data: { ...subscription, attributes: { ...subscription.attributes, test_mode: false } } };
  assert.equal((await handler(await webhook(liveEvent))).status, 200);
  assert.equal(fetch.mock.callCount(), 0);
});

test("webhook binds ownership and syncs the current cancellation instead of the delivered snapshot", async (t) => {
  const endsAt = "2026-12-10T00:00:00Z";
  let recorded;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.lemonsqueezy.com") {
      return Response.json({ data: { ...subscription, attributes: { ...subscription.attributes, status: "cancelled", ends_at: endsAt } } });
    }
    assert.equal(url.pathname, "/rest/v1/rpc/sync_billing_subscription");
    recorded = JSON.parse(init.body);
    return new Response(null, { status: 204 });
  });
  const event = {
    meta: { event_name: "subscription_created", custom_data: {
      account_id: accountId,
      account_claim: await sign(claimSecret, checkoutClaim(accountId, "10", true)),
    } },
    data: subscription,
  };
  assert.equal((await handler(await webhook(event))).status, 200);
  assert.equal(recorded.p_user_id, accountId);
  assert.equal(recorded.p_status, "cancelled");
  assert.equal(recorded.p_active_until, endsAt);

  event.meta.custom_data.account_id = otherId;
  assert.equal((await handler(await webhook(event))).status, 200);
  assert.equal(recorded.p_user_id, null);
});
