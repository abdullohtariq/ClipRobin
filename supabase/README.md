# Clip Robin accounts and billing

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
4. Under **Authentication → URL Configuration**, set a Site URL and add the exact **Account & Plans** redirect URLs you use. For development, add `http://127.0.0.1:3000/subscription` and `http://localhost:3000/subscription` if you use both. For public use, serve the static Account & Plans page at an HTTPS URL, add its exact `/subscription` URL, and set `NEXT_PUBLIC_CLIPROBIN_ACCOUNT_URL` to it. A host-provided HTTPS address is sufficient. This page handles account and billing flows. Video processing still uses the local sidecar.

## 2. Pick sign-in methods

- **Email and password** are built into the web and desktop app. Keep email confirmation on. Supabase's default mail service is for team-member testing and is rate-limited. For public signup and password recovery, [configure a custom SMTP provider](https://supabase.com/docs/guides/auth/auth-smtp). Desktop users can confirm their email in the browser, then return to the app to sign in. For desktop password recovery, open the hosted Account & Plans page and start the reset there.
- **GitHub** is the simplest optional browser OAuth route when you do not own a domain. Create a GitHub OAuth app with the callback URL from the Supabase Auth provider settings. It uses your Supabase project URL. Put the client ID and secret into Supabase, then set `NEXT_PUBLIC_CLIPROBIN_GITHUB_AUTH=1` for the web build. [GitHub setup](https://supabase.com/docs/guides/auth/social-login/auth-github)
- **Google** can be enabled for browser sign-in using the Google Cloud OAuth client and Supabase callback. Test with the project's assigned callback and Google test users. Public consent and branding depend on Google's verification requirements. After configuring it in Supabase, set `NEXT_PUBLIC_CLIPROBIN_GOOGLE_AUTH=1`. [Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google)
- **ChatGPT** website identity sign-in requires OpenAI approval and an OAuth client for Clip Robin. The Supabase dashboard can offer its own Continue with ChatGPT button for you as the project owner. Clip Robin's own sign-in page uses the methods above. [OpenAI website sign-in](https://developers.openai.com/siwc/website)

After connecting your SMTP sender, open **Authentication → Emails → Confirm sign up**. Set the subject to **Confirm your Clip Robin email** and paste the [Clip Robin confirmation template](templates/confirm-signup.html) into the body. The template uses Supabase's `{{ .ConfirmationURL }}` to preserve verification and the configured redirect. [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)

## 3. Connect Lemon Squeezy in test mode

Lemon Squeezy lists Pakistan for bank payouts. Merchant activation, identity verification, and available payout methods are handled in your store dashboard. Sandbox testing uses test-mode data. [Supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries) · [Test mode](https://docs.lemonsqueezy.com/help/getting-started/test-mode)

1. Create a **recurring** Clip Robin Pro variant in the store's test mode. Set your price and interval in Lemon Squeezy. The app currently supports one recurring variant and shows pricing through the hosted checkout.
2. Create a test-mode API key. In Supabase **Edge Functions → Secrets**, set the following values. Use two separate random secrets for the webhook and checkout claim. Keep these values out of frontend environment variables and source control.

   | Secret | Value |
   | --- | --- |
   | `LEMON_SQUEEZY_API_KEY` | Test-mode API key |
   | `LEMON_SQUEEZY_STORE_ID` | Store's numeric ID |
   | `LEMON_SQUEEZY_VARIANT_ID` | Recurring variant's numeric ID |
   | `LEMON_SQUEEZY_WEBHOOK_SECRET` | Webhook signing secret configured in Lemon Squeezy |
   | `CLIPROBIN_CHECKOUT_SECRET` | Separate random value with at least 32 characters |
   | `LEMON_SQUEEZY_MODE` | `test` |

3. In Lemon Squeezy test mode, send `subscription_created` and `subscription_updated` events to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/cliprobin-billing/webhook`. The function checks `X-Signature`, verifies store and mode, and fetches the current subscription before updating the account. Initial ownership comes from the signed checkout claim. Updates can use an established subscription ID. The database ignores older provider snapshots. [Webhook events](https://docs.lemonsqueezy.com/help/webhooks/event-types) · [Signing](https://docs.lemonsqueezy.com/help/webhooks/signing-requests)
4. Create a test user from **Account & Plans**. Verify Free, open a test checkout, use Lemon Squeezy's test payment details, then return and refresh. Confirm Pro appears only after the webhook. Verify a second account stays Free. In the portal, cancel and check that Pro remains available until the paid period ends. Verify expired, paused, and past-due subscriptions return to Free. Try duplicate event deliveries and a temporary network outage.

To launch later, use an approved store and live recurring variant, live API and webhook credentials, and `LEMON_SQUEEZY_MODE=live`. Configure those on the hosted function. Sandbox rows are isolated from live entitlements. Keep provider-backed orders and any earlier real sales separate from old `ROBIN-PRO-*` demo keys. Reconcile earlier real sales using verified order records before granting access.

### Local and hosted boundaries

- `billing_subscriptions` is readable and writable by the server role. Browser accounts cannot change it directly. The function derives the account ID from the Supabase session and scopes each plan or portal request to that account.
- The desktop media engine is distributed as local open-source code. Subscription checks control features in the official interface and hosted billing service. They do not make the user's local source or rendered files inaccessible.
- A Free Supabase project can pause after inactivity. Confirm the project is online before testing and revisit capacity before relying on it for paid production customers. [Supabase Free limits](https://supabase.com/docs/guides/platform/billing-on-supabase)
