import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { format } from "date-fns";
import {
  Shield, CheckCircle, XCircle, Download, Loader, Clock,
  AlertCircle, Phone, FileText, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SignaturePanel } from "@/components/SignaturePanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Envelope {
  id: number;
  status: string;
  documentName: string;
  documentFilename: string;
  subject: string | null;
  message: string | null;
  signers: { name: string; email: string; role?: string }[];
  sentAt: string;
  completedAt: string | null;
  signerName: string | null;
}

const DECLINE_REASONS = [
  "Budget constraints",
  "Timing isn't right",
  "Need to review with my team",
  "Terms need to be revised",
  "Choosing a different provider",
  "Other",
];

// ─── Confirmation Screens ─────────────────────────────────────────────────────

function SuccessScreen({ documentName, token }: { documentName: string; token: string }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Document Signed!</h1>
        <p className="text-gray-500 text-sm mb-6">
          Thank you for signing <strong>{documentName}</strong>. Siebert Services has been notified and
          will be in touch shortly.
        </p>
        <a href={`/api/public/esign/${token}/certificate`} target="_blank" rel="noopener noreferrer">
          <Button className="gap-2 bg-[#032d60] hover:bg-[#0176d3] text-white w-full">
            <Download className="w-4 h-4" /> Download Signature Certificate
          </Button>
        </a>
        <p className="text-xs text-gray-400 mt-6">You may now close this page.</p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EsignReview() {
  const [, params] = useRoute("/esign/:token");
  const token = params?.token ?? "";

  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [action, setAction] = useState<"sign" | "decline" | null>(null);
  const [done, setDone] = useState<"signed" | "declined" | null>(null);

  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [declineReason, setDeclineReason] = useState("");
  const [declineNote, setDeclineNote] = useState("");

  const [pdfExpanded, setPdfExpanded] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/esign/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d || !d.envelope) { setNotFound(true); return; }
        setEnvelope(d.envelope);
        setFileBase64(d.fileBase64 || null);
        if (d.envelope.signers?.[0]?.name) setSignerName(d.envelope.signers[0].name);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  async function submitSign() {
    if (!signatureDataUrl || !signerName) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/public/esign/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerName, signerTitle, signatureImage: signatureDataUrl }),
      });
      if (r.ok) setDone("signed");
      else {
        const body = await r.json().catch(() => ({}));
        alert(body?.message || "Failed to submit. Please try again.");
      }
    } catch {
      alert("Failed to submit signature. Please try again.");
    } finally { setSubmitting(false); }
  }

  async function submitDecline() {
    if (!declineReason) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/public/esign/${token}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReason, note: declineNote }),
      });
      if (r.ok) setDone("declined");
      else {
        const body = await r.json().catch(() => ({}));
        alert(body?.message || "Failed to submit. Please try again.");
      }
    } catch {
      alert("An unexpected error occurred. Please try again.");
    } finally { setSubmitting(false); }
  }

  // ─── Terminal states ─────────────────────────────────────────────────────

  if (done === "signed") return <SuccessScreen documentName={envelope?.documentName ?? "Document"} token={token} />;

  if (done === "declined") return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <XCircle className="w-8 h-8 text-gray-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Response Received</h1>
        <p className="text-gray-500 text-sm">Thank you. Your Siebert Services representative has been notified and may reach out to discuss further options.</p>
        <p className="text-xs text-gray-400 mt-6">You may now close this page.</p>
      </div>
    </div>
  );

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center">
      <Loader className="w-8 h-8 animate-spin text-white" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Link Not Found</h1>
        <p className="text-gray-500 text-sm">This signing link is invalid or has been removed. Please contact your Siebert Services representative.</p>
      </div>
    </div>
  );

  if (!envelope) return null;

  if (envelope.status === "completed") return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Already Signed</h1>
        <p className="text-gray-500 text-sm mb-6">
          This document was signed by <strong>{envelope.signerName}</strong> on{" "}
          {envelope.completedAt ? format(new Date(envelope.completedAt), "MMMM d, yyyy") : "—"}.
        </p>
        <a href={`/api/public/esign/${token}/certificate`} target="_blank" rel="noopener noreferrer">
          <Button className="gap-2 bg-[#032d60] hover:bg-[#0176d3] text-white w-full">
            <Download className="w-4 h-4" /> Download Certificate
          </Button>
        </a>
      </div>
    </div>
  );

  if (envelope.status === "declined") return (
    <div className="min-h-screen bg-gradient-to-br from-[#032d60] to-[#0176d3] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
        <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">Document Declined</h1>
        <p className="text-gray-500 text-sm">You have already declined this document. Your Siebert Services representative will be in touch to discuss next steps.</p>
      </div>
    </div>
  );

  // ─── Main Signing Page ────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#032d60] to-[#0176d3] text-white">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-white/70" />
            <span className="text-white/70 text-sm font-medium">Siebert Services · Secure Document Signing</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold">{envelope.documentName}</h1>
          <div className="flex items-center gap-3 mt-2 text-white/70 text-sm">
            <Clock className="w-3.5 h-3.5" />
            Sent {format(new Date(envelope.sentAt), "MMMM d, yyyy")}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Personal message */}
        {envelope.message && (
          <div className="p-4 border-l-4 border-l-[#0176d3] bg-[#f0f7ff] rounded-r-lg">
            <p className="text-sm text-gray-700 italic">"{envelope.message}"</p>
            <p className="text-xs text-muted-foreground mt-2">— Siebert Services</p>
          </div>
        )}

        {/* Document Preview */}
        {fileBase64 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <button
              onClick={() => setPdfExpanded(!pdfExpanded)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#0176d3]" />
                <span className="font-semibold text-[#032d60] text-sm">View Document</span>
              </div>
              {pdfExpanded
                ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {pdfExpanded && (
              <div className="border-t">
                <iframe
                  src={`data:application/pdf;base64,${fileBase64}`}
                  className="w-full"
                  style={{ height: "600px" }}
                  title="Document to sign"
                />
              </div>
            )}
          </div>
        )}

        {/* Action Panel */}
        {action === null && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h2 className="font-bold text-[#032d60] mb-1">Ready to proceed?</h2>
            <p className="text-sm text-muted-foreground mb-5">Please review the document above and choose an option below.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setAction("sign")}
                className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-[#032d60] bg-[#032d60]/5 hover:bg-[#032d60]/10 transition-colors group"
              >
                <CheckCircle className="w-7 h-7 text-[#0176d3] group-hover:scale-110 transition-transform" />
                <span className="font-semibold text-[#032d60] text-sm">Sign Document</span>
                <span className="text-xs text-muted-foreground text-center">Digitally sign with your name</span>
              </button>
              <button
                onClick={() => setAction("decline")}
                className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-border hover:border-red-300 hover:bg-red-50 transition-colors group"
              >
                <XCircle className="w-7 h-7 text-muted-foreground group-hover:text-red-500 group-hover:scale-110 transition-all" />
                <span className="font-semibold text-gray-700 text-sm">Decline</span>
                <span className="text-xs text-muted-foreground text-center">I don't want to sign this</span>
              </button>
            </div>
          </div>
        )}

        {/* Sign Panel */}
        {action === "sign" && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#032d60]">Sign Document</h2>
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
                <p className="text-xs text-green-700">Signature captured. Click below to submit.</p>
              </div>
            )}
            <div className="pt-1">
              <Button
                onClick={submitSign}
                disabled={!signatureDataUrl || !signerName || submitting}
                className="w-full bg-[#032d60] hover:bg-[#0176d3] text-white gap-2"
              >
                {submitting ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {submitting ? "Submitting…" : "Confirm & Sign Document"}
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-2">
                By clicking "Confirm & Sign Document" you agree to the terms set forth and consent to electronic signature.
              </p>
            </div>
          </div>
        )}

        {/* Decline Panel */}
        {action === "decline" && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#032d60]">Decline Document</h2>
              <button onClick={() => setAction(null)} className="text-muted-foreground hover:text-foreground text-sm">← Back</button>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Reason *</Label>
              <div className="space-y-2">
                {DECLINE_REASONS.map(r => (
                  <label key={r} className={cn(
                    "flex items-center gap-2 px-3 py-2.5 rounded border cursor-pointer transition-colors text-sm",
                    declineReason === r ? "border-[#0176d3] bg-[#f0f7ff]" : "border-border hover:border-muted-foreground"
                  )}>
                    <input type="radio" name="decline" value={r} checked={declineReason === r}
                      onChange={() => setDeclineReason(r)} className="accent-[#0176d3]" />
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
          </div>
        )}
      </div>

      <footer className="text-center py-8 text-xs text-gray-400 border-t mt-8">
        Siebert Services LLC · 866-484-9180 · siebertrservices.com · Secure Built-in E-Sign
      </footer>
    </div>
  );
}
