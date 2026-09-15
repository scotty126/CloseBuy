# NearBuy — Product Brief

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 01 — Requirements

## 1. Problem statement

In West African markets, small and mid-sized sellers have inventory and customers have demand, but the connection between them is fragmented. Sellers transact over Instagram and WhatsApp with no order management, no payment guarantee and no delivery network. Buyers have no protection against paying for goods that never arrive. Independent riders have no steady source of jobs.

NearBuy connects all three sides on one platform: vendors list and sell, customers order and pay under escrow protection, and riders deliver — with the platform operator retaining oversight of the whole flow.

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

### 3.1 A cart, and an order, belong to exactly one vendor

For v1, a cart may hold items from **one vendor only**. Adding an item from a different vendor prompts the customer to clear the cart or keep the existing one — the same pattern DoorDash uses. One cart produces one order, for one vendor, fulfilled by one rider doing one pickup and one dropoff. There is no order-splitting logic to build, test or reconcile.

**This was a deliberate simplification, not the starting assumption.** Most launch vendors are expected to trade out of a small number of shared physical hubs (a market, a mall, a food court — the way Computer Village or Balogun Market hosts hundreds of traders under one roof), which would make a *hub-scoped* multi-vendor cart viable: several vendors, split into separate sub-orders at checkout, collected by one rider on a single multi-stop trip. That model is sound and may be worth revisiting once the platform has real trading volume — but it adds real complexity (order splitting, multi-stop rider dispatch, pickup checklists, readiness-timeout handling between vendors on different prep schedules) that isn't justified before the single-vendor path is proven end to end. It is parked, not discarded: see the retired items under §5 and R-08.

If it does return, the mechanism to reintroduce is: a `hub` entity vendors can optionally belong to; a cart rule allowing multiple vendors only when every vendor in it shares a hub; checkout splitting into one sub-order per vendor; and dispatch grouping same-hub sub-orders into one rider job. None of that is being built now.

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

Applies to an order — which is, for v1, one purchase from one vendor (§3.1).

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
- Hub-scoped multi-vendor cart and split checkout — parked per §3.1, may return post-v1
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
| A-07 | Many launch vendors are expected to be co-located within a small number of physical hubs — not acted on in v1 (§3.1), but relevant if hub-scoped multi-vendor carts are reconsidered later |

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
| R-08 | Hub multi-vendor dispatch was scoped out (§3.1) specifically to avoid this: order-splitting, multi-stop pickup and cross-vendor readiness timeouts are real complexity a solo build shouldn't carry before the single-vendor path is proven | N/A — parked, not active | If revisited, re-open with the surcharge amount, hub wait-timeout and late-vendor penalty policy decided up front, and treat it as its own milestone rather than folding it into the walking skeleton |

## 9. Open questions

| ID | Question |
|---|---|
| Q-01 | Commission model — flat percentage, per-category, or tiered by volume? |
| Q-02 | Who bears the delivery fee — customer, vendor, or split? |
| Q-03 | Are riders assigned automatically by proximity, or do they claim from an open pool? |
| Q-04 | Is there a customer wallet, or is every payment a fresh transaction? (Bears directly on R-01) |
| Q-05 | Self-service vendor signup with later vetting, or admin-invite only at launch? |

Q-06–Q-08 (multi-stop surcharge, hub wait-timeout, late-vendor penalty) were parked with the hub model — see R-08.
