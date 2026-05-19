import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { SSO_BROADCAST_CHANNEL, broadcastLogout } from "@/lib/sso-sync";

export class PartnerStatusError extends Error {
  readonly code: string;
  readonly companyName: string;
  readonly partnerEmail: string;
  constructor(code: string, message: string, companyName: string, partnerEmail: string) {
    super(message);
    this.name = "PartnerStatusError";
    this.code = code;
    this.companyName = companyName;
    this.partnerEmail = partnerEmail;
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("partner_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export interface PartnerTeamMemberPermissions {
  canViewDeals: boolean;
  canCreateDeals: boolean;
  canViewLeads: boolean;
  canCreateLeads: boolean;
  canViewCommissions: boolean;
  canViewResources: boolean;
  canCreatePlans: boolean;
}

export interface PartnerTeamMemberContext {
  id: number;
  name: string;
  email: string;
  status: "pending" | "active" | "revoked";
  permissions: PartnerTeamMemberPermissions;
}

export interface PartnerUser {
  id: number;
  companyName: string;
  contactName: string;
  email: string;
  tier: "registered" | "silver" | "gold" | "platinum";
  status: "pending" | "approved" | "rejected" | "suspended";
  totalDeals: number;
  ytdRevenue: string | number;
  totalRevenue?: string | number;
  isAdmin: boolean;
  isMainSiteAdmin?: boolean;
  isTeamMember?: boolean;
  teamMember?: PartnerTeamMemberContext;
  stripeConnectAccountId?: string | null;
  mustChangePassword?: boolean;
}

interface LoginCredentials {
  email: string;
  password: string;
}

interface PreFetchedToken {
  token: string;
  user: PartnerUser;
}

type LoginInput = LoginCredentials | PreFetchedToken;

interface LoginResult {
  token: string;
  user: PartnerUser;
  isMainSiteAdmin?: boolean;
}

function isPreFetchedToken(input: LoginInput): input is PreFetchedToken {
  return "token" in input;
}

export function useAuth() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Listen for SSO login/logout events from other tabs or portals
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(SSO_BROADCAST_CHANNEL);
      channel.onmessage = (event) => {
        if (event.data?.type === "login") {
          if (event.data.partnerToken) {
            localStorage.setItem("partner_token", event.data.partnerToken);
          }
          // An admin userToken also grants partner portal access via passthrough
          if (event.data.partnerToken || event.data.userToken) {
            queryClient.invalidateQueries({ queryKey: ["/api/partner/auth/me"] });
          }
        } else if (event.data?.type === "logout") {
          localStorage.removeItem("partner_token");
          queryClient.setQueryData(["/api/partner/auth/me"], null);
        }
      };
    } catch {
      // BroadcastChannel not available
    }
    return () => {
      try { channel?.close(); } catch {}
    };
  }, [queryClient]);

  const userQuery = useQuery<PartnerUser | null>({
    queryKey: ["/api/partner/auth/me"],
    queryFn: async () => {
      // ── Primary: partner JWT ─────────────────────────────────────────────
      const partnerToken = localStorage.getItem("partner_token");
      if (partnerToken) {
        const res = await fetch("/api/partner/auth/me", { headers: getAuthHeaders() });
        if (res.ok) return res.json() as Promise<PartnerUser>;
        if (res.status === 401) localStorage.removeItem("partner_token");
      }

      // ── Fallback: admin (siebert) JWT passthrough ────────────────────────
      // Admins logging in via unified /login get a siebert_token but no partner_token.
      // We check /api/auth/me and synthesize a PartnerUser with isMainSiteAdmin=true.
      const adminToken = localStorage.getItem("siebert_token");
      if (adminToken) {
        const res = await fetch("/api/auth/me", {
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        });
        if (res.ok) {
          const userData = await res.json() as { id: number; name: string; email: string; company?: string; role: string };
          if (userData.role === "admin") {
            return {
              id: userData.id,
              companyName: userData.company || "Siebert Services (Admin)",
              contactName: userData.name,
              email: userData.email,
              tier: "platinum",
              status: "approved",
              totalDeals: 0,
              ytdRevenue: 0,
              isAdmin: true,
              isMainSiteAdmin: true,
            } as PartnerUser;
          }
        }
      }

      return null;
    },
    retry: false,
  });

  const loginMutation = useMutation<LoginResult, Error, LoginInput>({
    mutationFn: async (input: LoginInput): Promise<LoginResult> => {
      if (isPreFetchedToken(input)) {
        return { token: input.token, user: input.user };
      }

      const res = await fetch("/api/partner/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (res.ok) {
        const data = await res.json();
        return { token: data.token as string, user: (data.partner ?? data.user) as PartnerUser };
      }

      if (res.status === 401) {
        const adminRes = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        if (adminRes.ok) {
          const adminData = await adminRes.json();
          if (adminData.user?.role === "admin") {
            return { token: adminData.token as string, user: adminData.user as PartnerUser, isMainSiteAdmin: true };
          }
          throw new Error("Your account does not have partner or admin access.");
        }
      }

      const err = await res.json().catch(() => ({})) as { message?: string; error?: string; companyName?: string; email?: string };
      if (err.error === "pending_approval" || err.error === "account_rejected" || err.error === "account_suspended") {
        throw new PartnerStatusError(err.error, err.message ?? "Account access restricted.", err.companyName ?? "", err.email ?? "");
      }
      throw new Error(err.message || "Login failed");
    },
    onSuccess: (data) => {
      if (data.token) {
        localStorage.setItem("partner_token", data.token);
        queryClient.invalidateQueries({ queryKey: ["/api/partner/auth/me"] });
        if (data.user?.mustChangePassword) {
          setLocation("/force-change-password");
        } else {
          setLocation("/dashboard");
        }
      }
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: Record<string, string | number | boolean | null>) => {
      const res = await fetch("/api/partner/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Registration failed" }));
        throw new Error((err as { message: string }).message || "Registration failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.token) {
        localStorage.setItem("partner_token", data.token);
        queryClient.setQueryData(["/api/partner/auth/me"], data.user);
        setLocation("/dashboard");
      }
    },
  });

  const handleSsoToken = (token: string) => {
    localStorage.setItem("partner_token", token);
    queryClient.invalidateQueries({ queryKey: ["/api/partner/auth/me"] });
    setLocation("/dashboard");
  };

  const logout = () => {
    localStorage.removeItem("partner_token");
    queryClient.setQueryData(["/api/partner/auth/me"], null);
    broadcastLogout();
    // Redirect to central login after logout
    window.location.href = "/login";
  };

  return {
    user: userQuery.data,
    isLoading: userQuery.isLoading,
    login: loginMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    register: registerMutation.mutateAsync,
    isRegistering: registerMutation.isPending,
    handleSsoToken,
    logout,
  };
}
