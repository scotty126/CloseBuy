# NearBuy — User Stories & Acceptance Criteria

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 01 — Requirements

Every story carries acceptance criteria written to be **verifiable**. In stage 05 these become test cases directly; a criterion that cannot be turned into a passing or failing test is badly written and should be rewritten here rather than fudged later.

**Priority key**

| Tag | Meaning |
|---|---|
| **M** | Must — the platform cannot process a single real order without it |
| **S** | Should — required before opening to the public |
| **L** | Later — valuable, deliberately deferred past first launch |

---

## Customer

### US-C-01 — Register and sign in · **M**
As a customer I want to create an account with my phone number so that I can order without a lengthy signup.

- Signup requires phone number and is verified by a one-time code
- An unverified number cannot place an order
- A returning customer signs in with the same number and receives a fresh code
- A code expires after 10 minutes and after a single successful use
- Five failed attempts within 15 minutes locks further attempts for that number

*Phone-first, not email-first: it matches how the target market actually identifies itself, and it is the same identifier used to contact the customer at delivery.*

### US-C-02 — Browse the catalogue · **M**
As a customer I want to browse vendors and products by category so that I can find what I need.

- The landing screen lists active categories
- Selecting a category lists vendors serving the customer's delivery area
- Vendors that are closed or suspended are either hidden or clearly marked unavailable
- Out-of-stock products are visibly marked and cannot be added to the cart

### US-C-03 — Search · **S**
As a customer I want to search across products and vendors so that I can find an item without knowing which vendor stocks it.

- Search matches product names, vendor names and category names
- Results exclude suspended vendors and unavailable products
- An empty result set offers category suggestions rather than a dead end
- Results return within 1 second at launch catalogue size

### US-C-04 — Cart is scoped to one vendor · **M**
As a customer I want a clear, simple cart so that ordering is fast and unambiguous.

- Adding a first item starts a cart scoped to that vendor
- A further item from the **same vendor** always adds cleanly
- Adding an item from a **different vendor** is blocked with a prompt to clear the cart and start over, or keep the existing cart (brief §3.1)
- The cart shows a subtotal and the delivery fee for that one vendor
- The cart survives the customer closing and reopening the app
- The cart is re-validated for price and stock at checkout, and any change is shown before payment

### US-C-05 — Set a delivery address · **M**
As a customer I want to give my location as a map pin and a description so that the rider can actually find me.

- The address captures a coordinate, a free-text landmark description and a contact phone number
- The coordinate may be taken from device location or placed manually on a map
- An address outside the serviced area is rejected at entry, with an explanation
- Saved addresses can be reused, renamed and deleted

### US-C-06 — Checkout and pay · **M**
As a customer I want to pay by card, transfer or cash on delivery so that I can use whichever means I have.

- Checkout shows an itemised total: goods, delivery fee and any discount
- Card and transfer are processed by the payment gateway; card details never reach NearBuy servers
- Cash on delivery is offered only where the vendor permits it
- A successful payment creates the order in `PAID`
- A failed payment leaves the cart intact and states why
- Payment is idempotent — a retried or duplicated gateway callback never charges twice or creates duplicate orders

### US-C-07 — Track order status · **M**
As a customer I want to see what stage my order has reached so that I know it is progressing.

- The order shows its current state and the time it entered that state
- A state change pushes a notification within 5 seconds (NFR-03)
- The screen shows an expected-by window, not a live map (brief §3.5)

### US-C-08 — Cancel an order · **S**
As a customer I want to cancel before the vendor starts work so that I am not charged for something I no longer want.

- Cancellation is self-service while the order is in `PAID`
- Once in `PREPARING` cancellation requires a support request
- A cancelled prepaid order triggers an automatic refund to the original payment method
- Cancelling one order does not affect the customer's other, unrelated orders

### US-C-09 — Order history and reorder · **S**
As a customer I want to see past orders so that I can reorder or check what I spent.

- History is listed newest first with status and total
- Any past order can be reordered, subject to current stock and price
- Each order exposes an itemised receipt

### US-C-10 — Rate vendor and rider · **S**
As a customer I want to rate what I received so that others benefit from my experience.

- Rating is only possible on a `COMPLETED` order
- Vendor and rider are rated separately, 1–5, with optional free text
- One rating per order per party, editable for 24 hours
- Vendor rating is displayed as an average with a count

