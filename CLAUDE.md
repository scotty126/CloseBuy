# CloseBuy — project memory for Claude Code

Riverpark-focused (Nigeria) local delivery marketplace. Four customer-facing
apps (customer, vendor, rider, admin) plus a Fastify/Prisma API, built by a
solo developer. This file is what a fresh session should read first — it's
the "where were we" answer, kept current, not a static spec.

**Full design docs live in `docs/`** — `01-requirements/product-brief.md`
and `user-stories.md`, `02-design/data-model.md`, `api-contracts.md`,
`architecture.md`, `screens-navigation.md`, `03-planning/roadmap.md`. This
file summarizes; those are the source of truth when they disagree.

## Stack

Monorepo: pnpm workspaces + Turborepo. `apps/{customer,vendor,rider,admin,api}`,
`packages/{types,ui,api-client}`. Fastify + Prisma + PostgreSQL (Neon,
hosted) + Redis (Railway-hosted). Monnify for payments (ADR-0001). Termii
for staff SMS OTP. Next.js 15 for all four frontends, mobile-first for
customer/vendor/rider, desktop-first sidebar for admin (it's genuinely an
internal tool).

## Where things actually run

| What | Where |
|---|---|
| API | Railway — `closebuy-api-production.up.railway.app` |
| Database | Neon Postgres (hosted) |
| Redis | Railway-hosted (migrated off Upstash — free-tier command limit) |
| Customer | Netlify — `closebuy1.netlify.app` — **working** |
| Vendor | Netlify — `closebuy-vendor.netlify.app` — **working** (fixed 2026-09-26) |
| Rider | Netlify — `closebuy-rider.netlify.app` — **working** (fixed 2026-09-26) |
| Admin | Netlify — `closebuy-admin.netlify.app` — **working** (fixed 2026-09-26) |
| Local dev | customer `:3000`, vendor `:3001`, rider `:3002`, admin `:3003` — all four point `NEXT_PUBLIC_API_URL` at the live Railway API (`.env.local` per app, gitignored) since local Neon access is blocked (see Known issues) |

CI: GitHub Actions, postgres/redis service containers, `prisma migrate deploy`.

## Current state (2026-09-26)

**M1 (walking skeleton) is functionally complete and verified end to end**
against real infra — real order loop, real escrow ledger, real vendor
payout requests. The one M1 "done when" gap: **Monnify isn't configured at
all** (no API key/secret/contract code anywhere) — real card/transfer
payments don't work yet, only cash-on-delivery does. See Known issues.

Built and live:
- Full order loop: browse → cart → checkout → vendor accept/reject →
  dispatch → delivery/pickup → escrow release → **vendor-requested,
  admin-approved payouts** (deliberate redesign — admin never pushes money
  unprompted; see `apps/api/src/modules/payouts/`)
- Auth, all four roles, three independent methods each: phone+OTP,
  email+password, Google OAuth (Apple pending a paid dev account). Every
  identity (phone, email, Google account) is **unique per role, not
  globally** — the same real person can hold a customer AND vendor AND
  rider AND admin account, four distinct `User` rows. Admin can never be
  self-created through any of the three paths — always provisioned out of
  band. See `apps/api/src/modules/auth/`.
- `DEV_AUTO_SIGNIN_PHONES` (Railway env var, currently the owner's own
  number) — typing that number on any staff app's login skips Termii/OTP
  entirely, mints a real session. Owner convenience, not for real users.
  **This claim was wrong until 2026-09-26: it never worked from the UI**
  (see "Fixed" below) — for a *deployed* build it still doesn't until the
  fixed API/frontends ship. For the **admin** role it also only signs in an
  admin that already exists (`findOrCreateStaffUser`); the owner's admin
  account does exist (created 2026-09-17).
- 10 real vendors, 99 real products seeded in the live DB (not a mockup) —
  see `apps/api/scripts/seed-demo-vendors.mjs`. Real sourced product photos
  (Wikimedia/Unsplash/Pexels).
