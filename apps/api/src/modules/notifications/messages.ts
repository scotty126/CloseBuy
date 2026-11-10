import type { NotificationType } from "@closebuy/types";

/**
 * What a notification says when it leaves the app — the text of a push
 * banner or an email. The in-app feed renders its own per-role labels
 * client-side; this is the server's copy, used by the two channels the
 * client isn't around to render for (a locked phone, an inbox).
 *
 * Deliberately never interpolates `payload`: it carries raw ids and, for a
 * dispute or payout, free text written by someone else. A banner shows
 * exactly these static strings and nothing else.
 */
export interface NotificationMessage {
  title: string;
  body: string;
}

const MESSAGES: Record<NotificationType, NotificationMessage> = {
  vendor_application_approved: { title: "You're approved", body: "Your CloseBuy shop is approved. Open the vendor app to start selling." },
  vendor_application_rejected: { title: "Application not approved", body: "Open the vendor app to see why and what to do next." },
  rider_application_approved: { title: "You're approved", body: "You can now go on duty and take deliveries." },
  rider_application_rejected: { title: "Application not approved", body: "Open the rider app to see why and what to do next." },
  order_paid: { title: "New order", body: "A customer just placed an order. Accept it before the timer runs out." },
  order_accepted: { title: "Order accepted", body: "The shop is packing your order." },
  order_rejected: { title: "Order declined", body: "The shop couldn't take this one. You have been refunded in full." },
  order_ready_for_pickup: { title: "Your order is ready", body: "It is packed and waiting." },
  order_rider_assigned: { title: "Rider assigned", body: "A rider is on the way to the shop." },
  order_in_transit: { title: "On the way", body: "Your order has left the shop." },
  order_delivered: { title: "Delivered", body: "Your order has arrived. Enjoy!" },
  order_delivery_failed: { title: "Delivery couldn't be completed", body: "We are sorting it out with the shop." },
  order_auto_rejected: { title: "Order cancelled", body: "The shop didn't respond in time. You have not been charged." },
  order_payment_expired: { title: "Payment not completed", body: "The order was cancelled and nothing was charged." },
  payout_paid: { title: "Payout sent", body: "Your payout has been sent to your bank account." },
  payout_failed: { title: "Payout failed", body: "We couldn't complete your payout. Open Earnings for details." },
  payout_rejected: { title: "Payout request declined", body: "Open Earnings to see why." },
  order_reassigned: { title: "Job reassigned", body: "CloseBuy support moved a delivery off you." },
  order_force_cancelled: { title: "Order cancelled by support", body: "CloseBuy support cancelled an order. Any payment is being refunded." },
  order_force_refunded: { title: "Refund issued", body: "CloseBuy support refunded an order. The money is on its way back." },
  dispute_resolved: { title: "Reported problem resolved", body: "Open the app to see the outcome." },
  vendor_suspended: { title: "Account suspended", body: "Your shop has been suspended. Contact CloseBuy support." },
  vendor_unsuspended: { title: "Account reinstated", body: "Your shop is active again." },
  rider_suspended: { title: "Account suspended", body: "Your rider account has been suspended. Contact CloseBuy support." },
  rider_unsuspended: { title: "Account reinstated", body: "You can take deliveries again." },
  rider_cash_remitted: { title: "Cash handback recorded", body: "Your cash balance has been reduced." },
};

export function describeNotification(type: NotificationType): NotificationMessage {
  return MESSAGES[type] ?? { title: "CloseBuy update", body: "You have a new update." };
}

/**
 * Types worth an email as well as a push. Email is for things someone
 * should have a record of, or would miss if their phone was off — not for
 * every step of a delivery (rider assigned, in transit, ready: push and
 * the live tracking page cover those, and an inbox full of them just
 * trains people to ignore the one that matters).
 */
const EMAIL_TYPES = new Set<NotificationType>([
  "vendor_application_approved",
  "vendor_application_rejected",
  "rider_application_approved",
  "rider_application_rejected",
  "order_paid",
  "order_accepted",
  "order_rejected",
  "order_delivered",
  "order_delivery_failed",
  "order_auto_rejected",
  "order_payment_expired",
  "payout_paid",
  "payout_failed",
  "payout_rejected",
  "order_force_cancelled",
  "order_force_refunded",
  "dispute_resolved",
  "vendor_suspended",
  "vendor_unsuspended",
  "rider_suspended",
  "rider_unsuspended",
]);

export function isEmailWorthy(type: NotificationType): boolean {
  return EMAIL_TYPES.has(type);
}