### US-C-11 — Raise a dispute · **S**
As a customer I want to report a problem with an order so that I can get a refund or replacement.

- A dispute can be opened on any order up to 48 hours after delivery
- Opening a dispute holds any pending escrow release for that order
- The customer can attach photographs
- The customer is notified of the outcome and the reasoning

---

## Vendor

### US-V-01 — Apply to sell · **M**
As a vendor I want to apply to join so that I can start selling.

- The application captures business name, category, contact details, payout bank details, and a pickup address as a pin
- Identity and business registration documents can be uploaded
- The vendor cannot list products or receive orders while the application is pending
- The applicant is notified on approval or rejection, with a reason given on rejection

### US-V-02 — Manage the storefront · **M**
As a vendor I want to control how my store appears and when it is open.

- Store name, description, logo and opening hours are editable
- An open/closed toggle immediately stops new orders without hiding the store
- Closing does not affect orders already in flight

### US-V-03 — Manage products · **M**
As a vendor I want to list and edit products so that customers can buy them.

- A product carries a name, description, price, at least one image, a category and a stock count
- Price is stored in minor units as an integer — never a floating-point number
- A product can be deactivated without being deleted, preserving order history references
- Editing a price never alters the price recorded on existing orders

### US-V-04 — Track inventory · **S**
As a vendor I want stock to decrease as orders come in so that I do not oversell.

- A confirmed order decrements stock for each line item
- Stock reaching zero marks the product unavailable automatically
- A cancelled or rejected order returns its stock
- Stock cannot go negative under concurrent orders

### US-V-05 — Accept or reject an order · **M**
As a vendor I want to accept or reject incoming orders so that I only commit to what I can fulfil.

- A new `PAID` order raises an audible, visible alert in the dashboard
- The vendor accepts, moving it to `PREPARING`, or rejects with a mandatory reason
- No response within a configurable window auto-rejects and refunds the customer in full
- A rejection is recorded against the vendor's reliability metric

### US-V-06 — Mark an order ready · **M**
As a vendor I want to signal that an order is ready so that a rider is dispatched.

- Moving to `READY_FOR_PICKUP` makes the job visible to riders
- The vendor sees which rider has accepted, with their name and phone number
- Handover is confirmed by the rider, not the vendor, and that confirmation moves the order to `IN_TRANSIT`

### US-V-07 — See earnings and payouts · **M**
As a vendor I want to see what I have earned and when I will be paid.

- A running balance separates funds held in escrow from funds cleared for payout
- Each order shows gross value, commission deducted and net payable
- Past payouts are listed with date, amount and reference
- Figures reconcile exactly against admin records — no rounding drift

---

## Rider

### US-R-01 — Apply to ride · **M**
As a rider I want to apply so that I can receive delivery jobs.

- The application captures name, phone, vehicle type, identity document and payout details
- No jobs are offered while the application is pending
- The applicant is notified of the decision, with a reason on rejection

### US-R-02 — Go on or off duty · **M**
As a rider I want to control when I receive jobs so that I am not offered work when unavailable.

- A single toggle sets availability
- Jobs are offered only while on duty
- Going off duty does not release a job already accepted
- The rider is automatically set off duty after a period of inactivity

### US-R-03 — Receive and accept a job · **M**
As a rider I want to see delivery requests and take the ones I want.

- An offer shows pickup location, delivery area, distance and the fee earned
- The offer is accepted or declined within a countdown; no response passes it on
- Accepting assigns the order exclusively — two riders can never hold the same job
- Declining carries no penalty in v1

### US-R-04 — Collect from the vendor · **M**
As a rider I want the pickup details so that I can collect the right order.

- The screen shows vendor name, pin, landmark description and phone number
- A single tap hands off to an external maps app for navigation
- Collection is confirmed by entering a short code shown on the vendor dashboard
- Confirmation moves the order to `IN_TRANSIT` and records the rider's location at that moment

### US-R-05 — Deliver to the customer · **M**
As a rider I want to complete the delivery and prove it happened.

- The screen shows the customer pin, landmark description and phone number
- Proof of delivery is a photograph, a recipient name, or a code given by the customer
- For cash on delivery the exact amount to collect is shown, and collection must be confirmed before the order closes
- Confirming delivery moves the order to `DELIVERED` and records location and timestamp

