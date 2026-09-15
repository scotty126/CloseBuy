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
