import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createCustomerAddressService, AddressNotFoundError } from "./addresses.js";

// A 0-10/0-10 square in lat/lng — same shape as lib/geo.test.ts, easiest to
// reason clear-cut inside/outside cases against without real coordinates.
const SERVICE_AREA = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 10 },
  { lat: 10, lng: 10 },
  { lat: 10, lng: 0 },
];

function createFakePrisma() {
  const addresses = new Map<string, any>();
  let nextId = 1;
  const id = () => `addr_${nextId++}`;

  const db: any = {
    address: {
      findMany: async ({ where }: any) =>
        [...addresses.values()].filter((a) => a.customerId === where.customerId).sort((a, b) => a.label.localeCompare(b.label)),
      findUnique: async ({ where }: any) => addresses.get(where.id) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id(), ...data };
        addresses.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const existing = addresses.get(where.id);
        const updated = { ...existing, ...data };
        addresses.set(where.id, updated);
        return updated;
      },
      delete: async ({ where }: any) => {
        addresses.delete(where.id);
      },
    },
    config: {
      findFirst: async ({ where }: any) => (where.key === "service_area_polygon" ? { key: where.key, value: SERVICE_AREA } : null),
    },
    __state: { addresses },
  };
  return db as PrismaClient & { __state: { addresses: Map<string, any> } };
}

const CUSTOMER_A = "customer_a";
const CUSTOMER_B = "customer_b";

const INSIDE = { label: "Home", lat: 5, lng: 5, landmarkDescription: "Blue gate opposite the market", contactPhone: "+2348010000001" };
const OUTSIDE = { label: "Village", lat: 55, lng: 55, landmarkDescription: "Far away", contactPhone: "+2348010000002" };

describe("customer addresses — createAddress (US-C-05)", () => {
  it("computes isWithinServiceArea from the pin at save time", async () => {
    const prisma = createFakePrisma();
    const svc = createCustomerAddressService({ prisma });

    const inside = await svc.createAddress(CUSTOMER_A, INSIDE);
    const outside = await svc.createAddress(CUSTOMER_A, OUTSIDE);

    expect((inside as any).isWithinServiceArea).toBe(true);
    expect((outside as any).isWithinServiceArea).toBe(false);
  });

  it("an out-of-area pin is still saved, just flagged, not rejected — checkout enforces the area rule, not this", async () => {
    const prisma = createFakePrisma();
    const svc = createCustomerAddressService({ prisma });
    await expect(svc.createAddress(CUSTOMER_A, OUTSIDE)).resolves.toBeTruthy();
  });
});

describe("customer addresses — listAddresses", () => {
  it("lists only the requesting customer's own addresses, alphabetically by label", async () => {
    const prisma = createFakePrisma();
    const svc = createCustomerAddressService({ prisma });
    await svc.createAddress(CUSTOMER_A, { ...INSIDE, label: "Office" });
    await svc.createAddress(CUSTOMER_A, { ...INSIDE, label: "Home" });
    await svc.createAddress(CUSTOMER_B, { ...INSIDE, label: "Someone else's" });

    const list = await svc.listAddresses(CUSTOMER_A);
    expect(list.map((a: any) => a.label)).toEqual(["Home", "Office"]);
  });
});

describe("customer addresses — updateAddress", () => {
  it("renames without touching the pin or its service-area flag", async () => {
    const prisma = createFakePrisma();
    const svc = createCustomerAddressService({ prisma });
    const created = await svc.createAddress(CUSTOMER_A, INSIDE);

    const updated = await svc.updateAddress(CUSTOMER_A, (created as any).id, { label: "Home (renamed)" });

    expect((updated as any).label).toBe("Home (renamed)");
    expect((updated as any).lat).toBe(INSIDE.lat);
    expect((updated as any).isWithinServiceArea).toBe(true);
  });

  it("recomputes isWithinServiceArea when the pin moves", async () => {
    const prisma = createFakePrisma();
    const svc = createCustomerAddressService({ prisma });
    const created = await svc.createAddress(CUSTOMER_A, INSIDE);

    const moved = await svc.updateAddress(CUSTOMER_A, (created as any).id, { lat: OUTSIDE.lat, lng: OUTSIDE.lng });

    expect((moved as any).isWithinServiceArea).toBe(false);
  });

  it("refuses to update another customer's address", async () => {
    const prisma = createFakePrisma();
    const svc = createCustomerAddressService({ prisma });
    const created = await svc.createAddress(CUSTOMER_A, INSIDE);

    await expect(svc.updateAddress(CUSTOMER_B, (created as any).id, { label: "Not yours" })).rejects.toThrow(AddressNotFoundError);
  });

  it("throws for a nonexistent address", async () => {
    const svc = createCustomerAddressService({ prisma: createFakePrisma() });
    await expect(svc.updateAddress(CUSTOMER_A, "nope", { label: "x" })).rejects.toThrow(AddressNotFoundError);
  });
});

describe("customer addresses — deleteAddress", () => {
  it("deletes the requesting customer's own address", async () => {
    const prisma = createFakePrisma();
    const svc = createCustomerAddressService({ prisma });
    const created = await svc.createAddress(CUSTOMER_A, INSIDE);

    await svc.deleteAddress(CUSTOMER_A, (created as any).id);

    expect(prisma.__state.addresses.has((created as any).id)).toBe(false);
  });

  it("refuses to delete another customer's address, and leaves it in place", async () => {
    const prisma = createFakePrisma();
    const svc = createCustomerAddressService({ prisma });
    const created = await svc.createAddress(CUSTOMER_A, INSIDE);

    await expect(svc.deleteAddress(CUSTOMER_B, (created as any).id)).rejects.toThrow(AddressNotFoundError);
    expect(prisma.__state.addresses.has((created as any).id)).toBe(true);
  });

  it("throws for a nonexistent address", async () => {
    const svc = createCustomerAddressService({ prisma: createFakePrisma() });
    await expect(svc.deleteAddress(CUSTOMER_A, "nope")).rejects.toThrow(AddressNotFoundError);
  });
});
