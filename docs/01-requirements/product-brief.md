# OmniDash — Product Brief

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 01 — Requirements

## 1. Problem statement

In West African markets, small and mid-sized sellers have inventory and customers have demand, but the connection between them is fragmented. Sellers transact over Instagram and WhatsApp with no order management, no payment guarantee and no delivery network. Buyers have no protection against paying for goods that never arrive. Independent riders have no steady source of jobs.

OmniDash connects all three sides on one platform: vendors list and sell, customers order and pay under escrow protection, and riders deliver — with the platform operator retaining oversight of the whole flow.

## 2. Actors

| Actor | Surface | Core need |
|---|---|---|
| **Customer** | Customer app (web/PWA) | Find goods, pay safely, know where the order is |
| **Vendor** | Vendor dashboard | List stock, receive orders, fulfil, get paid reliably |
| **Rider** | Rider app (web/PWA) | Receive jobs nearby, navigate, prove delivery, get paid |
| **Superadmin** | Admin dashboard | Onboard and vet actors, resolve disputes, control money and config |

A fifth implicit actor is the **system itself**, which runs dispatch, payouts, notifications and scheduled reconciliation without human involvement.

## 3. Domain decisions that shape everything downstream

These are not implementation details. They change the data model, so they are settled at requirements stage.

### 3.1 A cart is single-vendor, unless the vendors share a hub

Most launch vendors trade out of a small number of physical **hubs** — a market, a mall, a food court — the same way Computer Village, Balogun Market or a shopping complex hosts hundreds of independent traders under one roof. That physical fact is the basis of the cart rule:

- A cart may hold items from **one vendor only**, unless
- every vendor in the cart shares the **same hub**, in which case the cart may span them.

A vendor not attached to a hub is **standalone** and is always restricted to a single-vendor cart. Adding an item that would break either rule prompts the customer to clear the cart or keep the existing one — the same pattern DoorDash uses.

On checkout the system still splits payment into **one sub-order per vendor**, and each sub-order is still accepted, prepared and settled independently, and may be cancelled or refunded without affecting its siblings. What changes is dispatch, not the sub-order model:

- **Single-vendor cart** → one sub-order → one rider job, one pickup, one dropoff. This is the common case and stays exactly as simple as DoorDash's.
- **Same-hub multi-vendor cart** → several sub-orders, but **one rider job** covering every stop: the rider is assigned once, sees a checklist of stalls to collect from within that hub, confirms each pickup separately (§US-R-04), then makes one dropoff. Riders are never sent to the same hub twice for one purchase.

**Readiness misalignment is the operational risk this introduces.** If one stall preps in 3 minutes and another takes 20, the rider should not wait indefinitely. Default policy, to be confirmed against real hub behaviour once trading starts: the rider waits up to a configurable timeout after the first sub-order reaches `READY_FOR_PICKUP`; on timeout, the ready sub-orders dispatch immediately as a partial delivery and the late sub-order follows as its own job. The customer is not charged a second delivery fee, and the slow vendor's reliability metric (US-V-05) absorbs the cost, not the customer.

**Delivery fee for a multi-stop job is base fee plus a per-additional-stop surcharge**, reflecting the rider's added queuing time rather than distance, since distance barely changes when pickups are co-located. The surcharge is admin-configurable (US-A-02), not hardcoded — see Q-06.

The customer still sees one purchase. Vendors, riders and accounting each see separate sub-orders; the rider additionally sees whichever of those sub-orders were grouped into their one job.

### 3.2 Money is held in escrow, not forwarded

Customer payment is captured by the platform and held. Funds are released to the vendor only after delivery is confirmed, minus platform commission and, where applicable, rider earnings. This is the mechanism that makes the marketplace trustworthy to a buyer who has never heard of the seller.

**Consequence — and it is a serious one:** holding customer funds may constitute regulated activity under CBN rules. See Risk R-01.

### 3.3 Category determines the rules

