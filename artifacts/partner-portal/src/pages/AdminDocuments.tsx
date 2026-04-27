import React, { useState, useEffect, useMemo, useRef } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Search, Upload, Download, Trash2, Loader2, FileSignature, Plus, Minus, CheckCircle2, Eye, XCircle, AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocation } from "wouter";

const CATEGORIES = ["contract", "proposal", "invoice", "report", "agreement", "other"];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.FC<any> }> = {
  sent:      { label: "Sent for Signature", color: "bg-blue-100 text-blue-800",    icon: Clock },
  viewed:    { label: "Viewed",             color: "bg-yellow-100 text-yellow-800", icon: Eye },
  signed:    { label: "Signed",             color: "bg-indigo-100 text-indigo-800", icon: CheckCircle2 },
  completed: { label: "Completed",          color: "bg-green-100 text-green-800",  icon: CheckCircle2 },
  declined:  { label: "Declined",           color: "bg-red-100 text-red-800",      icon: XCircle },
  expired:   { label: "Expired",            color: "bg-gray-100 text-gray-600",    icon: AlertTriangle },
};

function EnvelopeStatusBadge({
  envelope,
  onNavigate,
  onRefresh,
  refreshing,
}: {
  envelope: { id: number; status: string };
  onNavigate: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const cfg = STATUS_CONFIG[envelope.status] || { label: envelope.status, color: "bg-gray-100 text-gray-600", icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={onNavigate}
        title="View envelope details"
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${cfg.color}`}
      >
        <Icon className="w-3 h-3" />
        {cfg.label}
      </button>
      <button
        onClick={e => { e.stopPropagation(); onRefresh(); }}
        title="Refresh envelope status"
        disabled={refreshing}
        className="inline-flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
      >
        <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
      </button>
    </span>
  );
}

interface Signer {
  name: string;
  email: string;
  role: string;
  signingOrder: number;
}

export default function AdminDocuments() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [documents, setDocuments] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", description: "", category: "other", partnerId: "" });
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Envelope refresh state
  const [refreshingEnvelopes, setRefreshingEnvelopes] = useState<Set<number>>(new Set());
  const [refreshingAll, setRefreshingAll] = useState(false);

  const refreshEnvelope = async (envelopeId: number) => {
    setRefreshingEnvelopes(prev => new Set(prev).add(envelopeId));
    try {
      const res = await fetch(`/api/admin/esign/envelopes/${envelopeId}/refresh`, { method: "POST", headers });
      if (res.ok) {
        const data = await res.json();
        setDocuments(prev => prev.map(doc =>
          doc.envelope?.id === envelopeId
            ? { ...doc, envelope: { ...doc.envelope, status: data.status } }
            : doc
        ));
      } else {
        toast({ title: "Failed to refresh envelope status", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to refresh envelope status", variant: "destructive" });
    } finally {
      setRefreshingEnvelopes(prev => { const next = new Set(prev); next.delete(envelopeId); return next; });
    }
  };

  const refreshAll = async () => {
    const envelopeDocs = filtered.filter((d: any) => d.envelope);
    if (envelopeDocs.length === 0) return;
    setRefreshingAll(true);
    let succeeded = 0;
    let failed = 0;
    for (const doc of envelopeDocs) {
      try {
        const res = await fetch(`/api/admin/esign/envelopes/${doc.envelope.id}/refresh`, { method: "POST", headers });
        if (res.ok) {
          const data = await res.json();
          setDocuments(prev => prev.map((d: any) =>
            d.envelope?.id === doc.envelope.id
              ? { ...d, envelope: { ...d.envelope, status: data.status } }
              : d
          ));
          succeeded++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
    setRefreshingAll(false);
    if (failed === 0) {
      toast({ title: `Refreshed ${succeeded} envelope${succeeded !== 1 ? "s" : ""}` });
    } else {
      toast({ title: `Refreshed ${succeeded}, failed ${failed}`, variant: "destructive" });
    }
  };

  // E-sign state
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignDoc, setEsignDoc] = useState<any | null>(null);
  const [esignSending, setEsignSending] = useState(false);
  const [esignSubject, setEsignSubject] = useState("");
  const [esignMessage, setEsignMessage] = useState("");
  const [esignSigners, setEsignSigners] = useState<Signer[]>([
    { name: "", email: "", role: "Customer", signingOrder: 1 },
    { name: "Siebert Services", email: "", role: "Countersigner", signingOrder: 2 },
  ]);

  // Upload & Send state
  const [esignUploadMode, setEsignUploadMode] = useState(false);
  const [esignFile, setEsignFile] = useState<File | null>(null);
  const esignFileRef = useRef<HTMLInputElement>(null);
  const [esignForm, setEsignForm] = useState({ name: "", description: "", category: "contract", partnerId: "" });

  const headers = getAuthHeaders();

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/documents", { headers }).then(r => r.ok ? r.json() : []),
      fetch("/api/admin/partners", { headers }).then(r => r.ok ? r.json() : []),
    ])
      .then(([docs, pts]) => {
        setDocuments(Array.isArray(docs) ? docs : []);
        setPartners(Array.isArray(pts) ? pts : []);
      })
      .catch(() => toast({ title: "Failed to load data", variant: "destructive" }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => documents.filter((d: any) => {
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || (d.description || "").toLowerCase().includes(search.toLowerCase()) || (d.partnerCompany || "").toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === "all" || d.category === categoryFilter;
    return matchSearch && matchCat && d.active !== false;
  }), [documents, search, categoryFilter]);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const handleUpload = async () => {
    if (!file || !form.name) return;
    setUploading(true);
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (file.size > 10 * 1024 * 1024) { toast({ title: "File must be under 10MB", variant: "destructive" }); return; }
      const res = await fetch("/api/admin/documents", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: form.name, description: form.description || null, filename: file.name, mimeType: file.type || "application/octet-stream", size: file.size, content, category: form.category, partnerId: form.partnerId || null }),
      });
      if (res.ok) {
        toast({ title: "Document uploaded" });
        setUploadOpen(false);
        setFile(null);
        setForm({ name: "", description: "", category: "other", partnerId: "" });
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.message || "Upload failed", variant: "destructive" });
      }
    } catch { toast({ title: "Upload failed", variant: "destructive" }); } finally { setUploading(false); }
  };

  const handleDownload = async (doc: any) => {
    setDownloading(doc.id);
    try {
      const res = await fetch(`/api/admin/documents/${doc.id}/download`, { headers });
      if (!res.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
      const { content, filename, mimeType } = await res.json();
      const byteChars = atob(content);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArr], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch { toast({ title: "Download failed", variant: "destructive" }); } finally { setDownloading(null); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this document?")) return;
    try {
      const res = await fetch(`/api/admin/documents/${id}`, { method: "DELETE", headers });
      if (res.ok) { toast({ title: "Document deleted" }); load(); }
      else toast({ title: "Failed to delete", variant: "destructive" });
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  };

  const openEsignModal = (doc: any) => {
    setEsignUploadMode(false);
    setEsignDoc(doc);
    setEsignSubject(`Please sign: ${doc.name}`);
    setEsignMessage("");
    setEsignSigners([
      { name: "", email: "", role: "Customer", signingOrder: 1 },
      { name: "Siebert Services", email: user?.email || "", role: "Countersigner", signingOrder: 2 },
    ]);
    setEsignOpen(true);
  };

  const openUploadAndSendModal = () => {
    setEsignUploadMode(true);
    setEsignDoc(null);
    setEsignFile(null);
    setEsignForm({ name: "", description: "", category: "contract", partnerId: "" });
    setEsignSubject("");
    setEsignMessage("");
    setEsignSigners([
      { name: "", email: "", role: "Customer", signingOrder: 1 },
      { name: "Siebert Services", email: user?.email || "", role: "Countersigner", signingOrder: 2 },
    ]);
    setEsignOpen(true);
  };

  const updateSigner = (index: number, field: keyof Signer, value: string | number) => {
    setEsignSigners(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const addSigner = () => {
    setEsignSigners(prev => [...prev, { name: "", email: "", role: "", signingOrder: prev.length + 1 }]);
  };

  const removeSigner = (index: number) => {
    setEsignSigners(prev => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, signingOrder: i + 1 })));
  };

  const handleSendForSignature = async () => {
    const validSigners = esignSigners.filter(s => s.name && s.email);
    if (validSigners.length === 0) {
      toast({ title: "Add at least one signer with name and email", variant: "destructive" });
      return;
    }

    setEsignSending(true);
    try {
      let documentId: number;

      if (esignUploadMode) {
        // Step 1: upload the document
        if (!esignFile || !esignForm.name) {
          toast({ title: "Document name and file are required", variant: "destructive" });
          setEsignSending(false);
          return;
        }
        if (esignFile.size > 10 * 1024 * 1024) {
          toast({ title: "File must be under 10MB", variant: "destructive" });
          setEsignSending(false);
          return;
        }
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(esignFile);
        });
        const uploadRes = await fetch("/api/admin/documents", {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: esignForm.name,
            description: esignForm.description || null,
            filename: esignFile.name,
            mimeType: esignFile.type || "application/octet-stream",
            size: esignFile.size,
            content,
            category: esignForm.category,
            partnerId: esignForm.partnerId || null,
          }),
        });
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}));
          toast({ title: err.message || "Upload failed", variant: "destructive" });
          setEsignSending(false);
          return;
        }
        const uploaded = await uploadRes.json();
        documentId = uploaded.id;
      } else {
        if (!esignDoc) return;
        documentId = esignDoc.id;
      }

      // Step 2: send for signature
      const docName = esignUploadMode ? esignForm.name : esignDoc!.name;
      const res = await fetch("/api/admin/esign/envelopes", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          signers: validSigners,
          subject: esignSubject || `Please sign: ${docName}`,
          message: esignMessage,
          initiatedByEmail: user?.email,
          initiatedByName: user?.contactName,
        }),
      });

      if (res.ok) {
        toast({ title: "Sent for signature!", description: "Signers will receive an email with a secure signing link." });
        setEsignOpen(false);
        if (esignUploadMode) load();
        navigate("/admin/esign");
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.message || "Failed to send", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to send", variant: "destructive" });
    } finally {
      setEsignSending(false);
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

  const esignUploadReady = !esignUploadMode || (!!esignFile && !!esignForm.name);
  const esignSendDisabled = esignSending || esignSigners.every(s => !s.name || !s.email) || !esignUploadReady;

  return (
    <PortalLayout>
      <div className="px-6 py-4">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="mb-2">
            <h1 className="text-2xl font-bold">Documents</h1>
            <p className="text-sm text-muted-foreground mt-1">Upload, manage, and share documents with partners</p>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Documents</CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={openUploadAndSendModal}>
                    <FileSignature className="w-4 h-4 mr-1" /> Upload &amp; Send
                  </Button>
                  <Button size="sm" onClick={() => setUploadOpen(true)}>
                    <Upload className="w-4 h-4 mr-1" /> Upload Document
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search documents..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select className="h-9 px-3 rounded-md border text-sm bg-background" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                  <option value="all">All Categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-5 py-3 text-left">
                          <span className="flex items-center gap-2">
                            Name
                            {filtered.some((d: any) => d.envelope) && (
                              <button
                                onClick={refreshAll}
                                disabled={refreshingAll}
                                title="Refresh all envelope statuses"
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-normal text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                              >
                                <RefreshCw className={`w-3 h-3 ${refreshingAll ? "animate-spin" : ""}`} />
                                Refresh All
                              </button>
                            )}
                          </span>
                        </th>
                        <th className="px-5 py-3 text-left">Category</th>
                        <th className="px-5 py-3 text-left">Partner</th>
                        <th className="px-5 py-3 text-left">Uploaded By</th>
                        <th className="px-5 py-3 text-left">Size</th>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((doc: any) => (
                        <tr key={doc.id} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="px-5 py-3">
                            <div className="font-medium">{doc.name}</div>
                            {doc.description && <div className="text-xs text-muted-foreground truncate max-w-[220px]">{doc.description}</div>}
                            {doc.envelope && (
                              <div className="mt-1">
                                <EnvelopeStatusBadge
                                  envelope={doc.envelope}
                                  onNavigate={() => navigate(`/admin/esign?envelope=${doc.envelope.id}`)}
                                  onRefresh={() => refreshEnvelope(doc.envelope.id)}
                                  refreshing={refreshingEnvelopes.has(doc.envelope.id)}
                                />
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3 capitalize">{doc.category}</td>
                          <td className="px-5 py-3">{doc.partnerCompany || <span className="text-muted-foreground">All Partners</span>}</td>
                          <td className="px-5 py-3 capitalize">{doc.uploadedBy}</td>
                          <td className="px-5 py-3 text-muted-foreground">{formatBytes(doc.size)}</td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString()}</td>
                          <td className="px-5 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost" size="sm"
                                className="h-7 text-xs gap-1 text-[#0176d3] hover:text-[#032d60]"
                                title="Send for signature"
                                onClick={() => openEsignModal(doc)}
                              >
                                <FileSignature className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Sign</span>
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Download" onClick={() => handleDownload(doc)} disabled={downloading === doc.id}>
                                {downloading === doc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" title="Delete" onClick={() => handleDelete(doc.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtered.length === 0 && <div className="p-8 text-center text-muted-foreground">No documents found.</div>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upload Dialog */}
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Document Name *</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Partner Agreement 2026" /></div>
                <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Brief description..." rows={2} /></div>
                <div><Label>Category</Label>
                  <select className="w-full h-9 px-3 rounded-md border text-sm bg-background mt-1" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
                <div><Label>Partner (optional — leave blank for all partners)</Label>
                  <select className="w-full h-9 px-3 rounded-md border text-sm bg-background mt-1" value={form.partnerId} onChange={e => setForm(p => ({ ...p, partnerId: e.target.value }))}>
                    <option value="">All Partners (Global)</option>
                    {partners.map((p: any) => <option key={p.id} value={p.id}>{p.companyName}</option>)}
                  </select>
                </div>
                <div><Label>File * (max 10MB)</Label>
                  <input type="file" ref={fileRef} className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
                  <Button variant="outline" className="w-full mt-1" onClick={() => fileRef.current?.click()}>
                    {file ? file.name : "Choose File..."}
                  </Button>
                  {file && <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024).toFixed(1)} KB</p>}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setUploadOpen(false); setFile(null); }}>Cancel</Button>
                <Button onClick={handleUpload} disabled={!form.name || !file || uploading}>
                  {uploading ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Uploading...</> : <><Upload className="w-4 h-4 mr-1" /> Upload</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Send for Signature / Upload & Send Dialog */}
          <Dialog open={esignOpen} onOpenChange={open => {
            if (!open) { setEsignOpen(false); setEsignFile(null); }
          }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileSignature className="w-4 h-4 text-[#0176d3]" />
                  {esignUploadMode ? "Upload & Send for Signature" : "Send for Signature"}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {/* Upload section (upload & send mode only) */}
                {esignUploadMode && (
                  <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Document Details</p>
                    <div>
                      <Label>Document Name *</Label>
                      <Input
                        value={esignForm.name}
                        onChange={e => {
                          const name = e.target.value;
                          setEsignForm(p => ({ ...p, name }));
                          if (!esignSubject) setEsignSubject(`Please sign: ${name}`);
                          else if (esignSubject === `Please sign: ${esignForm.name}`) setEsignSubject(`Please sign: ${name}`);
                        }}
                        placeholder="e.g. Partner Agreement 2026"
                        className="mt-1"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Category</Label>
                        <select className="w-full h-9 px-3 rounded-md border text-sm bg-background mt-1" value={esignForm.category} onChange={e => setEsignForm(p => ({ ...p, category: e.target.value }))}>
                          {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label>Partner (optional)</Label>
                        <select className="w-full h-9 px-3 rounded-md border text-sm bg-background mt-1" value={esignForm.partnerId} onChange={e => setEsignForm(p => ({ ...p, partnerId: e.target.value }))}>
                          <option value="">All Partners</option>
                          {partners.map((p: any) => <option key={p.id} value={p.id}>{p.companyName}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <Label>File * (max 10MB)</Label>
                      <input
                        type="file"
                        ref={esignFileRef}
                        className="hidden"
                        onChange={e => setEsignFile(e.target.files?.[0] || null)}
                      />
                      <Button variant="outline" className="w-full mt-1" onClick={() => esignFileRef.current?.click()}>
                        {esignFile ? esignFile.name : "Choose File..."}
                      </Button>
                      {esignFile && <p className="text-xs text-muted-foreground mt-1">{(esignFile.size / 1024).toFixed(1)} KB</p>}
                    </div>
                  </div>
                )}

                {/* Existing document label (normal mode) */}
                {!esignUploadMode && esignDoc && (
                  <div className="bg-muted/50 rounded-md px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Document:</span>{" "}
                    <span className="font-medium">{esignDoc.name}</span>
                  </div>
                )}

                <div>
                  <Label>Email Subject</Label>
                  <Input
                    value={esignSubject}
                    onChange={e => setEsignSubject(e.target.value)}
                    placeholder="Please sign this document"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label>Message to signers (optional)</Label>
                  <Textarea
                    value={esignMessage}
                    onChange={e => setEsignMessage(e.target.value)}
                    placeholder="Please review and sign at your earliest convenience..."
                    rows={2}
                    className="mt-1"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Signers <span className="text-muted-foreground font-normal text-xs">(signing order = sequence)</span></Label>
                    <Button type="button" variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={addSigner}>
                      <Plus className="w-3 h-3" /> Add Signer
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {esignSigners.map((signer, i) => (
                      <div key={i} className="border rounded-md p-3 space-y-2 relative">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Signer {i + 1} {signer.role && `— ${signer.role}`}
                          </span>
                          {esignSigners.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeSigner(i)}
                              className="text-muted-foreground hover:text-red-500 transition-colors"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Full Name *</Label>
                            <Input
                              value={signer.name}
                              onChange={e => updateSigner(i, "name", e.target.value)}
                              placeholder="John Smith"
                              className="h-8 mt-0.5 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Email *</Label>
                            <Input
                              type="email"
                              value={signer.email}
                              onChange={e => updateSigner(i, "email", e.target.value)}
                              placeholder="john@example.com"
                              className="h-8 mt-0.5 text-sm"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Role / Title (optional)</Label>
                            <Input
                              value={signer.role}
                              onChange={e => updateSigner(i, "role", e.target.value)}
                              placeholder="Customer, CEO, etc."
                              className="h-8 mt-0.5 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Signing Order</Label>
                            <Input
                              type="number"
                              min={1}
                              value={signer.signingOrder}
                              onChange={e => updateSigner(i, "signingOrder", parseInt(e.target.value) || i + 1)}
                              className="h-8 mt-0.5 text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { setEsignOpen(false); setEsignFile(null); }}>Cancel</Button>
                <Button
                  onClick={handleSendForSignature}
                  disabled={esignSendDisabled}
                  className="gap-2"
                >
                  {esignSending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> {esignUploadMode ? "Uploading & Sending..." : "Sending..."}</>
                    : <><FileSignature className="w-4 h-4" /> {esignUploadMode ? "Upload & Send" : "Send for Signature"}</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </PortalLayout>
  );
}
