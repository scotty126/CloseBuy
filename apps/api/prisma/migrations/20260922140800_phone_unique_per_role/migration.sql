-- Relax `phone` from a globally-unique identity to unique per (phone, role)
-- — the same phone number can now be a vendor account AND a rider account
-- AND an admin account (three distinct rows), rather than exactly one
-- account platform-wide. See schema.prisma's User model comment.
DROP INDEX "users_phone_key";

CREATE UNIQUE INDEX "users_phone_role_key" ON "users"("phone", "role");
