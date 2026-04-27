import { useState, useEffect } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { useDeals } from "@/hooks/use-deals";
import { formatCurrency } from "@/lib/utils";
import { Link } from "wouter";
import { TrendingUp, Handshake, DollarSign, Headphones, Target, FileText, ArrowRight, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { OnboardingHealthWidget } from "@/components/OnboardingHealthWidget";

const PIE_COLORS = ['#0176d3', '#2e844a', '#fe9339', '#ea001e', '#706e6b'];

export default function Dashboard() {
  const { user } = useAuth();
  const { data: deals = [] } = useDeals();
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    fetch("/api/partner/dashboard", { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => setStats(data?.stats || null))
      .catch(() => {});
  }, []);

  if (!user) return null;

  const activeDealsCount = deals.filter(d => ['registered', 'in_progress'].includes(d.status)).length;
  const recentDeals = deals.slice(0, 5);

  const dealsByStage: Record<string, number> = {};
  deals.forEach(d => { dealsByStage[d.stage] = (dealsByStage[d.stage] || 0) + 1; });
  const pieData = Object.entries(dealsByStage).map(([name, value]) => ({ name: name.replace('_', ' '), value }));

  const monthlyData = deals.reduce((acc: Record<string, number>, d) => {
    const m = new Date(d.createdAt).toLocaleString('default', { month: 'short' });
    acc[m] = (acc[m] || 0) + parseFloat(String(d.estimatedValue) || "0");
    return acc;
  }, {});
  const chartData = Object.entries(monthlyData).slice(-6).map(([name, value]) => ({ name, value }));

  return (
    <PortalLayout>
      {/* Page Header */}
      <div className="sf-page-header px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Home</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Welcome back, {user.contactName}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="sf-badge sf-badge-info font-semibold uppercase text-[10px]">{user.tier} Partner</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {user.isAdmin && (
          <div className="mb-6">
            <OnboardingHealthWidget />
          </div>
        )}
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard label="YTD Revenue" value={formatCurrency(user.ytdRevenue)} icon={TrendingUp} color="#0176d3" />
          <KpiCard label="Active Deals" value={activeDealsCount.toString()} icon={Target} color="#2e844a" />
          <KpiCard label="Total Commissions" value={stats ? formatCurrency(stats.pendingCommissions + stats.paidCommissions) : "$0"} icon={DollarSign} color="#fe9339" />
          <KpiCard label="Open Tickets" value={stats?.openTickets?.toString() || "0"} icon={Headphones} color="#706e6b" />
        </div>

        {/* Charts Row */}
        <div className="grid lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-2 sf-card">
            <div className="sf-card-header">
              <span>Revenue Pipeline</span>
              <Link href="/deals" className="text-xs text-[#0176d3] hover:underline flex items-center gap-1">View All <ChevronRight className="w-3 h-3" /></Link>
            </div>
            <div className="p-4 h-[280px]">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d8dde6" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#706e6b', fontSize: 11 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#706e6b', fontSize: 11 }} tickFormatter={(v) => `$${v/1000}k`} />
                    <Tooltip
                      contentStyle={{ borderRadius: '4px', border: '1px solid #d8dde6', fontSize: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                      formatter={(val: number) => [formatCurrency(val), "Revenue"]}
                    />
                    <Bar dataKey="value" fill="#0176d3" radius={[2, 2, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No deal data to display</div>
              )}
            </div>
          </div>

          <div className="sf-card">
            <div className="sf-card-header">
              <span>Deals by Stage</span>
            </div>
            <div className="p-4 h-[280px]">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="45%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '4px', border: '1px solid #d8dde6', fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No deals yet</div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center -mt-4">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-[11px]">
                    <div className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="capitalize text-muted-foreground">{d.name}</span>
                    <span className="font-semibold text-foreground">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Recent Deals List */}
          <div className="lg:col-span-2 sf-card">
            <div className="sf-card-header">
              <span>Recent Deals</span>
              <Link href="/deals" className="text-xs text-[#0176d3] hover:underline flex items-center gap-1">View All <ChevronRight className="w-3 h-3" /></Link>
            </div>
            <table className="w-full sf-table">
              <thead>
                <tr>
                  <th>Deal Name</th>
                  <th>Customer</th>
                  <th className="text-right">Est. Value</th>
                  <th>Stage</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentDeals.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No deals registered yet</td></tr>
                ) : (
                  recentDeals.map(deal => (
                    <tr key={deal.id} className="cursor-pointer">
                      <td className="font-medium text-[#0176d3]">{deal.title}</td>
                      <td>{deal.customerName}</td>
                      <td className="text-right font-semibold">{formatCurrency(deal.estimatedValue)}</td>
                      <td><span className="sf-badge sf-badge-info capitalize">{deal.stage.replace('_', ' ')}</span></td>
                      <td><DealStatusBadge status={deal.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Quick Actions */}
          <div className="sf-card">
            <div className="sf-card-header">
              <span>Quick Actions</span>
            </div>
            <div className="p-3 space-y-1">
              <QuickAction href="/deals" icon={Handshake} label="Register New Deal" />
              <QuickAction href="/commissions" icon={DollarSign} label="View Commissions" />
              <QuickAction href="/support" icon={Headphones} label="Open Support Ticket" />
              <QuickAction href="/resources" icon={Target} label="Browse Resources" />
              <QuickAction href="/training" icon={TrendingUp} label="Continue Training" />
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}

function KpiCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  return (
    <div className="sf-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
        </div>
        <div className="w-8 h-8 rounded flex items-center justify-center" style={{ backgroundColor: `${color}10` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
    </div>
  );
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  return (
    <Link href={href}>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded hover:bg-[#f3f3f3] cursor-pointer transition-colors group">
        <div className="w-7 h-7 bg-[#0176d3]/10 rounded flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-[#0176d3]" />
        </div>
        <span className="text-sm font-medium text-foreground flex-1">{label}</span>
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

function DealStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    registered: "sf-badge-info",
    in_progress: "sf-badge-warning",
    won: "sf-badge-success",
    lost: "sf-badge-error",
    expired: "sf-badge-default",
  };
  return <span className={`sf-badge ${map[status] || 'sf-badge-default'} capitalize`}>{status.replace('_', ' ')}</span>;
}

