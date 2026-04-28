import { useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Mail, Phone, Building, ArrowLeft, Plus, Trash2, FileText, Download as DownloadIcon, Send } from "lucide-react";
import { crmFetch, fmtDate, fmtDateTime, fmtCurrency, type CrmUser } from "./lib";

type Contact = { id: number; firstName: string | null; lastName: string | null; fullName: string; email: string | null; phone: string | null; title: string | null; companyId: number | null; company?: { id: number; name: string } | null; lifecycleStage: string; source: string | null; assignedUserId: number | null; createdAt: string };
type Tag = { id: number; name: string; color: string };
type CustomField = { id: number; entity: string; label: string; key: string; type: string };
type FieldValue = { fieldId: number; value: any };

export default function CrmContactDetail() {
  const [, params] = useRoute("/admin/crm/contacts/:id");
  const [, setLocation] = useLocation();
  const id = Number(params?.id);
  const qc = useQueryClient();

  const { data: contact, refetch } = useQuery<Contact>({
    queryKey: ["crm", "contact", id],
    queryFn: () => crmFetch(`/admin/crm/contacts/${id}`),
    enabled: !!id,
  });
  const { data: timeline } = useQuery<{ events: any[]; deals: any[]; leads: any[]; quotes: any[]; documents: any[] }>({
    queryKey: ["crm", "contact", id, "timeline"],
    queryFn: () => crmFetch(`/admin/crm/contacts/${id}/timeline`),
    enabled: !!id,
  });
  const { data: usersData } = useQuery<{ rows: CrmUser[] }>({
    queryKey: ["crm", "users"], queryFn: () => crmFetch("/admin/crm/users"),
  });
  const { data: contactTagsData } = useQuery<{ rows: Tag[] }>({
    queryKey: ["crm", "contact", id, "tags"],
    queryFn: () => crmFetch(`/admin/crm/contacts/${id}/tags`),
    enabled: !!id,
  });
  const { data: allTagsData } = useQuery<{ rows: Tag[] }>({
    queryKey: ["crm", "tags"], queryFn: () => crmFetch("/admin/crm/tags"),
  });
  const { data: fieldsData } = useQuery<{ rows: CustomField[] }>({
    queryKey: ["crm", "fields", "contact"],
    queryFn: () => crmFetch("/admin/crm/custom-fields?entity=contact"),
  });
  const { data: fieldValuesData } = useQuery<{ rows: FieldValue[] }>({
    queryKey: ["crm", "contact", id, "field-values"],
    queryFn: () => crmFetch(`/admin/crm/contacts/${id}/field-values`),
    enabled: !!id,
  });

  const updateOwner = useMutation({
    mutationFn: (uid: string) => crmFetch(`/admin/crm/contacts/${id}`, {
      method: "PUT", body: JSON.stringify({ assignedUserId: uid ? Number(uid) : null }),
    }),
    onSuccess: () => refetch(),
  });
  const delContact = useMutation({
    mutationFn: () => crmFetch(`/admin/crm/contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => setLocation("/admin/crm/contacts"),
  });

  if (!contact) {
    return <PortalLayout><div className="p-6 text-sm text-muted-foreground">Loading…</div></PortalLayout>;
  }

  return (
    <PortalLayout>
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <Link href="/admin/crm/contacts"><span className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline cursor-pointer"><ArrowLeft className="w-4 h-4" />Back to Contacts</span></Link>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-2xl font-bold">{contact.fullName || "(no name)"}</h1>
                <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                  {contact.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{contact.email}</span>}
                  {contact.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{contact.phone}</span>}
                  {contact.companyId && (
                    <Link href={`/admin/crm/companies/${contact.companyId}`}>
                      <span className="flex items-center gap-1 text-blue-600 hover:underline cursor-pointer"><Building className="w-3.5 h-3.5" />{contact.company?.name}</span>
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className="capitalize">{contact.lifecycleStage}</Badge>
                  {contact.source && <Badge variant="secondary" className="text-xs">{contact.source}</Badge>}
                </div>
                <TagsRow contactId={id} tags={contactTagsData?.rows ?? []} allTags={allTagsData?.rows ?? []} onChange={() => qc.invalidateQueries({ queryKey: ["crm", "contact", id, "tags"] })} />
              </div>
              <div className="text-right space-y-2">
                <div className="text-xs text-muted-foreground">Owner</div>
                <select value={contact.assignedUserId ?? ""} onChange={(e) => updateOwner.mutate(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
                  <option value="">Unassigned</option>
                  {(usersData?.rows ?? []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <div>
                  <Button size="sm" variant="outline" className="text-red-600" onClick={() => { if (confirm("Delete this contact?")) delContact.mutate(); }}>Delete</Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="deals">Deals</TabsTrigger>
            <TabsTrigger value="leads">Leads &amp; Quotes</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-3 mt-4">
            <ActivityComposer contactId={id} onLogged={() => qc.invalidateQueries({ queryKey: ["crm", "contact", id, "timeline"] })} />
            <Timeline events={timeline?.events ?? []} />
          </TabsContent>

          <TabsContent value="deals" className="mt-4">
            <DealsList deals={timeline?.deals ?? []} />
          </TabsContent>

          <TabsContent value="leads" className="mt-4 space-y-4">
            <LeadsList leads={timeline?.leads ?? []} />
            <QuotesList quotes={timeline?.quotes ?? []} />
          </TabsContent>

          <TabsContent value="tasks" className="space-y-3 mt-4">
            <TaskComposer contactId={id} companyId={contact.companyId} onCreated={() => {
              qc.invalidateQueries({ queryKey: ["crm", "contact", id, "timeline"] });
              qc.invalidateQueries({ queryKey: ["crm", "contact", id, "tasks"] });
            }} />
            <ContactTasks contactId={id} />
          </TabsContent>

          <TabsContent value="files" className="mt-4">
            <FilesList docs={timeline?.documents ?? []} />
          </TabsContent>

          <TabsContent value="email" className="mt-4">
            <EmailComposer contactId={id} contactEmail={contact.email} onSent={() => qc.invalidateQueries({ queryKey: ["crm", "contact", id, "timeline"] })} />
          </TabsContent>

          <TabsContent value="details" className="mt-4">
            <CustomFieldsEditor contactId={id} fields={fieldsData?.rows ?? []} values={fieldValuesData?.rows ?? []} onSaved={() => qc.invalidateQueries({ queryKey: ["crm", "contact", id, "field-values"] })} />
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  );
}

function TagsRow({ contactId, tags, allTags, onChange }: { contactId: number; tags: Tag[]; allTags: Tag[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const apply = useMutation({
    mutationFn: (tagId: number) => crmFetch(`/admin/crm/contacts/${contactId}/tags`, { method: "POST", body: JSON.stringify({ tagId }) }),
    onSuccess: () => { setAdding(false); onChange(); },
  });
  const remove = useMutation({
    mutationFn: (tagId: number) => crmFetch(`/admin/crm/contacts/${contactId}/tags/${tagId}`, { method: "DELETE" }),
    onSuccess: () => onChange(),
  });
  const remaining = allTags.filter(t => !tags.some(x => x.id === t.id));
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      {tags.map(t => (
        <span key={t.id} className="text-xs px-2 py-1 rounded border flex items-center gap-1" style={{ borderColor: t.color, color: t.color }}>
          {t.name}<button onClick={() => remove.mutate(t.id)}><Trash2 className="w-3 h-3" /></button>
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

function ActivityComposer({ contactId, onLogged }: { contactId: number; onLogged: () => void }) {
  const [type, setType] = useState<"note" | "call" | "email" | "meeting">("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState("");
  const [duration, setDuration] = useState("");
  const mut = useMutation({
    mutationFn: () => crmFetch("/admin/crm/activities", {
      method: "POST",
      body: JSON.stringify({
        type, subject: subject || null, body: body || null,
        outcome: outcome || null, durationMinutes: duration ? Number(duration) : null,
        contactId,
      }),
    }),
    onSuccess: () => { setSubject(""); setBody(""); setOutcome(""); setDuration(""); onLogged(); },
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
        {(type === "call" || type === "meeting") && (
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Outcome (e.g. left voicemail)" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
            <Input type="number" placeholder="Duration (min)" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending || (!subject && !body)}>{mut.isPending ? "Logging…" : "Log"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Timeline({ events }: { events: any[] }) {
  if (events.length === 0) return <div className="text-sm text-muted-foreground">No activity yet.</div>;
  return (
    <ul className="space-y-2">
      {events.map((e, i) => {
        const p = e.payload || {};
        const title = p.subject || p.title || p.type || p.name || p.magnet;
        const body = p.body || p.notes;
        return (
          <li key={`${e.kind}-${p.id ?? i}`} className="border rounded p-3 bg-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs capitalize">{String(e.kind).replace(/_/g, " ")}</Badge>
                {title && <span className="text-sm font-medium">{title}</span>}
              </div>
              <span className="text-xs text-muted-foreground">{fmtDateTime(e.at)}</span>
            </div>
            {body && <div className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{body}</div>}
            {p.status && <div className="text-xs text-muted-foreground mt-1">Status: {p.status}</div>}
            {p.amount != null && <div className="text-xs text-muted-foreground mt-1">{fmtCurrency(Number(p.amount))}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function TaskComposer({ contactId, companyId, onCreated }: { contactId: number; companyId: number | null; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const mut = useMutation({
    mutationFn: () => crmFetch("/admin/crm/tasks", {
      method: "POST",
      body: JSON.stringify({ title, contactId, companyId, dueAt: dueAt ? new Date(dueAt).toISOString() : null }),
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

function ContactTasks({ contactId }: { contactId: number }) {
  const qc = useQueryClient();
  const { data } = useQuery<{ rows: any[] }>({
    queryKey: ["crm", "contact", contactId, "tasks"],
    queryFn: () => crmFetch(`/admin/crm/tasks?contactId=${contactId}&status=all`),
  });
  const done = useMutation({
    mutationFn: (id: number) => crmFetch(`/admin/crm/tasks/${id}/done`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "contact", contactId, "tasks"] }),
  });
  return (
    <ul className="space-y-2">
      {(data?.rows ?? []).map(t => (
        <li key={t.id} className="border rounded p-2 bg-white flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{t.title}</div>
            <div className="text-xs text-muted-foreground">{t.dueAt ? `Due ${fmtDateTime(t.dueAt)}` : "No due date"} · <span className="capitalize">{t.status}</span></div>
          </div>
          {t.status === "open" && <Button size="sm" variant="outline" onClick={() => done.mutate(t.id)}>Done</Button>}
        </li>
      ))}
      {(data?.rows.length ?? 0) === 0 && <li className="text-sm text-muted-foreground">No tasks for this contact.</li>}
    </ul>
  );
}

function DealsList({ deals }: { deals: any[] }) {
  if (deals.length === 0) return <div className="text-sm text-muted-foreground">No deals linked to this contact.</div>;
  return (
    <ul className="space-y-2">
      {deals.map((d: any) => (
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
  );
}

function LeadsList({ leads }: { leads: any[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Leads</CardTitle></CardHeader>
      <CardContent>
        {leads.length === 0 ? <div className="text-sm text-muted-foreground">No leads.</div> : (
          <ul className="space-y-2">
            {leads.map((l: any) => (
              <li key={l.id} className="border rounded p-2 bg-white">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className="text-xs capitalize">{l.status}</Badge>
                  {l.source && <span className="text-xs text-muted-foreground">via {l.source}</span>}
                  <span className="text-xs text-muted-foreground ml-auto">{fmtDate(l.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function QuotesList({ quotes }: { quotes: any[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Quotes</CardTitle></CardHeader>
      <CardContent>
        {quotes.length === 0 ? <div className="text-sm text-muted-foreground">No quotes.</div> : (
          <ul className="space-y-2">
            {quotes.map((q: any) => (
              <li key={q.id} className="border rounded p-2 bg-white text-sm flex items-center gap-2">
                <Badge variant="outline" className="text-xs capitalize">{q.status}</Badge>
                <span className="text-xs text-muted-foreground">{Array.isArray(q.services) ? q.services.join(", ") : ""}</span>
                <span className="text-xs text-muted-foreground ml-auto">{fmtDate(q.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FilesList({ docs }: { docs: any[] }) {
  if (docs.length === 0) return <div className="text-sm text-muted-foreground">No files attached.</div>;
  return (
    <ul className="space-y-2">
      {docs.map((d: any) => (
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
  );
}

function EmailComposer({ contactId, contactEmail, onSent }: { contactId: number; contactEmail: string | null; onSent: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: () => crmFetch(`/admin/crm/contacts/${contactId}/email`, {
      method: "POST",
      body: JSON.stringify({ subject, body }),
    }),
    onSuccess: () => { setSubject(""); setBody(""); onSent(); },
  });
  if (!contactEmail) {
    return <div className="text-sm text-muted-foreground">No email on file for this contact. Add one in Details to send email.</div>;
  }
  const errMsg = (send.error as Error | null)?.message;
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Send email to {contactEmail}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="w-full border rounded p-2 text-sm" rows={6} placeholder="Write your message…" value={body} onChange={(e) => setBody(e.target.value)} />
        {errMsg && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            Send failed: {errMsg}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">The message is sent through the configured email account and logged as an Email activity automatically.</span>
          <Button size="sm" onClick={() => send.mutate()} disabled={send.isPending || (!subject && !body)}>
            <Send className="w-3.5 h-3.5 mr-1" />
            {send.isPending ? "Sending…" : "Send email"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CustomFieldsEditor({ contactId, fields, values, onSaved }: { contactId: number; fields: CustomField[]; values: FieldValue[]; onSaved: () => void }) {
  const valueMap = new Map(values.map(v => [v.fieldId, v.value]));
  const [edits, setEdits] = useState<Record<number, any>>({});
  const save = useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: number; value: any }) =>
      crmFetch(`/admin/crm/custom-fields/${fieldId}/values`, {
        method: "PUT", body: JSON.stringify({ entity: "contact", entityId: contactId, value }),
      }),
    onSuccess: () => onSaved(),
  });
  if (fields.length === 0) return <div className="text-sm text-muted-foreground">No custom fields defined. Add some in CRM Settings.</div>;
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
