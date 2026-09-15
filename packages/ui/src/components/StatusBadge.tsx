import type { OrderStatus } from "@closebuy/types";

// Every order status maps to exactly one of the four functional colours
// from the brand guide — never the brand orange, which is reserved for
// customer action, not system state.
const statusStyle: Record<OrderStatus, { label: string; className: string }> = {
  PENDING_PAYMENT: { label: "Awaiting payment", className: "bg-muted/10 text-muted" },
  PAID: { label: "Order placed", className: "bg-warning/10 text-warning" },
  PREPARING: { label: "Preparing", className: "bg-warning/10 text-warning" },
  READY_FOR_PICKUP: { label: "Ready", className: "bg-warning/10 text-warning" },
  RIDER_ASSIGNED: { label: "Rider assigned", className: "bg-warning/10 text-warning" },
  IN_TRANSIT: { label: "On the way", className: "bg-warning/10 text-warning" },
  DELIVERED: { label: "Delivered", className: "bg-success/10 text-success" },
  DELIVERY_FAILED: { label: "Delivery failed", className: "bg-danger/10 text-danger" },
  CANCELLED: { label: "Cancelled", className: "bg-danger/10 text-danger" },
  REFUNDED: { label: "Refunded", className: "bg-danger/10 text-danger" },
  COMPLETED: { label: "Completed", className: "bg-success/10 text-success" },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { label, className } = statusStyle[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
