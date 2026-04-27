import React, { useState, useEffect, useCallback } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Eye, Send, X, BookOpen, Search, Loader,
  Save, FileText, Clock, CheckCircle, XCircle, Mail,
  Download, Copy, LayoutTemplate, Users, Tag, ChevronDown, Edit,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useTsdProducts, type TsdProduct } from "@/hooks/use-tsd-products";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LineItem {
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  recurring: boolean;
  recurringInterval: string;
}

interface ProposalForm {
  clientName: string;
  clientEmail: string;
  clientCompany: string;
  clientPhone: string;
  title: string;
  summary: string;
  discount: number;
  discountType: "fixed" | "percent";
  tax: number;
  validUntil: string;
  terms: string;
  lineItems: LineItem[];
}

interface SavedProposal {
  id: number;
  proposalNumber: string;
  clientName: string;
  clientEmail: string;
  clientCompany: string;
  title: string;
  total: string;
  status: string;
  version: number;
  sentAt: string | null;
  viewedAt: string | null;
  createdAt: string;
  lineItems: any[];
  discount: string;
  discountType: string;
  tax: string;
  summary: string | null;
  terms: string | null;
  clientPhone: string | null;
  validUntil: string | null;
}

interface Template {
  id: number;
  name: string;
  description: string | null;
  title: string;
  summary: string | null;
  terms: string | null;
  discountType: string;
  discount: string;
  tax: string;
  lineItems: any[];
  isGlobal: boolean;
}

interface Client {
  clientName: string;
  clientEmail: string;
  clientCompany: string;
  clientPhone: string | null;
}

interface MarketplaceProduct {
  id: number;
  title: string;
  description: string;
  category: string;
  price: string | null;
  vendorName?: string;
}

const BASE_API = "/api/partner/proposals";
const DEFAULT_TERMS = "Payment is due within 30 days of invoice.\nPrices are valid for the duration specified.\nAll services subject to the terms of our Master Service Agreement.";

const BLANK_LINE_ITEM: LineItem = { name: "", description: "", quantity: 1, unitPrice: 0, unit: "each", recurring: false, recurringInterval: "monthly" };

const BLANK_FORM: ProposalForm = {
  clientName: "", clientEmail: "", clientCompany: "", clientPhone: "",
  title: "", summary: "", discount: 0, discountType: "fixed", tax: 0,
  validUntil: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  terms: DEFAULT_TERMS,
  lineItems: [{ ...BLANK_LINE_ITEM }],
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:    { label: "Draft",    color: "text-muted-foreground", icon: <FileText className="w-3 h-3" /> },
  sent:     { label: "Sent",     color: "text-blue-600",         icon: <Mail className="w-3 h-3" /> },
  viewed:   { label: "Viewed",   color: "text-purple-600",       icon: <Eye className="w-3 h-3" /> },
  accepted: { label: "Accepted", color: "text-green-600",        icon: <CheckCircle className="w-3 h-3" /> },
  rejected: { label: "Rejected", color: "text-red-600",          icon: <XCircle className="w-3 h-3" /> },
  expired:  { label: "Expired",  color: "text-orange-500",       icon: <Clock className="w-3 h-3" /> },
};

