# CloseBuy — Screens & Navigation

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 02 — Design

Every screen below is designed against a specific user story and a specific domain decision already settled in the product brief — nothing here introduces new scope. The DoorDash reference kit supplied earlier is the structural model throughout; departures from it are called out explicitly, with the reason.

## 1. Customer app

### Navigation
**Bottom tabs: Home · Search · Orders · Account** — four, not DoorDash's five. DoorDash's fifth tab is customer self-pickup *discovery* (browsing which restaurants support it); CloseBuy's pickup is a per-vendor choice made on the storefront itself (§1.4), not a separate browsing mode, so it doesn't earn its own tab.

### 1.1 Home
Address/fulfilment bar pinned at top (tap to change address, or switch to "Pickup near me") → search bar → category chips (from admin-configured categories, brief §3.3) → vertical feed of vendor cards.

Vendor card: image, name, category badge, rating, ETA, delivery fee, open/closed state. Directly adopted from the DoorDash reference — this pattern is genuinely well-solved and nothing about our domain changes it.

### 1.2 Search
Search bar + filters (category, rating, delivery fee) + results list mixing vendors and products, matching US-C-03. Adopted from the DoorDash Offers/filter screen, simplified — no "cuisine type" filter (not applicable to a mixed marketplace), category filter instead.

### 1.3 Vendor storefront
Hero image, name/rating/ETA bar, **Delivery / Pickup toggle** (only shown if the vendor has pickup enabled, per US-V-02 — this is the DoorDash per-store toggle pattern, adopted directly), product grid grouped by section. Simple products get a quick "Add" button on the card (matches DoorDash); products with modifiers open the item detail sheet.

### 1.4 Item detail
Bottom sheet, not a page navigation — modifiers/options, quantity stepper, Add to cart. Directly adopted from the DoorDash "Choose Flavors" pattern.

### 1.5 Cart
Line items for **one vendor only** (brief §3.1) — no vendor grouping UI needed, unlike the DoorDash reference which has to solve for multi-vendor carts. Adding an item from a different vendor triggers the "clear cart?" prompt (US-C-04) here, not silently.

Below the line items: **fulfilment selection** (US-C-05a) — Delivery or Pickup (if enabled), then "As soon as possible" or "Schedule for later" with a date/slot picker constrained to the vendor's opening hours. This is the single biggest structural departure from the DoorDash reference: DoorDash handles this as a separate discovery mode; CloseBuy handles it as a step in the existing cart, because our simpler single-vendor cart has room for it there without adding a screen.

### 1.6 Checkout
Delivery address (skipped entirely for pickup) → payment method (card/transfer via Monnify, or cash-on-delivery if delivery + vendor permits, per US-C-06) → itemised total (subtotal, delivery fee — zero for pickup, discount) → fulfilment summary line ("Delivery to [address], arriving ~30 min" or "Pickup from [vendor], today 3:00–3:30pm") → Place Order. Adopted layout from the DoorDash checkout screen; the tip-selector and upsell rails seen in that reference are **not** built here (brief §5, out of scope for v1).

### 1.7 Order tracking
**Status timeline, not a map** — this is the other major, deliberate departure from the reference (brief §3.5). A vertical stepper: Placed → Accepted → Preparing → Ready → [Out for delivery → Delivered] or [Ready for pickup → Collected], with a timestamp per step and an expected-by window. A pickup order shows the collection code prominently instead of a rider card; a delivery order shows the assigned rider's name and phone once assigned (no live position). Also where self-service cancel (US-C-08, while `PAID`), reorder (US-C-09), and report-a-problem (US-C-11, within 48h of delivery, "already disputed"/its resolution shown instead once one exists) all live — one screen, since it already serves both a guest and a signed-in customer identically (US-C-06a). Rating (US-C-10) lives here too once the order is `COMPLETED`: one star-picker + optional comment per party (vendor always, rider only on a delivery order once assigned), pre-filled and editable while inside the original 24h window, read-only stars after. The vendor/store cards (§1.2/§1.4) show the real average with a count, or "New" until a first real rating exists — not `reliabilityScore`, an internal ops metric that was briefly (mis)shown there before real ratings existed.

