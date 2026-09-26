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
| Vendor | Netlify — `closebuy-vendor.netlify.app` — **broken**, see Known issues |
| Rider | Netlify — `closebuy-rider.netlify.app` — **broken**, see Known issues |
| Admin | Netlify — `closebuy-admin.netlify.app` — **broken**, see Known issues |
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
  search (US-A-08). Not yet: reconciliation (US-A-05's other half),
  metrics (US-A-07) — both M-priority (M3), real placeholders exist in
  `apps/admin/app/*`.
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
Admin story (US-A-01 through US-A-04, US-A-06, US-A-08) is now built;
only reconciliation and metrics remain there. Self-service cancellation,
inventory-race handling, order history/reorder, disputes and ratings are
also done end to end (see above) — an earlier version of this section
listed some of these as still to do, which was wrong; verify against the
code, not this list, before assuming something isn't built:
1. **M3 hardening — what's genuinely left.** The customer-facing S-priority
   stories (US-C-08 through US-C-11) are all built now. Still to do, none
   of it audited closely yet — grep the actual frontend, don't trust that a
   backend endpoint existing means the feature does (that's exactly how
   disputes and ratings turned out to have working-looking backends and
   zero UI, plus real gaps under them):
   - Rider cash remittance (US-R-08) — check whether the rider app has
     any remit UI at all, and what `RiderProfile.cashBalanceMinor` is
     actually wired to.
   - Platform metrics (US-A-07) and the reconciliation report (US-A-05's
     other half) — both still admin placeholders.
   - US-R-06 (failed delivery) and the other rider/vendor S-stories —
     unchecked.
2. **Desktop-responsive layout** for customer/vendor/rider — explicitly
   deferred pre-launch, mobile-only for now by the user's own call.
3. **ToS / Privacy Policy** — needed before real public launch and before
   Google OAuth can leave "Testing" mode.

**Nothing from 2026-09-24 onward is pushed or deployed — everything below
is committed locally only, and two migrations are unapplied.** Disputes
(US-A-04), suspend-an-actor (US-A-06), config writes (US-A-02), reorder,
report-a-problem, ratings, and the `client.ts` bodyless-POST fix all sit
in local commits on `main`. The two migrations, both hand-written and both
**not applied to Railway's Postgres** (see Conventions below for how; a
production-deploy action was blocked by the auto-mode classifier
mid-session, so applying them is a step the owner has to run or explicitly
allow):
- `20260924120000_dispute_resolution_and_suspension` — adds
  `PaymentStatus.partially_refunded` and an index on `disputes.status`.
  Disputes/suspend/config-writes need it.
- `20260926090000_rating_unique_per_order_target` — a unique index on
  `ratings(orderId, targetType)`. It would fail to apply if any duplicate
  rating rows exist; that's very unlikely (no rating UI ever existed, so
  the table should be empty) but unchecked — if it errors, look for
  duplicates first rather than dropping the constraint.

**Deploy order matters for ratings.** The customer frontend now reads
`VendorDto.ratingAverage`/`ratingCount` and the API no longer sends
`reliabilityScore` on public vendor endpoints. New frontend + old API
degrades gracefully (`!= null` → "New", verified locally — that mismatch is
what crashed the home page before the guard was added). New API + old
frontend is the worse direction: the old `VendorCard` calls
`Number(vendor.reliabilityScore)` on a field that's gone → `NaN` → every
card shows "New" (no crash, but the badge is wrong until the frontend
catches up). Since it's one monorepo and one push, both platforms rebuild
from the same commit; just expect a short window. Apply the migrations,
then smoke-test disputes, suspension, config, cancel/accept/ready buttons
(the `client.ts` fix) and the vendor-card badge against the live API
before considering any of it done.

## Known issues / external blockers

Things that are broken or waiting on something outside this codebase —
don't re-diagnose these from scratch, they're understood:

- **Monnify not configured** — no `MONNIFY_API_KEY`/`SECRET_KEY`/
  `CONTRACT_CODE` set on Railway. Real payments don't work; cash-on-delivery
  does. Disbursements (real vendor payouts) additionally need Monnify
  account-side setup: enable API disbursements, disable OTP, whitelist a
  static outbound IP — communicated to Monnify separately, not done yet.
- **Termii Sender ID pending CAC approval** — `TERMII_API_KEY` is set,
  `TERMII_SENDER_ID` isn't. Real SMS OTP blocked; fully worked around via
  `OTP_DEV_FALLBACK` (real codes, logged not texted) and the auto-signin
  allowlist above.
- **Netlify: vendor/rider/admin sites broken.** `closebuy-vendor` has its
  Package Directory pointed at `apps/admin` (copy-paste mistake, builds the
  wrong app). `closebuy-rider`/`closebuy-admin` were never connected to the
  repo at all — empty config, zero deploys ever. Fix is manual, in the
  Netlify dashboard — **the API here silently refuses build-setting changes
  for this account** (confirmed repeatedly), so don't try the API route
  again, go straight to the dashboard. `closebuy1` (customer) works fine.
  Also blocked short-term on exhausted Netlify build credits (resets daily).
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
- **The ledger is append-only by DB grant**, not just convention —
  `ledger_entries` and `audit_log` have `UPDATE`/`DELETE` revoked for the
  app role (`apps/api/prisma/APPEND_ONLY.sql`). Corrections are always a
  new reversing entry, never an edit.
- **Netlify monorepo config**: "Package Directory" (not "Base Directory")
  set via the dashboard, with `netlify.toml` living inside that app's own
  folder — this is the only combination that's worked. The Netlify API
  does not reliably persist build-setting changes for this account; use
  the dashboard.
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
