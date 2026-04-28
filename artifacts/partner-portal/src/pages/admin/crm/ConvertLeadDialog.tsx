import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { crmFetch, fmtCurrency } from "./lib";

export function ConvertLeadDialog({ leadId, open, onOpenChange }: { leadId: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [, setLocation] = useLocation();
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("");

  const mut = useMutation({
    mutationFn: () => crmFetch<{ contactId: number; companyId: number | null; dealId: number }>(`/admin/crm/leads/${leadId}/convert`, {
      method: "POST",
      body: JSON.stringify({ dealTitle: dealTitle || undefined, dealValue: dealValue ? Number(dealValue) : undefined }),
    }),
    onSuccess: (r) => {
      onOpenChange(false);
      if (r.contactId) setLocation(`/admin/crm/contacts/${r.contactId}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Convert Lead</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This creates a CRM contact, attaches the company, and opens a deal — all in one step.
          </p>
          <Input placeholder="Deal title (optional)" value={dealTitle} onChange={(e) => setDealTitle(e.target.value)} />
          <Input type="number" placeholder="Deal value (USD, optional)" value={dealValue} onChange={(e) => setDealValue(e.target.value)} />
          {mut.isError && <div className="text-sm text-red-600">{String((mut.error as Error)?.message || "Failed to convert")}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? "Converting…" : "Convert"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
