import { Router, Request, Response } from "express";
import {
  placesAutocompleteCache,
  placesDetailsCache,
  PLACES_AUTOCOMPLETE_TTL_MS,
  PLACES_DETAILS_TTL_MS,
} from "../lib/abuseControls.js";

const router = Router();

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// Bound the input length so attackers can't inflate billed payload sizes by
// sending huge query strings; Google's Place Autocomplete cap is 500 chars,
// but a real address prefix is well under 100.
const MAX_INPUT_LEN = 100;
// Google Places session_token is a UUID — clients send it as `sessiontoken` so
// autocomplete + the matching details call are billed as one session instead
// of separately. Validate the format so we don't forward garbage.
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/;

router.get("/places/autocomplete", async (req: Request, res: Response) => {
  const { input, sessiontoken } = req.query as Record<string, string>;

  if (!input?.trim()) {
    res.json({ predictions: [] });
    return;
  }

  if (!GOOGLE_PLACES_API_KEY) {
    res.status(503).json({ error: "Places API not configured" });
    return;
  }

  const trimmed = input.trim();
  if (trimmed.length > MAX_INPUT_LEN) {
    res.status(400).json({ error: "input_too_long" });
    return;
  }

  const safeSession = sessiontoken && SESSION_TOKEN_RE.test(sessiontoken) ? sessiontoken : null;

  // Cache by (input, sessionToken). Most users mash a few keystrokes against
  // the same prefix; without caching every keystroke costs an API call. The
  // cache also defeats trivial scripted enumeration of common prefixes.
  const cacheKey = `${trimmed.toLowerCase()}|${safeSession || ""}`;
  const cached = placesAutocompleteCache.get(cacheKey);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    res.json(cached);
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
    const data = await response.json();

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
    const data = await response.json();

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
