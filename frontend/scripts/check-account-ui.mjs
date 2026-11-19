import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(process.argv[2] || "out");
const extensions = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const path = resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
    if (!path.startsWith(root + sep)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": extensions[extname(path)] || "text/plain" }).end(await readFile(path));
  } catch { res.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const base = origin + "/subscription/";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const user = { id:"e5056252-4ab4-4e75-9474-903e405cf551", email:"fixture@example.test", aud:"authenticated", role:"authenticated", created_at:"2026-11-18T00:00:00Z", app_metadata:{provider:"email",providers:["email"]}, user_metadata:{}, identities:[] };
const jwt = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ sub:user.id, exp: Math.floor(Date.now()/1000) + 3600 })).toString("base64url") + ".fixture";
const auth = { access_token:jwt, refresh_token:"fixture_refresh", token_type:"bearer", expires_in:3600, user };
const attempt = "ac491de4-9f80-4bb2-af25-15bf8b3fe83e";
const free = { tier:"free", activeUntil:null, status:null, checkoutAvailable:true, portalAvailable:false, testMode:true, checkoutState:null, checkoutAttempt:null, hookCredits:null };
let plan = free, verified = 0, recovered = 0, updated = 0, signup = 0, billing = 0, requireReauthentication = false;
const cors = { "access-control-allow-origin":"*", "access-control-allow-headers":"authorization, content-type, apikey, x-client-info, x-supabase-api-version, x-region", "access-control-allow-methods":"POST, PUT, GET, OPTIONS", "access-control-expose-headers":"x-supabase-api-version", "x-supabase-api-version":"2024-01-01" };
const crashes = [];

async function openTest() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.origin === origin) return route.continue();
    if (!url.hostname.endsWith(".supabase.co") && url.hostname !== "supabase.example.test") return route.abort();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers:cors });
    const json = (data, status = 200) => route.fulfill({ status, json:data, headers:cors });
    const body = req.postDataJSON() || {}, action = url.pathname.split("/").at(-1);
    if (action === "signup") { signup++; return json(user); }
    if (action === "resend") return json({});
    if (action === "recover") { recovered++; assert.equal(body.email,user.email); return json({}); }
    if (action === "verify") {
      verified++;
      if (body.token_hash === "fixture-expired") return json({ code:"otp_expired", error_code:"otp_expired", msg:"expired" }, 403);
      assert.ok(["email","recovery"].includes(body.type));
      return json(auth);
    }
    if (action === "token") {
      if (url.searchParams.get("grant_type") === "pkce") { assert.ok(body.code_verifier); if (body.auth_code === "wrong-browser-fixture") return json({ code:"bad_code_verifier", msg:"mismatched" }, 400); }
      if (body.password === "wrong-fixture") return json({ code:"invalid_credentials", msg:"Invalid login credentials" }, 400);
      return json(auth);
    }
    if (action === "user") {
      if (method === "PUT") {
        assert.equal(req.headers().authorization,"Bearer " + jwt);
        assert.equal(body.password,"changed-fixture-password");
        if (requireReauthentication) return json({ code:"reauthentication_needed", msg:"Reauthentication required" }, 401);
        updated++;
      }
      return json(user);
    }
    if (action === "logout") return route.fulfill({ status:204, headers:cors });
    if (action === "cliprobin-billing") {
      assert.equal(req.headers().authorization,"Bearer " + jwt);
      billing++;
      if (body.action === "plan") return json(plan);
      if (body.action === "checkout") {
        plan = {...free, checkoutState:"open", checkoutAttempt:attempt};
        return json({ url:"https://sandbox.polar.sh/checkout/fixture", attemptId:attempt });
      }
      if (body.action === "portal") return json({url:"https://sandbox.polar.sh/clip-robin/portal?customer_session_token=fixture"});
    }
    throw new Error("Unexpected fixture request " + url.pathname);
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(9000);
  p.on("pageerror", (error) => crashes.push(error.message));
  return { ctx, p };
}

