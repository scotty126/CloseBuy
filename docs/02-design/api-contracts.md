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
| `POST /vendors` *(vendor)* | Submit vendor application | US-V-01; creates `VendorProfile` in `pending` |
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
| `POST /checkout` *(session optional)* | Convert a client-submitted cart → order, initiate payment | Body: `{ contactPhone, alternateContactPhone?, vendorId, items: [{productId, quantity}], fulfilmentType, scheduledFor?, addressId?, paymentMethod }`. No `Authorization` header → a guest order: `contactPhone` alone is enough, no `User`/`CustomerProfile` is created at all, `Order.customer_id` stays null (brief §3.1b). Signed-in → `customer_id` is set; `contactPhone` defaults to `CustomerProfile.default_phone` client-side but the field is still required in the body (the client presets it, the server doesn't infer it). Requires `Idempotency-Key` header. Re-validates price, stock and the single-vendor rule (US-C-06) before charging — 409 with a diff if anything changed since the client last saw it. Returns a Monnify payment reference/redirect **and** the order's `tracking_token` (US-C-06a) |
| `GET /orders/track/:trackingToken` *(no session required)* | Order status by token | Works for both a guest order and a signed-in customer's order — deliberately never reachable by phone number or email, so knowing one person's contact info can't expose another's order (US-C-06a) |
| `POST /orders/track/:trackingToken/rate` *(no session required)* | Guest rating | Same shape as `POST /orders/:id/rate` below; token-authenticated instead of session-authenticated (US-C-10) |
| `POST /orders/track/:trackingToken/dispute` *(no session required)* | Guest dispute | Same shape as `POST /orders/:id/dispute` below; token-authenticated instead of session-authenticated (US-C-11) |
| `POST /webhooks/monnify` | Payment gateway callback | Not customer-authenticated — verified by Monnify's signature instead. Idempotent on `gateway_reference`; drives `PENDING_PAYMENT → PAID` and the first `LedgerEntry` pair |
| `GET /orders/:id` *(customer/vendor/rider — own orders only)* | Order detail | Includes current status, full state-transition history, fulfilment type, `scheduled_for` |
| `GET /orders` *(customer)* | Order history | US-C-09 |
| `POST /orders/:id/cancel` *(customer)* | Self-service cancel | Only while `status = PAID` (US-C-08); 422 otherwise, directs to a dispute/support path |
| `POST /orders/:id/accept` *(vendor)* | Accept a `PAID` order | → `PREPARING`; cancels the auto-reject timer (US-V-05) |
| `POST /orders/:id/reject` *(vendor)* | Reject | `{ reason }` required; triggers full refund via Monnify, → `CANCELLED` |
| `POST /orders/:id/ready` *(vendor)* | Mark ready | → `READY_FOR_PICKUP`; for delivery, triggers Dispatch to offer the job; for pickup, triggers a customer notification instead (brief §3.1a) |
| `POST /orders/:id/confirm-pickup` *(vendor)* | Confirm customer collection | `{ code }` — pickup orders only; → `DELIVERED` directly, no rider involved |
| `POST /orders/:id/rate` *(customer)* | Rate vendor and/or rider | Only on `COMPLETED` orders, editable 24h (US-C-10) |
| `POST /orders/:id/dispute` *(customer)* | Open a dispute | Holds pending escrow release for this order (US-C-11) |

## Dispatch (delivery-fulfilment orders only)

| Method & path | Purpose | Notes |
|---|---|---|
| `PATCH /riders/me/duty` *(rider)* | Toggle on/off duty | US-R-02 |
| `GET /riders/me/offers` *(rider)* | Poll for a pending job offer | Short-poll while on duty and idle — no persistent connection (ADR-0001) |
| `POST /riders/me/offers/:id/accept` *(rider)* | Accept a job | Exclusive assignment enforced at the DB layer — a second rider's accept on the same order 409s (US-R-03) |
| `POST /riders/me/offers/:id/decline` *(rider)* | Decline | No penalty recorded (US-R-03) |
| `POST /orders/:id/confirm-collection` *(rider)* | Confirm pickup from vendor | `{ code }` → `IN_TRANSIT` (US-R-04) |
| `POST /orders/:id/confirm-delivery` *(rider)* | Confirm delivery to customer | `{ proof: { photo_url? , recipient_name?, code? }, cash_collected_minor? }` → `DELIVERED` (US-R-05) |
| `POST /orders/:id/delivery-failed` *(rider)* | Report failure | `{ reason }` → `DELIVERY_FAILED` (US-R-06) |
| `GET /riders/me/earnings` *(rider)* | Earnings list + cash balance | US-R-07 |
| `POST /riders/me/remit` *(rider)* | Log a cash remittance | Recorded by admin in practice — this may end up admin-initiated rather than rider-initiated; confirm during M3 build (US-R-08) |

## Notifications

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /notifications/subscribe` | Register a Web Push subscription | Called once per device |
| `GET /notifications` *(any authenticated user)* | In-app notification feed | |
| `POST /notifications/:id/read` | Mark read | |

## Admin

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /admin/applications` | Pending vendor/rider applications | US-A-01 |
| `POST /admin/applications/:id/approve` | Approve | Sets `founding_vendor_commission_waived_until` if the program is currently open (brief §3.2a) |
| `POST /admin/applications/:id/reject` | Reject | `{ reason }` required |
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
