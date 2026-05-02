import { useEffect, useMemo, useState, useCallback } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  Search,
  Download,
  RefreshCw,
  Mail,
  X,
  AlertCircle,
  Loader2,
  Clock,
  CheckCircle2,
  PauseCircle,
  Settings,
  Building2,
  Users,
  CreditCard,
  ShieldCheck,
  UserPlus,
  Copy,
  Ban,
  Calendar,
  KeyRound,
} from "lucide-react";

type FlowKey = "client_onboarding" | "partner_application" | "partner_team_invite" | "stripe_connect" | "admin_account";

interface UnifiedRow {
  flow: FlowKey;
  id: number;
  label: string;
  subLabel: string | null;
  email: string | null;
  status: string;
  statusKind: "pending" | "in_progress" | "complete" | "stalled" | "blocked";
  startedAt: string | null;
  updatedAt: string | null;
  ageHours: number | null;
  staleHours: number | null;
  blockingReason: string | null;
  reminderCount: number;
  lastReminderSentAt: string | null;
  partnerId?: number | null;
  partnerCompanyName?: string | null;
  // partner_team_invite extras
  inviterName?: string | null;
  inviterCompany?: string | null;
  inviteExpiresAt?: string | null;
  isExpired?: boolean;
  // Microsoft SSO (Entra B2B) lifecycle (Task #191).
  // msObjectId presence means the account is linked to a guest user in
  // the Entra tenant and can sign in via Microsoft.
  msObjectId?: string | null;
  ssoInviteSentAt?: string | null;
  ssoInviteSentBy?: string | null;
}

interface OnboardingSettings {
  paused: boolean;
  clientOnboardingOverdueHours: number;
  partnerApplicationOverdueHours: number;
  partnerTeamInviteOverdueHours: number;
  stripeConnectOverdueHours: number;
  adminAccountOverdueHours: number;
  reminderCooldownHours: number;
  maxRemindersPerEntity: number;
}

