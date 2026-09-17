import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

const QUEUE_NAME = "order-timers";

type JobName = "auto-reject" | "release-escrow";
interface JobData {
  orderId: string;
}

/**
 * BullMQ needs its own Redis connection, separate from the one used for
 * rate limiting/OTP/session state elsewhere (redis.ts) — a Worker
 * specifically requires `maxRetriesPerRequest: null`, which would be the
 * wrong setting for everything else sharing that connection.
 */
function createBullConnection(redisUrl: string): ConnectionOptions {
  return new Redis(redisUrl, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions;
}

export interface OrderQueue {
  /** US-V-05 — fires if the vendor never responds to a PAID order. */
  scheduleAutoReject(orderId: string, delayMinutes: number): Promise<void>;
  /** brief §4 / US-C-11 — fires if no dispute is opened within the window after delivery. */
  scheduleEscrowRelease(orderId: string, delayHours: number): Promise<void>;
  /** Cancelled when the vendor responds/a dispute is opened before the timer fires — the job would otherwise still run and no-op harmlessly, but cancelling is cleaner and cheaper. */
  cancelAutoReject(orderId: string): Promise<void>;
  cancelEscrowRelease(orderId: string): Promise<void>;
  close(): Promise<void>;
}

export function createOrderQueue(redisUrl: string): OrderQueue {
  const queue = new Queue<JobData, void, JobName>(QUEUE_NAME, { connection: createBullConnection(redisUrl) });

  const jobId = (name: JobName, orderId: string) => `${name}:${orderId}`;

  return {
    async scheduleAutoReject(orderId, delayMinutes) {
      await queue.add("auto-reject", { orderId }, { delay: delayMinutes * 60_000, jobId: jobId("auto-reject", orderId) });
    },
    async scheduleEscrowRelease(orderId, delayHours) {
      await queue.add("release-escrow", { orderId }, { delay: delayHours * 60 * 60_000, jobId: jobId("release-escrow", orderId) });
    },
    async cancelAutoReject(orderId) {
      const job = await queue.getJob(jobId("auto-reject", orderId));
      await job?.remove();
    },
    async cancelEscrowRelease(orderId) {
      const job = await queue.getJob(jobId("release-escrow", orderId));
      await job?.remove();
    },
    async close() {
      await queue.close();
    },
  };
}

/**
 * The accept-window/escrow-release timers are a safety net, not the
 * primary action — scheduling one must never fail or hang the checkout /
 * pickup-confirmation / delivery-confirmation request it's called from.
 * The BullMQ producer connection above retries indefinitely on a dropped
 * connection rather than rejecting (maxRetriesPerRequest: null), so this
 * also bounds how long we wait before giving up and logging instead of
 * hanging forever. The order is still correctly PAID/DELIVERED either
 * way — only the automatic follow-up job would be missing, same
 * non-gating guarantee as notifications.notify.
 */
export async function scheduleTimer(label: string, orderId: string, schedule: () => Promise<void>) {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out after 5s")), 5000));
  try {
    await Promise.race([schedule(), timeout]);
  } catch (err) {
    console.error(`Failed to schedule ${label} for order ${orderId}:`, err);
  }
}

export interface OrderTimerHandlers {
  onAutoReject(orderId: string): Promise<void>;
  onEscrowRelease(orderId: string): Promise<void>;
}

/**
 * Started once at app boot (app.ts), wired to the real order service's
 * methods — kept as plain callback injection rather than importing
 * service.ts directly here, so this file and service.ts don't import each
 * other (service.ts imports `createOrderQueue` from here; only app.ts
 * imports both and connects them).
 */
export function startOrderWorker(redisUrl: string, handlers: OrderTimerHandlers): Worker<JobData, void, JobName> {
  return new Worker<JobData, void, JobName>(
    QUEUE_NAME,
    async (job) => {
      if (job.name === "auto-reject") await handlers.onAutoReject(job.data.orderId);
      if (job.name === "release-escrow") await handlers.onEscrowRelease(job.data.orderId);
    },
    { connection: createBullConnection(redisUrl) },
  );
}
