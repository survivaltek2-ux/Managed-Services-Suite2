import { useEffect, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { CheckCircle, ArrowRight, Phone, Mail, Calendar, CreditCard, Settings, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui";

export default function Welcome() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const plan = params.get("plan") || "";
  const mnonce = params.get("mnonce");
  const confirmedParam = params.get("confirmed") === "1";
  const managed = params.get("managed") === "1";

  const [confirmed, setConfirmed] = useState(false);
  const [manageToken, setManageToken] = useState<string | null>(null);
  const [tokenFetching, setTokenFetching] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");

  const isConsumer = plan.toLowerCase() === "consumer";

  useEffect(() => {
    if (mnonce || confirmedParam) {
      setConfirmed(true);
    }
    if (mnonce && isConsumer) {
      setTokenFetching(true);
      fetch(`/api/billing/manage-token?mnonce=${encodeURIComponent(mnonce)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.token) {
            sessionStorage.setItem("consumer_manage_token", data.token);
            setManageToken(data.token);
          }
        })
        .catch(() => {})
        .finally(() => setTokenFetching(false));
    }
  }, [mnonce, confirmedParam, isConsumer]);

  const planNames: Record<string, string> = {
    essentials: "Essentials",
    business: "Business",
    enterprise: "Enterprise",
    consumer: "Consumer",
  };

  const planName = planNames[plan.toLowerCase()] || plan || "your plan";

  const openPortal = async () => {
    if (!manageToken) return;
    setPortalLoading(true);
    setPortalError("");
    try {
      const res = await fetch("/api/billing/portal", {
        headers: { Authorization: `Bearer ${manageToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not open billing portal");
      window.location.href = data.url;
    } catch (err: any) {
      setPortalError(err.message || "Something went wrong. Please try again.");
      setPortalLoading(false);
    }
  };

  const consumerSteps = [
    {
      step: "1",
      icon: Mail,
      title: "Check your email",
      desc: "A confirmation receipt is on its way. Check your inbox (and spam folder) for your subscription details.",
    },
    {
      step: "2",
      icon: Settings,
      title: "You're already active",
      desc: "Your Consumer plan activated immediately. Support is available now — contact us any time.",
    },
    {
      step: "3",
      icon: CreditCard,
      title: "Manage anytime",
      desc: "Update your payment method, view invoices, or cancel directly from your subscription page — no need to call.",
    },
  ];

  const businessSteps = [
    {
      step: "1",
      icon: Mail,
      title: "Check your email",
      desc: "We'll send a welcome email with your account details, onboarding checklist, and next steps within 24 hours.",
    },
    {
      step: "2",
      icon: Phone,
      title: "Onboarding call",
      desc: "Our team will reach out to schedule a kickoff call to understand your environment and begin setup.",
    },
    {
      step: "3",
      icon: Calendar,
      title: "Go live",
      desc: "Monitoring, security, and support services are typically fully active within 5–10 business days.",
    },
  ];

  const steps = isConsumer ? consumerSteps : businessSteps;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Hero */}
      <section className="relative pt-32 pb-20 bg-navy overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:24px_24px]" />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400/30 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-emerald-400" />
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-extrabold text-white leading-tight mb-4">
            {managed ? "Welcome back!" : "Welcome aboard!"}
          </h1>
          <p className="text-xl text-white/80 mb-2">
            {managed
              ? "Your subscription is active and managed."
              : <>You've subscribed to the <span className="text-primary font-bold">{planName}</span> plan.</>}
          </p>
          {confirmed && !managed && (
            <p className="text-white/60 text-sm">
              Your payment was confirmed. You'll receive a receipt at your email shortly.
            </p>
          )}
          {isConsumer && confirmed && !managed && (
            <p className="mt-2 text-sm font-semibold text-teal-300">
              Your plan is active immediately — you're all set.
            </p>
          )}
        </div>
      </section>

      {/* Next steps */}
      <section className="py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-center mb-10">What happens next?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {steps.map(item => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="flex flex-col items-center text-center p-6 rounded-xl border border-border bg-card">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="text-xs font-bold uppercase tracking-wider text-primary mb-1">Step {item.step}</div>
                  <h3 className="text-base font-bold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Consumer self-service section */}
          {isConsumer && (mnonce || manageToken) && (
            <div className="mt-10 rounded-xl border border-teal-200 bg-teal-50 p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-teal-100 border border-teal-200 flex items-center justify-center shrink-0">
                  <CreditCard className="w-5 h-5 text-teal-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-teal-900 mb-1">Manage your subscription</h3>
                  <p className="text-sm text-teal-700 mb-4">
                    View your plan details, update your payment method, download invoices, or cancel — all without contacting support.
                  </p>
                  {tokenFetching ? (
                    <div className="flex items-center gap-2 text-sm text-teal-700/70">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading your account…
                    </div>
                  ) : manageToken ? (
                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={() => setLocation("/manage/subscription")}
                        className="gap-2 bg-teal-600 hover:bg-teal-700 text-white"
                      >
                        <CreditCard className="w-4 h-4" />
                        View my plan
                      </Button>
                      <Button
                        onClick={openPortal}
                        disabled={portalLoading}
                        variant="outline"
                        className="gap-2 border-teal-300 text-teal-700 hover:bg-teal-100"
                      >
                        {portalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                        {portalLoading ? "Opening…" : "Open billing portal"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-teal-700/70">
                      Visit your confirmation email for a link to manage your subscription, or <button onClick={() => setLocation("/contact")} className="underline hover:text-teal-900">contact us</button> for assistance.
                    </p>
                  )}
                  {portalError && <p className="text-sm text-red-600 mt-3">{portalError}</p>}
                  <p className="text-xs text-teal-600/70 mt-3">
                    You have a 3-day right to cancel for a full refund before services begin.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-12 text-center space-y-4">
            <p className="text-muted-foreground">Have questions? We're here to help.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button onClick={() => setLocation("/contact")} className="gap-2">
                <Phone className="w-4 h-4" /> Contact Us
              </Button>
              <Button variant="outline" onClick={() => setLocation("/")} className="gap-2">
                <ArrowRight className="w-4 h-4" /> Back to Home
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
