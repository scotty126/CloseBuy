-- Relax `email` from a globally-unique identity to unique per (email,
-- role), same treatment `phone` already got in 20260922140800 — the same
-- real email address can now be a customer account AND a vendor account
-- AND a rider account AND an admin account (distinct rows), rather than
-- exactly one account platform-wide.
DROP INDEX "users_email_key";

CREATE UNIQUE INDEX "users_email_role_key" ON "users"("email", "role");

-- Add `role` to oauth_accounts, denormalized from the linked user — never
-- changes independently, since a User's role is fixed for its lifetime.
-- Backfill from the joined user before making it NOT NULL, so this is
-- safe even with existing rows.
ALTER TABLE "oauth_accounts" ADD COLUMN "role" "UserRole";

UPDATE "oauth_accounts" oa
SET "role" = u."role"
FROM "users" u
WHERE u."id" = oa."userId";

ALTER TABLE "oauth_accounts" ALTER COLUMN "role" SET NOT NULL;

-- Relax provider+providerAccountId from globally-unique to unique per
-- (provider, providerAccountId, role) — the same physical Google/Apple
-- account can now link to a customer row AND a vendor row AND a rider
-- row AND an admin row at once, mirroring email/phone above.
DROP INDEX "oauth_accounts_provider_providerAccountId_key";

CREATE UNIQUE INDEX "oauth_accounts_provider_providerAccountId_role_key" ON "oauth_accounts"("provider", "providerAccountId", "role");
