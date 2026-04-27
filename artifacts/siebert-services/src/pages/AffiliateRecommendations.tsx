import React, { useState, useEffect } from "react";
import { ExternalLink, Loader2, AlertCircle } from "lucide-react";

interface AffiliateProgram {
  slug: string;
  category: string;
  rateUsd: number;
  percentRate: string | null;
  commissionType: string;
  network: string;
  affiliateSignupUrl: string;
  affiliateUrl: string | null;
  isLive: boolean;
  notes: string;
}

interface ProgramData {
  programs: AffiliateProgram[];
  totalLive: number;
  totalPending: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Residential ISP": "bg-blue-100 text-blue-700",
  "Business Connectivity": "bg-indigo-100 text-indigo-700",
  "VoIP & Communications": "bg-purple-100 text-purple-700",
  Cybersecurity: "bg-red-100 text-red-700",
  "VPN & Network Security": "bg-orange-100 text-orange-700",
  "Password Management": "bg-green-100 text-green-700",
  "Backup & Storage": "bg-teal-100 text-teal-700",
  "Home Security": "bg-pink-100 text-pink-700",
  "Consumer Antivirus": "bg-rose-100 text-rose-700",
  "Identity Protection": "bg-cyan-100 text-cyan-700",
  "Cloud Productivity": "bg-sky-100 text-sky-700",
  "Network Monitoring & IT Ops": "bg-emerald-100 text-emerald-700",
  "Sales & Marketing": "bg-violet-100 text-violet-700",
  "Web Hosting": "bg-amber-100 text-amber-700",
};

export default function AffiliateRecommendations() {
  const [data, setData] = useState<ProgramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/affiliate/programs/live`);
        if (!res.ok) throw new Error("Failed to fetch programs");
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white py-16 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-3" />
          <p className="text-gray-600">Loading recommended products...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white py-16 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">Unable to load products</h3>
              <p className="text-sm text-red-700 mt-1">{error || "Please try again later"}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const livePrograms = data.programs.filter(p => p.isLive);
  const categories = [...new Set(livePrograms.map(p => p.category))].sort();
  const filtered = selectedCategory
    ? livePrograms.filter(p => p.category === selectedCategory)
    : livePrograms;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Recommended Products</h1>
          <p className="text-lg text-gray-600 mb-6">
            Hand-picked partner solutions to enhance your business operations
          </p>
          
          {/* Stats */}
          <div className="flex gap-6">
            <div>
              <p className="text-3xl font-bold text-blue-600">{livePrograms.length}</p>
              <p className="text-sm text-gray-600">Live Programs</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-green-600">{categories.length}</p>
              <p className="text-sm text-gray-600">Categories</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Category Filter */}
        {categories.length > 0 && (
          <div className="mb-8">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  selectedCategory === null
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                All Programs
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    selectedCategory === cat
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Optimum Referral Banner */}
        <div className="bg-gradient-to-r from-[#071225] to-[#0C172B] border border-[#E66262] rounded-lg p-6 text-white mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold mb-2">Save on Optimum Internet</h3>
              <p className="text-sm text-gray-200 mb-3">Get a <span className="font-semibold text-[#E66262]">$50 bill credit</span> when you sign up for Optimum internet service using our referral link. Available in select areas.</p>
            </div>
            <a
              href="https://refer.optimum.com/Richard0!b719e743b0!a"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#E66262] hover:bg-[#d45252] text-white font-bold py-2 px-6 rounded-full flex items-center justify-center gap-2 transition whitespace-nowrap"
            >
              Check Optimum Availability
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* Programs Grid */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map(p => (
              <div
                key={p.slug}
                className="bg-white rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all overflow-hidden"
              >
                <div className="p-6 space-y-4">
                  {/* Title */}
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 capitalize">
                        {p.slug.replace(/-/g, " ")}
                      </h3>
                    </div>
                    <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${CATEGORY_COLORS[p.category] ?? "bg-gray-100 text-gray-600"}`}>
                      {p.category}
                    </span>
                  </div>

                  {/* Notes */}
                  {p.notes && (
                    <p className="text-xs text-gray-600 leading-relaxed border-t border-gray-100 pt-3">
                      {p.notes}
                    </p>
                  )}

                  {/* CTA Button */}
                  <a
                    href={p.affiliateUrl || p.affiliateSignupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 w-full justify-center px-4 py-2.5 mt-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                  >
                    {p.affiliateUrl ? "Get Started" : "Learn More"}
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-600 mb-3">No products available in this category yet.</p>
            <button
              onClick={() => setSelectedCategory(null)}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              View all products
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
