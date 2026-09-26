# CloseBuy — project memory for Claude Code

Riverpark-focused (Nigeria) local delivery marketplace. Four customer-facing
apps (customer, vendor, rider, admin) plus a Fastify/Prisma API, built by a
solo developer. This file is what a fresh session should read first — it's
the "where were we" answer, kept current, not a static spec.

**Full design docs live in `docs/`** — `01-requirements/product-brief.md`
and `user-stories.md`, `02-design/data-model.md`, `api-contracts.md`,
`architecture.md`, `screens-navigation.md`, `03-planning/roadmap.md`. This
file summarizes; those are the source of truth when they disagree.

## Stack

Monorepo: pnpm workspaces + Turborepo. `apps/{customer,vendor,rider,admin,api}`,
`packages/{types,ui,api-client}`. Fastify + Prisma + PostgreSQL (Neon,
hosted) + Redis (Railway-hosted). Monnify for payments (ADR-0001). Termii
for staff SMS OTP. Next.js 15 for all four frontends, mobile-first for
customer/vendor/rider, desktop-first sidebar for admin (it's genuinely an
internal tool).

## Where things actually run

| What | Where |
|---|---|
| API | Railway — `closebuy-api-production.up.railway.app` |
| Database | Neon Postgres (hosted) |
| Redis | Railway-hosted (migrated off Upstash — free-tier command limit) |
| Customer | Netlify — `closebuy1.netlify.app` — **working** |
| Vendor | Netlify — `closebuy-vendor.netlify.app` — **working** (fixed 2026-09-26) |
| Rider | Netlify — `closebuy-rider.netlify.app` — **working** (fixed 2026-09-26) |
| Admin | Netlify — `closebuy-admin.netlify.app` — **working** (fixed 2026-09-26) |
| Local dev | customer `:3000`, vendor `:3001`, rider `:3002`, admin `:3003` — all four point `NEXT_PUBLIC_API_URL` at the live Railway API (`.env.local` per app, gitignored) since local Neon access is blocked (see Known issues) |

CI: GitHub Actions, postgres/redis service containers, `prisma migrate deploy`.

## Current state (2026-09-26)

**M1 (walking skeleton) is functionally complete and verified end to end**
against real infra — real order loop, real escrow ledger, real vendor
payout requests. The one M1 "done when" gap: **Monnify isn't configured at
all** (no API key/secret/contract code anywhere) — real card/transfer
payments don't work yet, only cash-on-delivery does. See Known issues.

Built and live:
- Full order loop: browse → cart → checkout → vendor accept/reject →
  dispatch → delivery/pickup → escrow release → **vendor-requested,
  admin-approved payouts** (deliberate redesign — admin never pushes money
  unprompted; see `apps/api/src/modules/payouts/`)
- Auth, all four roles, three independent methods each: phone+OTP,
  email+password, Google OAuth (Apple pending a paid dev account). Every
  identity (phone, email, Google account) is **unique per role, not
  globally** — the same real person can hold a customer AND vendor AND
  rider AND admin account, four distinct `User` rows. Admin can never be
  self-created through any of the three paths — always provisioned out of
  band. See `apps/api/src/modules/auth/`.
- `DEV_AUTO_SIGNIN_PHONES` (Railway env var, currently the owner's own
  number) — typing that number on any staff app's login skips Termii/OTP
  entirely, mints a real session. Owner convenience, not for real users.
  **This claim was wrong until 2026-09-26: it never worked from the UI**
  (see "Fixed" below) — for a *deployed* build it still doesn't until the
  fixed API/frontends ship. For the **admin** role it also only signs in an
  admin that already exists (`findOrCreateStaffUser`); the owner's admin
  account does exist (created 2026-09-17).
- 10 real vendors, 99 real products seeded in the live DB (not a mockup) —
  see `apps/api/scripts/seed-demo-vendors.mjs`. Real sourced product photos
  (Wikimedia/Unsplash/Pexels).
