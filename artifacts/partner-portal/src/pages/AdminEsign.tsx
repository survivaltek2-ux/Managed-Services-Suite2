import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearch } from "wouter";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  FileSignature, RefreshCw, Loader2, ChevronDown, ChevronUp,
  CheckCircle2, Clock, Eye, XCircle, AlertTriangle, Download, Info,
  Send, Copy, Check,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/Badge";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.FC<any> }> = {
  sent:      { label: "Sent",      color: "bg-blue-100 text-blue-800",   icon: Clock },
  viewed:    { label: "Viewed",    color: "bg-yellow-100 text-yellow-800", icon: Eye },
  signed:    { label: "Signed",    color: "bg-indigo-100 text-indigo-800", icon: CheckCircle2 },
  completed: { label: "Completed", color: "bg-green-100 text-green-800", icon: CheckCircle2 },
  declined:  { label: "Declined",  color: "bg-red-100 text-red-800",    icon: XCircle },
  expired:   { label: "Expired",   color: "bg-gray-100 text-gray-600",  icon: AlertTriangle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: "bg-gray-100 text-gray-600", icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

export default function AdminEsign() {
  const { user } = useAuth();
  const { toast } = useToast();
  const headers = getAuthHeaders();

  const [envelopes, setEnvelopes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const [resending, setResending] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [providerStatus, setProviderStatus] = useState<any>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);

  // Auto-expand a specific envelope when arriving via ?envelope=<id> link
  // (e.g. clicking the status badge in the Admin Documents list).
  const search = useSearch();
  const targetEnvelopeId = useMemo(() => {
    const p = new URLSearchParams(search);
    const v = p.get("envelope");
    return v ? parseInt(v, 10) : null;
  }, [search]);

  const load = async () => {
    setLoading(true);
    try {
      const [envRes, statusRes] = await Promise.all([
        fetch("/api/admin/esign/envelopes", { headers }),
        fetch("/api/admin/esign/status", { headers }),
      ]);
      if (envRes.ok) setEnvelopes(await envRes.json());
      if (statusRes.ok) setProviderStatus(await statusRes.json());
    } catch {
      toast({ title: "Failed to load envelopes", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // When envelopes load and a target ID is in the URL, expand and scroll to it.
  useEffect(() => {
    if (!loading && targetEnvelopeId !== null) {
      setExpanded(targetEnvelopeId);
      // Defer scroll so the DOM has rendered the expanded row.
      setTimeout(() => {
        targetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [loading, targetEnvelopeId]);

  const handleResend = async (id: number) => {
    setResending(id);
    try {
      const res = await fetch(`/api/admin/esign/envelopes/${id}/resend`, { method: "POST", headers });
      if (res.ok) {
        toast({ title: "Invitation resent to all signers" });
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.message || "Resend failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Resend failed", variant: "destructive" });
    } finally {
      setResending(null);
    }
  };

  const handleRefresh = async (id: number) => {
    setRefreshing(id);
    try {
      const res = await fetch(`/api/admin/esign/envelopes/${id}/refresh`, { method: "POST", headers });
      if (res.ok) {
        toast({ title: "Status refreshed" });
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.message || "Refresh failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Refresh failed", variant: "destructive" });
    } finally {
      setRefreshing(null);
    }
  };

  const handleDownloadExecuted = async (envelopeId: number, executedDocumentId: number) => {
    try {
      const res = await fetch(`/api/admin/documents/${executedDocumentId}/download`, { headers });
      if (!res.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
      const { content, filename, mimeType } = await res.json();
      const bytes = atob(content);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  };

  if (!user?.isAdmin) {
    return (
      <PortalLayout>
        <div className="px-6 py-12 text-center">
          <p className="text-muted-foreground">Access denied. Admin privileges required.</p>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="px-6 py-4">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="mb-2">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileSignature className="w-6 h-6 text-[#0176d3]" />
              E-Signature Envelopes
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Track documents sent for digital signature via the built-in signing system
            </p>
          </div>

          {/* How it works card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Info className="w-4 h-4 text-muted-foreground" /> How built-in e-sign works
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1.5">
              <ol className="list-decimal list-inside space-y-1">
                <li>Open <strong>Admin → Documents</strong>, find a document, and click <strong>Send for Signature</strong>.</li>
                <li>Enter the signer's name and email address. A unique, secure signing link is generated.</li>
                <li>The signer receives an email with a link to review and sign online — no account required.</li>
                <li>After signing, a <strong>Signature Certificate PDF</strong> is generated and stored in Documents.</li>
                <li>You receive an email notification and can download the certificate from this page.</li>
                <li>Use <strong>Resend</strong> to send the signing link again if the signer didn't receive it.</li>
              </ol>
            </CardContent>
          </Card>

          {/* Envelope list */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">All Envelopes</CardTitle>
                <Button size="sm" variant="outline" onClick={load} disabled={loading}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : envelopes.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <FileSignature className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No envelopes sent yet.</p>
                  <p className="text-xs mt-1">Go to Documents and click "Send for Signature" on any document.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {envelopes.map((env: any) => (
                    <div key={env.id} ref={env.id === targetEnvelopeId ? targetRef : undefined}>
                      <EnvelopeRow
                        envelope={env}
                        expanded={expanded === env.id}
                        onToggle={() => setExpanded(prev => prev === env.id ? null : env.id)}
                        onRefresh={() => handleRefresh(env.id)}
                        refreshing={refreshing === env.id}
                        onResend={() => handleResend(env.id)}
                        resending={resending === env.id}
                        onDownload={env.executed_document_id
                          ? () => handleDownloadExecuted(env.id, env.executed_document_id)
                          : undefined}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  );
}

function EnvelopeRow({
  envelope,
  expanded,
  onToggle,
  onRefresh,
  refreshing,
  onResend,
  resending,
  onDownload,
}: {
  envelope: any;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onResend: () => void;
  resending: boolean;
  onDownload?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const signers: any[] = Array.isArray(envelope.signers) ? envelope.signers : [];
  const events: any[] = Array.isArray(envelope.events) ? envelope.events : [];

  const baseUrl = window.location.origin;
  const signingUrl = envelope.review_token
    ? `${baseUrl}/esign/${envelope.review_token}`
    : null;

  const copyLink = () => {
    if (!signingUrl) return;
    navigator.clipboard.writeText(signingUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const timeline = buildTimeline(envelope, events);

  return (
    <div className="hover:bg-muted/30 transition-colors">
      <div
        className="flex items-center gap-3 px-5 py-3 cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{envelope.document_name}</span>
            <StatusBadge status={envelope.status} />
            {envelope.partner_company && (
              <span className="text-xs text-muted-foreground">— {envelope.partner_company}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {signers.map((s: any) => s.name).join(", ")}
            {" · "}
            Sent {new Date(envelope.sent_at || envelope.created_at).toLocaleDateString()}
            {envelope.initiated_by_name && ` by ${envelope.initiated_by_name}`}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {signingUrl && (envelope.status === "sent" || envelope.status === "viewed") && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1"
              onClick={e => { e.stopPropagation(); copyLink(); }}
              title="Copy signing link"
            >
              {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied!" : "Copy Link"}
            </Button>
          )}
          {(envelope.status === "sent" || envelope.status === "viewed") && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1"
              onClick={e => { e.stopPropagation(); onResend(); }}
              disabled={resending}
              title="Resend invitation email"
            >
              {resending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Resend
            </Button>
          )}
          {onDownload && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1"
              onClick={e => { e.stopPropagation(); onDownload(); }}
            >
              <Download className="w-3 h-3" /> Certificate
            </Button>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-4 bg-muted/20 border-t text-sm space-y-4">
          {/* Signers */}
          <div className="pt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Signers</p>
            <div className="space-y-1.5">
              {signers.map((s: any, i: number) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#0176d3]/10 text-[#0176d3] text-xs flex items-center justify-center font-semibold">
                    {s.signingOrder || i + 1}
                  </span>
                  <span className="font-medium">{s.name}</span>
                  <span className="text-muted-foreground">&lt;{s.email}&gt;</span>
                  {s.role && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{s.role}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Timeline</p>
            <div className="relative pl-4 space-y-2 border-l-2 border-muted ml-2">
              {timeline.map((ev: any, i: number) => {
                const Icon = STATUS_CONFIG[ev.status]?.icon || Clock;
                return (
                  <div key={i} className="flex items-start gap-2 text-xs relative">
                    <div className="absolute -left-[17px] top-0.5 w-3 h-3 rounded-full bg-white border-2 border-[#0176d3] flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#0176d3]" />
                    </div>
                    <div>
                      <span className="font-medium">{ev.label}</span>
                      {ev.name && <span className="text-muted-foreground"> — {ev.name}</span>}
                      <span className="ml-2 text-muted-foreground">
                        {new Date(ev.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
              {timeline.length === 0 && (
                <div className="text-xs text-muted-foreground">No events recorded yet.</div>
              )}
            </div>
          </div>

          {/* Subject / Message */}
          {envelope.subject && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Subject</p>
              <p className="text-sm">{envelope.subject}</p>
            </div>
          )}
          {envelope.message && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Message to signers</p>
              <p className="text-sm text-muted-foreground">{envelope.message}</p>
            </div>
          )}

          {envelope.review_token && (
            <div className="text-xs text-muted-foreground">
              Signing link:{" "}
              <a
                href={`${window.location.origin}/esign/${envelope.review_token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#0176d3] hover:underline break-all"
              >
                {window.location.origin}/esign/{envelope.review_token}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function buildTimeline(envelope: any, events: any[]) {
  const timeline: any[] = [];

  if (envelope.sent_at || envelope.created_at) {
    timeline.push({
      status: "sent",
      label: "Sent for signature",
      timestamp: envelope.sent_at || envelope.created_at,
    });
  }

  for (const ev of events) {
    const labelMap: Record<string, string> = {
      document_viewed: "Viewed",
      document_signed: "Signed",
      document_completed: "Completed",
      document_declined: "Declined",
      document_expired: "Expired",
    };
    if (labelMap[ev.type]) {
      timeline.push({
        status: ev.type.replace("document_", ""),
        label: labelMap[ev.type],
        name: ev.recipientName || undefined,
        timestamp: ev.timestamp,
      });
    }
  }

  if (envelope.completed_at && !timeline.find(e => e.status === "completed")) {
    timeline.push({
      status: "completed",
      label: "Completed",
      timestamp: envelope.completed_at,
    });
  }

  return timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
