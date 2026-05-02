import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building, User, DollarSign, Tag as TagIcon, Calendar, Activity as ActivityIcon, FileText, CheckSquare, Plus } from "lucide-react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { crmFetch, fmtDate, fmtDateTime, fmtCurrency } from "./lib";

type Deal = {
  id: number;
  title: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  description: string | null;
  estimatedValue: string | null;
  stage: string;
  status: string;
  pipelineStageId: number | null;
  assignedUserId: number | null;
  crmContactId: number | null;
  crmCompanyId: number | null;
  partnerId: number | null;
  createdAt: string;
};
type Activity = {
  id: number;
  type: string;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  durationMinutes: number | null;
  occurredAt: string;
  ownerUserId: number | null;
};
type Task = {
  id: number;
  title: string;
  description: string | null;
  dueAt: string | null;
  priority: string;
  status: string;
  ownerName: string | null;
  ownerUserId: number | null;
  completedAt: string | null;
};

export default function CrmDealDetail() {
  const [, params] = useRoute("/admin/crm/deals/:id");
  const id = Number(params?.id);
  const qc = useQueryClient();

  const { data: detail } = useQuery<{ deal: Deal; contact: any; company: any; ownerName: string | null; stageName: string | null }>({
    queryKey: ["crm", "deal", id],
    queryFn: () => crmFetch(`/admin/crm/deals/${id}`),
    enabled: !!id,
  });
  const { data: timelineData } = useQuery<{ rows: Activity[] }>({
    queryKey: ["crm", "deal", id, "timeline"],
    queryFn: () => crmFetch(`/admin/crm/deals/${id}/timeline`),
    enabled: !!id,
  });
  const { data: tasksData } = useQuery<{ rows: Task[] }>({
    queryKey: ["crm", "deal", id, "tasks"],
    queryFn: () => crmFetch(`/admin/crm/tasks?dealId=${id}&status=all`),
    enabled: !!id,
  });
  const { data: tagsData } = useQuery<{ rows: { id: number; name: string; color: string }[] }>({
    queryKey: ["crm", "deal", id, "tags"],
    queryFn: () => crmFetch(`/admin/crm/deals/${id}/tags`),
    enabled: !!id,
  });

  if (!detail?.deal) {
    return <PortalLayout><div className="p-6 text-sm text-muted-foreground">Loading deal…</div></PortalLayout>;
  }
  const { deal, contact, company, ownerName, stageName } = detail;

  return (
    <PortalLayout>
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <Link href="/admin/crm/deals">
          <span className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline cursor-pointer">
            <ArrowLeft className="w-4 h-4" />Back to Deals
          </span>
        </Link>

        {/* Header */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-2xl font-bold">{deal.title}</h1>
                <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                  {contact && (
                    <Link href={`/admin/crm/contacts/${contact.id}`}>
                      <span className="flex items-center gap-1 text-blue-600 hover:underline cursor-pointer">
                        <User className="w-3.5 h-3.5" />{contact.fullName}
                      </span>
                    </Link>
                  )}
                  {company && (
                    <Link href={`/admin/crm/companies/${company.id}`}>
                      <span className="flex items-center gap-1 text-blue-600 hover:underline cursor-pointer">
                        <Building className="w-3.5 h-3.5" />{company.name}
                      </span>
                    </Link>
                  )}
                  {!contact && !company && deal.customerName && (
                    <span className="flex items-center gap-1"><Building className="w-3.5 h-3.5" />{deal.customerName}</span>
                  )}
                  {deal.estimatedValue && (
                    <span className="flex items-center gap-1 font-semibold text-foreground">
                      <DollarSign className="w-3.5 h-3.5" />{fmtCurrency(deal.estimatedValue !== null ? parseFloat(deal.estimatedValue) : null)}
                    </span>
                  )}
                  <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />Created {fmtDate(deal.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant="outline" className="capitalize">{stageName ?? deal.stage.replace(/_/g, " ")}</Badge>
                  <Badge variant="secondary" className="capitalize">{deal.status}</Badge>
                  {(tagsData?.rows ?? []).map(t => (
                    <span key={t.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium" style={{ backgroundColor: `${t.color}22`, color: t.color }}>
                      <TagIcon className="w-3 h-3" />{t.name}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-right space-y-1">
                <div className="text-xs text-muted-foreground">Owner</div>
                <div className="text-sm font-medium">{ownerName ?? "Unassigned"}</div>
              </div>
            </div>
            {deal.description && (
              <p className="mt-4 text-sm text-muted-foreground whitespace-pre-wrap border-t pt-3">{deal.description}</p>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="timeline" className="space-y-3">
          <TabsList>
            <TabsTrigger value="timeline"><ActivityIcon className="w-3.5 h-3.5 mr-1" />Timeline</TabsTrigger>
            <TabsTrigger value="tasks"><CheckSquare className="w-3.5 h-3.5 mr-1" />Tasks ({tasksData?.rows?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="files"><FileText className="w-3.5 h-3.5 mr-1" />Files</TabsTrigger>
            <TabsTrigger value="related">Related</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-3">
            <DealActivityComposer dealId={id} contactId={contact?.id ?? null} companyId={company?.id ?? null}
              onLogged={() => qc.invalidateQueries({ queryKey: ["crm", "deal", id, "timeline"] })} />
            <Card>
              <CardHeader><CardTitle className="text-sm">Activity timeline</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(timelineData?.rows ?? []).length === 0 && <div className="text-sm text-muted-foreground">No activity yet. Log a note, call, email, or meeting above.</div>}
                {(timelineData?.rows ?? []).map(a => (
                  <div key={a.id} className="border-l-2 border-blue-300 pl-3 py-2">
                    <div className="text-xs text-muted-foreground">{fmtDateTime(a.occurredAt)} &middot; <span className="capitalize">{a.type}</span>{a.durationMinutes ? ` · ${a.durationMinutes}m` : ""}</div>
                    {a.subject && <div className="text-sm font-medium">{a.subject}</div>}
                    {a.body && <div className="text-sm whitespace-pre-wrap">{a.body}</div>}
                    {a.outcome && <div className="text-xs text-muted-foreground mt-1">Outcome: {a.outcome}</div>}
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tasks" className="space-y-3">
            <DealTaskComposer dealId={id} contactId={contact?.id ?? null} companyId={company?.id ?? null}
              onCreated={() => qc.invalidateQueries({ queryKey: ["crm", "deal", id, "tasks"] })} />
            <Card>
              <CardHeader><CardTitle className="text-sm">Open & completed tasks</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {(tasksData?.rows ?? []).length === 0 && <div className="text-sm text-muted-foreground">No tasks linked to this deal.</div>}
                {(tasksData?.rows ?? []).map(t => (
                  <div key={t.id} className="flex items-start justify-between gap-3 py-2 border-b last:border-b-0">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{t.title}</div>
                      {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {t.dueAt ? `Due ${fmtDate(t.dueAt)}` : "No due date"} &middot; {t.ownerName ?? "Unassigned"} &middot; <span className="capitalize">{t.priority}</span>
                      </div>
                    </div>
                    <Badge variant={t.status === "done" ? "secondary" : "outline"} className="capitalize">{t.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="files">
            <DealFilesTab dealId={id} />
          </TabsContent>

          <TabsContent value="related" className="space-y-3">
            <Card>
              <CardHeader><CardTitle className="text-sm">Related records</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {contact ? (
                  <div>
                    <span className="text-muted-foreground mr-2">Primary contact:</span>
                    <Link href={`/admin/crm/contacts/${contact.id}`}><span className="text-blue-600 hover:underline cursor-pointer">{contact.fullName}</span></Link>
                    {contact.email && <span className="text-muted-foreground ml-2">({contact.email})</span>}
                  </div>
                ) : <div className="text-muted-foreground">No primary contact linked.</div>}
                {company ? (
                  <div>
                    <span className="text-muted-foreground mr-2">Company:</span>
                    <Link href={`/admin/crm/companies/${company.id}`}><span className="text-blue-600 hover:underline cursor-pointer">{company.name}</span></Link>
                  </div>
                ) : <div className="text-muted-foreground">No company linked.</div>}
                <div>
                  <span className="text-muted-foreground mr-2">Customer email/phone:</span>
                  <span>{deal.customerEmail || "—"} {deal.customerPhone ? ` · ${deal.customerPhone}` : ""}</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  );
}

type ActivityType = "note" | "call" | "email" | "meeting";
type TaskPriority = "low" | "medium" | "high" | "urgent";

function DealActivityComposer({ dealId, contactId, companyId, onLogged }: { dealId: number; contactId: number | null; companyId: number | null; onLogged: () => void }) {
  const [type, setType] = useState<ActivityType>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState("");
  const [duration, setDuration] = useState<string>("");

  const log = useMutation({
    mutationFn: () => crmFetch("/admin/crm/activities", {
      method: "POST",
      body: JSON.stringify({
        type, subject: subject || null, body: body || null, outcome: outcome || null,
        durationMinutes: duration ? Number(duration) : null,
        dealId, contactId, companyId,
      }),
    }),
    onSuccess: () => { setSubject(""); setBody(""); setOutcome(""); setDuration(""); onLogged(); },
  });
  const errMsg = (log.error as Error | null)?.message;

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Plus className="w-3.5 h-3.5" />Log activity on this deal</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <select value={type} onChange={e => setType(e.target.value as ActivityType)} className="border rounded px-2 py-1 text-sm">
            <option value="note">Note</option>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
          </select>
          <Input className="flex-1 min-w-[150px]" placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} />
          {(type === "call" || type === "meeting") && (
            <Input className="w-24" type="number" placeholder="Min" value={duration} onChange={e => setDuration(e.target.value)} />
          )}
        </div>
        <textarea className="w-full border rounded p-2 text-sm" rows={3} placeholder="Details…" value={body} onChange={e => setBody(e.target.value)} />
        {(type === "call" || type === "meeting") && (
          <Input placeholder="Outcome (optional)" value={outcome} onChange={e => setOutcome(e.target.value)} />
        )}
        {errMsg && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{errMsg}</div>}
        <div className="flex justify-end">
          <Button size="sm" onClick={() => log.mutate()} disabled={log.isPending || (!subject && !body)}>
            {log.isPending ? "Logging…" : "Log activity"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DealTaskComposer({ dealId, contactId, companyId, onCreated }: { dealId: number; contactId: number | null; companyId: number | null; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const create = useMutation({
    mutationFn: () => crmFetch("/admin/crm/tasks", {
      method: "POST",
      body: JSON.stringify({ title, dueAt: dueAt || null, priority, dealId, contactId, companyId }),
    }),
    onSuccess: () => { setTitle(""); setDueAt(""); setPriority("medium"); onCreated(); },
  });
  const errMsg = (create.error as Error | null)?.message;
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Plus className="w-3.5 h-3.5" />New task on this deal</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <Input className="flex-1 min-w-[200px]" placeholder="Task title" value={title} onChange={e => setTitle(e.target.value)} />
          <Input className="w-44" type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} />
          <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} className="border rounded px-2 py-1 text-sm">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending || !title}>
            {create.isPending ? "Adding…" : "Add task"}
          </Button>
        </div>
        {errMsg && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{errMsg}</div>}
      </CardContent>
    </Card>
  );
}

type DealFile = { id: number; name: string; filename: string; category: string | null; createdAt: string };
function DealFilesTab({ dealId }: { dealId: number }) {
  const { data, isLoading } = useQuery<{ rows: DealFile[] }>({
    queryKey: ["crm", "deal", dealId, "files"],
    queryFn: () => crmFetch(`/admin/crm/deals/${dealId}/files`),
  });
  const rows = data?.rows ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" />Files on this deal's company</CardTitle></CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">No files attached. Upload from the Documents area and link it to this deal's company.</div>
        ) : (
          <ul className="divide-y">
            {rows.map(f => (
              <li key={f.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{f.name}</div>
                  <div className="text-xs text-muted-foreground">{f.category ?? "Uncategorized"} · {fmtDate(f.createdAt)}</div>
                </div>
                <a href={`/admin/documents`} className="text-xs text-blue-600 hover:underline whitespace-nowrap">Open</a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
