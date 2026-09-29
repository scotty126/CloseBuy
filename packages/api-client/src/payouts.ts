import type { ApiClient } from "./client";
import type { PayoutDto, PayoutRequestInput } from "@closebuy/types";

/** Vendor-facing half of "vendor-requested, admin-approved payouts" — the admin approve/reject side lives in admin.ts. */
export function createPayoutsApi(client: ApiClient) {
  return {
    listMyPayouts: () => client.request<{ payouts: PayoutDto[] }>("/vendors/me/payouts"),

    requestPayout: (input: PayoutRequestInput = {}) =>
      client.request<{ payout: PayoutDto }>("/vendors/me/payouts/request", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };
}
