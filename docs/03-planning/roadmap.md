# CloseBuy — Roadmap

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 03 — Planning

## Sequencing principle

Every milestone after M1 is **additive** to a working spine, never a rewrite. M1 exists specifically so that "does the whole loop actually work — order placed, money moves, goods arrive, vendor gets paid" is proven once, early, on the smallest possible surface, before a single hour goes into anything that makes that loop nicer rather than more real.

Estimates are in **solo developer-weeks of focused effort**, not calendar time — they assume something close to full-time attention. Halve your available weekly hours against full-time and scale accordingly; a side-project pace roughly doubles every number here. Treat the numbers as relative sizing between milestones, not a delivery promise.

**One dependency outside engineering entirely, flagged up front:** R-01 (escrow/CBN licensing) needs legal advice, and that has its own timeline nobody here controls. Start that conversation now, in parallel with M0 — a licensing answer that changes the payment architecture is far cheaper to absorb before M1 is built than after.

## Milestones

### M0 — Foundation
**Goal:** nothing user-facing yet; everything after this depends on it.

- Monorepo scaffold per [ADR-0001](../02-design/adr/0001-technology-stack.md): `apps/*`, `packages/*`, CI, hosting wired (Vercel + Railway)
- Postgres schema for the core entities in [data-model.md](../02-design/data-model.md), first Prisma migration
- Phone OTP auth end to end (Termii integration, rate limiting, session issuance)
- `packages/ui` seeded with the brand tokens (colours, type) and the handful of primitives every app needs (button, input, card, badge)

**Depends on:** nothing. **Effort:** ~2 weeks. **Done when:** a developer can sign up with a phone number and land on an empty authenticated shell in all four apps.

### M1 — Walking skeleton
**Goal:** one real customer buys one real item from one real Riverpark vendor, a real rider delivers it, real money reaches the vendor's bank account. Delivery only, immediate only, single category — deliberately the narrowest possible slice that is still completely real, no mocked step anywhere in the chain.

Covers the 23 **M**-priority stories from [user-stories.md](../01-requirements/user-stories.md), minus pickup and scheduling (see M2/M4):

- Vendor: product/stock management, accept-or-reject with auto-reject timeout
- Customer: browse, cart, address (pin-based), checkout via Paystack, order status tracking
- Rider: on-duty toggle, job offer/accept, pickup code, delivery proof, cash-on-delivery handling
- Platform: escrow ledger (double-entry, append-only), append-only order state transitions, audit log, a payout run admin can trigger manually
- Admin: vendor/rider vetting, minimal order oversight

**Depends on:** M0. **Effort:** ~6 weeks — the biggest single milestone, because it's where every hard correctness problem (idempotent payment webhooks, atomic stock decrement, the ledger) has to get solved once, properly, rather than patched later. **Done when:** that one transaction completes end to end, for real money, with every state transition and ledger entry correctly recorded.

### M2 — Pickup + Founding Vendor mechanics
**Goal:** the two things that make it possible to actually go recruit Riverpark vendors, not just prove the engineering works.

- Pickup fulfilment type (brief §3.1a) — genuinely cheap, since it *removes* the rider leg rather than adding one
- Vendor pickup-availability toggle, collection-code confirmation flow
- Founding Vendor Program (brief §3.2a): approval-time waiver timestamp, vendor-visible countdown, admin toggle for whether the program is currently open

**Depends on:** M1. **Effort:** ~1.5 weeks. **Done when:** an approved vendor sees "0% commission until [date]" on their dashboard and a pickup order completes without ever touching Dispatch.

### M3 — Should-priority hardening
**Goal:** the 12 **S**-priority stories — what turns "the loop works" into "a stranger could use this without hand-holding."

Search, self-service cancellation, order history/reorder, ratings (both directions), disputes, real inventory-race handling, rider cash remittance, admin platform metrics.

**One explicit call, flagged for override:** the founder's notes place ratings/reviews in V2, but stage 01 tagged US-C-10 **S** ("required before opening to the public"), not **L**. Recommendation: keep ratings in this milestone — a marketplace asking strangers to trust unknown vendors with zero trust signal is a materially harder sell in Riverpark specifically. Cheap to move to M6 if you disagree.

**Depends on:** M1. Can run partly parallel with M2. **Effort:** ~3.5 weeks. **Done when:** every S-tagged story's acceptance criteria pass.

### M4 — Scheduled delivery
**Goal:** the feature you asked for directly this session, sequenced right after the core loop is solid rather than inside it.

`scheduled_for` UI (date + slot within vendor hours), the BullMQ scheduled-activation job already designed in [architecture.md](../02-design/architecture.md) §3, vendor-facing scheduled-orders queue, delivery dispatch timed to the slot.

**Depends on:** M1. **Effort:** ~2 weeks. **Done when:** an order placed today for tomorrow's slot enters `PREPARING` at the right time without anyone watching a clock.

### M5 — Riverpark launch
**Goal:** real vendors, real customers, real riders, in one place, for the first time.

- Soft launch with a small hand-picked vendor cohort using the Founding Vendor pitch
- Basic monitoring/alerting live (ties into stage 06/07, but the minimum needed to know if something breaks pre-launch is a launch blocker, not a later nicety)
- A short manual QA pass through every M-story on real devices, specifically low-end Android over throttled 3G (NFR-10) — this is the one NFR that's very easy to accidentally violate without ever noticing on a dev machine

**Depends on:** M1, M2, M3, ideally M4. **Effort:** ~1.5 weeks + the standing decision of when Riverpark actually looks ready (a people/ops call, not a purely engineering one).

## After launch — not scheduled, sequenced only in principle

Two backlogs exist, carried forward from the founder's notes and deliberately **not** milestone-dated here — starting any of this before Riverpark has proven the core loop would be exactly the mistake the "don't build what nobody's asked for yet" philosophy in those notes warns against.

**Once Riverpark is live and generating real usage (the notes' "V2"):** promo codes, richer notifications, a proper rider dashboard (earnings breakdown, history), vendor performance metrics, wallet, favourites, referral system, expansion to Abuja more broadly.

**Only once demand is proven at that stage (the notes' "V3"):** AI recommendations, advanced search, loyalty/subscriptions, automated dispatch, multi-city (Lagos+), additional payment gateways, third-party API access, and — if it's ever actually justified by real hub-density data — revisiting the parked hub-scoped multi-vendor cart from brief R-08.

## Risks specific to this sequencing

Carried forward from [product-brief.md §8](../01-requirements/product-brief.md), not duplicated in full — only what's new at the planning level:

| Risk | Mitigation |
|---|---|
| R-01 (escrow/CBN) could force an architecture change | Legal input sought in parallel with M0, not after M1 is built |
| R-06 (solo developer) makes M1's 6-week estimate the single biggest schedule risk in this whole roadmap | No feature work starts in M2+ until every M1 acceptance criterion passes — resist the pull to build the "nicer" milestones while M1 has known gaps |
| Riverpark vendor recruitment lags the engineering timeline | M2 (Founding Vendor mechanics) is sequenced early specifically so recruitment can start before M3/M4 finish, not after |
