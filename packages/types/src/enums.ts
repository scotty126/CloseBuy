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