const DISCOUNT_PRESETS = [
  { label: "5%", value: 5, type: "percent" as const },
  { label: "10%", value: 10, type: "percent" as const },
  { label: "15%", value: 15, type: "percent" as const },
  { label: "20%", value: 20, type: "percent" as const },
  { label: "$50", value: 50, type: "fixed" as const },
  { label: "$100", value: 100, type: "fixed" as const },
];

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authHeader() {
  const token = localStorage.getItem("partner_token");
  return token ? { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

// ─── Product Picker Modal ────────────────────────────────────────────────────

function ProductPickerModal({ onSelect, onClose }: {
  onSelect: (product: TsdProduct | MarketplaceProduct) => void;
  onClose: () => void;
}) {
  const { data: tsdData, isLoading: tsdLoading } = useTsdProducts();
  const [mpProducts, setMpProducts] = useState<MarketplaceProduct[]>([]);
  const [mpLoading, setMpLoading] = useState(true);
  const [tab, setTab] = useState<"tsd" | "marketplace">("tsd");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("partner_token");
    const headers: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};
    fetch("/api/marketplace/partner/products", { headers })
      .then(r => r.ok ? r.json() : { products: [] })
      .then(d => setMpProducts(d.products ?? []))
      .catch(() => {})
      .finally(() => setMpLoading(false));
  }, []);

  const tsdProducts = (tsdData?.products ?? []).filter(p => p.active);
  const filteredTsd = tsdProducts.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase()) ||
    (p.description ?? "").toLowerCase().includes(search.toLowerCase())
  );
  const filteredMp = mpProducts.filter(p =>
    !search || p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase()) ||
    (p.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const groupedTsd: Record<string, TsdProduct[]> = {};
  for (const p of filteredTsd) { if (!groupedTsd[p.category]) groupedTsd[p.category] = []; groupedTsd[p.category].push(p); }
  const groupedMp: Record<string, MarketplaceProduct[]> = {};
  for (const p of filteredMp) { if (!groupedMp[p.category]) groupedMp[p.category] = []; groupedMp[p.category].push(p); }

  const isLoading = tab === "tsd" ? tsdLoading : mpLoading;
  const grouped = tab === "tsd" ? groupedTsd : groupedMp;
  const isEmpty = Object.keys(grouped).length === 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-xl max-h-[80vh] flex flex-col p-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-lg">Browse Product Catalog</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="flex border-b bg-muted/50 px-6">
          {(["tsd", "marketplace"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}>
              {t === "tsd" ? "TSD Products" : "Partner Products"}
            </button>
          ))}
        </div>
        <div className="px-6 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : isEmpty ? (
            <p className="text-sm text-muted-foreground text-center py-8">{search ? "No products match." : "No products in catalog."}</p>
          ) : (
            <div className="space-y-5">
              {Object.entries(grouped).map(([category, products]) => (
                <div key={category}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{category}</p>
                  <div className="space-y-1">
                    {products.map((product) => {
                      const name = "name" in product ? (product as TsdProduct).name : (product as MarketplaceProduct).title;
                      const price = "price" in product && (product as MarketplaceProduct).price ? `$${(product as MarketplaceProduct).price}` : "";
                      return (
                        <button key={product.id} className="w-full text-left px-3 py-2.5 rounded-md hover:bg-muted transition-colors"
                          onClick={() => { onSelect(product); onClose(); }}>
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">{name}</p>
                            {price && <span className="text-xs font-medium text-blue-600">{price}</span>}
                          </div>
                          {product.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{product.description}</p>}
                          {"vendorName" in product && (product as MarketplaceProduct).vendorName && (
                            <p className="text-xs text-muted-foreground">by {(product as MarketplaceProduct).vendorName}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Save as Template Modal ──────────────────────────────────────────────────

function SaveTemplateModal({ form, onSave, onClose }: {
  form: ProposalForm;
  onSave: (template: Template) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function save() {
    if (!name.trim()) { toast({ title: "Template name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE_API}/templates`, {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({
          name, description,
          title: form.title,
          summary: form.summary,
          terms: form.terms,
          discountType: form.discountType,
          discount: form.discount,
          tax: form.tax,
          lineItems: form.lineItems,
        }),
      });
      if (res.ok) {
        const template = await res.json();
        toast({ title: "Template saved!" });
        onSave(template);
        onClose();
      } else {
        toast({ title: "Failed to save template", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg">Save as Template</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Template Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., IT Infrastructure Bundle" autoFocus />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this template is for" />
          </div>
          <p className="text-xs text-muted-foreground">Saves: proposal title, summary, terms, discount, tax, and all line items.</p>
        </div>
        <div className="flex gap-2 mt-5">
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Template
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Preview Modal ────────────────────────────────────────────────────────────

function PreviewModal({ form, onClose }: { form: ProposalForm; onClose: () => void }) {
  const subtotal = form.lineItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const disc = form.discountType === "fixed" ? form.discount : subtotal * form.discount / 100;
  const taxAmt = (subtotal - disc) * form.tax / 100;
  const total = subtotal - disc + taxAmt;

  function printProposal() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const html = document.getElementById("proposal-preview-content")?.innerHTML ?? "";
    printWindow.document.write(`<html><head><title>${form.title}</title>
    <style>body{font-family:sans-serif;padding:2rem;max-width:800px;margin:0 auto}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd;text-align:left}th{background:#f5f5f5}@media print{button{display:none}}</style>
    </head><body>${html}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 500);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-auto p-0">
        <div className="flex justify-between items-center px-8 py-4 border-b sticky top-0 bg-background z-10">
          <h2 className="font-bold text-lg">Proposal Preview</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={printProposal} className="gap-1.5">
              <Download className="w-4 h-4" /> Print / PDF
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>
        <div id="proposal-preview-content" className="p-8 space-y-6 text-sm">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{form.title}</h1>
              <p className="text-muted-foreground mt-1">Valid until: {new Date(form.validUntil).toLocaleDateString()}</p>
            </div>
            <div className="text-right text-muted-foreground text-xs">
              <p className="font-semibold text-foreground">Siebert Services</p>
              <p>Prepared for:</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-muted/50 rounded p-4">
              <h3 className="font-bold mb-2">Bill To:</h3>
              <p className="font-medium">{form.clientName}</p>
              <p>{form.clientCompany}</p>
              {form.clientEmail && <p className="text-muted-foreground">{form.clientEmail}</p>}
              {form.clientPhone && <p className="text-muted-foreground">{form.clientPhone}</p>}
            </div>
            <div className="bg-muted/50 rounded p-4">
              <h3 className="font-bold mb-2">Summary</h3>
              <p className="text-muted-foreground">{form.summary || "—"}</p>
            </div>
          </div>
          <table className="w-full text-xs border border-border">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left px-3 py-2 border-b border-border">Item</th>
                <th className="text-right px-3 py-2 border-b border-border">Qty</th>
                <th className="text-right px-3 py-2 border-b border-border">Unit Price</th>
                <th className="text-right px-3 py-2 border-b border-border">Total</th>
              </tr>
            </thead>
            <tbody>
              {form.lineItems.map((item, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.name}</div>
                    {item.description && <div className="text-muted-foreground">{item.description}</div>}
                    {item.recurring && <div className="text-blue-600">Recurring · {item.recurringInterval}</div>}
                  </td>
                  <td className="px-3 py-2 text-right">{item.quantity} {item.unit}</td>
                  <td className="px-3 py-2 text-right">${item.unitPrice.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-medium">${(item.quantity * item.unitPrice).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end">
            <div className="w-72 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
              {form.discount > 0 && <div className="flex justify-between text-green-600"><span>Discount ({form.discountType === "percent" ? `${form.discount}%` : "fixed"})</span><span>-${disc.toFixed(2)}</span></div>}
              {form.tax > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax ({form.tax}%)</span><span>${taxAmt.toFixed(2)}</span></div>}
              <div className="flex justify-between font-bold text-base border-t pt-2"><span>Total</span><span className="text-primary">${total.toFixed(2)}</span></div>
            </div>
          </div>
          {form.terms && (
            <div className="border-t pt-4">
              <h3 className="font-bold mb-1 text-xs uppercase tracking-wide text-muted-foreground">Terms & Conditions</h3>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{form.terms}</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ProposalGenerator() {
  const { user } = useAuth();
  const { toast } = useToast();

  const isTeamMemberWithoutAccess = user?.isTeamMember && !user?.teamMember?.permissions?.canCreatePlans;

  const [tab, setTab] = useState<"create" | "proposals" | "templates">("create");
  const [form, setForm] = useState<ProposalForm>(BLANK_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [proposals, setProposals] = useState<SavedProposal[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPickerTargetIdx, setProductPickerTargetIdx] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [showTemplateList, setShowTemplateList] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);

  const subtotal = form.lineItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const discountAmount = form.discountType === "fixed" ? form.discount : subtotal * form.discount / 100;
  const taxAmount = (subtotal - discountAmount) * form.tax / 100;
  const total = subtotal - discountAmount + taxAmount;

  const fetchProposals = useCallback(async () => {
    setLoadingProposals(true);
    try {
      const res = await fetch(BASE_API, { headers: authHeader() });
      if (res.ok) { const d = await res.json(); setProposals(d.proposals ?? []); }
    } finally { setLoadingProposals(false); }
  }, []);

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch(`${BASE_API}/templates`, { headers: authHeader() });
      if (res.ok) { const d = await res.json(); setTemplates(d.templates ?? []); }
    } finally { setLoadingTemplates(false); }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_API}/clients`, { headers: authHeader() });
      if (res.ok) { const d = await res.json(); setClients(d.clients ?? []); }
    } catch {}
  }, []);

  useEffect(() => { if (!isTeamMemberWithoutAccess) { fetchProposals(); fetchTemplates(); fetchClients(); } }, [isTeamMemberWithoutAccess]);

  if (isTeamMemberWithoutAccess) {
    return (
      <PortalLayout>
        <div className="px-6 py-12 text-center">
          <p className="text-muted-foreground">Access denied. You don't have permission to access the proposal generator.</p>
        </div>
      </PortalLayout>
    );
  }

  // ─── Line Items ────────────────────────────────────────────────────────────

  const addLineItem = () => setForm(p => ({ ...p, lineItems: [...p.lineItems, { ...BLANK_LINE_ITEM }] }));
  const removeLineItem = (idx: number) => setForm(p => ({ ...p, lineItems: p.lineItems.filter((_, i) => i !== idx) }));
  const updateLineItem = (idx: number, field: string, value: any) =>
    setForm(p => ({ ...p, lineItems: p.lineItems.map((item, i) => i === idx ? { ...item, [field]: value } : item) }));

  const handleProductSelect = (product: TsdProduct | MarketplaceProduct) => {
    const name = "name" in product ? (product as TsdProduct).name : (product as MarketplaceProduct).title;
    const desc = product.description ?? "";
    const price = "price" in product && (product as MarketplaceProduct).price ? parseFloat((product as MarketplaceProduct).price!) : 0;
    if (productPickerTargetIdx === null) {
      setForm(p => ({ ...p, lineItems: [...p.lineItems, { ...BLANK_LINE_ITEM, name, description: desc, unitPrice: price }] }));
    } else {
      updateLineItem(productPickerTargetIdx, "name", name);
      updateLineItem(productPickerTargetIdx, "description", desc);
      updateLineItem(productPickerTargetIdx, "unitPrice", price);
    }
    setProductPickerTargetIdx(null);
  };

  const openProductPicker = (idx: number | "new") => {
    setProductPickerTargetIdx(idx === "new" ? null : idx);
    setProductPickerOpen(true);
  };

  // ─── Load Template ─────────────────────────────────────────────────────────

  function loadTemplate(t: Template) {
    setForm(p => ({
      ...p,
      title: t.title,
      summary: t.summary || "",
      terms: t.terms || DEFAULT_TERMS,
      discountType: (t.discountType as any) || "fixed",
      discount: parseFloat(t.discount) || 0,
      tax: parseFloat(t.tax) || 0,
      lineItems: (t.lineItems as any[]).length > 0
        ? (t.lineItems as any[]).map(li => ({
            name: li.name || "", description: li.description || "", quantity: li.quantity || 1,
            unitPrice: parseFloat(li.unitPrice) || 0, unit: li.unit || "each",
            recurring: li.recurring || false, recurringInterval: li.recurringInterval || "monthly",
          }))
        : [{ ...BLANK_LINE_ITEM }],
    }));
    setShowTemplateList(false);
    toast({ title: `Template "${t.name}" loaded` });
  }

  // ─── Edit proposal ─────────────────────────────────────────────────────────

  function editProposal(p: SavedProposal) {
    setEditingId(p.id);
    setForm({
      clientName: p.clientName,
      clientEmail: p.clientEmail,
      clientCompany: p.clientCompany,
      clientPhone: p.clientPhone || "",
      title: p.title,
      summary: p.summary || "",
      discount: parseFloat(p.discount) || 0,
      discountType: (p.discountType as any) || "fixed",
      tax: parseFloat(p.tax) || 0,
      validUntil: p.validUntil ? p.validUntil.slice(0, 10) : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      terms: p.terms || DEFAULT_TERMS,
      lineItems: p.lineItems.length > 0 ? p.lineItems.map(li => ({
        name: li.name, description: li.description || "", quantity: li.quantity || 1,
        unitPrice: parseFloat(li.unitPrice) || 0, unit: li.unit || "each",
        recurring: li.recurring || false, recurringInterval: li.recurringInterval || "monthly",
      })) : [{ ...BLANK_LINE_ITEM }],
    });
    setTab("create");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ─── Save proposal ─────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.clientName || !form.clientEmail || !form.clientCompany || !form.title) {
      toast({ title: "Please fill in required fields", variant: "destructive" }); return;
    }
    if (form.lineItems.some(item => !item.name || item.unitPrice < 0)) {
      toast({ title: "Please complete all line items", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const url = editingId ? `${BASE_API}/${editingId}` : BASE_API;
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: authHeader(),
        body: JSON.stringify({ ...form, total: total.toFixed(2) }),
      });
      if (res.ok) {
        toast({ title: editingId ? "Proposal updated!" : "Proposal saved!" });
        setEditingId(null);
        setForm(BLANK_FORM);
        fetchProposals();
        fetchClients();
        setTab("proposals");
      } else {
        const data = await res.json();
        toast({ title: data.message || "Failed to save proposal", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error saving proposal", variant: "destructive" });
    } finally { setSaving(false); }
  }

  // ─── Send to client ────────────────────────────────────────────────────────

  async function handleSend(id: number) {
    setSending(id);
    try {
      const res = await fetch(`${BASE_API}/${id}/send`, { method: "PUT", headers: authHeader() });
      if (res.ok) {
        toast({ title: "Proposal sent to client!" });
        fetchProposals();
      } else {
        toast({ title: "Failed to send proposal", variant: "destructive" });
      }
    } finally { setSending(null); }
  }

  // ─── Delete proposal ───────────────────────────────────────────────────────

  async function handleDelete(id: number) {
    if (!confirm("Delete this proposal? This cannot be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`${BASE_API}/${id}`, { method: "DELETE", headers: authHeader() });
      if (res.ok) { toast({ title: "Proposal deleted" }); fetchProposals(); }
      else { toast({ title: "Failed to delete", variant: "destructive" }); }
    } finally { setDeleting(null); }
  }

  // ─── Delete template ───────────────────────────────────────────────────────

  async function handleDeleteTemplate(id: number) {
    if (!confirm("Delete this template?")) return;
    const res = await fetch(`${BASE_API}/templates/${id}`, { method: "DELETE", headers: authHeader() });
    if (res.ok) { toast({ title: "Template deleted" }); fetchTemplates(); }
    else { toast({ title: "Failed to delete template", variant: "destructive" }); }
  }

  // ─── Client autocomplete ───────────────────────────────────────────────────

  const filteredClients = clients.filter(c =>
    c.clientName.toLowerCase().includes(clientSearch.toLowerCase()) ||
    c.clientEmail.toLowerCase().includes(clientSearch.toLowerCase()) ||
    c.clientCompany.toLowerCase().includes(clientSearch.toLowerCase())
  );

  function selectClient(c: Client) {
    setForm(p => ({ ...p, clientName: c.clientName, clientEmail: c.clientEmail, clientCompany: c.clientCompany, clientPhone: c.clientPhone || "" }));
    setShowClientDropdown(false);
    setClientSearch("");
  }

  if (!user) return null;

  return (
    <PortalLayout>
      <div className="px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Proposals</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Create, manage, and send professional proposals</p>
            </div>
            <Button onClick={() => { setEditingId(null); setForm(BLANK_FORM); setTab("create"); }} className="gap-1.5">
              <Plus className="w-4 h-4" /> New Proposal
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-0.5 border-b border-border mb-6">
            {([
              { key: "create", label: editingId ? "Edit Proposal" : "Create Proposal", icon: FileText },
              { key: "proposals", label: `My Proposals (${proposals.length})`, icon: Clock },
              { key: "templates", label: `Templates (${templates.length})`, icon: LayoutTemplate },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => setTab(key)}
                className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5",
                  tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                <Icon className="w-4 h-4" />{label}
              </button>
            ))}
          </div>

          {/* ── CREATE TAB ── */}
          {tab === "create" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-5">

                {/* Template Bar */}
                <Card className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <Button size="sm" variant="outline" onClick={() => setShowTemplateList(v => !v)} className="gap-1.5 w-full justify-between">
                        <div className="flex items-center gap-1.5"><LayoutTemplate className="w-4 h-4" /> Load Template</div>
                        <ChevronDown className="w-3 h-3" />
                      </Button>
                      {showTemplateList && (
                        <div className="absolute top-full left-0 w-80 bg-background border rounded-lg shadow-lg z-10 mt-1 max-h-56 overflow-y-auto">
                          {loadingTemplates ? (
                            <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
                          ) : templates.length === 0 ? (
                            <div className="p-4 text-center text-sm text-muted-foreground">No templates yet. Save one from the form below.</div>
                          ) : templates.map(t => (
                            <button key={t.id} className="w-full text-left px-4 py-2.5 hover:bg-muted text-sm border-b last:border-0"
                              onClick={() => loadTemplate(t)}>
                              <div className="font-medium">{t.name}{t.isGlobal && <span className="ml-1.5 text-xs text-blue-600">(Global)</span>}</div>
                              {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setSaveTemplateOpen(true)} className="gap-1.5 whitespace-nowrap">
                      <Save className="w-4 h-4" /> Save as Template
                    </Button>
                    {editingId && (
                      <div className="flex items-center gap-2 text-xs text-blue-600 font-medium bg-blue-50 px-3 py-1.5 rounded">
                        <Edit className="w-3 h-3" /> Editing proposal
                      </div>
                    )}
                  </div>
                </Card>

                {/* Client Info */}
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-bold text-lg">Client Information</h2>
                    {clients.length > 0 && (
                      <div className="relative">
                        <Button size="sm" variant="outline" onClick={() => setShowClientDropdown(v => !v)} className="gap-1.5">
                          <Users className="w-4 h-4" /> Repeat Client
                        </Button>
                        {showClientDropdown && (
                          <div className="absolute right-0 top-full w-72 bg-background border rounded-lg shadow-lg z-10 mt-1">
                            <div className="p-2 border-b">
                              <Input placeholder="Search clients..." value={clientSearch}
                                onChange={e => setClientSearch(e.target.value)} className="h-8 text-xs" autoFocus />
                            </div>
                            <div className="max-h-48 overflow-y-auto">
                              {filteredClients.slice(0, 10).map((c, i) => (
                                <button key={i} onClick={() => selectClient(c)}
                                  className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-0">
                                  <div className="font-medium">{c.clientName}</div>
                                  <div className="text-xs text-muted-foreground">{c.clientCompany} · {c.clientEmail}</div>
                                </button>
                              ))}
                              {filteredClients.length === 0 && <p className="text-xs text-muted-foreground p-3 text-center">No clients found</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Client Name *</Label>
                      <Input value={form.clientName} onChange={e => setForm({ ...form, clientName: e.target.value })} placeholder="John Doe" />
                    </div>
                    <div>
                      <Label className="text-xs">Email *</Label>
                      <Input type="email" value={form.clientEmail} onChange={e => setForm({ ...form, clientEmail: e.target.value })} placeholder="john@company.com" />
                    </div>
                    <div>
                      <Label className="text-xs">Company *</Label>
                      <Input value={form.clientCompany} onChange={e => setForm({ ...form, clientCompany: e.target.value })} placeholder="ABC Corporation" />
                    </div>
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input value={form.clientPhone} onChange={e => setForm({ ...form, clientPhone: e.target.value })} placeholder="(555) 123-4567" />
                    </div>
                  </div>
                </Card>

                {/* Proposal Details */}
                <Card className="p-6">
                  <h2 className="font-bold text-lg mb-4">Proposal Details</h2>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs">Proposal Title *</Label>
                      <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="IT Infrastructure Modernization" />
                    </div>
                    <div>
                      <Label className="text-xs">Summary</Label>
                      <Textarea value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} placeholder="Brief overview of the proposal..." className="min-h-[80px]" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs">Valid Until</Label>
                        <Input type="date" value={form.validUntil} onChange={e => setForm({ ...form, validUntil: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">Tax Rate (%)</Label>
                        <Input type="number" step="0.01" value={form.tax} onChange={e => setForm({ ...form, tax: parseFloat(e.target.value) || 0 })} />
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Line Items */}
                <Card className="p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="font-bold text-lg">Services & Items</h2>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openProductPicker("new")}>
                        <BookOpen className="w-4 h-4 mr-1" />Browse Catalog
                      </Button>
                      <Button size="sm" variant="outline" onClick={addLineItem}>
                        <Plus className="w-4 h-4 mr-1" />Add Item
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {form.lineItems.map((item, idx) => (
                      <div key={idx} className="border rounded-lg p-4 bg-muted/30">
                        <div className="grid grid-cols-12 gap-3 mb-3">
                          <div className="col-span-6">
                            <div className="flex items-center justify-between mb-1">
                              <Label className="text-xs">Item Name *</Label>
                              <button type="button" className="text-xs text-primary hover:underline flex items-center gap-1"
                                onClick={() => openProductPicker(idx)}>
                                <BookOpen className="w-3 h-3" />From catalog
                              </button>
                            </div>
                            <Input value={item.name} onChange={e => updateLineItem(idx, "name", e.target.value)} placeholder="e.g., Network Setup" />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Qty</Label>
                            <Input type="number" min="1" value={item.quantity} onChange={e => updateLineItem(idx, "quantity", parseInt(e.target.value) || 1)} />
                          </div>
                          <div className="col-span-3">
                            <Label className="text-xs">Unit Price *</Label>
                            <Input type="number" step="0.01" value={item.unitPrice} onChange={e => updateLineItem(idx, "unitPrice", parseFloat(e.target.value) || 0)} placeholder="0.00" />
                          </div>
                          <div className="col-span-1 flex items-end">
                            {form.lineItems.length > 1 && (
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeLineItem(idx)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label className="text-xs">Unit</Label>
                            <select className="w-full h-9 px-2 rounded border text-xs bg-background" value={item.unit} onChange={e => updateLineItem(idx, "unit", e.target.value)}>
                              {["each", "hour", "day", "month", "year"].map(u => <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>)}
                            </select>
                          </div>
                          <div>
                            <Label className="text-xs">Description</Label>
                            <Input value={item.description} onChange={e => updateLineItem(idx, "description", e.target.value)} placeholder="Optional description" />
                          </div>
                          <div>
                            <Label className="text-xs">Line Total</Label>
                            <div className="h-9 flex items-center px-2 bg-muted rounded border text-sm font-semibold">${(item.quantity * item.unitPrice).toFixed(2)}</div>
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-xs mt-3">
                          <input type="checkbox" checked={item.recurring} onChange={e => updateLineItem(idx, "recurring", e.target.checked)} className="w-4 h-4" />
                          Recurring
                          {item.recurring && (
                            <select className="h-7 px-2 rounded border text-xs bg-background ml-2" value={item.recurringInterval} onChange={e => updateLineItem(idx, "recurringInterval", e.target.value)}>
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="annually">Annually</option>
                            </select>
                          )}
                        </label>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Discount */}
                <Card className="p-6">
                  <h2 className="font-bold text-lg mb-3">Discount</h2>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {DISCOUNT_PRESETS.map(preset => (
                      <button key={preset.label}
                        onClick={() => setForm(f => ({ ...f, discount: preset.value, discountType: preset.type }))}
                        className={cn("px-3 py-1.5 text-xs rounded border font-medium transition-colors flex items-center gap-1",
                          form.discount === preset.value && form.discountType === preset.type
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted")}>
                        <Tag className="w-3 h-3" />{preset.label}
                      </button>
                    ))}
                    <button onClick={() => setForm(f => ({ ...f, discount: 0 }))}
                      className="px-3 py-1.5 text-xs rounded border font-medium text-muted-foreground hover:bg-muted">
                      Clear
                    </button>
                  </div>
                  <div className="flex gap-3">
                    <Input type="number" step="0.01" value={form.discount}
                      onChange={e => setForm({ ...form, discount: parseFloat(e.target.value) || 0 })}
                      placeholder="0" className="flex-1" />
                    <select className="h-10 px-3 rounded border text-sm bg-background" value={form.discountType}
                      onChange={e => setForm({ ...form, discountType: e.target.value as any })}>
                      <option value="fixed">$ Fixed</option>
                      <option value="percent">% Percent</option>
                    </select>
                  </div>
                </Card>

                {/* Terms */}
                <Card className="p-6">
                  <Label className="text-sm font-bold">Terms & Conditions</Label>
                  <Textarea value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} className="min-h-[120px] mt-2" />
                </Card>

                {/* Actions */}
                <div className="flex flex-wrap gap-3">
                  <Button onClick={handleSave} disabled={saving} className="gap-2">
                    {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {editingId ? "Update Proposal" : "Save Proposal"}
                  </Button>
                  <Button variant="outline" onClick={() => setPreviewOpen(true)} className="gap-2"><Eye className="w-4 h-4" /> Preview</Button>
                  {editingId && (
                    <Button variant="ghost" onClick={() => { setEditingId(null); setForm(BLANK_FORM); }} className="text-muted-foreground">
                      Cancel Edit
                    </Button>
                  )}
                </div>
              </div>

              {/* Summary Panel */}
              <div className="sticky top-20 h-fit space-y-4">
                <Card className="p-5">
                  <h2 className="font-bold text-base mb-4">Summary</h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
                    {form.discount > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>-${discountAmount.toFixed(2)}</span></div>}
                    <div className="flex justify-between"><span className="text-muted-foreground">After Discount</span><span>${(subtotal - discountAmount).toFixed(2)}</span></div>
                    {form.tax > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax ({form.tax}%)</span><span>${taxAmount.toFixed(2)}</span></div>}
                    <div className="border-t pt-2 flex justify-between text-base"><span className="font-bold">Total</span><span className="font-bold text-primary text-lg">${total.toFixed(2)}</span></div>
                  </div>
                  <div className="mt-4 space-y-2 text-xs text-muted-foreground border-t pt-4">
                    <div><span className="font-semibold">Items:</span> {form.lineItems.length}</div>
                    <div><span className="font-semibold">Valid Until:</span> {new Date(form.validUntil).toLocaleDateString()}</div>
                    {editingId && <div><span className="font-semibold text-blue-600">Editing proposal #{editingId}</span></div>}
                  </div>
                </Card>

                <Card className="p-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Quick Actions</p>
                  <div className="space-y-2">
                    <Button size="sm" variant="outline" className="w-full justify-start gap-2" onClick={() => setPreviewOpen(true)}>
                      <Eye className="w-4 h-4" />Preview & Print
                    </Button>
                    <Button size="sm" variant="outline" className="w-full justify-start gap-2" onClick={() => setSaveTemplateOpen(true)}>
                      <LayoutTemplate className="w-4 h-4" />Save as Template
                    </Button>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* ── PROPOSALS TAB ── */}
          {tab === "proposals" && (
            <div>
              {loadingProposals ? (
                <div className="flex justify-center py-12"><Loader className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : proposals.length === 0 ? (
                <Card className="p-12 text-center">
                  <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="font-medium text-foreground">No proposals yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Create your first proposal using the Create tab.</p>
                  <Button className="mt-4" onClick={() => setTab("create")}>Create Proposal</Button>
                </Card>
              ) : (
                <div className="space-y-3">
                  {proposals.map(p => {
                    const sc = STATUS_CONFIG[p.status] || STATUS_CONFIG.draft;
                    return (
                      <Card key={p.id} className="p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs text-muted-foreground">{p.proposalNumber}</span>
                              <span className={cn("flex items-center gap-1 text-xs font-medium", sc.color)}>
                                {sc.icon}{sc.label}
                              </span>
                              <span className="text-xs text-muted-foreground">v{p.version}</span>
                            </div>
                            <h3 className="font-semibold text-foreground mt-1 truncate">{p.title}</h3>
                            <p className="text-sm text-muted-foreground">{p.clientName} · {p.clientCompany}</p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <span className="font-semibold text-foreground text-sm">${parseFloat(p.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                              <span>Created {format(new Date(p.createdAt), "MMM d, yyyy")}</span>
                              {p.sentAt && <span>Sent {format(new Date(p.sentAt), "MMM d")}</span>}
                              {p.viewedAt && <span className="text-purple-600">Viewed {format(new Date(p.viewedAt), "MMM d")}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button size="sm" variant="outline" onClick={() => editProposal(p)} className="gap-1">
                              <Edit className="w-3.5 h-3.5" />Edit
                            </Button>
                            {(p.status === "draft" || p.status === "viewed") && (
                              <Button size="sm" onClick={() => handleSend(p.id)} disabled={sending === p.id} className="gap-1">
                                {sending === p.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                Send
                              </Button>
                            )}
                            {p.status === "sent" && (
                              <Button size="sm" variant="outline" onClick={() => handleSend(p.id)} disabled={sending === p.id} className="gap-1">
                                {sending === p.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                                Resend
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                              onClick={() => handleDelete(p.id)} disabled={deleting === p.id}>
                              {deleting === p.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── TEMPLATES TAB ── */}
          {tab === "templates" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-muted-foreground">Save common proposal structures to reuse across clients.</p>
                <Button size="sm" onClick={() => { setTab("create"); setSaveTemplateOpen(true); }} className="gap-1.5">
                  <Plus className="w-4 h-4" />New Template
                </Button>
              </div>
              {loadingTemplates ? (
                <div className="flex justify-center py-12"><Loader className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : templates.length === 0 ? (
                <Card className="p-12 text-center">
                  <LayoutTemplate className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="font-medium">No templates yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Build a proposal and use "Save as Template" to create one.</p>
                </Card>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {templates.map(t => (
                    <Card key={t.id} className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-semibold text-foreground">{t.name}</h3>
                          {t.isGlobal && <span className="text-xs text-blue-600 font-medium">Global</span>}
                        </div>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive -mt-1 -mr-2"
                          onClick={() => handleDeleteTemplate(t.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      {t.description && <p className="text-xs text-muted-foreground mb-2">{t.description}</p>}
                      <p className="text-xs text-muted-foreground mb-3">
                        {(t.lineItems as any[]).length} line items · Discount: {parseFloat(t.discount) > 0 ? `${t.discount} (${t.discountType})` : "none"}
                      </p>
                      <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => { loadTemplate(t); setTab("create"); }}>
                        <Copy className="w-4 h-4" />Use Template
                      </Button>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {productPickerOpen && <ProductPickerModal onSelect={handleProductSelect} onClose={() => setProductPickerOpen(false)} />}
      {previewOpen && <PreviewModal form={form} onClose={() => setPreviewOpen(false)} />}
      {saveTemplateOpen && <SaveTemplateModal form={form} onSave={t => setTemplates(prev => [t, ...prev])} onClose={() => setSaveTemplateOpen(false)} />}
    </PortalLayout>
  );
}