- Admin: application vetting (US-A-01), order oversight (US-A-03, full
  list/detail/transition-history/reassign-rider/force-cancel/force-refund),
  config writes (US-A-02 — `apps/api/src/modules/admin/config.ts` +
  admin `/config`, categories plus every rate/toggle/window, each write
  its own new versioned `Config` row, never an edit), dispute resolution
  (US-A-04 — queue + full/partial refund/reject, see
  `apps/api/src/modules/admin/disputes.ts`), suspend-an-actor (US-A-06 —
  `apps/api/src/modules/admin/actors.ts` + admin `/vendors`/`/riders`
  screens, not in the original screens-navigation.md sketch), audit-log
  search (US-A-08), platform metrics (US-A-07, below). Not yet:
  reconciliation (US-A-05's other half) — M-priority (M3), a real
  placeholder still exists at `apps/admin/app/payouts`.
- Customer UI restyled toward the DoorDash reference kit (structural/layout
  only — brand green/orange stays, deliberately not DoorDash's red).
- Delivery-pin map on checkout (`@vis.gl/react-google-maps`) — additive,
  renders nothing without `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (not yet set).
- CORS, security fixes (public vendor endpoints were leaking bank details —
  fixed), CI green.
- Self-service cancellation (US-C-08, `Order.cancelOrder` + the Cancel
  button on the tracking page), atomic per-item stock decrement on vendor
  accept (US-V-04, data-model.md §6 invariant 4) — both already fully
  built, contrary to an earlier stale "still to do" note in this file.
  Verify against the actual code before trusting any "not built yet" claim
  here, this file has been wrong about that before.
- Order history + **reorder** (US-C-09) — history was already built;
  reorder is new (2026-09-24, `apps/customer/lib/cart.tsx`'s
  `replaceCartItems` + the Reorder button on the tracking page). Re-fetches
  the vendor's *live* catalogue rather than trusting the order's own
  price/name snapshot, silently drops anything gone inactive or sold out,
  and reuses the existing single-vendor-cart conflict prompt if the cart
  currently holds a different vendor's items. Verified against the live
  API in a real browser, including the conflict path.
- **Report a problem** (US-C-11, 2026-09-24) — "Report a problem" on the
  tracking page (`apps/customer/app/orders/track/[token]/page.tsx`),
  reason + optional evidence (same "paste hosted URLs, one per line"
  pattern the vendor product form already used — R2 still isn't
  configured, ADR-0001). Uses the trackingToken route for both guest and
  signed-in customers alike (US-C-06a), matching how the rest of this
  screen already works. Fixed two real gaps found while wiring it up:
  `Order.disputeOrder` had no guard against a second dispute on the same
  order (would have hit the DB's `@unique` constraint as an unhandled
  500), and `trackingInclude` didn't join `dispute` at all, so the
  frontend had no way to know one already existed — both fixed
  (`DisputeAlreadyExistsError`, `OrderDto.dispute`). Verified against the
  live API for the negative path (button correctly hidden pre-delivery);
  the positive path (an actual DELIVERED order) is covered by new unit
  tests in `order/service.test.ts` but **not yet exercised live** — doing
  so needs a vendor (and for delivery orders, a rider) account to walk an
  order through accept → ready → confirm, and this session had no
  vendor/rider/admin credentials to do that with.
- **Ratings** (US-C-10, 2026-09-26) — rate form on the tracking page once
  an order is `COMPLETED` (vendor always, rider on a delivery order),
  pre-filled/editable inside the original 24h window, read-only stars
  after. Backend gaps fixed along the way: `Rating` is now
  `@@unique([orderId, targetType])` (was nothing — a second POST made a
  duplicate row) and `Order.rateOrder` upserts against it, rejecting past
  `editedUntil` with `RatingLockedError` (409). `trackingInclude` joins
  `ratings` so the screen can pre-fill. **The star badge on vendor cards
  and the storefront page was showing `reliabilityScore` — an internal ops
  metric that only ever decreases on a vendor's own auto-reject/reject —
  not a customer rating.** Replaced (user's call, 2026-09-26) with the
  real average + count from `Rating` (`VendorDto.ratingAverage`/
  `ratingCount`, `catalog/service.ts`'s `vendorRatingSummaries` — one
  `groupBy` per search page, not N+1), showing "New" until a first real
  rating exists. `reliabilityScore` is no longer on the public
  `VendorDto` at all; it stays on `OwnVendorProfileDto` (the vendor's own
  view) and admin. So every seeded demo vendor now shows "New", not a
  polished "4.4" — that's deliberate, not a regression. The customer
  frontend uses `!= null` (not `!== null`) on `ratingAverage` so a
  frontend running against a not-yet-redeployed API degrades to "New"
  instead of crashing — that exact mismatch crashed the home page locally
  (`toFixed` on `undefined`) because local dev points at the live Railway
  API, which doesn't have the new field until this is pushed and deployed.
  Positive path (an actual `COMPLETED` order being rated) is covered by
  new unit tests in `order/service.test.ts`/`catalog/service.test.ts` but
  **not exercised live** — reaching `COMPLETED` needs a real delivery plus
  the escrow-release timer (or an admin dispute resolution), and this
  session had no vendor/rider/admin credentials.

- **Rider cash remittance** (US-R-08, 2026-09-26) — the "open question"
  the design docs kept flagging (rider-initiated vs admin-recorded) was
  answered by the story's own acceptance criteria: *"a remittance is
  recorded by admin"*. So: admin records it
  (`apps/api/src/modules/admin/remittances.ts`, `POST
  /admin/riders/:id/remittances`, form + history on the admin `/riders`
  cards), the rider only *reads* their history (`GET
  /riders/me/remittances`, rider `/earnings`) — deliberately no rider
  "remit" button, a rider logging their own handback would just be editing
  their own debt. The decrement is a guarded atomic `updateMany`
  (`cashBalanceMinor >= amount`) in one transaction with the row + audit
  entry, so it can't go negative and a repeated entry can't double-count;
  an amount over the outstanding balance is refused (422). **Float limit:**
  once the balance is strictly over `rider_cash_float_limit_minor`
  (admin-editable on `/config`), cash-on-delivery jobs vanish from the
  offers list *and* are refused at claim time (409 `CASH_FLOAT_LIMIT`, own
  error so a rider isn't told "someone else took it"), enforced inside the
  atomic claim's own filter. Limit **falls back to a ₦100,000 placeholder
  when no Config row exists** (`lib/config.ts`) — it was added after the
  seed ran and a 500 on every rider endpoint until someone seeds
  production would be far worse. Remittances live in their own table
  (`rider_cash_remittances`), **not** as ledger entries:
  `ledger_entries.orderId` is NOT NULL and a remittance belongs to no
  order — same reason `Payout` is separate. **Consequence for US-A-05:**
  reconciliation has to fold remittances in alongside the ledger's
  `rider_cash_float` account (the ledger only ever sees the debit side,
  cash collected), same as it will for payouts. Rider screens tolerate an
  API that hasn't been redeployed yet (`!= null` on the new limit field,
  history fetched independently) after the ratings crash taught that
  lesson. Verified by 22 new unit tests (typecheck/build clean); **not
  exercised live** — the live API doesn't have the endpoints or table yet,
  and local dev can't reach the DB.
- ~~Known weak spot next to this: `confirmDelivery` posts the COD ledger
  entries and increments `cashBalanceMinor` as separate statements, not
  one transaction.~~ **Fixed 2026-09-29** — see that date's section below.

- **Platform metrics** (US-A-07, 2026-09-26) — `GET /admin/metrics?from&to`
  (`apps/api/src/modules/admin/metrics.ts`) + the admin `/metrics` screen:
  stat tiles (orders, gross value, completion rate, average delivery time,
  failed, disputed, active vendors/riders) and two *separate* column charts
  (orders/day, gross/day — different scales, never one dual-axis plot),
  filterable by date range. **The definitions are the contract and are
  restated on the screen** ("How these are counted"): everything is
  cohorted by placement day in Africa/Lagos (UTC+1, fixed — Nigeria has no
  DST); "placed" excludes abandoned `PENDING_PAYMENT` checkouts; completion
  rate = fulfilled ÷ (fulfilled + cancelled/refunded + failed) so in-flight
  orders don't drag it down; gross excludes cancelled/refunded but **does
  not net out goodwill or partial-dispute refunds** (those deliberately
  leave `Order.status` alone, so they can't be seen from here); average
  delivery time is PAID→DELIVERED for delivery orders only with scheduled
  ones excluded. `openDisputes` and the *approved* vendor/rider counts are
  "right now", not range-scoped. The per-day series is built in
  application code from one row per order, hence the 366-day range cap
  (422 `INVALID_RANGE`); at that scale a `date_trunc` `GROUP BY` would be
  the upgrade path, at the cost of being un-unit-testable against the
  in-memory fakes. **No new migration, no new Config key.**
  Chart notes for whoever touches it next: `ColumnChart.tsx` is hand-built
  SVG (the admin app has no chart library) following the `dataviz` skill's
  mark specs. The brand green (`#255748`) **fails that skill's
  categorical-palette validator** on lightness band and chroma floor —
  those checks guard telling hues apart from each other, moot for a single
  series; it passes the contrast check against white, and the alternatives
  (the status green, the action orange) are reserved. Y-axis ticks are
  whole numbers only: rendering a quiet week showed a "1.5 orders" axis
  that no type check or unit test would have caught — **there is no
  browser tool in some sessions, but you can still look**: server-render
  the component to static HTML with the CSS from `apps/admin/.next`, then
  `msedge --headless --screenshot=…` and open the PNG. Verified that way
  (charts) plus 17 API tests (the timezone bucket boundaries and each
  definition); the full page against the live API is **not exercised**
  — the endpoint isn't deployed and the screen needs an admin session.

**Fixed (2026-09-26) — staff auto-signin never worked from the UI.**
`POST /auth/otp/request` returned the auto-signin session's fields at the
top level (`{accessToken, refreshToken, user}`) while all three staff login
pages waited for `res.session`, so `res.session` was always undefined and
the page always fell through to the code step — even for the owner's own
allowlisted number with a real admin account. Both sides date from the same
commit (`3198c8b`); the service logic (`tryAutoSignin`) was unit-tested but
nothing ever checked the response shape between route and pages. Fix:
shared `OtpRequestResponse` type in `packages/types/src/auth.ts` (the route
is now typed against it, so a mismatch is a compile error), route returns
`{ session }`, and `api-client`'s `requestOtp` also accepts the old top-level
shape so it worked against an API that hadn't been redeployed — **that shim is
deleted now** (the fixed API has been live since the 2026-09-26 deploy).
Found because the owner tried to sign into the local admin app to approve
test accounts.

**Fixed (2026-09-26) — "Place order does nothing", and it was systemic.**
The API had **no error handler at all**, so every uncaught error went out in
Fastify's default `{ statusCode, error: "Internal Server Error", message }`
shape — not the `{ error: { code, message } }` the client parses. The client
read `err.error.message` off that (a string → `undefined`), fell back to
`res.statusText`, which is **empty over HTTP/2**, and put `""` in the error
slot, which renders nothing. And every `schema.parse()` failure in the whole
API is a thrown ZodError, so *every validation error was a 500 with an
invisible message* — the trigger here was a customer typing their number as
`0801…` (the normal Nigerian way; the schema wants E.164 `+234…`). Fixed at
four layers, because any one alone leaves a hole:
`apps/api/src/lib/error-handler.ts` (registered first in `app.ts` — children
copy their parent's handler at creation, so order matters): ZodError → 400
`VALIDATION_ERROR` naming the field, `PaymentsUnavailableError` → 503
`PAYMENTS_UNAVAILABLE`, Fastify/rate-limit 4xx passed through, anything else
a generic 500 that **no longer leaks internal messages** (the Monnify one
used to name env vars); `packages/api-client/src/client.ts` `readError` accepts
either shape and never yields an empty message; `normalizePhone` in
`packages/types/src/auth.ts` (`0801…`/`234801…` → `+234801…`) applied at every
phone submit (checkout, account, vendor application, all three staff logins);
and the checkout form shows a `role="alert"` box, scrolled into view, with a
fresh idempotency key after a server error.
**Related, same root:** checkout with online payment while Monnify is
unconfigured used to create the order and its `Payment` row *first*, then
throw. That left a dead `PENDING_PAYMENT` order, and because the payment is
keyed on the idempotency key, a retry replayed it (no `checkoutUrl`) and
sent the customer to its tracking page. Now `MonnifyClient.isConfigured` is
checked before anything is written, and a gateway failure *after* the order
exists cancels it and fails the payment. There is still no expiry job for
abandoned `PENDING_PAYMENT` orders — one orphan from testing exists on the
first demo vendor (2026-09-26, a `card` order made while probing this bug).
Tests: `lib/error-handler.test.ts` (new), three new checkout cases in
`order/service.test.ts`. **Not deployed at the time of writing** — the local
apps already show the error (raw, until the API ships the new handler).
**Mobile layout.** The vendor and admin dashboards shared one `Sidebar`
(`packages/ui`) that was a permanent 224px column with no way to dismiss it —
on a phone that left ~160px for the page. It is now a top bar + drawer below
`lg` (closes on link tap, backdrop, Escape, ✕) and the same column as before
from `lg` up. Admin's wide tables (`orders`, `disputes`, `audit-log`) scroll
sideways inside their card instead of clipping; the config "Add category" row
wraps; the checkout coordinate inputs are a grid. Verified by rendering
**every page of all four apps at 390px and 320px in headless Edge** and
asserting no element extends past the viewport (`scrollWidth` alone misses
clipped content), plus looking at the screenshots. The admin pages were
rendered against canned API responses (no admin credentials here), so their
*content* is fixture data — the layout is what was checked. Harness technique
worth reusing: drive `msedge --headless=new --remote-debugging-port` over CDP
from a plain Node script (Node 24 has a global `WebSocket`), inject the
session as `localStorage["closebuy.session"]`, answer CORS preflights yourself
if you intercept with `Fetch.enable`, and in Git Bash set `MSYS_NO_PATHCONV=1`
or a bare `/` route argument becomes `C:/Program Files/Git/`.
**Dev-server gotcha:** `@closebuy/types` is consumed from `dist/`, not `src/`.
After editing it, `pnpm --filter @closebuy/types build`, and **restart any
running `next dev`** — a hot-reloading server keeps the old chunk map and
starts 500ing with `Cannot find module './vendor-chunks/zod@…'`. Killing the
background task isn't enough on Windows; the Next child keeps the port, so
find it with `netstat -ano | grep :300x` and stop that PID.

**Fixed (2026-09-24) — a real, live bug, not hypothetical:** every
body-less `POST` through the shared `packages/api-client/src/client.ts`
(vendor accept-order, vendor mark-ready, rider accept/decline-offer,
admin approve-application, customer cancel-order) sent
`Content-Type: application/json` with no body. Fastify's default JSON
parser rejects that outright (`FST_ERR_CTP_EMPTY_JSON_BODY`, a real 400) —
reproduced live against the production API while testing reorder, not a
theoretical bug. `client.ts`'s `request()` now only sets that header when
`init.body` is actually present. One-line fix, fixes all six call sites at
once (the whole point of the shared package). **If anything upstream of
this still behaves like the old cancel/accept/ready buttons doing
nothing silently, that's not fixed elsewhere — check this.**

## 2026-09-27 — a real testing session, several real bugs found and fixed

The owner made themselves owner of **Grachi Pharmacy** (vendor) and a real
rider profile ("Scott pippen", motorcycle, `apps/vendor`/`apps/rider` under
`+2349077018785`) and walked a real order end to end against the live API —
this surfaced several real bugs no amount of automated testing alone had
caught, all fixed same-session:

- **No session refresh — every login died after 15 minutes.**
  `POST /auth/refresh` existed and `authApi.refresh()` was even exported,
  but nothing ever called it. `createApiClient` (`packages/api-client`) now
  retries once on a 401 from a request that sent a token: silent refresh,
  persist the new access token, replay. Concurrent 401s share one in-flight
  refresh. Verified against the live API by deliberately corrupting a real
  session's access token and confirming it recovered transparently.
- **`+234` phone preset** — new `PhoneInput` (`packages/ui`) pins a fixed
  `+234` chip; typing `09077018785` shows `9077018785` next to it.
  `toLocalDigits`/`NIGERIA_DIAL_CODE` (`packages/types/src/auth.ts`).
  Replaces every phone `<Input>` across the four apps; the submit-time
  `normalizePhone()` calls that made necessary are now redundant, removed.
- **Mobile layout** — the shared `Sidebar` (`packages/ui`, used by
  admin/vendor) was a permanent 224px column with no way to dismiss it; now
  a top bar + drawer below `lg`, unchanged from `lg` up. Admin's wide
  tables scroll inside their card instead of clipping.
- **"Place order" did nothing** — the API had **no error handler at all**,
  so every `schema.parse()` failure (e.g. a phone typed `0801…` instead of
  `+234…`) was a 500 in Fastify's default shape, which the client couldn't
  read, so it fell back to an empty `res.statusText` and rendered nothing.
  New `apps/api/src/lib/error-handler.ts`: ZodError → 400
  `VALIDATION_ERROR` naming the field, typed errors → their own code (503
  `PAYMENTS_UNAVAILABLE`, 503 `GEOCODE_UNAVAILABLE`), anything else → a
  generic 500 that no longer leaks internals. `client.ts`'s `readError`
  accepts either shape. Checkout with online payment while Monnify is
  unconfigured now refuses *before* writing an order (it used to create a
  dead `PENDING_PAYMENT` row first, then a retry replayed it).
- **Checkout raced its own empty-cart guard.** `clearCart()` (called right
  before redirecting to the tracking page) re-triggered the page's own
  "empty cart → back to `/cart`" effect, and that redirect usually won —
  confirmed live, a real guest checkout landed on `/cart`, not its own
  order. Fixed with `orderJustPlacedRef`, set the moment checkout succeeds,
  that the guard effect now checks. **This was very likely the real root
  cause of "guest orders go nowhere,"** more fundamental than the next
  item.
- **Guests had no way back to their orders.** By design, `/orders` was
  signed-in-only (no account to list against server-side) — true, but a
  dead end once a guest's one tracking link was lost. New
  `apps/customer/lib/guestOrders.ts` remembers tracking tokens in that
  browser (same pattern as the cart itself); `/orders` reads them back via
  the same public trackingToken route the tracking page uses. Labelled
  on-screen as same-device-only, not a synced account.
- **Vendor's collection code vanished once a rider was assigned.**
  `OrderCard` only showed it for `READY_FOR_PICKUP`; the moment
  `RIDER_ASSIGNED` hit, the code box disappeared even though the code was
  still live and still needed at the door. With more than one order in
  flight, the vendor had no way to tell which card's code belonged to the
  job actually being collected, and read out the wrong one — "that code
  doesn't match" was the API correctly doing its job, not a bug there. Now
  shown for both statuses (`apps/vendor/components/OrderCard.tsx`).
- **All codes are now 4 digits, not 6** — OTP login codes and the
  collection/delivery handoff codes both (`generateShortCode` in
  `order/service.ts`, Termii's dev-fallback generator, every `code`
  zod schema, every `maxLength`/placeholder in the four apps). A 4-digit
  OTP is still safe: `MAX_ATTEMPTS = 5` lockout already existed
  (`auth/service.ts`), so brute force tops out at 0.05% before locking.
  **This one needs the API redeployed to be testable at all** — until
  pushed, the live API still issues 6-digit codes while local frontends
  now cap entry at 4, so pickup/delivery code confirmation is broken
  *locally* in the meantime (OTP auto-signin is unaffected, it skips code
  entry entirely).
- **Address search, replacing raw coordinates as the primary input** — new
  `apps/api/src/modules/geocode/` (`GET /geocode/search`,
  `GET /geocode/reverse`), backed by **Nominatim (OpenStreetMap)**, not
  Google Places — `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is still unset (Known
  issues below). Deliberately **not** a replacement for the pin+landmark
  model — brief §3.4 is explicit that street addressing is unreliable
  across much of the launch market — only a faster way to *set* the same
  lat/lng checkout already required; landmark stays required, current-
  location and manual-coordinate entry stay as fallbacks. Scoped server-
  side to the *real, current* service-area polygon (read from Config, not
  a second hardcoded copy — `boundingBoxOf` in `geocode/service.ts`), so it
  never suggests an address CloseBuy can't deliver to. New `AddressSearch`
  component (`apps/customer`) debounces input, shows a dropdown, closes on
  outside-click; "Use my current location" now also reverse-geocodes the
  fix for a readable label, falling back to coordinates (with the accuracy
  figure) when no label resolves — never hidden outright, since at that
  point it's the only description of where the pin actually is.
  Nominatim's usage policy (max 1 req/sec, a real identifying User-Agent,
  no anonymous access) is enforced server-side: throttled + a 5-minute
  cache, state closed over per service instance (module-level would have
  meant one caller's throttle/cache bleeding into another's, and made
  tests slow/order-dependent — the throttle interval is injectable for
  exactly that reason, tests use ~15ms instead of the real ~1100ms). 10
  new unit tests (`geocode/service.test.ts`), all passing in <50ms.
  **Real coverage caveat, checked against live Nominatim, not assumed:**
  results for Riverpark specifically are sparse — a broad term ("estate")
  found the real "River Park Estate," but "road"/"close"/"market" found
  nothing, and this is exactly what brief §3.4 predicted going in. Expect
  this to work well for named landmarks/estates and often not for granular
  street names; the pin-based fallbacks exist precisely because of this,
  not as a formality. Worth revisiting with Google Places once Maps
  billing is unblocked — the module's shape (`search` → `[{label,lat,lng}]`,
  `reverse` → `label`) is deliberately provider-agnostic for exactly that
  swap.
- **Reconciliation (US-A-05's other half) — the last unbuilt Admin story,
  now built,** plus a bigger real gap found alongside it. New
  `apps/api/src/modules/admin/reconciliation.ts` (`GET /admin/reconciliation`)
  and admin `/payouts`. Lifetime totals, not date-ranged — "do the books
  check out right now" doesn't need a period window, and one would only
  complicate a Payout/remittance landing outside whatever range the ledger
  entry it corresponds to falls in. Every individual ledger write is
  already balance-asserted at the source (`order/ledger.ts`'s
  `assertBalanced`), so a platform-wide debit/credit mismatch is checked
  but should be structurally impossible; the two checks that actually earn
  their keep are per-payee: has a vendor ever been paid more than the
  ledger credited them (`vendor_payable` vs. `paid` `Payout` rows), and
  does a rider's live `cashBalanceMinor` equal cash collected
  (`rider_cash_float` ledger debits) minus cash remitted
  (`rider_cash_remittances`) — the second one is a real, already-known bug
  class: `confirmDelivery` (`dispatch/service.ts`) posts the COD ledger
  entry and increments `cashBalanceMinor` as two separate statements, not
  one transaction, and a crash between them would show up here as exactly
  this mismatch. **US-A-05's own acceptance criterion also asks for
  gateway-settlement-vs-ledger comparison — genuinely not buildable yet,**
  Monnify isn't configured so there's no real settlement data anywhere;
  the report says so honestly (`gatewaySettlement.reason`) rather than
  fabricating a comparison, and distinguishes "not configured" from
  "configured but the fetch isn't built" for when that changes.
  **Bigger finding while scoping this:** the admin `/payouts` page was a
  bare `Placeholder` component — but `GET/POST /admin/payouts/*`
  (approve/reject a vendor's withdrawal request) already existed and
  worked, real and live since early M1, with `PendingPayoutRequest`/
  `VendorBalanceDto`/`PayoutDto` types already written — nothing in any
  frontend ever called them. A real vendor payout request had no way to
  be acted on except a raw API call. Built the missing half of the same
  page: a request queue with approve/reject (mandatory reason on reject,
  matching every other admin action), pulled from `packages/api-client`
  additions of the same name. Approving with Monnify unconfigured fails
  exactly like it should (the existing `approvePayout` catches the
  `PaymentsUnavailableError` and marks the payout `failed` with that
  reason) — not specially handled, the UI just shows whatever the API
  says. 15 new unit tests (`reconciliation.test.ts`). **Verified against
  the live API for the payout-request half** (that part's backend was
  already deployed) — real session, real empty queue, no errors; the
  reconciliation half correctly degrades to a visible, scoped error
  ("That doesn't exist.") without breaking the rest of the page, since its
  route isn't deployed yet. Both halves' actual UI (cards, discrepancy
  panel, ledger table, tiles) verified by rendering against realistic
  fixture data instead.

**Mobile-responsiveness re-audit (2026-09-27, prompted by a direct user
challenge to an earlier "fixed" claim).** The Sidebar-drawer fix in
`3b2eafd` (deployed, see below) is real and does cover the actual sidebar/nav
chrome on vendor, rider and admin — that part of the earlier claim held up.
But it was never a claim that *every screen's own content* was checked at
phone width, and one hadn't been: `apps/vendor/app/settings/page.tsx`'s
opening-hours row (day label + two native `<input type="time">`, which
render in 12-hour AM/PM and are wider than a 24h locale + a "Closed" button,
all in one flex row) needed ~433px and only had 390px on a real deployed
phone-width render — confirmed live on `closebuy-vendor.netlify.app/settings`
via headless-Edge screenshot before fixing it. Fixed by stacking the day
label above a `flex-wrap` controls row instead of beside it. Re-checked
every other page of all three staff-facing apps (vendor `/`, `/products`;
rider `/`, `/earnings`; admin `/`, `/orders`, `/vendors`, `/riders`,
`/config`, `/metrics`, `/audit-log`, `/disputes`, `/payouts`) against the
live deployed sites at 390px with a real authenticated session on each —
all clean, no overflow found anywhere else. So the earlier "mobile
responsive" claim was half right: the drawer/nav chrome fix was real and
deployed, but this one screen's own content had never actually been
checked, and was broken until this fix.

**Saved addresses (US-C-05, 2026-09-27) — a real M-priority gap, not a
deferred nice-to-have.** Went looking for "what's genuinely next" after the
mobile-audit above and cross-checked `docs/01-requirements/user-stories.md`
against the actual frontend rather than trusting this file's own "What's
next" list (which had called M3 fully done) — US-C-05 is tagged **M**
("the platform cannot process a single real order without it"), and its
"saved addresses can be reused, renamed and deleted" criterion was flatly
unbuilt: the account page carried a literal `Placeholder` in its place. The
schema was never the gap — `addresses` and `Order.addressId` have existed
since the very first migration (`20260916113905_init`), and `checkoutSchema`
already accepted an optional `addressId` — nothing had ever exposed CRUD
for it, so it sat there unreachable. Built the missing half:
`apps/api/src/modules/auth/customer/addresses.ts` (new module, same
factory-function shape as `admin/remittances.ts`) + four routes on
`/customer/addresses[/:id]` in the existing `auth/customer/routes.ts`;
`AddressDto`/`addressCreateSchema`/`addressUpdateSchema`
(`packages/types/src/user.ts`); account page (`apps/customer/app/account`)
gets a real list/add/edit/delete UI (two-step inline delete confirmation,
no native `confirm()` — this codebase doesn't use those anywhere); checkout
gets a chip picker above `AddressSearch` that prefills the pin/landmark/phone
from a saved address, plus a "Save this address for next time" checkbox that
creates one right after a successful order (both best-effort, same
non-blocking pattern as the existing "save as default phone" checkbox).
`addressId` was already being written onto the order un-validated — added an
ownership check in `order/service.ts`'s checkout (the id is silently dropped,
not hard-rejected, if it isn't actually the caller's own address, since it's
never authoritative for where the order actually ships — data-model.md's own
note on the table). Two real, live-caught issues fixed along the way: the
account page's address list showed "Loading…" forever *alongside* a real
error, because `addresses` state was never set to `[]` on a failed fetch —
found by testing against the live API, which correctly 404s this route
(not deployed yet) and surfaced exactly that bug; and the ownership check
above, which didn't exist before this pass. 12 new tests (10 in
`addresses.test.ts`, 2 new checkout-ownership cases in
`order/service.test.ts`) — 301 API tests total, all green, plus a clean
`pnpm typecheck`/`lint` across all 8 packages. **Verified locally against
the live API** (headless Edge, 390px, a real throwaway account registered
for this — `claude-address-test@example.com`, no orders, safe to delete
whenever test-data cleanup happens): account page and the add-address form
both render and don't crash, checkout renders with the picker section
present and correctly empty (`GET /customer/addresses` 404s against the
live API exactly as expected, degrading to no chips rather than breaking
the page), no overflow at phone width either place. **Not exercised as a
real working round-trip** — that needs this deployed, same caveat as every
other local-only feature this session.

## 2026-09-29

- **US-C-04's other unbuilt half — "the cart is re-validated for price and
  stock at checkout, and any change is shown before payment."** Stock
  overages already hard-blocked at submit (`CartInvalidError`); price drift
  didn't — the server always recomputed the real price silently, so a
  customer was simply charged whatever it was with no warning if a vendor
  had raised (or lowered) it since the item was added. `cart.tsx`'s new
  `syncWithLiveProducts()` diffs the cart against a live
  `getVendorProducts` fetch (same call reorder already uses) the moment
  checkout loads, corrects the cart in place, and returns what changed;
  checkout shows a banner naming each change (price updated / quantity
  reduced to available stock / item removed) and the subtotal/total below
  already reflect the correction — purely additive, no backend/schema
  change, the server-side check stays the real authority regardless.
  Verified against real live vendor data (Anishoks Supermarket, a
  deliberately stale seeded cart) — all three change kinds fired
  correctly, no overflow/errors.
- **Customer app restyle, Home then the rest of the app** — the user shared
  reference screenshots (a red food-delivery app) and asked for CloseBuy's
  UI to look "more defined." Scoped down first (asked, not assumed): keep
  CloseBuy's own green/orange, not the reference's red or dark theme;
  visual restyle only, not the real features mixed into those screenshots
  that CloseBuy doesn't have (packaging/container choice, Favorites,
  Streaks, Idea Bank, WhatsApp/Snapchat links — none of that built); start
  with Home, then ("carry on until you've effected across pages") the rest
  of the commerce surface. Same visual language everywhere: bolder section
  headers, `rounded-2xl`/`shadow-sm` cards replacing flat `rounded-xl`
  borders, real status badges instead of small muted labels, skeleton
  loading states, centered icon+message empty states — all through the
  existing brand tokens (`success`/`warning`/`danger`/`accent`), no new
  ones added.
  - **Home** — location chip is now a real bordered pill instead of bare
    text, bigger/bolder category rail (`CategoryChips.tsx`), and
    `VendorCard.tsx` (shared with Search) carries real badges over the
    cover — category pill top-left, OPEN/CLOSED pill top-right.
  - **Vendor storefront + Quick Buy/Menu** — OPEN/CLOSED badge over the
    cover mirrors `VendorCard`; `ProductCard`/`QuickBuyCard` get a real
    "Available" status dot, bold accent-colored pricing and a circular "+"
    add button. **Deliberately no item-detail modal** — Product has no
    modifiers in the data model, so direct-add (existing behavior) stays
    correct; a modal would imply a customization step that doesn't exist.
  - **Cart** — pill quantity stepper matching `ProductCard`'s, card-styled
    subtotal, icon empty state.
  - **Checkout** — a real radio-style selected state on `PaymentOption`,
    card-styled order summary with the total in accent orange.
  - **Account** — an avatar-initial circle on the profile card, and a
    proper *non-dashed* guest ("Guest"/Sign In/Register) state — the
    dashed `Placeholder` component means "not built yet" (a real, load-
    bearing signal elsewhere in this app), which a normal signed-out state
    isn't; correctly left in place for "Ratings you've given," which
    genuinely isn't built.
  - **Orders list** — status pills colored by outcome
    (`success`/`warning`/`danger` over the *same* `OrderStatus` enum, no
    new states).
  - **Order tracking, Search** — consistent card/skeleton/empty-state
    treatment carried through.
  - **Left alone, on purpose**: auth pages (login/register/forgot-password/
    reset-password/verify-email/oauth-complete) and the legal pages
    (terms/privacy) — already minimal and appropriate for their purpose,
    not part of the commerce surface the reference screenshots were about.
  Verified against live vendor data at 390px across every touched screen
  (Home, Search, vendor storefront, cart, checkout, account signed-in,
  orders) — no overflow, no console errors; real data (missing product
  photos, out-of-stock items, the closed E2E test vendor) all rendered
  correctly. `pnpm typecheck`/`lint` clean across all 8 packages both
  times (Home, then the rest).
- **Grachi Pharmacy was closed** (`isOpen: false`) on the live DB — not a
  bug, the owner's own vendor had been toggled closed at some point.
  Flipped it back to open via a direct API call at the owner's request
  (`PATCH /vendors/me`, real write against production).
- **Rider "Couldn't update duty status"** — root-caused to a stale/expired
  access token in that browser session, not a real bug: a fresh session
  hit `PATCH /riders/me/duty` successfully (verified directly against the
  live API). Also restarted the vendor/rider/admin local dev servers while
  investigating — they'd been running since before this session's earlier
  `@closebuy/types` rebuild and had never been restarted (only the
  customer server had), the same staleness gotcha documented elsewhere in
  this file.

**Deployed 2026-09-29 (owner said "go live") — API only. Netlify failed on
this push; corrected here after initially assuming (wrongly) that it had
succeeded.** All 25 commits since `3b2eafd` pushed to `main`:
`git push origin main` (`3b2eafd..4f46762`), no `--force`, nothing skipped
on the git side. **No new migration this time** — checked before pushing
(`git diff origin/main..HEAD` touched neither `schema.prisma` nor
`prisma/migrations/`); the `addresses` table this round's biggest feature
depends on has existed since the very first migration regardless.

- **Railway (API): deployed and verified.** Polled `GET /customer/addresses`
  until it flipped from 404 (route doesn't exist) to 401 (route exists,
  needs auth) to confirm the rebuild had actually landed, then ran
  `node apps/api/scripts/e2e-lifecycle.mjs run` — **all 39 checks passed**
  against the live API, full guest-COD order loop start to finish. This
  also confirms the 4-digit-code change is genuinely live now: the run's
  own vendor collection code came back 4 digits (`9592`).
- **All four Netlify sites: build failed, `error_message: "Skipped due to
  account credit usage exceeded"`** — confirmed via `netlify api
  listSiteDeploys`/`getSiteDeploy` for each site (`closebuy1`,
  `closebuy-vendor`, `closebuy-rider`, `closebuy-admin`), not a code
  problem, an account-level Netlify billing limit. This is exactly the
  "Netlify-credits constraint" earlier sessions held off pushing over —
  it wasn't hypothetical. **First check I ran (all four sites 200 on
  `/login`) was misleading** — that's the CDN still serving the last
  *successful* build, `3b2eafd` from 2026-09-27, not evidence the new
  push landed; `curl`ing a Netlify site's HTTP status after a push proves
  nothing about that push's own build result, only `netlify api
  listSiteDeploys` does. Caught because the owner said "not netlify" —
  should have checked deploy state via the API before declaring victory,
  not after.
- **Net effect**: the live frontends are unchanged, still `3b2eafd`,
  same as they were before this push — not broken, just not carrying any
  of this session's frontend work (saved addresses UI, the cart
  price/stock banner, the whole restyle, or anything else customer/
  vendor/rider/admin-side from the 2026-09-27/09-29 sections). The API
  they're talking to is backward compatible with that old build (only new
  routes were added, nothing removed or renamed), so nothing is expected
  to be broken for a real user right now — just stale, not broken.
- **Unresolved, not something I can fix from here**: the Netlify account's
  credit usage needs to clear (billing-cycle reset, or a plan change) before
  a retry can succeed. Once it does, the fix is almost certainly just
  re-triggering a deploy for each of the four sites against the same
  `4f46762` commit — nothing about the code needs to change.
- **Item-detail sheet + a store-landing vendor page** — same reference
  screenshots as the restyle, a further ask ("let a full picture and
  description show with other options"). Scoped down again first: the
  reference's "Packaging (Required)" container picker is a real, new
  feature (Product has no modifiers in the data model at all) with real
  money implications and a product-fit question (most CloseBuy vendors
  are supermarkets/pharmacies, not restaurants) — asked, and the answer
  was skip it, not fake it. Built: `ProductDetailSheet.tsx` (full image/
  name/price/availability/description + the same Add/stepper interaction
  ProductCard already had, opened by tapping the image or name — the
  quick-add controls stay direct), and the vendor page restructured into
  the reference's hero-photo-plus-overlapping-info-sheet shape, with a
  real Hours/Days/Pickup box and Menu/Reviews tabs. Two small, real
  backend additions behind those, not decoration: `VendorDto.openingHours`
  is public now (was omitted for no real reason — unlike pickupLat/Lng/
  Phone/bank details it was never actually sensitive), and
  `GET /vendors/:id/ratings` lists the individual reviews behind the
  existing average/count — no reviewer name in the response, since
  CloseBuy never collects one for a customer, so the frontend labels
  every review "Customer" rather than fabricating one.
  `apps/customer/lib/formatHours.ts` never claims "Every day" unless
  every day that's actually set shares the same range. 3 new catalog
  tests, 304 API tests total. Verified against live vendor data at
  390px — the redesigned page, both tabs, and the detail sheet (including
  Add-to-cart → quantity-stepper) all render correctly; the reviews tab
  and Hours box both degrade correctly against the still-undeployed API
  (a visible error, and no box, respectively) — same pattern as every
  other local-only feature this session. **Also local-only, not pushed**
  — see the Netlify note above for why another push isn't happening
  without being asked.
- **Fixed same-day, from live feedback**: the item-detail sheet above was
  sizing to its own content (`max-h-[85vh]`) instead of a fixed height, so
  a short item with no description rendered as a small centered popup, not
  the reference's large bottom sheet — now `h-[75vh]` with a drag handle,
  plus the reference's "Your order" recap row (a real echo of the item
  being viewed, not new data). Separately, every product/vendor image
  across the app (`ProductCard`, `QuickBuyCard`, `VendorCard`, the vendor
  hero, both images in the sheet) used `object-cover`, cropping/zooming a
  real photo to fill its box — switched all five to `object-contain` on
  their existing neutral background so an image always shows whole.
- **"Next 5" roadmap pass** — asked to pick and build the next 5 gaps
  without stopping. A server-side tool-classifier outage blocked all
  writes partway through; the user switched Claude Code's permission mode
  to manual approval to unblock it. All 5 are done:
  1. **OTP_DEV_FALLBACK production hole, closed** — see the "Known
     issues" entry above (now struck through). `auth/routes.ts`'s
     `/auth/otp/request` now only returns `devCode` when
     `NODE_ENV !== "production"`; the owner's own
     `DEV_AUTO_SIGNIN_PHONES` path is checked and returned earlier and is
     unaffected. No dedicated test added — this codebase has no
     route-level test file anywhere (checked, every test is
     service-level), so a new pattern for one `if` condition wasn't
     worth it; covered by code review instead.
  2. **`confirmDelivery`'s COD ledger write + rider balance increment, now
     one transaction** — closes the weak spot noted above (struck
     through). `dispatch/service.ts` wraps both in `prisma.$transaction`;
     `postLedgerEntries` already accepted a transaction client, no
     signature change needed. New test spies on `$transaction` to confirm
     the wrapping is real, not just that both side effects happen to
     occur.
  3. **PENDING_PAYMENT expiry job, plus a real race it would otherwise
     have opened up.** An online-payment (card/transfer) order that never
     gets a Monnify webhook used to sit in `PENDING_PAYMENT` forever.
     Fixed with a new BullMQ timer (`order/jobs.ts`'s
     `"expire-pending-payment"`, same pattern as auto-reject/
     escrow-release), scheduled at checkout and cancelled the moment
     `markOrderPaid` fires; `pending_payment_expiry_minutes` is a new
     Config key with a 30-minute fallback default (same
     "added after the seed ran, don't 500" precedent as
     `rider_cash_float_limit_minor` — not yet admin-editable, same status
     that key had before its own admin wiring existed). Doing this
     *without* also hardening `handleMonnifyWebhook` would have
     introduced a new bug: a late webhook arriving after the timer
     already cancelled the order would have silently resurrected it via
     the old unconditional `markOrderPaid` call. The webhook now checks
     the order's status first — if it's no longer `PENDING_PAYMENT`, it
     refunds through the existing `refundIfPaid` helper instead of
     reviving the order. New notification type `order_payment_expired`
     (`enums.ts`, plain string array, no migration). 8 new unit tests
     covering the schedule call, the expiry no-op-if-already-paid case,
     and the late-webhook race specifically. **Not deployed** — this is
     new code the live API doesn't have yet.
  4. **Search matches product names, not just vendor names (US-C-03)** —
     `catalog/service.ts`'s `searchVendors` now also matches on any of a
     vendor's own active products (`OR` clause on `businessName` /
     `products.some`). Previously a customer who knew an item but not
     which vendor stocks it had no way to find it. The test fake's
     `vendorProfile.findMany` only ever evaluated `status` before this —
     no existing test exercised the `q` param at all — so it needed
     extending to actually evaluate the where-clause shape before a
     meaningful test could be written; 2 new tests (active product
     matches, inactive product doesn't).
  5. **Customer notification feed** — `notify()`/`GET /notifications`/
     `POST /notifications/:id/read` have been real and working since
     early in this build with zero frontend consumer anywhere (same
     "working backend, no UI" pattern that's bitten this project before —
     disputes, ratings, admin payout approval). New
     `apps/customer/app/notifications/page.tsx`, a bell icon on the Home
     header (shown only when signed in), `packages/api-client/src/
     notifications.ts`. Deliberately informational-only, not deep-linked
     to a specific order — `Notification.payload` only carries a raw
     `orderId`, no `trackingToken`, and this app has no raw-orderId
     route. Deliberately didn't touch the shared `BottomNav` (its own
     comment: "4 tabs, not DoorDash's 5") — a header icon instead.
     Human-readable labels cover the customer-relevant `NotificationType`
     subset, with a generic fallback for anything unmapped. Verified live
     in headless Edge at 390px: registered a real throwaway account
     (`claude-notif-test-<timestamp>@example.com`, no orders, safe to
     delete), confirmed the bell only shows signed-in, the empty state
     renders ("No notifications yet"), no horizontal overflow, no console
     errors from the app's own code (some hydration-mismatch noise came
     from browser extensions injecting DOM attributes into the Edge
     profile used for testing, unrelated to CloseBuy). Didn't verify the
     populated-list/mark-read path against a real notification row — that
     needs an account that's actually been through order status changes,
     which this throwaway account wasn't.
  All 4 backend items (1–4): `pnpm typecheck`/`lint` clean across all 8
  packages, 312 API tests passing (up from 304). **Local-only, not
  pushed** — same reasoning as everything else in this file since the
  2026-09-29 Netlify credit block: nothing here has been asked to go
  live yet, and item 1 especially needs a deploy to actually close the
  live hole it fixes.
- **"Go further" pass — a real M4 bug plus a real M4 acceptance-criterion
  gap, found by auditing scheduled ordering against user-stories.md.**
  M4 (Scheduled delivery) turned out to be much further along than the
  roadmap doc's own "~2 weeks, not started" framing suggests — cart-side
  ASAP/Schedule toggle, checkout plumbing, and the vendor's separate
  "Scheduled" queue tab were all already real and working. Two genuine
  gaps found and fixed:
  1. **A live bug: a scheduled order used to auto-reject and refund
     itself within `vendor_accept_window_minutes` of being *placed*, not
     of its *slot*** — so an order scheduled for tomorrow could
     self-cancel within 15 minutes of checkout, long before any vendor
     would reasonably have looked at it, silently breaking scheduled
     ordering end to end. US-V-05 says this window has to be relative to
     the slot. Fixed in `markOrderPaid` (`order/service.ts`): a scheduled
     order's auto-reject timer now fires `vendor_accept_window_minutes`
     *before* the slot, clamped to 0 (not negative) when the slot is
     already inside that window. 2 new tests.
  2. **US-C-05a's "a time slot within the vendor's stated hours" was
     entirely unenforced** — the cart page's schedule picker was a bare
     `datetime-local` input with no bounds, and checkout didn't check
     either. The blocking comment explaining why ("`VendorProfile.
     openingHours` has no admin/vendor UI to ever populate it yet") was
     itself stale — vendor Settings has had real opening-hours editing
     since the 2026-09-27 mobile-responsiveness pass; the comment was
     just never updated, so this looked unbuildable when it wasn't.
     Fixed at both layers: `order/service.ts`'s `checkout()` now rejects
     (`ScheduledTimeOutsideHoursError`, 422 `SCHEDULED_TIME_OUTSIDE_HOURS`)
     a `scheduledFor` outside the vendor's opening hours for that day,
     reasoned in Africa/Lagos time (`LAGOS_OFFSET_MS`, same fixed-UTC+1
     convention `admin/metrics.ts` already uses); the cart page fetches
     the vendor's real hours when "Schedule" is selected and shows an
     inline error + disables "Proceed to checkout" for an out-of-hours
     pick, mirroring the server check exactly — same "shown before
     payment, server is the real authority" relationship US-C-04's cart
     sync already has to checkout. A vendor with no hours set at all
     still isn't blocked (nothing real to constrain against). 3 new
     server-side tests.
  Also fixed two stale comments found along the way, since they actively
  misdirect the next read: `catalog/service.ts`'s search page comment
  claimed vendor-name-only search was still true (item 4 of the previous
  pass fixed that); `admin/service.ts`'s module doc still said
  reconciliation/metrics were "not built" (both shipped 2026-09-26/27).
  **Deliberately not attempted**: the actual BullMQ "hold after
  acceptance, activate into `PREPARING` — and dispatch, for delivery —
  timed to land near the slot" mechanism architecture.md §3 describes.
  What exists today has a vendor accept a scheduled order and it goes
  straight to active `PREPARING`/dispatch immediately, same as an ASAP
  order; the slot is currently just informational once accepted. That's
  a materially different, larger piece of work with real design
  questions (does the vendor's own prep timing change? does a delivery
  job appear to riders immediately or near the slot?) that's worth
  scoping deliberately rather than improvising mid-pass — flagged here as
  the next real M4 gap, not silently skipped. Verified: `pnpm typecheck`/
  `lint` clean across all 8 packages, 317 API tests passing (up from
  312), and the cart scheduling UI checked live in headless Edge against
  a real vendor (Anishoks Supermarket) — toggle, date picker, and
  checkout-button state all correct. Only the "vendor has hours set and
  blocks an out-of-window pick" branch wasn't exercised live — no vendor
  in the live API currently has `openingHours` in its public response at
  all yet (that field's own publication is itself still local-only, from
  the 2026-09-29 item-detail-sheet work above) — code-reviewed and
  covered by the mirrored, unit-tested server-side logic instead. Local-
  only, not pushed, same as everything else this session since the
  Netlify credit block.
- **"Next 5 again" — a fourth instance of "working backend, no UI," plus
  two smaller acceptance-criterion gaps.** Same audit method as the last
  two passes: read the actual user-stories.md criteria and code, not this
  file's own claims. Three of five items were `GET`/`POST` endpoints that
  had been real and working with zero frontend consumer — the exact
  pattern this file has flagged repeatedly (disputes, ratings, admin
  payout approval, the notification feed) and evidently hadn't finished
  surfacing.
  1. **Vendor payout history + a "Request payout" button** — `GET/POST
     /vendors/me/payouts*` (vendor-requested, admin-approved payouts,
     built early M1) had no frontend at all; the earnings page's own
     `Payout history` `Placeholder` claimed "no payout-run mechanism
     exists yet," which was simply wrong — vendors have always been able
     to request one, and admin has been able to approve/reject since
     2026-09-27. New `packages/api-client/src/payouts.ts`, and the
     earnings page now shows `availableToWithdrawMinor` next to a real
     request button and lists payout history with status/reference/
     failure-or-rejection reason.
  2. **Customer "Ratings you've given" (US-C-10)** — genuinely new
     backend this time, not just a missing frontend: no endpoint had ever
     existed to list a customer's own ratings back (the account page's
     own comment said so honestly). New `order.listMyRatings(userId)` +
     `GET /customer/ratings`, joining through each rating's own order
     (a rating's `targetId` always points at that order's `vendorId` or
     `riderId` — confirmed against `rateOrder`'s own logic, not assumed)
     to show who it was for without a second round trip. New
     `MyRatingDto` type. Account page replaces the old Placeholder with a
     real list linking each rating back to its order's tracking page; the
     genuinely-still-unbuilt "Payment methods" row now says why honestly
     (no stored payment methods exist at all — Monnify's hosted page
     handles cards entirely) instead of the stale comment that used to
     lump it in with ratings.
  3. **Admin audit-log date-range filter (US-A-08)** — `searchAuditLog`
     already accepted `from`/`to`; the page only ever exposed actor/
     target inputs. Added two date fields, converted to full-day ISO
     boundaries client-side.
  4. **Admin orders page vendor/rider/date filters (US-A-03)** — same
     shape of gap: `listOrders` already accepted `vendorId`/`riderId`/
     `from`/`to`; the page's own comment claimed "filterable by state/
     vendor/rider/date" while only exposing status and fulfilment type.
     Added the missing fields (applied on explicit Search, not per
     keystroke, matching the audit-log page's own convention) plus a
     small extra: a vendor or rider's name in the table is now a button
     that filters straight to their orders, since a bare free-text UUID
     field alone would be nearly unusable for a human operator.
  5. **Customer tracking page: explain `PENDING_PAYMENT` clearly** — an
     order whose Monnify payment hadn't been confirmed used to render as
     an empty, unexplained step list (its status isn't in either the
     pickup or delivery step sequence, so nothing showed as done and
     nothing said why). Now a distinct panel explaining payment is still
     being confirmed, that an abandoned payment auto-cancels itself
     (the 2026-09-29 PENDING_PAYMENT-expiry work earlier this file), and a
     link back to the vendor to start over — deliberately not a "retry
     this exact order" flow, which Monnify/this app doesn't build; that
     would need a real scoping decision, not an improvised one.
  Verified: `pnpm typecheck`/`lint` clean across all 8 packages (one
  real lint catch along the way — two unescaped apostrophes), 319 API
  tests passing (up from 317). Live in headless Edge against the real
  dev server: the customer account page, signed in with a fresh
  throwaway account — the ratings section degrades to a clean, honest
  "That doesn't exist." rather than crashing, since `GET /customer/
  ratings` isn't deployed yet (same pattern as every other local-only
  feature this session), no overflow, no real console errors. **Not
  verified live**: the vendor earnings payout section and the admin
  orders/audit-log filter additions — this session has no vendor or
  admin credentials for the live app, only a customer one; covered by
  typecheck/lint/code review instead. Local-only, not pushed.
- **M4's last real gap, scoped with the owner rather than guessed at.**
  Asked directly: for a scheduled order, once the vendor accepts it, what
  should actually happen before the slot arrives — architecture.md §3's
  full "BullMQ holds it, activates near the slot" mechanism (new order
  status, touches dispatch too), or a minimal fix? **Owner chose minimal.**
  Turned out the bigger mechanism was less necessary than the roadmap
  doc implied: the vendor already fully controls when a delivery job
  reaches riders — `markReady` is their own manual action, never
  automatic on accept — so nothing today actually forces early dispatch
  for a scheduled order. The one real, honest gap was narrower: the
  customer's own tracking page showed "Preparing" as the active step the
  instant a vendor accepted, even for a slot days out, because
  `acceptOrder` reaches `PREPARING` immediately regardless of
  `scheduledFor`. Fixed in the tracking page only (no API/schema change):
  while the order is still exactly `PREPARING` and its `scheduledFor` is
  still in the future, the step list caps its displayed progress at
  "accepted" rather than the raw `order.status`, with a banner explaining
  the vendor will start preparing closer to the slot. The moment the
  vendor takes any real next action (marks it ready — early or not,
  their call) it's shown exactly as-is, since that's genuine progress,
  not an artifact of `acceptOrder`'s default. `pnpm typecheck`/`lint`
  clean across all 8 packages. **Not verified live** — needs a real
  vendor session to accept a scheduled order, which this session doesn't
  have; the change is presentational-only, computed entirely from fields
  already on `OrderDto`, so nothing new to typecheck against.

## 2026-09-30

- **Notification UI, extended to vendor/rider/admin — it only existed for
  customer.** `notify()` has always fired at vendor, rider and admin
  users too (`order_paid`, `vendor_application_approved/rejected`,
  `payout_paid/failed/rejected`, `vendor_suspended/unsuspended` →
  vendor; `rider_application_approved/rejected`,
  `rider_suspended/unsuspended`, `rider_cash_remitted`,
  `order_reassigned` → rider; `order_delivery_failed` broadcast to every
  admin via `notifyAllAdmins`) but none of those three apps had ever had
  a single line of notification UI — confirmed by grep, not assumed.
  Same shared `@closebuy/api-client` `notifications.ts` from the customer
  build (`list`/`markRead`, generic across roles already), wired into
  each app's `lib/api.ts`. New `/notifications` page per app, each with
  its own label map covering only the `NotificationType`s that role
  actually receives (a generic fallback covers anything unmapped). Nav
  integration follows each app's own existing pattern rather than a
  shared new one: a `Notifications` entry in `VendorSidebar`/
  `AdminSidebar` (both already list-driven), and a header link next to
  the rider app's existing lone `Earnings` link — deliberately not a
  persistent tab bar, matching that app's own documented "single-task by
  design" choice. Dropped `lucide-react` from all three pages after
  typecheck caught it: only the customer app declares that dependency;
  vendor/rider genuinely don't have it installed (admin's own typecheck
  passed by accident, via pnpm hoisting from customer — not something to
  rely on), so all three use plain-text empty states instead, matching
  what these three apps already do everywhere else (none of their
  existing empty states use decorative icons).
  `pnpm typecheck`/`lint` clean across all 8 packages; 319 API tests
  still green (backend untouched this pass). **Live-checked in headless
  Edge**, all three apps: this session's local dev servers had been
  silently stopped between sessions (confirmed via `netstat` — a
  background-task lifecycle detail, not a code issue), so all four were
  restarted first. With no vendor/rider/admin credentials available,
  verified what's actually checkable without one: each `/notifications`
  route compiles and renders with no console errors, and the new nav
  entry shows correctly in each app's own chrome (`VendorSidebar`,
  `AdminSidebar`, the rider header) — the signed-in list/mark-read view
  itself is code-reviewed only, same limitation as the vendor-payout and
  admin-filter work two passes ago. Local-only, not pushed.

## What's next

**Every Admin story is now built (US-A-01 through US-A-08)** — reconciliation
(US-A-05's other half) was the last one, built 2026-09-27 (see the dated
section above): `apps/api/src/modules/admin/reconciliation.ts`,
`GET /admin/reconciliation`, admin `/payouts`. **Found and fixed alongside
it, not originally scoped:** the admin payout-*approval* UI didn't exist
either — `GET/POST /admin/payouts/*` (approve/reject a vendor's withdrawal
request) had been real and working since early M1, `PendingPayoutRequest`/
`VendorBalanceDto`/`PayoutDto` types already existed, but nothing in any
frontend ever called them. A real vendor payout request had no way to be
acted on except a raw API call. Exactly the "working-looking backend, zero
UI" pattern that's bitten this project before (disputes, ratings) — grep the
actual frontend before trusting a doc that says a story is "built" from the
backend alone; this file has been wrong about that repeatedly.

In priority order, picking up from there. Self-service cancellation,
inventory-race handling, order history/reorder, disputes and ratings are
also done end to end (see above), as is rider cash remittance — an
earlier version of this section listed some of these as still to do,
which was wrong; verify against the code, not this list, before assuming
something isn't built:
1. **M3 hardening — what's genuinely left.** The customer-facing S-priority
   stories (US-C-08 through US-C-11) are all built now. **US-R-06 (failed
   delivery) audited and finished 2026-09-27** — the backend
   (`reportDeliveryFailed`) and a rider-side report-failure form had
   existed since early Rider work, but two of the story's four acceptance
   criteria weren't actually met: "alerts admin" had nothing on the admin
   side at all (`order_delivery_failed` was customer-only), and "the rider
   is instructed whether to return the goods" had zero UI — the form just
   closed and dropped the rider back to "waiting for a job" holding a real
   package with no guidance. Fixed: `notifyAllAdmins` (dispatch/service.ts,
   queries every `role: "admin"` User row — no such broadcast helper
   existed before this, `notify()` is per-user) now fires alongside the
   customer notification; `ReturnGoodsScreen` (apps/rider/app/page.tsx)
   shows after a reported failure — vendor name/landmark, Navigate/Call,
   an explicit "I've returned the goods" acknowledgement (local UI state
   only, nothing server-side tracks a return — no field exists for it, so
   this never claims to have recorded something it hasn't) — before
   falling back to the normal duty-polling loop. The money criterion
   ("cash already collected is tracked") was already fine as-is: COD only
   collects cash at `confirmDelivery`, which a failed delivery never
   reaches, so there's nothing to track for that path; an online-paid
   order can already be refunded via the existing `forceRefundOrder`
   (admin/orders.ts has no status guard, so DELIVERY_FAILED was already a
   valid state for it). 6 new tests (dispatch/service.test.ts). Verified
   live end to end: a real order walked through checkout → accept → ready
   → claim → confirm-collection → report-failed against the live API,
   driving the real rider frontend the whole way — `ReturnGoodsScreen`
   rendered with the real vendor's real pickup address, and "Done"
   correctly returned to the normal active-job flow (confirmed by it
   picking up a second, leftover order from an earlier interrupted test
   run — proof the flow re-queries properly rather than getting stuck).
   The admin-notification half is unit-tested only, not live — its route
   isn't deployed yet.
   **Also found and fixed while auditing this: a real, live-breaking
   regression from the earlier 4-digit-code change** —
   `apps/rider/app/page.tsx` (collection-code submit button, delivery-code
   confirm validation, delivery-code submit button) and
   `apps/vendor/components/OrderCard.tsx` (collection-code submit button)
   all still compared `code.length` against `6`, not `4`. The original
   sweep's grep pattern didn't match a bare `.length !== 6`. Live effect:
   every one of those submit buttons was permanently disabled and
   confirm-delivery's own validation rejected a correct 4-digit code
   outright — pickup and delivery confirmation were both fully blocked,
   independent of whether the API was deployed. Fixed immediately on
   discovery, separate commit, before this feature was even scoped.
   **Every S-priority rider/vendor story is now audited — US-V-04 (track
   inventory) was the only one left, and it had a real gap too, found and
   fixed 2026-09-27.** Three of its four acceptance criteria were already
   solid: decrement-on-accept is atomic and correctly guarded against
   concurrency (`order/service.ts`'s `acceptOrder`, a conditional
   `updateMany` on `stock: { gte: quantity }` inside a transaction, the
   whole accept fails if any item's short); stock reaching zero already
   makes a product unavailable in practice — `ProductCard`/`QuickBuyCard`
   disable "add to cart" and label it, and checkout re-validates
   server-side regardless — just not via literally flipping `isActive`
   (deliberately: `isActive` means "still in this vendor's catalog at
   all," a different, longer-lived concept than "temporarily out of
   stock," and conflating them would need an explicit reactivation step
   every restock). The fourth — "a cancelled or rejected order returns its
   stock" — had a real hole: the two normal paths (self-service
   `cancelOrder`, vendor `rejectOrder`) correctly have nothing to restore,
   since both only ever act on a still-`PAID` order and stock isn't
   decremented until accept. Admin's `forceCancelOrder`
   (`admin/orders.ts`) is the one path that can stop an order *after* that
   decrement already happened — `PREPARING` through `IN_TRANSIT` are all
   fair game for it — and it never gave that stock back, silently, every
   time. Fixed: restores each item's stock when force-cancelling from any
   of those four statuses, deliberately excluding `PAID` (nothing was ever
   taken) and `DELIVERED` (the goods are with the customer now, not
   sellable inventory — force-cancelling a delivered order is a financial
   correction, `forceRefundOrder` is the tool for that, and it already
   correctly never touches stock). 5 new tests, one per status including
   both deliberately-excluded ones. Unit-tested only, not verified live —
   `forceCancelOrder`'s route is already deployed, but this session's fix
   to it isn't pushed yet, so exercising it live right now would only
   prove the *old*, gap-having behavior.
2. **Desktop-responsive layout** for customer/vendor/rider — explicitly
   deferred pre-launch, mobile-only for now by the user's own call.
3. **ToS / Privacy Policy — written 2026-09-27.**
   `apps/customer/app/terms/page.tsx` and `.../privacy/page.tsx`, hosted in
   the customer app (the one surface a member of the public reaches
   without a staff account already) — linked from the login, register,
   and account pages there, and from the vendor and rider application
   forms (cross-app links to the customer app's production URL, since the
   content lives in one place). Grounded in what the system actually does,
   not a generic template: the commission split (5%/10%), the escrow
   holding window (~48h), and the service-area restriction are real
   `Config` defaults (`prisma/seed.ts`), phrased as "currently" since
   they're admin-adjustable; the third-party list (Termii, Monnify,
   Google, Nominatim, Neon, Railway, Netlify) was grepped against
   `.env.example` and actual imports, not assumed; the location section
   describes brief §3.5's real point-in-time-only design, not continuous
   tracking; the "your rights" section says "email us" for
   access/correction/deletion because that's genuinely how it works right
   now — **there is no self-service account deletion built**, and this
   never promises one that doesn't exist. **Two things the owner needs to
   actually do, not just code:** (1) create the `closebuy.ng@gmail.com`
   inbox these documents point to — it doesn't exist yet, it was proposed
   and not pushed back on when asked; (2) **this is a first draft, not
   reviewed by a lawyer** — both documents say so nowhere on the page
   itself (deliberately — a public legal document doesn't editorialize
   about its own drafting process), so it's worth remembering here:
   get real legal review before this is what a paying customer, a real
   vendor's bank details, or a Google OAuth verification reviewer relies
   on.

**Deployed 2026-09-26 (owner asked for it explicitly).** Everything from
2026-09-24 onward is pushed to `main` and live: Railway rebuilt the API from
the Dockerfile (verified by `ratingAverage` appearing in `GET /vendors`) and
the customer site auto-rebuilt from the same commit. The three hand-written
migrations were applied with
`railway ssh -- sh -c "cd /app/apps/api && npx prisma migrate deploy"` —
Railway does **not** run migrations on start, so every future schema change
needs that step after the deploy, or the new code queries columns that don't
exist:
- `20260924120000_dispute_resolution_and_suspension` — adds
  `PaymentStatus.partially_refunded` and an index on `disputes.status`.
- `20260926090000_rating_unique_per_order_target` — a unique index on
  `ratings(orderId, targetType)`. The duplicate check came back empty (0 rows)
  before applying, as expected — no rating UI had ever existed.
- `20260926140000_rider_cash_remittances` — new `rider_cash_remittances`
  table (US-R-08). `prisma/APPEND_ONLY.sql`'s REVOKE line for it is **not**
  applied and would achieve nothing anyway (the app is the table owner — see
  the ledger note under Conventions).

(An earlier session's `migrate deploy` was refused by the auto-mode
classifier as a production deploy; it went through this time because the
owner had asked for the deploy in so many words. Don't try it unprompted.)

Verified after the deploy: the full e2e (39 checks) passes against the new
API; the earnings endpoint returns the cash-limit field; the remittance
history endpoint exists; the public vendor list carries the real rating
average/count and no longer leaks `reliabilityScore`; tracking returns
`ratings` and `dispute`; every new admin route answers 401 without a
session; CORS preflight is allowed from all four Netlify origins and refused
for an unknown one. **Not yet exercised live:** anything that needs an admin
session — the cash-limit gate (lower the limit on admin `/config`, watch the
COD job vanish and a direct claim get 409 `CASH_FLOAT_LIMIT`), recording a
remittance from admin `/riders`, resolving a dispute, metrics against real
rows. Those are the next things to walk through in a browser.

## Smoke-testing the live order loop

`apps/api/scripts/e2e-lifecycle.mjs` drives the whole order-to-delivery
loop through the real HTTP API (no browser needed): guest cash-on-delivery
checkout → vendor accept → ready → rider claim → collection code → delivery
code + exact cash → `DELIVERED`, with the guards (wrong collection code,
wrong delivery code, wrong cash amount, double claim, idempotent replay) and
the books (stock decrement, rider cash balance, escrow held, transition
history and actors) checked at each step — ~39 assertions.

- `node apps/api/scripts/e2e-lifecycle.mjs setup` creates a test vendor and
  rider through the real signup/apply flow. They land `pending` and **only
  an admin can approve them** (admins are never self-created) — do it on the
  admin app's Applications page. Then `... run`.
- **Passed in full on 2026-09-26** against the live API both before and
  after the deploy above (39 checks each time) — the M1 loop is genuinely
  sound and the deploy didn't break it. Not covered: anything in the UIs
  themselves (it drives the API, not a browser), escrow release →
  `COMPLETED` (a 48h timer, or an admin rejecting a dispute), ratings,
  disputes, admin-recorded remittance, the cash-limit gate, metrics — all of
  which need an admin in the loop.
- **Re-run it after every deploy** — it's the fastest way to prove a push
  didn't break the core loop. `E2E_API_URL` points it elsewhere.
- **It writes real rows** to whatever it targets. Left behind in the live
  DB: `claude-e2e-vendor@example.com` / `claude-e2e-rider@example.com` (the
  vendor is named "E2E Test Vendor (delete me)", closed; the rider off duty,
  and **owing ₦8,100 in uncollected cash** from three delivered orders — a
  ready-made case for trying the cash-limit gate and remittance), two
  products, three orders sitting in `DELIVERED` (the escrow timer will move
  them to `COMPLETED` on its own, crediting the test vendor). Clean them up
  with the admin suspend screen (`/vendors`, `/riders`) when done testing.
  Their generated passwords live in the
  OS temp dir (`closebuy-e2e-state.json`), never in the repo.

## Known issues / external blockers

Things that are broken or waiting on something outside this codebase —
don't re-diagnose these from scratch, they're understood:

- **Monnify not configured** — no `MONNIFY_API_KEY`/`SECRET_KEY`/
  `CONTRACT_CODE` set on Railway. Real payments don't work; cash-on-delivery
  does. Disbursements (real vendor payouts) additionally need Monnify
  account-side setup: enable API disbursements, disable OTP, whitelist a
  static outbound IP — communicated to Monnify separately, not done yet.
- ~~**SECURITY — `OTP_DEV_FALLBACK=true` on a `NODE_ENV=production` API
  hands out login codes to anyone.**~~ **Fixed 2026-09-29** — see that
  date's section below (`auth/routes.ts` now never returns `devCode` when
  `NODE_ENV === "production"`, regardless of `OTP_DEV_FALLBACK`). Not yet
  deployed — the live Railway API is still running the old code until this
  is pushed, so the hole is still live in production right now. Also still
  true regardless: the demo vendors' phones are sequential dummies
  (`+2348010000001`–`10`, `seed-demo-vendors.mjs`) and are guessable.
- **Termii Sender ID pending CAC approval** — `TERMII_API_KEY` is set,
  `TERMII_SENDER_ID` isn't. Real SMS OTP blocked; worked around via
  `OTP_DEV_FALLBACK` (see the security note above — that workaround is
  also the hole) and the auto-signin allowlist.
- **Netlify — fixed 2026-09-26, and the old diagnosis was wrong.**
  `closebuy-vendor` was serving the *Admin* app (its site-level Package
  Directory pointed at `apps/admin`, and it also carried a build-command
  override filtering on admin), and `closebuy-rider`/`closebuy-admin` had never
  been connected to the repo. All three are now linked with the right
  `package_path` and build fine; `curl` of each `/login` returns its own
  app (CloseBuy Vendor / Rider / Admin) with the live Railway API URL baked in
  (`NEXT_PUBLIC_API_URL` is inlined at build time, so changing it needs a
  rebuild). Earlier notes here said the Netlify API "silently refuses
  build-setting changes for this account" — it doesn't: the Package Directory
  is `build_settings.package_path` and is set through the **`repo` object** of
  `updateSite` (`netlify api updateSite` via the Netlify CLI works). The earlier
  failed attempts most likely wrote to the wrong place, though that wasn't
  isolated. `closebuy1` (customer)
  auto-deploys from `main`.
- **NEW, 2026-09-29 — Netlify account credit usage exceeded, blocking all
  four sites' builds.** The `4f46762` push's Netlify builds all failed
  with `error_message: "Skipped due to account credit usage exceeded"`
  (confirmed per-site via `netlify api getSiteDeploy`, not guessed from
  a curl) — an account-level billing limit, not a code or config problem.
  All four sites are still serving their last successful build (`3b2eafd`,
  2026-09-27), not broken, just behind. **Not fixed here — outside this
  codebase's control.** Needs the owner to either wait for the Netlify
  billing cycle to reset or change plan/add credit; once that clears, a
  re-trigger of the `4f46762` deploy for each of the four sites should
  just work, no code changes expected. Check current state with
  `netlify api listSiteDeploys --data '{"site_id":"<id>"}'` (site IDs:
  `closebuy1` `4b868416-ba99-4157-99e6-bd02a3519358`, `closebuy-vendor`
  `61768505-1bcb-4f4a-994f-1dbbe158c616`, `closebuy-rider`
  `64f362d5-3d5d-439f-9e64-771d3e3c905a`, `closebuy-admin`
  `0ab3fc21-17d3-41f6-8275-9232badf2176`) — a plain `curl` of the site only
  shows what the CDN is currently caching, which after a failed build is
  silently still the old one, not evidence either way about a new push.
- **Google Cloud Billing won't complete for the account owner** — error
  `OR_BACR2_59`, "we were unable to set up your account." This blocks
  `GOOGLE_MAPS_API_KEY`/`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Maps Platform
  requires billing) even though the same card works fine for other Google
  products. Known pattern for Nigerian accounts specifically. Google OAuth
  itself is unaffected (no billing needed) and is fully working.
- **Apple OAuth** — needs a $99/year paid Apple Developer account. Deferred
  by the user's own choice; code is ready (`oauth-routes.ts` is
  provider-agnostic), just needs real credentials in `.env`/Railway.
- **ESET Security (this dev machine)** intermittently blocks local
  connections — Neon Postgres, Redis TLS handshakes, MSI installers all hit
  this at different points. Pattern: TCP connects, then the
  protocol/handshake silently hangs. **Workaround, not fixed:** local API
  dev can't reach the live Neon DB directly — DB operations from this
  machine go through `railway ssh -- sh -c "cd /app/apps/api && node
  --input-type=module -"` (pipe a plain `.mjs` script via stdin — no tsx on
  the container, so no TypeScript) instead of running Prisma locally. All
  four frontend apps' local dev servers point `NEXT_PUBLIC_API_URL` at the
  *live* Railway API for the same reason.
- **Port 3000 sometimes gets reclaimed** by an unrelated sibling project
  ("Bludors Paint") that also runs on this machine, in a separate Claude
  Code session. If `localhost:3000` shows the wrong app, that's why — check
  `netstat -ano | grep :3000`, confirmed OK to stop that process and
  restart the customer app's `pnpm dev` (established with the user).

## Conventions worth knowing before changing things

- **Migrations can't run locally** (see ESET above). Write the migration
  SQL by hand when `prisma migrate dev` can't reach the DB, matching
  Prisma's own generated format exactly, then apply via
  `railway ssh -- sh -c "cd /app/apps/api && npx prisma migrate deploy"`
  once the code (including the migration file) is pushed and deployed.
  Always `npx prisma generate` locally afterward so the TS client matches.
- **Each module owns its own Prisma access, even for tables other modules
  also touch.** `dispatch/service.ts` and `order/service.ts` and
  `admin/orders.ts` all read/write `Order` directly, each with its own
  local `writeTransition`/`notifyCustomer` helper — not shared via
  cross-module imports. This is deliberate (established precedent), not
  duplication to clean up.
- **Identity is unique per role, not globally**, for phone, email, and
  OAuth accounts (`@@unique([x, role])` in schema.prisma, not `@unique`).
  Any new auth-adjacent code must look up by the composite key
  (`email_role`, `phone_role`, `provider_providerAccountId_role`), never by
  the bare field.
- **Admin can never be self-created**, through any of the three auth
  methods. Every path independently enforces "admin must already exist" —
  `findOrCreateStaffUser` (service.ts), `AdminSelfRegistrationDisabledError`
  (email.ts), `OAuthAdminNotProvisionedError` (oauth-account.ts). If you add
  a fourth auth method, it needs the same guard.
- **The ledger is append-only by code discipline, NOT by DB grant —
  despite what this file and `data-model.md` §6 used to claim.** Checked
  against production on 2026-09-26: the app connects as `neondb_owner`,
  the table *owner*, which holds `UPDATE`/`DELETE`/`TRUNCATE` on
  `ledger_entries`, `audit_log`, `order_state_transitions` and `config`.
  `apps/api/prisma/APPEND_ONLY.sql` was never effective — and revoking from
  an owner would be toothless anyway, since it can grant itself back. What
  *is* true: no application code updates or deletes those tables (grepped,
  no raw SQL either), corrections are always a new reversing entry, and
  `Config` writes are always a new version. What's missing is any defence
  against a bug or a leaked credential. **Real fix (not done — it changes
  the DB role setup):** create a separate non-owner role for the app, point
  `DATABASE_URL` at it, keep the owner on `DIRECT_URL` (already what
  `schema.prisma` separates it for, and what migrations use), then run
  `APPEND_ONLY.sql` for that role. Do this before real money moves. The
  same applies to `rider_cash_remittances`, whose REVOKE line is in that
  file but equally inert today. Corrections are always a new reversing
  entry, never an edit.
- **Netlify monorepo config**: "Package Directory" (not "Base Directory")
  with `netlify.toml` living inside that app's own folder
  (`apps/<app>/netlify.toml`, correct build command + `@netlify/plugin-nextjs`)
  — this is the combination that works. Set it in the dashboard, or through
  the API's `repo` object (`build_settings.package_path`); see the Netlify
  note under Known issues. Don't leave a site-level build-command override
  in place — that's what made the vendor site build the admin app.
- **Real content only** — no mocked vendors, no fake payment flows, no
  decorative UI for features without a real backend. When something can't
  be built for real yet (Monnify, Maps, Apple), it's left visibly absent
  or gracefully degraded (buttons that 503 with a clear message, components
  that render nothing), never faked.
- Attribution lines (`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
  on commits, the GitHub-Code line on PRs) — always include per the
  system's own standing instruction, not optional.

## Who's who

Solo developer, first Claude Code session start-to-now spans the whole
build. Git identity: `Giwa-lu`. Riverpark is the real, specific launch
neighborhood (brief §2a) — the actual traced service-area polygon lives in
`prisma/seed.ts`, not a placeholder shape.
