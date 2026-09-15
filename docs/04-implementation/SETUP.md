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
- **Order & Checkout, real** — `POST /checkout` (server-side re-validation of price/stock/vendor status, the full guest-vs-signed-in split from brief §3.1b, idempotent on the client's `Idempotency-Key`), a real double-entry escrow ledger (`apps/api/src/modules/order/ledger.ts` — pure functions, 7 unit tests just on the balance math), the Monnify integration (`apps/api/src/modules/payments/monnify.ts` — auth, initialize-transaction, webhook signature verification, refund, every shape checked against Monnify's actual docs rather than assumed), and BullMQ-backed timers for the vendor accept-window auto-reject and the post-delivery escrow-release window (`apps/api/src/modules/order/jobs.ts`). 24 more unit tests across `order/service.test.ts` (17) and `order/ledger.test.ts` (7) — 45 total now, up from 21.
  - **Fully working without any Monnify credentials:** cash-on-delivery orders — checkout, vendor accept (with atomic stock decrement), reject-and-refund-logic (a no-op for cash, correctly), mark-ready, and pickup-order completion all run end to end once a local Postgres/Redis exist.
  - **Needs real Monnify sandbox credentials to actually complete:** card/transfer checkout and the webhook that confirms it — the code is real and correct against Monnify's documented API shapes, just not live-tested end to end yet.
  - **Deliberately not built this pass:** Dispatch (rider job offer/accept, delivery confirmation) — a delivery order correctly reaches `READY_FOR_PICKUP` and then waits there; a pickup order completes fully without Dispatch at all.

**Not built yet, deliberately** — Dispatch, Notifications, and most of Admin exist only as empty directories matching architecture.md's module boundaries, or as `Placeholder` screens in the relevant app linking back to the story and milestone that will build them.

## Known rough edges, not yet worth fixing

- `next lint` is deprecated in Next.js 15 (removed in 16) — migrating to the standalone ESLint CLI is a cheap fast-follow, not urgent.
- The vendor and admin app shells always render their sidebar, including on `/login` — cosmetic, not a functional bug.
- Rider cash-remittance ownership (rider-initiated vs. admin-recorded) is still an open question flagged in api-contracts.md — resolve before building US-R-08 in M3.

## Deploy targets (ADR-0001) — not provisioned yet

Vercel (the four Next.js apps) and Railway or Render (API, Postgres, Redis) are the chosen hosts, but no actual accounts or CI deploy steps exist yet — `.github/workflows/ci.yml` currently only builds and tests on every PR, it doesn't deploy anything. Wiring up real deployment is expected before M5 (launch), not before M1.
