// API helper for the Connector Program. Always uses absolute /api/... paths so
// the request hits the API server regardless of which artifact is mounted.
const TOKEN_KEY = "connector_token";

export function getConnectorToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setConnectorToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.auth !== false) {
    const token = getConnectorToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  // Always absolute /api/... — never include the artifact base path here.
  const url = `/api${path}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      (data as { message?: string })?.message ||
      (data as { error?: string })?.error ||
      `Request failed with status ${res.status}`;
    const code = (data as { error?: string })?.error;
    throw new ApiError(message, res.status, code);
  }

  return data as T;
}

export interface ConnectorAccount {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  occupation: string | null;
  status: "pending" | "approved" | "rejected" | "suspended";
  totalReferrals: number;
  totalEarnedCents: number;
  createdAt: string;
}

export interface ConnectorStats {
  totalReferrals: number;
  totalQualified: number;
  totalWon: number;
  totalPaidCents: number;
  totalPendingCents: number;
}

export interface ConnectorReferral {
  id: number;
  connectorId: number;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  contactTitle: string | null;
  companySize: string | null;
  multiLocation: string | null;
  servicesNeeded: string;
  notes: string | null;
  status: "submitted" | "qualified" | "in_progress" | "won" | "lost" | "duplicate";
  estimatedAcvCents: number | null;
  actualAcvCents: number | null;
  rewardAmountCents: number | null;
  rewardTier: string | null;
  qualifiedAt: string | null;
  wonAt: string | null;
  firstInvoicePaidAt: string | null;
  payoutDueAt: string | null;
  clawbackUntil: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorPayout {
  id: number;
  amountCents: number;
  status: "pending" | "approved" | "paid" | "void";
  payoutMethod: string | null;
  payoutReference: string | null;
  notes: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
  city?: string;
  state?: string;
  occupation?: string;
  howHeard?: string;
}

export interface ReferralInput {
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  contactTitle?: string;
  companySize?: string;
  multiLocation?: "yes" | "no" | "unknown";
  servicesNeeded: string[];
  notes?: string;
}

export const connectorsApi = {
  signup: (input: SignupInput) =>
    apiRequest<{ token: string; connector: ConnectorAccount }>("/connectors/auth/signup", {
      method: "POST",
      body: input,
      auth: false,
    }),
  login: (email: string, password: string) =>
    apiRequest<{ token: string; connector: ConnectorAccount }>("/connectors/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    }),
  me: () =>
    apiRequest<{ connector: ConnectorAccount; stats: ConnectorStats }>("/connectors/me"),
  submitReferral: (input: ReferralInput) =>
    apiRequest<{ referral: ConnectorReferral }>("/connectors/referrals", {
      method: "POST",
      body: input,
    }),
  listReferrals: () =>
    apiRequest<{ referrals: ConnectorReferral[] }>("/connectors/referrals"),
  listPayouts: () =>
    apiRequest<{ payouts: ConnectorPayout[] }>("/connectors/payouts"),
};
