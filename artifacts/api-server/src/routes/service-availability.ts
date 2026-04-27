import { Router, Request, Response } from "express";
import { requirePartnerAuth, PartnerRequest } from "../middlewares/partnerAuth.js";
import { getResidentialCommissionRate, lookupResidentialCommission } from "../config/isp-commissions.js";
import {
  serviceAvailabilityCache,
  SERVICE_AVAILABILITY_TTL_MS,
  normalizeAddressKey,
} from "../lib/abuseControls.js";

const router = Router();

const NETOMNIA_API_KEY = process.env.NETOMNIA_API_KEY || "";
const HUM_API_KEY = process.env.HUM_API_KEY || "";
const HUM_BASE_URL = process.env.HUM_BASE_URL || "https://api-sandbox.letshum.com";

const TECH_ORDER: Record<string, number> = {
  Fiber: 0,
  Cable: 1,
  DSL: 2,
  "Fixed Wireless": 3,
  "Licensed Fixed Wireless": 3,
  Satellite: 4,
  Other: 5,
};

interface IspProvider {
  providerId: string;
  brandName: string;
  technology: string;
  technologyCode: number;
  technologyDetail: string;
  maxDownload: number;
  maxUpload: number;
  lowLatency: boolean;
  locationCount?: number;
  serviceType?: "internet" | "phone" | "tv"; // New: service type
  // Affiliate fields from Hum
  affiliateUrl?: string;
  affiliateButtonLabel?: string;
  affiliateToken?: string;
  minPlanPrice?: { amount_cents: number; currency: string };
  // Commission data (for dynamic sorting by revenue potential)
  estimatedCommissionUsd: number;
  commissionNetwork?: string;
  commissionAffiliateSignupUrl?: string;
}

interface ApiResponseData {
  address: {
    input: string;
    matched: string;
    components: { streetAddress: string; city: string; state: string; zip: string };
  };
  coordinates: { lat: number; lng: number };
  providers: IspProvider[];
  summary: {
    totalProviders: number;
    totalOptions: number;
    hasFiber: boolean;
    hasCable: boolean;
    hasDSL: boolean;
    hasFixedWireless: boolean;
    hasSatellite: boolean;
    maxDownloadSpeed: number;
    maxUploadSpeed: number;
    state: string;
  };
}

async function tryInternetProvidersAi(formattedAddress: string): Promise<{ success: boolean; data?: ApiResponseData; error?: string }> {
  try {
    const apiUrl = `https://www.internetproviders.ai/api/availability?address=${encodeURIComponent(formattedAddress)}`;
    const apiRes = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SiebertServices/1.0)",
        "Accept": "application/json",
      },
      redirect: "follow",
    });

    let data: any;
    try {
      data = await apiRes.json();
    } catch {
      return { success: false, error: "Failed to parse response" };
    }

    if (!data.success) {
      return { success: false, error: data.error || "Address not found" };
    }

    return { success: true, data: data.data };
  } catch (err: any) {
    console.error("[Service Availability] internetproviders.ai error:", err.message);
    return { success: false, error: err.message };
  }
}

