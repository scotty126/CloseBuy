-- data-model.md §6, invariant 2: OrderStateTransition and LedgerEntry (and
-- AuditLog, same reasoning) are insert-only at the database grant level,
-- not just by application convention.
--
-- Prisma's schema language has no way to express a REVOKE, so this runs as
-- a one-off manual step after the first `prisma migrate dev` — NOT as a
-- Prisma migration file, since `prisma migrate reset` would otherwise
-- happily regrant these permissions back via the shadow-database diffing
-- process. Re-run this any time the app's DB role changes or the database
-- is rebuilt from scratch.
--
-- Replace closebuy_app with the actual role your DATABASE_URL connects as.
--
-- WARNING (found 2026-09-26): none of this is in effect in production. The
-- app connects as `neondb_owner`, the table OWNER, and REVOKE against an
-- owner achieves nothing — it can simply GRANT the privilege back. These
-- statements only mean something when DATABASE_URL uses a separate,
-- NON-owner role (with DIRECT_URL keeping the owner for migrations). Until
-- that role exists, append-only is enforced by application code alone.

REVOKE UPDATE, DELETE ON order_state_transitions FROM closebuy_app;
REVOKE UPDATE, DELETE ON ledger_entries FROM closebuy_app;
REVOKE UPDATE, DELETE ON audit_log FROM closebuy_app;
-- US-R-08 — a recorded cash remittance is a financial fact, corrected (if
-- ever) by a compensating entry, never edited. Added after the table itself
-- (migration 20260926140000_rider_cash_remittances), so this line has to be
-- re-run by hand against any database that already existed before it.
REVOKE UPDATE, DELETE ON rider_cash_remittances FROM closebuy_app;

-- Config rows are also never overwritten (US-A-02) — new version, not an
-- edit of an old one. UPDATE is revoked; DELETE is allowed only for the
-- narrow admin case of removing a config entry created in error, so it is
-- deliberately left grantable rather than revoked here.
REVOKE UPDATE ON config FROM closebuy_app;
