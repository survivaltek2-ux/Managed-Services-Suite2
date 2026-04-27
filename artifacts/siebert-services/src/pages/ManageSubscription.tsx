import { useEffect, useState } from "react";
import { useSearch, useLocation } from "wouter";
import {
  CheckCircle, CreditCard, ExternalLink, Loader2, AlertCircle,
  RefreshCw, Phone, Calendar, XCircle, Shield,
} from "lucide-react";
import { Button } from "@/components/ui";

interface SubscriptionInfo {
  planName: string;
  planSlug: string;
  status: string;
  billingCycle: string;
  amount: string | null;
  seats: number | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  customerName: string | null;
  customerEmail: string | null;
  features: string[];
  autoActivated: boolean;
}

function StatusPill({ status, cancelAtPeriodEnd }: { status: string; cancelAtPeriodEnd: boolean }) {
  if (cancelAtPeriodEnd) return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800"><XCircle className="w-3 h-3" /> Cancels at period end</span>;
  const map: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800",
    trialing: "bg-sky-100 text-sky-800",
    past_due: "bg-red-100 text-red-800",
    canceled: "bg-gray-100 text-gray-600",
    paused: "bg-yellow-100 text-yellow-800",
  };
  const label = status.replace("_", " ");
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${map[status] || "bg-gray-100 text-gray-600"}`}><CheckCircle className="w-3 h-3" />{label}</span>;
}

export default function ManageSubscription() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const managed = params.get("managed") === "1";

  const [token] = useState<string | null>(() => sessionStorage.getItem("consumer_manage_token"));

  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");

  useEffect(() => {
    if (!token) { setError("No access token found. Please return to your welcome page."); setLoading(false); return; }
    fetch("/api/billing/subscription-info", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || "Unable to load subscription details.");
        setInfo(data);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const openPortal = async () => {
    if (!token) return;
    setPortalLoading(true);
    setPortalError("");
    try {
      const res = await fetch("/api/billing/portal", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not open billing portal");
      window.location.href = data.url;
    } catch (err: any) {
      setPortalError(err.message || "Something went wrong. Please try again.");
      setPortalLoading(false);
    }
  };

  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <section className="relative pt-32 pb-16 bg-navy overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:24px_24px]" />
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 relative text-center">
          <div className="w-16 h-16 rounded-full bg-teal-500/20 border-2 border-teal-400/30 flex items-center justify-center mx-auto mb-5">
            <CreditCard className="w-8 h-8 text-teal-400" />
          </div>
          <h1 className="text-3xl md:text-4xl font-display font-extrabold text-white leading-tight mb-3">
            {managed ? "Welcome back" : "Your Subscription"}
          </h1>
          <p className="text-white/70 text-base">
            {managed ? "You've been returned from the billing portal." : "View your plan details and manage your subscription."}
          </p>
        </div>
      </section>

      {/* Body */}
      <section className="py-14">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">

          {loading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Loading your subscription details…</span>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
              <h3 className="font-bold text-red-900 mb-1">Unable to load subscription</h3>
              <p className="text-sm text-red-700 mb-4">{error}</p>
              <Button variant="outline" onClick={() => setLocation("/pricing")} className="gap-2">
                View pricing plans
              </Button>
            </div>
          )}

          {!loading && info && (
            <>
              {/* Plan card */}
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <h2 className="text-xl font-bold capitalize">{info.planName} Plan</h2>
                    <p className="text-sm text-muted-foreground capitalize mt-0.5">
                      {info.billingCycle} billing
                      {info.seats && info.seats > 1 ? ` · ${info.seats} seat${info.seats > 1 ? "s" : ""}` : ""}
                    </p>
                  </div>
                  <StatusPill status={info.status} cancelAtPeriodEnd={info.cancelAtPeriodEnd} />
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-muted/50 px-4 py-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Amount</p>
                    <p className="text-lg font-bold">
                      {info.amount ? fmt(parseFloat(info.amount)) : "—"}
                      <span className="text-sm font-normal text-muted-foreground">/{info.billingCycle === "annual" ? "yr" : "mo"}</span>
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-4 py-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                      {info.cancelAtPeriodEnd ? "Access ends" : "Next renewal"}
                    </p>
                    <p className="text-base font-semibold flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      {fmtDate(info.currentPeriodEnd)}
                    </p>
                  </div>
                </div>

                {info.customerEmail && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Billing email: <span className="font-medium text-foreground">{info.customerEmail}</span>
                  </p>
                )}
              </div>

              {/* Features */}
              {info.features.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-teal-600" />
                    What's included
                  </h3>
                  <ul className="space-y-2">
                    {info.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-teal-500 mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Manage billing */}
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-6">
                <h3 className="font-bold text-teal-900 mb-1">Manage your billing</h3>
                <p className="text-sm text-teal-700 mb-4">
                  Update your payment method, download past invoices, or cancel your plan — all from Stripe's secure portal.
                </p>
                {portalError && <p className="text-sm text-red-600 mb-3">{portalError}</p>}
                <Button
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="gap-2 bg-teal-600 hover:bg-teal-700 text-white"
                >
                  {portalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                  {portalLoading ? "Opening…" : "Open billing portal"}
                </Button>
                {info.cancelAtPeriodEnd && (
                  <p className="text-xs text-teal-700/70 mt-3 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />
                    You can reactivate your subscription from the billing portal before access ends.
                  </p>
                )}
                {!info.cancelAtPeriodEnd && info.autoActivated && (
                  <p className="text-xs text-teal-600/70 mt-3">
                    You have a 3-day right to cancel for a full refund before services begin.
                  </p>
                )}
              </div>

              {/* Support */}
              <div className="rounded-xl border border-border bg-card p-6 text-center">
                <h3 className="font-semibold mb-1">Need help?</h3>
                <p className="text-sm text-muted-foreground mb-4">Our team is available to answer questions about your plan or services.</p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Button onClick={() => setLocation("/contact")} className="gap-2">
                    <Phone className="w-4 h-4" /> Contact support
                  </Button>
                  <Button variant="outline" onClick={() => setLocation("/")} className="gap-2">
                    Back to home
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
