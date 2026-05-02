import React, { useState, useEffect } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MousePointerClick, TrendingUp, MapPin, Clock } from "lucide-react";

interface ProviderStat {
  providerName: string;
  technology: string | null;
  clicks: number;
}

interface StateStat {
  stateCode: string | null;
  userType: string | null;
  clicks: number;
}

interface RecentClick {
  id: number;
  providerName: string;
  technology: string | null;
  addressSearched: string | null;
  stateCode: string | null;
  userType: string | null;
  clickedAt: string;
}

interface ClickData {
  byProvider: ProviderStat[];
  byState: StateStat[];
  recent: RecentClick[];
  totalAllTime: number;
}

function timeAgo(isoDate: string): string {
  const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export default function AdminAffiliateClicks() {
  const { user } = useAuth();
  const headers = getAuthHeaders();
  const [data, setData] = useState<ClickData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/affiliate/clicks", { headers })
      .then(r => r.ok ? r.json() : Promise.reject("Failed to load"))
      .then(setData)
      .catch(() => setError("Failed to load affiliate click data."))
      .finally(() => setLoading(false));
  }, []);

  const totalLast90 = data?.byProvider.reduce((s, p) => s + Number(p.clicks), 0) ?? 0;

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ISP Affiliate Click Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tracks every "Get Started" click on the public ISP finder — last 90 days unless noted.
          </p>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading analytics…</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
        )}

        {data && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="bg-blue-100 p-3 rounded-full">
                    <MousePointerClick className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">All-Time Clicks</p>
                    <p className="text-2xl font-bold text-gray-900">{data.totalAllTime.toLocaleString()}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="bg-emerald-100 p-3 rounded-full">
                    <TrendingUp className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Clicks (Last 90 Days)</p>
                    <p className="text-2xl font-bold text-gray-900">{totalLast90.toLocaleString()}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="bg-purple-100 p-3 rounded-full">
                    <MapPin className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Unique Providers Clicked</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {new Set(data.byProvider.map(p => p.providerName)).size}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By Provider */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Clicks by Provider (Last 90 Days)</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.byProvider.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No clicks recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {data.byProvider.map((p, i) => {
                        const max = data.byProvider[0]?.clicks ?? 1;
                        const pct = Math.round((Number(p.clicks) / Number(max)) * 100);
                        return (
                          <div key={i} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="font-medium text-gray-800">
                                {p.providerName}
                                {p.technology && (
                                  <span className="ml-2 text-xs text-gray-400">({p.technology})</span>
                                )}
                              </span>
                              <span className="text-gray-600 font-semibold">{Number(p.clicks).toLocaleString()}</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2">
                              <div
                                className="bg-blue-500 h-2 rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* By State */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Clicks by State (Last 90 Days)</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.byState.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No location data yet.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-400 border-b">
                          <th className="pb-2 font-medium">State</th>
                          <th className="pb-2 font-medium">Flow</th>
                          <th className="pb-2 font-medium text-right">Clicks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byState.map((s, i) => (
                          <tr key={i} className="border-b border-gray-50">
                            <td className="py-1.5 font-medium text-gray-800">{s.stateCode ?? "—"}</td>
                            <td className="py-1.5 text-gray-500 capitalize">{s.userType ?? "—"}</td>
                            <td className="py-1.5 text-right text-gray-700 font-semibold">{Number(s.clicks).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Recent activity */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-400" />
                  Recent Clicks
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.recent.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No clicks yet — links will be tracked once affiliate URLs are live.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-400 border-b">
                          <th className="pb-2 font-medium">Provider</th>
                          <th className="pb-2 font-medium">Technology</th>
                          <th className="pb-2 font-medium">State</th>
                          <th className="pb-2 font-medium">Flow</th>
                          <th className="pb-2 font-medium">Address</th>
                          <th className="pb-2 font-medium text-right">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recent.map(click => (
                          <tr key={click.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-2 font-medium text-gray-900">{click.providerName}</td>
                            <td className="py-2 text-gray-500">{click.technology ?? "—"}</td>
                            <td className="py-2 text-gray-500">{click.stateCode ?? "—"}</td>
                            <td className="py-2 capitalize text-gray-500">{click.userType ?? "—"}</td>
                            <td className="py-2 text-gray-400 text-xs max-w-xs truncate">{click.addressSearched ?? "—"}</td>
                            <td className="py-2 text-right text-gray-400 whitespace-nowrap">{timeAgo(click.clickedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PortalLayout>
  );
}
