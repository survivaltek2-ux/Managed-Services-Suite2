import { useEffect, useState } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Loader2, Mail, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus, Users, X } from "lucide-react";

interface TeamMember {
  id: number;
  email: string;
  name: string;
  status: "pending" | "active" | "revoked";
  canViewDeals: boolean;
  canCreateDeals: boolean;
  canViewLeads: boolean;
  canCreateLeads: boolean;
  canViewCommissions: boolean;
  canViewResources: boolean;
  canCreatePlans: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  lastLoginAt: string | null;
  // Microsoft SSO (Entra B2B) lifecycle (Task #191).
  msObjectId?: string | null;
  ssoInviteSentAt?: string | null;
  ssoInviteSentBy?: string | null;
}

const PERMISSION_LABELS: Array<{ key: keyof TeamMember & string; label: string }> = [
  { key: "canViewDeals", label: "View Deals" },
  { key: "canCreateDeals", label: "Create Deals" },
  { key: "canViewLeads", label: "View Leads" },
  { key: "canCreateLeads", label: "Create Leads" },
  { key: "canViewCommissions", label: "View Commissions" },
  { key: "canViewResources", label: "View Resources" },
  { key: "canCreatePlans", label: "Create Written Plans" },
];

const DEFAULT_PERMISSIONS = {
  canViewDeals: true,
  canCreateDeals: false,
  canViewLeads: true,
  canCreateLeads: false,
  canViewCommissions: false,
  canViewResources: true,
  canCreatePlans: false,
};

