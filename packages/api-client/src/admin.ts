import type { ApiClient } from "./client";
import type { ApplicationRejectInput, ApplicationType, PendingApplication } from "@closebuy/types";

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
  };
}
