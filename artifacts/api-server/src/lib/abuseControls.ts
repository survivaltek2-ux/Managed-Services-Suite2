// In-memory abuse-control helpers used to amortize cost on public/expensive
// endpoints (places proxy, service-availability fan-out). State is per-process
// and resets on restart — that is sufficient to defeat sustained scripted abuse
// since attackers cannot wait out a restart, and legitimate UX benefits even
// from a short cache window.

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    // Cheap LRU-ish eviction: if we hit the cap, drop the oldest insertion.
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

// ─── Caches ────────────────────────────────────────────────────────────────

// Service-availability results are address-keyed; inputs are pretty stable
// over a 24h window for any sensible address.
export const serviceAvailabilityCache = new TtlCache<unknown>(5000);
export const SERVICE_AVAILABILITY_TTL_MS = 24 * 60 * 60 * 1000;

// Places autocomplete predictions are short-lived — the user typically picks
// within seconds. A short window covers retries and double-clicks while
// preventing scripted enumeration of the same prefix.
export const placesAutocompleteCache = new TtlCache<unknown>(10000);
export const PLACES_AUTOCOMPLETE_TTL_MS = 10 * 60 * 1000;

// Place details are stable for long periods; cache for a day.
export const placesDetailsCache = new TtlCache<unknown>(5000);
export const PLACES_DETAILS_TTL_MS = 24 * 60 * 60 * 1000;

// ─── Sliding-window per-key counters ──────────────────────────────────────
// Used to throttle a key (e.g. email recipient) independently of source IP.
// Express-rate-limit only keys on IP by default and is meant for HTTP route
// shape; this counter is body-aware and survives across IPs.

interface CounterState {
  events: number[]; // unix-ms timestamps within the window
  expiresAt: number; // when the entry can be safely evicted
}

// Bounded to MAX_COUNTER_KEYS to defend the abuse-control path itself
// against a high-cardinality memory-exhaustion attack (an attacker spraying
// unique keys would otherwise grow this map without bound).
const MAX_COUNTER_KEYS = 50_000;
const counters = new Map<string, CounterState>();

let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 60 * 1000;

function sweepCountersIfNeeded(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, state] of counters) {
    if (state.expiresAt <= now) counters.delete(key);
  }
}

/**
 * Try to record an event for `key` inside a sliding `windowMs` window with
 * `limit` allowed events. Returns true if the event was recorded (allowed),
 * false if it would exceed the limit (denied).
 */
export function tryConsume(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweepCountersIfNeeded(now);

  const state = counters.get(key) || { events: [], expiresAt: now + windowMs };
  const cutoff = now - windowMs;
  state.events = state.events.filter(t => t > cutoff);

  // Hard cap: if we're at the bound and this is a brand-new key, drop the
  // oldest entry to make room. Map iteration order is insertion order, so
  // this approximates LRU-by-first-seen.
  if (!counters.has(key) && counters.size >= MAX_COUNTER_KEYS) {
    const firstKey = counters.keys().next().value;
    if (firstKey !== undefined) counters.delete(firstKey);
  }

  if (state.events.length >= limit) {
    state.expiresAt = now + windowMs;
    counters.set(key, state);
    return false;
  }
  state.events.push(now);
  state.expiresAt = now + windowMs;
  counters.set(key, state);
  return true;
}

// ─── Normalizers ──────────────────────────────────────────────────────────

// Domains where Google's mailbox aliasing is documented: dots in the local
// part are ignored and "+tag" is a tag for the same inbox. Without canonical
// folding, an attacker can bypass per-recipient throttles by inserting dots
// or tags ("v.ictim+1@gmail.com" → "victim@gmail.com" inbox).
const GMAIL_ALIASES = new Set(["gmail.com", "googlemail.com"]);

