import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { MonnifyClient } from "../payments/monnify.js";
import type { NotificationService } from "../notifications/service.js";
import {
  createPayoutService,
  VendorProfileNotFoundError,
  MissingBankDetailsError,
  InsufficientBalanceError,
  PayoutNotFoundError,
  InvalidPayoutStateError,
} from "./service.js";

function createFakeNotifications(): NotificationService {
  return { notify: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationService;
}

function createFakeMonnify(overrides?: Partial<MonnifyClient>): MonnifyClient {
  return {
    initializeTransaction: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    refund: vi.fn(),
    transfer: vi.fn().mockResolvedValue({ status: "SUCCESS", providerReference: "provider_ref_1" }),
    ...overrides,
  } as unknown as MonnifyClient;
}

let nextPayoutId = 1;

function createFakePrisma() {
  const vendors = new Map<string, any>();
  const orders = new Map<string, { vendorId: string }>();
  const ledgerEntries: Array<{ orderId: string; account: string; direction: "debit" | "credit"; amountMinor: number }> = [];
  const payouts = new Map<string, any>();
  const auditLog: any[] = [];

  function sumLedger(account: string, direction: string, vendorId: string) {
    return ledgerEntries
      .filter((e) => e.account === account && e.direction === direction && orders.get(e.orderId)?.vendorId === vendorId)
      .reduce((s, e) => s + e.amountMinor, 0);
  }

  const db: any = {
    vendorProfile: {
      findUnique: async ({ where }: any) => {
        if (where.id) return vendors.get(where.id) ?? null;
        if (where.userId) return [...vendors.values()].find((v) => v.userId === where.userId) ?? null;
        return null;
      },
      findMany: async ({ where }: any) => [...vendors.values()].filter((v) => where.id.in.includes(v.id)),
    },
    ledgerEntry: {
      aggregate: async ({ where }: any) => ({
        _sum: { amountMinor: sumLedger(where.account, where.direction, where.order.vendorId) },
      }),
    },
    payout: {
      create: async ({ data }: any) => {
        const id = `payout_${nextPayoutId++}`;
        const row = { id, reference: null, failureReason: null, rejectionReason: null, processedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        payouts.set(id, row);
        return row;
      },
      findUnique: async ({ where }: any) => payouts.get(where.id) ?? null,
      findMany: async ({ where }: any) => {
        let rows = [...payouts.values()];
        if (where.payeeType) rows = rows.filter((p) => p.payeeType === where.payeeType);
        if (where.payeeId) rows = rows.filter((p) => p.payeeId === where.payeeId);
        if (where.status) rows = rows.filter((p) => p.status === where.status);
        return rows;
      },
      update: async ({ where, data }: any) => {
        const row = { ...payouts.get(where.id), ...data, updatedAt: new Date() };
        payouts.set(where.id, row);
        return row;
      },
      aggregate: async ({ where }: any) => ({
        _sum: {
          amountMinor: [...payouts.values()]
            .filter((p) => p.payeeType === where.payeeType && p.payeeId === where.payeeId && where.status.in.includes(p.status))
            .reduce((s, p) => s + p.amountMinor, 0),
        },
      }),
    },
    auditLog: {
      create: async ({ data }: any) => {
        auditLog.push(data);
        return { id: `log_${auditLog.length}`, createdAt: new Date(), ...data };
      },
    },
    $transaction: async (fn: any) => fn(db),
    __state: { vendors, orders, ledgerEntries, payouts, auditLog },
  };

  return db as unknown as PrismaClient & { __state: typeof db.__state };
}

const VENDOR_ID = "vendor_1";
const VENDOR_USER_ID = "vendor_user_1";
const ADMIN_USER_ID = "admin_user_1";

function seedVendor(prisma: ReturnType<typeof createFakePrisma>, overrides?: any) {
  prisma.__state.vendors.set(VENDOR_ID, {
    id: VENDOR_ID,
    userId: VENDOR_USER_ID,
    businessName: "Musa's Store",
    bankAccountNumber: "0123456789",
    bankCode: "058",
    bankAccountName: "Musa Ibrahim",
    ...overrides,
  });
}

function seedEarned(prisma: ReturnType<typeof createFakePrisma>, orderId: string, amountMinor: number) {
  prisma.__state.orders.set(orderId, { vendorId: VENDOR_ID });
  prisma.__state.ledgerEntries.push({ orderId, account: "vendor_payable", direction: "credit", amountMinor });
}

describe("payout service — vendor-requested, admin-approved", () => {
  let prisma: ReturnType<typeof createFakePrisma>;
  let monnify: MonnifyClient;
  let notifications: NotificationService;

  beforeEach(() => {
    prisma = createFakePrisma();
    monnify = createFakeMonnify();
    notifications = createFakeNotifications();
  });

  function service() {
    return createPayoutService({ prisma, monnify, notifications });
  }

  describe("requestPayout", () => {
    it("defaults to the full available balance when no amount is given", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);

      const payout = await service().requestPayout(VENDOR_USER_ID);

      expect(payout.status).toBe("requested");
      expect(payout.amountMinor).toBe(5_000_00);
    });

    it("rejects a request exceeding the available balance", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);

      await expect(service().requestPayout(VENDOR_USER_ID, 5_000_01)).rejects.toThrow(InsufficientBalanceError);
    });

    it("rejects a request with zero balance and no amount specified", async () => {
      seedVendor(prisma);

      await expect(service().requestPayout(VENDOR_USER_ID)).rejects.toThrow(InsufficientBalanceError);
    });

    it("throws MissingBankDetailsError when any bank field is absent, and never touches balance/creates a row", async () => {
      seedVendor(prisma, { bankCode: null });
      seedEarned(prisma, "order_1", 5_000_00);

      await expect(service().requestPayout(VENDOR_USER_ID)).rejects.toThrow(MissingBankDetailsError);
      expect(prisma.__state.payouts.size).toBe(0);
    });

    it("throws VendorProfileNotFoundError for an unknown vendor user", async () => {
      await expect(service().requestPayout("no-such-user")).rejects.toThrow(VendorProfileNotFoundError);
    });

    it("writes an audit log with the vendor as actor", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);

      await service().requestPayout(VENDOR_USER_ID);

      expect(prisma.__state.auditLog[0]).toMatchObject({ actorId: VENDOR_USER_ID, action: "vendor_payout_requested" });
    });

    it("a second request is validated against the balance already reduced by the first (in-flight reservation)", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);

      await service().requestPayout(VENDOR_USER_ID, 3_000_00);
      await expect(service().requestPayout(VENDOR_USER_ID, 3_000_00)).rejects.toThrow(InsufficientBalanceError);
    });
  });

  describe("approvePayout", () => {
    it("happy path: Monnify succeeds, payout ends paid with processedAt and reference set", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);
      const requested = await service().requestPayout(VENDOR_USER_ID);

      const result = await service().approvePayout(ADMIN_USER_ID, requested.id);

      expect(result.status).toBe("paid");
      expect(result.processedAt).toBeInstanceOf(Date);
      expect(result.reference).toBe("provider_ref_1");
      expect(monnify.transfer).toHaveBeenCalledOnce();
      expect(monnify.transfer).toHaveBeenCalledWith(
        expect.objectContaining({ amountMinor: 5_000_00, destinationAccountNumber: "0123456789", destinationBankCode: "058" }),
      );
    });

    it("Monnify throwing (network/transport failure) ends the payout failed, never stuck scheduled", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);
      const requested = await service().requestPayout(VENDOR_USER_ID);
      monnify = createFakeMonnify({ transfer: vi.fn().mockRejectedValue(new Error("ECONNRESET")) });

      const result = await createPayoutService({ prisma, monnify, notifications }).approvePayout(ADMIN_USER_ID, requested.id);

      expect(result.status).toBe("failed");
      expect(result.failureReason).toContain("ECONNRESET");
    });

    it("Monnify resolving {status: FAILED} (business-level, HTTP 200) ends the same way", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);
      const requested = await service().requestPayout(VENDOR_USER_ID);
      monnify = createFakeMonnify({ transfer: vi.fn().mockResolvedValue({ status: "FAILED", providerReference: "provider_ref_2" }) });

      const result = await createPayoutService({ prisma, monnify, notifications }).approvePayout(ADMIN_USER_ID, requested.id);

      expect(result.status).toBe("failed");
      expect(result.reference).toBe("provider_ref_2");
    });

    it("refuses to approve a payout that isn't requested anymore", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);
      const requested = await service().requestPayout(VENDOR_USER_ID);
      await service().approvePayout(ADMIN_USER_ID, requested.id);

      await expect(service().approvePayout(ADMIN_USER_ID, requested.id)).rejects.toThrow(InvalidPayoutStateError);
    });

    it("throws PayoutNotFoundError for an unknown id", async () => {
      await expect(service().approvePayout(ADMIN_USER_ID, "nope")).rejects.toThrow(PayoutNotFoundError);
    });

    it("success writes an audit log and notifies the vendor exactly once", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);
      const requested = await service().requestPayout(VENDOR_USER_ID);

      await service().approvePayout(ADMIN_USER_ID, requested.id);

      expect(prisma.__state.auditLog).toContainEqual(
        expect.objectContaining({ actorId: ADMIN_USER_ID, action: "vendor_payout_paid" }),
      );
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(VENDOR_USER_ID, "payout_paid", expect.anything());
    });

    it("failure writes an audit log and notifies the vendor with a reason, not a success", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);
      const requested = await service().requestPayout(VENDOR_USER_ID);
      monnify = createFakeMonnify({ transfer: vi.fn().mockRejectedValue(new Error("timeout")) });

      await createPayoutService({ prisma, monnify, notifications }).approvePayout(ADMIN_USER_ID, requested.id);

      expect(prisma.__state.auditLog).toContainEqual(
        expect.objectContaining({ actorId: ADMIN_USER_ID, action: "vendor_payout_failed" }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(VENDOR_USER_ID, "payout_failed", expect.objectContaining({ reason: expect.stringContaining("timeout") }));
    });
  });

  describe("rejectPayout", () => {
    it("moves a requested payout to rejected, frees the balance, and notifies with the reason", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);
      const requested = await service().requestPayout(VENDOR_USER_ID, 3_000_00);

      const rejected = await service().rejectPayout(ADMIN_USER_ID, requested.id, "Suspicious account details");

      expect(rejected.status).toBe("rejected");
      expect(rejected.rejectionReason).toBe("Suspicious account details");
      expect(notifications.notify).toHaveBeenCalledWith(VENDOR_USER_ID, "payout_rejected", { payoutId: requested.id, reason: "Suspicious account details" });

      const balance = await service().getMyBalance(VENDOR_USER_ID);
      expect(balance.availableToWithdrawMinor).toBe(5_000_00);
    });

    it("refuses to reject a payout that isn't requested anymore", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);
      const requested = await service().requestPayout(VENDOR_USER_ID);
      await service().approvePayout(ADMIN_USER_ID, requested.id);

      await expect(service().rejectPayout(ADMIN_USER_ID, requested.id, "too late")).rejects.toThrow(InvalidPayoutStateError);
    });
  });

  describe("getVendorBalance / getMyBalance consistency", () => {
    it("returns numbers consistent with what requestPayout actually enforces", async () => {
      seedVendor(prisma);
      seedEarned(prisma, "order_1", 5_000_00);
      await service().requestPayout(VENDOR_USER_ID, 2_000_00);

      const byUserId = await service().getMyBalance(VENDOR_USER_ID);
      const byVendorId = await service().getVendorBalance(VENDOR_ID);

      expect(byUserId).toEqual(byVendorId);
      expect(byUserId.availableToWithdrawMinor).toBe(3_000_00);
    });
  });
});
