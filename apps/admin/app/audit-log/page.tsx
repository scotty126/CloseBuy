"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Input, useAuthSession } from "@closebuy/ui";
import { ApiClientError } from "@closebuy/api-client";
import type { AuditLogEntryDto } from "@closebuy/types";
import { adminApi } from "@/lib/api";

/** screens-navigation.md §4.7 — US-A-08. Searchable, read-only, by actor/target/date. */
export default function AuditLogPage() {
  const router = useRouter();
  const { session, isLoaded } = useAuthSession();

  const [entries, setEntries] = useState<AuditLogEntryDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [actorId, setActorId] = useState("");
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");

  useEffect(() => {
    if (isLoaded && !session) router.push("/login");
  }, [isLoaded, session, router]);

  function search() {
    setEntries(null);
    setLoadError(null);
    adminApi
      .searchAuditLog({ actorId: actorId.trim() || undefined, targetType: targetType.trim() || undefined, targetId: targetId.trim() || undefined })
      .then((res) => {
        setEntries(res.entries);
        setNextCursor(res.nextCursor);
      })
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load the audit log."));
  }

  useEffect(() => {
    if (!session) return;
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function loadMore() {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const res = await adminApi.searchAuditLog({
        actorId: actorId.trim() || undefined,
        targetType: targetType.trim() || undefined,
        targetId: targetId.trim() || undefined,
        cursor: nextCursor,
      });
      setEntries((prev) => [...(prev ?? []), ...res.entries]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setLoadError(err instanceof ApiClientError ? err.message : "Couldn't load more entries.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  if (!isLoaded || !session) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Audit log</h1>
        <p className="text-sm text-muted">Every consequential action, append-only — who did what, to what, and why (US-A-08).</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <Input label="Actor ID" value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="user uuid" />
        <Input label="Target type" value={targetType} onChange={(e) => setTargetType(e.target.value)} placeholder="e.g. order, vendor_profile, payout" />
        <Input label="Target ID" value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="target uuid" />
        <button type="submit" className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white">
          Search
        </button>
      </form>

      {loadError && <p className="text-sm text-danger">{loadError}</p>}

      {entries === null && !loadError ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries && entries.length === 0 ? (
        <Card><p className="text-sm text-muted">No entries match this filter.</p></Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-surface text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Target</th>
                <th className="px-4 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {entries?.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-100 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 text-muted">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-ink">{entry.actorId ?? "system"}</td>
                  <td className="px-4 py-2 text-ink">{entry.action}</td>
                  <td className="px-4 py-2 text-muted">{entry.targetType}:{entry.targetId.slice(0, 8)}</td>
                  <td className="px-4 py-2 text-muted">{entry.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={isLoadingMore}
          className="self-start text-sm font-medium text-primary underline disabled:opacity-50"
        >
          {isLoadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
