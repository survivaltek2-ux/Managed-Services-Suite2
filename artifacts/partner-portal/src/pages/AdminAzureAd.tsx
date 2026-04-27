import { useEffect, useMemo, useState } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  ShieldCheck, AlertTriangle, CheckCircle, XCircle, Loader2, RefreshCw,
  Cloud, Plus, Trash2, Copy, Key, Users, Eye, History, Settings, FileText,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("partner_token") || localStorage.getItem("token") || "";
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : ({} as any);
  if (!res.ok) throw new Error(data?.message || data?.error || `Request failed (${res.status})`);
  return data as T;
}

function formatDateTime(s: string | null | undefined) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types from API server
// ─────────────────────────────────────────────────────────────────────────────

type RolloutMode = "disabled" | "audit" | "enforce";

interface StatusResp {
  rolloutMode: RolloutMode;
  graphConfigured: boolean;
  graphReachable: boolean;
  breakGlassEmailCount: number;
  mappingRulesCount: number;
  lastSyncAt: string | null;
}

interface MappingTarget {
  portal: "client" | "partner" | "admin";
  role: "client" | "admin" | "partner" | "team_member";
  isAdmin: boolean;
  permissions?: Record<string, boolean>;
  label?: string;
}

interface MappingRule {
  type: "appRole" | "group" | "domain";
  match: string;
  target: MappingTarget;
}

interface MappingConfig {
  rules: MappingRule[];
  defaultDeny: boolean;
  notAuthorizedMessage: string;
  contactEmail: string;
}

interface AppRole {
  id: string;
  value: string;
  displayName: string;
  description?: string;
  isEnabled?: boolean;
}

interface GroupBinding {
  id: number;
  groupOid: string;
  groupDisplayName: string;
  partnerId: number;
  isCompanyAdmin: boolean;
  permissionsJson: Record<string, boolean>;
  createdAt: string;
}

interface ScimToken {
  id: number;
  label: string;
  lastSeenAt: string | null;
  createdAt: string;
}

interface RevokedSession {
  jti: string;
  email: string | null;
  reason: string | null;
  revokedAt: string;
  expiresAt: string | null;
}

interface AuditEvent {
  id: number;
  eventType: string;
  email: string | null;
  source: string;
  decision: string;
  rolloutMode: string;
  details: any;
  occurredAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminAzureAd() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState("overview");

