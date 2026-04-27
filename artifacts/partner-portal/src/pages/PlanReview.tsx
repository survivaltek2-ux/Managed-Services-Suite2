import React, { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { SignaturePanel } from "@/components/SignaturePanel";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  CheckCircle, XCircle, Phone, Download, Loader, AlertCircle,
  Clock, FileText, ChevronDown, ChevronUp,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  SERVICE_LEVELS, CLIENT_RESPONSIBILITIES, ASSUMPTIONS,
  CONFIDENTIALITY_TEXT, TERMS_TEXT, ACCEPTANCE_TEXT,
  investmentSummaryText, validityNotice,
  CONSUMER_SERVICE_LEVELS, CONSUMER_CLIENT_RESPONSIBILITIES, CONSUMER_ASSUMPTIONS,
  consumerInvestmentSummaryText,
} from "@workspace/db/boilerplate";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanContent {
  executiveSummary: string;
  currentEnvironment: string;
  keyFindings: string[];
  recommendedServices: { service: string; description: string; vendor?: string; product?: string }[];
  recommendedProducts?: { vendor: string; product: string; category: string; rationale: string }[];
  nextSteps: string[];
}

interface Plan {
  id: number;
  planNumber: string;
  version: number;
  clientName: string;
  clientEmail: string;
  clientCompany: string;
  clientTitle: string | null;
  planContent: PlanContent;
  planType: string;
  status: string;
  expiresAt: string | null;
  personalNote: string | null;
  approvedAt: string | null;
  signerName: string | null;
  signerTitle: string | null;
  signatureImage: string | null;
  declineReason: string | null;
  declineNote: string | null;
  createdAt: string;
}

const DECLINE_REASONS = [
  "Budget constraints",
  "Timing isn't right",
  "Going with another provider",
  "Scope doesn't match our needs",
  "Other",
];

// ─── Plan Document ────────────────────────────────────────────────────────────

