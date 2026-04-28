import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/Badge";
import { crmFetch, fmtCurrency, fmtDateTime } from "./lib";

type Dashboard = {
  kpis: {
    contacts: number; companies: number; openDeals: number; openDealsValue: number;
    openLeads: number; openTasks: number; overdueTasks: number; myOpenTasks: number; newContacts30d: number;
  };
  recentActivity: Array<{ id: number; type: string; subject: string | null; body: string | null; occurredAt: string; contactId: number | null; companyId: number | null }>;
  myTasks: Array<{ id: number; title: string; dueAt: string | null; priority: string; contactId: number | null }>;
};

export default function CrmDashboard() {
  const { data, isLoading } = useQuery<Dashboard>({
    queryKey: ["crm", "dashboard"],
    queryFn: () => crmFetch<Dashboard>("/admin/crm/dashboard"),
    refetchInterval: 60_000,
  });

  return (
    <PortalLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">CRM Dashboard</h1>
            <p className="text-sm text-muted-foreground">Pipeline health, recent activity, and your tasks</p>
          </div>
        </div>

        {isLoading || !data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Kpi label="Contacts" value={data.kpis.contacts} hint={`+${data.kpis.newContacts30d} in 30d`} href="/admin/crm/contacts" />
              <Kpi label="Companies" value={data.kpis.companies} href="/admin/crm/companies" />
              <Kpi label="Open Deals" value={data.kpis.openDeals} hint={fmtCurrency(data.kpis.openDealsValue)} href="/admin/crm/deals" />
              <Kpi label="Open Leads" value={data.kpis.openLeads} href="/admin/crm/leads" />
              <Kpi label="My Open Tasks" value={data.kpis.myOpenTasks} hint={`${data.kpis.overdueTasks} overdue`} href="/admin/crm/tasks?scope=mine" />
              <Kpi label="Total Open Tasks" value={data.kpis.openTasks} href="/admin/crm/tasks?scope=all" />
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base">My Open Tasks</CardTitle></CardHeader>
                <CardContent>
                  {data.myTasks.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No open tasks. Nice.</div>
                  ) : (
                    <ul className="space-y-2">
                      {data.myTasks.map(t => (
                        <li key={t.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                          <div>
                            <div className="text-sm font-medium">{t.title}</div>
                            <div className="text-xs text-muted-foreground">{t.dueAt ? `Due ${fmtDateTime(t.dueAt)}` : "No due date"}</div>
                          </div>
                          <Badge variant="outline" className="text-xs">{t.priority}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
                <CardContent>
                  {data.recentActivity.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No activity yet. Log your first call or note from any contact.</div>
                  ) : (
                    <ul className="space-y-2">
                      {data.recentActivity.map(a => (
                        <li key={a.id} className="border-b pb-2 last:border-0">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{a.subject || a.type}</span>
                            <span className="text-xs text-muted-foreground">{fmtDateTime(a.occurredAt)}</span>
                          </div>
                          {a.body && <div className="text-xs text-muted-foreground line-clamp-2">{a.body}</div>}
                          {a.contactId && <Link href={`/admin/crm/contacts/${a.contactId}`}><span className="text-xs text-blue-600 hover:underline">View contact</span></Link>}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}

function Kpi({ label, value, hint, href }: { label: string; value: number | string; hint?: string; href?: string }) {
  const inner = (
    <Card className="hover:shadow transition-shadow cursor-pointer">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