A mixed marketplace cannot have one fulfilment flow. Each vendor category carries its own configuration:

| Category | Prep time | Delivery window | Returnable | Special handling |
|---|---|---|---|---|
| Food | Minutes | Immediate | No | Temperature, tight SLA |
| Retail goods | Hours | Same/next day | Yes | Standard |
| Pharmacy | Minutes | Immediate | No | Licence check, restricted items |
| Groceries | Minutes | Immediate | Partial | Substitutions, weight pricing |

Category is a first-class configurable entity, not a hardcoded enum branch.

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

Applies per sub-order — one vendor's portion of a purchase. Rider *dispatch* is a layer above this diagram: a single rider job may cover one sub-order or several (§3.1), but each sub-order still moves through these states independently and is the unit that vendors, payouts and disputes operate on.

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

- **Customer** — registration, browse, search, cart, checkout, order status tracking, order history, ratings
- **Vendor** — onboarding with KYC, product and inventory management, order queue, payout view
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
- Live rider position on a map for the customer — tracking is status-based; see 3.5
- Automatic route optimisation or turn-by-turn navigation inside the rider app
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
| A-01 | Launch is single-country, single-currency (NGN) |
| A-02 | Riders are independent contractors, not employees |
| A-03 | Vendors hold their own stock; the platform never takes possession of goods |
| A-04 | Delivery is intra-city; no inter-state logistics in v1 |
| A-05 | Customers have smartphones with a data connection, albeit often slow |
| A-06 | Cash on delivery will be a significant share of transactions and cannot be treated as an edge case |
| A-07 | Most active vendors at launch are co-located within a small number of physical hubs; standalone vendors are the minority |

## 8. Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| **R-01** | Holding customer funds in escrow may require CBN licensing | **Severe — could block launch** | Take legal advice before building a wallet. Design so escrow can be delegated to a licensed gateway's split-payment feature instead |
| R-02 | ~~Rider background GPS unreliable on PWA~~ **Largely retired** by the status-based tracking decision in 3.5 | Low | Location is read only in the foreground at pickup and delivery. Revisit only if live tracking is reintroduced |
| R-07 | Without live tracking, customers phone support asking "where is my order?" | Support load | Proactive notification on every state change; show a clear expected-by window rather than a silent gap |
| R-03 | Cash-on-delivery reconciliation; riders holding platform money | Financial loss | Per-rider cash ledger, float limits, mandatory remittance before new jobs |
| R-04 | Marketplace cold start — no vendors means no customers | Launch failure | Seed one category in one area before widening |
| R-05 | Fraudulent vendors or fake listings | Trust collapse | Mandatory KYC, staged trust levels, payout delay for new vendors |
| R-06 | Solo developer, four surfaces | Schedule overrun | Staged roadmap in stage 03; shared component library; each surface reaches usable state before the next begins |
| R-08 | Hub multi-stop dispatch (§3.1) adds real complexity to rider assignment and the rider UI | Schedule slip on that slice specifically | Ship single-vendor dispatch first; add hub grouping as a second pass once the walking skeleton works end to end |

## 9. Open questions

| ID | Question |
|---|---|
| Q-01 | Commission model — flat percentage, per-category, or tiered by volume? |
| Q-02 | Who bears the delivery fee — customer, vendor, or split? |
| Q-03 | Are riders assigned automatically by proximity, or do they claim from an open pool? |
| Q-04 | Is there a customer wallet, or is every payment a fresh transaction? (Bears directly on R-01) |
| Q-05 | Self-service vendor signup with later vetting, or admin-invite only at launch? |
| Q-06 | Multi-stop surcharge — flat amount per extra stop, or a formula? |
| Q-07 | Hub wait-timeout before a lagging vendor is split into its own job — proposed default 20 minutes, needs confirming against real hub behaviour |
| Q-08 | Does a vendor missing the wait-timeout carry a real penalty (e.g. a shortened auto-accept window) from launch, or informational-only on the reliability metric until there's data to justify one? |