function PlanDocument({ content, plan }: { content: PlanContent; plan?: Plan & { questionnaireAnswers?: unknown; validityDays?: number } }) {
  const isConsumerPlan = plan?.planType === "consumer";
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["summary"]));

  function toggle(key: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
    const open = expandedSections.has(id);
    return (
      <div className="border rounded-lg overflow-hidden">
        <button onClick={() => toggle(id)} className="w-full flex items-center justify-between px-5 py-3.5 bg-white hover:bg-gray-50 transition-colors">
          <h3 className="font-semibold text-[#032d60] text-sm sm:text-base">{title}</h3>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {open && <div className="px-5 py-4 border-t bg-white">{children}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Section id="summary" title="Executive Summary">
        <p className="text-sm text-gray-700 leading-relaxed">{content.executiveSummary}</p>
      </Section>
      <Section id="environment" title="Current Environment">
        <p className="text-sm text-gray-700 leading-relaxed">{content.currentEnvironment}</p>
      </Section>
      <Section id="findings" title="Key Findings">
        <ul className="space-y-2">
          {(content.keyFindings || []).map((f, i) => (
            <li key={i} className="flex gap-2 items-start text-sm text-gray-700">
              <span className="text-[#0176d3] mt-0.5 shrink-0">▪</span> {f}
            </li>
          ))}
        </ul>
      </Section>
      <Section id="services" title="Recommended Services">
        <div className="space-y-3">
          {(content.recommendedServices || []).map((s, i) => (
            <div key={i} className="p-3 rounded-lg bg-[#f0f7ff] border border-[#0176d3]/20">
              <p className="font-semibold text-[#032d60] text-sm">{s.service}</p>
              {(s.vendor || s.product) && (
                <p className="text-[11px] text-[#0176d3] mt-0.5">
                  Delivered via:{" "}
                  <span className="font-medium">{[s.vendor, s.product].filter(Boolean).join(" — ")}</span>
                </p>
              )}
              <p className="text-gray-600 text-xs mt-1 leading-relaxed">{s.description}</p>
            </div>
          ))}
        </div>
      </Section>
      {(content.recommendedProducts?.length ?? 0) > 0 && (
        <Section id="products" title="Recommended Products">
          <div className="space-y-3">
            {(content.recommendedProducts || []).map((p, i) => (
              <div key={i} className="p-3 rounded-lg bg-white border border-[#0176d3]/20">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{p.category}</p>
                <p className="text-sm mt-0.5">
                  <span className="font-semibold text-[#032d60]">{p.vendor}</span>
                  <span className="text-gray-500"> — </span>
                  <span className="text-gray-700">{p.product}</span>
                </p>
                <p className="text-gray-600 text-xs mt-1 leading-relaxed">{p.rationale}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section id="next" title="Next Steps">
        <ol className="space-y-2">
          {(content.nextSteps || []).map((step, i) => (
            <li key={i} className="flex gap-2 items-start text-sm text-gray-700">
              <span className="text-[#0176d3] font-bold shrink-0 w-5">{i + 1}.</span> {step}
            </li>
          ))}
        </ol>
      </Section>
      <Section id="sla" title={isConsumerPlan ? "Response Times" : "Service Levels"}>
        <div className="space-y-2">
          {(isConsumerPlan ? CONSUMER_SERVICE_LEVELS : SERVICE_LEVELS).map((sl, i) => (
            <div key={i}>
              <p className="text-sm font-semibold text-[#032d60]">{sl.tier}</p>
              <p className="text-xs text-muted-foreground">{sl.target}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section id="investment" title={isConsumerPlan ? "Plan Summary" : "Investment Summary"}>
        <p className="text-sm text-gray-700 leading-relaxed">
          {isConsumerPlan
            ? consumerInvestmentSummaryText((plan?.questionnaireAnswers as Record<string, unknown>) ?? {})
            : investmentSummaryText((plan?.questionnaireAnswers as Record<string, unknown>) ?? {})}
        </p>
      </Section>
      <Section id="responsibilities" title={isConsumerPlan ? "Your Responsibilities" : "Client Responsibilities"}>
        <ul className="space-y-2">
          {(isConsumerPlan ? CONSUMER_CLIENT_RESPONSIBILITIES : CLIENT_RESPONSIBILITIES).map((r, i) => (
            <li key={i} className="flex gap-2 items-start text-sm text-gray-700">
              <span className="text-[#0176d3] mt-0.5 shrink-0">▪</span> {r}
            </li>
          ))}
        </ul>
      </Section>
      <Section id="assumptions" title="Assumptions">
        <ul className="space-y-2">
          {(isConsumerPlan ? CONSUMER_ASSUMPTIONS : ASSUMPTIONS).map((a, i) => (
            <li key={i} className="flex gap-2 items-start text-sm text-gray-700">
              <span className="text-[#0176d3] mt-0.5 shrink-0">▪</span> {a}
            </li>
          ))}
        </ul>
      </Section>
      <Section id="validity" title="Plan Validity">
        <p className="text-sm text-gray-700 leading-relaxed">
          {validityNotice(plan?.validityDays ?? 30, plan?.expiresAt ?? null)}
        </p>
      </Section>
      <Section id="confidentiality" title="Confidentiality">
        <p className="text-sm text-gray-700 leading-relaxed">{CONFIDENTIALITY_TEXT}</p>
      </Section>
      <Section id="terms" title="Terms">
        <p className="text-sm text-gray-700 leading-relaxed">{TERMS_TEXT}</p>
      </Section>
      <Section id="acceptance" title="Acceptance">
        <p className="text-sm text-gray-700 leading-relaxed">{ACCEPTANCE_TEXT}</p>
      </Section>
    </div>
  );
}

// ─── Confirmation Screens ─────────────────────────────────────────────────────

function SuccessScreen({ title, subtitle, pdfUrl }: { title: string; subtitle: string; pdfUrl?: string }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-500 text-sm mb-6">{subtitle}</p>
        {pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
            <Button className="gap-2 bg-[#032d60] hover:bg-[#0176d3] text-white w-full">
              <Download className="w-4 h-4" /> Download Signed Plan (PDF)
            </Button>
          </a>
        )}
        <p className="text-xs text-gray-400 mt-6">You may now close this page.</p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PlanReview() {
  const [, params] = useRoute("/plan-review/:token");
  const token = params?.token ?? "";

  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [action, setAction] = useState<"sign" | "decline" | "call" | null>(null);
  const [done, setDone] = useState<"approved" | "declined" | "call" | null>(null);

  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [declineReason, setDeclineReason] = useState("");
  const [declineNote, setDeclineNote] = useState("");
  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/plan-review/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d || !d.plan) { setNotFound(true); return; }
        setPlan(d.plan);
        setExpired(d.expired || false);
        if (d.plan.clientName) setSignerName(d.plan.clientName);
        if (d.plan.clientTitle) setSignerTitle(d.plan.clientTitle || "");
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  async function submitSign() {
    if (!signatureDataUrl || !signerName) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/public/plan-review/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerName, signerTitle, signatureImage: signatureDataUrl }),
      });
      if (r.ok) setDone("approved");
      else throw new Error("Failed");
    } catch {
      alert("Failed to submit signature. Please try again.");
    } finally { setSubmitting(false); }
  }

  async function submitDecline() {
    if (!declineReason) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/public/plan-review/${token}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReason, note: declineNote }),
      });
      if (r.ok) {
        setDone("declined");
      } else {
        const body = await r.json().catch(() => ({}));
        alert(body?.message || "Failed to submit. Please try again.");
      }
    } catch {
      alert("An unexpected error occurred. Please try again.");
    } finally { setSubmitting(false); }
  }

  async function submitCallRequest() {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/public/plan-review/${token}/request-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (r.ok) {
        setDone("call");
      } else {
        const body = await r.json().catch(() => ({}));
        alert(body?.message || "Failed to submit request. Please try again.");
      }
    } catch {
      alert("An unexpected error occurred. Please try again.");
    } finally { setSubmitting(false); }
  }

  // ─── Done screens ─────────────────────────────────────────────────────────

  if (done === "approved") return (
    <SuccessScreen
      title="Plan Approved!"
      subtitle="Thank you for signing your IT Assessment Plan. Siebert Services will be in touch shortly to begin your onboarding."
      pdfUrl={`/api/public/plan-review/${token}/pdf`}
    />
  );

  if (done === "declined") return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <XCircle className="w-8 h-8 text-gray-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Response Received</h1>
        <p className="text-gray-500 text-sm">Thank you for your feedback. Your Siebert Services representative has been notified and may reach out to discuss further options.</p>
        <p className="text-xs text-gray-400 mt-6">You may now close this page.</p>
      </div>
    </div>
  );

  if (done === "call") return (
    <SuccessScreen
      title="Call Requested"
      subtitle="Your request has been received. A Siebert Services representative will reach out to schedule a call with you shortly."
    />
  );

  // ─── Loading / Error states ────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center">
      <Loader className="w-8 h-8 animate-spin text-white" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Plan Not Found</h1>
        <p className="text-gray-500 text-sm">This link is invalid or has been removed. Please contact your Siebert Services representative.</p>
      </div>
    </div>
  );

  if (!plan) return null;

  if (expired && plan.status !== "approved") return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <Clock className="w-12 h-12 text-orange-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Plan Expired</h1>
        <p className="text-gray-500 text-sm">This IT Assessment Plan has expired. Please contact your Siebert Services representative to request an updated plan.</p>
      </div>
    </div>
  );

  if (plan.status === "approved") return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Already Approved</h1>
        <p className="text-gray-500 text-sm mb-6">This plan was signed by {plan.signerName} on {plan.approvedAt ? format(new Date(plan.approvedAt), "MMMM d, yyyy") : "—"}.</p>
        <a href={`/api/public/plan-review/${token}/pdf`} target="_blank" rel="noopener noreferrer">
          <Button className="gap-2 bg-[#032d60] hover:bg-[#0176d3] text-white w-full">
            <Download className="w-4 h-4" /> Download Signed Plan
          </Button>
        </a>
      </div>
    </div>
  );

  if (plan.status === "declined") return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Plan Declined</h1>
        <p className="text-gray-500 text-sm mb-2">You have already declined this IT Assessment Plan.</p>
        {plan.declineReason && <p className="text-gray-400 text-xs">Reason: {plan.declineReason}</p>}
        <p className="text-gray-500 text-sm mt-4">Your Siebert Services representative will be in touch to discuss next steps or offer a revised plan.</p>
      </div>
    </div>
  );

  if (plan.status === "call_requested") return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <Phone className="w-12 h-12 text-orange-400 mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Call Requested</h1>
        <p className="text-gray-500 text-sm mb-4">You have requested a consultation call. Your Siebert Services representative will reach out to schedule a time with you.</p>
        <p className="text-gray-400 text-xs">To sign or decline the plan after your call, please ask your representative to resend it.</p>
      </div>
    </div>
  );

  // ─── Main Review Page ──────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#032d60] to-[#0176d3] text-white">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-white/70 text-sm font-medium">Siebert Services</p>
              <h1 className="text-xl sm:text-2xl font-bold mt-1">IT Assessment Plan</h1>
              <p className="text-white/80 text-sm mt-1">{plan.clientCompany} · {plan.planNumber}</p>
            </div>
            <a href={`/api/public/plan-review/${token}/pdf`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="border-white/30 text-white hover:bg-white/10 gap-1.5 shrink-0">
                <Download className="w-3.5 h-3.5" /> PDF
              </Button>
            </a>
          </div>
          {plan.expiresAt && (
            <div className="mt-3 flex items-center gap-1.5 text-sm text-white/70">
              <Clock className="w-3.5 h-3.5" />
              Valid until {format(new Date(plan.expiresAt), "MMMM d, yyyy")}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Personal note */}
        {plan.personalNote && (
          <Card className="p-4 border-l-4 border-l-[#0176d3] bg-[#f0f7ff]">
            <p className="text-sm text-gray-700 italic">"{plan.personalNote}"</p>
            <p className="text-xs text-muted-foreground mt-2">— Siebert Services</p>
          </Card>
        )}

        {/* Plan content */}
        <PlanDocument content={plan.planContent} plan={plan} />

        {/* Action Panel */}
        {action === null && (
          <Card className="p-6">
            <h2 className="font-bold text-[#032d60] mb-1">Ready to move forward?</h2>
            <p className="text-sm text-muted-foreground mb-5">Please review the plan above and choose one of the options below.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button onClick={() => setAction("sign")}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-[#032d60] bg-[#032d60]/5 hover:bg-[#032d60]/10 transition-colors group">
                <CheckCircle className="w-7 h-7 text-[#0176d3] group-hover:scale-110 transition-transform" />
                <span className="font-semibold text-[#032d60] text-sm">Sign & Approve</span>
                <span className="text-xs text-muted-foreground text-center">Digitally sign the plan</span>
              </button>
              <button onClick={() => setAction("call")}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-border hover:border-[#0176d3] hover:bg-[#f0f7ff] transition-colors group">
                <Phone className="w-7 h-7 text-[#0176d3] group-hover:scale-110 transition-transform" />
                <span className="font-semibold text-gray-800 text-sm">Request a Call</span>
                <span className="text-xs text-muted-foreground text-center">Talk to us before deciding</span>
              </button>
              <button onClick={() => setAction("decline")}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-border hover:border-red-300 hover:bg-red-50 transition-colors group">
                <XCircle className="w-7 h-7 text-muted-foreground group-hover:text-red-500 group-hover:scale-110 transition-all" />
                <span className="font-semibold text-gray-700 text-sm">Decline</span>
                <span className="text-xs text-muted-foreground text-center">This isn't the right fit</span>
              </button>
            </div>
          </Card>
        )}

        {/* Sign Panel */}
        {action === "sign" && (
          <Card className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#032d60]">Sign & Approve</h2>
              <button onClick={() => setAction(null)} className="text-muted-foreground hover:text-foreground text-sm">← Back</button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Full Name *</Label>
                <Input value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Your full name" />
              </div>
              <div>
                <Label className="text-xs">Title / Role</Label>
                <Input value={signerTitle} onChange={e => setSignerTitle(e.target.value)} placeholder="e.g., CEO" />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Signature *</Label>
              <SignaturePanel
                onSignature={(url) => setSignatureDataUrl(url)}
                onClear={() => setSignatureDataUrl(null)}
              />
            </div>
            {signatureDataUrl && (
              <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                <p className="text-xs text-green-700">Signature captured. Click below to finalize your approval.</p>
              </div>
            )}
            <div className="pt-1">
              <Button onClick={submitSign} disabled={!signatureDataUrl || !signerName || submitting}
                className="w-full bg-[#032d60] hover:bg-[#0176d3] text-white gap-2">
                {submitting ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {submitting ? "Submitting…" : "Confirm & Sign Plan"}
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-2">
                By clicking "Confirm & Sign Plan", you agree to the terms of the IT Assessment Plan and authorize Siebert Services to proceed.
              </p>
            </div>
          </Card>
        )}

        {/* Call Panel */}
        {action === "call" && (
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#032d60]">Request a Call</h2>
              <button onClick={() => setAction(null)} className="text-muted-foreground hover:text-foreground text-sm">← Back</button>
            </div>
            <p className="text-sm text-gray-600">Our team will reach out to schedule a call with you to discuss the plan. No commitment required.</p>
            <Button onClick={submitCallRequest} disabled={submitting} className="w-full bg-[#0176d3] hover:bg-[#015fa3] text-white gap-2">
              {submitting ? <Loader className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
              {submitting ? "Sending…" : "Request a Call"}
            </Button>
          </Card>
        )}

        {/* Decline Panel */}
        {action === "decline" && (
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#032d60]">Decline Plan</h2>
              <button onClick={() => setAction(null)} className="text-muted-foreground hover:text-foreground text-sm">← Back</button>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Reason *</Label>
              <div className="space-y-2">
                {DECLINE_REASONS.map(r => (
                  <label key={r} className={cn("flex items-center gap-2 px-3 py-2.5 rounded border cursor-pointer transition-colors text-sm",
                    declineReason === r ? "border-[#0176d3] bg-[#f0f7ff]" : "border-border hover:border-muted-foreground")}>
                    <input type="radio" name="decline" value={r} checked={declineReason === r} onChange={() => setDeclineReason(r)} className="accent-[#0176d3]" />
                    {r}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Additional Note <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea value={declineNote} onChange={e => setDeclineNote(e.target.value)}
                placeholder="Anything you'd like us to know..." rows={3} />
            </div>
            <Button onClick={submitDecline} disabled={!declineReason || submitting}
              className="w-full bg-red-600 hover:bg-red-700 text-white gap-2">
              {submitting ? <Loader className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              {submitting ? "Submitting…" : "Submit Decline"}
            </Button>
          </Card>
        )}
      </div>

      <footer className="text-center py-8 text-xs text-gray-400 border-t mt-8">
        Siebert Services LLC · 866-484-9180 · siebertrservices.com
      </footer>
    </div>
  );
}
