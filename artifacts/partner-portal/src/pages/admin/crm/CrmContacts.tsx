import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Download, Upload, RefreshCw, ArrowUp, ArrowDown } from "lucide-react";
import { crmFetch, downloadCsv, fmtDate, type CrmUser } from "./lib";
import { SavedViewsBar } from "./SavedViewsBar";
import { CsvImportWizard, CONTACT_FIELD_OPTIONS, autoDetectContact } from "./CsvImportWizard";

type Contact = {
  id: number; fullName: string; email: string | null; phone: string | null;
  title: string | null; companyName: string | null; companyId: number | null;
  ownerUserId: number | null; ownerName: string | null;
  lifecycleStage: string; source: string | null;
  lastActivityAt: string | null; createdAt: string;
};
type Tag = { id: number; name: string; color: string };
type SortKey = "fullName" | "lastActivityAt" | "createdAt";

export default function CrmContacts() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState<"all" | "me" | "unassigned">("all");
  const [tagId, setTagId] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortKey>("lastActivityAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ rows: Contact[]; total: number }>({
    queryKey: ["crm", "contacts", q, owner, tagId, sortBy, sortDir],
    queryFn: () => crmFetch(`/admin/crm/contacts?q=${encodeURIComponent(q)}&owner=${owner}&tagId=${tagId}&sortBy=${sortBy}&sortDir=${sortDir}&limit=200`),
  });
  const { data: tagsData } = useQuery<{ rows: Tag[] }>({
    queryKey: ["crm", "tags"], queryFn: () => crmFetch("/admin/crm/tags"),
  });
  const { data: usersData } = useQuery<{ rows: CrmUser[] }>({
    queryKey: ["crm", "users"], queryFn: () => crmFetch("/admin/crm/users"),
  });

  const rows = data?.rows ?? [];
  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.id));
  const someChecked = selected.size > 0;

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("asc"); }
  };
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  };
  const toggleOne = (id: number) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const bulkAssign = useMutation({
    mutationFn: async (uid: number | null) => {
      for (const id of selected) {
        await crmFetch(`/admin/crm/contacts/${id}`, { method: "PUT", body: JSON.stringify({ assignedUserId: uid }) });
      }
    },
    onSuccess: () => { setSelected(new Set()); refetch(); toast({ title: "Owners updated" }); },
  });
  const bulkTag = useMutation({
    mutationFn: async (tag: number) => {
      for (const id of selected) {
        await crmFetch(`/admin/crm/contacts/${id}/tags`, { method: "POST", body: JSON.stringify({ tagId: tag }) }).catch(() => {});
      }
    },
    onSuccess: () => { setSelected(new Set()); refetch(); toast({ title: "Tag applied" }); },
  });

  return (
    <PortalLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Contacts</h1>
            <p className="text-sm text-muted-foreground">{data?.total ?? 0} contacts</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => downloadCsv("/admin/crm/contacts/export.csv", `contacts-${Date.now()}.csv`)}>
              <Download className="w-4 h-4 mr-1.5" /> Export
            </Button>
            <Button variant="outline" onClick={() => setShowImport(true)}>
              <Upload className="w-4 h-4 mr-1.5" /> Import CSV
            </Button>
            <Button onClick={() => setShowNew(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> New Contact
            </Button>
          </div>
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <Input placeholder="Search by name, email, or phone…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
          <select value={owner} onChange={(e) => setOwner(e.target.value as "all" | "me" | "unassigned")} className="border rounded px-2 py-1.5 text-sm">
            <option value="all">All owners</option>
            <option value="me">Mine</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <select value={tagId} onChange={(e) => setTagId(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
            <option value="">All tags</option>
            {(tagsData?.rows ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <Button variant="ghost" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
        </div>

        <SavedViewsBar
          entity="contact"
          current={{ q, owner, tagId, sortBy, sortDir }}
          onApply={(f) => {
            if (typeof f.q === "string") setQ(f.q);
            if (f.owner === "all" || f.owner === "me" || f.owner === "unassigned") setOwner(f.owner);
            if (typeof f.tagId === "string") setTagId(f.tagId);
            if (f.sortBy === "fullName" || f.sortBy === "lastActivityAt" || f.sortBy === "createdAt") setSortBy(f.sortBy);
            if (f.sortDir === "asc" || f.sortDir === "desc") setSortDir(f.sortDir);
          }}
        />

        {someChecked && (
          <div className="flex items-center gap-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <select className="border rounded px-2 py-1 text-sm" defaultValue="" onChange={(e) => { if (e.target.value) bulkAssign.mutate(e.target.value === "0" ? null : Number(e.target.value)); e.currentTarget.value = ""; }}>
              <option value="">Assign owner…</option>
              <option value="0">Unassigned</option>
              {(usersData?.rows ?? []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select className="border rounded px-2 py-1 text-sm" defaultValue="" onChange={(e) => { if (e.target.value) bulkTag.mutate(Number(e.target.value)); e.currentTarget.value = ""; }}>
              <option value="">Apply tag…</option>
              {(tagsData?.rows ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        <div className="border rounded-md bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#fafafa] border-b">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="p-3 w-10"><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" /></th>
                <SortableTh label="Name" colKey="fullName" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
                <th className="p-3">Company</th>
                <th className="p-3">Email</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Stage</th>
                <th className="p-3">Owner</th>
                <SortableTh label="Last Activity" colKey="lastActivityAt" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
                <SortableTh label="Created" colKey="createdAt" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No contacts.</td></tr>
              )}
              {rows.map(c => (
                <tr key={c.id} className="border-b hover:bg-[#fafafa]">
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} aria-label={`Select ${c.fullName}`} />
                  </td>
                  <td className="p-3">
                    <Link href={`/admin/crm/contacts/${c.id}`}><span className="font-medium text-blue-600 hover:underline cursor-pointer">{c.fullName || "(no name)"}</span></Link>
                  </td>
                  <td className="p-3">
                    {c.companyId
                      ? <Link href={`/admin/crm/companies/${c.companyId}`}><span className="text-blue-600 hover:underline cursor-pointer">{c.companyName}</span></Link>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-3">{c.email || "—"}</td>
                  <td className="p-3">{c.phone || "—"}</td>
                  <td className="p-3"><Badge variant="outline" className="text-xs capitalize">{c.lifecycleStage}</Badge></td>
                  <td className="p-3">{c.ownerName || <span className="text-muted-foreground">Unassigned</span>}</td>
                  <td className="p-3 text-xs text-muted-foreground">{fmtDate(c.lastActivityAt)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <NewContactDialog open={showNew} onOpenChange={setShowNew} onCreated={() => { refetch(); toast({ title: "Contact created" }); }} />
        <CsvImportWizard
          open={showImport}
          onOpenChange={setShowImport}
          onDone={() => { refetch(); }}
          title="Import Contacts (CSV)"
          endpoint="/admin/crm/contacts/import"
          fieldOptions={CONTACT_FIELD_OPTIONS}
          autoDetect={autoDetectContact}
          identifierFields={["email", "fullName", "firstName", "lastName"]}
          identifierHint="Map at least one column to Email, Full name, or First/Last name so contacts can be identified."
        />
      </div>
    </PortalLayout>
  );
}

function SortableTh({ label, colKey, sortBy, sortDir, onClick }: { label: string; colKey: SortKey; sortBy: SortKey; sortDir: "asc" | "desc"; onClick: (k: SortKey) => void }) {
  const active = sortBy === colKey;
  return (
    <th className="p-3 cursor-pointer select-none" onClick={() => onClick(colKey)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </span>
    </th>
  );
}

function NewContactDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", title: "", companyName: "" });
  const { data: usersData } = useQuery<{ rows: CrmUser[] }>({
    queryKey: ["crm", "users"],
    queryFn: () => crmFetch("/admin/crm/users"),
    enabled: open,
  });
  const [assignedUserId, setAssignedUserId] = useState<string>("");

  const mut = useMutation({
    mutationFn: () => crmFetch("/admin/crm/contacts", {
      method: "POST",
      body: JSON.stringify({ ...form, assignedUserId: assignedUserId ? Number(assignedUserId) : null }),
    }),
    onSuccess: () => { onCreated(); onOpenChange(false); setForm({ firstName: "", lastName: "", email: "", phone: "", title: "", companyName: "" }); },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Contact</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <Input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <Input className="col-span-2" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input className="col-span-2" placeholder="Company" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          <select className="col-span-2 border rounded px-2 py-1.5 text-sm" value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}>
            <option value="">Unassigned</option>
            {(usersData?.rows ?? []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={mut.isPending || (!form.email && !form.firstName && !form.lastName)} onClick={() => mut.mutate()}>
            {mut.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