- Admin: application vetting (US-A-01), order oversight (US-A-03, full
  list/detail/transition-history/reassign-rider/force-cancel/force-refund),
  config writes (US-A-02 — `apps/api/src/modules/admin/config.ts` +
  admin `/config`, categories plus every rate/toggle/window, each write
  its own new versioned `Config` row, never an edit), dispute resolution
  (US-A-04 — queue + full/partial refund/reject, see
  `apps/api/src/modules/admin/disputes.ts`), suspend-an-actor (US-A-06 —
  `apps/api/src/modules/admin/actors.ts` + admin `/vendors`/`/riders`
  screens, not in the original screens-navigation.md sketch), audit-log
  search (US-A-08), platform metrics (US-A-07, below). Not yet:
  reconciliation (US-A-05's other half) — M-priority (M3), a real
  placeholder still exists at `apps/admin/app/payouts`.
- Customer UI restyled toward the DoorDash reference kit (structural/layout
  only — brand green/orange stays, deliberately not DoorDash's red).
- Delivery-pin map on checkout (`@vis.gl/react-google-maps`) — additive,
  renders nothing without `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (not yet set).
- CORS, security fixes (public vendor endpoints were leaking bank details —
  fixed), CI green.
- Self-service cancellation (US-C-08, `Order.cancelOrder` + the Cancel
  button on the tracking page), atomic per-item stock decrement on vendor
  accept (US-V-04, data-model.md §6 invariant 4) — both already fully
  built, contrary to an earlier stale "still to do" note in this file.
  Verify against the actual code before trusting any "not built yet" claim
  here, this file has been wrong about that before.
- Order history + **reorder** (US-C-09) — history was already built;
  reorder is new (2026-09-24, `apps/customer/lib/cart.tsx`'s
  `replaceCartItems` + the Reorder button on the tracking page). Re-fetches
  the vendor's *live* catalogue rather than trusting the order's own
  price/name snapshot, silently drops anything gone inactive or sold out,
  and reuses the existing single-vendor-cart conflict prompt if the cart
  currently holds a different vendor's items. Verified against the live
  API in a real browser, including the conflict path.
- **Report a problem** (US-C-11, 2026-09-24) — "Report a problem" on the
  tracking page (`apps/customer/app/orders/track/[token]/page.tsx`),
  reason + optional evidence (same "paste hosted URLs, one per line"
  pattern the vendor product form already used — R2 still isn't
  configured, ADR-0001). Uses the trackingToken route for both guest and
  signed-in customers alike (US-C-06a), matching how the rest of this
  screen already works. Fixed two real gaps found while wiring it up:
  `Order.disputeOrder` had no guard against a second dispute on the same
  order (would have hit the DB's `@unique` constraint as an unhandled
  500), and `trackingInclude` didn't join `dispute` at all, so the
  frontend had no way to know one already existed — both fixed
  (`DisputeAlreadyExistsError`, `OrderDto.dispute`). Verified against the
  live API for the negative path (button correctly hidden pre-delivery);
  the positive path (an actual DELIVERED order) is covered by new unit
  tests in `order/service.test.ts` but **not yet exercised live** — doing
  so needs a vendor (and for delivery orders, a rider) account to walk an
  order through accept → ready → confirm, and this session had no
  vendor/rider/admin credentials to do that with.
- **Ratings** (US-C-10, 2026-09-26) — rate form on the tracking page once
  an order is `COMPLETED` (vendor always, rider on a delivery order),
  pre-filled/editable inside the original 24h window, read-only stars
  after. Backend gaps fixed along the way: `Rating` is now
  `@@unique([orderId, targetType])` (was nothing — a second POST made a
  duplicate row) and `Order.rateOrder` upserts against it, rejecting past
  `editedUntil` with `RatingLockedError` (409). `trackingInclude` joins
  `ratings` so the screen can pre-fill. **The star badge on vendor cards
  and the storefront page was showing `reliabilityScore` — an internal ops
  metric that only ever decreases on a vendor's own auto-reject/reject —
  not a customer rating.** Replaced (user's call, 2026-09-26) with the
  real average + count from `Rating` (`VendorDto.ratingAverage`/
  `ratingCount`, `catalog/service.ts`'s `vendorRatingSummaries` — one
  `groupBy` per search page, not N+1), showing "New" until a first real
  rating exists. `reliabilityScore` is no longer on the public
  `VendorDto` at all; it stays on `OwnVendorProfileDto` (the vendor's own
  view) and admin. So every seeded demo vendor now shows "New", not a
  polished "4.4" — that's deliberate, not a regression. The customer
  frontend uses `!= null` (not `!== null`) on `ratingAverage` so a
  frontend running against a not-yet-redeployed API degrades to "New"
  instead of crashing — that exact mismatch crashed the home page locally
  (`toFixed` on `undefined`) because local dev points at the live Railway
  API, which doesn't have the new field until this is pushed and deployed.
  Positive path (an actual `COMPLETED` order being rated) is covered by
  new unit tests in `order/service.test.ts`/`catalog/service.test.ts` but
  **not exercised live** — reaching `COMPLETED` needs a real delivery plus
  the escrow-release timer (or an admin dispute resolution), and this
  session had no vendor/rider/admin credentials.

- **Rider cash remittance** (US-R-08, 2026-09-26) — the "open question"
  the design docs kept flagging (rider-initiated vs admin-recorded) was
  answered by the story's own acceptance criteria: *"a remittance is
  recorded by admin"*. So: admin records it
  (`apps/api/src/modules/admin/remittances.ts`, `POST
  /admin/riders/:id/remittances`, form + history on the admin `/riders`
  cards), the rider only *reads* their history (`GET
  /riders/me/remittances`, rider `/earnings`) — deliberately no rider
  "remit" button, a rider logging their own handback would just be editing
  their own debt. The decrement is a guarded atomic `updateMany`
  (`cashBalanceMinor >= amount`) in one transaction with the row + audit
  entry, so it can't go negative and a repeated entry can't double-count;
  an amount over the outstanding balance is refused (422). **Float limit:**
  once the balance is strictly over `rider_cash_float_limit_minor`
  (admin-editable on `/config`), cash-on-delivery jobs vanish from the
  offers list *and* are refused at claim time (409 `CASH_FLOAT_LIMIT`, own
  error so a rider isn't told "someone else took it"), enforced inside the
  atomic claim's own filter. Limit **falls back to a ₦100,000 placeholder
  when no Config row exists** (`lib/config.ts`) — it was added after the
  seed ran and a 500 on every rider endpoint until someone seeds
  production would be far worse. Remittances live in their own table
  (`rider_cash_remittances`), **not** as ledger entries:
  `ledger_entries.orderId` is NOT NULL and a remittance belongs to no
  order — same reason `Payout` is separate. **Consequence for US-A-05:**
  reconciliation has to fold remittances in alongside the ledger's
  `rider_cash_float` account (the ledger only ever sees the debit side,
  cash collected), same as it will for payouts. Rider screens tolerate an
  API that hasn't been redeployed yet (`!= null` on the new limit field,
  history fetched independently) after the ratings crash taught that
  lesson. Verified by 22 new unit tests (typecheck/build clean); **not
  exercised live** — the live API doesn't have the endpoints or table yet,
  and local dev can't reach the DB.
- Known weak spot next to this (pre-existing, not fixed): `confirmDelivery`
  posts the COD ledger entries and increments `cashBalanceMinor` as
  separate statements, not one transaction — if the second fails after the
  first, the ledger and the counter drift. Worth wrapping in
  `$transaction` before real COD volume.

- **Platform metrics** (US-A-07, 2026-09-26) — `GET /admin/metrics?from&to`
  (`apps/api/src/modules/admin/metrics.ts`) + the admin `/metrics` screen:
  stat tiles (orders, gross value, completion rate, average delivery time,
  failed, disputed, active vendors/riders) and two *separate* column charts
  (orders/day, gross/day — different scales, never one dual-axis plot),
  filterable by date range. **The definitions are the contract and are
  restated on the screen** ("How these are counted"): everything is
  cohorted by placement day in Africa/Lagos (UTC+1, fixed — Nigeria has no
  DST); "placed" excludes abandoned `PENDING_PAYMENT` checkouts; completion
  rate = fulfilled ÷ (fulfilled + cancelled/refunded + failed) so in-flight
  orders don't drag it down; gross excludes cancelled/refunded but **does
  not net out goodwill or partial-dispute refunds** (those deliberately
  leave `Order.status` alone, so they can't be seen from here); average
  delivery time is PAID→DELIVERED for delivery orders only with scheduled
  ones excluded. `openDisputes` and the *approved* vendor/rider counts are
  "right now", not range-scoped. The per-day series is built in
  application code from one row per order, hence the 366-day range cap
  (422 `INVALID_RANGE`); at that scale a `date_trunc` `GROUP BY` would be
  the upgrade path, at the cost of being un-unit-testable against the
  in-memory fakes. **No new migration, no new Config key.**
  Chart notes for whoever touches it next: `ColumnChart.tsx` is hand-built
  SVG (the admin app has no chart library) following the `dataviz` skill's
  mark specs. The brand green (`#255748`) **fails that skill's
  categorical-palette validator** on lightness band and chroma floor —
  those checks guard telling hues apart from each other, moot for a single
  series; it passes the contrast check against white, and the alternatives
  (the status green, the action orange) are reserved. Y-axis ticks are
  whole numbers only: rendering a quiet week showed a "1.5 orders" axis
  that no type check or unit test would have caught — **there is no
  browser tool in some sessions, but you can still look**: server-render
  the component to static HTML with the CSS from `apps/admin/.next`, then
  `msedge --headless --screenshot=…` and open the PNG. Verified that way
  (charts) plus 17 API tests (the timezone bucket boundaries and each
  definition); the full page against the live API is **not exercised**
  — the endpoint isn't deployed and the screen needs an admin session.

**Fixed (2026-09-26) — staff auto-signin never worked from the UI.**
`POST /auth/otp/request` returned the auto-signin session's fields at the
top level (`{accessToken, refreshToken, user}`) while all three staff login
pages waited for `res.session`, so `res.session` was always undefined and
the page always fell through to the code step — even for the owner's own
allowlisted number with a real admin account. Both sides date from the same
commit (`3198c8b`); the service logic (`tryAutoSignin`) was unit-tested but
nothing ever checked the response shape between route and pages. Fix:
shared `OtpRequestResponse` type in `packages/types/src/auth.ts` (the route
is now typed against it, so a mismatch is a compile error), route returns
`{ session }`, and `api-client`'s `requestOtp` also accepts the old top-level
shape so it worked against an API that hadn't been redeployed — **that shim is
deleted now** (the fixed API has been live since the 2026-09-26 deploy).
Found because the owner tried to sign into the local admin app to approve
test accounts.

**Fixed (2026-09-24) — a real, live bug, not hypothetical:** every
body-less `POST` through the shared `packages/api-client/src/client.ts`
(vendor accept-order, vendor mark-ready, rider accept/decline-offer,
admin approve-application, customer cancel-order) sent
`Content-Type: application/json` with no body. Fastify's default JSON
parser rejects that outright (`FST_ERR_CTP_EMPTY_JSON_BODY`, a real 400) —
reproduced live against the production API while testing reorder, not a
theoretical bug. `client.ts`'s `request()` now only sets that header when
`init.body` is actually present. One-line fix, fixes all six call sites at
once (the whole point of the shared package). **If anything upstream of
this still behaves like the old cancel/accept/ready buttons doing
nothing silently, that's not fixed elsewhere — check this.**

## What's next

In priority order, picking up from the admin buildout — every S/M-priority
Admin story (US-A-01 through US-A-04 and US-A-06 through US-A-08) is now built;
only reconciliation remains there. Self-service cancellation,
inventory-race handling, order history/reorder, disputes and ratings are
also done end to end (see above), as is rider cash remittance — an
earlier version of this section listed some of these as still to do,
which was wrong; verify against the code, not this list, before assuming
something isn't built:
1. **M3 hardening — what's genuinely left.** The customer-facing S-priority
   stories (US-C-08 through US-C-11) are all built now. Still to do, none
   of it audited closely yet — grep the actual frontend, don't trust that a
   backend endpoint existing means the feature does (that's exactly how
   disputes and ratings turned out to have working-looking backends and
   zero UI, plus real gaps under them):
   - The reconciliation report (US-A-05's other half) — still an admin
     placeholder, and the last unbuilt Admin story. It must account for
     `rider_cash_remittances` and `Payout` rows alongside the ledger —
     neither posts ledger entries (see the remittance note above) — and
     for goodwill/partial-refund money that metrics' gross can't see.
   - US-R-06 (failed delivery) and the other rider/vendor S-stories —
     unchecked.
2. **Desktop-responsive layout** for customer/vendor/rider — explicitly
   deferred pre-launch, mobile-only for now by the user's own call.
3. **ToS / Privacy Policy** — needed before real public launch and before
   Google OAuth can leave "Testing" mode.

**Deployed 2026-09-26 (owner asked for it explicitly).** Everything from
2026-09-24 onward is pushed to `main` and live: Railway rebuilt the API from
the Dockerfile (verified by `ratingAverage` appearing in `GET /vendors`) and
the customer site auto-rebuilt from the same commit. The three hand-written
migrations were applied with
`railway ssh -- sh -c "cd /app/apps/api && npx prisma migrate deploy"` —
Railway does **not** run migrations on start, so every future schema change
needs that step after the deploy, or the new code queries columns that don't
exist:
- `20260924120000_dispute_resolution_and_suspension` — adds
  `PaymentStatus.partially_refunded` and an index on `disputes.status`.
- `20260926090000_rating_unique_per_order_target` — a unique index on
  `ratings(orderId, targetType)`. The duplicate check came back empty (0 rows)
  before applying, as expected — no rating UI had ever existed.
- `20260926140000_rider_cash_remittances` — new `rider_cash_remittances`
  table (US-R-08). `prisma/APPEND_ONLY.sql`'s REVOKE line for it is **not**
  applied and would achieve nothing anyway (the app is the table owner — see
  the ledger note under Conventions).

(An earlier session's `migrate deploy` was refused by the auto-mode
classifier as a production deploy; it went through this time because the
owner had asked for the deploy in so many words. Don't try it unprompted.)

Verified after the deploy: the full e2e (39 checks) passes against the new
API; the earnings endpoint returns the cash-limit field; the remittance
history endpoint exists; the public vendor list carries the real rating
average/count and no longer leaks `reliabilityScore`; tracking returns
`ratings` and `dispute`; every new admin route answers 401 without a
session; CORS preflight is allowed from all four Netlify origins and refused
for an unknown one. **Not yet exercised live:** anything that needs an admin
session — the cash-limit gate (lower the limit on admin `/config`, watch the
COD job vanish and a direct claim get 409 `CASH_FLOAT_LIMIT`), recording a
remittance from admin `/riders`, resolving a dispute, metrics against real
rows. Those are the next things to walk through in a browser.

## Smoke-testing the live order loop

`apps/api/scripts/e2e-lifecycle.mjs` drives the whole order-to-delivery
loop through the real HTTP API (no browser needed): guest cash-on-delivery
checkout → vendor accept → ready → rider claim → collection code → delivery
code + exact cash → `DELIVERED`, with the guards (wrong collection code,
wrong delivery code, wrong cash amount, double claim, idempotent replay) and
the books (stock decrement, rider cash balance, escrow held, transition
history and actors) checked at each step — ~39 assertions.

- `node apps/api/scripts/e2e-lifecycle.mjs setup` creates a test vendor and
  rider through the real signup/apply flow. They land `pending` and **only
  an admin can approve them** (admins are never self-created) — do it on the
  admin app's Applications page. Then `... run`.
- **Passed in full on 2026-09-26** against the live API both before and
  after the deploy above (39 checks each time) — the M1 loop is genuinely
  sound and the deploy didn't break it. Not covered: anything in the UIs
  themselves (it drives the API, not a browser), escrow release →
  `COMPLETED` (a 48h timer, or an admin rejecting a dispute), ratings,
  disputes, admin-recorded remittance, the cash-limit gate, metrics — all of
  which need an admin in the loop.
- **Re-run it after every deploy** — it's the fastest way to prove a push
  didn't break the core loop. `E2E_API_URL` points it elsewhere.
- **It writes real rows** to whatever it targets. Left behind in the live
  DB: `claude-e2e-vendor@example.com` / `claude-e2e-rider@example.com` (the
  vendor is named "E2E Test Vendor (delete me)", closed; the rider off duty,
  and **owing ₦8,100 in uncollected cash** from three delivered orders — a
  ready-made case for trying the cash-limit gate and remittance), two
  products, three orders sitting in `DELIVERED` (the escrow timer will move
  them to `COMPLETED` on its own, crediting the test vendor). Clean them up
  with the admin suspend screen (`/vendors`, `/riders`) when done testing.
  Their generated passwords live in the
  OS temp dir (`closebuy-e2e-state.json`), never in the repo.

## Known issues / external blockers

Things that are broken or waiting on something outside this codebase —
don't re-diagnose these from scratch, they're understood:

- **Monnify not configured** — no `MONNIFY_API_KEY`/`SECRET_KEY`/
  `CONTRACT_CODE` set on Railway. Real payments don't work; cash-on-delivery
  does. Disbursements (real vendor payouts) additionally need Monnify
  account-side setup: enable API disbursements, disable OTP, whitelist a
  static outbound IP — communicated to Monnify separately, not done yet.
- **SECURITY — `OTP_DEV_FALLBACK=true` on a `NODE_ENV=production` API
  hands out login codes to anyone.** In that mode `POST /auth/otp/request`
  returns the code **in the response body**, unauthenticated
  (`auth/routes.ts`, `termii.ts`'s dev client) — so anyone who knows a staff
  phone number (a vendor's, a rider's, the admin's) can request a code, read
  it back, and verify to get a session as them. Confirmed by reading the
  code and the live Railway variables (2026-09-26). Harmless while
  everything is demo data; **serious the moment a real vendor exists** (they
  could change bank details and request payouts; admin approval on payouts
  is the only remaining net). Not fixed, on purpose — it's a decision that
  changes how the owner logs in. The one-variable fix is
  `OTP_DEV_FALLBACK=false` on Railway: the owner's number still works
  (auto-signin is checked before that gate), and email/password + Google
  sign-in are unaffected. The proper fix is to never return `devCode` when
  `NODE_ENV === "production"`. Also: the demo vendors' phones are
  sequential dummies (`+2348010000001`–`10`) in `seed-demo-vendors.mjs`, so
  they're guessable — another reason to fix this before launch.
- **Termii Sender ID pending CAC approval** — `TERMII_API_KEY` is set,
  `TERMII_SENDER_ID` isn't. Real SMS OTP blocked; worked around via
  `OTP_DEV_FALLBACK` (see the security note above — that workaround is
  also the hole) and the auto-signin allowlist.
- **Netlify — fixed 2026-09-26, and the old diagnosis was wrong.**
  `closebuy-vendor` was serving the *Admin* app (its site-level Package
  Directory pointed at `apps/admin`, and it also carried a build-command
  override filtering on admin), and `closebuy-rider`/`closebuy-admin` had never
  been connected to the repo. All three are now linked with the right
  `package_path` and build fine; `curl` of each `/login` returns its own
  app (CloseBuy Vendor / Rider / Admin) with the live Railway API URL baked in
  (`NEXT_PUBLIC_API_URL` is inlined at build time, so changing it needs a
  rebuild). Earlier notes here said the Netlify API "silently refuses
  build-setting changes for this account" — it doesn't: the Package Directory
  is `build_settings.package_path` and is set through the **`repo` object** of
  `updateSite` (`netlify api updateSite` via the Netlify CLI works). The earlier
  failed attempts most likely wrote to the wrong place, though that wasn't
  isolated. `closebuy1` (customer)
  auto-deploys from `main`.
- **Google Cloud Billing won't complete for the account owner** — error
  `OR_BACR2_59`, "we were unable to set up your account." This blocks
  `GOOGLE_MAPS_API_KEY`/`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Maps Platform
  requires billing) even though the same card works fine for other Google
  products. Known pattern for Nigerian accounts specifically. Google OAuth
  itself is unaffected (no billing needed) and is fully working.
- **Apple OAuth** — needs a $99/year paid Apple Developer account. Deferred
  by the user's own choice; code is ready (`oauth-routes.ts` is
  provider-agnostic), just needs real credentials in `.env`/Railway.
- **ESET Security (this dev machine)** intermittently blocks local
  connections — Neon Postgres, Redis TLS handshakes, MSI installers all hit
  this at different points. Pattern: TCP connects, then the
  protocol/handshake silently hangs. **Workaround, not fixed:** local API
  dev can't reach the live Neon DB directly — DB operations from this
  machine go through `railway ssh -- sh -c "cd /app/apps/api && node
  --input-type=module -"` (pipe a plain `.mjs` script via stdin — no tsx on
  the container, so no TypeScript) instead of running Prisma locally. All
  four frontend apps' local dev servers point `NEXT_PUBLIC_API_URL` at the
  *live* Railway API for the same reason.
- **Port 3000 sometimes gets reclaimed** by an unrelated sibling project
  ("Bludors Paint") that also runs on this machine, in a separate Claude
  Code session. If `localhost:3000` shows the wrong app, that's why — check
  `netstat -ano | grep :3000`, confirmed OK to stop that process and
  restart the customer app's `pnpm dev` (established with the user).

## Conventions worth knowing before changing things

- **Migrations can't run locally** (see ESET above). Write the migration
  SQL by hand when `prisma migrate dev` can't reach the DB, matching
  Prisma's own generated format exactly, then apply via
  `railway ssh -- sh -c "cd /app/apps/api && npx prisma migrate deploy"`
  once the code (including the migration file) is pushed and deployed.
  Always `npx prisma generate` locally afterward so the TS client matches.
- **Each module owns its own Prisma access, even for tables other modules
  also touch.** `dispatch/service.ts` and `order/service.ts` and
  `admin/orders.ts` all read/write `Order` directly, each with its own
  local `writeTransition`/`notifyCustomer` helper — not shared via
  cross-module imports. This is deliberate (established precedent), not
  duplication to clean up.
- **Identity is unique per role, not globally**, for phone, email, and
  OAuth accounts (`@@unique([x, role])` in schema.prisma, not `@unique`).
  Any new auth-adjacent code must look up by the composite key
  (`email_role`, `phone_role`, `provider_providerAccountId_role`), never by
  the bare field.
- **Admin can never be self-created**, through any of the three auth
  methods. Every path independently enforces "admin must already exist" —
  `findOrCreateStaffUser` (service.ts), `AdminSelfRegistrationDisabledError`
  (email.ts), `OAuthAdminNotProvisionedError` (oauth-account.ts). If you add
  a fourth auth method, it needs the same guard.
- **The ledger is append-only by code discipline, NOT by DB grant —
  despite what this file and `data-model.md` §6 used to claim.** Checked
  against production on 2026-09-26: the app connects as `neondb_owner`,
  the table *owner*, which holds `UPDATE`/`DELETE`/`TRUNCATE` on
  `ledger_entries`, `audit_log`, `order_state_transitions` and `config`.
  `apps/api/prisma/APPEND_ONLY.sql` was never effective — and revoking from
  an owner would be toothless anyway, since it can grant itself back. What
  *is* true: no application code updates or deletes those tables (grepped,
  no raw SQL either), corrections are always a new reversing entry, and
  `Config` writes are always a new version. What's missing is any defence
  against a bug or a leaked credential. **Real fix (not done — it changes
  the DB role setup):** create a separate non-owner role for the app, point
  `DATABASE_URL` at it, keep the owner on `DIRECT_URL` (already what
  `schema.prisma` separates it for, and what migrations use), then run
  `APPEND_ONLY.sql` for that role. Do this before real money moves. The
  same applies to `rider_cash_remittances`, whose REVOKE line is in that
  file but equally inert today. Corrections are always a new reversing
  entry, never an edit.
- **Netlify monorepo config**: "Package Directory" (not "Base Directory")
  with `netlify.toml` living inside that app's own folder
  (`apps/<app>/netlify.toml`, correct build command + `@netlify/plugin-nextjs`)
  — this is the combination that works. Set it in the dashboard, or through
  the API's `repo` object (`build_settings.package_path`); see the Netlify
  note under Known issues. Don't leave a site-level build-command override
  in place — that's what made the vendor site build the admin app.
- **Real content only** — no mocked vendors, no fake payment flows, no
  decorative UI for features without a real backend. When something can't
  be built for real yet (Monnify, Maps, Apple), it's left visibly absent
  or gracefully degraded (buttons that 503 with a clear message, components
  that render nothing), never faked.
- Attribution lines (`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
  on commits, the GitHub-Code line on PRs) — always include per the
  system's own standing instruction, not optional.

## Who's who

Solo developer, first Claude Code session start-to-now spans the whole
build. Git identity: `Giwa-lu`. Riverpark is the real, specific launch
neighborhood (brief §2a) — the actual traced service-area polygon lives in
`prisma/seed.ts`, not a placeholder shape.