### US-R-06 — Report a failed delivery · **S**
As a rider I want to report that I could not deliver so that I am not stuck holding goods.

- A failure requires a reason from a fixed list plus optional notes
- The order moves to `DELIVERY_FAILED` and alerts admin
- The rider is instructed whether to return the goods to the vendor
- Any cash already collected is tracked against the rider's ledger

### US-R-07 — See earnings · **M**
As a rider I want to see what I have earned so that I can check I am paid correctly.

- Earnings are listed per completed delivery with date and amount
- Cleared and pending amounts are separated
- Cash collected on delivery is shown as a liability owed back to the platform

### US-R-08 — Remit collected cash · **S**
As a rider I want to hand back cash I collected so that my balance clears.

- The outstanding cash balance is always visible
- Exceeding a configurable float limit stops further cash-on-delivery offers
- A remittance is recorded by admin and immediately reduces the balance
- The rider can see a history of remittances

---

## Superadmin

### US-A-01 — Vet applications · **M**
As an operator I want to review vendor and rider applications so that only legitimate actors join.

- Pending applications are queued with submitted documents visible
- Approval or rejection is one action, with a mandatory reason on rejection
- The decision, the operator and the timestamp are written to the audit log
- Approval immediately grants the relevant surface

### US-A-02 — Configure the platform · **M**
As an operator I want to control categories, commission and fees without a code deploy.

- Categories can be created, renamed and deactivated
- Commission is configurable per category
- Delivery fee rules and the vendor accept-window are configurable
- A configuration change is versioned and never alters orders already placed

### US-A-03 — Oversee and intervene in orders · **M**
As an operator I want to see every order and step in when something stalls.

- All orders are listable and filterable by state, vendor, rider and date
- Any order exposes its full append-only transition history
- An operator can reassign a rider, force-cancel, or force-refund
- Every intervention records operator identity and reason

### US-A-04 — Resolve disputes · **S**
As an operator I want to settle disputes so that customers and vendors are treated fairly.

- Disputes are queued with order history and customer evidence attached
- Resolution options are full refund, partial refund, or reject with reason
- A refund executes against the original payment method and adjusts vendor and rider settlement accordingly
- Both parties are notified of the outcome

### US-A-05 — Run payouts and reconcile · **M**
As an operator I want to release funds and confirm the books balance.

- A payout run lists every vendor and rider with a cleared balance
- Escrow is released only for orders in `COMPLETED` with no open dispute
- The ledger is double-entry and append-only; corrections are made by reversing entries, never by editing
- A reconciliation report compares gateway settlement against internal ledger totals and flags any discrepancy

### US-A-06 — Suspend an actor · **S**
As an operator I want to suspend a vendor or rider so that a bad actor stops trading immediately.

- Suspension takes effect immediately and blocks new orders or job offers
- Orders already in flight are listed so they can be handled deliberately
- Suspension requires a reason and is fully reversible
- The suspended party is notified

### US-A-07 — See platform health · **S**
As an operator I want headline metrics so that I know how the platform is performing.

- Orders per day, gross value, completion rate and average delivery time
- Active vendors and active riders
- Failed and disputed order counts
- Figures are filterable by date range

### US-A-08 — Audit everything sensitive · **M**
As an operator I want an immutable record of consequential actions so that fraud can be traced.

- Every state change, financial movement, configuration change and admin intervention is logged
- Each entry records actor, action, target, timestamp and reason
- The log is append-only and cannot be edited or deleted through any interface
- The log is searchable by actor, target and date range

---

## Coverage check

| Actor | M | S | L | Total |
|---|---|---|---|---|
| Customer | 5 | 6 | 0 | 11 |
| Vendor | 6 | 1 | 0 | 7 |
| Rider | 6 | 2 | 0 | 8 |
| Superadmin | 5 | 3 | 0 | 8 |
| **Total** | **22** | **12** | **0** | **34** |

The 22 **M** stories are the walking skeleton: the smallest set that lets one real customer buy one real item from one real vendor, have a real rider deliver it, and have real money reach the vendor. That set — not any individual app — is the first delivery milestone, and it is sequenced in stage 03.
