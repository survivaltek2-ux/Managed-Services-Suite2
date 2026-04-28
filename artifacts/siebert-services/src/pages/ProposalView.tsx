import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { Loader2, CheckCircle, XCircle, FileText, Clock, Building, Mail, Phone, Calendar } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Badge, Input, Label } from "@/components/ui";

export default function ProposalView() {
  const [, params] = useRoute("/proposal/:token");
  const [proposal, setProposal] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [responding, setResponding] = useState(false);
  const [signature, setSignature] = useState("");
  const [responded, setResponded] = useState(false);

  useEffect(() => {
    if (params?.token) fetchProposal(params.token);
  }, [params?.token]);

  const fetchProposal = async (token: string) => {
    try {
      const res = await fetch(`/api/proposals/${token}`);
      if (res.ok) setProposal(await res.json());
      else setError("Proposal not found or is no longer available.");
    } catch {
      setError("Unable to load proposal.");
    } finally {
      setLoading(false);
    }
  };

  const handleRespond = async (action: "accepted" | "rejected") => {
    if (action === "accepted" && !signature.trim()) return;
    setResponding(true);
    try {
      const res = await fetch(`/api/proposals/${params?.token}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, signature: signature || undefined }),
      });
      if (res.ok) {
        setResponded(true);
        setProposal((p: any) => ({ ...p, status: action }));
      }
    } catch { /* silent */ }
    finally { setResponding(false); }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full text-center">
        <CardContent className="p-8">
          <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Proposal Not Found</h2>
          <p className="text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    </div>
  );

  if (!proposal) return null;

  const isExpired = proposal.validUntil && new Date(proposal.validUntil) < new Date();
  const canRespond = !["accepted", "rejected", "expired"].includes(proposal.status) && !isExpired && !responded;

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-5 h-5 text-primary" />
              <span className="text-sm font-mono text-muted-foreground">{proposal.proposalNumber}</span>
            </div>
            <h1 className="text-2xl font-bold text-navy">{proposal.title}</h1>
            {proposal.summary && <p className="text-muted-foreground mt-2 max-w-2xl">{proposal.summary}</p>}
          </div>
          <Badge variant={
            proposal.status === "accepted" ? "default" :
            proposal.status === "rejected" || proposal.status === "expired" ? "destructive" :
            "secondary"
          } className="text-sm">
            {isExpired ? "Expired" : proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2"><Building className="w-4 h-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">Prepared For</span></div>
              <p className="font-medium">{proposal.clientName}</p>
              <p className="text-sm text-muted-foreground">{proposal.clientCompany}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2"><Mail className="w-4 h-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">Contact</span></div>
              <p className="text-sm">{proposal.clientEmail}</p>
              {proposal.clientPhone && <p className="text-sm">{proposal.clientPhone}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2"><Calendar className="w-4 h-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">Valid Until</span></div>
              <p className={`font-medium ${isExpired ? "text-destructive" : ""}`}>
                {proposal.validUntil ? new Date(proposal.validUntil).toLocaleDateString() : "No expiration"}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Line Items</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="px-5 py-3 text-left">Item</th>
                  <th className="px-5 py-3 text-center">Qty</th>
                  <th className="px-5 py-3 text-right">Unit Price</th>
                  <th className="px-5 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(proposal.lineItems || []).map((item: any) => (
                  <tr key={item.id} className="border-b">
                    <td className="px-5 py-3">
                      <p className="font-medium">{item.name}</p>
                      {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                      {item.recurring && <Badge variant="outline" className="text-[10px] mt-1">{item.recurringInterval || "Recurring"}</Badge>}
                    </td>
                    <td className="px-5 py-3 text-center">{item.quantity} {item.unit}</td>
                    <td className="px-5 py-3 text-right">${parseFloat(item.unitPrice).toFixed(2)}</td>
                    <td className="px-5 py-3 text-right font-medium">${parseFloat(item.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t px-5 py-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${parseFloat(proposal.subtotal).toFixed(2)}</span>
              </div>
              {parseFloat(proposal.discount) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="text-emerald-600">-${parseFloat(proposal.discount).toFixed(2)}</span>
                </div>
              )}
              {parseFloat(proposal.tax) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span>${parseFloat(proposal.tax).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold pt-2 border-t">
                <span>Total</span>
                <span className="text-primary">${parseFloat(proposal.total).toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {proposal.terms && (
          <Card>
            <CardHeader><CardTitle className="text-base">Terms & Conditions</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground whitespace-pre-line">{proposal.terms}</p></CardContent>
          </Card>
        )}

        {proposal.status === "accepted" && (
          <Card className="border-emerald-200 bg-emerald-50/50">
            <CardContent className="p-6 text-center">
              <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-emerald-700">Proposal Accepted</h3>
              <p className="text-sm text-emerald-600">
                Accepted on {proposal.respondedAt ? new Date(proposal.respondedAt).toLocaleDateString() : "N/A"}
              </p>
              {proposal.clientSignature && <p className="text-sm text-emerald-600 mt-1">Signed by: {proposal.clientSignature}</p>}
            </CardContent>
          </Card>
        )}

        {proposal.status === "rejected" && (
          <Card className="border-red-200 bg-red-50/50">
            <CardContent className="p-6 text-center">
              <XCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-red-700">Proposal Declined</h3>
            </CardContent>
          </Card>
        )}

        {canRespond && (
          <Card>
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4">Respond to this Proposal</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Your Name (Signature)</Label>
                  <Input value={signature} onChange={e => setSignature(e.target.value)} placeholder="Type your full name to sign" />
                </div>
                <div className="flex gap-3">
                  <Button onClick={() => handleRespond("accepted")} disabled={responding || !signature.trim()} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                    {responding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                    Accept Proposal
                  </Button>
                  <Button variant="outline" onClick={() => handleRespond("rejected")} disabled={responding} className="flex-1 border-red-200 text-red-600 hover:bg-red-50">
                    <XCircle className="w-4 h-4 mr-2" />Decline
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="text-center py-4">
          <p className="text-xs text-muted-foreground">Siebert Repair Services LLC DBA Siebert Services</p>
        </div>
      </div>
    </div>
  );
}
