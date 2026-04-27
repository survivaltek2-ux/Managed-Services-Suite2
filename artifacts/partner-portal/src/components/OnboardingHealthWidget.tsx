import { useEffect, useState } from "react";
import { Link } from "wouter";
import { getAuthHeaders } from "@/hooks/use-auth";
import { Activity, AlertCircle, ChevronRight, Loader2 } from "lucide-react";

interface FlowStat {
  open: number;
  stalled: number;
}
interface HealthResponse {
  paused: boolean;
  flows: {
    partner_application: FlowStat;
    client_onboarding: FlowStat;
    partner_team_invite: FlowStat;
    stripe_connect: FlowStat;
    admin_account: FlowStat;
  };
}

const FLOW_LABELS: Record<keyof HealthResponse["flows"], string> = {
  partner_application: "Partner Applications",
  client_onboarding: "Client Onboarding",
  partner_team_invite: "Team Invites",
  stripe_connect: "Stripe Connect",
  admin_account: "Admin Accounts",
};

export function OnboardingHealthWidget() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/onboarding/health", { headers: getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<HealthResponse>;
      })
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(String(err?.message ?? err)); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="sf-card">
      <div className="sf-card-header">
        <span className="flex items-center gap-2"><Activity className="w-3.5 h-3.5 text-[#0176d3]" />Onboarding Command Center</span>
        <Link href="/admin/onboarding" className="text-xs text-[#0176d3] hover:underline flex items-center gap-1">
          Open <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="p-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
        )}
        {!loading && error && (
          <div className="text-sm text-red-600 flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5" />{error}</div>
        )}
        {!loading && !error && data && (
          <>
            {data.paused && (
              <div className="mb-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5" />Automated reminders are <strong className="ml-1">paused</strong>.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {(Object.keys(FLOW_LABELS) as Array<keyof HealthResponse["flows"]>).map((flow) => {
                const stat = data.flows[flow];
                const stalled = stat?.stalled ?? 0;
                const open = stat?.open ?? 0;
                return (
                  <Link key={flow} href={`/admin/onboarding?flow=${flow}`}>
                    <div className="border border-[#d8dde6] rounded p-3 hover:border-[#0176d3] hover:shadow-sm cursor-pointer transition">
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">{FLOW_LABELS[flow]}</div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-foreground">{open}</span>
                        <span className="text-[10px] text-muted-foreground">open</span>
                      </div>
                      {stalled > 0 ? (
                        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                          <AlertCircle className="w-3 h-3" />{stalled} stalled
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-emerald-700">All on track</div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
