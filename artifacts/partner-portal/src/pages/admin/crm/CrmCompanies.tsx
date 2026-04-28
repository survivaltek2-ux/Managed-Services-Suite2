import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Download, Upload, RefreshCw, ArrowUp, ArrowDown } from "lucide-react";
import { crmFetch, downloadCsv, fmtDate, type CrmUser } from "./lib";
import { SavedViewsBar } from "./SavedViewsBar";
import { CsvImportWizard, COMPANY_FIELD_OPTIONS, autoDetectCompany } from "./CsvImportWizard";

type Company = {
  id: number; name: string; website: string | null; industry: string | null;
  city: string | null; state: string | null;
  ownerUserId: number | null; ownerName: string | null;
  contactCount: number; dealCount: number; createdAt: string;
};
type Tag = { id: number; name: string; color: string };
type SortKey = "name" | "createdAt" | "updatedAt";

export default function CrmCompanies() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState<"all" | "me" | "unassigned">("all");
  const [tagId, setTagId] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ rows: Company[]; total: number }>({
    queryKey: ["crm", "companies", q, owner, tagId, sortBy, sortDir],
    queryFn: () => crmFetch(`/admin/crm/companies?q=${encodeURIComponent(q)}&owner=${owner}&tagId=${tagId}&sortBy=${sortBy}&sortDir=${sortDir}&limit=200`),
  });
  const { data: tagsData } = useQuery<{ rows: Tag[] }>({ queryKey: ["crm", "tags"], queryFn: () => crmFetch("/admin/crm/tags") });
  const { data: usersData } = useQuery<{ rows: CrmUser[] }>({ queryKey: ["crm", "users"], queryFn: () => crmFetch("/admin/crm/users") });

  const rows = data?.rows ?? [];
  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.id));
  const toggleAll = () => allChecked ? setSelected(new Set()) : setSelected(new Set(rows.map(r => r.id)));
  const toggleOne = (id: number) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleSort = (k: SortKey) => sortBy === k ? setSortDir(d => d === "asc" ? "desc" : "asc") : (setSortBy(k), setSortDir("asc"));

  const bulkAssign = useMutation({
    mutationFn: async (uid: number | null) => {
      for (const id of selected) await crmFetch(`/admin/crm/companies/${id}`, { method: "PUT", body: JSON.stringify({ assignedUserId: uid }) });
    },
    onSuccess: () => { setSelected(new Set()); refetch(); toast({ title: "Owners updated" }); },
  });
  const bulkTag = useMutation({
    mutationFn: async (tag: number) => {
      for (const id of selected) await crmFetch(`/admin/crm/companies/${id}/tags`, { method: "POST", body: JSON.stringify({ tagId: tag }) }).catch(() => {});
    },
    onSuccess: () => { setSelected(new Set()); refetch(); toast({ title: "Tag applied" }); },
  });

  return (
    <PortalLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Companies</h1>
            <p className="text-sm text-muted-foreground">{data?.total ?? 0} companies</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowImport(true)}><Upload className="w-4 h-4 mr-1.5" /> Import CSV</Button>
            <Button variant="outline" onClick={() => downloadCsv("/admin/crm/companies/export.csv", `companies-${Date.now()}.csv`)}><Download className="w-4 h-4 mr-1.5" /> Export</Button>
            <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1.5" /> New Company</Button>
          </div>
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <Input placeholder="Search companies…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
          <select value={owner} onChange={(e) => setOwner(e.target.value as "all" | "me" | "unassigned")} className="border rounded px-2 py-1.5 text-sm">
            <option value="all">All owners</option><option value="me">Mine</option><option value="unassigned">Unassigned</option>
          </select>
          <select value={tagId} onChange={(e) => setTagId(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
            <option value="">All tags</option>
            {(tagsData?.rows ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <Button variant="ghost" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
        </div>

        <SavedViewsBar
          entity="company"
          current={{ q, owner, tagId, sortBy, sortDir }}
          onApply={(f) => {
            if (typeof f.q === "string") setQ(f.q);
            if (f.owner === "all" || f.owner === "me" || f.owner === "unassigned") setOwner(f.owner);
            if (typeof f.tagId === "string") setTagId(f.tagId);
            if (f.sortBy === "name" || f.sortBy === "createdAt" || f.sortBy === "updatedAt") setSortBy(f.sortBy);
            if (f.sortDir === "asc" || f.sortDir === "desc") setSortDir(f.sortDir);
          }}
        />

        {selected.size > 0 && (
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
                <Th label="Name" k="name" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
                <th className="p-3">Website</th><th className="p-3">Industry</th>
                <th className="p-3">Location</th><th className="p-3">Contacts</th><th className="p-3">Deals</th>
                <th className="p-3">Owner</th>
                <Th label="Created" k="createdAt" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No companies.</td></tr>
              )}
              {rows.map(c => (
                <tr key={c.id} className="border-b hover:bg-[#fafafa]">
                  <td className="p-3"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} aria-label={`Select ${c.name}`} /></td>
                  <td className="p-3"><Link href={`/admin/crm/companies/${c.id}`}><span className="font-medium text-blue-600 hover:underline cursor-pointer">{c.name}</span></Link></td>
                  <td className="p-3 text-xs">{c.website ? <a href={c.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{c.website}</a> : "—"}</td>
                  <td className="p-3">{c.industry || "—"}</td>
                  <td className="p-3 text-xs">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="p-3">{c.contactCount}</td>
                  <td className="p-3">{c.dealCount}</td>
                  <td className="p-3">{c.ownerName || <span className="text-muted-foreground">Unassigned</span>}</td>
                  <td className="p-3 text-xs text-muted-foreground">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <NewCompanyDialog open={showNew} onOpenChange={setShowNew} onCreated={() => refetch()} />
        <CsvImportWizard
          open={showImport}
          onOpenChange={setShowImport}
          onDone={() => refetch()}
          title="Import Companies (CSV)"
          endpoint="/admin/crm/companies/import"
          fieldOptions={COMPANY_FIELD_OPTIONS}
          autoDetect={autoDetectCompany}
          identifierFields={["name"]}
          identifierHint="Map at least one column to Company name so rows can be de-duplicated."
        />
      </div>
    </PortalLayout>
  );
}

function Th({ label, k, sortBy, sortDir, onClick }: { label: string; k: SortKey; sortBy: SortKey; sortDir: "asc" | "desc"; onClick: (k: SortKey) => void }) {
  const active = sortBy === k;
  return (
    <th className="p-3 cursor-pointer select-none" onClick={() => onClick(k)}>
      <span className="inline-flex items-center gap-1">{label}{active && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}</span>
    </th>
  );
}

function NewCompanyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", website: "", phone: "", industry: "", city: "", state: "" });
  const mut = useMutation({
    mutationFn: () => crmFetch("/admin/crm/companies", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => { onCreated(); onOpenChange(false); setForm({ name: "", website: "", phone: "", industry: "", city: "", state: "" }); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Company</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Input className="col-span-2" placeholder="Company name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input placeholder="Industry" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
          <Input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Input placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!form.name || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