export default function Team() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    name: "",
    email: "",
    ...DEFAULT_PERMISSIONS,
  });
  const [submitting, setSubmitting] = useState(false);
  const [ssoLoading, setSsoLoading] = useState<number | null>(null);

  const partnerDomain = (user?.email.split("@")[1] ?? "").toLowerCase();

  async function fetchMembers() {
    setLoading(true);
    try {
      const res = await fetch("/api/partner/team", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load team members");
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch (err) {
      toast({ title: "Could not load team", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchMembers(); }, []);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/partner/team/invite", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(inviteForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Failed to send invitation");
      toast({ title: "Invitation sent", description: `An email has been sent to ${inviteForm.email}.` });
      setShowInvite(false);
      setInviteForm({ name: "", email: "", ...DEFAULT_PERMISSIONS });
      fetchMembers();
    } catch (err) {
      toast({ title: "Could not send invitation", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function updatePermission(member: TeamMember, key: string, value: boolean) {
    const prev = members;
    setMembers(prev.map(m => m.id === member.id ? { ...m, [key]: value } : m));
    try {
      const res = await fetch(`/api/partner/team/${member.id}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Update failed");
    } catch (err) {
      setMembers(prev);
      toast({ title: "Update failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  /**
   * Send (or re-send) a Microsoft Entra B2B guest invite to this team
   * member. Surfaces the raw Graph error verbatim so admins can debug
   * tenant policy / permission issues without server access.
   */
  async function sendSsoInvite(member: TeamMember) {
    const verb = member.msObjectId ? "Re-send" : "Send";
    if (!confirm(`${verb} a Microsoft SSO invite to ${member.email}?`)) return;
    setSsoLoading(member.id);
    try {
      const res = await fetch(`/api/partner/team/${member.id}/send-sso-invite`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      toast({
        title: data.alreadyExisted ? "SSO invite re-sent" : "SSO invite sent",
        description: `${data.sentTo}${data.msObjectId ? ` · objectId ${String(data.msObjectId).slice(0, 8)}…` : ""}`,
      });
      fetchMembers();
    } catch (err) {
      toast({ title: "SSO invite failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSsoLoading(null);
    }
  }

  async function resendInvite(member: TeamMember) {
    try {
      const res = await fetch(`/api/partner/team/${member.id}/resend`, { method: "POST", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to resend invitation");
      toast({ title: "Invitation re-sent", description: `New invite link sent to ${member.email}.` });
      fetchMembers();
    } catch (err) {
      toast({ title: "Resend failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function revokeMember(member: TeamMember) {
    if (!confirm(`Revoke access for ${member.name}? They will no longer be able to sign in.`)) return;
    try {
      const res = await fetch(`/api/partner/team/${member.id}/revoke`, { method: "POST", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to revoke access");
      toast({ title: "Access revoked", description: `${member.name} can no longer access the portal.` });
      fetchMembers();
    } catch (err) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function restoreMember(member: TeamMember) {
    try {
      const res = await fetch(`/api/partner/team/${member.id}/restore`, { method: "POST", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to restore access");
      toast({ title: "Access restored", description: `${member.name} can sign in again.` });
      fetchMembers();
    } catch (err) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function deleteMember(member: TeamMember) {
    if (!confirm(`Permanently remove ${member.name}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/partner/team/${member.id}`, { method: "DELETE", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to remove member");
      toast({ title: "Member removed" });
      fetchMembers();
    } catch (err) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  if (!user) return null;

  if (user.isTeamMember) {
    return (
      <PortalLayout>
        <div className="max-w-3xl mx-auto p-6">
          <div className="bg-white border border-[#d8dde6] rounded p-8 text-center">
            <Users className="w-12 h-12 mx-auto text-[#706e6b] mb-3" />
            <h1 className="text-xl font-semibold mb-2">Team Management</h1>
            <p className="text-sm text-[#706e6b]">Only the company admin can manage the partner team. Contact {user.contactName} ({user.email}) to add or remove team members.</p>
          </div>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-[#032d60] mb-1 flex items-center gap-2">
              <Users className="w-6 h-6" /> Team Members
            </h1>
            <p className="text-sm text-[#706e6b]">Invite people from <strong>@{partnerDomain}</strong> to access this partner portal. They sign in with their Microsoft work account.</p>
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="inline-flex items-center gap-2 bg-[#0176d3] hover:bg-[#014486] text-white px-4 py-2 rounded text-sm font-medium"
          >
            <UserPlus className="w-4 h-4" /> Invite Team Member
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-[#706e6b]">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading team…
          </div>
        ) : members.length === 0 ? (
          <div className="bg-white border border-[#d8dde6] rounded p-12 text-center">
            <Users className="w-10 h-10 mx-auto text-[#706e6b] mb-3" />
            <p className="text-sm text-[#706e6b]">You haven't invited anyone yet. Click <strong>Invite Team Member</strong> to add a coworker.</p>
          </div>
        ) : (
          <div className="bg-white border border-[#d8dde6] rounded overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf9] text-[#706e6b] text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Member</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Microsoft SSO</th>
                    <th className="text-left px-4 py-3 font-medium">Permissions</th>
                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id} className="border-t border-[#e5e5e5] align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium">{m.name}</div>
                        <div className="text-xs text-[#706e6b]">{m.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={m.status} />
                        {m.lastLoginAt && (
                          <div className="text-[11px] text-[#706e6b] mt-1">Last login {new Date(m.lastLoginAt).toLocaleDateString()}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {m.msObjectId ? (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 font-semibold text-[11px]"
                            title={`Linked to Microsoft objectId ${m.msObjectId}`}
                          >
                            <ShieldCheck className="w-3 h-3" /> Linked
                          </span>
                        ) : m.ssoInviteSentAt ? (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 font-semibold text-[11px]"
                            title={`Invite sent ${new Date(m.ssoInviteSentAt).toLocaleString()} — awaiting redemption`}
                          >
                            <Mail className="w-3 h-3" /> Invited
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#706e6b]">Not invited</span>
                        )}
                        {m.ssoInviteSentAt && (
                          <div className="text-[10px] text-[#706e6b] mt-1">
                            {new Date(m.ssoInviteSentAt).toLocaleDateString()}
                            {m.ssoInviteSentBy ? ` · by ${m.ssoInviteSentBy}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          {PERMISSION_LABELS.map(p => (
                            <label key={p.key} className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean((m as any)[p.key])}
                                disabled={m.status === "revoked"}
                                onChange={(e) => updatePermission(m, p.key, e.target.checked)}
                                className="w-3.5 h-3.5"
                              />
                              {p.label}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex flex-col gap-1 items-end">
                          {m.status === "pending" && (
                            <button
                              onClick={() => resendInvite(m)}
                              className="inline-flex items-center gap-1 text-xs text-[#0176d3] hover:underline"
                            >
                              <RefreshCw className="w-3 h-3" /> Resend invite
                            </button>
                          )}
                          {m.status !== "revoked" && (
                            <button
                              onClick={() => sendSsoInvite(m)}
                              disabled={ssoLoading === m.id}
                              className="inline-flex items-center gap-1 text-xs text-[#0176d3] hover:underline disabled:opacity-50"
                              title={m.msObjectId ? "Re-send Microsoft SSO invite" : "Send Microsoft SSO invite"}
                            >
                              {ssoLoading === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                              {m.msObjectId ? "Re-send SSO invite" : "Send SSO invite"}
                            </button>
                          )}
                          {m.status !== "revoked" ? (
                            <button
                              onClick={() => revokeMember(m)}
                              className="inline-flex items-center gap-1 text-xs text-[#b3261e] hover:underline"
                            >
                              <X className="w-3 h-3" /> Revoke access
                            </button>
                          ) : (
                            <button
                              onClick={() => restoreMember(m)}
                              className="inline-flex items-center gap-1 text-xs text-[#0176d3] hover:underline"
                            >
                              <RefreshCw className="w-3 h-3" /> Restore
                            </button>
                          )}
                          <button
                            onClick={() => deleteMember(m)}
                            className="inline-flex items-center gap-1 text-xs text-[#706e6b] hover:text-[#b3261e]"
                          >
                            <Trash2 className="w-3 h-3" /> Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showInvite && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowInvite(false)}>
            <div className="bg-white rounded shadow-lg w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-[#d8dde6] flex items-center justify-between">
                <h2 className="text-base font-semibold flex items-center gap-2"><UserPlus className="w-4 h-4" /> Invite Team Member</h2>
                <button onClick={() => setShowInvite(false)} className="text-[#706e6b] hover:text-[#181818]">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={submitInvite} className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#444] mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={inviteForm.name}
                    onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                    className="w-full border border-[#d8dde6] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#0176d3]"
                    placeholder="Jane Smith"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#444] mb-1">Work Email</label>
                  <input
                    type="email"
                    required
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                    className="w-full border border-[#d8dde6] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#0176d3]"
                    placeholder={`jane@${partnerDomain}`}
                  />
                  <p className="text-[11px] text-[#706e6b] mt-1">Must be a Microsoft work account on @{partnerDomain}.</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#444] mb-2">Permissions</p>
                  <div className="grid grid-cols-2 gap-2 bg-[#fafaf9] border border-[#e5e5e5] rounded p-3">
                    {PERMISSION_LABELS.map(p => (
                      <label key={p.key} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean((inviteForm as any)[p.key])}
                          onChange={(e) => setInviteForm({ ...inviteForm, [p.key]: e.target.checked } as any)}
                          className="w-3.5 h-3.5"
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setShowInvite(false)} className="px-3 py-2 text-sm text-[#444] hover:bg-[#f3f3f3] rounded">Cancel</button>
                  <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-[#0176d3] hover:bg-[#014486] disabled:opacity-60 text-white px-4 py-2 rounded text-sm font-medium">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    Send Invitation
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

function StatusBadge({ status }: { status: TeamMember["status"] }) {
  const map: Record<TeamMember["status"], { label: string; cls: string }> = {
    pending: { label: "Pending invite", cls: "bg-[#fff3cd] text-[#856404]" },
    active: { label: "Active", cls: "bg-[#d4edda] text-[#155724]" },
    revoked: { label: "Revoked", cls: "bg-[#f8d7da] text-[#721c24]" },
  };
  const s = map[status];
  return <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded ${s.cls}`}>{s.label}</span>;
}
