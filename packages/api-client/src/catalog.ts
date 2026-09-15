import type { ApiClient } from "./client";
import type { CategoryDto, VendorDto, ProductDto, VendorSearchQuery } from "@closebuy/types";

function toQueryString(query: Partial<VendorSearchQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function createCatalogApi(client: ApiClient) {
  return {
    listCategories: () => client.request<{ categories: CategoryDto[] }>("/categories"),

    searchVendors: (query: Partial<VendorSearchQuery> = {}) =>
      client.request<{ vendors: VendorDto[]; nextCursor?: string }>(`/vendors${toQueryString(query)}`),

    getVendor: (id: string) => client.request<{ vendor: VendorDto }>(`/vendors/${id}`),

    getVendorProducts: (id: string) => client.request<{ products: ProductDto[] }>(`/vendors/${id}/products`),

    getDeliveryFee: () => client.request<{ feeMinor: number }>("/delivery-fee"),
  };
}
