import { useState, useEffect, useRef } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { FileText, Upload, Download, Trash2, Search, Plus, File, FileImage, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface Doc {
  id: number;
  name: string;
  description: string | null;
  filename: string;
  mimeType: string;
  size: number;
  category: string;
  partnerId: number | null;
  uploadedBy: string;
  tags: string[];
  createdAt: string;
}

const CATEGORIES = ["all", "contract", "proposal", "invoice", "report", "agreement", "other"];

function fileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return FileImage;
  return FileText;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function categoryColor(cat: string) {
  const colors: Record<string, string> = {
    contract: "bg-blue-100 text-blue-700",
    proposal: "bg-purple-100 text-purple-700",
    invoice: "bg-green-100 text-green-700",
    report: "bg-orange-100 text-orange-700",
    agreement: "bg-indigo-100 text-indigo-700",
    other: "bg-gray-100 text-gray-700",
  };
  return colors[cat] || "bg-gray-100 text-gray-700";
}

export default function Documents() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", category: "other" });
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isTeamMemberWithoutAccess = user?.isTeamMember && !user?.teamMember?.permissions?.canViewResources;

  const load = () => {
    setLoading(true);
    fetch("/api/partner/documents", { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(data => setDocs(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (!isTeamMemberWithoutAccess) load(); }, [isTeamMemberWithoutAccess]);

  if (isTeamMemberWithoutAccess) {
    return (
      <PortalLayout>
        <div className="px-6 py-12 text-center">
          <p className="text-muted-foreground">Access denied. You don't have permission to view documents.</p>
        </div>
      </PortalLayout>
    );
  }

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const filtered = docs.filter(d => {
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || (d.description || "").toLowerCase().includes(search.toLowerCase());
    const matchCat = category === "all" || d.category === category;
    return matchSearch && matchCat;
  });

  const adminDocs = filtered.filter(d => d.uploadedBy === "admin" || d.partnerId === null);
  const myDocs = filtered.filter(d => d.uploadedBy === "partner" && d.partnerId !== null);

  const handleUpload = async () => {
    if (!file || !form.name) return;
    setUploading(true);
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      if (file.size > 10 * 1024 * 1024) {
        showToast("File must be under 10MB");
        return;
      }

      const res = await fetch("/api/partner/documents", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          content,
          category: form.category,
        }),
      });
      if (res.ok) {
        showToast("Document uploaded successfully");
        setUploadOpen(false);
        setForm({ name: "", description: "", category: "other" });
        setFile(null);
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.message || "Upload failed");
      }
    } catch {
      showToast("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: Doc) => {
    setDownloading(doc.id);
    try {
      const res = await fetch(`/api/partner/documents/${doc.id}/download`, { headers: getAuthHeaders() });
      if (!res.ok) { showToast("Download failed"); return; }
      const { content, filename, mimeType } = await res.json();
      const byteChars = atob(content);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArr], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast("Download failed");
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this document?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/partner/documents/${id}`, { method: "DELETE", headers: getAuthHeaders() });
      if (res.ok) { showToast("Document deleted"); load(); }
      else showToast("Failed to delete document");
    } catch { showToast("Delete failed"); } finally { setDeleting(null); }
  };

  return (
    <PortalLayout>
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#032d60] text-white px-4 py-2.5 rounded shadow-lg text-sm font-medium animate-in">
          {toast}
        </div>
      )}

      <div className="sf-page-header px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-foreground">Documents</h1>
            <span className="text-xs text-muted-foreground">{docs.length} total</span>
          </div>
          <button className="sf-btn sf-btn-primary flex items-center gap-1.5 text-sm" onClick={() => setUploadOpen(true)}>
            <Upload className="w-3.5 h-3.5" /> Upload Document
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-4 space-y-6">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input type="text" placeholder="Search documents..." value={search} onChange={e => setSearch(e.target.value)} className="sf-input pl-8" />
          </div>
          <select className="sf-input w-auto" value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c === "all" ? "All Categories" : c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="sf-card p-12 text-center text-muted-foreground">Loading documents...</div>
        ) : (
          <>
            {adminDocs.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Shared by Siebert Services</h2>
                <DocGrid docs={adminDocs} onDownload={handleDownload} onDelete={undefined} downloading={downloading} deleting={deleting} />
              </section>
            )}

            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">My Documents</h2>
              {myDocs.length === 0 ? (
                <div className="sf-card p-8 text-center text-muted-foreground">
                  <File className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No documents uploaded yet.</p>
                  <button className="sf-btn sf-btn-primary mt-3 text-sm" onClick={() => setUploadOpen(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1" />Upload your first document
                  </button>
                </div>
              ) : (
                <DocGrid docs={myDocs} onDownload={handleDownload} onDelete={handleDelete} downloading={downloading} deleting={deleting} />
              )}
            </section>
          </>
        )}
      </div>

      {uploadOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b">
              <h2 className="text-base font-semibold">Upload Document</h2>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Document Name *</label>
                <input className="sf-input" placeholder="e.g. Partnership Agreement 2026" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                <textarea className="sf-input resize-none" rows={2} placeholder="Brief description..." value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
                <select className="sf-input" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                  {CATEGORIES.filter(c => c !== "all").map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">File * (max 10MB)</label>
                <input type="file" ref={fileRef} className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
                <button className="sf-btn sf-btn-secondary w-full text-sm" onClick={() => fileRef.current?.click()}>
                  {file ? file.name : "Choose File..."}
                </button>
                {file && <p className="text-xs text-muted-foreground mt-1">{formatBytes(file.size)}</p>}
              </div>
            </div>
            <div className="px-6 py-3 border-t flex justify-end gap-2">
              <button className="sf-btn sf-btn-secondary text-sm" onClick={() => { setUploadOpen(false); setFile(null); setForm({ name: "", description: "", category: "other" }); }}>Cancel</button>
              <button className="sf-btn sf-btn-primary text-sm flex items-center gap-1.5" onClick={handleUpload} disabled={!form.name || !file || uploading}>
                {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading...</> : <><Upload className="w-3.5 h-3.5" /> Upload</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}

function DocGrid({ docs, onDownload, onDelete, downloading, deleting }: {
  docs: Doc[];
  onDownload: (doc: Doc) => void;
  onDelete?: (id: number) => void;
  downloading: number | null;
  deleting: number | null;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {docs.map(doc => {
        const Icon = fileIcon(doc.mimeType);
        return (
          <div key={doc.id} className="sf-card p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded flex items-center justify-center bg-[#032d60]/10 flex-shrink-0">
                <Icon className="w-4.5 h-4.5 text-[#032d60]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground leading-tight truncate">{doc.name}</p>
                {doc.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{doc.description}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium capitalize ${categoryColor(doc.category)}`}>{doc.category}</span>
              <span className="text-xs text-muted-foreground">{formatBytes(doc.size)}</span>
              <span className="text-xs text-muted-foreground ml-auto">{format(new Date(doc.createdAt), "MMM d, yyyy")}</span>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t">
              <button
                className="sf-btn sf-btn-secondary flex-1 text-xs flex items-center justify-center gap-1.5"
                onClick={() => onDownload(doc)}
                disabled={downloading === doc.id}
              >
                {downloading === doc.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                Download
              </button>
              {onDelete && doc.uploadedBy === "partner" && (
                <button
                  className="p-1.5 rounded text-red-500 hover:bg-red-50 transition-colors"
                  onClick={() => onDelete(doc.id)}
                  disabled={deleting === doc.id}
                  title="Delete"
                >
                  {deleting === doc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
