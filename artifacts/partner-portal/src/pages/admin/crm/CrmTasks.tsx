import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Check, Clock } from "lucide-react";
import { crmFetch, fmtDateTime } from "./lib";
import { SavedViewsBar } from "./SavedViewsBar";

type Task = { id: number; title: string; description: string | null; dueAt: string | null; priority: string; status: string; ownerName: string | null; contactId: number | null; contactName: string | null; companyId: number | null; companyName: string | null };

export default function CrmTasks() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [status, setStatus] = useState("open");
  const [showNew, setShowNew] = useState(false);
  const { data, isLoading } = useQuery<{ rows: Task[] }>({
    queryKey: ["crm", "tasks", scope, status],
    queryFn: () => crmFetch(`/admin/crm/tasks?scope=${scope}&status=${status}`),
  });

  const markDone = useMutation({
    mutationFn: (id: number) => crmFetch(`/admin/crm/tasks/${id}/done`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "tasks"] }),
  });
  const snooze = useMutation({
    mutationFn: (id: number) => crmFetch(`/admin/crm/tasks/${id}/snooze`, { method: "POST", body: JSON.stringify({ days: 1 }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "tasks"] }),
  });

  return (
    <PortalLayout>
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Tasks</h1>
            <p className="text-sm text-muted-foreground">Reminders and follow-ups</p>
          </div>
          <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1.5" /> New Task</Button>
        </div>
        <div className="flex gap-2 items-center">
          <select value={scope} onChange={(e) => setScope(e.target.value as "mine" | "all")} className="border rounded px-2 py-1.5 text-sm">
            <option value="mine">Mine</option><option value="all">Team / All</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
            <option value="open">Open</option><option value="done">Done</option><option value="snoozed">Snoozed</option><option value="all">All</option>
          </select>
        </div>

        <SavedViewsBar
          entity="task"
          current={{ scope, status }}
          onApply={(f) => {
            if (f.scope === "mine" || f.scope === "all") setScope(f.scope);
            if (typeof f.status === "string") setStatus(f.status);
          }}
        />

        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        <ul className="space-y-2">
          {data?.rows.map(t => {
            const overdue = t.status === "open" && t.dueAt && new Date(t.dueAt) < new Date();
            return (
              <li key={t.id} className={`border rounded p-3 bg-white ${overdue ? "border-red-300 bg-red-50/40" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{t.title}</span>
                      <Badge variant="outline" className="text-xs capitalize">{t.priority}</Badge>
                      {overdue && <Badge variant="destructive" className="text-xs">Overdue</Badge>}
                      {t.status !== "open" && <Badge variant="secondary" className="text-xs capitalize">{t.status}</Badge>}
                    </div>
                    {t.description && <div className="text-sm text-muted-foreground mt-0.5">{t.description}</div>}
                    <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                      {t.dueAt && <span>Due {fmtDateTime(t.dueAt)}</span>}
                      {t.ownerName && <span>Owner: {t.ownerName}</span>}
                      {t.contactId && <Link href={`/admin/crm/contacts/${t.contactId}`}><span className="text-blue-600 hover:underline cursor-pointer">{t.contactName}</span></Link>}
                      {t.companyId && <Link href={`/admin/crm/companies/${t.companyId}`}><span className="text-blue-600 hover:underline cursor-pointer">{t.companyName}</span></Link>}
                    </div>
                  </div>
                  {t.status === "open" && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => snooze.mutate(t.id)}><Clock className="w-3.5 h-3.5 mr-1" />Snooze</Button>
                      <Button size="sm" onClick={() => markDone.mutate(t.id)}><Check className="w-3.5 h-3.5 mr-1" />Done</Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {!isLoading && (data?.rows.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">No tasks.</div>}
        </ul>

        <NewTaskDialog open={showNew} onOpenChange={setShowNew} onCreated={() => qc.invalidateQueries({ queryKey: ["crm", "tasks"] })} />
      </div>
    </PortalLayout>
  );
}

function NewTaskDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: "", description: "", dueAt: "", priority: "medium" });
  const mut = useMutation({
    mutationFn: () => crmFetch("/admin/crm/tasks", {
      method: "POST",
      body: JSON.stringify({ ...form, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null }),
    }),
    onSuccess: () => { onCreated(); onOpenChange(false); setForm({ title: "", description: "", dueAt: "", priority: "medium" }); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Task</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className="w-full border rounded p-2 text-sm" rows={3} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
            <select className="border rounded px-2 py-1.5 text-sm" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!form.title || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
