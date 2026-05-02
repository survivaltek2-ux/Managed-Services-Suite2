import React, { useState, useEffect, useMemo } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  Inbox, FileText, TicketIcon, DollarSign, Search, Download, Trash2, Mail, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

type TabType = "contacts" | "quotes" | "proposals" | "tickets";

const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: "contacts", label: "Contacts", icon: <Inbox size={18} /> },
  { id: "quotes", label: "Quote Requests", icon: <FileText size={18} /> },
  { id: "proposals", label: "Proposals", icon: <DollarSign size={18} /> },
  { id: "tickets", label: "Tickets", icon: <TicketIcon size={18} /> },
];

export default function AdminInquiries() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabType>("contacts");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, any>>({});

  const headers = getAuthHeaders();

  useEffect(() => {
    fetchData(activeTab);
  }, [activeTab]);

  const fetchData = async (tab: TabType) => {
    setLoading(true);
    try {
      const endpoints: Record<TabType, string> = {
        contacts: "/api/admin/contacts",
        quotes: "/api/admin/quotes",
        proposals: "/api/admin/proposals",
        tickets: "/api/admin/partner/tickets",
      };
      const res = await fetch(endpoints[tab], { headers });
      if (res.ok) {
        const result = await res.json();
        setData(prev => ({ ...prev, [tab]: result }));
      }
    } catch (error) {
      console.error(`Error fetching ${tab}:`, error);
      toast({ title: "Error loading data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = async () => {
    try {
      const endpoints: Record<TabType, string> = {
        contacts: "/api/admin/export/contacts",
        quotes: "/api/admin/quotes",
        proposals: "/api/admin/proposals",
        tickets: "/api/admin/partner/tickets",
      };
      const res = await fetch(endpoints[activeTab], { headers });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: "Exported successfully" });
      }
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  if (!user || !user.isMainSiteAdmin) {
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
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">Inquiries & Requests</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage contacts, quotes, proposals, and support tickets</p>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6 border-b">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {activeTab === "contacts" && <ContactsView data={data.contacts || []} refresh={() => fetchData("contacts")} headers={headers} />}
                {activeTab === "quotes" && <QuotesView data={data.quotes || []} refresh={() => fetchData("quotes")} headers={headers} exportCSV={exportCSV} />}
                {activeTab === "proposals" && <ProposalsView data={data.proposals || []} refresh={() => fetchData("proposals")} headers={headers} />}
                {activeTab === "tickets" && <TicketsView data={data.tickets || []} refresh={() => fetchData("tickets")} headers={headers} exportCSV={exportCSV} />}
              </>
            )}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}

