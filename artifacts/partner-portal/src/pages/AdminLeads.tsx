import React, { useState } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useLeads, useSubmitLead } from "@/hooks/use-leads";
import { Plus, Loader2, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { ConvertLeadDialog } from "./admin/crm/ConvertLeadDialog";

const LEAD_INTEREST_OPTIONS = [
  "Connectivity (Internet/MPLS)",
  "Voice & UCaaS",
  "Cloud & Hosting",
  "Security",
  "Contact Center",
  "SD-WAN & Networking",
  "Data Center",
  "Mobility & IoT",
  "Collaboration",
  "Managed IT",
  "Expense Management",
  "CPaaS & Messaging",
  "Other",
];

export default function AdminLeads() {
  const { toast } = useToast();
  const { data: leads = [], isLoading } = useLeads();
  const { mutateAsync: submitLead, isPending: isSubmitting } = useSubmitLead();
  
  const [createOpen, setCreateOpen] = useState(false);
  const [convertId, setConvertId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    companyName: "",
    contactName: "",
    email: "",
    phone: "",
    interest: "",
    notes: "",
  });
  const [submitError, setSubmitError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");
    
    if (!formData.companyName || !formData.contactName || !formData.interest) {
      setSubmitError("Company Name, Contact Name, and Interest are required.");
      return;
    }

    try {
      await submitLead(formData);
      setFormData({
        companyName: "",
        contactName: "",
        email: "",
        phone: "",
        interest: "",
        notes: "",
      });
      setCreateOpen(false);
      toast({
        title: "Lead Created",
        description: "New lead has been added to your list.",
      });
    } catch (err: any) {
      setSubmitError(err.message || "Failed to create lead. Please try again.");
    }
  };

  // CRM-shell leads view: any authenticated portal user (admin or partner)
  // can land here. Backend scopes results — partner endpoints already filter
  // by partnerId, and the convert flow checks per-record write access.
  return (
    <PortalLayout>
      <div className="sf-page-header px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-foreground">Manage Leads</h1>
            <span className="text-xs text-muted-foreground">{leads.length} items</span>
          </div>
          <button onClick={() => setCreateOpen(true)} className="sf-btn sf-btn-primary">
            <Plus className="w-3.5 h-3.5" /> Submit New Lead
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : leads.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">No leads yet. Create your first lead to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Recent Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {leads.map((lead: any) => (
                  <div key={lead.id} className="p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold">{lead.companyName}</p>
                        <p className="text-sm text-muted-foreground">{lead.contactName}</p>
                        {lead.email && <p className="text-xs text-muted-foreground">{lead.email}</p>}
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">
                            {lead.interest}
                          </span>
                          <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded capitalize">
                            {lead.status}
                          </span>
                        </div>
                      </div>
                      <div className="text-right space-y-2">
                        <p className="text-xs text-muted-foreground">
                          {lead.assignedAt ? format(new Date(lead.assignedAt), "MMM d, yyyy") : "—"}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => setConvertId(lead.id)}>
                          Convert
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {convertId != null && (
        <ConvertLeadDialog leadId={convertId} open={convertId != null} onOpenChange={(v) => { if (!v) setConvertId(null); }} />
      )}

      {/* Submit Lead Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit a Lead</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {submitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
                {submitError}
              </div>
            )}

            <div>
              <Label htmlFor="companyName">Company Name *</Label>
              <Input
                id="companyName"
                placeholder="Prospect company name"
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                required
              />
            </div>

            <div>
              <Label htmlFor="contactName">Contact Name *</Label>
              <Input
                id="contactName"
                placeholder="Contact person name"
                value={formData.contactName}
                onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="contact@company.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="interest">Interest / Solution *</Label>
              <select
                id="interest"
                value={formData.interest}
                onChange={(e) => setFormData({ ...formData, interest: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm"
                required
              >
                <option value="">Select an interest...</option>
                {LEAD_INTEREST_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Any additional context about this lead..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="min-h-24"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                variant="default"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Lead"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
