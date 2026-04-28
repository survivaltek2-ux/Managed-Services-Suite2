import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "./use-auth";

// Admin/CRM users hit /admin/crm/leads (admins see all, others see owned +
// shared via the share table). Partner users hit /partner/leads (scoped to
// their partnerId). Splitting at the hook keeps the call sites unchanged.
function leadsEndpoint(isAdminCrm: boolean): string {
  return isAdminCrm ? "/api/admin/crm/leads" : "/api/partner/leads";
}

export interface Lead {
  id: number;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  interest: string;
  status: "new" | "contacted" | "qualified" | "converted" | "lost";
  assignedAt: string;
}

export interface SubmitLeadData {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  interest: string;
  notes: string;
}

export function useLeads() {
  const { user } = useAuth();
  // /admin/crm/leads expects the main-site admin/client JWT. Partner-admin
  // users keep using their partner-scoped endpoint to avoid auth mismatches.
  const isAdminCrm = !!user?.isMainSiteAdmin;
  const url = leadsEndpoint(isAdminCrm);
  return useQuery<Lead[]>({
    queryKey: [url],
    queryFn: async () => {
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json();
    },
  });
}

export function useUpdateLeadStatus() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Mirror useLeads(): admin sessions write through /admin/crm/*; partner
  // sessions stay on /partner/* (which scopes by partnerId).
  const isAdminCrm = !!user?.isMainSiteAdmin;
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const url = isAdminCrm ? `/api/admin/crm/leads/${id}` : `/api/partner/leads/${id}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [leadsEndpoint(isAdminCrm)] });
    },
  });
}

export function useSubmitLead() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // POST /partner/leads explicitly 403s admin tokens (it requires a partnerId);
  // admin sessions write through /admin/crm/leads instead.
  const isAdminCrm = !!user?.isMainSiteAdmin;
  return useMutation({
    mutationFn: async (data: SubmitLeadData) => {
      const url = leadsEndpoint(isAdminCrm);
      const res = await fetch(url, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to submit lead");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [leadsEndpoint(isAdminCrm)] });
    },
  });
}