### 1.8 Orders (history)
List, newest first, status + total per US-C-09. Tapping an order re-opens 1.7 if active, or a read-only receipt if completed — reorder action available on any past order, built on 1.7 rather than here (re-fetches the vendor's live catalogue, drops anything gone inactive or sold out).

### 1.9 Account
Profile, saved addresses (US-C-05), payment methods, order history shortcut, ratings given (US-C-10, once M3 ships).

## 2. Vendor dashboard

### Navigation
Sidebar on desktop, collapsing to a bottom sheet/hamburger on mobile — vendors are assumed to check this from a phone at least as often as a desk (NFR-10 applies here too, this is not an internal tool).

### 2.1 Orders (default landing screen)
Tabbed queue: **New** (awaiting accept/reject, US-V-05, with the audible/visible alert) · **In Progress** (preparing/ready) · **Scheduled** (shown separately per US-V-05, sorted by slot time, not creation time) · **History**. Each card shows fulfilment type plainly — a pickup order's card never shows rider information because there is none.

### 2.2 Products
List with stock/active-state indicators, add/edit form (name, description, price, images, category, stock — US-V-03), deactivate rather than delete.

### 2.3 Store settings
Name, description, logo, opening hours, **open/closed toggle**, **pickup-enabled toggle** (independent of open/closed, per US-V-02).

### 2.4 Earnings & payouts
Running balance (escrow-held vs. cleared), per-order breakdown (gross, commission, net — US-V-07), **founding-vendor countdown banner** while `founding_vendor_commission_waived_until` is in the future ("0% commission until [date]"), payout history.

## 3. Rider app

### Navigation
No persistent tab bar — this app is single-task by design. One primary screen that changes shape based on state, plus a slide-out for Earnings/Profile. Deliberately the leanest of the four surfaces: a rider glancing at this mid-delivery should never have to think about where to tap.

### 3.1 Home / duty
On-duty toggle (US-R-02) front and centre. Off duty: nothing else on screen. On duty, no active job: waiting state. On duty with an offer: a full-screen offer card (pickup location, delivery area or "pickup order — no delivery leg", distance, fee, countdown to respond — US-R-03).

### 3.2 Active job
Single vendor, single pickup (brief §3.1 — no multi-stop checklist; that only returns if the parked hub model ever does, R-08). Pickup step: vendor pin/landmark/phone, tap-to-navigate (external maps app), code entry to confirm collection (US-R-04). Delivery step: customer pin/landmark/phone, tap-to-navigate, proof of delivery (photo/name/code), cash-collection amount shown and confirmed if COD (US-R-05).

### 3.3 Earnings
Per-delivery list, cleared vs. pending, **cash balance owed to the platform** shown prominently — always, including "all clear" at ₦0.00 — with the configured float limit beside it and, once over it, a plain-language notice that cash-on-delivery jobs are paused (US-R-07/US-R-08). Below: the rider's own remittance history. **There is deliberately no "remit" button** — an admin records it (US-R-08), and the balance drops here when they do. The same paused notice appears on the on-duty waiting screen (§3.1), since a rider over the limit would otherwise just see fewer jobs with no explanation.

## 4. Superadmin dashboard

### Navigation
Sidebar, desktop-first — this one genuinely is an internal tool, used only by the platform operator.

### 4.1 Applications
Vendor and rider vetting queue, documents visible inline, approve/reject with mandatory reason on rejection (US-A-01). Approving a vendor during the launch window shows the founding-vendor waiver being applied, not a silent side effect.

### 4.1a Vendors & riders
Not in the original sketch — added because US-A-06 needs somewhere to suspend *from*, and Applications (§4.1) is deliberately pending-only. Every vendor/rider, any status; suspend requires a reason and immediately surfaces that actor's in-flight (non-terminal) orders so the operator handles them deliberately rather than losing track of them — orders are never auto-cancelled by a suspension. Unsuspend reverses it (US-A-06's "fully reversible"). Each approved/suspended rider's card also shows the **cash they owe the platform** with a "Record remittance" action (US-R-08): amount (with a "full balance" shortcut, and the confirm button shows the amount as parsed so a stray zero is visible), optional note, and that rider's recorded history below it. An amount larger than the outstanding balance is refused.

### 4.2 Orders
Full list, filterable by state/vendor/rider/date/fulfilment type, drill into any order's complete append-only transition history (US-A-03).

### 4.3 Disputes
Queue with order history and customer evidence attached, resolution actions (full refund / partial refund / reject) (US-A-04).

### 4.4 Configuration
Categories, **pickup and delivery commission rates** (brief §3.2a — not per-category), **Founding Vendor Program** toggle and waiver duration, delivery fee rules, vendor accept-window (US-A-02). Only the fields actually changed are sent on save — each becomes its own new versioned `Config` row, never an edit of the old one.

### 4.5 Payouts & reconciliation
Payout run screen, ledger-vs-gateway-settlement reconciliation report (US-A-05) — note this may need to run against Monnify's multi-daily settlement cadence rather than once per day, per the open verification item in ADR-0001.

### 4.6 Metrics
Orders/day, GMV, completion rate, average delivery time, active vendors/riders, failed/disputed counts, filterable by date range (US-A-07).

### 4.7 Audit log
Searchable, read-only, by actor/target/date (US-A-08).

## 5. What's adopted vs. departed from the DoorDash reference — summary

| Pattern | Adopted as-is | Adapted | Dropped |
|---|---|---|---|
| Bottom-sheet item customization | ✓ | | |
| Store card (image/rating/ETA/fee) | ✓ | | |
| Checkout itemised breakdown | ✓ | | |
| Per-store Delivery/Pickup toggle | | ✓ — drives fulfilment choice directly, no separate discovery mode | |
| 5-tab nav incl. Pickup discovery | | | ✓ — 4 tabs; pickup is per-vendor, not a browse mode |
| Live map order tracking | | | ✓ — status timeline instead (brief §3.5) |
| DashPass-style subscription banner | | | ✓ — out of scope (brief §5) |
| Checkout tip selector / upsell rails | | | ✓ — out of scope for v1, easy fast-follow |
| Multi-vendor cart grouping UI | | | ✓ — not needed; cart is single-vendor (brief §3.1) |
