# CloseBuy — Data Model

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 02 — Design

Entities are grouped by the module that owns them (architecture.md §2). All monetary fields are integers in the minor currency unit (kobo, per US-V-03's price rule) — never floating point, anywhere, including in the ledger.

## 1. Entity relationship overview

```
User ──┬── CustomerProfile ── Address (many)
       ├── VendorProfile ──── Product (many) ──── Category
       ├── RiderProfile
       └── AdminProfile

CustomerProfile ── Cart ── CartItem ── Product
                     │
                     ▼ (checkout)
                   Order ──┬── OrderItem
                            ├── OrderStateTransition (many, append-only)
                            ├── Payment
                            ├── LedgerEntry (many)
                            ├── Dispute (0 or 1)
                            └── Rating (0, 1 or 2 — vendor + rider)

VendorProfile ── Order (as seller)
RiderProfile  ── Order (as courier, nullable until assigned)

Payout ── VendorProfile or RiderProfile
Config ── (standalone, versioned)
AuditLog ── (standalone, references any entity by type + id)
Notification ── User
```

## 2. Core entities

### User
The identity every role attaches to. One row per phone number regardless of role — a phone number is never shared across roles.

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| phone | string, unique | E.164 format |
| phone_verified_at | timestamp, nullable | Null blocks any ordering/selling/riding action |
| role | enum: customer, vendor, rider, admin | One role per user in v1 — no dual-role accounts |
| created_at | timestamp | |

### CustomerProfile / VendorProfile / RiderProfile / AdminProfile
One-to-one with `User`, role-specific fields.

**VendorProfile**: business_name, category_id, description, logo_url, pickup_address (embedded: lat, lng, landmark, phone — per brief §3.4), bank_account_ref, status (enum: pending, approved, suspended, rejected), is_open (bool), supports_pickup (bool — brief §3.1a, independent of is_open), opening_hours, reliability_score (decimal), **founding_vendor_commission_waived_until (timestamp, nullable — brief §3.2a; set to approved_at + 3 months on approval during the launch promotion window, null once expired or if the vendor joined outside it)**, created_at.

**RiderProfile**: full_name, vehicle_type, id_document_url, bank_account_ref, status (pending, approved, suspended, rejected), on_duty (bool), cash_balance_minor (int — brief R-03/US-R-08), created_at.

### Address
Customer-saved delivery addresses. Embedded pin, not a postal string (brief §3.4).

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| customer_id | fk → CustomerProfile | |
| label | string | "Home", "Office", etc. |
| lat, lng | decimal | |
| landmark_description | text | |
| contact_phone | string | May differ from account phone |
| is_within_service_area | bool | Computed at save time (US-C-05) |

### Category
Admin-configurable (US-A-02), not a hardcoded enum (brief §3.3).

| Field | Type | Notes |
|---|---| ---|
| id | uuid | |
| name | string | |
| default_prep_minutes | int | Informational SLA target |
| is_active | bool | |

Commission is **not** a category field — see §4a. It varies by fulfilment type, not by what's being sold.

### Product

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| vendor_id | fk → VendorProfile | |
| category_id | fk → Category | |
| name, description | string, text | |
| price_minor | int | **Integer, minor units — never float** (US-V-03) |
| images | string[] | R2 object keys |
| stock | int | Decrements on order confirm; never negative (US-V-04) |
| is_active | bool | Deactivate, never hard-delete — order history references it (US-V-03) |

## 3. Cart and Order

### Cart / CartItem
One active cart per customer, scoped to a single vendor (brief §3.1 — this is enforced at the application layer: adding a product from a different vendor than the cart's current `vendor_id` is rejected, not merged).

| Field | Type | Notes |
|---|---|---|
| Cart.id | uuid | |
| Cart.customer_id | fk | |
| Cart.vendor_id | fk, nullable | Null only when the cart is empty |
| CartItem.product_id | fk | |
| CartItem.quantity | int | |

### Order
The unit everything else hangs off. One vendor, one customer, one (eventual) rider.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Customer-facing order number is a separate short display code |
| customer_id, vendor_id | fk | |
| rider_id | fk, nullable | Set on `RIDER_ASSIGNED`; never set for a pickup order |
| fulfilment_type | enum: delivery, pickup | Brief §3.1a |
| scheduled_for | timestamp, nullable | Null means "as soon as possible"; set means a reserved slot |
| address_id | fk, nullable | Null for pickup orders — see note below |
| status | enum | Exactly the states in brief §4; a pickup order skips `RIDER_ASSIGNED`/`IN_TRANSIT` |
| payment_method | enum: card, transfer, cash_on_delivery | `cash_on_delivery` is only valid when `fulfilment_type = delivery` |
| subtotal_minor, delivery_fee_minor, discount_minor, commission_minor, total_minor | int | `delivery_fee_minor` is always 0 for pickup; `commission_minor` is computed at completion per §4a, not charged to the customer |
| created_at, updated_at | timestamp | |

**Snapshotting matters here.** `OrderItem` copies `name` and `price_minor` from the product at the moment of purchase — editing a product later must never alter a historical order's figures (US-V-03). Address is referenced by id for convenience but the lat/lng/landmark used for that specific delivery should be considered immutable once the order leaves `PAID`; if the customer edits or deletes a saved `Address` row later, the order's copy must not silently change. (Open implementation question — see §5.)

### OrderStateTransition
Append-only. This table, not application logs, is the evidence base for disputes (US-A-04) and reconciliation (US-A-05).

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| order_id | fk | |
| from_status, to_status | enum | |
| actor_type | enum: customer, vendor, rider, admin, system | |
| actor_id | uuid, nullable | Null when `actor_type = system` (e.g. auto-reject timeout) |
| reason | text, nullable | |
| created_at | timestamp | Never updated |

No `UPDATE` or `DELETE` is ever issued against this table by the application — enforced at the database layer with a revoke on those grants for the application role, not left to code discipline alone.

## 4. Money — Payment, LedgerEntry, Payout

This is the part that cannot be sloppy (NFR-07, R-01).

### Payment
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| order_id | fk | |
| gateway | enum: monnify, paystack | |
| gateway_reference | string, unique | Idempotency key — a repeated webhook with the same reference is a no-op (US-C-06) |
| amount_minor | int | |
| status | enum: pending, succeeded, failed, refunded | |

### LedgerEntry
Double-entry, append-only. Every money movement is (at least) two rows that net to zero.

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| order_id | fk | |
| account | enum: customer_escrow, vendor_payable, platform_commission, rider_payable, rider_cash_float | |
| direction | enum: debit, credit | |
| amount_minor | int | |
| created_at | timestamp | |

A correction is a new pair of entries reversing the original — never an edit (brief §3.2, NFR-07). US-A-05's reconciliation report is, mechanically, "sum every account and confirm the whole ledger nets to zero, then compare the escrow account's balance against Monnify's own settlement report for the same period." With multi-daily settlement, this reconciliation plausibly needs to run more than once a day too, not just at end of day — worth confirming once Monnify's actual settlement/reporting cadence is verified (ADR-0001).

### Payout
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| payee_type | enum: vendor, rider | |
| payee_id | uuid | |
| amount_minor | int | |
| status | enum: scheduled, paid, failed | |
| reference | string | Monnify transfer reference |
| created_at | timestamp | |

## 4a. Commission — resolves Q-01

Commission is **per fulfilment type, platform-wide**, not per category and not tiered by volume:

| Fulfilment type | Commission |
|---|---|
| Pickup | 5% |
| Delivery | 10% |

Stored as two `Config` rows (`commission_rate.pickup`, `commission_rate.delivery`), versioned like every other `Config` value (§5) — so a rate change never alters an order already placed, and the rate history itself is auditable.

**Founding Vendor Program**: a vendor approved during the launch promotion window gets `founding_vendor_commission_waived_until` set on `VendorProfile` (§2) to three months from approval. While that timestamp is in the future, commission on that vendor's orders is 0% regardless of the table above. This is a per-vendor override evaluated at the moment an order completes, not a platform-wide rate change — two vendors can legitimately be on different effective commission rates on the same day.

**Commission is strictly separate from two other deductions that also touch the same order**, per the explicit business rule this resolves from:

- **Payment gateway processing fees** (Monnify's own cut of the transaction) — a cost of accepting payment at all, not part of CloseBuy's take.
- **Delivery fee** — passes to the rider (`rider_payable`), not to CloseBuy; CloseBuy's revenue on a delivery order is the commission alone, not the delivery fee.

At order completion, the ledger computation is: commission = 0 if the founding-vendor waiver is active, else `total_minor × commission_rate[fulfilment_type]` from the live `Config`; this posts as a `platform_commission` credit and a matching `vendor_payable` debit, entirely separate from the `rider_payable` entry a delivery order also generates.

## 5. Platform entities

**Dispute** — order_id, customer_id, reason, evidence (string[] of R2 keys), status (open, resolved), resolution (enum: full_refund, partial_refund, rejected), resolved_by (admin id), resolved_at.

**Rating** — order_id, customer_id, target_type (vendor, rider), target_id, score (1–5), comment, created_at, edited_until (created_at + 24h, per US-C-10).

**Notification** — user_id, type, payload (jsonb), sent_at, read_at.

**Config** — key, value (jsonb), version (int), effective_at. Never overwritten — a new row with an incremented version is how a value changes, so a historical order can be checked against the config that was live when it was placed (US-A-02). Examples: `commission_rate.pickup`, `commission_rate.delivery` (§4a).

**AuditLog** — actor_id, action, target_type, target_id, reason, created_at. Broader than `OrderStateTransition`: covers config changes, vetting decisions, suspensions, forced interventions (US-A-08) — anything consequential that isn't itself an order-state change.

## 6. Invariants worth stating explicitly

These are the rules a migration or a future feature must never violate:

1. **All money is an integer minor-unit column.** No `float`/`numeric` with implied decimals anywhere in the schema.
2. **`OrderStateTransition` and `LedgerEntry` are insert-only** at the database grant level, not just by convention.
3. **A `Cart` can reference exactly one vendor at a time** (brief §3.1) — enforced by rejecting the write, not by a database constraint alone, since the error needs to reach the customer with the "clear cart?" prompt from US-C-04.
4. **Stock decrement is a single atomic transaction** with the order-status change on acceptance, guarding against the race condition named in US-V-04 ("stock cannot go negative under concurrent orders") — a `SELECT ... FOR UPDATE` or equivalent, not a read-then-write from the application.
5. **Every `Config` change is versioned, never mutated in place**, so a historical order's totals can always be explained by the config active at the time.

## Open items for implementation stage

- Whether `Order.address_id` should instead fully embed a copy of the address fields at order time (safer against a later address edit, more denormalised) rather than a foreign key — leaning toward embedding, to be confirmed when the Order table is actually migrated.
- Exact set of `Category`-level fields needed per brief §3.3's fulfilment-rule table (prep time, returnability, special handling) — the table above has the minimum; category-specific validation rules (e.g. pharmacy licence check) may need their own small config structure rather than flat columns.
