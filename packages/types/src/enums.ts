// Exactly the states in product-brief.md §4. A pickup order skips
// RIDER_ASSIGNED and IN_TRANSIT entirely (brief §3.1a).
export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PAID",
  "PREPARING",
  "READY_FOR_PICKUP",
  "RIDER_ASSIGNED",
  "IN_TRANSIT",
  "DELIVERED",
  "DELIVERY_FAILED",
  "CANCELLED",
  "REFUNDED",
  "COMPLETED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// brief §3.1a
export const FULFILMENT_TYPES = ["delivery", "pickup"] as const;
export type FulfilmentType = (typeof FULFILMENT_TYPES)[number];

export const PAYMENT_METHODS = ["card", "transfer", "cash_on_delivery"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// ADR-0001: Monnify primary, Paystack documented fallback
export const PAYMENT_GATEWAYS = ["monnify", "paystack", "cash"] as const; // "cash" = cash on delivery, no real gateway involved
export type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number];

export const USER_ROLES = ["customer", "vendor", "rider", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const VENDOR_STATUSES = ["pending", "approved", "suspended", "rejected"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const RIDER_STATUSES = ["pending", "approved", "suspended", "rejected"] as const;
export type RiderStatus = (typeof RIDER_STATUSES)[number];

// data-model.md §4a — per fulfilment type, not per category
export const LEDGER_ACCOUNTS = [
  "platform_clearing", // funds received from Monnify, not yet allocated
  "customer_escrow",
  "vendor_payable",
  "platform_commission",
  "rider_payable",
  "rider_cash_float",
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export const LEDGER_DIRECTIONS = ["debit", "credit"] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

export const DISPUTE_RESOLUTIONS = ["full_refund", "partial_refund", "rejected"] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

export const RATING_TARGET_TYPES = ["vendor", "rider"] as const;
export type RatingTargetType = (typeof RATING_TARGET_TYPES)[number];

export const PAYEE_TYPES = ["vendor", "rider"] as const;
export type PayeeType = (typeof PAYEE_TYPES)[number];

// requested (vendor asked) -> scheduled (admin approved, about to call
// Monnify) -> paid | failed. Or requested -> rejected (admin declined,
// no money ever moved). See apps/api/src/modules/payouts/service.ts.
export const PAYOUT_STATUSES = ["requested", "scheduled", "paid", "failed", "rejected"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

// Notifications (architecture.md's Notifications module) — the fixed set
// of event types Order, Dispatch and Admin actually fire today. A plain
// string on the Notification row itself (schema.prisma), not a DB enum,
// so a new type never needs a migration; this list is the real contract
// clients render against, kept here rather than duplicated per module.
export const NOTIFICATION_TYPES = [
  "vendor_application_approved",
  "vendor_application_rejected",
  "rider_application_approved",
  "rider_application_rejected",
  "order_paid", // → vendor: a new order needs accepting
  "order_accepted", // → customer
  "order_rejected", // → customer, always paired with a refund
  "order_ready_for_pickup", // → customer, both fulfilment types (brief §3.1a)
  "order_rider_assigned", // → customer, delivery only
  "order_in_transit", // → customer, delivery only
  "order_delivered", // → customer
  "order_delivery_failed", // → customer, delivery only
  "order_auto_rejected", // → customer — vendor never responded in the accept window
  "payout_paid", // → vendor
  "payout_failed", // → vendor, Monnify attempt didn't succeed
  "payout_rejected", // → vendor, admin declined before any money moved
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