const btn = (p,name) => p.getByRole("button",{name,exact:true});
const see = (p,text) => p.getByText(text,{exact:typeof text === "string"}).waitFor();
const email = (p) => p.getByLabel("Email",{exact:true});
const pass = (p) => p.getByLabel("Password",{exact:true});
try {
  const first = await openTest(), p = first.p;
  await p.goto(base);
  await see(p,"Sign in with email");
  assert.equal(await p.getByText("Engine Unavailable").count(),0);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth === innerWidth),true);
  await btn(p,"Create a free account").click();
  await email(p).fill(user.email);
  await pass(p).fill("signup-fixture-password");
  await btn(p,"Create account").click();
  await see(p,/Check your inbox and spam for the confirmation link/);
  await btn(p,"Resend confirmation email").click();
  await see(p,/Check your inbox and spam for the confirmation link/);
  assert.equal(signup,1);
  await p.goto(base + "?visit=1#error=access_denied&error_code=otp_expired&error_description=example");
  await see(p,/link has expired or has already been used/);
  assert.equal(p.url(),base + "?visit=1");
  await p.goto(base + "?code=wrong-browser-fixture");
  await see(p,/expired or was opened in a different browser/);
  assert.equal(p.url(),base);
  await email(p).fill(user.email);
  await pass(p).fill("wrong-fixture");
  await btn(p,"Sign in").click();
  await see(p,"Invalid login credentials");
  await first.ctx.close();
  console.log("PASS mobile signup, resend, error feedback, native sidebar hidden");

  const mail = await openTest(), m = mail.p;
  await m.goto(base + "#type=email&token_hash=fixture-confirmed");
  await see(m,"Confirm your Clip Robin email");
  assert.equal(m.url(),base);
  assert.equal(verified,0);
  await btn(m,"Confirm email").click();
  await see(m,/Email confirmed/);
  await see(m,"Free plan");
  await btn(m,"Set app password").click();
  await see(m,"Set a Clip Robin password");
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth === innerWidth),true);
  await m.screenshot({path:"build/cliprobin-app-password-390.png",fullPage:true});
  await m.setViewportSize({width:1440,height:900});
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth === innerWidth),true);
  await m.screenshot({path:"build/cliprobin-app-password-1440.png",fullPage:true});
  await m.setViewportSize({width:390,height:844});
  await pass(m).fill("changed-fixture-password");
  await m.getByLabel("Confirm password",{exact:true}).fill("different-fixture-password");
  await btn(m,"Save password").click();
  await see(m,"The passwords do not match.");
  assert.equal(updated,0);
  await btn(m,"Cancel").click();
  await see(m,"Free plan");
  await btn(m,"Set app password").click();
  assert.equal(await pass(m).inputValue(),"");
  assert.equal(await m.getByLabel("Confirm password",{exact:true}).inputValue(),"");
  await pass(m).fill("changed-fixture-password");
  await m.getByLabel("Confirm password",{exact:true}).fill("changed-fixture-password");
  requireReauthentication = true;
  await btn(m,"Save password").click();
  await see(m,"Sign out and sign in again, then set your Clip Robin password.");
  assert.equal(updated,0);
  requireReauthentication = false;
  await btn(m,"Save password").click();
  await see(m,"Password saved. Sign in to the Windows app with your email and this password.");
  await see(m,"Free plan");
  assert.equal(recovered,0);
  assert.equal(updated,1);
  console.log("PASS authenticated app password, mismatch, cancel clearing, reauthentication feedback, no reset email");
  await btn(m,"Test Pro checkout").click();
  await m.getByRole("link",{name:"Open secure checkout"}).waitFor();
  plan = {...free, checkoutAvailable:false, checkoutState:"pending"};
  await btn(m,"Refresh plan").click();
  await see(m,/checking your checkout with Polar/);
  assert.equal(await m.getByRole("link",{name:"Open secure checkout"}).count(),0);
  assert.equal(await btn(m,"Test Pro checkout").count(),0);
  plan = {...free, tier:"pro", status:"active", portalAvailable:true, checkoutAvailable:false, checkoutUnavailableReason:"subscription", hookCredits:{monthly:20, remaining:18, availableNow:0, resetsAt:"2026-12-18T00:00:00Z"}};
  await btn(m,"Refresh plan").click();
  await see(m,"Test Pro is active");
  await see(m,/temporarily unavailable/);
  await btn(m,"Manage billing").click();
  const portal = m.getByRole("link",{name:"Open billing portal"});
  await portal.waitFor();
  assert.equal(new URL(await portal.getAttribute("href")).origin, "https://sandbox.polar.sh");
  plan = {...free, status:"refunded", portalAvailable:true, checkoutAvailable:false, checkoutUnavailableReason:"subscription"};
  await btn(m,"Refresh plan").click();
  await see(m,/refunded billing period/);
  await btn(m,"Sign out").click();
  await see(m,"Sign in with email");
  await mail.ctx.close();
  console.log("PASS cross-browser email confirmation, checkout open to pending to Pro to refunded, portal, credit cap, sign-out");

  plan = free;
  const recovery = await openTest(), r = recovery.p;
  await r.goto(base + "#type=recovery&token_hash=fixture-expired");
  await btn(r,"Continue to reset password").click();
  await see(r,/link has expired or has already been used/);
  await btn(r,"Request a new reset link").click();
  await email(r).fill(user.email);
  await btn(r,"Send reset link").click();
  await see(r,/a reset link has been sent/);
  assert.equal(recovered,1);
  await r.goto(base + "?code=fast-legacy-recovery");
  await see(r,"Choose a new password");
  await r.reload();
  await see(r,"Choose a new password");
  await pass(r).fill("changed-fixture-password");
  await btn(r,"Save password").click();
  await see(r,"Password updated.");
  await recovery.ctx.close();
  const fresh = await openTest(), f = fresh.p;
  await f.goto(base + "#type=recovery&token_hash=fixture-fresh-browser");
  await btn(f,"Continue to reset password").click();
  await see(f,"Choose a new password");
  await pass(f).fill("changed-fixture-password");
  await btn(f,"Save password").click();
  await see(f,"Password updated.");
  assert.equal(updated,3);
  assert.ok(billing >= 6);
  assert.deepEqual(crashes,[]);
  console.log("PASS expired reset, immediate legacy PKCE callback, reload during reset, and fresh-browser reset");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}



