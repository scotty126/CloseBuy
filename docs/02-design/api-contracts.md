# CloseBuy — API Contracts

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 02 — Design

REST over HTTPS, JSON bodies, organised by the modules in [architecture.md](architecture.md) §2. This is the endpoint surface and its shape, not a full OpenAPI spec — that gets generated from the implementation once Prisma models exist, not hand-written twice. Every entity referenced here is defined in [data-model.md](data-model.md).

## Conventions

- **Auth:** `Authorization: Bearer <jwt>` on every endpoint except Auth's own login/verify. The JWT carries `user_id` and `role`; every handler checks role and, where relevant, resource ownership (a customer can only read their own orders, a vendor only their own).
- **Money:** every amount in a request or response body is an integer, minor units. No endpoint ever accepts or returns a decimal for currency.
- **Idempotency:** any endpoint that creates a financial side effect (`POST /checkout`, gateway webhooks) accepts/requires an idempotency key and is safe to retry.
- **Pagination:** list endpoints use `?cursor=&limit=` (default 20, max 100), never raw offset — cheaper on Postgres, safer against inconsistent results while rows are being inserted concurrently.
- **Errors:** `{ "error": { "code": "STRING_CODE", "message": "human readable" } }`, standard HTTP status (400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict, 422 business-rule violation e.g. "vendor closed").

## Auth

Two separate paths, by role (brief §3.1b) — a customer never touches the OTP endpoints, a vendor/rider/admin never touches the password/OAuth ones.

**Vendor / rider / admin — phone + OTP, unchanged from M0:**

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /auth/otp/request` | Send an OTP to a phone number | Rate-limited per US-V-01/US-R-01 (5 attempts / 15 min) |
| `POST /auth/otp/verify` | Verify code, issue session | Returns JWT + refresh token; creates the `User` row on first success |

**Customer — email/password or Google/Apple:**

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /auth/register` | Email + password sign-up | Sends a (non-blocking) verification email; issues a session immediately — US-C-01 |
| `POST /auth/login` | Email + password sign-in | Rate-limited: 5 failed attempts / 15 min locks the account, mirroring the old OTP lockout (US-C-01) |
| `POST /auth/forgot-password` | Request a reset link | Always 204, whether or not the email exists — never reveals account existence |
| `POST /auth/reset-password` | Complete a reset | `{ token, newPassword }`; token is single-use and expires |
| `GET /auth/oauth/google` | Start Google sign-in | Redirects to Google; standard OAuth2 authorization-code flow |
| `GET /auth/oauth/google/callback` | Google redirects back here | Creates or links a `User` via `OAuthAccount` (matches by verified email if one already exists — see data-model.md §2), issues a session |
| `GET /auth/oauth/apple` / `/auth/oauth/apple/callback` | Same shape, Apple | Apple's flow is a POST-back, not a redirect GET, on the callback specifically — implementation detail, same outcome |

