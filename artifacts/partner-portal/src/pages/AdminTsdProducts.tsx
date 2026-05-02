import { useState, useEffect } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import {
  Package,
  Plus,
  X,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Loader,
  Save,
} from "lucide-react";

const TSD_OPTIONS = [
  { id: "telarus", label: "Telarus" },
  { id: "intelisys", label: "Intelisys" },
];

const CATEGORIES = [
  "VoIP",
  "ISP",
  "Cybersecurity",
  "VPN",
  "Password Management",
  "Backup",
  "Home Security",
  "Cloud Productivity",
  "Web Hosting",
  "Identity Protection",
  "Consumer Antivirus",
  "Business Connectivity",
  "UCaaS",
  "SD-WAN",
  "MPLS",
  "Managed Services",
  "Other",
];

interface TsdProduct {
  id: number;
  category: string;
  name: string;
  description: string | null;
  availableAt: string[];
  active: boolean;
  sortOrder: number;
}

interface ProductForm {
  category: string;
  name: string;
  description: string;
  availableAt: string[];
  active: boolean;
  sortOrder: number;
}

const BLANK_FORM: ProductForm = {
  category: "",
  name: "",
  description: "",
  availableAt: [],
  active: true,
  sortOrder: 0,
};

export default function AdminTsdProducts() {
  const { user } = useAuth();
  const [products, setProducts] = useState<TsdProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<TsdProduct | null>(null);
  const [form, setForm] = useState<ProductForm>(BLANK_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const headers = getAuthHeaders();

  const api = (path: string, opts?: RequestInit) =>
    fetch(`/api/admin/tsd-products${path}`, { headers, ...opts });

  async function load() {
    setLoading(true);
    try {
      const res = await api("");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      setError("Failed to load TSD products");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function flash(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  }

  function openAdd() {
    setEditProduct(null);
    setForm(BLANK_FORM);
    setShowModal(true);
  }

  function openEdit(p: TsdProduct) {
    setEditProduct(p);
    setForm({
      category: p.category,
      name: p.name,
      description: p.description ?? "",
      availableAt: p.availableAt,
      active: p.active,
      sortOrder: p.sortOrder,
    });
    setShowModal(true);
  }

  function toggleAvailableAt(tsdId: string) {
    setForm(f => ({
      ...f,
      availableAt: f.availableAt.includes(tsdId)
        ? f.availableAt.filter(x => x !== tsdId)
        : [...f.availableAt, tsdId],
    }));
  }

  async function save() {
    if (!form.category || !form.name) {
      setError("Category and name are required");
      return;
    }
    setSubmitting(true);
    try {
      const body = JSON.stringify({
        category: form.category.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        availableAt: form.availableAt,
        active: form.active,
        sortOrder: form.sortOrder,
      });
      const res = editProduct
        ? await api(`/${editProduct.id}`, { method: "PUT", body })
        : await api("", { method: "POST", body });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Request failed");
      }
      setShowModal(false);
      flash(editProduct ? "Product updated" : "Product created");
      load();
    } catch (err: any) {
      setError(err.message || "Failed to save product");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(p: TsdProduct) {
    try {
      await api(`/${p.id}`, {
        method: "PUT",
        body: JSON.stringify({ active: !p.active }),
      });
      flash(`${p.name} ${!p.active ? "activated" : "deactivated"}`);
      load();
    } catch {
      setError("Failed to update product");
    }
  }

  async function deleteProduct(id: number) {
    try {
      const res = await api(`/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setDeleteConfirm(null);
      flash("Product deleted");
      load();
    } catch {
      setError("Failed to delete product");
    }
  }

  const filtered = products.filter(p =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase()) ||
    (p.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  if (!user || !user.isAdmin) {
    return (
      <PortalLayout>
        <div className="px-6 py-12 text-center text-muted-foreground">
          Access denied. Admin privileges required.
        </div>
      </PortalLayout>
    );
  }

  if (loading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="px-6 py-4 max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="w-6 h-6 text-blue-600" /> TSD Products
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage the product catalog shown to partners in the Proposal Generator.
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Add Product
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="flex items-center justify-between bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            <span>{error}</span>
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {success}
          </div>
        )}

        {/* Search */}
        <div className="flex gap-3 items-center">
          <input
            type="text"
            placeholder="Search by name, category, description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-500 whitespace-nowrap">
            {filtered.length} / {products.length} products
          </span>
        </div>

        {/* Products Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Product</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Category</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Available At</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-700">Sort</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-700">Status</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className={`border-b border-gray-100 hover:bg-gray-50 ${!p.active ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{p.name}</div>
                      {p.description && (
                        <div className="text-xs text-gray-500 line-clamp-1 max-w-xs">{p.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-blue-50 text-blue-700 text-xs font-medium px-2 py-1 rounded-full">
                        {p.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.availableAt.length === 0 ? (
                          <span className="text-gray-400 text-xs">None</span>
                        ) : p.availableAt.map(tsd => (
                          <span key={tsd} className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded">
                            {TSD_OPTIONS.find(o => o.id === tsd)?.label ?? tsd}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="text-center px-4 py-3 text-gray-500">{p.sortOrder}</td>
                    <td className="text-center px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${p.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {p.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="text-center px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="text-gray-400 hover:text-blue-600 transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggleActive(p)}
                          className={`transition-colors ${p.active ? "text-gray-400 hover:text-red-500" : "text-gray-400 hover:text-green-600"}`}
                          title={p.active ? "Deactivate" : "Activate"}
                        >
                          {p.active ? <XCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                        </button>
                        {deleteConfirm === p.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => deleteProduct(p.id)}
                              className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 transition"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="text-xs text-gray-500 hover:text-gray-700"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(p.id)}
                            className="text-gray-400 hover:text-red-600 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-gray-400">
                      {products.length === 0
                        ? "No products yet. Add your first TSD product above."
                        : "No products match your search."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Info box */}
        <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-blue-800">
          <strong>How it works:</strong> Active products appear in the "TSD Products" tab of the Proposal Generator's product picker. Partners can browse and add them to proposals. The "Available At" field indicates which Technology Solution Distributors carry this product.
        </div>
      </div>

      {/* ── Add / Edit Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-bold text-lg">
                {editProduct ? "Edit Product" : "Add TSD Product"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a category...</option>
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Product Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. RingCentral MVP"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of this product..."
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {/* Available At */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Available At (TSDs)</label>
                <div className="flex gap-3">
                  {TSD_OPTIONS.map(tsd => (
                    <label key={tsd.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.availableAt.includes(tsd.id)}
                        onChange={() => toggleAvailableAt(tsd.id)}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm">{tsd.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Sort Order */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                  className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min={0}
                />
                <p className="text-xs text-gray-500 mt-1">Lower numbers appear first within each category.</p>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-5 peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                </label>
                <span className="text-sm font-medium text-gray-700">
                  {form.active ? "Active (visible to partners)" : "Inactive (hidden)"}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={submitting}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-60"
              >
                {submitting ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editProduct ? "Update Product" : "Create Product"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
