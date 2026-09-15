# CloseBuy — Product Brief

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 01 — Requirements

## 1. Problem statement

In West African markets, small and mid-sized sellers have inventory and customers have demand, but the connection between them is fragmented. A customer today searches Instagram, checks WhatsApp, messages the vendor, asks what's in stock and what it costs, figures out delivery themselves, transfers money on trust, and waits — with no order record, no payment guarantee, and no recourse if it goes wrong. Independent riders have no steady source of jobs.

CloseBuy turns that into one experience: **search → discover → order → pay → deliver.** Vendors get a digital storefront, orders and payment infrastructure, and delivery support without giving up what they're already doing elsewhere — this is an additional channel, not a replacement. Customers get one trustworthy place to find what's nearby and have it arrive. Riders get a steady stream of paid jobs. The platform operator retains oversight of the whole flow, including the money.

**The ambition is bigger than any one order.** CloseBuy isn't "another online store" — it's meant to become **local commerce infrastructure**: the place people go to find practically anything they need from businesses near them, across categories, not just one vertical. That framing matters for a decision already made in §3.3 (category is configurable, not hardcoded) and for how the platform expands geographically — see §2a.

## 2. Actors

| Actor | Surface | Core need |
|---|---|---|
| **Customer** | Customer app (web/PWA) | Find goods, pay safely, know where the order is |
| **Vendor** | Vendor dashboard | List stock, receive orders, fulfil, get paid reliably |
| **Rider** | Rider app (web/PWA) | Receive jobs nearby, navigate, prove delivery, get paid |
| **Superadmin** | Admin dashboard | Onboard and vet actors, resolve disputes, control money and config |

A fifth implicit actor is the **system itself**, which runs dispatch, payouts, notifications and scheduled reconciliation without human involvement.

## 2a. Launch geography

A marketplace needs a working density of customers, vendors and delivery demand in one place before it needs scale — a thousand users spread across a country prove nothing; a few hundred concentrated in one community can. The sequence, in order:

**Riverpark → Abuja → Lagos → broader Nigeria.**

Riverpark is deliberately the first target: small enough to reach saturation with a modest vendor count, concentrated enough that delivery distances stay short (which also keeps R-08's parked hub-dispatch question low-stakes for a long time — most early orders will be short single-vendor trips regardless). Expansion to the next stage happens once the current one is actually working, not on a calendar date. This sequencing is the primary input to how stage 03 (Planning) stages the rollout — not something resolved further in this document.

This sharpens assumption A-01: single-country is true, but "launch" more precisely means one neighbourhood first.

## 3. Domain decisions that shape everything downstream

These are not implementation details. They change the data model, so they are settled at requirements stage.

### 3.1 A cart, and an order, belong to exactly one vendor

For v1, a cart may hold items from **one vendor only**. Adding an item from a different vendor prompts the customer to clear the cart or keep the existing one — the same pattern DoorDash uses. One cart produces one order, for one vendor, fulfilled by one rider doing one pickup and one dropoff. There is no order-splitting logic to build, test or reconcile.

**This was a deliberate simplification, not the starting assumption.** Most launch vendors are expected to trade out of a small number of shared physical hubs (a market, a mall, a food court — the way Computer Village or Balogun Market hosts hundreds of traders under one roof), which would make a *hub-scoped* multi-vendor cart viable: several vendors, split into separate sub-orders at checkout, collected by one rider on a single multi-stop trip. That model is sound and may be worth revisiting once the platform has real trading volume — but it adds real complexity (order splitting, multi-stop rider dispatch, pickup checklists, readiness-timeout handling between vendors on different prep schedules) that isn't justified before the single-vendor path is proven end to end. It is parked, not discarded: see the retired items under §5 and R-08.

If it does return, the mechanism to reintroduce is: a `hub` entity vendors can optionally belong to; a cart rule allowing multiple vendors only when every vendor in it shares a hub; checkout splitting into one sub-order per vendor; and dispatch grouping same-hub sub-orders into one rider job. None of that is being built now.

### 3.1a Fulfilment is delivery or pickup; either can be immediate or scheduled

Two independent choices sit on top of the order, each vendor-configurable and each customer-selected before checkout:

- **Fulfilment type** — *delivery* (a rider carries the order, as described everywhere else in this brief) or *pickup* (the customer collects in person from the vendor). A vendor opts into offering pickup; not every vendor has to.
- **Timing** — *immediate* ("as soon as possible") or *scheduled* (a future date and time slot the customer picks).

All four combinations fit the same state machine in §4, with two changes:

- **A pickup order never enters `RIDER_ASSIGNED` or `IN_TRANSIT`.** `READY_FOR_PICKUP` means exactly what it says: the vendor holds the order until the customer physically arrives. The customer shows a short code on their order screen; the vendor enters it to confirm collection, which moves the order straight to `DELIVERED`. No rider, no delivery fee, no proof-of-delivery photo — pickup removes most of the platform's operational complexity for that one order.
- **A scheduled order is paid and accepted the same way an immediate order is**, but the vendor isn't expected to start `PREPARING` until close to the scheduled slot. A background job (already part of the architecture's job queue) advances the order into active preparation at the right time, and — for delivery — dispatch only offers the job to riders close to the slot, not the moment the vendor accepted. Scheduling adds one field (`scheduled_for`) and one job type; it does not change the shape of the state machine, only its timing.

