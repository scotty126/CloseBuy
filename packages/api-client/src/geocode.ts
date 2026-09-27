import type { ApiClient } from "./client";
import type { GeocodeResultDto } from "@closebuy/types";

export function createGeocodeApi(client: ApiClient) {
  return {
    search: (q: string) => client.request<{ results: GeocodeResultDto[] }>(`/geocode/search?q=${encodeURIComponent(q)}`),
    reverse: (lat: number, lng: number) => client.request<{ label: string | null }>(`/geocode/reverse?lat=${lat}&lng=${lng}`),
  };
}
