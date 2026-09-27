import type { PrismaClient } from "@prisma/client";
import type { AddressCreateInput, AddressUpdateInput } from "@closebuy/types";
import { isWithinServiceArea } from "../../../lib/geo.js";

/**
 * US-C-05's "saved addresses can be reused, renamed and deleted" half — the
 * `addresses` table and `Order.addressId` have existed since the very first
 * migration (data-model.md §"Address"), but nothing ever exposed CRUD for
 * it; the account page carried a Placeholder in its place. Own module, same
 * precedent as ../../admin/remittances.js.
 */

export class AddressNotFoundError extends Error {
  constructor() {
    super("Address not found.");
  }
}

export interface CustomerAddressServiceDeps {
  prisma: PrismaClient;
}

export function createCustomerAddressService({ prisma }: CustomerAddressServiceDeps) {
  return {
    /** Newest last, alphabetical — there's no "primary" address concept, so label order is the least arbitrary one. */
    async listAddresses(customerId: string) {
      return prisma.address.findMany({ where: { customerId }, orderBy: { label: "asc" } });
    },

    async createAddress(customerId: string, input: AddressCreateInput) {
      return prisma.address.create({
        data: { customerId, ...input, isWithinServiceArea: await isWithinServiceArea(prisma, input.lat, input.lng) },
      });
    },

    /**
     * Only the fields actually given are touched; the service-area flag is
     * only recomputed when the pin itself moves, not on a label-only rename.
     */
    async updateAddress(customerId: string, addressId: string, input: AddressUpdateInput) {
      const existing = await prisma.address.findUnique({ where: { id: addressId } });
      if (!existing || existing.customerId !== customerId) throw new AddressNotFoundError();

      const movedPin = input.lat !== undefined || input.lng !== undefined;
      return prisma.address.update({
        where: { id: addressId },
        data: {
          ...input,
          ...(movedPin
            ? { isWithinServiceArea: await isWithinServiceArea(prisma, input.lat ?? existing.lat, input.lng ?? existing.lng) }
            : {}),
        },
      });
    },

    /**
     * `Order.addressId` is `ON DELETE SET NULL` — a deleted address never
     * touches an order already placed against it (that order already has
     * its own copied deliveryLat/deliveryLng/deliveryLandmark regardless).
     */
    async deleteAddress(customerId: string, addressId: string) {
      const existing = await prisma.address.findUnique({ where: { id: addressId } });
      if (!existing || existing.customerId !== customerId) throw new AddressNotFoundError();
      await prisma.address.delete({ where: { id: addressId } });
    },
  };
}

export type CustomerAddressService = ReturnType<typeof createCustomerAddressService>;
