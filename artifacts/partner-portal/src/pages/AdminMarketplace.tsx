import { useState, useEffect } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { getAuthHeaders } from "@/hooks/use-auth";
import { format } from "date-fns";
import {
  Store,
  Package,
  ShoppingCart,
  Plus,
  X,
  Edit,
  CheckCircle,
  XCircle,
  TrendingUp,
  DollarSign,
  Loader,
} from "lucide-react";

interface Vendor {
  id: number;
  name: string;
  description: string | null;
  contactEmail: string;
  website: string | null;
  commissionPercent: string;
  status: "pending" | "approved" | "rejected" | "suspended";
  createdAt: string;
}

interface Product {
  id: number;
  vendorId: number;
  vendorName: string;
  title: string;
  description: string;
  category: string;
  price: string | null;
  commissionRate: string;
  status: "draft" | "active" | "inactive";
  createdAt: string;
}

interface Order {
  id: number;
  partnerId: number;
  partnerCompany: string;
  productTitle: string;
  vendorName: string;
  status: string;
  amount: string;
  commissionAmount: string;
  notes: string | null;
  createdAt: string;
}

interface AdminSummary {
  totalOrders: number;
  totalRevenue: string;
  totalCommissions: string;
}

const CATEGORIES = [
  "VoIP", "ISP", "Cybersecurity", "VPN", "Password Management",
  "Backup", "Home Security", "Cloud Productivity", "Web Hosting",
  "Identity Protection", "Consumer Antivirus", "Business Connectivity",
];

type Tab = "vendors" | "products" | "orders";