interface OverviewResponse {
  rows: UnifiedRow[];
  settings: OnboardingSettings;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

interface DetailEvent {
  id: number;
  flow: string;
  entityId: number;
  eventType: string;
  actorType: string;
  actorId: number | null;
  actorLabel: string | null;
  note: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface DetailResponse {
  flow: FlowKey;
  id: number;
  summary: Record<string, unknown>;
  entity: Record<string, unknown>;
  events: DetailEvent[];
}

const FLOW_LABELS: Record<FlowKey, string> = {
  client_onboarding: "Client Onboarding",
  partner_application: "Partner Application",
  partner_team_invite: "Team Invite",
  stripe_connect: "Stripe Connect",
  admin_account: "Admin Account",
};

const FLOW_ICONS: Record<FlowKey, React.ComponentType<{ className?: string }>> = {
  client_onboarding: Building2,
  partner_application: UserPlus,
  partner_team_invite: Users,
  stripe_connect: CreditCard,
  admin_account: ShieldCheck,
};

const STATUS_BADGE: Record<UnifiedRow["statusKind"], string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-300",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  complete: "bg-emerald-50 text-emerald-700 border-emerald-200",
  stalled: "bg-amber-50 text-amber-800 border-amber-300",
  blocked: "bg-red-50 text-red-700 border-red-300",
};

function formatAge(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return "<1h";
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function getQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

export default function OnboardingCommandCenter() {
  const { user } = useAuth();
  const { toast } = useToast();
  const headers = getAuthHeaders();

  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [settings, setSettings] = useState<OnboardingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const initialFlow = (getQueryParam("flow") as FlowKey | null) ?? null;
  const [flowFilter, setFlowFilter] = useState<FlowKey | "all">(initialFlow ?? "all");
  const [statusFilter, setStatusFilter] = useState<UnifiedRow["statusKind"] | "all">("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [selected, setSelected] = useState<UnifiedRow | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  /** Build the shared query string used by both overview JSON and CSV export. */
  const buildFilterParams = useCallback((): URLSearchParams => {
    const params = new URLSearchParams();
    if (flowFilter !== "all") params.set("flow", flowFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (search.trim()) params.set("q", search.trim());
    if (dateFrom) params.set("from", new Date(dateFrom + "T00:00:00").toISOString());
    if (dateTo) params.set("to", new Date(dateTo + "T23:59:59").toISOString());
    return params;
  }, [flowFilter, statusFilter, search, dateFrom, dateTo]);

  const loadOverview = useCallback(async (opts?: { page?: number; pageSize?: number }) => {
    setLoading(true);
    try {
      const params = buildFilterParams();
      params.set("page", String(opts?.page ?? page));
      params.set("pageSize", String(opts?.pageSize ?? pageSize));
      const url = `/api/admin/onboarding/overview?${params}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as OverviewResponse;
      setRows(data.rows);
      setSettings(data.settings);
      setPage(data.page);
      setPageSize(data.pageSize);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setHasMore(data.hasMore);
    } catch (err) {
      toast({ title: "Failed to load", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [buildFilterParams, headers, toast, page, pageSize]);

  // Reset to page 1 whenever a filter changes; the load itself fires on page change.
  useEffect(() => {
    setPage(1);
    loadOverview({ page: 1 });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [flowFilter, statusFilter, dateFrom, dateTo]);

  // Debounce search — also reset to page 1 so narrowing the result set
  // doesn't leave the user on an empty trailing page.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      loadOverview({ page: 1 });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const counts = useMemo(() => {
    const c = { open: 0, stalled: 0, blocked: 0, complete: 0 };
    for (const r of rows) {
      if (r.statusKind === "complete") c.complete++;
      else c.open++;
      if (r.statusKind === "stalled") c.stalled++;
      if (r.statusKind === "blocked") c.blocked++;
    }
    return c;
  }, [rows]);

  async function openDetail(row: UnifiedRow) {
    setSelected(row);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/onboarding/${row.flow}/${row.id}`, { headers });
      if (!res.ok) throw new Error(await res.text());
      setDetail(await res.json());
    } catch (err) {
      toast({ title: "Failed to load detail", description: String(err), variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  }

  async function sendReminder(row: UnifiedRow, force = false) {
    setActionLoading(`remind-${row.flow}-${row.id}`);
    try {
      const res = await fetch(`/api/admin/onboarding/${row.flow}/${row.id}/remind`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body?.error === "cooldown_active" && !force) {
          if (window.confirm("A reminder was sent recently. Send another anyway?")) {
            await sendReminder(row, true);
          }
          return;
        }
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      }
      toast({ title: "Reminder sent", description: `Sent to ${body.sentTo}` });
      await loadOverview();
      if (selected && selected.flow === row.flow && selected.id === row.id) {
        await openDetail(row);
      }
    } catch (err) {
      toast({ title: "Reminder failed", description: String((err as Error).message ?? err), variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * Send (or re-send) a Microsoft Entra B2B guest invite for the given
   * row. Surfaces the raw Graph error verbatim in the failure toast so
   * admins can diagnose tenant/policy/permission problems without
   * digging through server logs.
   */
  async function sendSsoInvite(row: UnifiedRow) {
    const verb = row.msObjectId ? "Re-send" : "Send";
    if (!window.confirm(`${verb} a Microsoft SSO invite to ${row.email ?? row.label}?`)) return;
    setActionLoading(`sso-${row.flow}-${row.id}`);
    try {
      const res = await fetch(`/api/admin/onboarding/${row.flow}/${row.id}/send-sso-invite`, {
        method: "POST",
        headers,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Verbatim Graph error so the admin sees exactly what went wrong.
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      }
      toast({
        title: body.alreadyExisted ? "SSO invite re-sent" : "SSO invite sent",
        description: `${body.sentTo}${body.msObjectId ? ` · objectId ${String(body.msObjectId).slice(0, 8)}…` : ""}`,
      });
      await loadOverview();
      if (selected && selected.flow === row.flow && selected.id === row.id) {
        await openDetail(row);
      }
    } catch (err) {
      toast({
        title: "SSO invite failed",
        description: String((err as Error).message ?? err),
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function refreshStripe(row: UnifiedRow) {
    if (row.flow !== "stripe_connect") return;
    setActionLoading(`stripe-${row.id}`);
    try {
      const res = await fetch(`/api/admin/onboarding/stripe-connect/${row.id}/refresh`, {
        method: "POST",
        headers,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      toast({ title: "Stripe status refreshed", description: body?.status?.status ?? "" });
      await loadOverview();
      if (selected && selected.flow === row.flow && selected.id === row.id) {
        await openDetail(row);
      }
    } catch (err) {
      toast({ title: "Refresh failed", description: String((err as Error).message ?? err), variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }

  async function exportCsv() {
    try {
      // Pass the same filters used for the visible list so the CSV matches.
      const params = buildFilterParams();
      const url = `/api/admin/onboarding/export.csv${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `onboarding-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    }
  }

  /**
   * Revoke a pending partner team invite from the central command center.
   * Confirms with the admin first since this invalidates any outstanding
   * invitation link.
   */
  async function revokeInvite(row: UnifiedRow) {
    if (row.flow !== "partner_team_invite") return;
    if (!window.confirm(`Revoke invite for ${row.label}? Any outstanding invite link will stop working.`)) return;
    setActionLoading(`revoke-${row.id}`);
    try {
      const res = await fetch(`/api/admin/onboarding/partner-team-invite/${row.id}/revoke`, {
        method: "POST",
        headers,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      toast({ title: "Invite revoked" });
      await loadOverview();
      if (selected && selected.flow === row.flow && selected.id === row.id) {
        await openDetail(row);
      }
    } catch (err) {
      toast({ title: "Revoke failed", description: String((err as Error).message ?? err), variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * Approve or reject a partner application from inside the command center.
   * Hits the existing `PUT /api/admin/partners/:id` endpoint which handles
   * approval-side effects (temp-password issuance for SSO partners, approval
   * email, Stripe Connect auto-init, PartnerStack push) and records an
   * onboarding event.
   */
  async function decidePartner(row: UnifiedRow, decision: "approved" | "rejected") {
    if (row.flow !== "partner_application") return;
    const verb = decision === "approved" ? "Approve" : "Reject";
    if (!window.confirm(`${verb} partner application from ${row.label}?`)) return;
    setActionLoading(`decide-${row.id}`);
    try {
      const res = await fetch(`/api/admin/partners/${row.id}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ status: decision }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      toast({ title: `Partner ${decision}`, description: row.label });
      await loadOverview();
      if (selected && selected.flow === row.flow && selected.id === row.id) {
        await openDetail(row);
      }
    } catch (err) {
      toast({ title: `${verb} failed`, description: String((err as Error).message ?? err), variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }

  /** Copy a string to the clipboard with a toast. */
  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard not available", variant: "destructive" });
    }
  }

  async function togglePause() {
    if (!settings) return;
    try {
      const res = await fetch("/api/admin/onboarding/settings", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !settings.paused }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = (await res.json()) as OnboardingSettings;
      setSettings(updated);
      toast({ title: updated.paused ? "Reminders paused" : "Reminders resumed" });
    } catch (err) {
      toast({ title: "Failed", description: String(err), variant: "destructive" });
    }
  }

  async function saveSettings(patch: Partial<OnboardingSettings>) {
    try {
      const res = await fetch("/api/admin/onboarding/settings", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = (await res.json()) as OnboardingSettings;
      setSettings(updated);
      toast({ title: "Settings saved" });
    } catch (err) {
      toast({ title: "Failed", description: String(err), variant: "destructive" });
    }
  }

  if (!user) return null;

  return (
    <PortalLayout>
      <div className="sf-page-header px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Activity className="w-5 h-5 text-[#0176d3]" />
              Onboarding Command Center
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              All five onboarding flows in one place — applications, clients, team invites, Stripe Connect, and admin accounts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {settings?.paused && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                <PauseCircle className="w-3 h-3" />Reminders paused
              </span>
            )}
            <button
              onClick={togglePause}
              className="px-3 py-1.5 text-xs border border-[#d8dde6] rounded hover:bg-slate-50 flex items-center gap-1.5"
            >
              <PauseCircle className="w-3.5 h-3.5" />{settings?.paused ? "Resume reminders" : "Pause reminders"}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="px-3 py-1.5 text-xs border border-[#d8dde6] rounded hover:bg-slate-50 flex items-center gap-1.5"
            >
              <Settings className="w-3.5 h-3.5" />Thresholds
            </button>
            <button
              onClick={exportCsv}
              className="px-3 py-1.5 text-xs border border-[#d8dde6] rounded hover:bg-slate-50 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />Export CSV
            </button>
            <button
              onClick={() => loadOverview()}
              className="px-3 py-1.5 text-xs bg-[#0176d3] text-white rounded hover:bg-[#014486] flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <KpiTile label="Open items" value={counts.open} icon={Clock} color="#0176d3" />
          <KpiTile label="Stalled" value={counts.stalled} icon={AlertCircle} color="#fe9339" />
          <KpiTile label="Blocked" value={counts.blocked} icon={AlertCircle} color="#ea001e" />
          <KpiTile label="Completed" value={counts.complete} icon={CheckCircle2} color="#2e844a" />
        </div>

        {/* Filters */}
        <div className="sf-card mb-4">
          <div className="p-3 flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, name, or email…"
                className="w-full pl-9 pr-3 py-1.5 border border-[#d8dde6] rounded text-sm focus:outline-none focus:border-[#0176d3]"
              />
            </div>
            <select
              value={flowFilter}
              onChange={(e) => setFlowFilter(e.target.value as FlowKey | "all")}
              className="px-3 py-1.5 border border-[#d8dde6] rounded text-sm focus:outline-none focus:border-[#0176d3]"
            >
              <option value="all">All flows</option>
              {(Object.keys(FLOW_LABELS) as FlowKey[]).map((f) => (
                <option key={f} value={f}>{FLOW_LABELS[f]}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as UnifiedRow["statusKind"] | "all")}
              className="px-3 py-1.5 border border-[#d8dde6] rounded text-sm focus:outline-none focus:border-[#0176d3]"
            >
              <option value="all">All statuses</option>
              <option value="blocked">Blocked</option>
              <option value="stalled">Stalled</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="complete">Complete</option>
            </select>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Started</span>
            </div>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2 py-1.5 border border-[#d8dde6] rounded text-sm focus:outline-none focus:border-[#0176d3]"
              aria-label="Started on or after"
              title="Started on or after"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2 py-1.5 border border-[#d8dde6] rounded text-sm focus:outline-none focus:border-[#0176d3]"
              aria-label="Started on or before"
              title="Started on or before"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="text-[11px] text-muted-foreground underline hover:text-foreground"
              >
                Clear dates
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="sf-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f3f3f3] text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Flow</th>
                  <th className="text-left font-semibold px-3 py-2">Entity</th>
                  <th className="text-left font-semibold px-3 py-2">Status</th>
                  <th className="text-left font-semibold px-3 py-2">Age</th>
                  <th className="text-left font-semibold px-3 py-2">Inactive</th>
                  <th className="text-left font-semibold px-3 py-2">Blocking</th>
                  <th className="text-right font-semibold px-3 py-2">Reminders</th>
                  <th className="text-left font-semibold px-3 py-2">SSO</th>
                  <th className="text-right font-semibold px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />Loading…</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">No items match the current filters.</td></tr>
                )}
                {!loading && rows.map((row) => {
                  const Icon = FLOW_ICONS[row.flow];
                  return (
                    <tr key={`${row.flow}-${row.id}`} className="border-t border-[#e5e5e5] hover:bg-[#fafbfc] cursor-pointer" onClick={() => openDetail(row)}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 text-xs text-foreground">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                          {FLOW_LABELS[row.flow]}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{row.label}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {row.email ?? row.subLabel ?? ""}
                          {row.partnerCompanyName && row.partnerCompanyName !== row.label ? ` · ${row.partnerCompanyName}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${STATUS_BADGE[row.statusKind]}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatAge(row.ageHours)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatAge(row.staleHours)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[260px] truncate" title={row.blockingReason ?? ""}>
                        {row.blockingReason ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                        {row.reminderCount}
                        {row.lastReminderSentAt && (
                          <div className="text-[10px]">last {formatDate(row.lastReminderSentAt)}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.msObjectId ? (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 font-semibold text-[11px]"
                            title={`Linked to Microsoft objectId ${row.msObjectId}${row.ssoInviteSentAt ? ` · last invite ${formatDate(row.ssoInviteSentAt)}` : ""}${row.ssoInviteSentBy ? ` by ${row.ssoInviteSentBy}` : ""}`}
                          >
                            <ShieldCheck className="w-3 h-3" /> Linked
                          </span>
                        ) : row.ssoInviteSentAt ? (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 font-semibold text-[11px]"
                            title={`Invite sent ${formatDate(row.ssoInviteSentAt)}${row.ssoInviteSentBy ? ` by ${row.ssoInviteSentBy}` : ""} — awaiting redemption`}
                          >
                            <Mail className="w-3 h-3" /> Invited
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          {row.statusKind !== "complete" && (
                            <button
                              onClick={() => sendReminder(row)}
                              disabled={actionLoading === `remind-${row.flow}-${row.id}`}
                              className="px-2 py-1 text-[11px] border border-[#d8dde6] rounded hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1"
                              title="Send reminder email"
                            >
                              {actionLoading === `remind-${row.flow}-${row.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                              Remind
                            </button>
                          )}
                          {row.email && (
                            <button
                              onClick={() => sendSsoInvite(row)}
                              disabled={actionLoading === `sso-${row.flow}-${row.id}`}
                              className="px-2 py-1 text-[11px] border border-[#d8dde6] rounded hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1"
                              title={row.msObjectId ? "Re-send Microsoft SSO invite" : "Send Microsoft SSO invite"}
                            >
                              {actionLoading === `sso-${row.flow}-${row.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                              {row.msObjectId ? "Re-send SSO" : "Send SSO"}
                            </button>
                          )}
                          {row.flow === "stripe_connect" && (
                            <button
                              onClick={() => refreshStripe(row)}
                              disabled={actionLoading === `stripe-${row.id}`}
                              className="px-2 py-1 text-[11px] border border-[#d8dde6] rounded hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1"
                              title="Refresh Stripe status"
                            >
                              {actionLoading === `stripe-${row.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                              Refresh
                            </button>
                          )}
                          {row.flow === "partner_team_invite" && row.statusKind !== "complete" && !row.isExpired && (
                            <button
                              onClick={() => revokeInvite(row)}
                              disabled={actionLoading === `revoke-${row.id}`}
                              className="px-2 py-1 text-[11px] border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1"
                              title="Revoke this invite"
                            >
                              {actionLoading === `revoke-${row.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                              Revoke
                            </button>
                          )}
                          {row.flow === "partner_application" && (row.status === "pending" || row.status === "applied" || row.status === "in_review") && (
                            <>
                              <button
                                onClick={() => decidePartner(row, "approved")}
                                disabled={actionLoading === `decide-${row.id}`}
                                className="px-2 py-1 text-[11px] border border-emerald-200 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 inline-flex items-center gap-1"
                                title="Approve this partner application"
                              >
                                {actionLoading === `decide-${row.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                Approve
                              </button>
                              <button
                                onClick={() => decidePartner(row, "rejected")}
                                disabled={actionLoading === `decide-${row.id}`}
                                className="px-2 py-1 text-[11px] border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1"
                                title="Reject this partner application"
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="border-t border-[#d8dde6] px-4 py-2 flex items-center justify-between text-xs text-muted-foreground bg-[#fafbfc]">
            <div>
              {total === 0
                ? "No results"
                : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <span>Rows / page</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const ps = parseInt(e.target.value) || 50;
                    setPageSize(ps);
                    setPage(1);
                    loadOverview({ page: 1, pageSize: ps });
                  }}
                  className="border border-[#d8dde6] rounded px-1.5 py-0.5 bg-white"
                >
                  {[25, 50, 100, 200].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <button
                disabled={page <= 1 || loading}
                onClick={() => { const p = Math.max(1, page - 1); setPage(p); loadOverview({ page: p }); }}
                className="px-2 py-1 border border-[#d8dde6] rounded bg-white disabled:opacity-40"
              >Prev</button>
              <span className="px-1">Page {page} / {totalPages}</span>
              <button
                disabled={!hasMore || loading}
                onClick={() => { const p = page + 1; setPage(p); loadOverview({ page: p }); }}
                className="px-2 py-1 border border-[#d8dde6] rounded bg-white disabled:opacity-40"
              >Next</button>
            </div>
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      {selected && (
        <DetailDrawer
          row={selected}
          detail={detail}
          loading={detailLoading}
          onClose={() => { setSelected(null); setDetail(null); }}
          onRemind={() => sendReminder(selected)}
          onRefreshStripe={selected.flow === "stripe_connect" ? () => refreshStripe(selected) : null}
          onRevoke={selected.flow === "partner_team_invite" ? () => revokeInvite(selected) : null}
          onSendSso={() => sendSsoInvite(selected)}
          onCopy={copyText}
          actionLoading={actionLoading}
        />
      )}

      {/* Settings modal */}
      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </PortalLayout>
  );
}

function KpiTile({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; }) {
  return (
    <div className="sf-card p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: `${color}15` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div>
        <div className="text-[11px] text-muted-foreground uppercase font-semibold">{label}</div>
        <div className="text-xl font-bold text-foreground">{value}</div>
      </div>
    </div>
  );
}

function DetailDrawer({
  row, detail, loading, onClose, onRemind, onRefreshStripe, onRevoke, onSendSso, onCopy, actionLoading,
}: {
  row: UnifiedRow;
  detail: DetailResponse | null;
  loading: boolean;
  onClose: () => void;
  onRemind: () => void;
  onRefreshStripe: (() => void) | null;
  onRevoke: (() => void) | null;
  onSendSso: () => void;
  onCopy: (value: string, label: string) => void;
  actionLoading: string | null;
}) {
  // Pull a resume / portal link out of the detail entity, depending on flow.
  // - client_onboarding & partner_team_invite: prefer a stable URL stored on
  //   the entity if available (e.g. portalUrl, inviteUrl), otherwise build a
  //   recovery link that admins can paste into their own message.
  const resumeLink: { url: string; label: string } | null = (() => {
    if (!detail) return null;
    const e = detail.entity as Record<string, unknown>;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (row.flow === "client_onboarding") {
      const url = (e.portalUrl as string) || (e.resumeUrl as string) || null;
      if (url) return { url, label: "Client portal link" };
      return null;
    }
    if (row.flow === "partner_team_invite") {
      const token = (e.inviteToken as string) || null;
      if (!token) return null;
      const url = (e.inviteUrl as string) || `${origin}/team/accept/${token}`;
      return { url, label: "Invite link" };
    }
    return null;
  })();

  // Captured "step data" / form data — flow-specific. Falls back to a generic
  // JSON view of the entity if the flow doesn't have a curated mapping.
  function renderCapturedData() {
    if (!detail) return null;
    const e = detail.entity as Record<string, unknown>;
    if (row.flow === "client_onboarding") {
      const stepData = (e.stepData as Record<string, unknown>) ?? {};
      const keys = Object.keys(stepData);
      return (
        <div className="border border-[#e5e5e5] rounded p-3 text-xs space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Current step" value={String(e.currentStep ?? "—")} />
            <Stat label="Status" value={String(e.status ?? "—")} />
            <Stat label="Plan ID" value={String(e.planId ?? "—")} />
            <Stat label="Partner ID" value={String(e.partnerId ?? "—")} />
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase font-semibold mt-2 mb-1">
              Captured step data ({keys.length} step{keys.length === 1 ? "" : "s"})
            </div>
            {keys.length === 0 ? (
              <div className="text-muted-foreground italic">No step data captured yet.</div>
            ) : (
              <pre className="bg-slate-50 border border-slate-200 rounded p-2 max-h-64 overflow-auto text-[11px] leading-snug">
{JSON.stringify(stepData, null, 2)}
              </pre>
            )}
          </div>
        </div>
      );
    }
    if (row.flow === "partner_application") {
      return (
        <div className="border border-[#e5e5e5] rounded p-3 text-xs grid grid-cols-2 gap-2">
          <Stat label="Company" value={String(e.companyName ?? "—")} />
          <Stat label="Contact" value={String(e.contactName ?? "—")} />
          <Stat label="Phone" value={String(e.phone ?? "—")} />
          <Stat label="Status" value={String(e.status ?? "—")} />
          <Stat label="Tier" value={String(e.tier ?? "—")} />
          <Stat label="Partner type" value={String(e.partnerType ?? "—")} />
        </div>
      );
    }
    if (row.flow === "partner_team_invite") {
      const expired = Boolean(row.isExpired);
      const inviterLabel = row.inviterName
        ? `${row.inviterName}${row.inviterCompany ? ` (${row.inviterCompany})` : ""}`
        : (row.inviterCompany ?? "—");
      return (
        <div className="border border-[#e5e5e5] rounded p-3 text-xs grid grid-cols-2 gap-2">
          <Stat label="Name" value={String(e.name ?? "—")} />
          <Stat label="Role" value={String(e.role ?? "—")} />
          <Stat label="Invited by" value={inviterLabel} />
          <Stat label="Invited" value={formatDate((e.invitedAt as string) ?? null)} />
          <Stat label="Accepted" value={formatDate((e.acceptedAt as string) ?? null)} />
          <Stat
            label="Token expires"
            value={
              <span className={expired ? "text-red-600 font-medium" : ""}>
                {formatDate((e.inviteTokenExpires as string) ?? null)}
                {expired ? " · expired" : ""}
              </span>
            }
          />
          <Stat label="Status" value={expired ? "expired" : String(e.status ?? "—")} />
        </div>
      );
    }
    if (row.flow === "stripe_connect") {
      const blockingFields = (e.stripeConnectBlockingFields as unknown) ?? null;
      return (
        <div className="border border-[#e5e5e5] rounded p-3 text-xs space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Account ID" value={String(e.stripeConnectAccountId ?? "—")} />
            <Stat label="Status" value={String(e.stripeConnectStatus ?? "—")} />
            <Stat label="Refreshed" value={formatDate((e.stripeConnectRefreshedAt as string) ?? null)} />
            <Stat label="Blocking" value={String(e.stripeConnectBlockingRequirement ?? "—")} />
          </div>
          {blockingFields ? (
            <div>
              <div className="text-[10px] text-muted-foreground uppercase font-semibold mt-2 mb-1">Blocking fields</div>
              <pre className="bg-slate-50 border border-slate-200 rounded p-2 max-h-40 overflow-auto text-[11px]">
{JSON.stringify(blockingFields, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      );
    }
    if (row.flow === "admin_account") {
      return (
        <div className="border border-[#e5e5e5] rounded p-3 text-xs grid grid-cols-2 gap-2">
          <Stat label="Name" value={String(e.name ?? "—")} />
          <Stat label="Email" value={String(e.email ?? "—")} />
          <Stat label="Company" value={String(e.company ?? "—")} />
          <Stat label="Role" value={String(e.role ?? "—")} />
          <Stat label="Last login" value={formatDate((e.lastLoginAt as string) ?? null)} />
          <Stat label="Must change pw" value={e.mustChangePassword ? "Yes" : "No"} />
          <Stat label="Welcome reminders" value={String(e.welcomeReminderCount ?? 0)} />
          <Stat label="Last welcome" value={formatDate((e.lastWelcomeSentAt as string) ?? null)} />
        </div>
      );
    }
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[560px] bg-white z-50 shadow-xl border-l border-[#d8dde6] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-[#d8dde6] px-5 py-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wide">{FLOW_LABELS[row.flow]}</div>
            <div className="text-base font-semibold text-foreground truncate max-w-[420px]">{row.label}</div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${STATUS_BADGE[row.statusKind]}`}>
              {row.status}
            </span>
            {row.email && (<span className="text-xs text-muted-foreground">{row.email}</span>)}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
            <Stat label="Started" value={formatDate(row.startedAt)} />
            <Stat label="Last activity" value={formatDate(row.updatedAt)} />
            <Stat label="Age" value={formatAge(row.ageHours)} />
            <Stat label="Inactive" value={formatAge(row.staleHours)} />
            <Stat label="Reminders" value={String(row.reminderCount)} />
            <Stat label="Last reminder" value={formatDate(row.lastReminderSentAt)} />
          </div>
          {row.blockingReason && (
            <div className="mb-4 px-3 py-2 rounded bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5" /><span>{row.blockingReason}</span>
            </div>
          )}
          <div className="flex gap-2 mb-5 flex-wrap">
            {row.statusKind !== "complete" && (
              <button
                onClick={onRemind}
                disabled={actionLoading === `remind-${row.flow}-${row.id}`}
                className="px-3 py-1.5 text-xs bg-[#0176d3] text-white rounded hover:bg-[#014486] disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {actionLoading === `remind-${row.flow}-${row.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Send reminder now
              </button>
            )}
            {onRefreshStripe && (
              <button
                onClick={onRefreshStripe}
                disabled={actionLoading === `stripe-${row.id}`}
                className="px-3 py-1.5 text-xs border border-[#d8dde6] rounded hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {actionLoading === `stripe-${row.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Refresh Stripe status
              </button>
            )}
            {resumeLink && (
              <button
                onClick={() => onCopy(resumeLink.url, resumeLink.label)}
                className="px-3 py-1.5 text-xs border border-[#d8dde6] rounded hover:bg-slate-50 inline-flex items-center gap-1.5"
                title={resumeLink.url}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy {resumeLink.label.toLowerCase()}
              </button>
            )}
            {row.email && (
              <button
                onClick={() => onCopy(row.email!, "Email")}
                className="px-3 py-1.5 text-xs border border-[#d8dde6] rounded hover:bg-slate-50 inline-flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy email
              </button>
            )}
            {onRevoke && row.statusKind !== "complete" && row.statusKind !== "blocked" && (
              <button
                onClick={onRevoke}
                disabled={actionLoading === `revoke-${row.id}`}
                className="px-3 py-1.5 text-xs border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {actionLoading === `revoke-${row.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                Revoke invite
              </button>
            )}
            {row.email && (
              <button
                onClick={onSendSso}
                disabled={actionLoading === `sso-${row.flow}-${row.id}`}
                className="px-3 py-1.5 text-xs border border-[#0176d3] text-[#0176d3] rounded hover:bg-[#0176d3]/10 disabled:opacity-50 inline-flex items-center gap-1.5"
                title={row.msObjectId ? "Re-send Microsoft SSO invite" : "Send Microsoft SSO invite"}
              >
                {actionLoading === `sso-${row.flow}-${row.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                {row.msObjectId ? "Re-send Microsoft SSO invite" : "Send Microsoft SSO invite"}
              </button>
            )}
          </div>

          {/* Microsoft SSO (Entra B2B) status */}
          <h3 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-2">Microsoft SSO</h3>
          <div className="border border-[#e5e5e5] rounded p-3 text-xs grid grid-cols-2 gap-2 mb-5">
            <Stat
              label="Link status"
              value={
                row.msObjectId
                  ? <span className="text-emerald-700 font-semibold">Linked</span>
                  : row.ssoInviteSentAt
                    ? <span className="text-amber-700 font-semibold">Invite sent · awaiting redemption</span>
                    : <span className="text-muted-foreground">Not invited</span>
              }
            />
            <Stat label="Microsoft objectId" value={row.msObjectId ?? "—"} />
            <Stat label="Last invite sent" value={formatDate(row.ssoInviteSentAt ?? null)} />
            <Stat label="Invited by" value={row.ssoInviteSentBy ?? "—"} />
          </div>

          {/* Captured onboarding data */}
          <h3 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-2">Captured Data</h3>
          <div className="mb-5">{renderCapturedData()}</div>

          <h3 className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-2">Activity Timeline</h3>
          {loading && <div className="text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />Loading…</div>}
          {!loading && detail && detail.events.length === 0 && (
            <div className="text-xs text-muted-foreground border border-dashed border-[#d8dde6] rounded px-3 py-4 text-center">
              No events recorded yet.
            </div>
          )}
          {!loading && detail && detail.events.length > 0 && (
            <ol className="space-y-2">
              {detail.events.map(e => (
                <li key={e.id} className="border border-[#e5e5e5] rounded p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-semibold text-foreground">{e.eventType.replace(/_/g, " ")}</span>
                    <span className="text-[11px] text-muted-foreground">{formatDate(e.createdAt)}</span>
                  </div>
                  {e.note && <div className="text-muted-foreground">{e.note}</div>}
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    by {e.actorType}{e.actorLabel ? ` · ${e.actorLabel}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-[#e5e5e5] rounded p-2">
      <div className="text-[10px] text-muted-foreground uppercase font-semibold">{label}</div>
      <div className="text-foreground">{value}</div>
    </div>
  );
}

function SettingsModal({ settings, onSave, onClose }: { settings: OnboardingSettings; onSave: (p: Partial<OnboardingSettings>) => void; onClose: () => void; }) {
  const [draft, setDraft] = useState<OnboardingSettings>(settings);
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded shadow-xl w-full max-w-md">
          <div className="border-b border-[#d8dde6] px-5 py-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Reminder Thresholds</h2>
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-5 space-y-3">
            {(
              [
                ["clientOnboardingOverdueHours", "Client onboarding overdue (hours)"],
                ["partnerApplicationOverdueHours", "Partner application overdue (hours)"],
                ["partnerTeamInviteOverdueHours", "Team invite overdue (hours)"],
                ["stripeConnectOverdueHours", "Stripe Connect overdue (hours)"],
                ["adminAccountOverdueHours", "Admin account overdue (hours)"],
                ["reminderCooldownHours", "Reminder cooldown (hours)"],
                ["maxRemindersPerEntity", "Max automated reminders / entity"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="block text-xs font-medium text-muted-foreground mb-1">{label}</span>
                <input
                  type="number"
                  min={1}
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: parseInt(e.target.value) || 0 })}
                  className="w-full px-2.5 py-1.5 border border-[#d8dde6] rounded text-sm"
                />
              </label>
            ))}
          </div>
          <div className="border-t border-[#d8dde6] px-5 py-3 flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs border border-[#d8dde6] rounded">Cancel</button>
            <button
              onClick={() => { onSave(draft); onClose(); }}
              className="px-3 py-1.5 text-xs bg-[#0176d3] text-white rounded hover:bg-[#014486]"
            >Save</button>
          </div>
        </div>
      </div>
    </>
  );
}
