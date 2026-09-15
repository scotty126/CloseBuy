# CloseBuy — Architecture

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 02 — Design

One backend, one database, four thin clients. This document assumes the stack decided in [ADR-0001](adr/0001-technology-stack.md).

## 1. System overview

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Customer   │  │   Vendor    │  │    Rider    │  │  Superadmin │
│  (Next.js)  │  │  (Next.js)  │  │  (Next.js)  │  │  (Next.js)  │
│  PWA, public│  │  dashboard  │  │  PWA        │  │  dashboard  │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │                │
       └────────────────┴───────┬────────┴────────────────┘
                                 │  HTTPS / REST (JSON)
                                 ▼
                     ┌───────────────────────┐
                     │      API (Fastify)     │
                     │  ─────────────────────  │
                     │  Auth      Catalog      │
                     │  Cart      Order        │
                     │  Payments  Ledger       │
                     │  Dispatch  Notifications│
                     │  Admin     Audit        │
                     └───┬───────────┬────────┘
                         │           │
              ┌──────────┘           └──────────┐
              ▼                                  ▼
     ┌─────────────────┐               ┌──────────────────┐
     │   PostgreSQL     │               │   Redis + BullMQ  │
     │  (source of truth│               │  (jobs, OTP, rate │
     │   for everything)│               │   limits, queues) │
     └─────────────────┘               └──────────────────┘
              │
              │  outbound integrations
              ▼
  ┌──────────┬──────────┬──────────┬──────────┬──────────┐
  │ Paystack │  Termii  │  Google  │Cloudflare│ Web Push │
  │(payments,│  (SMS    │  Maps    │    R2    │ (VAPID,  │
  │ payouts) │  OTP)    │(geocode) │ (images, │ notifs)  │
  │          │          │          │KYC docs) │          │
  └──────────┴──────────┴──────────┴──────────┴──────────┘
```

Every client talks only to the API — there is no direct client-to-database or client-to-third-party access anywhere (card details, in particular, go straight from the client to Paystack's own hosted fields and never transit CloseBuy's servers at all, per NFR-05).

## 2. Backend modules

The API is a single deployable service, internally organised into modules with clear ownership. This is the boundary a future split into separate services would follow, if that's ever justified — nothing here assumes it will be.

| Module | Owns | Depends on |
|---|---|---|
| **Auth** | Phone OTP issuance/verification, sessions, role/permission checks | Termii, Redis (OTP + rate limiting) |
| **Catalog** | Categories, vendors, products, stock | — |
| **Cart** | The active single-vendor cart per customer (brief §3.1) | Catalog (price/stock validation) |
| **Order** | The order state machine (brief §4), state transition log | Cart, Catalog, Dispatch |
| **Payments** | Checkout, Paystack webhooks, refunds | Order, Ledger |
| **Ledger** | Double-entry escrow ledger, payout calculation | Payments, Order |
| **Dispatch** | Job offers to riders, acceptance, pickup/delivery confirmation — **delivery-fulfilment orders only**; a pickup order never enters this module (brief §3.1a) | Order |
| **Notifications** | Push delivery, in-app notification feed | Order, Dispatch (event sources) |
| **Admin** | Vetting, config (categories, commission, fees), disputes, reconciliation, metrics | All of the above (read + intervene) |
| **Audit** | Immutable log of every consequential action (US-A-08) | Written to by every other module, read by Admin only |

**Dependency direction matters**: Catalog and Ledger never depend on Notifications or Admin. If a module on the right of that table is unavailable, order-taking and money-handling keep working — only the informational layer degrades.

## 3. Key flow — order lifecycle end to end

Ties the modules above to the state machine already defined in the product brief.

```
Customer                API                          External
   │                     │
   │  add to cart ──────►│ Cart validates against Catalog
   │                     │
   │  checkout ─────────►│ Payments creates PENDING_PAYMENT order
   │                     │──── charge ─────────────────────► Paystack
   │                     │◄─── webhook: success ─────────────┘
   │                     │ Ledger: debit customer, credit escrow
   │                     │ Order → PAID
   │◄──── push: order placed ───┤
   │                     │
   │                     │  Vendor dashboard polls/sees PAID order
   │                     │  Vendor accepts → Order → PREPARING
   │                     │  (BullMQ timer cancelled)
   │                     │
   │                     │  Vendor marks ready → Order → READY_FOR_PICKUP
   │                     │  Dispatch offers job to nearby on-duty riders
   │                     │
   │                     │  Rider accepts → Order → RIDER_ASSIGNED
   │                     │  Rider confirms pickup (code) → IN_TRANSIT
   │◄──── push: picked up ──────┤
   │                     │
   │                     │  Rider confirms delivery (photo/code) → DELIVERED
   │◄──── push: delivered ──────┤
   │                     │
   │                     │  No dispute within window → Order → COMPLETED
   │                     │  Ledger releases escrow → vendor + rider payable
   │                     │  (Payout run picks this up on its schedule)
