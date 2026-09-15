import { z } from "zod";
import type { NotificationType } from "./enums.js";

// The shape the Push API's PushSubscription.toJSON() produces in every
// browser — accepted as-is rather than reshaped, so a client can forward
// its subscribe() result straight through with no mapping step.
export const pushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

// ── Response shape ──────────────────────────────────────────────────────
// Hand-written wire contract, not re-exported from Prisma — see admin.ts
// for why (Date becomes string once it round-trips through JSON).
export interface NotificationDto {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  sentAt: string;
  readAt: string | null;
}