async function tryNetomnia(address: string, city: string, state: string, zip: string): Promise<{ success: boolean; data?: ApiResponseData; error?: string }> {
  if (!NETOMNIA_API_KEY) {
    return { success: false, error: "Netomnia API not configured" };
  }

  try {
    const formattedAddress = [address.trim(), city.trim(), state.trim(), zip.trim()].filter(Boolean).join(" ");
    const apiUrl = `https://api.netomnia.com/v1/checkavailability`;
    
    const apiRes = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NETOMNIA_API_KEY}`,
      },
      body: JSON.stringify({
        address: formattedAddress,
        region: state, // US state code
      }),
    });

    if (!apiRes.ok) {
      return { success: false, error: `Netomnia API returned ${apiRes.status}` };
    }

    let data: any;
    try {
      data = await apiRes.json();
    } catch {
      return { success: false, error: "Failed to parse Netomnia response" };
    }

    if (!data.availability || data.availability.length === 0) {
      return { success: false, error: "No providers found" };
    }

    // Transform Netomnia response to match our format
    const providers: IspProvider[] = data.availability.map((p: any, idx: number) => ({
      providerId: p.provider_id || `netomnia-${idx}`,
      brandName: p.provider_name || "Unknown",
      technology: p.technology || "Other",
      technologyCode: getTechCode(p.technology),
      technologyDetail: p.technology_detail || p.technology || "Unknown",
      maxDownload: p.max_download_speed || 0,
      maxUpload: p.max_upload_speed || 0,
      lowLatency: p.latency < 30,
    }));

    return {
      success: true,
      data: {
        address: {
          input: formattedAddress,
          matched: data.matched_address || formattedAddress,
          components: { streetAddress: address, city, state, zip },
        },
        coordinates: data.coordinates || { lat: 0, lng: 0 },
        providers,
        summary: {
          totalProviders: providers.length,
          totalOptions: providers.length,
          hasFiber: providers.some(p => p.technology.includes("Fiber")),
          hasCable: providers.some(p => p.technology.includes("Cable")),
          hasDSL: providers.some(p => p.technology.includes("DSL")),
          hasFixedWireless: providers.some(p => p.technology.includes("Wireless")),
          hasSatellite: providers.some(p => p.technology.includes("Satellite")),
          maxDownloadSpeed: Math.max(...providers.map(p => p.maxDownload), 0),
          maxUploadSpeed: Math.max(...providers.map(p => p.maxUpload), 0),
          state,
        },
      },
    };
  } catch (err: any) {
    console.error("[Service Availability] Netomnia error:", err.message);
    return { success: false, error: err.message };
  }
}

function getTechCode(tech: string): number {
  const map: Record<string, number> = {
    Fiber: 50,
    Cable: 40,
    DSL: 10,
    "Fixed Wireless": 70,
    Satellite: 60,
  };
  return map[tech] || 0;
}

async function tryHum(address: string, city: string, state: string, zip: string): Promise<{ success: boolean; data?: ApiResponseData; error?: string }> {
  if (!HUM_API_KEY) {
    return { success: false, error: "Hum API not configured" };
  }

  try {
    // Hum requires creating a session first with address info, then querying services
    const sessionUrl = `${HUM_BASE_URL}/sessions`;
    const sessionRes = await fetch(sessionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${HUM_API_KEY}`,
      },
      body: JSON.stringify({
        street1: address.trim(),
        city: city.trim(),
        state: state.trim(),
        zip: zip.trim(),
        campaign_id: "siebert-services", // Optional campaign identifier
      }),
    });

    if (!sessionRes.ok) {
      return { success: false, error: `Hum session creation failed: ${sessionRes.status}` };
    }

    let sessionData: any;
    try {
      sessionData = await sessionRes.json();
    } catch {
      return { success: false, error: "Failed to parse Hum session response" };
    }

    if (!sessionData.meta?.session_token) {
      return { success: false, error: "No session token from Hum" };
    }

    // Now fetch internet, phone, and TV services for this session
    const token = sessionData.meta.session_token;
    const serviceTypes = ["internet", "phone", "tv"];
    const allProviders: any[] = [];

    for (const serviceType of serviceTypes) {
      const servicesUrl = `${HUM_BASE_URL}/sessions/${token}/services/${serviceType}`;
      const servicesRes = await fetch(servicesUrl, {
        headers: {
          "Authorization": `Bearer ${HUM_API_KEY}`,
        },
      });

      if (!servicesRes.ok) {
        // Skip if service type not available
        continue;
      }

      let servicesData: any;
      try {
        servicesData = await servicesRes.json();
      } catch {
        continue;
      }

      const providers = servicesData.data?.[serviceType] || [];
      // Tag each provider with its service type
      providers.forEach((p: any) => {
        p._serviceType = serviceType;
      });
      allProviders.push(...providers);
    }

    const humProviders = allProviders;
    if (humProviders.length === 0) {
      return { success: false, error: "No providers found" };
    }

    // Transform Hum providers to our format (with affiliate data and service type)
    const providers: IspProvider[] = humProviders.map((p: any, idx: number) => {
      const offering = p.offerings?.[0] || {};
      return {
        providerId: p.provider_id || `hum-${idx}`,
        brandName: p.provider_name || "Unknown",
        technology: offering.technology || "Other",
        technologyCode: getTechCode(offering.technology || "Other"),
        technologyDetail: `${offering.technology}${offering.technology_category ? ` (${offering.technology_category})` : ""}`,
        maxDownload: offering.max_download_speed || 0,
        maxUpload: offering.max_upload_speed || 0,
        lowLatency: (offering.max_download_speed || 0) >= 100,
        serviceType: p._serviceType as "internet" | "phone" | "tv",
        // Affiliate fields from Hum
        affiliateUrl: p.url,
        affiliateButtonLabel: p.button_label,
        affiliateToken: p.security_token,
        minPlanPrice: p.min_plan_price,
      };
    });

    const sessionParams = sessionData.meta?.session_params || {};
    return {
      success: true,
      data: {
        address: {
          input: `${address}, ${city}, ${state}, ${zip}`,
          matched: sessionData.meta?.service_address || `${address}, ${city}, ${state}, ${zip}`,
          components: { streetAddress: address, city, state, zip },
        },
        coordinates: {
          lat: sessionParams.latitude || 0,
          lng: sessionParams.longitude || 0,
        },
        providers,
        summary: {
          totalProviders: providers.length,
          totalOptions: providers.length,
          hasFiber: providers.some(p => p.technology.includes("Fiber")),
          hasCable: providers.some(p => p.technology.includes("Cable")),
          hasDSL: providers.some(p => p.technology.includes("DSL")),
          hasFixedWireless: providers.some(p => p.technology.includes("Wireless")),
          hasSatellite: providers.some(p => p.technology.includes("Satellite")),
          maxDownloadSpeed: Math.max(...providers.map(p => p.maxDownload), 0),
          maxUploadSpeed: Math.max(...providers.map(p => p.maxUpload), 0),
          state,
        },
      },
    };
  } catch (err: any) {
    console.error("[Service Availability] Hum error:", err.message);
    return { success: false, error: err.message };
  }
}

