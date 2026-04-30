import React, { useState, useEffect, useMemo } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, FileText, CreditCard, AlertTriangle, Loader2, Users, CheckCircle, XCircle, Plus, Clock, ShieldCheck, ShieldX, ChevronDown, ChevronUp, Building2, User, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/Input";

interface BillingStats {
  mrr: number;
  outstanding: number;
  totalRevenue: number;
  overdueCount: number;
  activeSubscriptions: number;
  recentInvoices: any[];
  subscriptions: any[];
}

function CustomerTypeBadge({ type }: { type?: string }) {
  const isCons = type === "consumer";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${isCons ? "bg-teal-100 text-teal-800" : "bg-blue-100 text-blue-800"}`}>
      {isCons ? <User className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
      {isCons ? "Individual" : "Business"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    paid: "bg-emerald-100 text-emerald-800",
    sent: "bg-blue-100 text-blue-800",
    viewed: "bg-purple-100 text-purple-800",
    overdue: "bg-red-100 text-red-800",
    draft: "bg-gray-100 text-gray-800",
    active: "bg-emerald-100 text-emerald-800",
    trialing: "bg-blue-100 text-blue-800",
    canceled: "bg-gray-100 text-gray-500",
    past_due: "bg-red-100 text-red-800",
    incomplete: "bg-yellow-100 text-yellow-800",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${classes[status] || "bg-gray-100 text-gray-800"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function AdminBilling() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState<BillingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [createSubOpen, setCreateSubOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [subForm, setSubForm] = useState({ userId: "", partnerId: "", tierId: "", billingCycle: "monthly", customerType: "business", initialTermMonths: "12" });
  const [creatingSubscription, setCreatingSubscription] = useState(false);
  const [tiers, setTiers] = useState<any[]>([]);
  const [pendingSignups, setPendingSignups] = useState<any[]>([]);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectDialogId, setRejectDialogId] = useState<number | null>(null);
  const [portalLoadingId, setPortalLoadingId] = useState<number | null>(null);

  const headers = getAuthHeaders();
  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  const load = async () => {
    setLoading(true);
    try {
      const [statsRes, tiersRes, pendingRes] = await Promise.all([
        fetch("/api/admin/billing/stats", { headers }),
        fetch("/api/cms/pricing-tiers"),
        fetch("/api/admin/billing/pending-signups", { headers }),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (tiersRes.ok) setTiers(await tiersRes.json());
      if (pendingRes.ok) setPendingSignups(await pendingRes.json());
    } catch {
      toast({ title: "Failed to load billing data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const approveSignup = async (id: number) => {
    setApprovingId(id);
    try {
      const res = await fetch(`/api/admin/billing/subscriptions/${id}/approve`, { method: "POST", headers });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Signup approved — card charged and contract sent" });
        load();
      } else {
        toast({ title: data.message || "Failed to approve signup", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error approving signup", variant: "destructive" });
    } finally {
      setApprovingId(null);
    }
  };

  const rejectSignup = async (id: number) => {
    setRejectingId(id);
    try {
      const res = await fetch(`/api/admin/billing/subscriptions/${id}/reject`, {
        method: "POST", headers,
        body: JSON.stringify({ reason: rejectReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Signup rejected — pre-authorization released" });
        setRejectDialogId(null);
        setRejectReason("");
        load();
      } else {
        toast({ title: data.message || "Failed to reject signup", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error rejecting signup", variant: "destructive" });
    } finally {
      setRejectingId(null);
    }
  };

  const createSubscription = async () => {
    setCreatingSubscription(true);
    try {
      const res = await fetch("/api/admin/billing/subscriptions", {
        method: "POST", headers,
        body: JSON.stringify(subForm),
      });
      if (res.ok) {
        toast({ title: "Subscription created successfully" });
        setCreateSubOpen(false);
        setSubForm({ userId: "", partnerId: "", tierId: "", billingCycle: "monthly", customerType: "business", initialTermMonths: "12" });
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.message || "Failed to create subscription", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error creating subscription", variant: "destructive" });
    } finally {
      setCreatingSubscription(false);
    }
  };

  const openPortal = async (id: number) => {
    setPortalLoadingId(id);
    try {
      const res = await fetch(`/api/admin/billing/subscriptions/${id}/portal`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not open portal");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast({ title: err.message || "Failed to open billing portal", variant: "destructive" });
    } finally {
      setPortalLoadingId(null);
    }
  };

  const cancelSubscription = async (id: number, overrideCommitment = false) => {
    setCancellingId(id);
    try {
      const res = await fetch(`/api/admin/billing/subscriptions/${id}/cancel`, {
        method: "PUT", headers,
        body: JSON.stringify({ immediately: false, overrideCommitment }),
      });
      if (res.ok) {
        toast({ title: overrideCommitment ? "Subscription cancelled (commitment overridden)" : "Subscription set to cancel at period end" });
        load();
        return;
      }

      const err = await res.json().catch(() => ({} as any));

      // 409 = the contract's initial-term commitment is still active. Surface
      // that to the admin and let them re-confirm to override (i.e. waive the
      // early-termination liability per Section 2 of the MSA).
      if (res.status === 409 && err?.error === "commitment_active") {
        const proceed = confirm(
          `${err.message || "This subscription is still under its initial-term commitment."}\n\nOverride and cancel anyway? This waives the contractual early-termination clause for this customer.`
        );
        if (proceed) {
          await cancelSubscription(id, true);
        }
        return;
      }

      toast({ title: err.message || "Failed to cancel subscription", variant: "destructive" });
    } catch {
      toast({ title: "Error cancelling subscription", variant: "destructive" });
    } finally {
      setCancellingId(null);
    }
  };

  if (!user || !user.isAdmin) {
    return (
      <PortalLayout>
        <div className="px-6 py-12 text-center">
          <p className="text-muted-foreground">Access denied. Admin privileges required.</p>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="px-6 py-4">
        <div className="max-w-7xl mx-auto space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Billing Dashboard</h1>
              <p className="text-sm text-muted-foreground mt-1">Revenue, subscriptions, and payment activity</p>
            </div>
            <Button size="sm" onClick={() => setCreateSubOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> New Subscription
            </Button>
          </div>

          {/* Pending Signups Alert */}
          {pendingSignups.length > 0 && (
            <Card className="border-orange-200 bg-orange-50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-orange-800">
                  <Clock className="w-4 h-4" />
                  Pending Signups — Action Required ({pendingSignups.length})
                </CardTitle>
                <p className="text-xs text-orange-700 mt-0.5">
                  These customers completed checkout with a pre-authorized hold on their card — no charge yet. Approve to capture the payment and start their subscription; reject to release the hold with no charge.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-orange-200 bg-orange-100/60">
                        <th className="px-4 py-2.5 text-left text-orange-900">Customer</th>
                        <th className="px-4 py-2.5 text-left text-orange-900">Type</th>
                        <th className="px-4 py-2.5 text-left text-orange-900">Plan</th>
                        <th className="px-4 py-2.5 text-left text-orange-900">Seats</th>
                        <th className="px-4 py-2.5 text-right text-orange-900">Plan Value</th>
                        <th className="px-4 py-2.5 text-left text-orange-900">Signed Up</th>
                        <th className="px-4 py-2.5 text-right text-orange-900">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingSignups.map((s: any) => (
                        <tr key={s.id} className="border-b border-orange-100 last:border-0 hover:bg-orange-100/40">
                          <td className="px-4 py-3">
                            <p className="font-medium">{s.customerName || "—"}</p>
                            <p className="text-xs text-muted-foreground">{s.customerEmail || "—"}</p>
                          </td>
                          <td className="px-4 py-3"><CustomerTypeBadge type={s.customerType} /></td>
                          <td className="px-4 py-3">
                            <p className="font-medium capitalize">{s.planName}</p>
                            <p className="text-xs text-muted-foreground capitalize">{s.billingCycle}</p>
                          </td>
                          <td className="px-4 py-3">{s.seats ?? "—"}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            {s.amount ? fmt(parseFloat(s.amount) * (s.seats || 1)) : "—"}
                            <p className="text-xs font-normal text-muted-foreground">per period</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(s.createdAt)}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                                onClick={() => approveSignup(s.id)}
                                disabled={approvingId === s.id || rejectingId === s.id}
                              >
                                {approvingId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 border-red-300 text-red-600 hover:bg-red-50"
                                onClick={() => { setRejectDialogId(s.id); setRejectReason(""); }}
                                disabled={approvingId === s.id || rejectingId === s.id}
                              >
                                <ShieldX className="w-3 h-3" />
                                Reject
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : stats ? (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {[
                  { label: "MRR", value: fmt(stats.mrr), icon: TrendingUp, color: "text-emerald-600" },
                  { label: "Outstanding", value: fmt(stats.outstanding), icon: FileText, color: "text-orange-600" },
                  { label: "Total Revenue", value: fmt(stats.totalRevenue), icon: CreditCard, color: "text-blue-600" },
                  { label: "Overdue", value: stats.overdueCount.toString(), icon: AlertTriangle, color: "text-red-600" },
                  { label: "Active Subscriptions", value: stats.activeSubscriptions.toString(), icon: Users, color: "text-purple-600" },
                ].map(m => {
                  const Icon = m.icon;
                  return (
                    <Card key={m.label}>
                      <CardContent className="pt-4 pb-3 px-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-xs text-muted-foreground">{m.label}</p>
                            <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
                          </div>
                          <Icon className={`w-5 h-5 mt-1 ${m.color} opacity-60`} />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Recent Invoices */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="w-4 h-4" /> Recent Payments
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-4 py-2.5 text-left">Client</th>
                            <th className="px-4 py-2.5 text-left">Invoice</th>
                            <th className="px-4 py-2.5 text-left">Status</th>
                            <th className="px-4 py-2.5 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.recentInvoices.length === 0 ? (
                            <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-xs">No recent invoices</td></tr>
                          ) : stats.recentInvoices.map((inv: any) => (
                            <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="px-4 py-2.5">
                                <p className="font-medium text-xs">{inv.clientName || "—"}</p>
                                <p className="text-xs text-muted-foreground">{inv.clientEmail}</p>
                              </td>
                              <td className="px-4 py-2.5">
                                <p className="font-mono text-xs text-muted-foreground">{inv.invoiceNumber}</p>
                                <p className="text-xs">{inv.title}</p>
                              </td>
                              <td className="px-4 py-2.5"><StatusBadge status={inv.status} /></td>
                              <td className="px-4 py-2.5 text-right font-medium">{fmt(parseFloat(inv.total || "0"))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                {/* Active Subscriptions */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CreditCard className="w-4 h-4" /> Subscriptions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-4 py-2.5 text-left">Plan</th>
                            <th className="px-4 py-2.5 text-left">Type</th>
                            <th className="px-4 py-2.5 text-left">Status</th>
                            <th className="px-4 py-2.5 text-right">Amount</th>
                            <th className="px-4 py-2.5 text-left">Renews</th>
                            <th className="px-4 py-2.5 text-left">Commitment</th>
                            <th className="px-4 py-2.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.subscriptions.length === 0 ? (
                            <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-xs">No subscriptions yet</td></tr>
                          ) : stats.subscriptions.map((sub: any) => (
                            <tr key={sub.id} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="px-4 py-2.5">
                                <p className="font-medium capitalize">{sub.planName}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <p className="text-xs text-muted-foreground capitalize">{sub.billingCycle}</p>
                                  {sub.autoActivated && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-700 border border-sky-200">
                                      Auto-activated
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5"><CustomerTypeBadge type={sub.customerType} /></td>
                              <td className="px-4 py-2.5"><StatusBadge status={sub.status} /></td>
                              <td className="px-4 py-2.5 text-right font-medium">{sub.amount ? fmt(parseFloat(sub.amount)) : "—"}</td>
                              <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(sub.currentPeriodEnd)}</td>
                              <td className="px-4 py-2.5 text-xs">
                                {sub.commitmentEndsAt ? (
                                  new Date(sub.commitmentEndsAt) > new Date() ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200" title={`Initial ${sub.initialTermMonths || 12}-month term ends ${new Date(sub.commitmentEndsAt).toLocaleDateString()}`}>
                                      Locked → {new Date(sub.commitmentEndsAt).toLocaleDateString()}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200" title="Initial term complete — month-to-month">
                                      Month-to-month
                                    </span>
                                  )
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {sub.stripeCustomerId && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs text-sky-600 hover:text-sky-700"
                                      onClick={() => openPortal(sub.id)}
                                      disabled={portalLoadingId === sub.id}
                                      title="Open Stripe billing portal for this customer"
                                    >
                                      {portalLoadingId === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                                    </Button>
                                  )}
                                  {sub.status !== "canceled" && !sub.cancelAtPeriodEnd && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs text-red-600 hover:text-red-700"
                                      onClick={() => cancelSubscription(sub.id)}
                                      disabled={cancellingId === sub.id}
                                    >
                                      {cancellingId === sub.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                                    </Button>
                                  )}
                                  {sub.cancelAtPeriodEnd && <span className="text-xs text-orange-600">Cancels soon</span>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground">Failed to load billing data</div>
          )}
        </div>
      </div>

      {/* Reject Signup Dialog */}
      <Dialog open={rejectDialogId !== null} onOpenChange={open => { if (!open) { setRejectDialogId(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Signup Application</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              The customer's pre-authorization hold will be released and no charge will be made. They will receive an email notification.
            </p>
            <div>
              <Label>Reason (optional — included in customer email)</Label>
              <Input
                className="mt-1"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="e.g. Service not available in your area"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDialogId(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectDialogId !== null && rejectSignup(rejectDialogId)}
              disabled={rejectingId !== null}
            >
              {rejectingId !== null ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ShieldX className="w-4 h-4 mr-1" />}
              Reject & Release Hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createSubOpen} onOpenChange={setCreateSubOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Subscription</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <Label>User ID (client account)</Label>
              <Input type="number" value={subForm.userId} onChange={e => setSubForm(p => ({ ...p, userId: e.target.value }))} placeholder="Leave blank if using partner ID" />
            </div>
            <div>
              <Label>Partner ID (partner account)</Label>
              <Input type="number" value={subForm.partnerId} onChange={e => setSubForm(p => ({ ...p, partnerId: e.target.value }))} placeholder="Leave blank if using user ID" />
            </div>
            <div>
              <Label>Pricing Tier</Label>
              <select className="w-full h-9 px-3 rounded-md border text-sm bg-background mt-1" value={subForm.tierId} onChange={e => setSubForm(p => ({ ...p, tierId: e.target.value }))}>
                <option value="">Select a tier...</option>
                {tiers.map((t: any) => <option key={t.id} value={t.id}>{t.name} — ${t.startingPrice}/mo</option>)}
              </select>
            </div>
            <div>
              <Label>Billing Cycle</Label>
              <select className="w-full h-9 px-3 rounded-md border text-sm bg-background mt-1" value={subForm.billingCycle} onChange={e => setSubForm(p => ({ ...p, billingCycle: e.target.value }))}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Customer Type</Label>
                <select className="w-full h-9 px-3 rounded-md border text-sm bg-background mt-1" value={subForm.customerType} onChange={e => setSubForm(p => ({ ...p, customerType: e.target.value }))}>
                  <option value="business">Business / Organization</option>
                  <option value="consumer">Consumer / Individual</option>
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">Determines which contract template (formal MSA vs plain-English) is generated.</p>
              </div>
              <div>
                <Label>Initial Term (months)</Label>
                <Input type="number" min={1} max={60} value={subForm.initialTermMonths} onChange={e => setSubForm(p => ({ ...p, initialTermMonths: e.target.value }))} />
                <p className="text-[10px] text-muted-foreground mt-1">Default 12 months, then converts to month-to-month.</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Stripe must be configured and a valid pricing tier selected. This will create a live Stripe subscription with the selected initial-term commitment enforced at cancel time.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateSubOpen(false)}>Cancel</Button>
            <Button onClick={createSubscription} disabled={creatingSubscription || (!subForm.userId && !subForm.partnerId) || !subForm.tierId}>
              {creatingSubscription ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Create Subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