export function normalizeEmail(raw: string): string {
  const lowered = String(raw || "").trim().toLowerCase();
  const at = lowered.lastIndexOf("@");
  if (at <= 0 || at === lowered.length - 1) return lowered;
  let local = lowered.slice(0, at);
  const domain = lowered.slice(at + 1);
  // Strip "+tag" for ALL providers — it's a near-universal aliasing convention
  // and folding it is safer than letting it bypass per-recipient throttles.
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  // Strip dots only on Gmail/Googlemail where they are documented to be
  // ignored. Dots are significant on most other providers.
  if (GMAIL_ALIASES.has(domain)) {
    local = local.replace(/\./g, "");
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}

/**
 * Build a cache/dedup key from address parts. Lower-case, alphanumerics only,
 * collapsed whitespace — so "123 Main St." and "123 main st" hit the same row.
 */
export function normalizeAddressKey(parts: { address?: string; city?: string; state?: string; zip?: string }): string {
  const raw = [parts.address, parts.city, parts.state, parts.zip]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return raw;
}

// ─── Global Places circuit breaker ────────────────────────────────────────
// Tracks total outbound Google Places API calls across all callers within a
// rolling one-hour window. When the per-endpoint cap is hit the handler stops
// forwarding to Google, bounding worst-case quota spend regardless of how many
// source IPs an attacker controls. Caps are intentionally conservative — they
// cover normal interactive load while leaving no room for large-scale scripted
// enumeration.

const PLACES_AUTOCOMPLETE_HOURLY_CAP = 1000;
const PLACES_DETAILS_HOURLY_CAP = 300;
const HOUR_MS = 60 * 60 * 1000;

interface CircuitWindow {
  count: number;
  windowStart: number;
}

const placesCircuit: Record<"autocomplete" | "details", CircuitWindow> = {
  autocomplete: { count: 0, windowStart: Date.now() },
  details: { count: 0, windowStart: Date.now() },
};

function getCircuitWindow(type: "autocomplete" | "details"): CircuitWindow {
  const w = placesCircuit[type];
  if (Date.now() - w.windowStart >= HOUR_MS) {
    w.count = 0;
    w.windowStart = Date.now();
  }
  return w;
}

/**
 * Attempt to record one outbound Places API call of the given type. Returns
 * true if the call is within budget (proceed), false if the hourly cap has
 * been reached (circuit open — do not forward to Google).
 */
export function recordPlacesCall(type: "autocomplete" | "details"): boolean {
  const w = getCircuitWindow(type);
  const cap = type === "autocomplete" ? PLACES_AUTOCOMPLETE_HOURLY_CAP : PLACES_DETAILS_HOURLY_CAP;
  if (w.count >= cap) return false;
  w.count++;
  return true;
}

// ─── Places proxy token (proof-of-origin gate) ────────────────────────────
// A short-lived HMAC-SHA256 token the server issues at /api/places/token and
// the client must present via the X-Places-Token header on every Places proxy
// request. Requiring a prior server round-trip eliminates zero-RTT scripted
// abuse: any caller must hit the rate-limited token endpoint before spending
// Places quota.
//
// Defenses layered onto the token:
// 1. IP binding — IP address is included in the HMAC payload, so a token
//    obtained by one source cannot be reused from a different network address.
// 2. Nonce-based per-token quota — each token carries a random nonce; the
//    server tracks how many times each nonce has been used and rejects calls
//    once the per-token budget is exhausted. This caps blast radius even when
//    an attacker controls many IPs (they still need a token endpoint round-trip
//    per N calls).
// 3. Short TTL — 2 minutes. The frontend refreshes proactively so real users
//    are never interrupted.
//
// Token format: "<base36-ts>.<hex-nonce>.<hex-hmac-sha256>"
// HMAC payload: "${ts}:${nonce}:${ip}"

const PLACES_SIGNING_KEY: string =
  process.env.PLACES_TOKEN_SECRET ||
  process.env.SESSION_SECRET ||
  randomBytes(32).toString("hex");

export const PLACES_TOKEN_TTL_MS = 2 * 60 * 1000; // 2 minutes

// Per-token call budgets. A legitimate user typing one address makes at most
// ~10 autocomplete requests and 1 details request; these limits give 2× margin.
const TOKEN_AUTOCOMPLETE_QUOTA = 20;
const TOKEN_DETAILS_QUOTA = 3;

interface TokenQuota {
  autocomplete: number;
  details: number;
  expiresAt: number;
}

// Bounded map — prevents memory exhaustion under high token issuance rates.
const MAX_TOKEN_QUOTA_ENTRIES = 10_000;
const tokenQuotaMap = new Map<string, TokenQuota>();

function sweepTokenQuota(): void {
  const now = Date.now();
  for (const [key, q] of tokenQuotaMap) {
    if (q.expiresAt <= now) tokenQuotaMap.delete(key);
  }
}

// Periodically sweep expired token quota entries.
let lastTokenSweep = 0;
function maybeSweeepTokens(): void {
  const now = Date.now();
  if (now - lastTokenSweep > 60_000) {
    lastTokenSweep = now;
    sweepTokenQuota();
  }
}

export function issuePlacesToken(ip: string): string {
  const ts = Date.now().toString(36);
  const nonce = randomBytes(8).toString("hex");
  const hmacPayload = `${ts}:${nonce}:${ip}`;
  const sig = createHmac("sha256", PLACES_SIGNING_KEY).update(hmacPayload).digest("hex");
  const token = `${ts}.${nonce}.${sig}`;

  // Register the nonce with its quota before returning the token.
  maybeSweeepTokens();
  if (tokenQuotaMap.size >= MAX_TOKEN_QUOTA_ENTRIES) {
    const firstKey = tokenQuotaMap.keys().next().value;
    if (firstKey !== undefined) tokenQuotaMap.delete(firstKey);
  }
  tokenQuotaMap.set(nonce, {
    autocomplete: TOKEN_AUTOCOMPLETE_QUOTA,
    details: TOKEN_DETAILS_QUOTA,
    expiresAt: Date.now() + PLACES_TOKEN_TTL_MS + 5_000, // small grace period
  });

  return token;
}

export function validateAndConsumePlacesToken(
  token: string | undefined,
  ip: string,
  callType: "autocomplete" | "details"
): boolean {
  if (!token || typeof token !== "string") return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;

  // Expiry check
  const issuedAt = parseInt(ts, 36);
  if (!isFinite(issuedAt) || Date.now() - issuedAt > PLACES_TOKEN_TTL_MS) return false;

  // HMAC verification (IP-bound)
  const expected = createHmac("sha256", PLACES_SIGNING_KEY)
    .update(`${ts}:${nonce}:${ip}`)
    .digest("hex");
  let sigValid = false;
  try {
    sigValid = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
  if (!sigValid) return false;

  // Per-token quota check and decrement
  maybeSweeepTokens();
  const quota = tokenQuotaMap.get(nonce);
  if (!quota || quota.expiresAt <= Date.now()) return false;
  if (callType === "autocomplete") {
    if (quota.autocomplete <= 0) return false;
    quota.autocomplete--;
  } else {
    if (quota.details <= 0) return false;
    quota.details--;
  }
  return true;
}
