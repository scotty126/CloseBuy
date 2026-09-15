# CloseBuy — Local Development Setup

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 04 — Implementation

Covers what M0 actually built (roadmap.md) and how to run it. Update this file as later milestones add real requirements — it should always be the one place a fresh clone needs to read to get running.

## Prerequisites

- Node.js ≥ 20
- pnpm — `corepack enable && corepack prepare pnpm@latest --activate`, or `npm install -g pnpm` if corepack can't write to a system path (that's what this environment needed)
- Docker Desktop (or any local Postgres 16 + Redis 7 you already run)
- A free [Termii](https://termii.com) account — the one external account genuinely required to see OTP login work end to end. Sandbox mode is enough for local dev.

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
- **Phone OTP auth, end to end** — real UI (all four apps) → real API (`/auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`) → real Termii integration → JWT session → localStorage, via a shared `useAuthSession` hook. Rate limiting and the 5-attempt/15-minute lockout (US-C-01) are implemented and unit-tested (`apps/api/src/modules/auth/service.test.ts`).
- **`packages/ui`** — brand tokens pixel-matched to the brand guide, a shared Tailwind preset, and the first component set (Button, Input, Card, StatusBadge, Sidebar, Placeholder).

**Not built yet, deliberately** — every other module (Catalog beyond a smoke-test `GET /categories`, Cart, Order, Payments, Dispatch, Notifications, most of Admin) exists only as an empty directory matching architecture.md's module boundaries, or as a `Placeholder` screen in the relevant app linking back to the story and milestone that will build it. That's M1+, not a gap in M0.

## Known rough edges, not yet worth fixing

- `next lint` is deprecated in Next.js 15 (removed in 16) — migrating to the standalone ESLint CLI is a cheap fast-follow, not urgent.
- The vendor and admin app shells always render their sidebar, including on `/login` — cosmetic, not a functional bug.
- Rider cash-remittance ownership (rider-initiated vs. admin-recorded) is still an open question flagged in api-contracts.md — resolve before building US-R-08 in M3.

## Deploy targets (ADR-0001) — not provisioned yet

Vercel (the four Next.js apps) and Railway or Render (API, Postgres, Redis) are the chosen hosts, but no actual accounts or CI deploy steps exist yet — `.github/workflows/ci.yml` currently only builds and tests on every PR, it doesn't deploy anything. Wiring up real deployment is expected before M5 (launch), not before M1.