export default function AdminMarketplace() {
  const [tab, setTab] = useState<Tab>("vendors");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Vendor modal
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [vendorForm, setVendorForm] = useState({
    name: "", description: "", contactEmail: "", website: "",
    commissionPercent: "15", status: "pending",
  });

  // Product modal
  const [showProductModal, setShowProductModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
    vendorId: "", title: "", description: "", category: "",
    price: "", commissionRate: "15", status: "draft",
  });

  const [submitting, setSubmitting] = useState(false);

  // TSD product import modal
  const [showTsdModal, setShowTsdModal] = useState(false);
  const [tsdForm, setTsdForm] = useState({
    name: "", description: "", category: "",
    availableAt: [] as string[], active: true,
  });
  const [tsdSubmitting, setTsdSubmitting] = useState(false);

  useEffect(() => { load(); }, []);

  const api = (path: string, opts?: RequestInit) =>
    fetch(`/api/marketplace${path}`, { headers: getAuthHeaders(), ...opts });

  const adminApi = (path: string, opts?: RequestInit) =>
    fetch(`/api${path}`, { headers: getAuthHeaders(), ...opts });

  async function load() {
    setLoading(true);
    try {
      const [vRes, pRes, oRes] = await Promise.all([
        api("/admin/vendors"),
        api("/admin/products"),
        api("/admin/orders"),
      ]);
      if (vRes.ok) setVendors((await vRes.json()).vendors || []);
      if (pRes.ok) setProducts((await pRes.json()).products || []);
      if (oRes.ok) {
        const data = await oRes.json();
        setOrders(data.orders || []);
        setSummary(data.summary);
      }
    } catch (e) {
      setError("Failed to load marketplace data");
    } finally {
      setLoading(false);
    }
  }

  function flash(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  }

  // ── Vendor actions ──────────────────────────────────────────────────────────

  function openAddVendor() {
    setEditVendor(null);
    setVendorForm({ name: "", description: "", contactEmail: "", website: "", commissionPercent: "15", status: "pending" });
    setShowVendorModal(true);
  }

  function openEditVendor(v: Vendor) {
    setEditVendor(v);
    setVendorForm({
      name: v.name, description: v.description || "", contactEmail: v.contactEmail,
      website: v.website || "", commissionPercent: v.commissionPercent, status: v.status,
    });
    setShowVendorModal(true);
  }

  async function saveVendor() {
    if (!vendorForm.name || !vendorForm.contactEmail) {
      setError("Name and contact email are required");
      return;
    }
    setSubmitting(true);
    try {
      const body = JSON.stringify({
        name: vendorForm.name,
        description: vendorForm.description,
        contactEmail: vendorForm.contactEmail,
        website: vendorForm.website,
        commissionPercent: vendorForm.commissionPercent,
        status: vendorForm.status,
      });
      const res = editVendor
        ? await api(`/admin/vendors/${editVendor.id}`, { method: "PATCH", body })
        : await api("/admin/vendors", { method: "POST", body });
      if (!res.ok) throw new Error("Request failed");
      setShowVendorModal(false);
      flash(editVendor ? "Vendor updated" : "Vendor created");
      load();
    } catch {
      setError("Failed to save vendor");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateVendorStatus(vendor: Vendor, status: Vendor["status"]) {
    await api(`/admin/vendors/${vendor.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    flash(`${vendor.name} ${status}`);
    load();
  }

  // ── Product actions ─────────────────────────────────────────────────────────

  function openAddProduct() {
    setEditProduct(null);
    setProductForm({ vendorId: "", title: "", description: "", category: "", price: "", commissionRate: "15", status: "draft" });
    setShowProductModal(true);
  }

  function openEditProduct(p: Product) {
    setEditProduct(p);
    setProductForm({
      vendorId: p.vendorId.toString(), title: p.title, description: p.description,
      category: p.category, price: p.price || "", commissionRate: p.commissionRate, status: p.status,
    });
    setShowProductModal(true);
  }

  async function saveProduct() {
    if (!productForm.vendorId || !productForm.title || !productForm.description || !productForm.category) {
      setError("Vendor, title, description, and category are required");
      return;
    }
    setSubmitting(true);
    try {
      const body = JSON.stringify({
        vendorId: Number(productForm.vendorId),
        title: productForm.title,
        description: productForm.description,
        category: productForm.category,
        price: productForm.price || null,
        commissionRate: productForm.commissionRate,
        status: productForm.status,
      });
      const res = editProduct
        ? await api(`/admin/products/${editProduct.id}`, { method: "PATCH", body })
        : await api("/admin/products", { method: "POST", body });
      if (!res.ok) throw new Error("Request failed");
      setShowProductModal(false);
      flash(editProduct ? "Product updated" : "Product created");
      load();
    } catch {
      setError("Failed to save product");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveTsdProduct() {
    if (!tsdForm.name || !tsdForm.category) {
      setError("Name and category are required");
      return;
    }
    setTsdSubmitting(true);
    try {
      const res = await adminApi("/admin/tsd-products", {
        method: "POST",
        body: JSON.stringify({
          name: tsdForm.name,
          description: tsdForm.description,
          category: tsdForm.category,
          availableAt: tsdForm.availableAt,
          active: tsdForm.active,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Request failed");
      }
      setShowTsdModal(false);
      flash("Product added to TSD catalog");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save TSD product");
    } finally {
      setTsdSubmitting(false);
    }
  }

  async function updateProductStatus(product: Product, status: Product["status"]) {
    await api(`/admin/products/${product.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    flash(`${product.title} set to ${status}`);
    load();
  }

  async function updateOrderStatus(orderId: number, status: string) {
    await api(`/admin/orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    flash("Order status updated");
    load();
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      approved: "bg-green-100 text-green-700",
      active: "bg-green-100 text-green-700",
      completed: "bg-green-100 text-green-700",
      pending: "bg-yellow-100 text-yellow-700",
      draft: "bg-gray-100 text-gray-600",
      rejected: "bg-red-100 text-red-700",
      suspended: "bg-red-100 text-red-700",
      inactive: "bg-red-100 text-red-700",
      cancelled: "bg-red-100 text-red-700",
    };
    return (
      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${colors[status] ?? "bg-gray-100 text-gray-600"}`}>
        {status}
      </span>
    );
  };

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
      <div className="space-y-6">
        {/* Alerts */}
        {error && (
          <div className="flex items-center justify-between bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            <span>{error}</span>
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">{success}</div>
        )}

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-4">
              <ShoppingCart className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-sm text-gray-500">Total Orders</p>
                <p className="text-2xl font-bold text-gray-900">{summary.totalOrders}</p>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-4">
              <TrendingUp className="w-8 h-8 text-green-500" />
              <div>
                <p className="text-sm text-gray-500">Total Revenue</p>
                <p className="text-2xl font-bold text-gray-900">${summary.totalRevenue}</p>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-4">
              <DollarSign className="w-8 h-8 text-purple-500" />
              <div>
                <p className="text-sm text-gray-500">Commissions Owed</p>
                <p className="text-2xl font-bold text-gray-900">${summary.totalCommissions}</p>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-6">
            {[
              { id: "vendors" as Tab, label: "Vendors", icon: Store, count: vendors.length },
              { id: "products" as Tab, label: "Products", icon: Package, count: products.length },
              { id: "orders" as Tab, label: "Orders", icon: ShoppingCart, count: orders.length },
            ].map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition ${
                  tab === id
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
                <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{count}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* ── Vendors Tab ─────────────────────────────────────────────────── */}
        {tab === "vendors" && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Marketplace Vendors</h2>
              <button
                onClick={openAddVendor}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
              >
                <Plus className="w-4 h-4" /> Add Vendor
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Vendor</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Contact</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Commission</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Status</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map(v => (
                    <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{v.name}</div>
                        {v.website && <div className="text-xs text-blue-600 truncate max-w-xs">{v.website}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{v.contactEmail}</td>
                      <td className="text-center px-4 py-3 font-semibold">{parseFloat(v.commissionPercent).toFixed(1)}%</td>
                      <td className="text-center px-4 py-3">{statusBadge(v.status)}</td>
                      <td className="text-center px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEditVendor(v)}
                            className="text-gray-500 hover:text-blue-600"
                            title="Edit"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          {v.status !== "approved" && (
                            <button
                              onClick={() => updateVendorStatus(v, "approved")}
                              className="text-gray-500 hover:text-green-600"
                              title="Approve"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {v.status === "approved" && (
                            <button
                              onClick={() => updateVendorStatus(v, "suspended")}
                              className="text-gray-500 hover:text-red-600"
                              title="Suspend"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {vendors.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-gray-400">No vendors yet. Add your first vendor.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Products Tab ─────────────────────────────────────────────────── */}
        {tab === "products" && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Marketplace Products</h2>
              <button
                onClick={openAddProduct}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
              >
                <Plus className="w-4 h-4" /> Add Product
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Product</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Vendor</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Category</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700">Price</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Commission</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Status</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{p.title}</div>
                        <div className="text-xs text-gray-500 line-clamp-1">{p.description}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{p.vendorName}</td>
                      <td className="px-4 py-3 text-gray-600">{p.category}</td>
                      <td className="text-right px-4 py-3">
                        {p.price ? `$${parseFloat(p.price).toFixed(2)}/mo` : <span className="text-gray-400">Varies</span>}
                      </td>
                      <td className="text-center px-4 py-3 font-semibold">{parseFloat(p.commissionRate).toFixed(1)}%</td>
                      <td className="text-center px-4 py-3">{statusBadge(p.status)}</td>
                      <td className="text-center px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEditProduct(p)}
                            className="text-gray-500 hover:text-blue-600"
                            title="Edit"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          {p.status !== "active" && (
                            <button
                              onClick={() => updateProductStatus(p, "active")}
                              className="text-gray-500 hover:text-green-600"
                              title="Activate"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {p.status === "active" && (
                            <button
                              onClick={() => updateProductStatus(p, "inactive")}
                              className="text-gray-500 hover:text-red-600"
                              title="Deactivate"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-gray-400">No products yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Orders Tab ───────────────────────────────────────────────────── */}
        {tab === "orders" && (
          <div>
            <h2 className="text-lg font-semibold mb-4">All Partner Orders</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Partner</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Product</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Vendor</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700">Amount</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700">Commission</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Date</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-700">Mark</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{o.partnerCompany}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{o.productTitle}</td>
                      <td className="px-4 py-3 text-gray-600">{o.vendorName}</td>
                      <td className="text-right px-4 py-3 font-semibold">${parseFloat(o.amount).toFixed(2)}</td>
                      <td className="text-right px-4 py-3 font-semibold text-green-600">${parseFloat(o.commissionAmount).toFixed(2)}</td>
                      <td className="text-center px-4 py-3">{statusBadge(o.status)}</td>
                      <td className="px-4 py-3 text-gray-500">{format(new Date(o.createdAt), "MMM d, yyyy")}</td>
                      <td className="text-center px-4 py-3">
                        {o.status === "pending" && (
                          <button
                            onClick={() => updateOrderStatus(o.id, "completed")}
                            className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 transition"
                          >
                            Complete
                          </button>
                        )}
                        {o.status === "completed" && (
                          <button
                            onClick={() => updateOrderStatus(o.id, "cancelled")}
                            className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200 transition"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-gray-400">No orders yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* ── Vendor Modal ───────────────────────────────────────────────────── */}
      {showVendorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">{editVendor ? "Edit Vendor" : "Add Vendor"}</h2>
              <button onClick={() => setShowVendorModal(false)}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              {[
                { label: "Vendor Name *", key: "name", placeholder: "e.g. RingCentral" },
                { label: "Contact Email *", key: "contactEmail", placeholder: "partners@vendor.com" },
                { label: "Website", key: "website", placeholder: "https://vendor.com" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    value={(vendorForm as Record<string, string>)[key]}
                    onChange={e => setVendorForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={vendorForm.description}
                  onChange={e => setVendorForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Commission %</label>
                  <input
                    type="number" step="0.5" min="0" max="100"
                    value={vendorForm.commissionPercent}
                    onChange={e => setVendorForm(f => ({ ...f, commissionPercent: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={vendorForm.status}
                    onChange={e => setVendorForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => setShowVendorModal(false)} className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 transition">Cancel</button>
              <button onClick={saveVendor} disabled={submitting} className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-blue-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2">
                {submitting && <Loader className="w-4 h-4 animate-spin" />}
                {editVendor ? "Update" : "Create Vendor"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Product Modal ──────────────────────────────────────────────────── */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">{editProduct ? "Edit Product" : "Add Product"}</h2>
              <button onClick={() => setShowProductModal(false)}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor *</label>
                <select
                  value={productForm.vendorId}
                  onChange={e => setProductForm(f => ({ ...f, vendorId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select vendor...</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  value={productForm.title}
                  onChange={e => setProductForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. RingCentral MVP — Core"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                <textarea
                  value={productForm.description}
                  onChange={e => setProductForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                <select
                  value={productForm.category}
                  onChange={e => setProductForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select category...</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price/mo ($)</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={productForm.price}
                    onChange={e => setProductForm(f => ({ ...f, price: e.target.value }))}
                    placeholder="Leave blank if varies"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Commission %</label>
                  <input
                    type="number" step="0.5" min="0" max="100"
                    value={productForm.commissionRate}
                    onChange={e => setProductForm(f => ({ ...f, commissionRate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={productForm.status}
                    onChange={e => setProductForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => setShowProductModal(false)} className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 transition">Cancel</button>
              <button onClick={saveProduct} disabled={submitting} className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-blue-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2">
                {submitting && <Loader className="w-4 h-4 animate-spin" />}
                {editProduct ? "Update" : "Create Product"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── TSD Product Import Modal ──────────────────────────────────────────── */}
      {showTsdModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold">Import to TSD Catalog</h2>
                <p className="text-xs text-gray-500 mt-0.5">Review and save this AI-discovered product to the TSD product catalog</p>
              </div>
              <button onClick={() => setShowTsdModal(false)}><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product Name *</label>
                <input
                  value={tsdForm.name}
                  onChange={e => setTsdForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                <input
                  value={tsdForm.category}
                  onChange={e => setTsdForm(f => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. UCaaS, SD-WAN, Cybersecurity"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={tsdForm.description}
                  onChange={e => setTsdForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Available At</label>
                <div className="flex gap-3">
                  {(["telarus", "intelisys", "avant"] as const).map(provider => (
                    <label key={provider} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tsdForm.availableAt.includes(provider)}
                        onChange={e => setTsdForm(f => ({
                          ...f,
                          availableAt: e.target.checked
                            ? [...f.availableAt, provider]
                            : f.availableAt.filter(p => p !== provider),
                        }))}
                        className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                      />
                      <span className="text-sm text-gray-700 capitalize">{provider}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="tsd-active"
                  checked={tsdForm.active}
                  onChange={e => setTsdForm(f => ({ ...f, active: e.target.checked }))}
                  className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                <label htmlFor="tsd-active" className="text-sm text-gray-700 cursor-pointer">Active (visible to partners)</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => setShowTsdModal(false)} className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 transition">Cancel</button>
              <button onClick={saveTsdProduct} disabled={tsdSubmitting} className="flex-1 bg-purple-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-purple-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2">
                {tsdSubmitting && <Loader className="w-4 h-4 animate-spin" />}
                Save to TSD Catalog
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
