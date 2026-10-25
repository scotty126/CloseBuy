import type { ApiClient } from "./client";
import type { ProductListingDto } from "@closebuy/types";

export function createFavoritesApi(client: ApiClient) {
  return {
    list: () => client.request<{ products: ProductListingDto[] }>("/customer/favorites"),
    add: (productId: string) => client.request<void>(`/customer/favorites/${productId}`, { method: "PUT" }),
    remove: (productId: string) => client.request<void>(`/customer/favorites/${productId}`, { method: "DELETE" }),

    listFollowedVendorIds: () => client.request<{ vendorIds: string[] }>("/customer/follows"),
    followVendor: (vendorId: string) => client.request<void>(`/customer/follows/${vendorId}`, { method: "PUT" }),
    unfollowVendor: (vendorId: string) => client.request<void>(`/customer/follows/${vendorId}`, { method: "DELETE" }),
  };
}
