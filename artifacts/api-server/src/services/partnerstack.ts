/**
 * PartnerStack REST API client.
 *
 * Auth: HTTP Basic — username = PARTNERSTACK_PUBLIC_KEY, password = PARTNERSTACK_SECRET_KEY
 * Docs: https://docs.partnerstack.com/reference
 */

const BASE_URL = "https://api.partnerstack.com/v2";

export function isPartnerstackConfigured(): boolean {
  // Some PartnerStack accounts only ship a single secret API key — public key is optional.
  return Boolean(process.env.PARTNERSTACK_SECRET_KEY);
}

function authHeader(): string {
  const pub = process.env.PARTNERSTACK_PUBLIC_KEY ?? "";
  const sec = process.env.PARTNERSTACK_SECRET_KEY;
  if (!sec) {
    throw new Error("PartnerStack secret key not configured (PARTNERSTACK_SECRET_KEY)");
  }
  return "Basic " + Buffer.from(`${pub}:${sec}`).toString("base64");
}

async function psFetch<T = any>(
  path: string,
  options: { method?: string; query?: Record<string, string>; body?: unknown; allow404?: boolean } = {}
): Promise<T | null> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    if (res.status === 404 && options.allow404) return null;
    const text = await res.text();
    throw new Error(`PartnerStack API ${res.status} on ${options.method ?? "GET"} ${path}: ${text.slice(0, 400)}`);
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Partners (PartnerStack calls these "partnerships")
// ─────────────────────────────────────────────────────────────────────────────

export interface PsPartner {
  key: string;
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  state?: string; // approved | pending | rejected | suspended
  group_key?: string;
  joined_at?: number;
  updated_at?: number;
}

export interface PsListResponse<T> {
  data: T[];
  // PartnerStack uses cursor pagination but we only need a simple call here.
}

export async function listPartners(updatedSince?: Date): Promise<PsPartner[]> {
  const query: Record<string, string> = { limit: "100" };
  if (updatedSince) query.min_updated_at = String(Math.floor(updatedSince.getTime() / 1000));
  const out = await psFetch<PsListResponse<PsPartner>>("/partnerships", { query });
  return out!.data ?? [];
}

export async function getPartnerByEmail(email: string): Promise<PsPartner | null> {
  try {
    const out = await psFetch<PsListResponse<PsPartner>>("/partnerships", {
      query: { email, limit: "1" },
    });
    return out?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function createPartner(input: {
  email: string;
  first_name: string;
  last_name: string;
  company?: string;
  state?: "approved" | "pending";
}): Promise<PsPartner> {
  const out = await psFetch<{ data: PsPartner }>("/partnerships", {
    method: "POST",
    body: input,
  });
  return out!.data;
}

export async function updatePartner(key: string, patch: Partial<PsPartner>): Promise<PsPartner> {
  const out = await psFetch<{ data: PsPartner }>(`/partnerships/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: patch,
  });
  return out!.data;
}

export async function upsertPartnerByEmail(input: {
  email: string;
  first_name: string;
  last_name: string;
  company?: string;
  state?: "approved" | "pending";
}): Promise<PsPartner> {
  const existing = await getPartnerByEmail(input.email);
  if (existing) {
    return updatePartner(existing.key, {
      first_name: input.first_name,
      last_name: input.last_name,
      company: input.company,
      state: input.state,
    });
  }
  return createPartner(input);
}

// ─────────────────────────────────────────────────────────────────────────────
// Transactions (commissions paid out via PartnerStack)
// ─────────────────────────────────────────────────────────────────────────────

export interface PsTransaction {
  key: string;
  partnership_key: string;
  amount: number;          // dollars
  currency: string;
  state: string;           // pending | approved | declined | paid
  description?: string;
  external_key?: string;   // our local commission id
  created_at?: number;
  updated_at?: number;
}

export async function listTransactions(updatedSince?: Date): Promise<PsTransaction[]> {
  const query: Record<string, string> = { limit: "100" };
  if (updatedSince) query.min_updated_at = String(Math.floor(updatedSince.getTime() / 1000));
  const out = await psFetch<PsListResponse<PsTransaction>>("/transactions", { query, allow404: true });
  if (!out) return []; // 404 — account doesn't have access to transactions API
  return out.data ?? [];
}

export async function createTransaction(input: {
  partnership_key: string;
  amount: number;
  currency?: string;
  description?: string;
  external_key?: string;
}): Promise<PsTransaction> {
  const out = await psFetch<{ data: PsTransaction }>("/transactions", {
    method: "POST",
    body: { currency: "USD", ...input },
  });
  return out!.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Account info (used for connection status)
// ─────────────────────────────────────────────────────────────────────────────

export async function ping(): Promise<{
  ok: boolean;
  reachable: true;
  sampleSize: number;
  accountHint: string | null;
  sample?: PsPartner;
}> {
  // PartnerStack v2 doesn't expose a single "/me" endpoint that all accounts can use,
  // so we use the partnerships list as a reachability check. We grab up to 25 to give
  // a more useful sample size + an account hint (group_key is usually the account).
  const out = await psFetch<PsListResponse<PsPartner>>("/partnerships", { query: { limit: "25" } });
  const data = out!.data ?? [];
  const accountHint = data.find(p => p.group_key)?.group_key ?? null;
  return {
    ok: true,
    reachable: true,
    sampleSize: data.length,
    accountHint,
    sample: data[0],
  };
}
