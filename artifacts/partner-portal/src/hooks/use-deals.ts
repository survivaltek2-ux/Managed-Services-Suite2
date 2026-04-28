import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "./use-auth";

export interface VendorProduct {
  name: string;
  category: string;
  description?: string;
}

export interface Vendor {
  id: number;
  externalId: string;
  name: string;
  accountType: string | null;
  industry: string | null;
  website: string | null;
  partnerType: string | null;
  isActive: boolean;
  products: VendorProduct[];
}

export interface VendorSelection {
  vendorId: string;
  vendorName: string;
  services: string[];
}

export interface TsdSyncLog {
  id: number;
  dealId: number;
  tsdId: string;
  status: "pending" | "success" | "failed";
  errorMessage: string | null;
  payload: string | null;
  createdAt: string;
}

export interface TsdMatch {
  id: string;
  label: string;
}

export interface Deal {
  id: number;
  title: string;
  customerName: string;
  customerEmail: string;
  products: string[];
  vendorSelections: VendorSelection[];
  estimatedValue: string | number;
  status: "registered" | "in_progress" | "won" | "lost" | "expired";
  /** Legacy enum stage. Kept for back-compat / list badges; pipeline-driven
   *  Kanban uses `pipelineStageId` as the canonical position. */
  stage: "prospect" | "qualification" | "proposal" | "negotiation" | "closed_won" | "closed_lost";
  /** ID into crm_pipeline_stages — canonical Kanban position when a pipeline
   *  is selected. Null for deals not yet placed on any custom pipeline. */
  pipelineStageId: number | null;
  tsdTargets: string[];
  createdAt: string;
}

export function useVendors() {
  return useQuery<Vendor[]>({
    queryKey: ["/api/partner/vendors"],
    queryFn: async () => {
      const res = await fetch("/api/partner/vendors", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch vendors");
      const data = await res.json();
      return data;
    },
    staleTime: 0,
    gcTime: 1000 * 60 * 5,
  });
}

export function useDeals() {
  const { user } = useAuth();
  // Only main-site admin sessions can talk to /admin/crm/* — that endpoint
  // expects the admin/client JWT shape. Partner-admin sessions still ride
  // their partner-scoped /partner/deals route to avoid 401/403 mismatches.
  const isAdminCrm = !!user?.isMainSiteAdmin;
  const url = isAdminCrm ? "/api/admin/crm/deals" : "/api/partner/deals";
  return useQuery<Deal[]>({
    queryKey: [url],
    queryFn: async () => {
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch deals");
      return res.json();
    },
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // POST /partner/deals explicitly 403s admin tokens (it requires a partnerId);
  // admin sessions write through /admin/crm/deals instead. Mirrors useDeals().
  const isAdminCrm = !!user?.isMainSiteAdmin;
  const url = isAdminCrm ? "/api/admin/crm/deals" : "/api/partner/deals";
  return useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await fetch(url, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create deal");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [url] });
    },
  });
}

export function useResolveTsdMatches() {
  return useMutation({
    mutationFn: async (products: string[]): Promise<{ matches: TsdMatch[] }> => {
      const res = await fetch("/api/partner/deals/tsd-matches", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ products }),
      });
      if (!res.ok) throw new Error("Failed to resolve TSD matches");
      return res.json();
    },
  });
}

export function useDealTsdLogs(dealId: number | null) {
  return useQuery<TsdSyncLog[]>({
    queryKey: ["/api/partner/deals", dealId, "tsd-logs"],
    queryFn: async () => {
      if (!dealId) return [];
      const res = await fetch(`/api/partner/deals/${dealId}/tsd-logs`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch TSD logs");
      return res.json();
    },
    enabled: !!dealId,
  });
}

export function useRetryTsdPush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dealId: number) => {
      const res = await fetch(`/api/partner/deals/${dealId}/retry-tsd-push`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to retry TSD push");
      return res.json();
    },
    onSuccess: (_data, dealId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner/deals", dealId, "tsd-logs"] });
    },
  });
}
