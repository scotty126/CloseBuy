import type { OrderStatus } from "@closebuy/types";

// Every order status maps to exactly one of the four functional colours
// from the brand guide — never the brand orange, which is reserved for
// customer action, not system state.
const statusStyle: Record<OrderStatus, { label: string; className: string; dot: string }> = {
  PENDING_PAYMENT: { label: "Awaiting payment", className: "bg-muted/10 text-muted ring-muted/15", dot: "bg-muted" },
  PAID: { label: "Order placed", className: "bg-warning/10 text-warning ring-warning/15", dot: "bg-warning" },
  PREPARING: { label: "Preparing", className: "bg-warning/10 text-warning ring-warning/15", dot: "bg-warning" },
  READY_FOR_PICKUP: { label: "Ready", className: "bg-warning/10 text-warning ring-warning/15", dot: "bg-warning" },
  RIDER_ASSIGNED: { label: "Rider assigned", className: "bg-warning/10 text-warning ring-warning/15", dot: "bg-warning" },
  IN_TRANSIT: { label: "On the way", className: "bg-warning/10 text-warning ring-warning/15", dot: "bg-warning" },
  DELIVERED: { label: "Delivered", className: "bg-success/10 text-success ring-success/15", dot: "bg-success" },
  DELIVERY_FAILED: { label: "Delivery failed", className: "bg-danger/10 text-danger ring-danger/15", dot: "bg-danger" },
  CANCELLED: { label: "Cancelled", className: "bg-danger/10 text-danger ring-danger/15", dot: "bg-danger" },
  REFUNDED: { label: "Refunded", className: "bg-danger/10 text-danger ring-danger/15", dot: "bg-danger" },
  COMPLETED: { label: "Completed", className: "bg-success/10 text-success ring-success/15", dot: "bg-success" },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { label, className, dot } = statusStyle[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
