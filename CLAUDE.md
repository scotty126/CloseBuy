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

## Current state (2026-09-24)

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
inventory-race handling and order history/reorder are also done (see
above) — an earlier version of this section listed them as still to do,
which was wrong; verify against the code, not this list, before assuming
something isn't built:
1. **M3 hardening, real gaps confirmed by grepping the actual frontend
   (not by trusting the backend existing):**
   - **Ratings (US-C-10)** — the backend (`Order.rateOrder`,
     `POST /orders/:id/rate` + guest tracking-link equivalent) has **no
     uniqueness enforcement**: nothing stops a second `rate` call from
     creating a duplicate row for the same order+target, and there's no
     edit path at all despite the acceptance criterion "one rating per
     order per party, editable for 24 hours" — that needs a real schema/
     service change (a unique constraint + upsert-or-reject-past-24h
     logic), not just a UI. There's also zero average-rating aggregation
     anywhere (`VendorDto` has no rating field) and **zero frontend** —
     no rate form exists in any app. Bigger than it looks; don't scope it
     as "just add a button."
   - **Disputes (US-C-11)** — backend fully built and working (customer
     side, since before this session). **Zero frontend** — no "report a
     problem" UI in the customer app at all. Straightforward once
     scoped: follow the exact same "paste a hosted URL" pattern the
     vendor product-image field already uses for evidence (R2 isn't
     configured — ADR-0001 — so no real upload widget anywhere in this
     codebase yet, don't build one just for this).
   - Rider cash remittance (US-R-08), platform metrics (US-A-07),
     reconciliation report (US-A-05's other half) — not yet audited this
     closely; check the actual code before assuming scope.
2. **Desktop-responsive layout** for customer/vendor/rider — explicitly
   deferred pre-launch, mobile-only for now by the user's own call.
3. **ToS / Privacy Policy** — needed before real public launch and before
   Google OAuth can leave "Testing" mode.

**Just built (2026-09-24), not yet migrated onto the live DB** — disputes
(US-A-04, `apps/api/src/modules/admin/disputes.ts` + admin `/disputes`
list/detail), suspend-an-actor (US-A-06,
`apps/api/src/modules/admin/actors.ts` + admin `/vendors`/`/riders`, new
screens not in the original screens-navigation.md sketch), and config
writes (US-A-02, `apps/api/src/modules/admin/config.ts` + admin
`/config`, categories reusing `catalog.ts`'s existing-but-previously-unused
`categoryCreateSchema`/`CategoryDto` types). Adds
`PaymentStatus.partially_refunded` and an index on `disputes.status` —
migration `20260924120000_dispute_resolution_and_suspension` is written
but **not yet applied to Railway's Postgres** (see Conventions below for
how; a production-deploy action was blocked by the auto-mode classifier
mid-session, so it's still pending). Apply it, then smoke-test all three
flows against the live API before considering this fully done.

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
