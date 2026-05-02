import { Router, Request, Response } from "express";
import {
  placesAutocompleteCache,
  placesDetailsCache,
  PLACES_AUTOCOMPLETE_TTL_MS,
  PLACES_DETAILS_TTL_MS,
  recordPlacesCall,
  issuePlacesToken,
  validateAndConsumePlacesToken,
} from "../lib/abuseControls.js";

// Derive the real client IP. With `app.set("trust proxy", 1)` Express strips
// any client-supplied X-Forwarded-For entries and populates req.ip with the
// address added by our single trusted proxy hop, so this is spoof-resistant.
function getClientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

const router = Router();

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// Bound the input length so attackers can't inflate billed payload sizes by
// sending huge query strings; Google's Place Autocomplete cap is 500 chars,
// but a real address prefix is well under 100.
const MAX_INPUT_LEN = 100;
// Enforce the same minimum the frontend widgets use. Shorter prefixes produce
// noisy results and let attackers cheaply enumerate a huge number of cache-miss
// requests with minimal query variation.
const MIN_INPUT_LEN = 3;
// Google Places session_token is a UUID — clients send it as `sessiontoken` so
// autocomplete + the matching details call are billed as one session instead
// of separately. Validate the format so we don't forward garbage.
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/;

// ─── Token endpoint ───────────────────────────────────────────────────────
// Issues a short-lived IP-bound HMAC token. Clients must present the token in
// the X-Places-Token header on every Places proxy request. The token is bound
// to the requester's IP, carries a random nonce, and has a limited per-nonce
// call budget — all tracked server-side. Rate-limited by placesTokenLimiter.
router.get("/places/token", (req: Request, res: Response) => {
  const ip = getClientIp(req);
  res.json({ token: issuePlacesToken(ip) });
});

router.get("/places/autocomplete", async (req: Request, res: Response) => {
  const { input, sessiontoken } = req.query as Record<string, string>;
  const placesToken = req.headers["x-places-token"] as string | undefined;

  if (!validateAndConsumePlacesToken(placesToken, getClientIp(req), "autocomplete")) {
    res.status(401).json({ error: "invalid_token", message: "A valid places token is required." });
    return;
  }

  if (!input?.trim()) {
    res.json({ predictions: [] });
    return;
  }

  if (!GOOGLE_PLACES_API_KEY) {
    res.status(503).json({ error: "Places API not configured" });
    return;
  }

  const trimmed = input.trim();
  if (trimmed.length < MIN_INPUT_LEN) {
    res.json({ predictions: [] });
    return;
  }
  if (trimmed.length > MAX_INPUT_LEN) {
    res.status(400).json({ error: "input_too_long" });
    return;
  }

  const safeSession = sessiontoken && SESSION_TOKEN_RE.test(sessiontoken) ? sessiontoken : null;

  // Cache keyed on the normalized input only — not on the session token.
  // Including the session token in the key would let an attacker bypass the
  // cache entirely by rotating tokens, turning every inbound request into a
  // billable Google API call. The session token is still forwarded to Google
  // so that legitimate browser sessions benefit from per-session billing, but
  // it must not influence cache lookup or storage.
  const cacheKey = trimmed.toLowerCase();
  const cached = placesAutocompleteCache.get(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    res.json(cached);
    return;
  }

  // Global circuit breaker: if we've already forwarded the hourly cap of
  // autocomplete calls, stop spending quota entirely (return empty, not an
  // error, so the UI degrades gracefully without revealing the circuit state).
  if (!recordPlacesCall("autocomplete")) {
    res.json({ predictions: [], status: "QUOTA_LIMIT" });
    return;
  }

  try {
    const params = new URLSearchParams({
      input: trimmed,
      key: GOOGLE_PLACES_API_KEY,
      components: "country:us",
      types: "address",
    });
    if (safeSession) params.set("sessiontoken", safeSession);

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`
    );
    const data = await response.json() as any;

    const payload = {
      predictions: (data.predictions || []).map((p: any) => ({
        place_id: p.place_id,
        description: p.description,
        main_text: p.structured_formatting?.main_text || p.description,
        secondary_text: p.structured_formatting?.secondary_text || "",
      })),
      status: data.status,
    };

    placesAutocompleteCache.set(cacheKey, payload, PLACES_AUTOCOMPLETE_TTL_MS);
    res.setHeader("X-Cache", "MISS");
    res.json(payload);
  } catch (err) {
    console.error("[Places] Autocomplete error:", err);
    res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

router.get("/places/details", async (req: Request, res: Response) => {
  const { place_id, sessiontoken } = req.query as Record<string, string>;
  const placesToken = req.headers["x-places-token"] as string | undefined;

  if (!validateAndConsumePlacesToken(placesToken, getClientIp(req), "details")) {
    res.status(401).json({ error: "invalid_token", message: "A valid places token is required." });
    return;
  }

  if (!place_id) {
    res.status(400).json({ error: "place_id required" });
    return;
  }
  if (place_id.length > 256) {
    res.status(400).json({ error: "place_id_too_long" });
    return;
  }

  if (!GOOGLE_PLACES_API_KEY) {
    res.status(503).json({ error: "Places API not configured" });
    return;
  }

  const safeSession = sessiontoken && SESSION_TOKEN_RE.test(sessiontoken) ? sessiontoken : null;

  // Place details for a given place_id are stable for long periods, so cache
  // the parsed response for a day. Session token is intentionally not part of
  // the key — once we have parsed details for a place_id, every caller can
  // reuse them.
  const cached = placesDetailsCache.get(place_id);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    res.json(cached);
    return;
  }

  // Global circuit breaker: bound total outbound details calls per hour.
  if (!recordPlacesCall("details")) {
    res.status(503).json({ error: "service_unavailable", message: "Address lookup temporarily unavailable." });
    return;
  }

  try {
    const params = new URLSearchParams({
      place_id,
      key: GOOGLE_PLACES_API_KEY,
      fields: "address_components,geometry",
    });
    if (safeSession) params.set("sessiontoken", safeSession);

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );
    const data = await response.json() as any;

    if (data.status !== "OK") {
      res.status(404).json({ error: "Place not found", status: data.status });
      return;
    }

    const components: Array<{ long_name: string; short_name: string; types: string[] }> =
      data.result.address_components || [];

    const get = (type: string, nameType: "long_name" | "short_name" = "long_name") =>
      components.find((c) => c.types.includes(type))?.[nameType] || "";

    const payload = {
      address: `${get("street_number")} ${get("route")}`.trim(),
      city: get("locality") || get("sublocality") || get("neighborhood"),
      state: get("administrative_area_level_1", "short_name"),
      zip: get("postal_code"),
      lat: data.result.geometry?.location?.lat || null,
      lng: data.result.geometry?.location?.lng || null,
    };

    placesDetailsCache.set(place_id, payload, PLACES_DETAILS_TTL_MS);
    res.setHeader("X-Cache", "MISS");
    res.json(payload);
  } catch (err) {
    console.error("[Places] Details error:", err);
    res.status(500).json({ error: "Failed to fetch place details" });
  }
});

export default router;
