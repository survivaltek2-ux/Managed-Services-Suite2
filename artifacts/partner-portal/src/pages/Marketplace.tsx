import { useState, useEffect } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { getAuthHeaders } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/utils";
import { ShoppingCart, TrendingUp, Package, Plus, X, Loader } from "lucide-react";
import { format } from "date-fns";

interface Product {
  id: number;
  vendorId: number;
  title: string;
  description: string;
  category: string;
  price: string | null;
  commissionRate: string;
  createdAt: string;
  vendorName?: string;
}

interface MarketplaceOrder {
  id: number;
  productId: number;
  vendorId: number;
  status: string;
  amount: string;
  commissionAmount: string;
  notes: string | null;
  createdAt: string;
  productTitle: string;
  vendorName: string;
}

interface OrderSummary {
  totalOrders: number;
  totalCommissions: string;
}

const categoryIcons: Record<string, string> = {
  ISP: "🌐",
  VoIP: "☎️",
  Security: "🔒",
  Antivirus: "🛡️",
  VPN: "🔐",
  "Password Management": "🔑",
  "Cloud Storage": "☁️",
  Backup: "💾",
  "Web Hosting": "🖥️",
  "Cloud Productivity": "📊",
  "Home Security": "🏠",
  "Identity Protection": "👤",
  Cybersecurity: "🚨",
};

export default function Marketplace() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [summary, setSummary] = useState<OrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showAddOrder, setShowAddOrder] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [orderAmount, setOrderAmount] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [productsRes, ordersRes] = await Promise.all([
        fetch("/api/marketplace/products"),
        fetch("/api/marketplace/partner/orders", { headers: getAuthHeaders() }),
      ]);

      if (productsRes.ok) {
        const data = await productsRes.json();
        setProducts(data.products || []);
      }
      if (ordersRes.ok) {
        const data = await ordersRes.json();
        setOrders(data.orders || []);
        setSummary(data.summary);
      }
    } catch (err) {
      setError("Failed to load marketplace data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddOrder = async () => {
    if (!selectedProduct || !orderAmount) {
      setError("Please select a product and enter an amount");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const res = await fetch("/api/marketplace/orders", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          productId: selectedProduct.id,
          amount: parseFloat(orderAmount),
          notes: orderNotes,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create order");
      }

      setSuccess("Order recorded successfully!");
      setShowAddOrder(false);
      setOrderAmount("");
      setOrderNotes("");
      setSelectedProduct(null);
      setTimeout(() => setSuccess(null), 3000);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
    } finally {
      setSubmitting(false);
    }
  };

  const categories = ["all", ...new Set(products.map(p => p.category))];
  const filteredProducts = selectedCategory === "all" 
    ? products 
    : products.filter(p => p.category === selectedCategory);

  if (loading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center min-h-screen">
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
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {success}
          </div>
        )}

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-600 font-medium">Total Orders</p>
                  <p className="text-2xl font-bold text-blue-900">{summary.totalOrders}</p>
                </div>
                <ShoppingCart className="w-8 h-8 text-blue-400" />
              </div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-600 font-medium">Commission Earned</p>
                  <p className="text-2xl font-bold text-green-900">${summary.totalCommissions}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-green-400" />
              </div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-purple-600 font-medium">Avg Commission</p>
                  <p className="text-2xl font-bold text-purple-900">
                    ${summary.totalOrders > 0 ? (parseFloat(summary.totalCommissions) / summary.totalOrders).toFixed(2) : "0"}
                  </p>
                </div>
                <Package className="w-8 h-8 text-purple-400" />
              </div>
            </div>
          </div>
        )}

        {/* Add Order Button */}
        <div className="flex justify-end">
          <button
            onClick={() => setShowAddOrder(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            <Plus className="w-4 h-4" />
            Record Sale
          </button>
        </div>

        {/* Add Order Modal */}
        {showAddOrder && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-2xl w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Record Marketplace Sale</h2>
                <button
                  onClick={() => {
                    setShowAddOrder(false);
                    setSelectedProduct(null);
                    setOrderAmount("");
                    setOrderNotes("");
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Product Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Product</label>
                  <select
                    value={selectedProduct?.id || ""}
                    onChange={(e) => {
                      const product = products.find(p => p.id === parseInt(e.target.value));
                      setSelectedProduct(product || null);
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a product...</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.title} - {p.vendorName} ({parseFloat(p.commissionRate).toFixed(1)}% commission)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Product Details */}
                {selectedProduct && (
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <p className="text-sm text-gray-600 mb-2">{selectedProduct.description}</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-600">Commission Rate</p>
                        <p className="font-semibold">{parseFloat(selectedProduct.commissionRate).toFixed(1)}%</p>
                      </div>
                      {selectedProduct.price && (
                        <div>
                          <p className="text-gray-600">Product Price</p>
                          <p className="font-semibold">${parseFloat(selectedProduct.price).toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Sale Amount */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Sale Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={orderAmount}
                    onChange={(e) => setOrderAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Estimated Commission */}
                {selectedProduct && orderAmount && (
                  <div className="bg-blue-50 p-3 rounded border border-blue-200">
                    <p className="text-sm text-blue-600">
                      Estimated Commission: <span className="font-bold">${(parseFloat(orderAmount) * parseFloat(selectedProduct.commissionRate) / 100).toFixed(2)}</span>
                    </p>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Notes (optional)</label>
                  <textarea
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Customer name, deal details, etc."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    rows={3}
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => {
                      setShowAddOrder(false);
                      setSelectedProduct(null);
                      setOrderAmount("");
                      setOrderNotes("");
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddOrder}
                    disabled={submitting || !selectedProduct || !orderAmount}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2"
                  >
                    {submitting && <Loader className="w-4 h-4 animate-spin" />}
                    Record Sale
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Products Section */}
        <div>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Package className="w-5 h-5" />
            Available Products
          </h2>

          {/* Category Filter */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-lg whitespace-nowrap transition ${
                  selectedCategory === cat
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {cat === "all" ? "All Categories" : `${categoryIcons[cat] || "📦"} ${cat}`}
              </button>
            ))}
          </div>

          {/* Products Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.length > 0 ? (
              filteredProducts.map(product => (
                <div key={product.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-lg transition">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{product.title}</h3>
                      <p className="text-sm text-gray-500">{product.vendorName || `Vendor ${product.vendorId}`}</p>
                    </div>
                    <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-1 rounded">
                      {parseFloat(product.commissionRate).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">{product.description}</p>
                  <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                    <span className="text-xs text-gray-500">{product.category}</span>
                    {product.price && <span className="font-semibold text-gray-900">${parseFloat(product.price).toFixed(2)}</span>}
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full text-center py-12 text-gray-500">
                No products available in this category
              </div>
            )}
          </div>
        </div>

        {/* Orders History */}
        {orders.length > 0 && (
          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              Your Sales History
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Product</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Vendor</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700">Amount</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700">Commission</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(order => (
                    <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">{order.productTitle}</td>
                      <td className="px-4 py-3 text-gray-600">{order.vendorName}</td>
                      <td className="text-right px-4 py-3 font-semibold">${parseFloat(order.amount).toFixed(2)}</td>
                      <td className="text-right px-4 py-3 font-semibold text-green-600">${parseFloat(order.commissionAmount).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-1 rounded ${
                          order.status === "completed" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                        }`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{format(new Date(order.createdAt), "MMM dd, yyyy")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {orders.length === 0 && !loading && (
          <div className="text-center py-12 text-gray-500">
            <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <p>No sales recorded yet. Start by recording your first marketplace sale!</p>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