router.get("/service-availability", async (req: Request, res: Response) => {
  try {
    const { address, city, state, zip } = req.query as Record<string, string>;

    if (!address || !state) {
      res.status(400).json({ error: "validation_error", message: "Address and state are required." });
      return;
    }

    // Reject obviously oversized inputs so attackers cannot inflate downstream
    // payloads or burn CPU on URL building before the cache lookup.
    if (address.length > 200 || (city && city.length > 100) || state.length > 10 || (zip && zip.length > 20)) {
      res.status(400).json({ error: "validation_error", message: "Address fields are too long." });
      return;
    }

    // Build formatted address string (city is strongly recommended)
    const parts = [address.trim()];
    if (city?.trim()) parts.push(city.trim());
    parts.push(state.trim());
    if (zip?.trim()) parts.push(zip.trim());
    const formattedAddress = parts.join(", ");

    // 24h cache keyed by normalized address. The downstream APIs (especially
    // Hum, which makes 4 calls per request) are paid per call, so repeating
    // the same lookup must not multiply our spend. The cache is in-memory
    // per-process — sufficient because the rate limiter caps the per-IP rate
    // and the worst case is N caches across N replicas.
    const cacheKey = normalizeAddressKey({ address, city, state, zip });
    if (cacheKey) {
      const cached = serviceAvailabilityCache.get(cacheKey);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.json(cached);
        return;
      }
    }

    // Query ALL providers in parallel and combine results
    console.log("[Service Availability] Querying all providers for:", formattedAddress);

    const [ipaResult, netomiaResult, humResult] = await Promise.all([
      tryInternetProvidersAi(formattedAddress),
      tryNetomnia(address, city || "", state, zip || ""),
      tryHum(address, city || "", state, zip || ""),
    ]);

    // Collect all successful results
    const successfulResults = [ipaResult, netomiaResult, humResult].filter(r => r.success && r.data);
    
    if (successfulResults.length === 0) {
      const allErrors = [ipaResult.error, netomiaResult.error, humResult.error].filter(Boolean).join("; ");
      const msg = allErrors || "Address not found";
      if (msg.toLowerCase().includes("not find")) {
        res.status(404).json({
          error: "address_not_found",
          message: "This address could not be found in any available database. Please verify the address and try again.",
        });
      } else {
        res.status(422).json({ error: "lookup_failed", message: msg });
      }
      return;
    }

    // Use the first successful result as the base (for address, coordinates)
    const primaryData = successfulResults[0].data!;
    const d = primaryData;
    
    // Collect ALL providers from ALL successful sources
    const allProviders: IspProvider[] = [];
    for (const result of successfulResults) {
      if (result.data?.providers) {
        allProviders.push(...result.data.providers);
      }
    }

    // Deduplicate providers (same brand + technology → keep highest speeds)
    const seen = new Map<string, IspProvider>();
    for (const p of allProviders) {
      const key = `${p.providerId}-${p.technology}`;
      const existing = seen.get(key);
      if (!existing || p.maxDownload > existing.maxDownload) {
        seen.set(key, p);
      }
    }

    // Enrich each provider with commission data and sort by revenue potential:
    // Primary: estimated commission (highest first)
    // Secondary: technology order (Fiber > Cable > DSL > Fixed Wireless > Satellite)
    // Tertiary: download speed (fastest first)
    const providers = Array.from(seen.values())
      .map(p => {
        // Attach commission data internally for sorting only — never exposed in response
        const commission = lookupResidentialCommission(p.brandName);
        return {
          ...p,
          _commissionRateInternal: commission?.rateUsd ?? 0,
        };
      })
      .sort((a, b) => {
        // Sort by commission first (internal only, not in response)
        if (b._commissionRateInternal !== a._commissionRateInternal) {
          return b._commissionRateInternal - a._commissionRateInternal;
        }
        // Then by technology
        const ao = TECH_ORDER[a.technology] ?? 5;
        const bo = TECH_ORDER[b.technology] ?? 5;
        if (ao !== bo) return ao - bo;
        // Then by speed
        return b.maxDownload - a.maxDownload;
      })
      .map(({ _commissionRateInternal, ...publicProvider }) => publicProvider); // Strip internal field

    const responsePayload = {
      location: {
        address: d.address.matched,
        latitude: d.coordinates.lat,
        longitude: d.coordinates.lng,
      },
      providers,
      summary: d.summary,
      fccMapUrl: `https://broadbandmap.fcc.gov/home?addr=${encodeURIComponent(d.address.matched)}&lat=${d.coordinates.lat.toFixed(6)}&lon=${d.coordinates.lng.toFixed(6)}&unit=ft&speed=25&tech=300&zoom=14`,
      googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${d.coordinates.lat},${d.coordinates.lng}`,
      // CarrierFinder link for business flow
      carrierFinderUrl: "https://www.carrierfinder.com",
      carrierFinderPartnerUrl: "https://www.carrierfinder.com/partner",
    };

    if (cacheKey) {
      serviceAvailabilityCache.set(cacheKey, responsePayload, SERVICE_AVAILABILITY_TTL_MS);
    }
    res.setHeader("X-Cache", "MISS");
    res.json(responsePayload);
  } catch (err: any) {
    console.error("[Service Availability] Error:", err);
    res.status(500).json({ error: "server_error", message: "An unexpected error occurred." });
  }
});

export default router;
