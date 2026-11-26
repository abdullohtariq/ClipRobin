# Clip Robin accounts and billing

## Hosted status on November 26, 2026

The [public Account & Plans page](https://cliprobin-accounts.thinarch8.chatgpt.site/subscription/) is deployed and tested. Anonymous HTML, JavaScript, and CSS requests return HTTP 200. Google sign-in returns to this page and loads the owner's existing Test Pro plan. Supabase Auth, new checkout returns, the local configuration, and the GitHub release variable use this address. The published v0.1.32 installer predates this configuration and needs a future build to embed the new account link.

Google's app is **In production** after completing Branding. Its separate `youtube.upload` permission still needs Google's verification; the Verification Center requires branding verification before enabling the data-access submission.

The dedicated `clip-robin` Gemini project remains on the **Free tier**. Its server-only key is installed in Supabase. A real hosted synthetic Hook Finder request returned a clip and reduced the test balance from 20 to 19 credits, which persisted after reloading the public page. No paid billing was enabled and no real checkout payment was made. Retain the application budget and check free-tier availability and data-use terms before a public paid pilot.

**Email setup:** the owner completed Brevo phone verification and created the Standard SMTP key. Brevo shows **Clip Robin <abdollahtariq@gmail.com>** as a verified sender. Supabase's saved custom SMTP connection uses `smtp-relay.brevo.com:587`; the private password is stored in Supabase and is excluded from this repository. A direct server check confirms SMTP enabled, Google enabled, and email confirmation required. The two branded confirmation/recovery templates are installed. An actual reset request from the public account page produced **Sent** and **Delivered** events in Brevo for **Reset your Clip Robin password**. Followed the actual delivered message's tracked link: Clip Robin displayed **Confirm password reset**, accepted the token after **Continue to reset password**, and displayed **Choose a new password**. No new password was entered. Owner inbox/spam placement, completion with owner-entered credentials, and signup with a non-team address still need acceptance. The limits are **30 account emails/hour** in Supabase and **300 emails/day** in Brevo Free.

**Tracking check:** Brevo's transactional Tracking page exposes an **Anonymous email tracking** option; it is not a switch to disable tracking. No tracking setting was changed, and tracking must not be reported as disabled. The real delivered reset link used a Brevo `sendibt2.com` tracking redirect and successfully reached the app's recovery form, preserving the information required for token verification. This confirms the tested owner reset path, while public confirmation and other mail/browser clients remain separate checks. Brevo rewrote the logged From address to its `brevosend.com` domain; confirm how it displays in the recipient inbox and check spam placement. [Brevo tracking](https://help.brevo.com/hc/en-us/articles/11643306229906-Can-I-anonymize-the-tracking-of-opens-and-clicks-for-my-emails) · [Supabase email tracking](https://supabase.com/docs/guides/auth/auth-email-templates#email-tracking)

**Template deployment:** `supabase/config.toml` declares the confirmation and recovery subjects and their project-root `content_path` values. The reviewed push updated exactly four Auth properties and left 19 undeclared remote properties, including SMTP and Google, unchanged. CLI v3.2 treats template bodies as push-only content: verify the deployed previews as well as the subjects; a zero subject diff alone does not verify the HTML. No frontend rebuild was required for these existing templates.

**Live billing setup:** the owner completed Polar's personal step. The live **Clip Robin** individual organization and **Clip Robin Pro** product (`8801cb6c-8620-4b6d-9720-5d6cc197d093`) are created at **$12 USD every month**, without a trial. No live runtime key, signed webhook, payout connection, or merchant approval has been verified. Supabase still uses the working Sandbox connection; creating a live product does not enable real checkout. Finish the matching live connection and the acceptance checks in `ai.md` before switching environments. No real payment was made.

---

Clip Robin uses your Supabase project for Auth, Postgres, and a hosted billing function. A signed-out user can still create and export local clips on Free. A new account starts on Free. The app refreshes its plan after returning to the window, while the page is visible, and on demand from **Account & Plans**. It uses Free when it cannot verify a plan. Local media, transcripts, and project data stay in the existing local workflow.

## 1. Set up the free account database

1. Sign in to the [Supabase dashboard](https://supabase.com/dashboard) and create a **Free** project under your organization. The default project URL works for Auth and the billing function. Choose a new project for this app, or verify the intended project before applying the migration.
2. Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started). From the repository root, run the commands below with your project reference. The `db push` applies the reviewed migration in `supabase/migrations/`. The function uses the server credentials provided by Supabase.

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push --remote
   supabase functions deploy cliprobin-billing --use-api
   ```

   If you already applied `20261110000000_account_subscriptions.sql` through the Dashboard SQL Editor, verify the two billing tables and three functions before linking the CLI. Then run `supabase migration repair 20261110000000 --status applied --remote` before the next `db push` so the CLI records the existing schema change. [Supabase migration history](https://supabase.com/docs/guides/deployment/database-migrations)

3. Copy `frontend/.env.example` to `frontend/.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from **Connect** or **Settings → API Keys**. Restart the development server. For a release build, set the same values as GitHub Actions repository variables. Public frontend variables are embedded at build time. Keep the database password, service-role key, and payment secrets in their respective dashboards.
4. Publish the account page on an HTTPS address before applying the public email templates. The static page handles sign-in, password reset, and account management. Video processing still uses the Windows app. Cloudflare Pages Direct Upload works with its assigned HTTPS address. From `frontend` in PowerShell, run:

   ```powershell
   $env:NEXT_PUBLIC_CLIPROBIN_ACCOUNT_SITE = '1'
   npm run build -- --webpack
   node scripts/package-account-site.mjs ../cliprobin-account-site
   Remove-Item Env:NEXT_PUBLIC_CLIPROBIN_ACCOUNT_SITE
   ```

   Upload the contents of `cliprobin-account-site` using **Workers & Pages → Create → Drag and drop**. Verify `https://YOUR_PROJECT.pages.dev/subscription/` loads and shows **Sign in with email**. Use that exact HTTPS address for Supabase **Authentication → URL Configuration → Site URL** and add it to **Redirect URLs**. Also set `NEXT_PUBLIC_CLIPROBIN_ACCOUNT_URL` to that address in the desktop build and GitHub Actions repository variables. Keep `http://127.0.0.1:3000/subscription` and `http://localhost:3000/subscription` in the allowlist if you develop on both. [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) · [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

## 2. Pick sign-in methods

- **Email and password** are built into the web and desktop app. Keep email confirmation on. Supabase's default mail service is for team-member testing and is rate-limited. For public signup and password recovery, [configure a custom SMTP provider](https://supabase.com/docs/guides/auth/auth-smtp). Desktop users can confirm their email in the browser, then return to the app to sign in. For desktop password recovery, open the hosted Account & Plans page and start the reset there.
- **GitHub** is the simplest optional browser OAuth route when you do not own a domain. Create a GitHub OAuth app with the callback URL from the Supabase Auth provider settings. It uses your Supabase project URL. Put the client ID and secret into Supabase, then set `NEXT_PUBLIC_CLIPROBIN_GITHUB_AUTH=1` for the web build. [GitHub setup](https://supabase.com/docs/guides/auth/social-login/auth-github)
- **Google** can be enabled for browser sign-in using the Google Cloud OAuth client and Supabase callback. Test with the project's assigned callback and Google test users. Public consent and branding depend on Google's verification requirements. After configuring it in Supabase, set `NEXT_PUBLIC_CLIPROBIN_GOOGLE_AUTH=1`. [Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google)
- **ChatGPT** website identity sign-in requires OpenAI approval and an OAuth client for Clip Robin. The Supabase dashboard can offer its own Continue with ChatGPT button for you as the project owner. Clip Robin's own sign-in page uses the methods above. [OpenAI website sign-in](https://developers.openai.com/siwc/website)

**Google accounts in the Windows app:** browser sign-in and the Windows app have separate sessions. On the hosted Account & Plans page, sign in with Google and choose **Set app password**. Enter and confirm a Clip Robin password, then use that email and password in Windows. Setting this password uses the signed-in account; it does not create a second account or require a reset email. If Supabase requires a recent sign-in, sign out and sign in again first. Password recovery for a signed-out user still requires the email connection below. A native browser-to-desktop OAuth return remains a future improvement.

After connecting your SMTP sender and publishing the page, open **Authentication → Emails**. Set **Confirm sign up** to the subject **Confirm your Clip Robin email** and use the [confirmation template](templates/confirm-signup.html). Set **Reset password** to the subject **Reset your Clip Robin password** and use the [reset template](templates/reset-password.html). Switch off click tracking for these messages. The link carries a one-time Supabase token in the URL fragment. The page clears it from the address bar and verifies it when the customer clicks. Customers can use a different browser from the one where they requested the message. Test both templates with an address outside the Supabase team before opening signup. [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)

For a small pilot before buying a domain, use an SMTP sender account you control. Brevo can replace an unauthenticated sender address with its own compliant address. Verify the actual From address and test delivery before relying on it. [Brevo sender requirements](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders)

## 3. Connect Polar Sandbox

Lemon Squeezy closed new store sign-ups on November 16, 2026. Polar lists Pakistan for seller payouts. Its separate sandbox provides hosted checkout, recurring subscriptions, and a customer portal. A sandbox checkout needs no Clip Robin website or live payment. [Lemon Squeezy announcement](https://www.lemonsqueezy.com/blog/saying-goodbye-to-lemon-squeezy) · [Polar countries](https://polar.sh/docs/merchant-of-record/supported-countries) · [Polar Sandbox](https://polar.sh/docs/integrate/sandbox)

1. Sign in at [Polar Sandbox](https://sandbox.polar.sh) and create a Clip Robin organization. Create one fixed-price, **recurring** Clip Robin Pro product at **12 USD per month**. Test checkout uses Polar's separate sandbox.
2. In the sandbox organization's **Settings → Webhooks**, add `https://YOUR_PROJECT_REF.supabase.co/functions/v1/cliprobin-billing/webhook`. Select **Raw**, API version `2026-10`, the available `subscription.*` events, and `order.refunded`. Generate a new Standard Webhooks signing secret. [Polar webhook setup](https://polar.sh/docs/integrate/webhooks/endpoints) · [Signature format](https://polar.sh/docs/integrate/webhooks/delivery)
3. Create an organization access token in **Settings → Developers** with `checkouts:write`, `subscriptions:read`, `orders:read`, and `customer_sessions:write`. In Supabase **Edge Functions → Secrets**, add the values below. Keep the token and signing secrets out of frontend variables, chat, and source control. The checkout claim secret is separate from the provider webhook secret. `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` can generate a checkout claim secret locally.

   | Secret | Value |
   | --- | --- |
   | `POLAR_ACCESS_TOKEN` | Sandbox organization access token |
   | `POLAR_ORGANIZATION_ID` | Sandbox organization UUID |
   | `POLAR_PRODUCT_ID` | Recurring Polar product UUID |
   | `POLAR_WEBHOOK_SECRET` | Generated Standard Webhooks `whsec_…` value |
   | `CLIPROBIN_CHECKOUT_SECRET` | Separate random value with at least 32 characters |
   | `CLIPROBIN_BILLING_TEST_USER_ID` | UUID from **Supabase → Authentication → Users** for the account allowed to test Pro |
   | `CLIPROBIN_CHECKOUT_RETURN_URL` | Optional HTTPS URL of Account & Plans, including the exact `/subscription/` path |
   | `POLAR_ENVIRONMENT` | `sandbox` for testing. This is the default. |
   | `CLIPROBIN_GEMINI_API_KEY` | Server-only key for included Hook Finder credits. Configure the budget below before adding the key. |
   | `CLIPROBIN_GEMINI_MONTHLY_BUDGET_CENTS` | Positive whole number of USD cents for the project-wide monthly reservation limit. For example, `500` reserves at most $5 in a UTC calendar month. |

4. Apply the Hook Finder and billing reliability database migrations before deploying the function. Use a current Clip Robin build with Polar link support. The `v0.1.30` installer predates Polar support. The billing function verifies the signed webhook, then checks the current provider state, organization, customer, product, and signed Clip Robin account claim. The database ignores older subscription snapshots.
5. On the designated account, confirm Free appears before checkout. Open a test checkout and use [Polar's sandbox test card](https://polar.sh/docs/integrate/sandbox). Confirm **Test Pro is active** on return and that a second account stays on Free. Verify the declined-card and abandoned-checkout cases. Repeat successful checkout with webhook delivery paused in Sandbox to test **Refresh plan**. Restore webhooks and verify replays preserve one subscription. Use **Manage billing** to test cancellation and portal access. Test a full refund for the current invoice, a partial refund, and a refund for a prior invoice. A verified full refund ends Pro access for that billing period. The customer can still open the billing portal. Handle cancellation separately in Polar when appropriate.

Production checkout requires an approved Polar organization, live credentials, `POLAR_ENVIRONMENT=production`, and a current Clip Robin release. Use a separate runtime environment with production-only secrets. The checkout function verifies the offered price is $12 USD per month and requires the included Hook Finder configuration before it enables paid checkout. Sandbox subscriptions remain in test-mode rows. Reconcile earlier sales against verified orders before granting access.

### Included Gemini credits

- Pro receives 20 credits per Polar billing period. A fresh analysis uses one credit per started 30 minutes of source video. Caption and framing changes can reuse existing hooks. When customers enable Developer Mode with their own key, Gemini bills their project and Clip Robin spends no included credits.
- The hosted function verifies the account and reserves credits and up to $0.02 per credit before it sends a timestamped transcript to Gemini 3.5 Flash-Lite. Each credit allows 20,000 input tokens and up to 2,000 output tokens including thinking. Included analysis uses one generation attempt. The project stops accepting reservations at the configured UTC monthly limit. An account can reserve up to $1 per billing period, including failed requests. Failed requests release user credits while retaining their spend reservation for cases where the provider may have billed the attempt. The usage table records token counts and status and contains no transcript or API key.
- Set a [monthly project spend cap in Google AI Studio](https://ai.google.dev/gemini-api/docs/billing/) as a second control. Use a dedicated Gemini project so Clip Robin's included usage can be reconciled against the provider's bill. If you have an existing Polar test subscription from before this migration, replay a subscription webhook to populate its billing-period start.
- **Account & Plans** shows the balance and how many credits the current limits allow. Production checkout reserves room for current subscribers and outstanding checkout sessions. At a $5 monthly budget and $0.02 reserved per credit, the maximum before usage spikes or failed attempts is 12 subscribers at 20 credits each. Monitor both the included usage and the provider bill during the paid pilot.
- Run `npm test` in `frontend` for a simulated cycle using the real migrations in embedded PostgreSQL. It covers pending checkout and missed notifications, credit usage and limits, failed Gemini calls, renewal, refunds, and cancellation with simulated Polar and Gemini responses.

### Local and hosted boundaries

- `billing_subscriptions` is readable and writable by the server role. Browser accounts cannot change it directly. The function derives the account ID from the Supabase session and scopes each plan or portal request to that account.
- The desktop media engine is distributed as local open-source code. Subscription checks control features in the official interface and hosted billing service. They do not make the user's local source or rendered files inaccessible.
- A Free Supabase project can pause after inactivity. Confirm the project is online before testing and revisit capacity before relying on it for paid production customers. [Supabase Free limits](https://supabase.com/docs/guides/platform/billing-on-supabase)
