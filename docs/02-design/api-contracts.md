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
| `GET /customer/profile` *(customer)* | Read `{ defaultPhone }` | The one field checkout presets from (brief §3.1b) |
| `PATCH /customer/profile` *(customer)* | Update `{ defaultPhone }` | `null` clears it — a valid PATCH, not an error |

**Shared by both paths:**

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /auth/refresh` | Rotate an expiring session | |
| `POST /auth/logout` | Invalidate the current session | |

## Catalog

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /categories` | List active categories | Public |
| `GET /vendors` | List/search vendors | Filters: `category`, `q`, `lat`/`lng` (service-area + distance), `fulfilment` (delivery/pickup support) — backs US-C-02/03. Each row includes `ratingAverage`/`ratingCount` (US-C-10, **built** 2026-09-26) — `null`/`0` until a real customer rating exists, never a fake zero. Replaces `VendorProfile.reliabilityScore`, which this list used to show instead — that's an internal ops metric (only ever decreases on the vendor's own auto-reject/reject), never a customer rating, and was never meant to be public |
| `GET /vendors/:id` | Storefront detail | Includes `supports_pickup`, `is_open`, opening hours, `ratingAverage`/`ratingCount` (same as above) |
| `GET /vendors/:id/products` | A vendor's active product list | |
| `GET /delivery-fee` | Current flat delivery fee | Public — the same `Config` value Order/Checkout charges, made readable so the checkout screen shows a real number instead of a guess (`flat_delivery_fee_minor`) |
| `POST /vendors` *(vendor)* | Submit vendor application | US-V-01; creates `VendorProfile` in `pending`. 422 `OUTSIDE_SERVICE_AREA` if `pickupLat`/`pickupLng` fall outside the launch polygon (brief §2a, data-model.md's `Config` §5) |
| `GET /vendors/me` *(vendor)* | Own storefront, any status | Unlike `GET /vendors/:id`, not gated on `approved` — a pending vendor needs to see their own application |
| `PATCH /vendors/me` *(vendor)* | Edit storefront | Name, hours, `is_open`, `supports_pickup` — US-V-02. Editable regardless of application status; only customer-facing visibility gates on `approved` |
| `GET /vendors/me/products` *(vendor)* | Own product list, active AND inactive | Unlike `GET /vendors/:id/products` (public, active-only) — screens-navigation.md §2.2 needs a state indicator on both |
| `POST /vendors/me/products` *(vendor)* | Create product | US-V-03 |
| `PATCH /vendors/me/products/:id` *(vendor)* | Edit product | Price edits never touch past `OrderItem` snapshots |
| `DELETE /vendors/me/products/:id` *(vendor)* | Deactivate (not delete) | Sets `is_active = false` |

## Cart

No endpoints — the cart is client-side state (device-local), per brief §3.1b. There is nothing to sync until checkout, since a cart can exist before any customer record does (guest browsing). The single-vendor rule (brief §3.1) and the fulfilment/timing choice (US-C-05a) are both enforced client-side for immediate feedback, and re-enforced server-side at `POST /checkout` below — checkout is the one place the server has to stop trusting client state.

## Order & Checkout

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /checkout` *(session optional)* | Convert a client-submitted cart → order, initiate payment | Body: `{ contactPhone, alternateContactPhone?, email?, vendorId, items: [{productId, quantity}], fulfilmentType, scheduledFor?, addressId?, deliveryLat?, deliveryLng?, deliveryLandmark?, paymentMethod }` — the three `delivery*` fields are required for `fulfilmentType: "delivery"`, omitted for pickup; `email` is only ever used for a guest's Monnify receipt, falling back to a synthesized placeholder if omitted. No `Authorization` header → a guest order: `contactPhone` alone is enough, no `User`/`CustomerProfile` is created at all, `Order.customer_id` stays null (brief §3.1b). `Idempotency-Key` header, reused directly as `Payment.gateway_reference` and Monnify's `paymentReference` — a repeated call with the same key returns the original order rather than creating a second one. Re-validates price, stock, vendor approval/open status and the single-vendor rule (US-C-06) before charging. For `fulfilmentType: "delivery"`, also 422s `OUTSIDE_SERVICE_AREA` if the address falls outside the launch polygon (US-C-05, brief §2a) — pickup orders skip this, since the vendor's own pickup location was already validated the same way at application time. Cash on delivery skips Monnify entirely and returns the order already `PAID`; card/transfer returns a `checkoutUrl` redirect and leaves the order `PENDING_PAYMENT` until the webhook confirms. Always returns the order's `tracking_token` (US-C-06a) |
| `GET /orders/track/:trackingToken` *(no session required)* | Order status by token | Works for both a guest order and a signed-in customer's order — deliberately never reachable by phone number or email, so knowing one person's contact info can't expose another's order (US-C-06a). Includes `vendor` (`businessName`, `pickupLandmark`, `pickupPhone`, `logoUrl`) and, once assigned, `rider` (`fullName`, `user.phone`) — screens-navigation.md §1.7's status-timeline screen needs both |
| `POST /orders/track/:trackingToken/rate` *(no session required)* — **built, and used by the customer app for signed-in customers too**, not just guests | Rate vendor and/or rider | `{ targetType, score, comment? }`. Upserts on `(orderId, targetType)` (`Rating` is `@@unique` on that pair) — a second call within the original `editedUntil` (24h) window edits the same row; past it, 409 (`RatingLockedError`). `OrderDto.ratings` (0–2 entries) lets the tracking screen pre-fill an edit form instead of a blank one |
| `POST /orders/track/:trackingToken/dispute` *(no session required)* — **built, and used by the customer app for signed-in customers too**, not just guests | Dispute | `{ reason, evidence? }`; 409 if this order already has one (`Dispute.orderId` is `@unique`), 422 outside the 48h-after-delivery window. `OrderDto.dispute` (0 or 1) lets the tracking screen show "already disputed"/its resolution instead of the form |
| `POST /webhooks/monnify` *(no session — signature-verified instead)* | Payment gateway callback | Header `monnify-signature`, HMAC-SHA512 of the raw body keyed with the secret — verified against the exact bytes Monnify sent, which is why this route parses its body as a raw string rather than letting Fastify JSON-parse it. Idempotent on `gateway_reference` (a `payment.status = succeeded` replay is a no-op). Drives `PENDING_PAYMENT → PAID` and posts the escrow-hold `LedgerEntry` pair |
| `GET /orders/:id` *(customer/vendor/rider — own orders only)* | Order detail | Includes current status, full state-transition history, fulfilment type, `scheduled_for`. `collection_code`/`delivery_code` are redacted by role — a rider gets neither, a vendor gets `collection_code` only, a customer gets both (same reasoning as the Dispatch section's redaction note below) |
| `GET /orders` *(customer)* | Order history | US-C-09. Reorder needs no route of its own — the customer app re-fetches `GET /vendors/:id/products` client-side to reorder against live price/stock instead of the order's own snapshot |
| `POST /orders/:id/cancel` *(customer)* | Self-service cancel | Only while `status = PAID` (US-C-08); 422 otherwise. Refunds via Monnify if actually paid, no-ops for cash on delivery (nothing was ever charged) |
| `GET /vendors/me/orders` *(vendor)* | Own order queue | US-V-05. One flat, newest-first list — the New/In Progress/Scheduled/History tabs (screens-navigation.md §2.1) are bucketed client-side from this, not four separate queries |
| `GET /vendors/me/earnings` *(vendor)* | Running balance + per-order breakdown | US-V-07. `clearedMinor` (net of commission, `COMPLETED` orders only) vs. `pendingMinor` (gross estimate — commission isn't final until an order completes). A vendor is never paid the delivery fee, that goes to the rider (brief §3.2a) |
| `POST /orders/:id/accept` *(vendor)* | Accept a `PAID` order | → `PREPARING`; atomically decrements stock per item (422 if any item's stock ran out while the order waited in the accept window — data-model.md §6 invariant 4); cancels the auto-reject timer (US-V-05) |
| `POST /orders/:id/reject` *(vendor)* | Reject | `{ reason }` required; → `CANCELLED` → `REFUNDED` (via Monnify if paid, a no-op for cash); vendor's reliability score takes a hit |
| `POST /orders/:id/ready` *(vendor)* | Mark ready | → `READY_FOR_PICKUP`, generates the `collection_code` both confirmation paths below need. For delivery, this is also the moment the order becomes visible to Dispatch's open job pool (`GET /riders/me/offers`) |
| `POST /orders/:id/confirm-pickup` *(vendor)* | Confirm collection | `{ code }`, checked against `collection_code` — pickup orders only; → `DELIVERED` directly, no rider involved, and schedules the escrow-release timer |
| `POST /orders/:id/rate` *(customer)* — **built** | Rate vendor and/or rider | Signed-in equivalent of the tracking-token route above; the customer app actually calls that one for both cases (see above). Only on `COMPLETED` orders, editable 24h (US-C-10) |
| `POST /orders/:id/dispute` *(customer)* — **built** | Open a dispute | Signed-in equivalent of the tracking-token route above; the customer app actually calls the tracking-token one for both cases (see above) since it resolves the order's own customer either way. Holds pending escrow release for this order (US-C-11) |

## Dispatch (delivery-fulfilment orders only)

**One simplification worth stating plainly:** there's no separate "job offer" resource, unlike the shape this table originally sketched. An unclaimed `READY_FOR_PICKUP` delivery order *is* the offer (US-R-03's open-pool model, Q-03) — `GET /riders/me/offers` just lists those orders directly. Accepting is an atomic conditional update (`riderId IS NULL AND status = 'READY_FOR_PICKUP'`), the same pattern US-V-04's stock decrement uses, so two riders racing for the same job can never both win. Declining is consequently a genuine no-op against the database — nothing is tracked per-rider, so a declined job stays visible to everyone including the rider who declined it. A real "don't show me this again" needs a dismissals table this doesn't have yet.

**A security property worth stating plainly too:** every order this module ever hands back to a rider — every endpoint below that returns `{ order }` or `{ offers }` — has `collection_code` and `delivery_code` stripped from the response, unconditionally (`dispatch/service.ts`'s `redactForRider`). Both codes exist specifically so they have to come from someone else in person (the vendor, then the customer); a rider who could just read them off their own API response wouldn't need to ask either, which would make the two handoff checks below purely decorative.

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /riders` *(rider)* | Submit rider application | US-R-01; creates `RiderProfile` in `pending`, mirroring `POST /vendors` |
| `GET /riders/me` *(rider)* | Own profile, any status | Mirrors `GET /vendors/me` |
| `PATCH /riders/me/duty` *(rider)* | Toggle on/off duty | US-R-02; 403 if the application isn't `approved` yet |
| `GET /riders/me/offers` *(rider)* | List open jobs | Short-poll while on duty and idle — no persistent connection (ADR-0001). Empty while off duty or unapproved, not an error |
| `POST /riders/me/offers/:id/accept` *(rider)* | Claim a job | → `RIDER_ASSIGNED`. 409 `JOB_UNAVAILABLE` if it's already taken, or the rider isn't on duty (US-R-03) |
| `POST /riders/me/offers/:id/decline` *(rider)* | Decline | No penalty, no persisted effect (US-R-03) — see the note above |
| `GET /riders/me/active-job` *(rider)* | The rider's current job, if any | `{ order: null }` if none. Reconstructs state after e.g. a page refresh mid-delivery — `GET /riders/me/offers` only ever lists *unclaimed* jobs, so a rider's own accepted one never appears there |
| `POST /orders/:id/confirm-collection` *(rider)* | Confirm pickup from vendor | `{ code }`, checked against `collection_code` — the same code a pickup order's customer would show instead (US-V-06); → `IN_TRANSIT` (US-R-04) |
| `POST /orders/:id/confirm-delivery` *(rider)* | Confirm delivery to customer | `{ photoUrl?, recipientName?, code?, cashCollectedMinor? }`. `code` is the real verification, not one option among three: the customer reads their `delivery_code` to the rider, and it must match exactly (400 `INVALID_DELIVERY_CODE` otherwise) — this is the second handoff check (US-R-05), confirming the rider is delivering to the right person, mirroring `confirm-collection`'s vendor-code check. `recipientName`/`photoUrl` are supplementary, not an alternate path around the code; "couldn't get it" is what `delivery-failed` below is for. For `cash_on_delivery`, `cashCollectedMinor` must also equal the order total exactly (400 `CASH_MISMATCH` otherwise) and posts the cash-collection ledger entries (data-model.md §4a) — this is the moment money first enters the books for a cash order, since nothing moved at checkout. → `DELIVERED`, schedules the escrow-release timer |
| `POST /orders/:id/delivery-failed` *(rider)* | Report failure | `{ reason, notes? }` → `DELIVERY_FAILED`. Admin follow-up (refund decision, whether to return goods) isn't built yet — this records the failure honestly rather than pretending to resolve it (US-R-06) |
| `GET /riders/me/earnings` *(rider)* | Cleared vs. pending earnings + cash float | US-R-07. Also `cashBalanceMinor` (owed to the platform) and `cashFloatLimitMinor` (US-R-08) |
| `GET /riders/me/remittances` *(rider)* — **built** | Own remittance history, newest first | US-R-08. Read-only, and `recordedBy` (the admin's user id) is deliberately not exposed |
| ~~`POST /riders/me/remit`~~ | **Not built, on purpose — the open question is closed.** | US-R-08's acceptance criteria say "a remittance is **recorded by admin** and immediately reduces the balance", so it's `POST /admin/riders/:id/remittances` (Admin section below), not rider-initiated. A rider who could log their own handback would just be editing their own debt |

**Float limit (US-R-08).** Once `cashBalanceMinor` is strictly greater than the configured limit (`rider_cash_float_limit_minor`, admin-editable via `PATCH /admin/config`, ₦100,000 default until set), cash-on-delivery jobs are omitted from `GET /riders/me/offers` *and* refused by `POST /riders/me/offers/:id/accept` (409 `CASH_FLOAT_LIMIT` — its own code, so a rider isn't told "someone else took it"). Enforced inside the atomic claim's own filter, not read-then-write. Prepaid jobs and an already-accepted job are unaffected.

## Notifications

**Built (M1), backend-complete.** Order, Dispatch and Admin each call `app.notifications.notify(userId, type, payload)` at the point of a state change, same request (architecture.md: "push notification fires from the module that made the transition") — every entry in NOTIFICATION_TYPES (packages/types) is wired to a real call site, not just declared. `notify` always writes the in-app row first; a push send is then attempted per subscribed device and never allowed to fail the caller's action. A guest order has no account behind it (brief §3.1b), so it's silently skipped — not a gap, there's no `User` row to notify.

Push delivery itself needs `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (optional, `.env.example`) and, on the client side, a service worker that actually calls `pushManager.subscribe()` and forwards the result to `POST /notifications/subscribe` — that service-worker/subscribe UI isn't built in any of the four apps yet. Until it exists, `GET /notifications` (the in-app feed, real end to end) is the only way a signed-in user sees these — which is also architecture.md's own documented fallback ("polling is the fallback for a client with push disabled"), not a missing piece.

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /notifications/subscribe` | Register a Web Push subscription | `{ endpoint, keys: { p256dh, auth } }` — a browser's `PushSubscription.toJSON()` shape, forwarded as-is. Upserted on `endpoint`, so re-subscribing the same device updates keys rather than duplicating |
| `GET /notifications` *(any authenticated user)* | In-app notification feed | Most recent 50, newest first |
| `POST /notifications/:id/read` | Mark read | 404 if the notification isn't the caller's own |

## Admin

**Built:** application vetting (US-A-01) — the piece nothing else could substitute for, since no other module ever writes `VendorProfile.status`/`RiderProfile.status`. Payouts (vendor-requested, admin-approved — see ../payouts/routes.js, a genuinely different shape than the `POST /admin/payouts/run` sketched below, see that module's own plan for why). Order oversight (US-A-03) and audit-log search (US-A-08) — both M-priority, both built directly against this doc's table below, plus one addition the table was missing: `force-cancel` (US-A-03's acceptance criteria lists it explicitly; this table originally didn't). Disputes (US-A-04), config writes (US-A-02) and suspend-an-actor (US-A-06) are also built now (2026-09-24) — see their rows below, each marked **built**. Only reconciliation (US-A-05's other half) and metrics (US-A-07) remain real, planned scope (the Prisma models already exist) but not built — check the actual table rows below before trusting this paragraph, not the other way around.

Admin sign-in reuses the vendor/rider/admin phone+OTP path (`POST /auth/otp/verify` with `role: "admin"`), but with one deliberate asymmetry: unlike vendor/rider, a fresh phone number can never create an admin account through that endpoint — it only logs an *already-provisioned* admin in. Admin accounts are provisioned out of band (`SEED_ADMIN_PHONE` in local dev, a one-off script in production). Otherwise anyone could mint themselves an admin session by hitting a public endpoint with a new number, which would make every `requireAuth(["admin"])` check below meaningless.

An "application" isn't its own database row — it's a `pending` `VendorProfile` or `RiderProfile`. Since both use plain (non-namespaced) uuids, `:type` in the path disambiguates which table `:id` belongs to, rather than guessing by probing one table then the other.

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /admin/applications` | Pending vendor/rider applications, merged, oldest first | US-A-01 |
| `POST /admin/applications/:type/:id/approve` | Approve | `:type` is `vendor` or `rider`. Sets `foundingVendorCommissionWaivedUntil` to now + the configured waiver duration (default 3 months) if `founding_vendor_program_active` is currently true (brief §3.2a) — vendor only, computed once at approval time |
| `POST /admin/applications/:type/:id/reject` | Reject | `{ reason }` required (US-A-01's mandatory-reason acceptance criterion) |
| Both actions write an `AuditLog` row (actor, action, target, reason) and 409 if the application was already decided. | | |
| `GET /admin/orders` | Full order list — **built** | Filters: `status`, `vendorId`, `riderId`, `fulfilmentType`, `from`/`to` (US-A-03) |
| `GET /admin/orders/:id` | Full detail, including complete transition history — **built** | No redaction (unlike customer/vendor/rider-facing reads) |
| `POST /admin/orders/:id/reassign-rider` | Force reassignment — **built** | `{ reason }`. Doesn't hand the job to a specific replacement — clears the current rider and reverts to `READY_FOR_PICKUP`, re-entering the normal open-jobs pool any on-duty rider can claim |
| `POST /admin/orders/:id/force-cancel` | Force-cancel — **built** | `{ reason }`. Not originally in this table despite US-A-03 listing it explicitly — added here to match. Stops the order (any non-terminal status → `CANCELLED`), refunds if anything was actually charged |
| `POST /admin/orders/:id/force-refund` | Force refund — **built** | `{ reason }`. Writes the same ledger-reversal pattern as a normal refund — deliberately doesn't touch `Order.status`, a pure financial correction distinct from force-cancel (e.g. a goodwill refund on an order that should still complete normally) |
| `GET /admin/disputes` | Dispute queue, oldest first — **built** | Filter: `status` (US-A-04) |
| `GET /admin/disputes/:id` | Dispute detail — **built** | Full order context (vendor, total, contact) joined in |
| `POST /admin/disputes/:id/resolve` | Resolve — **built** | `{ resolution: "full_refund"\|"partial_refund"\|"rejected", amountMinor?, reason }`. `full_refund` reverses the whole order; `partial_refund` reverses `amountMinor` and releases the remainder to vendor/rider/platform via the normal split, scaled to what's left (`ledger.ts`'s `partialRefundEntries`); `rejected` releases escrow in full, same as if no dispute had been opened. Every branch resolves the order to a real terminal status itself — the dispute already cancelled the order's own escrow-release timer |
| `GET /admin/config` | Current live config — **built** | `commission_rate.pickup`/`.delivery`, founding-vendor program state, flat delivery fee, vendor accept-window, plus every category (active or not) |
| `PATCH /admin/config` | Update config — **built** | Any subset of `commissionRatePickup`, `commissionRateDelivery`, `vendorAcceptWindowMinutes`, `flatDeliveryFeeMinor`, `foundingVendorProgramActive`, `foundingVendorProgramWaiverMonths`. Each supplied key writes its own new versioned `Config` row (`admin/config.ts`'s `writeConfigValue`) — `UPDATE` is revoked on `config` at the DB grant (`APPEND_ONLY.sql`), so this can only ever INSERT. An order that already reached `COMPLETED` already has its `commissionMinor` stored on the `Order` row, so a later rate change can't retroactively touch it (US-A-02's "never alters orders already placed") |
| `POST /admin/categories` / `PATCH /admin/categories/:id` — **built** | Create / rename / re-time prep / deactivate-reactivate a category | Not in the original sketch as separate endpoints — categories are a real table (`Product`/`VendorProfile` foreign keys point at them), not a `Config` key, so they get their own REST resource instead of living inside the `PATCH /admin/config` body. `categoryCreateSchema`/`categoryUpdateSchema` (`catalog.ts`) — reuses the same types `GET /categories`'s public read already used |
| `GET /admin/reconciliation` | Reconciliation report | Ledger totals vs. Monnify settlement report for a period |
| `GET /admin/metrics` | Platform health | US-A-07 |
| `GET /admin/vendors` / `GET /admin/riders` | Every vendor/rider, any status — **built** | Not in the original sketch — added so US-A-06 has something to suspend from; Applications (`GET /admin/applications`) stays pending-only |
| `POST /admin/vendors/:id/suspend` / `/riders/:id/suspend` — **built** | Suspend an actor | `{ reason }` (US-A-06). `status` already gates new orders/job offers — this is the whole enforcement mechanism. Response includes `inFlightOrders` (that actor's non-terminal orders) so an operator sees what's in flight without them being auto-cancelled — the story's own acceptance criterion. Suspending a rider also flips `onDuty` off |
| `POST /admin/vendors/:id/unsuspend` / `/riders/:id/unsuspend` — **built** | Reverse a suspension | `{ reason }`. Not in the original sketch — added because US-A-06 requires suspension be "fully reversible" |
| `POST /admin/riders/:id/remittances` — **built** | Record a rider's cash handback | `{ amountMinor, note? }` (US-R-08). Decrements `RiderProfile.cashBalanceMinor` with a guarded `updateMany` (`cashBalanceMinor >= amount`) in the same transaction as the `RiderCashRemittance` row and its audit entry — so it can't go negative and a repeated entry can't double-count. 422 `REMITTANCE_EXCEEDS_BALANCE` if larger than what's outstanding. Tracked in its own table, not as ledger entries (`ledger_entries.orderId` is NOT NULL, same reason `Payout` is separate) — US-A-05's reconciliation has to fold these in alongside the ledger's `rider_cash_float` total |
| `GET /admin/riders/:id/remittances` — **built** | One rider's recorded remittances, newest first | So an admin can see what's already been entered before entering another |
| `GET /admin/audit-log` | Search the audit log — **built** | Filters: `actorId`, `targetType`, `targetId`, `from`/`to` (US-A-08) |

**`POST /admin/payouts/run` above was superseded, not built as sketched:** payouts are vendor-requested, admin-approved instead (`GET/POST /vendors/me/payouts*`, `GET /admin/payouts/requests`, `POST /admin/payouts/:id/approve`/`reject` — see ../payouts/routes.js) — a deliberate product decision, not an oversight; admin never pushes money to a vendor unprompted.

## What's deliberately not here

- No endpoint accepts a raw card number, ever — Monnify's hosted fields handle that entirely client-side (NFR-05).
- No endpoint lets a vendor or rider write directly to `LedgerEntry` or `OrderStateTransition` — those are only ever written by the server in response to the state-changing endpoints above, per the append-only invariant (data-model.md §6).
- No public API for third parties (brief §5, explicitly out of scope for v1) — every endpoint above assumes a CloseBuy first-party client.
