import type { ApiClient } from "./client";
import type {
  ApplicationRejectInput,
  ApplicationType,
  PendingApplication,
  AdminOrderFilterInput,
  AdminOrderSummaryDto,
  AdminOrderActionInput,
  AdminDisputeFilterInput,
  AdminDisputeDto,
  DisputeResolveInput,
  AdminActorActionInput,
  AdminVendorDto,
  AdminRiderDto,
  SuspendVendorResult,
  SuspendRiderResult,
  RecordRemittanceInput,
  AdminMetricsQuery,
  AdminMetricsDto,
  RecordRemittanceResult,
  AdminRemittanceDto,
  ConfigUpdateInput,
  AdminConfigDto,
  CategoryCreateInput,
  CategoryUpdateInput,
  CategoryDto,
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

    // ── Disputes (US-A-04) ─────────────────────────────────────────────

    listDisputes: (filter: Partial<AdminDisputeFilterInput> = {}) =>
      client.request<{ disputes: AdminDisputeDto[]; nextCursor?: string }>(`/admin/disputes${toQueryString(filter)}`),

    getDispute: (id: string) => client.request<{ dispute: AdminDisputeDto }>(`/admin/disputes/${id}`),

    resolveDispute: (id: string, input: DisputeResolveInput) =>
      client.request<{ dispute: AdminDisputeDto }>(`/admin/disputes/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    // ── Suspend an actor (US-A-06) ──────────────────────────────────────

    listVendors: () => client.request<{ vendors: AdminVendorDto[] }>("/admin/vendors"),

    suspendVendor: (id: string, input: AdminActorActionInput) =>
      client.request<SuspendVendorResult>(`/admin/vendors/${id}/suspend`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    unsuspendVendor: (id: string, input: AdminActorActionInput) =>
      client.request<{ vendor: AdminVendorDto }>(`/admin/vendors/${id}/unsuspend`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    listRiders: () => client.request<{ riders: AdminRiderDto[] }>("/admin/riders"),

    suspendRider: (id: string, input: AdminActorActionInput) =>
      client.request<SuspendRiderResult>(`/admin/riders/${id}/suspend`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    unsuspendRider: (id: string, input: AdminActorActionInput) =>
      client.request<{ rider: AdminRiderDto }>(`/admin/riders/${id}/unsuspend`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    // ── Platform health (US-A-07) ───────────────────────────────────────

    getMetrics: (range: AdminMetricsQuery = {}) =>
      client.request<AdminMetricsDto>(`/admin/metrics${toQueryString(range)}`),

    // ── Rider cash remittance (US-R-08) ─────────────────────────────────

    recordRemittance: (riderId: string, input: RecordRemittanceInput) =>
      client.request<RecordRemittanceResult>(`/admin/riders/${riderId}/remittances`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    listRemittances: (riderId: string) =>
      client.request<{ remittances: AdminRemittanceDto[] }>(`/admin/riders/${riderId}/remittances`),

    // ── Config writes (US-A-02) ─────────────────────────────────────────

    getConfig: () => client.request<AdminConfigDto>("/admin/config"),

    updateConfig: (input: ConfigUpdateInput) =>
      client.request<AdminConfigDto>("/admin/config", { method: "PATCH", body: JSON.stringify(input) }),

    createCategory: (input: CategoryCreateInput) =>
      client.request<{ category: CategoryDto }>("/admin/categories", { method: "POST", body: JSON.stringify(input) }),

    updateCategory: (id: string, input: CategoryUpdateInput) =>
      client.request<{ category: CategoryDto }>(`/admin/categories/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

    // ── Audit log (US-A-08) ────────────────────────────────────────────

    searchAuditLog: (filter: Partial<AuditLogFilterInput> = {}) =>
      client.request<{ entries: AuditLogEntryDto[]; nextCursor?: string }>(`/admin/audit-log${toQueryString(filter)}`),
  };
}
