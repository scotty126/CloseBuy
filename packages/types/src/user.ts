import type { UserRole } from "./enums.js";

export interface User {
  id: string;
  phone: string;
  phoneVerifiedAt: string | null; // ISO datetime; null blocks any ordering/selling/riding action
  role: UserRole;
  createdAt: string;
}
