import type { ApiClient } from "./client";
import type {
  CheckoutInput,
  CheckoutResponse,
  OrderDto,
  OrderSummaryDto,
  RejectOrderInput,
  ConfirmPickupInput,
  VendorEarningsDto,
} from "@closebuy/types";

export function createOrderApi(client: ApiClient) {
  return {
    /**
     * `idempotencyKey` should be generated once per checkout attempt and
     * reused on retry (api-contracts.md) — the server falls back to a
     * random one if omitted, but that defeats the point of a double-tap
     * "Place order" not creating two orders.
     */
    checkout: (input: CheckoutInput, idempotencyKey: string) =>
      client.request<CheckoutResponse>("/checkout", {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "Idempotency-Key": idempotencyKey },
      }),

    /** US-C-06a — works for both a guest and a signed-in customer; never a phone/email lookup. */
    getOrderByTrackingToken: (trackingToken: string) =>
      client.request<{ order: OrderDto }>(`/orders/track/${trackingToken}`),

    /** US-C-09 — signed-in only. */
    listMyOrders: () => client.request<{ orders: OrderSummaryDto[] }>("/orders"),

    /** US-C-08 — self-service, only while the order is still PAID (server-enforced). */
    cancelOrder: (id: string) => client.request<void>(`/orders/${id}/cancel`, { method: "POST" }),

    // ── Vendor (US-V-05/06/07) ────────────────────────────────────────────

    /** screens-navigation.md §2.1 — the full queue; New/In Progress/Scheduled/History are bucketed client-side from this. */
    listVendorOrders: () => client.request<{ orders: OrderDto[] }>("/vendors/me/orders"),

    getVendorEarnings: () => client.request<VendorEarningsDto>("/vendors/me/earnings"),

    acceptOrder: (id: string) => client.request<void>(`/orders/${id}/accept`, { method: "POST" }),

    rejectOrder: (id: string, input: RejectOrderInput) =>
      client.request<void>(`/orders/${id}/reject`, { method: "POST", body: JSON.stringify(input) }),

    markReady: (id: string) => client.request<void>(`/orders/${id}/ready`, { method: "POST" }),

    confirmPickup: (id: string, input: ConfirmPickupInput) =>
      client.request<void>(`/orders/${id}/confirm-pickup`, { method: "POST", body: JSON.stringify(input) }),
  };
}
