# CloseBuy — Local Development Setup

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 04 — Implementation

Covers what M0 actually built (roadmap.md) and how to run it. Update this file as later milestones add real requirements — it should always be the one place a fresh clone needs to read to get running.

## Prerequisites

- Node.js ≥ 20
- pnpm — `corepack enable && corepack prepare pnpm@latest --activate`, or `npm install -g pnpm` if corepack can't write to a system path (that's what this environment needed)
- Docker Desktop (or any local Postgres 16 + Redis 7 you already run)
- Optional: a [Termii](https://termii.com) account — needed only for vendor/rider/admin OTP sign-in, which has no onboarding UI yet regardless (M1). The API boots and everything else works without it; a Sender ID needs CAC business verification, so this is genuinely fine to defer.
- A free [Resend](https://resend.com) account — needed for customer email verification/password-reset emails. Customer register/login work without it; only the emails won't send.
- Optional: a Google Cloud OAuth client, for "Continue with Google" — everything else works without it (brief §3.1b).
- Optional: a [Monnify](https://developers.monnify.com) sandbox account — needed only for card/transfer checkout. Cash on delivery works without it, and that's most of what proves the order lifecycle end to end.
- Optional: `SEED_ADMIN_PHONE` — an E.164 number to seed as the one admin account (`pnpm db:seed`). Admin sign-in is deliberately never self-service like vendor/rider are (see M1 progress below), so without this there's no way to reach Admin locally at all.
- Optional: VAPID keys (`npx web-push generate-vapid-keys`) — needed only for actual Web Push delivery. The in-app notification feed (`GET /notifications`) works fully without them.

## First-time setup

```bash
pnpm install

# Local Postgres + Redis
docker compose up -d

# Root .env — copy and fill in DATABASE_URL/REDIS_URL (docker-compose.yml's
# values work as-is), JWT secrets (any long random string locally), and
# your Termii sandbox key + sender ID.
cp .env.example .env
cp .env.example apps/api/.env   # apps/api reads its own .env; the Prisma
                                 # CLI in particular only looks here, not
                                 # the repo root

pnpm db:generate
pnpm db:migrate       # first migration — creates every table in data-model.md
pnpm db:seed          # categories — admin-managed (US-A-02) but there's no
                       # admin UI yet, so vendor applications/products need
                       # somewhere to point their category_id at

# One-off, after the first migration only — see the file for why this
# can't be a Prisma migration itself:
psql "$DATABASE_URL" -f apps/api/prisma/APPEND_ONLY.sql
```

## Running it

```bash
pnpm dev   # every app + the API, in parallel, via Turborepo
```

| App | URL |
|---|---|
| API | http://localhost:4000 (health check: `/health`) |
| Customer | http://localhost:3000 |
| Vendor | http://localhost:3001 |
| Rider | http://localhost:3002 |
| Admin | http://localhost:3003 |

Each client reads `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:4000`, which is correct for local dev — no `.env.local` needed unless pointing at a deployed API).

## What M0 actually built

Per roadmap.md M0 — verified working as of this commit (`pnpm typecheck && pnpm lint && pnpm build && pnpm test`, all green):

- **Monorepo scaffold** — pnpm workspaces + Turborepo, `apps/{customer,vendor,rider,admin,api}`, `packages/{types,ui,api-client}`, per ADR-0001.
- **Database schema** — the full Prisma schema from data-model.md, `prisma validate` clean, first migration ready to run.
- **Two auth paths, by role (brief §3.1b), both real end to end:**
  - Vendor/rider/admin: phone + OTP, unchanged from the original M0 build — real Termii integration, 5-attempt/15-minute lockout, unit-tested (`apps/api/src/modules/auth/service.test.ts`).
  - Customer: email/password (argon2id) + Google/Apple OAuth, browsing and checkout never gated behind sign-in at all. Register/login/forgot-password/reset-password/verify-email are all real and unit-tested (`apps/api/src/modules/auth/customer/service.test.ts`, 10 tests). Google sign-in is real (via `openid-client`) but needs a real OAuth client to actually complete; Apple is structurally in place but genuinely untestable without a paid Apple Developer account.
- **`packages/ui`** — brand tokens pixel-matched to the brand guide, a shared Tailwind preset, and the first component set (Button, Input, Card, StatusBadge, Sidebar, Placeholder).

## M1 progress

- **Catalog, real** — public browse/search (`GET /vendors`, `/vendors/:id`, `/vendors/:id/products`), vendor application (US-V-01), self-service storefront and product CRUD (US-V-02/03), all real against Postgres, all unit-tested (`apps/api/src/modules/catalog/service.test.ts`, 6 tests, including a cross-tenant access-control check — vendor B genuinely cannot edit vendor A's product). Categories are seeded (`pnpm db:seed`), not yet admin-manageable — that's Admin, still unbuilt.
- Known gap, not silently ignored: `lat`/`lng` search params are accepted but not yet used for distance filtering — needs PostGIS or an application-level distance calculation, neither built.
- **Service area, real mechanism, real boundary.** `lib/geo.ts` does real point-in-polygon checking, wired into both delivery checkout and vendor applications, unit-tested (`lib/geo.test.ts`). `prisma/seed.ts`'s `service_area_polygon` is Riverpark's actual traced boundary (a geojson.io export, converted from GeoJSON's `[lng, lat]` order to this app's `{lat, lng}` shape) — not a placeholder. If it ever needs redrawing, the same conversion applies; run `pnpm db:seed` again after editing the array.
- **Order & Checkout, real** — `POST /checkout` (server-side re-validation of price/stock/vendor status, the full guest-vs-signed-in split from brief §3.1b, idempotent on the client's `Idempotency-Key`), a real double-entry escrow ledger (`apps/api/src/modules/order/ledger.ts` — pure functions, 7 unit tests just on the balance math), the Monnify integration (`apps/api/src/modules/payments/monnify.ts` — auth, initialize-transaction, webhook signature verification, refund, every shape checked against Monnify's actual docs rather than assumed), and BullMQ-backed timers for the vendor accept-window auto-reject and the post-delivery escrow-release window (`apps/api/src/modules/order/jobs.ts`). 24 more unit tests across `order/service.test.ts` (17) and `order/ledger.test.ts` (7) — 45 total now, up from 21.
  - **Fully working without any Monnify credentials:** cash-on-delivery orders — checkout, vendor accept (with atomic stock decrement), reject-and-refund-logic (a no-op for cash, correctly), mark-ready, and pickup-order completion all run end to end once a local Postgres/Redis exist.
  - **Needs real Monnify sandbox credentials to actually complete:** card/transfer checkout and the webhook that confirms it — the code is real and correct against Monnify's documented API shapes, just not live-tested end to end yet.
- **Dispatch, real** — rider application (US-R-01), duty toggle (US-R-02), and the full pickup/delivery confirmation flow (US-R-03 through 07), completing the order lifecycle for delivery orders that Order & Checkout left waiting at `READY_FOR_PICKUP`. The open-pool job model (Q-03): an unclaimed `READY_FOR_PICKUP` delivery order *is* the offer, no separate offer resource — claiming is an atomic conditional update, tested directly by racing two riders for the same job concurrently and confirming exactly one wins (`apps/api/src/modules/dispatch/service.test.ts`). Cash-on-delivery's actual money-entering-the-books moment lives here too: `confirm-delivery` requires the collected amount to match the order total exactly, then posts the same shape of escrow-hold ledger entries a card payment gets from Monnify, just debiting `rider_cash_float` instead — the release logic downstream doesn't know or care which kind of order it's looking at. 11 new tests — 66 total now, up from 45.
  - **Not built:** the rider cash-remittance endpoint (US-R-08) — still an open question (rider-initiated vs. admin-recorded, api-contracts.md), correctly left open rather than guessed at.
- **Admin, application vetting only (US-A-01), real, backend and UI** — `GET /admin/applications` (pending vendors and riders, merged), `POST /admin/applications/:type/:id/approve|reject`, unblocking the pipeline end to end: a vendor application can now actually become `approved` and show up in catalog search, a rider application can now actually go on duty and claim jobs. Approving a vendor starts the Founding Vendor Program's commission-free window automatically when the program is active (`founding_vendor_program_active`/`founding_vendor_program_waiver_months`, both new `Config` keys, brief §3.2a) — computed once at approval time, not re-evaluated later. Every decision writes a real `AuditLog` row (US-A-08's first real usage of that table). The admin app's `/` screen is a real vetting queue now (`apps/admin/app/page.tsx`) — not a placeholder: lists each pending application, approve is one click, reject requires typing a reason first (US-A-01's own acceptance criterion), and the list updates immediately without a refetch. 7 new tests (`apps/api/src/modules/admin/service.test.ts`).
  - **A real fix alongside it, not just new code:** `verifyOtp` used to `upsert` a `User` on any brand-new phone number using the caller-supplied `role` from the request body — meaning anyone could have minted themselves an admin session by hitting the public `POST /auth/otp/verify` with a fresh number and `role: "admin"`, before Admin had any real authority behind it to protect. Fixed by special-casing `role === "admin"` to a lookup-only path: it can log an already-provisioned admin in, but can never create one. Admin accounts are provisioned out of band — `SEED_ADMIN_PHONE` locally (`prisma/seed.ts`), a one-off script in production — the one surface that's deliberately *not* self-service the way vendor/rider onboarding is. 2 new tests cover this directly (`apps/api/src/modules/auth/service.test.ts`).
  - **Not built:** everything else api-contracts.md's Admin section describes — order oversight/reassignment/force-refund (US-A-03), disputes (US-A-04), config reads/writes (US-A-02), payout runs and reconciliation (US-A-05), platform metrics (US-A-07), suspending an actor (US-A-06), audit-log search (US-A-08 — the log is being *written* to now, just not queryable yet). Real future scope, not forgotten; application vetting was specifically the one piece nothing else could substitute for.
- **Notifications, backend-complete, real** — Order, Dispatch and Admin all fire into it now (`GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/subscribe`), covering every user-facing state change those three modules make: order paid/accepted/rejected/ready/rider-assigned/in-transit/delivered/delivery-failed/auto-rejected, and vendor/rider application approved/rejected. `notify()` always writes the in-app row first and never throws — a push-send failure can never fail the checkout/accept/dispatch action that triggered it (architecture.md: "Catalog and Ledger never depend on Notifications or Admin"). A guest order has no `User` row to notify at all, so it's correctly skipped, not a gap. 6 new tests (`apps/api/src/modules/notifications/service.test.ts`), including a real expired-subscription-gets-pruned test against a fake push client.
  - **Real push delivery needs VAPID keys** (optional, `.env.example`) **and a client-side service worker that isn't built yet** in any of the four apps — that's the one piece left, and until it exists the in-app feed is the only surface, which is also architecture.md's own documented fallback for a client with push disabled, not a missing piece.
- **85 unit tests total now, up from 66** (`pnpm test`) — `pnpm typecheck && pnpm lint && pnpm build && pnpm test` all green across all 8 workspace packages.

## Known rough edges, not yet worth fixing

- `next lint` is deprecated in Next.js 15 (removed in 16) — migrating to the standalone ESLint CLI is a cheap fast-follow, not urgent.
- The vendor and admin app shells always render their sidebar, including on `/login` — cosmetic, not a functional bug.
- Rider cash-remittance ownership (rider-initiated vs. admin-recorded) is still an open question flagged in api-contracts.md — resolve before building US-R-08 in M3.

## Deploy targets (ADR-0001) — not provisioned yet

Vercel (the four Next.js apps) and Railway or Render (API, Postgres, Redis) are the chosen hosts, but no actual accounts or CI deploy steps exist yet — `.github/workflows/ci.yml` currently only builds and tests on every PR, it doesn't deploy anything. Wiring up real deployment is expected before M5 (launch), not before M1.
