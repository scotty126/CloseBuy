# CloseBuy launch checklist

Everything between "code is pushed" and "real customers can order". Work top to bottom.
**Owner** = only you can do it (accounts, payments, paperwork). **Claude** = I can do it in the repo or by script.

Status (2026-11-10): the API is live on Render (https://closebuy-api.onrender.com) and all four apps are live on
Cloudflare (`closebuy-<app>.scottpatrick115.workers.dev`). CORS is verified for all four. Web push and order-update
emails are built and deployed. `closebuy.com.ng` is on Cloudflare; attaching the custom subdomains and
`api.closebuy.com.ng` is the next step. Phase A below is done except the smoke test (A5) and the custom domains (C5).

---

## Phase A. Get it online

### A1. API on Render (Owner, ~15 min)
1. Render dashboard -> **closebuy-api -> Settings -> Docker Command -> Edit**. Set exactly: `sh /app/deploy/start.sh`. Save.
2. **Manual Deploy -> Deploy latest commit** (commit must be `3bf79b3` or newer).
3. Watch **Logs**. Good = `prisma migrate deploy` applies migrations (including `20261024120000_sale_price_and_favorites`), the API listens, status **Live**.
4. Open `https://<your-service>.onrender.com/health`. It must say `{"status":"ok"}`.
5. If a deploy fails, paste the last 30 log lines to Claude.

Render env vars to have set (values for DB/pepper/JWT are in your local `apps/api/.env`):
`NODE_ENV=production`, `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL` (auto from `closebuy-redis`), `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `PASSWORD_PEPPER`, `API_PUBLIC_URL`, `CUSTOMER_APP_URL`, `VENDOR_APP_URL`, `RIDER_APP_URL`,
`ADMIN_APP_URL`, `CORS_ORIGINS`, `DEV_AUTO_SIGNIN_PHONES`, `TERMII_API_KEY`, and (when you have them) Google, Resend.

### A2. Keep the free API awake (Owner, 5 min)
Render's free web service sleeps after ~15 min idle, which also pauses the order timers.
1. uptimerobot.com -> free account -> **Add monitor** -> HTTP(s).
2. URL `https://<your-api>/health`, interval **5 minutes**.
This is a stopgap. Move to a paid always-on host before real money moves (see Phase F).

### A3. Four frontends on Cloudflare (Owner, ~10 min each)
Delete the old failed `closebuy` project. For each app create a **new project** (Workers & Pages -> Create -> Connect to Git -> `scotty126/CloseBuy`):

| Project name (must match wrangler) | Root directory |
|---|---|
| `closebuy-customer` | `apps/customer` |
| `closebuy-vendor` | `apps/vendor` |
| `closebuy-rider` | `apps/rider` |
| `closebuy-admin` | `apps/admin` |

Same settings for all four:
- Build command: `corepack enable && pnpm install --frozen-lockfile && pnpm build:cf`
- Deploy command: `npx wrangler deploy`
- Build variables (one row each, name and value in separate boxes): `NODE_VERSION` = `22`, `NEXT_PUBLIC_API_URL` = your API URL (no trailing slash)

If a build fails, paste the log lines around the first `Error`. (A local Windows build cannot test this; the first Cloudflare build is the real test.)

### A4. Wire the URLs together (Owner + Claude, 10 min)
1. Note the four `*.workers.dev` URLs.
2. In Render env vars set `CUSTOMER_APP_URL`, `VENDOR_APP_URL`, `RIDER_APP_URL`, `ADMIN_APP_URL`, and `CORS_ORIGINS` (all four, comma-separated, no spaces, no trailing slashes). Save (redeploys).
3. Set `API_PUBLIC_URL` to the API's own public URL.
4. Tell Claude the URLs and it will verify CORS with a preflight request from each origin.

### A5. Smoke test (Claude, 5 min)
Run `node apps/api/scripts/e2e-lifecycle.mjs run` with `E2E_API_URL` set to the new API. All ~39 checks should pass.
(It creates test rows; clean them in Phase B.) Then click through each app once in a browser.

---

## Phase B. Make it safe (do before any real user)

1. **Rotate the Neon database password** (Owner). It was pasted into chat. Neon dashboard -> Roles -> reset password. Update `DATABASE_URL` and `DIRECT_URL` in Render, redeploy.
2. **Deal with the demo vendors' guessable phones** (Owner + Claude). Seeded vendor phones are `+2348010000001` to `+2348010000010`. Anyone who knows that pattern can try to sign in as them. Either hand each real shop owner their number and change it, or suspend the ones you are not onboarding. Claude can script the phone changes.
3. **Remove test accounts**: `claude-e2e-vendor@example.com`, `claude-e2e-rider@example.com`, the "E2E Test Vendor (delete me)" shop, and the throwaway `claude-*@example.com` customers. Use admin -> Vendors/Riders -> Suspend, or ask Claude for a cleanup script.
4. **Confirm `NODE_ENV=production`** on Render. With it set, the API never returns OTP dev codes.
5. **Keep `DEV_AUTO_SIGNIN_PHONES` to your own number only** (it skips OTP on staff logins) and remove it once Termii works.
6. **Admin account**: confirm your admin login works on the admin app (it was created 2026-09-17 in the same database). Admins are never self-created.
7. **Secrets hygiene**: never paste `.env` contents into chat or commit them. `.env` is gitignored.
8. **Database role (before real money)**: the app connects as the table owner, so "append-only" ledger rules are code-only. Create a non-owner role for `DATABASE_URL`, keep the owner on `DIRECT_URL` (see CLAUDE.md "Conventions"). Claude can write the SQL; you run it in Neon.

---

## Phase C. Make it real

### C1. Payments, Monnify (Owner) - blocks card/transfer
Today only **pay on delivery** works.
1. Open a Monnify business account, complete KYC.
2. Get `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE`; set them in Render.
3. Payouts: ask Monnify to enable API disbursements, disable OTP, and whitelist a static outbound IP. Render's free tier has no fixed IP; this needs a host with a static IP (Phase F). Set `MONNIFY_DISBURSEMENT_SOURCE_ACCOUNT_NUMBER`.
4. Point the Monnify webhook at `<API>/…` (Claude will confirm the exact path from the code).
5. Until this is done, label the app honestly: "Pay on delivery" only, and do not print "card/transfer" on flyers. Vendor payouts will fail with a clear message until step 3.

### C2. SMS for staff logins, Termii (Owner)
1. Register the Sender ID with Termii (needs CAC documents). Set `TERMII_SENDER_ID`.
2. Until then staff phone login works only through `DEV_AUTO_SIGNIN_PHONES` or email/password. Tell vendors/riders to use email+password or Google in the meantime.

### C3. Emails, Resend (Owner)
Needed for verification and password-reset emails, **and order-update emails** (built 2026-11-10: order paid,
accepted, rejected, delivered, failed; payouts; suspensions; disputes). They only go to accounts that have an
email address, and never block anything if sending fails.
1. resend.com -> free account -> API key -> `RESEND_API_KEY` in Render.
2. Resend -> Domains -> Add `closebuy.com.ng`, then add the DNS records it shows in Cloudflare (DNS -> Records).
   Until it verifies, Resend refuses to send from `no-reply@closebuy.com.ng` (logged, nothing breaks).
3. `EMAIL_FROM` is already set on Render to `CloseBuy <no-reply@closebuy.com.ng>`.

### C4. Google sign-in (Owner, free, no card)
1. console.cloud.google.com -> project CloseBuy -> **Google Auth Platform** (`/auth/overview`). Complete Branding (app name, support email, External audience).
2. **Clients -> Create client -> Web application**. Add redirect URI `<API_PUBLIC_URL>/auth/oauth/google/callback`.
3. Put the Client ID and secret in Render (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`).
4. While the app is in "Testing", only listed test users can sign in. Publish the app (Audience -> Publish) before launch.

### C5. Domain and branding (Owner)
1. Buy a domain (`.ng` or `.com`). Put it on Cloudflare (free DNS).
2. Add custom domains: `closebuy.xx` (customer), `vendor.`, `rider.`, `admin.`, `api.`. Cloudflare Workers custom domains for the four apps; a CNAME to Render for the API.
3. Update all `*_APP_URL`, `API_PUBLIC_URL`, `CORS_ORIGINS`, Google redirect URI, and each Cloudflare `NEXT_PUBLIC_API_URL`; rebuild.
4. Put the real URL on flyers (`[your website]/sell`) and make the `/sell` page or redirect exist (Claude can add a `/sell` redirect to the vendor application page).

### C6. Legal and contact (Owner)
1. Create the inbox `closebuy.ng@gmail.com` (or a domain address). The Terms and Privacy pages point to it.
2. Have a lawyer review Terms and Privacy. They are an unreviewed first draft.
3. Decide a support phone/WhatsApp number for flyers and put it in the app.

### C7. Business settings in the admin app (Owner)
Admin -> Config. Review and set: commission rates, delivery fee, vendor accept window, escrow holding window, rider cash float limit, service-area polygon (Riverpark), categories. These are versioned; each save is a new row.

---

## Phase D. Operations on day one

1. **Real vendors**: have each owner apply in the vendor app (or use the flyer), then approve them in admin -> Applications. Owners add their own products with real photos (paste hosted image URLs; there is no image upload yet).
2. **Riders**: recruit 2-3 riders, they apply in the rider app, you approve. Brief them on the 4-digit pickup/delivery codes and cash remittance (admin records remittances).
3. **Dry run with real people**: place one cash-on-delivery order end to end (customer -> vendor accept -> ready -> rider claim -> codes -> delivered). Fix anything odd before announcing.
4. **Support loop**: decide who watches admin -> Disputes and Orders daily, and who calls a rider/vendor when something stalls.
5. **Cash handling**: agree where riders remit cash and how often; record it in admin -> Riders.
6. **Monitoring**: UptimeRobot on `/health`, plus a weekly look at Render logs and admin metrics. Optional: an alert to your phone/email from UptimeRobot.

---

## Phase E. Go / no-go checklist (all must be yes)

- [ ] `/health` returns ok at the real API URL, and stays up for 24h with the pinger.
- [ ] All four apps load on their real URLs and sign-in works (email and at least one staff method).
- [ ] CORS verified for all four origins.
- [ ] Neon password rotated; no test/demo accounts reachable.
- [ ] At least 2 real vendors with real products and prices, 2 riders approved.
- [ ] One full order completed in front of you.
- [ ] Terms and Privacy live, contact inbox exists.
- [ ] Flyers say only what is true (pay on delivery now; no free delivery, promo codes or live map claims).
- [ ] You can see and answer a dispute in admin.

---

## Phase F. Soon after launch

1. **Always-on API host** (~$5-7/month): Railway/Render paid, or a naira/Hetzner VPS using `deploy/oracle/docker-compose.yml`. Needed for reliable order timers and Monnify payouts (static IP).
2. **Persistent Redis**: Render's free Redis does not keep data across restarts, so pending order timers can be lost. Use a paid Redis or the compose file's Redis with a volume.
3. **Account deletion** (Claude): not built; required by the app stores and good practice.
4. ~~**PWA install and web push**~~ **Done 2026-11-10.** Manifest, service worker, install icons and an alerts switch
   on each app's Notifications page; VAPID keys are set on Render. Tell vendors and riders to open the app, go to
   Notifications and turn the switch on. On iPhone they must tap Share -> Add to Home Screen first.
5. **App stores** (Owner + Claude): Google Play $25 once, App Store $99/year; wrap the customer app with Capacitor, add native Google sign-in and push notifications.
6. **Image uploads** (Claude): Cloudflare R2 for product photos and KYC documents (free tier), so vendors upload instead of pasting URLs.
7. **Money features needing a decision**: free-delivery threshold and promo codes (delivery fee currently goes 100% to the rider), size variants, rider tips.
8. **Search/Maps**: Google Places once Maps billing is possible; Nominatim works for landmarks now.

---

## Cost summary
- Minimum: domain (~$12/year) + free tiers (Cloudflare, Render free, Neon free, UptimeRobot).
- Realistic at launch: add an always-on API ($5-7/month) and paid Redis ($1-5/month). Monnify and Termii charge per use, no subscription.
