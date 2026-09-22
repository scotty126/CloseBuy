import argon2 from "argon2";

/**
 * argon2id — the OWASP-recommended default over bcrypt for new systems
 * (data-model.md §6 invariant 7). The pepper is a server-side secret on
 * top of argon2's own per-hash salt, so a leaked database alone still
 * isn't enough to brute-force offline.
 */
export async function hashPassword(password: string, pepper: string): Promise<string> {
  return argon2.hash(password + pepper);
}

export async function verifyPassword(hash: string, password: string, pepper: string): Promise<boolean> {
  return argon2.verify(hash, password + pepper);
}