Pickup is available for either timing; a customer can collect immediately or reserve a future slot for pickup too.

### 3.1b Customer identity — email/password + Google/Apple; phone is never a gate

**Customer authentication and delivery-contact verification are two separate concerns, and this platform previously conflated them.** They're now split cleanly:

- **Identity** (who is signed in, if anyone) is email + password, or Google, or Apple sign-in. This applies to **customers only** — vendors and riders keep phone + OTP exactly as built (brief's original US-V-01/US-R-01 reasoning holds there: verifying a real, reachable number is a trust/KYC check on someone *supplying* the service and handling deliveries or money, not a login convenience for someone *browsing*. Different concern, deliberately not unified).
- **Delivery contact** (the number a rider actually calls) is a plain phone field, never OTP-verified, for anyone — guest or signed-in.

Consequences:

- Browsing, cart, and **checkout itself never require an account** — a guest places an order by typing a delivery phone number when they reach that step. No code, no account, nothing to create.
- A signed-in customer's checkout **presets** their delivery number from their account profile, with room for an **optional alternate number** (a second contact for this specific order) — never a re-verification step.
- Signing in — for order history, saved addresses, editable ratings — is offered, never forced, and never touches phone at all: email + password, or one tap via Google/Apple.
- Password accounts get standard, non-blocking account-security mechanics: a verification email on signup (doesn't gate usage), password reset via emailed link, and the same brute-force protection spirit the old OTP lockout had (5 failed login attempts / 15 minutes), now guarding password guesses instead of OTP guesses.
- **Google and Apple sign-in cannot replace the delivery-contact number** — neither provider reliably returns a real phone number, so an OAuth account still collects a delivery number the first time it's actually needed (at checkout), same as a password account does at signup or first order.

**Consequence for guest orders specifically:** since customer identity is now email-based, a guest order has no natural account to attach to at all — unlike the phone-keyed placeholder `User` row this document specified in an earlier draft. An order's `customer_id` is therefore **nullable**; a guest order carries its contact phone (and optional alternate) directly, with no `CustomerProfile` behind it. This makes the tracking-link mechanism below not just a privacy fix but the *only* way a guest ever sees their order again — there is no account to sign into.

**The tracking-link requirement from the previous draft still stands, for the same reason:** a phone number is not a secret, so "look up my order by phone number" would expose one guest's order to anyone who knows their number. A guest's order confirmation is a unique, unguessable tracking link (shown at checkout, sent by SMS to the contact number given), and that link — not a phone number, not a login — is how a guest checks status, rates, or opens a dispute on that one order.

**Consequence for the cart itself, unaffected by any of this:** a cart can exist before any customer record does, so it still can't be a server-side row tied to a `CustomerProfile` — it lives client-side (the device) until checkout, submitted and re-validated against live price and stock (already required by US-C-06) before anything is charged. This removes the server-side `Cart`/`CartItem` persistence originally in the data model (data-model.md §3). Cross-device cart continuity is the capability given up; it was never a requirement (US-C-04 only asked that a cart survive the same device closing and reopening), and it can return later if ever actually needed.

### 3.2 Money is held in escrow, not forwarded

Customer payment is captured by the platform and held. Funds are released to the vendor only after delivery is confirmed, minus platform commission and, where applicable, rider earnings. This is the mechanism that makes the marketplace trustworthy to a buyer who has never heard of the seller.

**Consequence — and it is a serious one:** holding customer funds may constitute regulated activity under CBN rules. See Risk R-01.

### 3.2a Commission and the Founding Vendor Program

Commission is **per fulfilment type, platform-wide** — not per category, not tiered by volume (resolves Q-01):

| Fulfilment type | Commission |
|---|---|
| Pickup | 5% |
| Delivery | 10% |

The gap reflects reality, not an arbitrary split: a delivery order costs the platform a rider job to coordinate; a pickup order doesn't. Commission is strictly separate from two other deductions that touch the same order — **payment gateway processing fees** (the gateway's own cut, a cost of accepting payment at all) and **the delivery fee itself** (which passes to the rider, not to CloseBuy). CloseBuy's revenue on an order is the commission, full stop.

**Founding Vendor Program** — the primary answer to cold start (R-04): a vendor approved during the launch window pays **0% commission for their first 3 months**, reverting to the standard rates above afterward. Bundled with priority onboarding, launch promotion, featured placement, early feature access and a direct feedback channel to the team. The pitch to an early Riverpark vendor is explicitly: join early, get established before the marketplace gets crowded, grow with us.

No monthly subscription, no setup cost, ever — vendors are only charged when they make a sale.

### 3.3 Category determines the rules

A mixed marketplace cannot have one fulfilment flow. Each vendor category carries its own configuration. The category list is illustrative, not exhaustive — category is a first-class configurable entity (admin-managed, US-A-02), not a hardcoded enum branch, and is expected to grow well past this table as the platform's "practically anything nearby" ambition (§1) plays out:

| Category | Prep time | Delivery window | Returnable | Special handling |
|---|---|---|---|---|
| Food & groceries | Minutes | Immediate | Partial | Substitutions, weight pricing, temperature, tight SLA |
| Fashion | Hours | Same/next day | Yes | Standard |
| Beauty | Hours | Same/next day | Yes | Standard |
| Electronics | Hours | Same/next day | Yes, subject to seal/condition | Higher-value proof-of-delivery |
| Home | Hours | Same/next day | Yes | Standard |
| Pharmacy | Minutes | Immediate | No | Licence check, restricted items |

Pharmacy remains listed because the regulatory handling it needs is real even though it wasn't named among the initial launch categories — better to keep the configuration model honest about it now than retrofit it under pressure later.

### 3.4 Addresses are map pins, not postal strings

Street addressing is unreliable across much of the launch market. A delivery address is therefore a **geographic coordinate, plus a free-text landmark description, plus a contact phone number**. Postal-code validation, distance calculation and routing must never be assumed to work from a text address alone.

### 3.5 Tracking is status-based, not map-based

The customer is told *what stage* their order has reached, not *where the rider is standing*. Progress is communicated as discrete state changes — accepted, being prepared, picked up, delivered — pushed as notifications and reflected in the order screen.

There is no moving marker on a map in v1.

This is a deliberate choice with three consequences worth stating plainly:

- **The rider app needs no background location streaming.** Position is read only at the moments that matter — accepting a job, confirming pickup, confirming delivery — while the app is open. A PWA does this reliably; continuous background tracking is what a PWA does badly.
- **No real-time location infrastructure is required.** No coordinate streaming, no socket fan-out of positions, no map rendering on the customer side, and no cost from a mapping provider charging per map load.
- **Riders keep the useful half.** The rider still gets the pin and hands off to Google Maps for navigation. What is removed is broadcasting that position onward to the customer.

If live tracking is wanted later it is an additive feature, not a rewrite: the order already carries the pin and the rider identity, so it becomes a matter of streaming a coordinate that the system is already able to read.

## 4. Order lifecycle

Applies to an order — which is, for v1, one purchase from one vendor (§3.1). A pickup order (§3.1a) follows this same diagram but never visits `RIDER_ASSIGNED` or `IN_TRANSIT`, moving directly from `READY_FOR_PICKUP` to `DELIVERED` on customer collection. A scheduled order enters the diagram normally but its `PREPARING` step is timed to the slot, not triggered the instant the vendor accepts.

```
                 ┌──────────────────┐
                 │ PENDING_PAYMENT  │
                 └────────┬─────────┘
                          │ payment captured
                 ┌────────▼─────────┐   vendor rejects, or
                 │      PAID        │─── accept window ───┐
                 └────────┬─────────┘   expires           │
                          │ vendor accepts                │
                 ┌────────▼─────────┐            ┌────────▼─────────┐
                 │    PREPARING     │            │    CANCELLED     │
                 └────────┬─────────┘            └────────┬─────────┘
                          │ marked ready                  │
                 ┌────────▼─────────┐            ┌────────▼─────────┐
                 │ READY_FOR_PICKUP │            │     REFUNDED     │
                 └────────┬─────────┘            └──────────────────┘
                          │ rider accepts job
                 ┌────────▼─────────┐
                 │  RIDER_ASSIGNED  │
                 └────────┬─────────┘
                          │ rider collects
                 ┌────────▼─────────┐   customer
                 │    IN_TRANSIT    │─── unreachable ─────┐
                 └────────┬─────────┘                     │
                          │ proof of delivery             │
                 ┌────────▼─────────┐            ┌────────▼─────────┐
                 │    DELIVERED     │            │ DELIVERY_FAILED  │
                 └────────┬─────────┘            └────────┬─────────┘
                          │ escrow released               │ returned to vendor
                 ┌────────▼─────────┐                     │
                 │    COMPLETED     │◄────────────────────┘
                 └──────────────────┘
```

Every transition is recorded with actor, timestamp and reason. Order history is append-only — it is the evidence base for dispute resolution, so it is never edited in place.

## 5. Scope

### In scope for v1

- **Customer** — registration, browse, search, cart, checkout with delivery-or-pickup and immediate-or-scheduled selection, order status tracking, order history, ratings
- **Vendor** — onboarding with KYC, product and inventory management, pickup availability toggle, order queue including scheduled orders, payout view
- **Rider** — onboarding with KYC, availability toggle, accept or decline job offers, pickup confirmation, navigation handoff to an external maps app, proof of delivery, earnings
- **Admin** — actor vetting and approval, category and commission configuration, dispute resolution, financial reconciliation, platform metrics
- **Payments** — card and bank transfer via gateway, cash on delivery, escrow ledger, automated vendor payouts
- **Platform** — notifications, search, ratings, audit log

### Explicitly out of scope for v1

Deferred deliberately, and recorded so they are not silently reintroduced:

- Native iOS/Android binaries (decision recorded as an ADR in stage 02)
- In-app customer/vendor chat
- Subscriptions and recurring orders
- Multi-currency and cross-border selling
- Loyalty points, referrals, promotional engine beyond simple discount codes
- Vendor-fulfilled delivery using the vendor's own riders
- Order batching — one rider carrying several orders at once
- Hub-scoped multi-vendor cart and split checkout — parked per §3.1, may return post-v1
- Live rider position on a map for the customer — tracking is status-based; see 3.5
- Automatic route optimisation or turn-by-turn navigation inside the rider app
- Algorithmic/automated rider dispatch — v1 is an offer-and-accept open pool (resolves Q-03)
- Vendor-facing sales analytics dashboard, beyond the existing earnings/payout view (US-V-07)
- Customer favourites, wallet, and referral system
- Public API for third parties

## 6. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | Catalogue page load on 3G | Interactive < 3 s |
| NFR-02 | API response, 95th percentile | < 400 ms |
| NFR-03 | Order state change visible to all parties | < 5 s |
| NFR-04 | Platform availability | 99.5% monthly |
| NFR-05 | Passwords and card data | Never stored by us; gateway tokenisation only |
| NFR-06 | Data at rest and in transit | Encrypted |
| NFR-07 | Financial records | Append-only, 7-year retention |
| NFR-08 | Personal data handling | NDPA 2023 compliant |
| NFR-09 | Order volume supported at launch | 1,000/day without redesign |
| NFR-10 | Client usability | Functional on low-end Android, survives intermittent connectivity |

NFR-10 is not a nicety. A large share of target users are on constrained devices and unreliable networks; a client that assumes a stable connection will fail in the field.

## 7. Assumptions

Recorded so that, if any turns out to be false, we know exactly what to revisit.

| ID | Assumption |
|---|---|
| A-01 | Launch is single-country, single-currency (NGN), and single-neighbourhood first — Riverpark (§2a) |
| A-02 | Riders are independent contractors, not employees |
| A-03 | Vendors hold their own stock; the platform never takes possession of goods |
| A-04 | Delivery is intra-city; no inter-state logistics in v1 |
| A-05 | Customers have smartphones with a data connection, albeit often slow |
| A-06 | Cash on delivery will be a significant share of transactions and cannot be treated as an edge case |
| A-07 | Many launch vendors are expected to be co-located within a small number of physical hubs — not acted on in v1 (§3.1), but relevant if hub-scoped multi-vendor carts are reconsidered later |

## 8. Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| **R-01** | Holding customer funds in escrow may require CBN licensing (PSSP tier, ₦100M capital, cannot hold funds; PSP tier, ₦5B, can). **Status: accepted risk, not resolved** — decided 2026-09-15 to proceed on Monnify's Sub-Accounts structure (ADR-0001) without separate legal confirmation that it keeps CloseBuy outside PSP-tier licensing. That confirmation genuinely doesn't exist in public guidance either way; this is a deliberate call to build now and revisit only if it ever becomes a real problem, not a finding that the underlying risk is gone | Accepted, not eliminated | No action tracked. If this ever needs revisiting: a lawyer confirming the sub-account structure, or restructuring so the vendor is the merchant of record instead of CloseBuy |
| R-02 | ~~Rider background GPS unreliable on PWA~~ **Largely retired** by the status-based tracking decision in 3.5 | Low | Location is read only in the foreground at pickup and delivery. Revisit only if live tracking is reintroduced |
| R-07 | Without live tracking, customers phone support asking "where is my order?" | Support load | Proactive notification on every state change; show a clear expected-by window rather than a silent gap |
| R-03 | Cash-on-delivery reconciliation; riders holding platform money | Financial loss | Per-rider cash ledger, float limits, mandatory remittance before new jobs |
| R-04 | Marketplace cold start — no vendors means no customers | Launch failure | Seed Riverpark specifically before widening (§2a); the Founding Vendor Program (§3.2a) exists largely to solve this side of cold start |
| R-05 | Fraudulent vendors or fake listings | Trust collapse | Mandatory KYC, staged trust levels, payout delay for new vendors |
| R-06 | Solo developer, four surfaces | Schedule overrun | Staged roadmap in stage 03; shared component library; each surface reaches usable state before the next begins |
| R-08 | Hub multi-vendor dispatch was scoped out (§3.1) specifically to avoid this: order-splitting, multi-stop pickup and cross-vendor readiness timeouts are real complexity a solo build shouldn't carry before the single-vendor path is proven | N/A — parked, not active | If revisited, re-open with the surcharge amount, hub wait-timeout and late-vendor penalty policy decided up front, and treat it as its own milestone rather than folding it into the walking skeleton |
| R-09 | A vendor accepts more scheduled orders for one time slot than they can actually prepare in it | Missed slots, customer complaints, vendor overwhelmed | v1 does not build slot-capacity limits (a config number of orders per vendor per slot); vendors self-manage by rejecting what they can't meet. Revisit if this proves to be a real problem once vendors are using scheduling |

## 9. Open questions

| ID | Question |
|---|---|
| Q-02 | Who bears the delivery fee — customer, vendor, or split? |
| Q-04 | Is there a customer wallet, or is every payment a fresh transaction? (Bears directly on R-01) |
| Q-05 | Self-service vendor signup with later vetting, or admin-invite only at launch? |

**Resolved:**
- **Q-01** (commission model) — per fulfilment type, not per-category or tiered. See §3.2a.
- **Q-03** (rider assignment) — open pool, not automated proximity dispatch: on-duty riders see job offers and accept or decline (US-R-03). Algorithmic auto-dispatch is out of scope for v1 (§5) — a small early rider pool doesn't need it, and it's a meaningfully harder problem to build correctly than an offer/accept model.

Q-06–Q-08 (multi-stop surcharge, hub wait-timeout, late-vendor penalty) were parked with the hub model — see R-08.
