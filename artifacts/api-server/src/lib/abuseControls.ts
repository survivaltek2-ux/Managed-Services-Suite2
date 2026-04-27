// In-memory abuse-control helpers used to amortize cost on public/expensive
// endpoints (places proxy, service-availability fan-out). State is per-process
// and resets on restart — that is sufficient to defeat sustained scripted abuse
// since attackers cannot wait out a restart, and legitimate UX benefits even
// from a short cache window.

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
}

const counters = new Map<string, CounterState>();

/**
 * Try to record an event for `key` inside a sliding `windowMs` window with
 * `limit` allowed events. Returns true if the event was recorded (allowed),
 * false if it would exceed the limit (denied).
 */
export function tryConsume(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const state = counters.get(key) || { events: [] };
  const cutoff = now - windowMs;
  state.events = state.events.filter(t => t > cutoff);
  if (state.events.length >= limit) {
    counters.set(key, state);
    return false;
  }
  state.events.push(now);
  counters.set(key, state);
  return true;
}

// ─── Normalizers ──────────────────────────────────────────────────────────

export function normalizeEmail(raw: string): string {
  return String(raw || "").trim().toLowerCase();
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
