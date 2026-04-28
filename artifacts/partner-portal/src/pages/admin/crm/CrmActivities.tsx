import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { Badge } from "@/components/ui/Badge";
import { crmFetch, fmtDateTime, type CrmUser } from "./lib";

type Activity = { id: number; type: string; subject: string | null; body: string | null; outcome: string | null; durationMinutes: number | null; contactId: number | null; companyId: number | null; dealId: number | null; ownerUserId: number | null; occurredAt: string };

export default function CrmActivities() {
  const [type, setType] = useState("");
  const [owner, setOwner] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: usersData } = useQuery<{ rows: CrmUser[] }>({
    queryKey: ["crm", "users"],
    queryFn: () => crmFetch("/admin/crm/users"),
  });

  const params = new URLSearchParams({ limit: "200" });
  if (type) params.set("type", type);
  if (owner) params.set("owner", owner);
  if (from) params.set("from", from);
  if (to) {
    // Make `to` inclusive of the selected day.
    const d = new Date(to);
    d.setHours(23, 59, 59, 999);
    params.set("to", d.toISOString());
  }

  const { data, isLoading } = useQuery<{ rows: Activity[] }>({
    queryKey: ["crm", "activities", type, owner, from, to],
    queryFn: () => crmFetch(`/admin/crm/activities?${params.toString()}`),
  });

  const userMap = new Map((usersData?.rows ?? []).map(u => [u.id, u.name]));

  const clearFilters = () => { setType(""); setOwner(""); setFrom(""); setTo(""); };
  const hasFilters = !!(type || owner || from || to);

  return (
    <PortalLayout>
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Activities</h1>
          <p className="text-sm text-muted-foreground">Calls, emails, meetings, notes</p>
        </div>

        <div className="flex flex-wrap items-end gap-2 p-3 border rounded bg-white">
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground mb-1">Type</label>
            <select className="border rounded px-2 py-1.5 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              <option value="note">Notes</option>
              <option value="call">Calls</option>
              <option value="email">Emails</option>
              <option value="meeting">Meetings</option>
              <option value="task">Tasks</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground mb-1">Owner</label>
            <select className="border rounded px-2 py-1.5 text-sm min-w-[160px]" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">All owners</option>
              <option value="me">Me</option>
              <option value="unassigned">Unassigned</option>
              {(usersData?.rows ?? []).map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground mb-1">From</label>
            <input type="date" className="border rounded px-2 py-1.5 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground mb-1">To</label>
            <input type="date" className="border rounded px-2 py-1.5 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-blue-600 hover:underline px-2 py-1.5">Clear filters</button>
          )}
          <div className="ml-auto text-xs text-muted-foreground">{data?.rows.length ?? 0} result{(data?.rows.length ?? 0) === 1 ? "" : "s"}</div>
        </div>

        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        <ul className="space-y-2">
          {data?.rows.map(a => (
            <li key={a.id} className="border rounded p-3 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize text-xs">{a.type}</Badge>
                  {a.subject && <span className="font-medium text-sm">{a.subject}</span>}
                </div>
                <span className="text-xs text-muted-foreground">{fmtDateTime(a.occurredAt)}</span>
              </div>
              {a.body && <div className="text-sm mt-1 text-muted-foreground whitespace-pre-wrap">{a.body}</div>}
              {(a.outcome || a.durationMinutes != null || a.ownerUserId) && (
                <div className="mt-2 flex gap-3 text-xs text-muted-foreground flex-wrap">
                  {a.outcome && <span>Outcome: {a.outcome}</span>}
                  {a.durationMinutes != null && <span>{a.durationMinutes} min</span>}
                  {a.ownerUserId && <span>By {userMap.get(a.ownerUserId) ?? `user #${a.ownerUserId}`}</span>}
                </div>
              )}
            </li>
          ))}
          {!isLoading && (data?.rows.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">No activities match your filters.</div>}
        </ul>
      </div>
    </PortalLayout>
  );
}