function ContactsView({ data, refresh, headers }: any) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);

  const filtered = useMemo(() => {
    if (!search) return data;
    const s = search.toLowerCase();
    return data.filter((c: any) => c.name.toLowerCase().includes(s) || c.email.toLowerCase().includes(s) || (c.company || "").toLowerCase().includes(s));
  }, [data, search]);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this contact?")) return;
    try {
      await fetch(`/api/admin/contacts/${id}`, { method: "DELETE", headers });
      toast({ title: "Deleted" });
      if (selected?.id === id) setSelected(null);
      refresh();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search contacts..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Card className="max-h-[600px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">No contacts</div>
          ) : (
            <div className="space-y-1">
              {filtered.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted transition-colors ${selected?.id === c.id ? "bg-primary/10" : ""}`}
                >
                  <p className="font-medium text-sm">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="lg:col-span-2">
        {selected ? (
          <Card className="h-full flex flex-col">
            <div className="border-b p-4 flex items-start justify-between">
              <div>
                <h3 className="font-bold text-lg">{selected.name}</h3>
                <p className="text-sm text-muted-foreground">{selected.email}</p>
              </div>
              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(selected.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs uppercase font-semibold text-muted-foreground mb-1">Company</p>
                  <p className="text-sm">{selected.company || "-"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase font-semibold text-muted-foreground mb-1">Service</p>
                  <p className="text-sm">{selected.service || "-"}</p>
                </div>
              </div>
              {selected.phone && (
                <div>
                  <p className="text-xs uppercase font-semibold text-muted-foreground mb-1">Phone</p>
                  <p className="text-sm">{selected.phone}</p>
                </div>
              )}
              <div className="border-t pt-3">
                <p className="text-xs uppercase font-semibold text-muted-foreground mb-2">Message</p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{selected.message}</p>
              </div>
            </div>
            <div className="border-t p-4">
              <Button size="sm" onClick={() => window.location.href = `mailto:${selected.email}`} className="gap-2">
                <Mail className="w-4 h-4" /> Reply via Email
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="h-full flex items-center justify-center text-muted-foreground">
            <p>Select a contact to view details</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function QuotesView({ data, refresh, headers, exportCSV }: any) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);

  const filtered = useMemo(() => {
    if (!search) return data;
    const s = search.toLowerCase();
    return data.filter((q: any) => q.company.toLowerCase().includes(s) || q.name.toLowerCase().includes(s));
  }, [data, search]);

  const updateStatus = async (id: number, status: string) => {
    try {
      await fetch(`/api/admin/quotes/${id}/status`, { method: "PUT", headers, body: JSON.stringify({ status }) });
      toast({ title: "Status updated" });
      refresh();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete?")) return;
    try {
      await fetch(`/api/admin/quotes/${id}`, { method: "DELETE", headers });
      toast({ title: "Deleted" });
      if (selected?.id === id) setSelected(null);
      refresh();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1">
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search quotes..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button variant="outline" size="icon" onClick={exportCSV}><Download className="w-4 h-4" /></Button>
        </div>
        <Card className="max-h-[600px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">No quotes</div>
          ) : (
            <div className="space-y-1">
              {filtered.map((q: any) => (
                <button
                  key={q.id}
                  onClick={() => setSelected(q)}
                  className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted transition-colors ${selected?.id === q.id ? "bg-primary/10" : ""}`}
                >
                  <p className="font-medium text-sm">{q.company}</p>
                  <p className="text-xs text-muted-foreground">{q.name}</p>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="lg:col-span-2">
        {selected ? (
          <Card className="h-full flex flex-col">
            <div className="border-b p-4 flex items-start justify-between">
              <div>
                <h3 className="font-bold text-lg">{selected.company}</h3>
                <p className="text-sm text-muted-foreground">{selected.name}</p>
              </div>
              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(selected.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs uppercase font-semibold text-muted-foreground mb-1">Status</p>
                  <select className="h-8 px-2 rounded border text-xs bg-background w-full" value={selected.status} onChange={e => updateStatus(selected.id, e.target.value)}>
                    <option value="pending">Pending</option>
                    <option value="reviewed">Reviewed</option>
                    <option value="quoted">Quoted</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
                <div>
                  <p className="text-xs uppercase font-semibold text-muted-foreground mb-1">Budget</p>
                  <p className="text-sm font-medium">{selected.budget || "-"}</p>
                </div>
              </div>
              {selected.email && (
                <div>
                  <p className="text-xs uppercase font-semibold text-muted-foreground mb-1">Email</p>
                  <p className="text-sm">{selected.email}</p>
                </div>
              )}
              {selected.details && (
                <div className="border-t pt-3">
                  <p className="text-xs uppercase font-semibold text-muted-foreground mb-2">Details</p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{selected.details}</p>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <Card className="h-full flex items-center justify-center text-muted-foreground">
            <p>Select a quote to view details</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function ProposalsView({ data }: any) {
  const [selected, setSelected] = useState<any>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1">
        <Card className="max-h-[600px] overflow-y-auto">
          {data.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">No proposals</div>
          ) : (
            <div className="space-y-1">
              {data.map((p: any) => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted transition-colors ${selected?.id === p.id ? "bg-primary/10" : ""}`}
                >
                  <p className="font-medium text-sm">{p.proposalNumber}</p>
                  <p className="text-xs text-muted-foreground">{p.clientCompany}</p>
                  <p className="text-xs text-muted-foreground mt-1">${parseFloat(p.total || "0").toLocaleString()}</p>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="lg:col-span-2">
        {selected ? (
          <Card className="h-full flex flex-col p-6">
            <h3 className="font-bold text-lg mb-2">{selected.proposalNumber}</h3>
            <p className="text-sm text-muted-foreground mb-4">{selected.clientCompany}</p>
            <div className="space-y-2 flex-1 overflow-y-auto">
              <div><p className="text-xs text-muted-foreground">Title:</p><p className="text-sm">{selected.title}</p></div>
              <div><p className="text-xs text-muted-foreground">Client:</p><p className="text-sm">{selected.clientName}</p></div>
              <div><p className="text-xs text-muted-foreground">Status:</p><Badge>{selected.status}</Badge></div>
              <div><p className="text-xs text-muted-foreground">Total:</p><p className="text-lg font-bold">${parseFloat(selected.total || "0").toLocaleString()}</p></div>
              {selected.validUntil && <div><p className="text-xs text-muted-foreground">Valid Until:</p><p className="text-sm">{new Date(selected.validUntil).toLocaleDateString()}</p></div>}
            </div>
          </Card>
        ) : (
          <Card className="h-full flex items-center justify-center text-muted-foreground">
            <p>Select a proposal to view details</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function TicketsView({ data, refresh, headers, exportCSV }: any) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [ticketDetail, setTicketDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search) return data;
    const s = search.toLowerCase();
    return data.filter((t: any) => t.subject.toLowerCase().includes(s));
  }, [data, search]);

  const fetchDetail = async (id: number) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/partner/tickets/${id}`, { headers });
      if (res.ok) setTicketDetail(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoadingDetail(false);
    }
  };

  const selectTicket = (t: any) => {
    setSelected(t);
    setReplyText("");
    fetchDetail(t.id);
  };

  React.useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [ticketDetail?.messages?.length]);

  const updateStatus = async (id: number, status: string) => {
    try {
      await fetch(`/api/admin/partner/tickets/${id}`, { method: "PUT", headers, body: JSON.stringify({ status }) });
      toast({ title: "Status updated", description: "Client will be notified by email." });
      refresh();
      fetchDetail(id);
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const sendReply = async () => {
    if (!replyText.trim() || !selected) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/partner/tickets/${selected.id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: replyText.trim() }),
      });
      if (!res.ok) throw new Error();
      setReplyText("");
      toast({ title: "Reply sent", description: "Client will be notified by email." });
      fetchDetail(selected.id);
      refresh();
    } catch {
      toast({ title: "Failed to send reply", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this ticket?")) return;
    try {
      await fetch(`/api/admin/partner/tickets/${id}`, { method: "DELETE", headers });
      toast({ title: "Deleted" });
      if (selected?.id === id) { setSelected(null); setTicketDetail(null); }
      refresh();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const priorityColor = (p: string) => {
    if (p === "urgent" || p === "critical") return "destructive";
    if (p === "high") return "default";
    return "secondary";
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ minHeight: 600 }}>
      <div className="lg:col-span-1">
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search tickets..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button variant="outline" size="icon" onClick={exportCSV}><Download className="w-4 h-4" /></Button>
        </div>
        <Card className="max-h-[600px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">No tickets</div>
          ) : (
            <div className="space-y-0">
              {filtered.map((t: any) => (
                <button
                  key={t.id}
                  onClick={() => selectTicket(t)}
                  className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted transition-colors ${selected?.id === t.id ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                >
                  <p className="font-medium text-sm">#{t.id} {t.subject}</p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    <Badge variant={priorityColor(t.priority)} className="text-xs">{t.priority}</Badge>
                    <Badge variant="outline" className="text-xs">{t.status?.replace("_", " ")}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{new Date(t.createdAt).toLocaleDateString()}</p>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="lg:col-span-2">
        {selected ? (
          <Card className="flex flex-col" style={{ height: 640 }}>
            <div className="border-b p-4 flex items-start justify-between flex-shrink-0">
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-base truncate">#{selected.id} {selected.subject}</h3>
                <div className="flex gap-2 mt-1 items-center flex-wrap">
                  <Badge variant={priorityColor(selected.priority)} className="text-xs">{selected.priority}</Badge>
                  <span className="text-xs text-muted-foreground">{selected.category}</span>
                  <span className="text-xs text-muted-foreground">{new Date(selected.createdAt).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                <select
                  className="h-8 px-2 rounded border text-xs bg-background"
                  value={ticketDetail?.status || selected.status}
                  onChange={e => updateStatus(selected.id, e.target.value)}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={() => handleDelete(selected.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingDetail ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>
              ) : (
                <>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Original Request</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{selected.description}</p>
                  </div>

                  {ticketDetail?.messages?.map((msg: any) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.senderType === "admin" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-4 py-3 ${
                          msg.senderType === "admin"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        <p className="text-xs font-semibold mb-1 opacity-80">{msg.senderName}</p>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.message}</p>
                        <p className="text-xs opacity-60 mt-1 text-right">{new Date(msg.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            <div className="border-t p-3 flex-shrink-0">
              <div className="flex gap-2">
                <textarea
                  className="flex-1 min-h-[72px] max-h-32 px-3 py-2 text-sm rounded-md border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Type your reply... (client will be notified by email)"
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendReply();
                  }}
                  disabled={sending}
                />
                <Button
                  className="self-end"
                  size="sm"
                  onClick={sendReply}
                  disabled={!replyText.trim() || sending}
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Ctrl+Enter to send</p>
            </div>
          </Card>
        ) : (
          <Card className="h-full flex items-center justify-center text-muted-foreground" style={{ minHeight: 400 }}>
            <div className="text-center">
              <p className="font-medium">Select a ticket</p>
              <p className="text-sm mt-1">View messages and reply to clients</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
