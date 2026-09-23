import type { ApiClient } from "./client";
import type {
  ApplicationRejectInput,
  ApplicationType,
  PendingApplication,
  AdminOrderFilterInput,
  AdminOrderSummaryDto,
  AdminOrderActionInput,
  AuditLogFilterInput,
  AuditLogEntryDto,
} from "@closebuy/types";
import type { OrderDto } from "@closebuy/types";

// Same shape as catalog.ts's toQueryString — kept local rather than
// shared, since ApiClient itself deliberately has no query-string
// awareness (client.ts stays a thin, generic fetch wrapper).
function toQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function createAdminApi(client: ApiClient) {
  return {
    listApplications: () =>
      client.request<{ applications: PendingApplication[] }>("/admin/applications"),

    approveApplication: (type: ApplicationType, id: string) =>
      client.request<{ application: PendingApplication }>(`/admin/applications/${type}/${id}/approve`, {
        method: "POST",
      }),

    rejectApplication: (type: ApplicationType, id: string, input: ApplicationRejectInput) =>
      client.request<{ application: PendingApplication }>(`/admin/applications/${type}/${id}/reject`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    // ── Order oversight (US-A-03) ──────────────────────────────────────

    listOrders: (filter: Partial<AdminOrderFilterInput> = {}) =>
      client.request<{ orders: AdminOrderSummaryDto[]; nextCursor?: string }>(`/admin/orders${toQueryString(filter)}`),

    getOrder: (id: string) => client.request<{ order: OrderDto }>(`/admin/orders/${id}`),

    reassignRider: (id: string, input: AdminOrderActionInput) =>
      client.request<{ order: OrderDto }>(`/admin/orders/${id}/reassign-rider`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    forceCancelOrder: (id: string, input: AdminOrderActionInput) =>
      client.request<{ order: OrderDto }>(`/admin/orders/${id}/force-cancel`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    forceRefundOrder: (id: string, input: AdminOrderActionInput) =>
      client.request<{ order: OrderDto }>(`/admin/orders/${id}/force-refund`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    // ── Audit log (US-A-08) ────────────────────────────────────────────

    searchAuditLog: (filter: Partial<AuditLogFilterInput> = {}) =>
      client.request<{ entries: AuditLogEntryDto[]; nextCursor?: string }>(`/admin/audit-log${toQueryString(filter)}`),
  };
}