  if (!user?.isAdmin) {
    return (
      <PortalLayout>
        <Card><CardContent className="p-6">Admin access required.</CardContent></Card>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold">Microsoft Entra ID (Azure AD)</h1>
            <p className="text-sm text-muted-foreground">Source-of-truth identity, access, and audit configuration.</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="setup">Setup Guide</TabsTrigger>
            <TabsTrigger value="rollout">Rollout</TabsTrigger>
            <TabsTrigger value="mapping">Mapping</TabsTrigger>
            <TabsTrigger value="groups">Groups</TabsTrigger>
            <TabsTrigger value="approles">App Roles</TabsTrigger>
            <TabsTrigger value="test">Test</TabsTrigger>
            <TabsTrigger value="scim">SCIM</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4"><OverviewTab toast={toast} /></TabsContent>
          <TabsContent value="setup" className="mt-4"><SetupTab /></TabsContent>
          <TabsContent value="rollout" className="mt-4"><RolloutTab toast={toast} /></TabsContent>
          <TabsContent value="mapping" className="mt-4"><MappingTab toast={toast} /></TabsContent>
          <TabsContent value="groups" className="mt-4"><GroupsTab toast={toast} /></TabsContent>
          <TabsContent value="approles" className="mt-4"><AppRolesTab toast={toast} /></TabsContent>
          <TabsContent value="test" className="mt-4"><TestTab /></TabsContent>
          <TabsContent value="scim" className="mt-4"><ScimTab toast={toast} /></TabsContent>
          <TabsContent value="sessions" className="mt-4"><SessionsTab toast={toast} /></TabsContent>
          <TabsContent value="audit" className="mt-4"><AuditTab toast={toast} /></TabsContent>
        </Tabs>
      </div>
    </PortalLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Overview
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab({ toast }: { toast: any }) {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [orphans, setOrphans] = useState<{ users: any[]; partners: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [s, o] = await Promise.all([
        api<StatusResp>("/api/admin/azure-ad/status"),
        api<{ users: any[]; partners: any[] }>("/api/admin/azure-ad/orphans"),
      ]);
      setStatus(s);
      setOrphans(o);
    } catch (e: any) {
      toast({ title: "Failed to load status", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await api("/api/admin/azure-ad/sync/run", { method: "POST" });
      toast({ title: "Sync started", description: "Directory pull running in the background." });
      setTimeout(refresh, 3000);
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally { setSyncing(false); }
  };

  if (loading) return <div className="flex items-center gap-2 p-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!status) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<Cloud className="h-5 w-5" />}
          label="Microsoft Graph"
          value={status.graphConfigured ? (status.graphReachable ? "Connected" : "Configured but unreachable") : "Not configured"}
          ok={status.graphConfigured && status.graphReachable}
        />
        <StatCard
          icon={<Settings className="h-5 w-5" />}
          label="Rollout Mode"
          value={status.rolloutMode}
          ok={status.rolloutMode !== "disabled"}
          neutral={status.rolloutMode === "disabled"}
        />
        <StatCard
          icon={<History className="h-5 w-5" />}
          label="Last Directory Sync"
          value={formatDateTime(status.lastSyncAt)}
          ok={Boolean(status.lastSyncAt)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={<ShieldCheck className="h-5 w-5" />} label="Mapping Rules" value={String(status.mappingRulesCount)} ok={status.mappingRulesCount > 0} />
        <StatCard icon={<Key className="h-5 w-5" />} label="Break-glass emails" value={String(status.breakGlassEmailCount)} ok={status.breakGlassEmailCount > 0} />
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">Manually run a directory sync</div>
            <Button onClick={triggerSync} disabled={syncing || !status.graphConfigured}>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sync now
            </Button>
          </CardContent>
        </Card>
      </div>

      {orphans && (orphans.users.length + orphans.partners.length) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Local accounts not yet linked to Azure ({orphans.users.length + orphans.partners.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-auto">
            {orphans.users.slice(0, 50).map((u: any) => (
              <div key={`u-${u.id}`} className="text-sm flex items-center gap-2">
                <Badge variant="outline">user</Badge>
                <span>{u.email}</span>
                <span className="text-muted-foreground">role={u.role}</span>
                <span className="text-muted-foreground">last decision={u.azure_last_decision || "—"}</span>
              </div>
            ))}
            {orphans.partners.slice(0, 50).map((p: any) => (
              <div key={`p-${p.id}`} className="text-sm flex items-center gap-2">
                <Badge variant="outline">partner</Badge>
                <span>{p.email}</span>
                <span className="text-muted-foreground">{p.company_name}</span>
                <span className="text-muted-foreground">last decision={p.azure_last_decision || "—"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, ok, neutral }: { icon: React.ReactNode; label: string; value: string; ok?: boolean; neutral?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
        <div className="mt-2 text-lg font-semibold flex items-center gap-2">
          {neutral ? <span className="h-2 w-2 rounded-full bg-gray-400" /> : ok ? <CheckCircle className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Setup Guide
// ─────────────────────────────────────────────────────────────────────────────

function SetupTab() {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Azure-side configuration</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>Complete these one-time steps in the Microsoft Entra admin center, then come back here.</p>

        <Section title="1. App registration">
          <ul className="list-disc pl-5 space-y-1">
            <li>Create (or reuse) a single-tenant app registration. Set redirect URI to <code className="bg-muted px-1 rounded">{`${window.location.origin}/api/auth/sso/microsoft/callback`}</code>.</li>
            <li>Add a client secret and copy it into the <code className="bg-muted px-1 rounded">MICROSOFT_CLIENT_SECRET</code> environment variable.</li>
            <li>Set <code className="bg-muted px-1 rounded">MICROSOFT_CLIENT_ID</code>, <code className="bg-muted px-1 rounded">MICROSOFT_TENANT_ID</code>, and <code className="bg-muted px-1 rounded">MICROSOFT_APP_OBJECT_ID</code> (the Object ID of the Enterprise Application).</li>
          </ul>
        </Section>

        <Section title="2. API permissions (Microsoft Graph, Application)">
          <ul className="list-disc pl-5 space-y-1">
            <li><code>User.Read.All</code> — look up users by email and load profiles.</li>
            <li><code>GroupMember.Read.All</code> — read group memberships for mapping.</li>
            <li><code>Application.Read.All</code> — list app roles.</li>
            <li><code>AppRoleAssignment.ReadWrite.All</code> — manage role assignments.</li>
          </ul>
          <p className="mt-1 text-muted-foreground">Click <em>Grant admin consent</em> after adding.</p>
        </Section>

        <Section title="3. App roles (recommended)">
          <ul className="list-disc pl-5 space-y-1">
            <li>Define roles such as <code>SiebertClient</code>, <code>SiebertPartner</code>, <code>SiebertPartnerAdmin</code>, <code>SiebertSiteAdmin</code> on the app registration.</li>
            <li>Assign users/groups in <em>Enterprise applications → Users and groups</em>.</li>
            <li>Then come to the <strong>Mapping</strong> tab and add a rule mapping each role value to its portal+tier.</li>
          </ul>
        </Section>

        <Section title="4. Conditional Access (optional)">
          <p>Configure CA policies as you normally would. The portal will surface a friendly <em>ca_required</em> message if a sign-in is blocked, and admins can require step-up by toggling rollout to <strong>enforce</strong>.</p>
        </Section>

        <Section title="5. SCIM provisioning (optional)">
          <p>Generate a token in the <strong>SCIM</strong> tab, then point your Entra <em>Provisioning</em> at <code className="bg-muted px-1 rounded">{`${window.location.origin}/scim/v2`}</code> using that token.</p>
        </Section>

        <Section title="6. Break-glass">
          <p>Set <code>AZURE_AD_BREAKGLASS_EMAILS</code> to a comma-separated list of admin emails. These accounts always bypass Azure decisions so you cannot lock yourself out.</p>
        </Section>

        <Section title="7. Roll out">
          <ul className="list-disc pl-5 space-y-1">
            <li>Start with <strong>audit</strong> mode — every login is recorded but nothing is blocked.</li>
            <li>Review the <strong>Audit</strong> tab for unexpected denies.</li>
            <li>Switch to <strong>enforce</strong> when comfortable.</li>
          </ul>
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <div className="ml-1">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Rollout
// ─────────────────────────────────────────────────────────────────────────────

function RolloutTab({ toast }: { toast: any }) {
  const [mode, setMode] = useState<RolloutMode | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ mode: RolloutMode }>("/api/admin/azure-ad/rollout").then(r => setMode(r.mode));
  }, []);

  const change = async (next: RolloutMode) => {
    setSaving(true);
    try {
      await api("/api/admin/azure-ad/rollout", { method: "PUT", body: JSON.stringify({ mode: next }) });
      setMode(next);
      toast({ title: "Rollout updated", description: `Now in ${next} mode.` });
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (!mode) return <Loader2 className="h-4 w-4 animate-spin" />;

  return (
    <Card>
      <CardHeader><CardTitle>Rollout mode</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {(["disabled", "audit", "enforce"] as RolloutMode[]).map(m => (
          <label key={m} className={`flex items-start gap-3 p-3 border rounded cursor-pointer ${mode === m ? "border-blue-500 bg-blue-50" : ""}`}>
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => change(m)} disabled={saving} className="mt-1" />
            <div>
              <div className="font-semibold capitalize">{m}</div>
              <div className="text-sm text-muted-foreground">
                {m === "disabled" && "Azure AD checks are skipped entirely. Existing behavior is unchanged."}
                {m === "audit" && "Every login is checked against Azure and recorded, but no one is blocked. Use this to verify mappings."}
                {m === "enforce" && "Users are blocked, downgraded, or force-logged-out the moment Azure says so. Production mode."}
              </div>
            </div>
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Mapping
// ─────────────────────────────────────────────────────────────────────────────

function MappingTab({ toast }: { toast: any }) {
  const [cfg, setCfg] = useState<MappingConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<MappingConfig>("/api/admin/azure-ad/mapping").then(setCfg);
  }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await api("/api/admin/azure-ad/mapping", { method: "PUT", body: JSON.stringify(cfg) });
      toast({ title: "Mapping saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (!cfg) return <Loader2 className="h-4 w-4 animate-spin" />;

  const addRule = () => setCfg({ ...cfg, rules: [...cfg.rules, { type: "appRole", match: "", target: { portal: "client", role: "client", isAdmin: false } }] });
  const removeRule = (i: number) => setCfg({ ...cfg, rules: cfg.rules.filter((_, x) => x !== i) });
  const updateRule = (i: number, patch: Partial<MappingRule>) => {
    const next = [...cfg.rules];
    next[i] = { ...next[i], ...patch };
    setCfg({ ...cfg, rules: next });
  };
  const updateTarget = (i: number, patch: Partial<MappingTarget>) => {
    const next = [...cfg.rules];
    next[i] = { ...next[i], target: { ...next[i].target, ...patch } };
    setCfg({ ...cfg, rules: next });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Mapping rules</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addRule}><Plus className="h-4 w-4 mr-1" />Rule</Button>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {cfg.rules.length === 0 && <div className="text-sm text-muted-foreground">No rules yet — add one to grant access by app role, group, or domain.</div>}
          {cfg.rules.map((r, i) => (
            <div key={i} className="border rounded p-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              <select value={r.type} onChange={e => updateRule(i, { type: e.target.value as any })} className="md:col-span-2 border rounded px-2 py-1 text-sm">
                <option value="appRole">App Role</option>
                <option value="group">Group OID</option>
                <option value="domain">Email Domain</option>
              </select>
              <Input className="md:col-span-3" value={r.match} onChange={e => updateRule(i, { match: e.target.value })} placeholder={r.type === "domain" ? "example.com" : r.type === "group" ? "00000000-…" : "SiebertClient"} />
              <select value={r.target.portal} onChange={e => updateTarget(i, { portal: e.target.value as any })} className="md:col-span-2 border rounded px-2 py-1 text-sm">
                <option value="client">client</option>
                <option value="partner">partner</option>
                <option value="admin">admin</option>
              </select>
              <select value={r.target.role} onChange={e => updateTarget(i, { role: e.target.value as any })} className="md:col-span-2 border rounded px-2 py-1 text-sm">
                <option value="client">client</option>
                <option value="partner">partner</option>
                <option value="team_member">team_member</option>
                <option value="admin">admin</option>
              </select>
              <label className="md:col-span-2 flex items-center gap-2 text-sm">
                <Switch checked={!!r.target.isAdmin} onCheckedChange={v => updateTarget(i, { isAdmin: v })} />
                <span>Admin</span>
              </label>
              <Button size="sm" variant="ghost" onClick={() => removeRule(i)} className="md:col-span-1"><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>

        <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center gap-3">
            <Switch checked={cfg.defaultDeny} onCheckedChange={v => setCfg({ ...cfg, defaultDeny: v })} />
            <div>
              <div className="text-sm font-semibold">Default deny</div>
              <div className="text-xs text-muted-foreground">If on, anyone with no matching rule is blocked.</div>
            </div>
          </label>
          <div>
            <div className="text-sm font-semibold mb-1">Contact email (shown on denial)</div>
            <Input value={cfg.contactEmail} onChange={e => setCfg({ ...cfg, contactEmail: e.target.value })} placeholder="it@yourcompany.com" />
          </div>
          <div className="md:col-span-2">
            <div className="text-sm font-semibold mb-1">Not-authorized message</div>
            <Input value={cfg.notAuthorizedMessage} onChange={e => setCfg({ ...cfg, notAuthorizedMessage: e.target.value })} placeholder="Your account isn't authorized…" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Groups
// ─────────────────────────────────────────────────────────────────────────────

function GroupsTab({ toast }: { toast: any }) {
  const [rows, setRows] = useState<GroupBinding[]>([]);
  const [oid, setOid] = useState("");
  const [name, setName] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [isCompanyAdmin, setIsCompanyAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try { setRows(await api<GroupBinding[]>("/api/admin/azure-ad/group-bindings")); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const add = async () => {
    const pid = parseInt(partnerId, 10);
    if (!oid || !Number.isFinite(pid)) return;
    try {
      await api("/api/admin/azure-ad/group-bindings", { method: "POST", body: JSON.stringify({
        groupOid: oid,
        groupDisplayName: name,
        partnerId: pid,
        isCompanyAdmin,
      }) });
      setOid(""); setName(""); setPartnerId(""); setIsCompanyAdmin(false);
      refresh();
      toast({ title: "Group binding added" });
    } catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
  };
  const del = async (id: number) => {
    try { await api(`/api/admin/azure-ad/group-bindings/${id}`, { method: "DELETE" }); refresh(); }
    catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bind an Azure AD group to a partner company</CardTitle>
          <p className="text-xs text-muted-foreground">Members of this group will be auto-provisioned as team members of the partner.</p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <Input placeholder="Group OID" value={oid} onChange={e => setOid(e.target.value)} />
          <Input placeholder="Group display name" value={name} onChange={e => setName(e.target.value)} />
          <Input placeholder="Partner ID" type="number" value={partnerId} onChange={e => setPartnerId(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={isCompanyAdmin} onCheckedChange={setIsCompanyAdmin} />
            <span>Company admin</span>
          </label>
          <Button onClick={add}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Existing bindings</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <div className="space-y-1">
              {rows.length === 0 && <div className="text-sm text-muted-foreground">No bindings yet.</div>}
              {rows.map(r => (
                <div key={r.id} className="flex items-center gap-3 text-sm border-b py-1">
                  <Badge variant="outline">partner #{r.partnerId}</Badge>
                  <span className="font-mono text-xs">{r.groupOid}</span>
                  <span>{r.groupDisplayName || "—"}</span>
                  {r.isCompanyAdmin && <Badge>company admin</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                  <Button size="sm" variant="ghost" onClick={() => del(r.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. App Roles
// ─────────────────────────────────────────────────────────────────────────────

function AppRolesTab({ toast }: { toast: any }) {
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [assignments, setAssignments] = useState<any[]>([]);

  useEffect(() => {
    setLoading(true);
    api<AppRole[]>("/api/admin/azure-ad/app-roles")
      .then(r => setRoles(Array.isArray(r) ? r : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const lookup = async () => {
    if (!email) return;
    try {
      const r = await api<{ user?: any; assignments?: any[] }>(`/api/admin/azure-ad/app-role-assignments?email=${encodeURIComponent(email)}`);
      setAssignments(r.assignments || []);
      if (!r.assignments || r.assignments.length === 0) toast({ title: "No assignments found" });
    } catch (e: any) { toast({ title: "Lookup failed", description: e.message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">App roles defined on this app</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : error ? (
            <div className="text-sm text-amber-700 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</div>
          ) : (
            <div className="space-y-1">
              {roles.length === 0 && <div className="text-sm text-muted-foreground">No app roles defined yet. Add them in Entra → App registrations → App roles.</div>}
              {roles.map(r => (
                <div key={r.id} className="text-sm border-b py-1 flex gap-3">
                  <Badge>{r.value}</Badge>
                  <span>{r.displayName}</span>
                  <span className="text-muted-foreground text-xs">{r.description || ""}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Inspect a user's role assignments</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="user@example.com" value={email} onChange={e => setEmail(e.target.value)} />
            <Button onClick={lookup}><Eye className="h-4 w-4 mr-1" />Look up</Button>
          </div>
          {assignments.length > 0 && (
            <div className="space-y-1">
              {assignments.map((a, i) => (
                <div key={i} className="text-sm border-b py-1">
                  <Badge variant="outline">{a.appRoleId || a.id}</Badge>
                  <span className="ml-2">{a.principalDisplayName || a.principalId}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Test
// ─────────────────────────────────────────────────────────────────────────────

function TestTab() {
  const [email, setEmail] = useState("");
  const [portal, setPortal] = useState<"client" | "partner">("client");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await api("/api/admin/azure-ad/test", { method: "POST", body: JSON.stringify({ email, portal }) });
      setResult(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Simulate a sign-in decision</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input placeholder="user@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          <select value={portal} onChange={e => setPortal(e.target.value as any)} className="border rounded px-2 py-1 text-sm">
            <option value="client">client portal</option>
            <option value="partner">partner portal</option>
          </select>
          <Button onClick={run} disabled={loading || !email}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}</Button>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        {result && (
          <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-96">{JSON.stringify(result, null, 2)}</pre>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. SCIM
// ─────────────────────────────────────────────────────────────────────────────

function ScimTab({ toast }: { toast: any }) {
  const [tokens, setTokens] = useState<ScimToken[]>([]);
  const [label, setLabel] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try { setTokens(await api<ScimToken[]>("/api/admin/azure-ad/scim-tokens")); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (!label) return;
    try {
      const r = await api<{ token: string }>("/api/admin/azure-ad/scim-tokens", { method: "POST", body: JSON.stringify({ label }) });
      setNewToken(r.token);
      setLabel("");
      refresh();
    } catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
  };
  const del = async (id: number) => {
    try { await api(`/api/admin/azure-ad/scim-tokens/${id}`, { method: "DELETE" }); refresh(); }
    catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
  };
  const copy = (t: string) => { navigator.clipboard.writeText(t); toast({ title: "Copied" }); };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">SCIM endpoint</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          <div>Base URL: <code className="bg-muted px-1 rounded">{`${window.location.origin}/scim/v2`}</code></div>
          <div className="text-muted-foreground">Use a token below as the bearer in your Entra Provisioning configuration.</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Generate a new token</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder='label e.g. "Entra Provisioning"' value={label} onChange={e => setLabel(e.target.value)} />
            <Button onClick={create}><Plus className="h-4 w-4 mr-1" />Create</Button>
          </div>
          {newToken && (
            <div className="border rounded p-3 bg-yellow-50">
              <div className="text-xs font-semibold text-amber-800 mb-1">Copy this now — you won't see it again.</div>
              <div className="flex gap-2 items-center">
                <code className="flex-1 text-xs break-all">{newToken}</code>
                <Button size="sm" variant="outline" onClick={() => copy(newToken)}><Copy className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setNewToken(null)}>Done</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Active tokens</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <div className="space-y-1">
              {tokens.length === 0 && <div className="text-sm text-muted-foreground">No tokens.</div>}
              {tokens.map(t => (
                <div key={t.id} className="flex items-center gap-3 text-sm border-b py-1">
                  <span className="font-semibold">{t.label}</span>
                  <span className="text-xs text-muted-foreground">created {formatDateTime(t.createdAt)}</span>
                  <span className="text-xs text-muted-foreground">last used {formatDateTime(t.lastSeenAt)}</span>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => del(t.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Sessions
// ─────────────────────────────────────────────────────────────────────────────

function SessionsTab({ toast }: { toast: any }) {
  const [rows, setRows] = useState<RevokedSession[]>([]);
  const [email, setEmail] = useState("");
  const [jti, setJti] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try { setRows(await api<RevokedSession[]>("/api/admin/azure-ad/sessions/revoked")); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const revoke = async () => {
    try {
      const r = await api<{ ok: boolean; mode: string }>("/api/admin/azure-ad/sessions/revoke", {
        method: "POST", body: JSON.stringify({ email: email || undefined, jti: jti || undefined, reason }),
      });
      toast({ title: "Revoked", description: `mode=${r.mode}` });
      setEmail(""); setJti(""); setReason("");
      refresh();
    } catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Revoke a session</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input placeholder="JTI (one specific session)" value={jti} onChange={e => setJti(e.target.value)} />
            <Input placeholder="OR Email (locks the account)" value={email} onChange={e => setEmail(e.target.value)} />
            <Input placeholder="reason (optional)" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <Button onClick={revoke} disabled={!jti && !email}><AlertTriangle className="h-4 w-4 mr-1" />Revoke</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Recently revoked sessions</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <div className="space-y-1 max-h-96 overflow-auto">
              {rows.length === 0 && <div className="text-sm text-muted-foreground">No revocations yet.</div>}
              {rows.map(r => (
                <div key={r.jti} className="text-sm border-b py-1 flex gap-3">
                  <span className="font-mono text-xs">{r.jti.slice(0, 12)}…</span>
                  <span>{r.email || "—"}</span>
                  <span className="text-muted-foreground">{r.reason || "—"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(r.revokedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Audit
// ─────────────────────────────────────────────────────────────────────────────

function AuditTab({ toast }: { toast: any }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filterEmail, setFilterEmail] = useState("");
  const [filterDecision, setFilterDecision] = useState("");
  const [loading, setLoading] = useState(true);
  const [forwardUrl, setForwardUrl] = useState("");
  const [forwardAuth, setForwardAuth] = useState("");
  const [forwardConfigured, setForwardConfigured] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (filterEmail) params.set("email", filterEmail);
      if (filterDecision) params.set("decision", filterDecision);
      const r = await api<AuditEvent[] | { events: AuditEvent[] }>(`/api/admin/azure-ad/events?${params}`);
      setEvents(Array.isArray(r) ? r : (r.events || []));
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); api<{ url: string; authConfigured: boolean }>("/api/admin/azure-ad/audit-forward").then(r => { setForwardUrl(r.url); setForwardConfigured(r.authConfigured); }); }, []);

  const saveForward = async () => {
    try {
      await api("/api/admin/azure-ad/audit-forward", { method: "PUT", body: JSON.stringify({ url: forwardUrl, ...(forwardAuth ? { auth: forwardAuth } : {}) }) });
      toast({ title: "Saved" });
      setForwardAuth("");
      const r = await api<{ url: string; authConfigured: boolean }>("/api/admin/azure-ad/audit-forward");
      setForwardConfigured(r.authConfigured);
    } catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
  };

  const decisionColor = (d: string) => d === "allow" ? "bg-green-100 text-green-800" : d === "deny" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Forward events to your SIEM (optional)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input placeholder="Webhook URL" value={forwardUrl} onChange={e => setForwardUrl(e.target.value)} />
          <Input placeholder={forwardConfigured ? "(secret set — leave blank to keep)" : "Authorization header value"} value={forwardAuth} onChange={e => setForwardAuth(e.target.value)} type="password" />
          <Button onClick={saveForward}>Save</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Audit events</span>
            <Button size="sm" variant="outline" onClick={refresh}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
            <Input placeholder="filter email" value={filterEmail} onChange={e => setFilterEmail(e.target.value)} />
            <select value={filterDecision} onChange={e => setFilterDecision(e.target.value)} className="border rounded px-2 py-1 text-sm">
              <option value="">all decisions</option>
              <option value="allow">allow</option>
              <option value="deny">deny</option>
              <option value="info">info</option>
            </select>
            <Button onClick={refresh}>Apply</Button>
          </div>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <div className="space-y-1 max-h-[600px] overflow-auto">
              {events.length === 0 && <div className="text-sm text-muted-foreground">No events.</div>}
              {events.map(e => (
                <div key={e.id} className="text-xs border-b py-1.5 grid grid-cols-12 gap-2">
                  <span className="col-span-2 text-muted-foreground">{formatDateTime(e.occurredAt)}</span>
                  <span className={`col-span-1 px-1 rounded text-center ${decisionColor(e.decision)}`}>{e.decision}</span>
                  <span className="col-span-2 font-mono">{e.eventType}</span>
                  <span className="col-span-2 truncate">{e.email || "—"}</span>
                  <span className="col-span-1">{e.source}</span>
                  <span className="col-span-1">{e.rolloutMode}</span>
                  <span className="col-span-3 font-mono text-[10px] text-muted-foreground truncate">{e.details ? JSON.stringify(e.details) : ""}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
