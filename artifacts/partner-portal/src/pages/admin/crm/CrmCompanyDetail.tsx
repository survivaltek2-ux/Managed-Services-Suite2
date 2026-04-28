import { useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Globe, Building, ArrowLeft, FileText, Download as DownloadIcon, Plus, Trash2 } from "lucide-react";
import { crmFetch, fmtDate, fmtDateTime, fmtCurrency, type CrmUser } from "./lib";

type Company = { id: number; name: string; website: string | null; phone: string | null; industry: string | null; city: string | null; state: string | null; assignedUserId: number | null; createdAt: string; contacts?: any[]; tags?: any[] };
type CustomField = { id: number; entity: string; label: string; key: string; type: string };
type FieldValue = { fieldId: number; value: any };
type Tag = { id: number; name: string; color: string };

export default function CrmCompanyDetail() {
  const [, params] = useRoute("/admin/crm/companies/:id");
  const [, setLocation] = useLocation();
  const id = Number(params?.id);
  const qc = useQueryClient();

  const { data: company, refetch } = useQuery<Company>({
    queryKey: ["crm", "company", id],
    queryFn: () => crmFetch(`/admin/crm/companies/${id}`),
    enabled: !!id,
  });
  const { data: timeline } = useQuery<{ events: any[]; deals: any[]; documents: any[]; leads: any[]; tasks: any[] }>({
    queryKey: ["crm", "company", id, "timeline"],
    queryFn: () => crmFetch(`/admin/crm/companies/${id}/timeline`),
    enabled: !!id,
  });
  const { data: usersData } = useQuery<{ rows: CrmUser[] }>({
    queryKey: ["crm", "users"], queryFn: () => crmFetch("/admin/crm/users"),
  });
  const { data: fieldsData } = useQuery<{ rows: CustomField[] }>({
    queryKey: ["crm", "fields", "company"],
    queryFn: () => crmFetch("/admin/crm/custom-fields?entity=company"),
  });
  const { data: fieldValuesData } = useQuery<{ rows: FieldValue[] }>({
    queryKey: ["crm", "company", id, "field-values"],
    queryFn: () => crmFetch(`/admin/crm/companies/${id}/field-values`),
    enabled: !!id,
  });
  // Mirror the contact profile: company tags are managed inline in the
  // header so users get parity across both entity types.
  const { data: companyTagsData } = useQuery<{ rows: Tag[] }>({
    queryKey: ["crm", "company", id, "tags"],
    queryFn: () => crmFetch(`/admin/crm/companies/${id}/tags`),
    enabled: !!id,
  });
  const { data: allTagsData } = useQuery<{ rows: Tag[] }>({
    queryKey: ["crm", "tags"], queryFn: () => crmFetch("/admin/crm/tags"),
  });

  const updateOwner = useMutation({
    mutationFn: (uid: string) => crmFetch(`/admin/crm/companies/${id}`, { method: "PUT", body: JSON.stringify({ assignedUserId: uid ? Number(uid) : null }) }),
    onSuccess: () => refetch(),
  });
  const delCompany = useMutation({
    mutationFn: () => crmFetch(`/admin/crm/companies/${id}`, { method: "DELETE" }),
    onSuccess: () => setLocation("/admin/crm/companies"),
  });

  if (!company) {
    return <PortalLayout><div className="p-6 text-sm text-muted-foreground">Loading…</div></PortalLayout>;
  }

  return (
    <PortalLayout>
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <Link href="/admin/crm/companies"><span className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline cursor-pointer"><ArrowLeft className="w-4 h-4" />Back to Companies</span></Link>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-2xl font-bold flex items-center gap-2"><Building className="w-6 h-6" />{company.name}</h1>
                <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                  {company.website && <a href={company.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline"><Globe className="w-3.5 h-3.5" />{company.website}</a>}
                  {company.phone && <span>{company.phone}</span>}
                  {company.industry && <Badge variant="secondary">{company.industry}</Badge>}
                  {(company.city || company.state) && <span>{[company.city, company.state].filter(Boolean).join(", ")}</span>}
                </div>
                <CompanyTagsRow companyId={id} tags={companyTagsData?.rows ?? []} allTags={allTagsData?.rows ?? []} onChange={() => qc.invalidateQueries({ queryKey: ["crm", "company", id, "tags"] })} />
              </div>
              <div className="text-right space-y-2">
                <div className="text-xs text-muted-foreground">Owner</div>
                <select value={company.assignedUserId ?? ""} onChange={(e) => updateOwner.mutate(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
                  <option value="">Unassigned</option>
                  {(usersData?.rows ?? []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <div>
                  <Button size="sm" variant="outline" className="text-red-600" onClick={() => { if (confirm("Delete this company?")) delCompany.mutate(); }}>Delete</Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="deals">Deals</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="log">Log Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-3 mt-4">
            <ul className="space-y-2">
              {(timeline?.events ?? []).map((e: any, i: number) => {
                const p = e.payload || {};
                const title = p.subject || p.title || p.type || p.name;
                const body = p.body || p.notes;
                return (
                  <li key={i} className="border rounded p-3 bg-white">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs capitalize">{String(e.kind).replace(/_/g, " ")}</Badge>
                        {title && <span className="text-sm font-medium">{title}</span>}
                      </div>
                      <span className="text-xs text-muted-foreground">{fmtDateTime(e.at)}</span>
                    </div>
                    {body && <div className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{body}</div>}
                    {p.amount != null && <div className="text-xs text-muted-foreground mt-1">{fmtCurrency(Number(p.amount))}</div>}
                  </li>
                );
              })}
              {(timeline?.events?.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">No activity yet.</div>}
            </ul>
          </TabsContent>

          <TabsContent value="contacts" className="mt-4">
            <ul className="border rounded divide-y bg-white">
              {(company.contacts ?? []).map((c: any) => (
                <li key={c.id} className="p-3 flex items-center justify-between">
                  <div>
                    <Link href={`/admin/crm/contacts/${c.id}`}><span className="text-sm font-medium text-blue-600 hover:underline cursor-pointer">{c.fullName}</span></Link>
                    <div className="text-xs text-muted-foreground">{c.email || "—"} · {c.phone || "—"}</div>
                  </div>
                </li>
              ))}
              {(company.contacts?.length ?? 0) === 0 && <li className="p-3 text-sm text-muted-foreground text-center">No contacts at this company.</li>}
            </ul>
          </TabsContent>

          <TabsContent value="deals" className="mt-4">
            {(timeline?.deals?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">No deals yet for this company.</div>
            ) : (
              <ul className="space-y-2">
                {(timeline?.deals ?? []).map((d: any) => (
                  <li key={d.id} className="border rounded p-3 bg-white flex items-center justify-between">
                    <div>
                      <Link href={`/admin/crm/deals/${d.id}`}><span className="font-medium text-blue-600 hover:underline cursor-pointer">{d.title}</span></Link>
                      <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
                        <span>Stage: <span className="capitalize">{String(d.stage || "").replace(/_/g, ' ')}</span></span>
                        <span>Status: <span className="capitalize">{d.status}</span></span>
                        {d.estimatedValue != null && <span>{fmtCurrency(Number(d.estimatedValue))}</span>}
                        <span>{fmtDate(d.createdAt)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="tasks" className="mt-4 space-y-3">
            <CompanyTaskComposer companyId={id} onCreated={() => qc.invalidateQueries({ queryKey: ["crm", "company", id, "timeline"] })} />
            <ul className="space-y-2">
              {(timeline?.tasks ?? []).map((t: any) => (
                <li key={t.id} className="border rounded p-2 bg-white flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{t.dueAt ? `Due ${fmtDateTime(t.dueAt)}` : "No due date"} · <span className="capitalize">{t.status}</span></div>
                  </div>
                </li>
              ))}
              {(timeline?.tasks?.length ?? 0) === 0 && <li className="text-sm text-muted-foreground">No tasks for this company.</li>}
            </ul>
          </TabsContent>

          <TabsContent value="files" className="mt-4">
            {(timeline?.documents?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">No files attached to this company.</div>
            ) : (
              <ul className="space-y-2">
                {(timeline?.documents ?? []).map((d: any) => (
                  <li key={d.id} className="border rounded p-2 bg-white flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{d.name}</div>
                        <div className="text-xs text-muted-foreground">{d.category || "—"} · {fmtDate(d.createdAt)}</div>
                      </div>
                    </div>
                    {d.fileUrl && (
                      <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
                        <DownloadIcon className="w-3 h-3" /> Open
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="details" className="mt-4">
            <CompanyCustomFields companyId={id} fields={fieldsData?.rows ?? []} values={fieldValuesData?.rows ?? []} onSaved={() => qc.invalidateQueries({ queryKey: ["crm", "company", id, "field-values"] })} />
          </TabsContent>

          <TabsContent value="log" className="mt-4">
            <CompanyActivityComposer companyId={id} onLogged={() => qc.invalidateQueries({ queryKey: ["crm", "company", id, "timeline"] })} />
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  );
}

function CompanyActivityComposer({ companyId, onLogged }: { companyId: number; onLogged: () => void }) {
  const [type, setType] = useState<"note" | "call" | "email" | "meeting">("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const mut = useMutation({
    mutationFn: () => crmFetch("/admin/crm/activities", {
      method: "POST",
      body: JSON.stringify({ type, subject: subject || null, body: body || null, companyId }),
    }),
    onSuccess: () => { setSubject(""); setBody(""); onLogged(); },
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Log Activity</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2 flex-wrap">
          {(["note", "call", "email", "meeting"] as const).map(t => (
            <button key={t} onClick={() => setType(t)} className={`text-xs px-3 py-1 rounded border capitalize ${type === t ? "bg-blue-600 text-white border-blue-600" : "bg-white"}`}>{t}</button>
          ))}
        </div>
        <Input placeholder="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="w-full border rounded p-2 text-sm" rows={3} placeholder="Notes…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex justify-end">
          <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending || (!subject && !body)}>{mut.isPending ? "Logging…" : "Log"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CompanyTaskComposer({ companyId, onCreated }: { companyId: number; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const mut = useMutation({
    mutationFn: () => crmFetch("/admin/crm/tasks", {
      method: "POST",
      body: JSON.stringify({ title, companyId, dueAt: dueAt ? new Date(dueAt).toISOString() : null }),
    }),
    onSuccess: () => { setTitle(""); setDueAt(""); onCreated(); },
  });
  return (
    <div className="flex gap-2">
      <Input placeholder="New task…" value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1" />
      <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="max-w-[200px]" />
      <Button onClick={() => mut.mutate()} disabled={!title || mut.isPending}>Add</Button>
    </div>
  );
}

function CompanyTagsRow({ companyId, tags, allTags, onChange }: { companyId: number; tags: Tag[]; allTags: Tag[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const apply = useMutation({
    mutationFn: (tagId: number) => crmFetch(`/admin/crm/companies/${companyId}/tags`, { method: "POST", body: JSON.stringify({ tagId }) }),
    onSuccess: () => { setAdding(false); onChange(); },
  });
  const remove = useMutation({
    mutationFn: (tagId: number) => crmFetch(`/admin/crm/companies/${companyId}/tags/${tagId}`, { method: "DELETE" }),
    onSuccess: () => onChange(),
  });
  const remaining = allTags.filter(t => !tags.some(x => x.id === t.id));
  return (
    <div className="flex flex-wrap items-center gap-2 mt-1">
      {tags.map(t => (
        <span key={t.id} className="text-xs px-2 py-1 rounded border flex items-center gap-1" style={{ borderColor: t.color, color: t.color }}>
          {t.name}<button onClick={() => remove.mutate(t.id)} aria-label={`Remove ${t.name} tag`}><Trash2 className="w-3 h-3" /></button>
        </span>
      ))}
      {adding ? (
        <select autoFocus className="border rounded px-2 py-1 text-xs" onChange={(e) => { if (e.target.value) apply.mutate(Number(e.target.value)); }} onBlur={() => setAdding(false)} defaultValue="">
          <option value="">Pick a tag…</option>
          {remaining.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      ) : remaining.length > 0 ? (
        <button onClick={() => setAdding(true)} className="text-xs px-2 py-1 rounded border border-dashed text-muted-foreground hover:text-foreground"><Plus className="w-3 h-3 inline" /> Tag</button>
      ) : null}
    </div>
  );
}

function CompanyCustomFields({ companyId, fields, values, onSaved }: { companyId: number; fields: CustomField[]; values: FieldValue[]; onSaved: () => void }) {
  const valueMap = new Map(values.map(v => [v.fieldId, v.value]));
  const [edits, setEdits] = useState<Record<number, any>>({});
  const save = useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: number; value: any }) =>
      crmFetch(`/admin/crm/custom-fields/${fieldId}/values`, {
        method: "PUT", body: JSON.stringify({ entity: "company", entityId: companyId, value }),
      }),
    onSuccess: () => onSaved(),
  });
  if (fields.length === 0) return <div className="text-sm text-muted-foreground">No custom fields defined for companies. Add some in CRM Settings.</div>;
  return (
    <div className="space-y-3">
      {fields.map(f => {
        const cur = edits[f.id] ?? valueMap.get(f.id) ?? "";
        return (
          <div key={f.id} className="grid grid-cols-3 gap-3 items-center">
            <label className="text-sm">{f.label} <span className="text-xs text-muted-foreground">({f.type})</span></label>
            <Input className="col-span-1" value={cur ?? ""} onChange={(e) => setEdits({ ...edits, [f.id]: e.target.value })} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} />
            <Button size="sm" variant="outline" onClick={() => save.mutate({ fieldId: f.id, value: cur })}>Save</Button>
          </div>
        );
      })}
    </div>
  );
}
