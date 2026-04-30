import React, { useState, useEffect } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, Trash2, Loader2, CreditCard, X, Send, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const INVOICE_STATUSES = ["draft", "sent", "viewed", "paid", "overdue", "void"] as const;
type InvStatus = typeof INVOICE_STATUSES[number];

const invStatusMeta: Record<InvStatus, { label: string; cls: string }> = {
  draft:   { label: "Draft",   cls: "bg-gray-100 text-gray-600" },
  sent:    { label: "Sent",    cls: "bg-blue-100 text-blue-700" },
  viewed:  { label: "Viewed",  cls: "bg-yellow-100 text-yellow-700" },
  paid:    { label: "Paid",    cls: "bg-green-100 text-green-700" },
  overdue: { label: "Overdue", cls: "bg-red-100 text-red-700" },
  void:    { label: "Void",    cls: "bg-gray-200 text-gray-500" },
};

function InvStatusBadge({ status }: { status: string }) {
  const m = invStatusMeta[status as InvStatus] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

export default function AdminInvoices() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<InvStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newInv, setNewInv] = useState({ userId: "", title: "Invoice", dueDate: "", notes: "", taxRate: 0, items: [{ description: "", qty: 1, unitPrice: 0 }] });
  const [statusUpdating, setStatusUpdating] = useState<number | null>(null);
  const [stripeSending, setStripeSending] = useState<number | null>(null);

  const headers = getAuthHeaders();

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/invoices", { headers }).then(r => r.ok ? r.json() : []),
      fetch("/api/admin/users", { headers }).then(r => r.ok ? r.json() : []),
    ])
      .then(([invs, usrs]) => {
        setInvoices(Array.isArray(invs) ? invs : []);
        setUsers(Array.isArray(usrs) ? usrs : []);
      })
      .catch(() => toast({ title: "Failed to load data", variant: "destructive" }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = invoices.filter(inv => {
    if (filter !== "all" && inv.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return inv.invoiceNumber?.toLowerCase().includes(q) || inv.clientName?.toLowerCase().includes(q) || inv.clientCompany?.toLowerCase().includes(q) || inv.title?.toLowerCase().includes(q);
    }
    return true;
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/admin/invoices", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...newInv, userId: newInv.userId ? parseInt(newInv.userId) : null }),
      });
      if (res.ok) {
        toast({ title: "Invoice created" });
        setShowCreate(false);
        setNewInv({ userId: "", title: "Invoice", dueDate: "", notes: "", taxRate: 0, items: [{ description: "", qty: 1, unitPrice: 0 }] });
        load();
      } else {
        const d = await res.json();
        toast({ variant: "destructive", title: "Error", description: d.message });
      }
    } catch { toast({ variant: "destructive", title: "Network error" }); }
    finally { setCreating(false); }
  };

  const handleStatusChange = async (id: number, status: string) => {
    setStatusUpdating(id);
    try {
      const res = await fetch(`/api/admin/invoices/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status }),
      });
      if (res.ok) { load(); toast({ title: "Status updated" }); }
    } catch { /* silent */ }
    finally { setStatusUpdating(null); }
  };

  const handleSendStripe = async (id: number, num: string) => {
    if (!confirm(`Send invoice ${num} through Stripe? The client will receive Stripe's hosted invoice email and payment page.`)) return;
    setStripeSending(id);
    try {
      const res = await fetch(`/api/admin/invoices/${id}/send-stripe`, { method: "POST", headers });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Sent via Stripe", description: data.hostedInvoiceUrl ? "Hosted invoice page is now available." : undefined });
        load();
      } else {
        toast({ variant: "destructive", title: "Stripe send failed", description: data.message || "Unknown error" });
      }
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setStripeSending(null);
    }
  };

  const handleDelete = async (id: number, num: string) => {
    if (!confirm(`Delete invoice ${num}?`)) return;
    const res = await fetch(`/api/admin/invoices/${id}`, { method: "DELETE", headers });
    if (res.ok) { load(); toast({ title: "Invoice deleted" }); }
  };

  const totalRevenue = invoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(i.total || 0), 0);
  const outstandingAmt = invoices.filter(i => ["sent", "viewed", "overdue"].includes(i.status)).reduce((s, i) => s + parseFloat(i.total || 0), 0);

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
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Invoices</h1>
            <p className="text-sm text-muted-foreground mt-1">Create, manage, and track partner invoices</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground mb-1">Total Invoices</p><p className="text-2xl font-bold">{invoices.length}</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground mb-1">Paid</p><p className="text-2xl font-bold text-green-600">${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground mb-1">Outstanding</p><p className="text-2xl font-bold text-yellow-600">${outstandingAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-xs text-muted-foreground mb-1">Overdue</p><p className="text-2xl font-bold text-red-600">{invoices.filter(i => i.status === "overdue").length}</p></CardContent></Card>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-between">
            <div className="flex gap-2 flex-wrap">
              {(["all", ...INVOICE_STATUSES] as const).map(s => (
                <button key={s} onClick={() => setFilter(s as any)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors capitalize ${filter === s ? "bg-[#032d60] text-white border-[#032d60]" : "border-input text-muted-foreground hover:text-[#032d60]"}`}>
                  {s === "all" ? "All" : invStatusMeta[s as InvStatus].label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="pl-9 h-9 w-48" /></div>
              <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1"><Plus className="w-4 h-4" /> New Invoice</Button>
            </div>
          </div>

          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create Invoice</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Client</Label>
                    <select value={newInv.userId} onChange={e => setNewInv(p => ({ ...p, userId: e.target.value }))}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                      <option value="">— No client (manual) —</option>
                      {users.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Title</Label>
                    <Input value={newInv.title} onChange={e => setNewInv(p => ({ ...p, title: e.target.value }))} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Due Date</Label>
                    <Input type="date" value={newInv.dueDate} onChange={e => setNewInv(p => ({ ...p, dueDate: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Tax Rate (%)</Label>
                    <Input type="number" min={0} max={100} value={newInv.taxRate} onChange={e => setNewInv(p => ({ ...p, taxRate: parseFloat(e.target.value) || 0 }))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Line Items</Label>
                  {newInv.items.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <Input className="col-span-6" placeholder="Description" value={item.description} onChange={e => { const it = [...newInv.items]; it[i] = { ...it[i], description: e.target.value }; setNewInv(p => ({ ...p, items: it })); }} required />
                      <Input className="col-span-2" type="number" min={1} placeholder="Qty" value={item.qty} onChange={e => { const it = [...newInv.items]; it[i] = { ...it[i], qty: parseFloat(e.target.value) || 1 }; setNewInv(p => ({ ...p, items: it })); }} />
                      <Input className="col-span-3" type="number" min={0} step={0.01} placeholder="Unit $" value={item.unitPrice} onChange={e => { const it = [...newInv.items]; it[i] = { ...it[i], unitPrice: parseFloat(e.target.value) || 0 }; setNewInv(p => ({ ...p, items: it })); }} />
                      <Button type="button" variant="ghost" size="sm" className="col-span-1 px-1 text-red-500" onClick={() => setNewInv(p => ({ ...p, items: p.items.filter((_, j) => j !== i) }))} disabled={newInv.items.length === 1}><X className="w-3 h-3" /></Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => setNewInv(p => ({ ...p, items: [...p.items, { description: "", qty: 1, unitPrice: 0 }] }))}>+ Add Line</Button>
                  <div className="text-right text-sm font-medium">
                    Total: ${newInv.items.reduce((s, it) => s + it.qty * it.unitPrice, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Notes</Label>
                  <Textarea value={newInv.notes} onChange={e => setNewInv(p => ({ ...p, notes: e.target.value }))} rows={2} />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                  <Button type="submit" disabled={creating}>{creating ? "Creating…" : "Create Invoice"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground"><CreditCard className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="font-medium">No invoices found</p></CardContent></Card>
          ) : (
            <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {["Invoice #", "Client", "Title", "Status", "Total", "Due", "Actions"].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-semibold text-xs text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(inv => (
                    <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inv.invoiceNumber}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium leading-tight">{inv.clientName || "—"}</div>
                        {inv.clientCompany && <div className="text-xs text-muted-foreground">{inv.clientCompany}</div>}
                      </td>
                      <td className="px-4 py-3 font-medium">{inv.title}</td>
                      <td className="px-4 py-3"><InvStatusBadge status={inv.status} /></td>
                      <td className="px-4 py-3 font-semibold">${parseFloat(inv.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            value={inv.status}
                            disabled={statusUpdating === inv.id}
                            onChange={e => handleStatusChange(inv.id, e.target.value)}
                            className="text-xs border border-input rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            {INVOICE_STATUSES.map(s => <option key={s} value={s}>{invStatusMeta[s].label}</option>)}
                          </select>
                          {inv.stripeInvoiceId ? (
                            inv.hostedInvoiceUrl ? (
                              <a
                                href={inv.hostedInvoiceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                title="Open Stripe-hosted invoice page"
                              >
                                <ExternalLink className="w-3 h-3" /> Stripe
                              </a>
                            ) : (
                              <span className="text-[10px] text-indigo-700 px-2 py-1 rounded border border-indigo-200">On Stripe</span>
                            )
                          ) : inv.userId && inv.status !== "paid" && inv.status !== "void" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={stripeSending === inv.id}
                              onClick={() => handleSendStripe(inv.id, inv.invoiceNumber)}
                              className="px-2 h-7 text-xs gap-1 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                              title="Send a Stripe-hosted invoice email to the client"
                            >
                              {stripeSending === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                              Stripe
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(inv.id, inv.invoiceNumber)} className="text-red-500 hover:text-red-700 px-1.5 h-7"><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
