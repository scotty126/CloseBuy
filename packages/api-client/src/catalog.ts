import type { ApiClient } from "./client";
import type {
  CategoryDto,
  VendorDto,
  ProductDto,
  VendorSearchQuery,
  VendorApplicationInput,
  VendorUpdateInput,
  OwnVendorProfileDto,
  ProductCreateInput,
  ProductUpdateInput,
} from "@closebuy/types";

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

    // ── Vendor self-service (US-V-01/02/03) ──────────────────────────────

    applyAsVendor: (input: VendorApplicationInput) =>
      client.request<{ vendor: OwnVendorProfileDto }>("/vendors", { method: "POST", body: JSON.stringify(input) }),

    getOwnVendor: () => client.request<{ vendor: OwnVendorProfileDto }>("/vendors/me"),

    updateOwnVendor: (input: VendorUpdateInput) =>
      client.request<{ vendor: OwnVendorProfileDto }>("/vendors/me", { method: "PATCH", body: JSON.stringify(input) }),

    getOwnVendorProducts: () => client.request<{ products: ProductDto[] }>("/vendors/me/products"),

    createProduct: (input: ProductCreateInput) =>
      client.request<{ product: ProductDto }>("/vendors/me/products", { method: "POST", body: JSON.stringify(input) }),

    updateProduct: (id: string, input: ProductUpdateInput) =>
      client.request<{ product: ProductDto }>(`/vendors/me/products/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

    deactivateProduct: (id: string) =>
      client.request<void>(`/vendors/me/products/${id}`, { method: "DELETE" }),
  };
}
