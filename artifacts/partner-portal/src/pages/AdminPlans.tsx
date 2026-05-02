import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  FileText, Search, Loader, Download, ChevronLeft, RefreshCw, Plus, X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { PlanWizard, type WrittenPlan } from "./WrittenPlans";

interface ActivityEvent {
  id: number;
  planId: number;
  eventType: string;
  metadata: Record<string, string | number>;
  createdAt: string;
}

interface Partner {
  id: number;
  companyName: string;
  contactName: string;
  email: string;
}

function authHeader(): Record<string, string> {
  const t = localStorage.getItem("partner_token");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:          { label: "Draft",          color: "text-muted-foreground", bg: "bg-muted" },
  sent:           { label: "Sent",           color: "text-blue-600",         bg: "bg-blue-50" },
  viewed:         { label: "Viewed",         color: "text-purple-600",       bg: "bg-purple-50" },
  approved:       { label: "Approved",       color: "text-green-600",        bg: "bg-green-50" },
  declined:       { label: "Declined",       color: "text-red-600",          bg: "bg-red-50" },
  call_requested: { label: "Call Requested", color: "text-orange-600",       bg: "bg-orange-50" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", cfg.color, cfg.bg)}>
      {cfg.label}
    </span>
  );
}

function PlanDetailPanel({ plan, events, onBack, partnerName }: {
  plan: WrittenPlan;
  events: ActivityEvent[];
  onBack: () => void;
  partnerName?: string;
}) {
  const content = plan.planContent as {
    executiveSummary?: string;
    recommendedServices?: { service: string; description: string }[];
  };

  const EVENT_LABELS: Record<string, string> = {
    created: "Plan created", sent: "Sent to client", viewed: "Client viewed",
    approved: "Plan approved", declined: "Declined", call_requested: "Call requested",
    revised: "Revision created", reminder_sent: "Reminder sent",
    send_failed: "Email delivery failed",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> All Plans</Button>
        <h1 className="text-xl font-bold text-[#032d60]">{plan.clientCompany}</h1>
        <StatusBadge status={plan.status} />
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Plan</p>
            <p className="font-medium">{plan.planNumber} · v{plan.version}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Client</p>
            <p className="font-medium">{plan.clientName}</p>
            {plan.clientTitle && <p className="text-xs text-muted-foreground">{plan.clientTitle}</p>}
            <p className="text-xs text-[#0176d3]">{plan.clientEmail}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="font-medium">{format(new Date(plan.createdAt), "MMM d, yyyy")}</p>
          </div>
          {plan.expiresAt && (
            <div>
              <p className="text-xs text-muted-foreground">Expires</p>
              <p className={cn("font-medium", new Date(plan.expiresAt) < new Date() && plan.status !== "approved" ? "text-red-600" : "")}>
                {format(new Date(plan.expiresAt), "MMM d, yyyy")}
              </p>
            </div>
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground">Partner: <span className="font-medium text-foreground">{partnerName || (plan.partnerId ? `ID ${plan.partnerId}` : "Siebert Admin")}</span></p>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={async () => {
            const t = localStorage.getItem("partner_token");
            const res = await fetch(`/api/partner/plans/${plan.id}/pdf`, {
              headers: t ? { Authorization: `Bearer ${t}` } : {},
            });
            if (!res.ok) return;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `plan-${plan.planNumber}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }}
        >
          <Download className="w-3.5 h-3.5" /> Download PDF
        </Button>
      </div>

      <Card className="p-4">
        <h2 className="font-bold text-[#032d60] mb-3">Activity Timeline</h2>
        <div className="space-y-2">
          {events.map(ev => (
            <div key={ev.id} className="flex items-start gap-3">
              <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0",
                ev.eventType === "approved" ? "bg-green-500" :
                ev.eventType === "declined" || ev.eventType === "send_failed" ? "bg-red-500" :
                ev.eventType === "call_requested" ? "bg-orange-500" :
                "bg-[#0176d3]")} />
              <div className="flex-1">
                <p className="text-sm font-medium">{EVENT_LABELS[ev.eventType] || ev.eventType}</p>
                {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                  <p className="text-xs text-muted-foreground">{JSON.stringify(ev.metadata).replace(/[{}"]/g, "").replace(/,/g, " · ")}</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground shrink-0">{format(new Date(ev.createdAt), "MMM d, h:mm a")}</p>
            </div>
          ))}
          {events.length === 0 && <p className="text-sm text-muted-foreground">No activity recorded.</p>}
        </div>
      </Card>

      {plan.status === "approved" && plan.signatureImage && (
        <Card className="p-4">
          <h2 className="font-bold text-[#032d60] mb-3">Digital Signature</h2>
          <div className="flex items-start gap-4">
            <div>
              <img src={plan.signatureImage} alt="Signature" className="h-16 border rounded bg-white p-1" />
              <p className="text-sm font-medium mt-1">{plan.signerName}</p>
              {plan.signerTitle && <p className="text-xs text-muted-foreground">{plan.signerTitle}</p>}
              <p className="text-xs text-muted-foreground">{plan.clientCompany}</p>
              {plan.approvedAt && <p className="text-xs text-muted-foreground mt-1">Signed {format(new Date(plan.approvedAt), "MMMM d, yyyy 'at' h:mm a")}</p>}
            </div>
          </div>
        </Card>
      )}

      {plan.status === "declined" && (
        <Card className="p-4 border-l-4 border-l-red-400">
          <h2 className="font-bold text-red-700 mb-2">Decline Details</h2>
          <p className="text-sm"><span className="font-medium">Reason:</span> {plan.declineReason}</p>
          {plan.declineNote && <p className="text-sm mt-1"><span className="font-medium">Note:</span> {plan.declineNote}</p>}
        </Card>
      )}

      <Card className="p-4">
        <h2 className="font-bold text-[#032d60] mb-3">Plan Content</h2>
        <div className="space-y-4 text-sm">
          {content.executiveSummary && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Executive Summary</p>
              <p className="text-gray-700 leading-relaxed">{content.executiveSummary as string}</p>
            </div>
          )}
          {Array.isArray(content.recommendedServices) && content.recommendedServices.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Recommended Services</p>
              <div className="space-y-2">
                {content.recommendedServices.map((s, i) => (
                  <div key={i} className="p-2 rounded bg-[#f0f7ff] border border-[#0176d3]/20">
                    <p className="font-medium text-[#032d60]">{s.service}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{s.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Partner Selector Modal ───────────────────────────────────────────────────

function PartnerSelectorModal({ partners, onSelect, onCancel }: {
  partners: Partner[];
  onSelect: (partner: Partner) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = partners.filter(p =>
    !search || p.companyName.toLowerCase().includes(search.toLowerCase()) ||
    p.contactName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-[#032d60] text-lg">Select Partner</h2>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search partners..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            <button
              onClick={() => onSelect({ id: 0, companyName: "Siebert Admin (no partner)", contactName: "", email: "" })}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted transition-colors"
            >
              <p className="font-medium text-sm text-[#032d60]">Create without assigning a partner</p>
              <p className="text-xs text-muted-foreground">Plan will not be linked to a specific partner account</p>
            </button>
            {filtered.map(p => (
              <button key={p.id} onClick={() => onSelect(p)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted transition-colors">
                <p className="font-medium text-sm text-[#032d60]">{p.companyName}</p>
                <p className="text-xs text-muted-foreground">{p.contactName} · {p.email}</p>
              </button>
            ))}
            {filtered.length === 0 && partners.length > 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No partners match your search.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type View = "list" | "select-partner" | "wizard" | "detail";

export default function AdminPlans() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [plans, setPlans] = useState<WrittenPlan[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [partnerFilter, setPartnerFilter] = useState("all");
  const [view, setView] = useState<View>("list");
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [detailData, setDetailData] = useState<{ plan: WrittenPlan; events: ActivityEvent[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [wizardPartnerId, setWizardPartnerId] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) {
      setLocation("/dashboard");
    }
  }, [authLoading, user, setLocation]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, partnersRes] = await Promise.all([
        fetch("/api/partner/plans", { headers: authHeader() }),
        fetch("/api/admin/partners", { headers: authHeader() }),
      ]);
      if (plansRes.ok) { const d = await plansRes.json(); setPlans(d.plans || []); }
      if (partnersRes.ok) { const d = await partnersRes.json(); setPartners(d.partners || d || []); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadDetail(id: number) {
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/partner/plans/${id}`, { headers: authHeader() });
      if (r.ok) { const d = await r.json(); setDetailData(d); }
    } finally { setDetailLoading(false); }
  }

  function openDetail(id: number) {
    setSelectedPlanId(id);
    setView("detail");
    loadDetail(id);
  }

  function handleSelectPartner(partner: Partner) {
    setWizardPartnerId(partner.id === 0 ? undefined : partner.id);
    setView("wizard");
  }

  function handleWizardComplete(plan: WrittenPlan) {
    toast({ title: "Plan created successfully" });
    setView("list");
    setPlans(prev => [plan, ...prev]);
  }

  const partnerMap = React.useMemo(() => {
    const m: Record<number, string> = {};
    partners.forEach(p => { m[p.id] = p.companyName; });
    return m;
  }, [partners]);

  const filtered = plans.filter(p => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (partnerFilter !== "all") {
      if (partnerFilter === "none") { if (p.partnerId !== null) return false; }
      else if (p.partnerId !== parseInt(partnerFilter)) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return p.clientCompany.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        p.clientEmail.toLowerCase().includes(q) ||
        p.planNumber.toLowerCase().includes(q);
    }
    return true;
  });

  const stats = {
    total: plans.length,
    approved: plans.filter(p => p.status === "approved").length,
    pending: plans.filter(p => ["sent", "viewed"].includes(p.status)).length,
    declined: plans.filter(p => p.status === "declined").length,
  };

  if (view === "select-partner") {
    return (
      <PortalLayout>
        <PartnerSelectorModal
          partners={partners}
          onSelect={handleSelectPartner}
          onCancel={() => setView("list")}
        />
        <div className="max-w-5xl mx-auto px-4 py-6 opacity-30 pointer-events-none select-none">
          <h1 className="text-2xl font-bold text-[#032d60]">Written Plans (Admin)</h1>
        </div>
      </PortalLayout>
    );
  }

  if (view === "wizard") {
    return (
      <PortalLayout>
        <div className="max-w-5xl mx-auto px-4 py-6">
          <PlanWizard
            onComplete={handleWizardComplete}
            onCancel={() => setView("list")}
            onBehalfOfPartnerId={wizardPartnerId}
          />
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        {view === "list" ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-[#032d60]">Written Plans (Admin)</h1>
                <p className="text-muted-foreground text-sm mt-1">All IT Assessment Plans across all partners</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </Button>
                <Button size="sm" onClick={() => setView("select-partner")} className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Create Plan
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { label: "Total", value: stats.total, color: "text-[#032d60]" },
                { label: "Approved", value: stats.approved, color: "text-green-600" },
                { label: "Awaiting", value: stats.pending, color: "text-blue-600" },
                { label: "Declined", value: stats.declined, color: "text-red-600" },
              ].map(s => (
                <Card key={s.label} className="p-4 text-center">
                  <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                </Card>
              ))}
            </div>

            <div className="flex gap-3 mb-4 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search by company, client, or plan #..."
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none">
                <option value="all">All Statuses</option>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <select value={partnerFilter} onChange={e => setPartnerFilter(e.target.value)}
                className="border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none">
                <option value="all">All Partners</option>
                <option value="none">No Partner (Admin)</option>
                {partners.map(p => (
                  <option key={p.id} value={String(p.id)}>{p.companyName}</option>
                ))}
              </select>
            </div>

            {loading ? (
              <div className="flex justify-center py-16"><Loader className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No plans found.</p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Client</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Partner</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Created</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map(plan => (
                      <tr key={plan.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[#032d60]">{plan.clientCompany}</p>
                          <p className="text-xs text-muted-foreground">{plan.planNumber} · v{plan.version}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{plan.clientName}</p>
                          <p className="text-xs text-muted-foreground">{plan.clientEmail}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell text-xs">
                          {plan.partnerId ? (partnerMap[plan.partnerId] || `ID ${plan.partnerId}`) : "Admin"}
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <StatusBadge status={plan.status} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                          {format(new Date(plan.createdAt), "MMM d, yyyy")}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="ghost" size="sm" onClick={() => openDetail(plan.id)}>View</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          detailLoading ? (
            <div className="flex justify-center py-20"><Loader className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : detailData ? (
            <PlanDetailPanel
              plan={detailData.plan}
              events={detailData.events}
              partnerName={detailData.plan.partnerId ? partnerMap[detailData.plan.partnerId] : undefined}
              onBack={() => { setSelectedPlanId(null); setDetailData(null); setView("list"); }}
            />
          ) : null
        )}
      </div>
    </PortalLayout>
  );
}