**Shared by both paths:**

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /auth/refresh` | Rotate an expiring session | |
| `POST /auth/logout` | Invalidate the current session | |

## Catalog

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /categories` | List active categories | Public |
| `GET /vendors` | List/search vendors | Filters: `category`, `q`, `lat`/`lng` (service-area + distance), `fulfilment` (delivery/pickup support) — backs US-C-02/03 |
| `GET /vendors/:id` | Storefront detail | Includes `supports_pickup`, `is_open`, opening hours |
| `GET /vendors/:id/products` | A vendor's active product list | |
| `POST /vendors` *(vendor)* | Submit vendor application | US-V-01; creates `VendorProfile` in `pending`. 422 `OUTSIDE_SERVICE_AREA` if `pickupLat`/`pickupLng` fall outside the launch polygon (brief §2a, data-model.md's `Config` §5) |
| `GET /vendors/me` *(vendor)* | Own storefront, any status | Unlike `GET /vendors/:id`, not gated on `approved` — a pending vendor needs to see their own application |
| `PATCH /vendors/me` *(vendor)* | Edit storefront | Name, hours, `is_open`, `supports_pickup` — US-V-02. Editable regardless of application status; only customer-facing visibility gates on `approved` |
| `POST /vendors/me/products` *(vendor)* | Create product | US-V-03 |
| `PATCH /vendors/me/products/:id` *(vendor)* | Edit product | Price edits never touch past `OrderItem` snapshots |
| `DELETE /vendors/me/products/:id` *(vendor)* | Deactivate (not delete) | Sets `is_active = false` |

## Cart

No endpoints — the cart is client-side state (device-local), per brief §3.1b. There is nothing to sync until checkout, since a cart can exist before any customer record does (guest browsing). The single-vendor rule (brief §3.1) and the fulfilment/timing choice (US-C-05a) are both enforced client-side for immediate feedback, and re-enforced server-side at `POST /checkout` below — checkout is the one place the server has to stop trusting client state.

## Order & Checkout

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /checkout` *(session optional)* | Convert a client-submitted cart → order, initiate payment | Body: `{ contactPhone, alternateContactPhone?, email?, vendorId, items: [{productId, quantity}], fulfilmentType, scheduledFor?, addressId?, deliveryLat?, deliveryLng?, deliveryLandmark?, paymentMethod }` — the three `delivery*` fields are required for `fulfilmentType: "delivery"`, omitted for pickup; `email` is only ever used for a guest's Monnify receipt, falling back to a synthesized placeholder if omitted. No `Authorization` header → a guest order: `contactPhone` alone is enough, no `User`/`CustomerProfile` is created at all, `Order.customer_id` stays null (brief §3.1b). `Idempotency-Key` header, reused directly as `Payment.gateway_reference` and Monnify's `paymentReference` — a repeated call with the same key returns the original order rather than creating a second one. Re-validates price, stock, vendor approval/open status and the single-vendor rule (US-C-06) before charging. For `fulfilmentType: "delivery"`, also 422s `OUTSIDE_SERVICE_AREA` if the address falls outside the launch polygon (US-C-05, brief §2a) — pickup orders skip this, since the vendor's own pickup location was already validated the same way at application time. Cash on delivery skips Monnify entirely and returns the order already `PAID`; card/transfer returns a `checkoutUrl` redirect and leaves the order `PENDING_PAYMENT` until the webhook confirms. Always returns the order's `tracking_token` (US-C-06a) |
| `GET /orders/track/:trackingToken` *(no session required)* | Order status by token | Works for both a guest order and a signed-in customer's order — deliberately never reachable by phone number or email, so knowing one person's contact info can't expose another's order (US-C-06a) |
| `POST /orders/track/:trackingToken/rate` *(no session required)* | Guest rating | Same shape as `POST /orders/:id/rate` below; token-authenticated instead of session-authenticated (US-C-10) |
| `POST /orders/track/:trackingToken/dispute` *(no session required)* | Guest dispute | Same shape as `POST /orders/:id/dispute` below; token-authenticated instead of session-authenticated (US-C-11) |
| `POST /webhooks/monnify` *(no session — signature-verified instead)* | Payment gateway callback | Header `monnify-signature`, HMAC-SHA512 of the raw body keyed with the secret — verified against the exact bytes Monnify sent, which is why this route parses its body as a raw string rather than letting Fastify JSON-parse it. Idempotent on `gateway_reference` (a `payment.status = succeeded` replay is a no-op). Drives `PENDING_PAYMENT → PAID` and posts the escrow-hold `LedgerEntry` pair |
| `GET /orders/:id` *(customer/vendor/rider — own orders only)* | Order detail | Includes current status, full state-transition history, fulfilment type, `scheduled_for` |
| `GET /orders` *(customer)* | Order history | US-C-09 |
| `POST /orders/:id/cancel` *(customer)* | Self-service cancel | Only while `status = PAID` (US-C-08); 422 otherwise. Refunds via Monnify if actually paid, no-ops for cash on delivery (nothing was ever charged) |
| `POST /orders/:id/accept` *(vendor)* | Accept a `PAID` order | → `PREPARING`; atomically decrements stock per item (422 if any item's stock ran out while the order waited in the accept window — data-model.md §6 invariant 4); cancels the auto-reject timer (US-V-05) |
| `POST /orders/:id/reject` *(vendor)* | Reject | `{ reason }` required; → `CANCELLED` → `REFUNDED` (via Monnify if paid, a no-op for cash); vendor's reliability score takes a hit |
| `POST /orders/:id/ready` *(vendor)* | Mark ready | → `READY_FOR_PICKUP`, generates the `collection_code` both confirmation paths below need. For delivery, this is also where Dispatch would offer the job — not built yet, so a delivery order correctly waits here rather than progressing further |
| `POST /orders/:id/confirm-pickup` *(vendor)* | Confirm collection | `{ code }`, checked against `collection_code` — pickup orders only; → `DELIVERED` directly, no rider involved, and schedules the escrow-release timer |
| `POST /orders/:id/rate` *(customer)* | Rate vendor and/or rider | Only on `COMPLETED` orders, editable 24h (US-C-10) |
| `POST /orders/:id/dispute` *(customer)* | Open a dispute | Holds pending escrow release for this order (US-C-11) |

## Dispatch (delivery-fulfilment orders only)

**One simplification worth stating plainly:** there's no separate "job offer" resource, unlike the shape this table originally sketched. An unclaimed `READY_FOR_PICKUP` delivery order *is* the offer (US-R-03's open-pool model, Q-03) — `GET /riders/me/offers` just lists those orders directly. Accepting is an atomic conditional update (`riderId IS NULL AND status = 'READY_FOR_PICKUP'`), the same pattern US-V-04's stock decrement uses, so two riders racing for the same job can never both win. Declining is consequently a genuine no-op against the database — nothing is tracked per-rider, so a declined job stays visible to everyone including the rider who declined it. A real "don't show me this again" needs a dismissals table this doesn't have yet.

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /riders` *(rider)* | Submit rider application | US-R-01; creates `RiderProfile` in `pending`, mirroring `POST /vendors` |
| `GET /riders/me` *(rider)* | Own profile, any status | Mirrors `GET /vendors/me` |
| `PATCH /riders/me/duty` *(rider)* | Toggle on/off duty | US-R-02; 403 if the application isn't `approved` yet |
| `GET /riders/me/offers` *(rider)* | List open jobs | Short-poll while on duty and idle — no persistent connection (ADR-0001). Empty while off duty or unapproved, not an error |
| `POST /riders/me/offers/:id/accept` *(rider)* | Claim a job | → `RIDER_ASSIGNED`. 409 `JOB_UNAVAILABLE` if it's already taken, or the rider isn't on duty (US-R-03) |
| `POST /riders/me/offers/:id/decline` *(rider)* | Decline | No penalty, no persisted effect (US-R-03) — see the note above |
| `POST /orders/:id/confirm-collection` *(rider)* | Confirm pickup from vendor | `{ code }`, checked against `collection_code` — the same code a pickup order's customer would show instead (US-V-06); → `IN_TRANSIT` (US-R-04) |
| `POST /orders/:id/confirm-delivery` *(rider)* | Confirm delivery to customer | `{ photoUrl?, recipientName?, code?, cashCollectedMinor? }` — at least one proof field required. For `cash_on_delivery`, `cashCollectedMinor` must equal the order total exactly (400 `CASH_MISMATCH` otherwise) and posts the cash-collection ledger entries (data-model.md §4a) — this is the moment money first enters the books for a cash order, since nothing moved at checkout. → `DELIVERED`, schedules the escrow-release timer (US-R-05) |
| `POST /orders/:id/delivery-failed` *(rider)* | Report failure | `{ reason, notes? }` → `DELIVERY_FAILED`. Admin follow-up (refund decision, whether to return goods) isn't built yet — this records the failure honestly rather than pretending to resolve it (US-R-06) |
| `GET /riders/me/earnings` *(rider)* | Cleared vs. pending earnings + cash float | US-R-07 |
| `POST /riders/me/remit` *(rider)* | Log a cash remittance | Not built yet — recorded by admin in practice may end up the real answer rather than rider-initiated; still open, confirm during M3 (US-R-08) |

## Notifications

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /notifications/subscribe` | Register a Web Push subscription | Called once per device |
| `GET /notifications` *(any authenticated user)* | In-app notification feed | |
| `POST /notifications/:id/read` | Mark read | |

## Admin

**Built (M1) — application vetting only (US-A-01), the piece nothing else could substitute for:** without it, an applied vendor/rider sits in `pending` forever, since no other module ever writes `VendorProfile.status`/`RiderProfile.status`. Everything else below this line is the real, planned rest of Admin (architecture.md's module boundary, the Prisma models already exist) but isn't built yet — M2/M3, not forgotten.

Admin sign-in reuses the vendor/rider/admin phone+OTP path (`POST /auth/otp/verify` with `role: "admin"`), but with one deliberate asymmetry: unlike vendor/rider, a fresh phone number can never create an admin account through that endpoint — it only logs an *already-provisioned* admin in. Admin accounts are provisioned out of band (`SEED_ADMIN_PHONE` in local dev, a one-off script in production). Otherwise anyone could mint themselves an admin session by hitting a public endpoint with a new number, which would make every `requireAuth(["admin"])` check below meaningless.

An "application" isn't its own database row — it's a `pending` `VendorProfile` or `RiderProfile`. Since both use plain (non-namespaced) uuids, `:type` in the path disambiguates which table `:id` belongs to, rather than guessing by probing one table then the other.

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /admin/applications` | Pending vendor/rider applications, merged, oldest first | US-A-01 |
| `POST /admin/applications/:type/:id/approve` | Approve | `:type` is `vendor` or `rider`. Sets `foundingVendorCommissionWaivedUntil` to now + the configured waiver duration (default 3 months) if `founding_vendor_program_active` is currently true (brief §3.2a) — vendor only, computed once at approval time |
| `POST /admin/applications/:type/:id/reject` | Reject | `{ reason }` required (US-A-01's mandatory-reason acceptance criterion) |
| Both actions write an `AuditLog` row (actor, action, target, reason) and 409 if the application was already decided. | | |
| `GET /admin/orders` | Full order list | Filters: state, vendor, rider, date range, fulfilment type (US-A-03) |
| `POST /admin/orders/:id/reassign-rider` | Force reassignment | |
| `POST /admin/orders/:id/force-refund` | Force refund | Writes the same ledger-reversal pattern as a normal refund |
| `GET /admin/disputes` | Dispute queue | US-A-04 |
| `POST /admin/disputes/:id/resolve` | Resolve | `{ resolution: "full_refund"|"partial_refund"|"rejected", amount_minor?, reason }` |
| `GET /admin/config` | Current live config | Categories, `commission_rate.pickup`/`.delivery`, founding-vendor program state, delivery fee rules, accept-window |
| `PATCH /admin/config` | Update config | Writes a new versioned `Config` row (US-A-02) — never mutates the previous version |
| `POST /admin/payouts/run` | Trigger a payout run | Lists every payee with a cleared balance, executes via Monnify Disbursement (US-A-05) |
| `GET /admin/reconciliation` | Reconciliation report | Ledger totals vs. Monnify settlement report for a period |
| `GET /admin/metrics` | Platform health | US-A-07 |
| `POST /admin/vendors/:id/suspend` / `/riders/:id/suspend` | Suspend an actor | `{ reason }` (US-A-06) |
| `GET /admin/audit-log` | Search the audit log | Filters: actor, target, date range (US-A-08) |

## What's deliberately not here

- No endpoint accepts a raw card number, ever — Monnify's hosted fields handle that entirely client-side (NFR-05).
- No endpoint lets a vendor or rider write directly to `LedgerEntry` or `OrderStateTransition` — those are only ever written by the server in response to the state-changing endpoints above, per the append-only invariant (data-model.md §6).
- No public API for third parties (brief §5, explicitly out of scope for v1) — every endpoint above assumes a CloseBuy first-party client.
