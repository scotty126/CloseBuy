import type { ApiClient } from "./client";
import type {
  RiderApplicationInput,
  SetDutyInput,
  ConfirmCollectionInput,
  ConfirmDeliveryInput,
  DeliveryFailedInput,
  RiderProfileDto,
  RiderJobDto,
  RiderEarningsDto,
  RiderRemittanceDto,
} from "@closebuy/types";

export function createDispatchApi(client: ApiClient) {
  return {
    applyAsRider: (input: RiderApplicationInput) =>
      client.request<{ rider: RiderProfileDto }>("/riders", { method: "POST", body: JSON.stringify(input) }),

    getOwnRider: () => client.request<{ rider: RiderProfileDto }>("/riders/me"),

    setDuty: (input: SetDutyInput) =>
      client.request<{ rider: RiderProfileDto }>("/riders/me/duty", { method: "PATCH", body: JSON.stringify(input) }),

    /** US-R-03 — every currently unclaimed delivery job; no separate "offer" resource, an unclaimed order IS the offer. */
    listOffers: () => client.request<{ offers: RiderJobDto[] }>("/riders/me/offers"),

    acceptOffer: (orderId: string) =>
      client.request<{ order: RiderJobDto }>(`/riders/me/offers/${orderId}/accept`, { method: "POST" }),

    declineOffer: (orderId: string) =>
      client.request<void>(`/riders/me/offers/${orderId}/decline`, { method: "POST" }),

    /** Reconstructs the rider's current job after e.g. a page refresh mid-delivery — null if there isn't one. */
    getActiveJob: () => client.request<{ order: RiderJobDto | null }>("/riders/me/active-job"),

    confirmCollection: (orderId: string, input: ConfirmCollectionInput) =>
      client.request<{ order: RiderJobDto }>(`/orders/${orderId}/confirm-collection`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    confirmDelivery: (orderId: string, input: ConfirmDeliveryInput) =>
      client.request<{ order: RiderJobDto }>(`/orders/${orderId}/confirm-delivery`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    reportDeliveryFailed: (orderId: string, input: DeliveryFailedInput) =>
      client.request<{ order: RiderJobDto }>(`/orders/${orderId}/delivery-failed`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    getEarnings: () => client.request<RiderEarningsDto>("/riders/me/earnings"),

    /** US-R-08 — read-only: an admin records a remittance (adminApi.recordRemittance), a rider never logs their own. */
    listRemittances: () => client.request<{ remittances: RiderRemittanceDto[] }>("/riders/me/remittances"),
  };
}
