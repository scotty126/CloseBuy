# ADR-0001: Technology stack

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

One developer builds and operates four client surfaces (customer, vendor, rider, superadmin) against one shared backend. The stack has to hold up against several requirements that pull in different directions:

- **NFR-10** — usable on low-end Android over unreliable 3G. Rules out anything that assumes a fat, stable connection.
- **NFR-07 / R-01** — financial records are append-only and escrow-like fund holding may be regulated. The core domain (orders, payments, payouts) needs real transactional integrity, not eventual consistency.
- **R-06** — solo developer. Every extra language, extra ops surface, or extra framework concept is a tax paid on every future feature, not a one-time cost.
- Launch market is Nigeria — payment gateway and SMS provider choices are not generic; the wrong pick here is expensive to reverse post-launch (live customer payment methods, live vendor payout rails).
- Web-first per prior decision, native wrapping deferred (§Product Brief, rider app is the likely first Capacitor candidate).

## Decision

**One language, one relational database, one monolith, managed hosting.**

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere — client and server |
| Monorepo | pnpm workspaces + Turborepo — `apps/{customer,vendor,rider,admin}`, `packages/{ui,types,api-client}` |
| Frontend | Next.js (React) for all four apps — one framework, one mental model, shared `packages/ui` component library built on the brand tokens |
| Backend | Node.js + Fastify, REST — layered `routes → services → repositories`, no heavy DI framework |
| Database | PostgreSQL, accessed via Prisma (type-safe queries, first-class migrations) |
| Background jobs | BullMQ + Redis — accept-window timeouts, **scheduled-order activation**, payout runs, OTP expiry, notification retries |
| Real-time-ish updates | Web Push (VAPID) for the &lt;5s notification requirement (NFR-03) + short-interval polling on an *open* tracking screen. No WebSocket fleet in v1. |
| Auth | Phone number + OTP via **Termii** (Nigeria-focused SMS deliverability and cost), short-lived JWT sessions |
| Payments | **Monnify** primary — multi-daily settlement (vs. Paystack's next-business-day, no-weekend default) directly strengthens vendor cash flow and the Founding Vendor pitch. Paystack documented as the fallback integration, not built day one |
| File storage | Cloudflare R2 (S3-compatible, no egress fees) — product images, KYC documents |
| Maps | Google Maps Platform — Geocoding, Places Autocomplete, Static/Dynamic Maps for pin-drop addressing |
| Hosting | Vercel (the four Next.js apps) + Railway or Render (API, Postgres, Redis) |
| Testing | Vitest (unit/integration) + Playwright (e2e) |

## Alternatives considered

| Option | Why not |
|---|---|
| NestJS instead of Fastify | More structure out of the box, but its DI/module ceremony is overhead a solo developer pays on every file. A disciplined folder convention over Fastify gets most of the benefit for less machinery. |
| Django (Python) for the backend | Excellent admin scaffolding would speed up the admin dashboard specifically — but splits the stack into two languages. The win from sharing TypeScript types across four frontends and one backend outweighs Django admin's convenience. |
| Firebase (Firestore + Cloud Functions) as the whole backend | Fast to start, but the domain has a double-entry ledger, stock-decrement race conditions, and strict reconciliation requirements (NFR-07) that fit a relational database with real ACID transactions far better than a document store. |
| Microservices | Rejected outright given R-06. One deliberately modular monolith (Catalog, Order, Payments/Ledger, Dispatch, Notifications, Admin as internal modules with clean boundaries) is the only sane shape for a solo build, and can be split later if it's ever actually justified by scale. |
| WebSockets (Socket.IO) for live updates | Rejected as the v1 default. Status-based tracking (brief §3.5) already removed the strongest reason for a persistent connection; push + short-poll is simpler to operate and more resilient on the flaky connections NFR-10 anticipates. Noted as an additive upgrade path, not a rewrite, if it's ever needed. |
| Vite SPA for vendor/admin instead of Next.js | Would be marginally faster to build (no SSR concerns for internal tools) but costs a second framework to hold in mind. Consistency across all four apps was weighted higher than that marginal gain. |

## Consequences

**Easier:** one language across the whole stack; shared types between every client and the API remove a whole class of integration bugs; managed hosting (Vercel/Railway) means near-zero ops burden for a solo developer; Prisma's migration workflow keeps the schema and the code honest with each other.

**Harder:** Fastify's smaller ecosystem than Express/NestJS means a few things (auth guards, request validation wiring) get hand-rolled rather than pulled off the shelf; four Next.js apps in one monorepo need careful shared build/deploy config or CI time balloons; polling instead of sockets means the client code has to be deliberate about only polling while a screen is actually open, or it wastes a rider's data plan.

**Locked into, and what reversing costs:**
- **PostgreSQL** for the core domain — the right lock-in given the ledger requirement; reversing would mean rebuilding the financial model from scratch, which should never be attractive.
- **Monnify** as the primary payment integration — chosen specifically for settlement speed: multi-daily payout to CloseBuy's own account vs. Paystack's next-business-day (and no weekend processing) default. That speed is meant to pass straight through to vendors as fast, reliable payout, which is a genuine product advantage and a real argument in the Founding Vendor pitch.

  **Unverified against R-01, flagged rather than assumed:** ADR-0001's original reasoning for Paystack leaned specifically on its Subaccounts / Split Payments feature, which can hold a vendor's share of a payment and only release it on the platform's instruction — meaning Paystack itself, an already-licensed PSP, does the actual fund custody, softening whether CloseBuy is a money transmitter under CBN rules (R-01). **Whether Monnify offers an equivalent split/hold mechanism has not been confirmed** — this needs checking against Monnify's current API documentation before integration work begins (flagged as a pre-M1 checkpoint in the roadmap). If it doesn't, the escrow implementation may need to route the vendor's share through Monnify's Disbursement/Transfer API after the fact instead of a split at charge time — workable, but worth knowing before it's built, not after.
  - The accept-window auto-refund (brief US-V-05 — 10 minutes, configurable, full refund) does **not** depend on this either way: it's implemented as our own BullMQ timer calling the gateway's refund API on timeout, which both Paystack and Monnify support. Nothing about that mechanic is gateway-specific.
  - Switching payment gateways later means re-touching checkout, webhook handling, and the escrow mechanism specifically, so it's worth getting the split/custody question answered before real money moves through it.