```

Every arrow that changes order state also writes one row to the append-only state-transition log (NFR-07, brief §4) — this is what makes disputes (US-A-04) and reconciliation (US-A-05) possible after the fact, rather than reconstructed from application logs.

**Two variants of this flow, both handled by the same modules:**

- **Pickup** (`fulfilment_type = pickup`) — Dispatch is never invoked. `READY_FOR_PICKUP` instead triggers a customer notification; the vendor confirms collection directly, and Order moves straight to `DELIVERED`. No delivery-fee ledger entry, no rider-payable entry.
- **Scheduled** (`scheduled_for` is set) — the flow is identical, but a BullMQ job holds the order after vendor acceptance and fires the transition into active `PREPARING` — and, for delivery, the Dispatch offer — timed to land shortly before the slot rather than immediately.

## 4. How this satisfies the non-functional requirements

| NFR | How the architecture addresses it |
|---|---|
| NFR-01/02 (load & response time on 3G) | Next.js SSR for first paint; Catalog reads are the hottest path and are cached; no client ever waits on a third-party call synchronously except at the payment step |
| NFR-03 (&lt;5s state visibility) | Push notification fires from the module that made the transition, same request; polling is the fallback for a client with push disabled |
| NFR-04 (99.5% uptime) | Managed hosting (Vercel/Railway) with independent client deploys — a broken vendor-app deploy cannot take down the customer app or the API |
| NFR-05 (never store card data) | Card capture happens on Paystack's own hosted UI; CloseBuy's server only ever sees a reference and a webhook |
| NFR-06 (encryption) | TLS everywhere in transit; Postgres and R2 encrypted at rest by the hosting provider |
| NFR-07 (append-only financial records) | Ledger and state-transition tables are insert-only at the application layer — corrections are reversing entries, never updates or deletes |
| NFR-09 (1,000 orders/day) | A single Postgres instance and a single Fastify instance comfortably clear this; no architectural change needed before this number is an order of magnitude higher |
| NFR-10 (low-end Android, flaky network) | No WebSocket connection to maintain; polling backs off when a screen is backgrounded; every API response is small (paginated lists, no over-fetching) |

## 5. What this architecture deliberately does not have yet

- **No CDN/edge cache tier beyond what Vercel provides by default** — add if catalog read load ever justifies it.
- **No search engine (e.g. Elasticsearch/Meilisearch)** — US-C-03 search runs against Postgres directly (`ILIKE`/trigram index) until catalogue size makes that genuinely too slow.
- **No message broker beyond BullMQ/Redis** — sufficient for the job/notification volume implied by NFR-09.
- **No multi-region deployment** — single region (nearest to Nigeria with good latency) is enough for a single-country launch (assumption A-01).

Each of these is a known, named simplification, not an oversight — the same discipline as the requirements stage's "explicitly out of scope" list.
