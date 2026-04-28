import { Router, Request, Response } from "express";
import { db, writtenPlansTable, planActivityEventsTable, validateQuestionnaireAnswers, partnersTable, PAIN_POINT_OPTIONS, clientOnboardingTable } from "@workspace/db";
import { eq, desc, and, lt, gt, inArray, sql } from "drizzle-orm";
import { requirePartnerAuth, PartnerRequest, TeamMemberPermissions, MAIN_SITE_ADMIN_SENTINEL } from "../middlewares/partnerAuth.js";
import {
  sendPlanReadyEmail,
  sendPlanApprovedEmail,
  sendPlanCallRequestedEmail,
  sendPlanDeclinedEmail,
  sendPlanExpiringEmail,
  sendClientPortalWelcomeEmail,
} from "../lib/email.js";
import { issueClientPortalToken } from "./client-portal.js";
import { generatePlanPdf } from "../lib/planPdf.js";
import { openai, AI_MODEL } from "@workspace/integrations-openai-ai-server";
import { SUPPLIERS } from "../data/suppliers.js";
import crypto from "crypto";

const router = Router();

function teamMemberCan(req: PartnerRequest, res: Response, permission: keyof TeamMemberPermissions): boolean {
  if (req.teamMemberId) {
    if (!req.teamMemberPermissions || !req.teamMemberPermissions[permission]) {
      res.status(403).json({ error: "forbidden", message: "You don't have permission to perform this action." });
      return false;
    }
  }
  return true;
}

// ─── Typed JSON shapes ────────────────────────────────────────────────────────

interface RecommendedService { service: string; description: string; vendor?: string; product?: string; }
interface RecommendedProduct { vendor: string; product: string; category: string; rationale: string; }
interface PlanContentShape {
  executiveSummary: string;
  currentEnvironment: string;
  keyFindings: string[];
  recommendedServices: RecommendedService[];
  recommendedProducts?: RecommendedProduct[];
  nextSteps: string[];
}
type QuestionnaireAnswers = Record<string, string | string[]>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generatePlanNumber(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `WP-${y}${m}-${rand}`;
}

function generateReviewToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function logEvent(planId: number, eventType: string, metadata: object = {}) {
  await db.insert(planActivityEventsTable).values({ planId, eventType, metadata });
}

// ─── Pain-point → service mapping ────────────────────────────────────────────

const PAIN_POINT_MAP: Record<string, { service: string; description: string }> = {
  downtime: {
    service: "Managed IT Support",
    description: "Proactive monitoring and rapid response to eliminate unplanned downtime and keep your systems running at full capacity.",
  },
  security: {
    service: "Cybersecurity Bundle",
    description: "Endpoint detection & response, threat monitoring, and security hardening to protect your business from modern threats.",
  },
  compliance: {
    service: "Compliance Services",
    description: "HIPAA, SOC 2, and CMMC program management to help you meet regulatory requirements and pass audits confidently.",
  },
  backup: {
    service: "Backup & Disaster Recovery",
    description: "Immutable, tested backups with rapid restore capabilities to ensure business continuity after any incident.",
  },
  email: {
    service: "Microsoft 365 Management",
    description: "Full administration of Microsoft 365, including security hardening, licensing, and user lifecycle management.",
  },
  remote: {
    service: "Remote Workforce Enablement",
    description: "Secure VPN, MFA, and collaboration tools to support a productive and protected distributed team.",
  },
  hardware: {
    service: "Hardware Lifecycle Management",
    description: "Procurement, deployment, and refresh planning so your team always has reliable, up-to-date equipment.",
  },
  cloud: {
    service: "Cloud Migration & Management",
    description: "Strategy, migration, and ongoing management of cloud workloads on Azure, AWS, or Microsoft 365.",
  },
  voip: {
    service: "VoIP & Unified Communications",
    description: "Modern phone systems that reduce costs, improve flexibility, and integrate with your business workflows.",
  },
  vendor: {
    service: "Vendor & ISP Management",
    description: "Single point of accountability for all your technology vendors, including ISP and telecom relationships.",
  },
};

function strVal(v: string | string[] | undefined): string {
  if (!v) return "";
  return Array.isArray(v) ? v[0] ?? "" : v;
}
function arrVal(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function parseId(raw: unknown): number | null {
  const n = parseInt(raw as string, 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

function resolveValidityDays(value: unknown, fallback = 30): number {
  const n = typeof value === "number" ? value : parseInt(value as string, 10);
  if (Number.isNaN(n) || n < 1 || n > 365) return fallback;
  return n;
}

// Map pain-point raw values → friendly labels for display in plan text
const PAIN_POINT_LABELS: Record<string, string> = Object.fromEntries(
  PAIN_POINT_OPTIONS.map(p => [p.value, p.label.toLowerCase()])
);

function painPointLabel(v: string): string {
  return PAIN_POINT_LABELS[v] || v;
}

function locationsPhrase(raw: string): string {
  if (!raw) return "your location(s)";
  const trimmed = raw.trim();
  if (trimmed === "1") return "1 location";
  return `${trimmed} locations`;
}

function generatePlanContent(answers: QuestionnaireAnswers): PlanContentShape {
  const company = strVal(answers.clientCompany) || strVal(answers.companyName) || "your company";
  const headcount = strVal(answers.headcount) || "your team";
  const locationsRaw = strVal(answers.locations);
  const locations = locationsPhrase(locationsRaw);
  const workstations = strVal(answers.workstations);
  const servers = strVal(answers.servers);
  const cloudPlatforms = arrVal(answers.cloudPlatforms);
  const existingItSupport = strVal(answers.existingItSupport);
  const painPoints = arrVal(answers.painPoints);
  const complianceNeeds = arrVal(answers.complianceNeeds).filter(c => c && c !== "None / Not applicable");
  const currentSetup = strVal(answers.currentItSetup).trim();
  const currentVendors = strVal(answers.currentVendors).trim();
  const priorities = arrVal(answers.priorities);
  const budget = strVal(answers.budgetRange) || null;
  const timeline = strVal(answers.preferredTimeline) || null;
  const mfaStatus = strVal(answers.mfaStatus);
  const endpointProtection = strVal(answers.endpointProtection).trim();
  const backupSolution = strVal(answers.backupSolution).trim();
  const lastAssessment = strVal(answers.lastAssessment);
  const cyberInsurance = strVal(answers.cyberInsurance);
  const hoursOfOperation = strVal(answers.hoursOfOperation);
  const afterHoursSupport = strVal(answers.afterHoursSupport);
  const ticketVolume = strVal(answers.ticketVolume);
  const growthHeadcount = strVal(answers.growthHeadcount).trim();
  const plannedProjects = strVal(answers.plannedProjects).trim();

  // Map pain points to recommended services
  const recommendedServices: { service: string; description: string }[] = [];
  const seen = new Set<string>();

  function addService(svc: { service: string; description: string }) {
    if (!seen.has(svc.service)) {
      seen.add(svc.service);
      recommendedServices.push(svc);
    }
  }

  for (const pp of painPoints) {
    const key = pp.toLowerCase().replace(/[^a-z]/g, "");
    for (const [mapKey, val] of Object.entries(PAIN_POINT_MAP)) {
      if (key.includes(mapKey)) addService(val);
    }
  }

  if (complianceNeeds.length > 0) addService(PAIN_POINT_MAP.compliance);

  // Posture-driven recommendations
  const mfaWeak = mfaStatus.startsWith("No") || mfaStatus.startsWith("Partial") || mfaStatus.startsWith("Unsure");
  if (mfaWeak || /never|unsure|more than/i.test(lastAssessment)) {
    addService(PAIN_POINT_MAP.security);
  }
  if (!backupSolution || /none/i.test(backupSolution)) {
    addService(PAIN_POINT_MAP.backup);
  }
  if (cloudPlatforms.includes("Microsoft 365") || cloudPlatforms.includes("Google Workspace")) {
    addService(PAIN_POINT_MAP.email);
  }
  if (afterHoursSupport.startsWith("Yes") || hoursOfOperation.includes("24x7") || hoursOfOperation.includes("Extended")) {
    addService(PAIN_POINT_MAP.downtime);
  }

  if (recommendedServices.length === 0) {
    addService(PAIN_POINT_MAP.downtime);
    addService(PAIN_POINT_MAP.security);
  }

  // Build environment description
  const envParts: string[] = [];
  if (workstations) envParts.push(`${workstations} workstations / laptops`);
  if (servers) envParts.push(`${servers} on-prem server${servers.startsWith("0") || servers.startsWith("1-2") ? "" : "s"}`);
  if (cloudPlatforms.length > 0) envParts.push(`cloud: ${cloudPlatforms.join(", ")}`);
  if (existingItSupport) envParts.push(`current support model: ${existingItSupport.toLowerCase()}`);
  const envSummary = envParts.length > 0 ? envParts.join("; ") : "";

  const keyFindings: string[] = [
    `${company} operates with approximately ${headcount} employees across ${locations}.`,
    ...(envSummary ? [`Environment snapshot — ${envSummary}.`] : []),
    ...(painPoints.length > 0
      ? [`Key challenges identified: ${painPoints.map(painPointLabel).join(", ")}.`]
      : ["General IT optimization opportunities were identified during assessment."]),
    ...(mfaStatus
      ? [`MFA posture: ${mfaStatus.toLowerCase()}.`]
      : []),
    ...(backupSolution
      ? [`Current backup solution: ${backupSolution}.`]
      : ["No formal backup solution noted — disaster recovery gap identified."]),
    ...(endpointProtection
      ? [`Endpoint protection: ${endpointProtection}.`]
      : []),
    ...(lastAssessment
      ? [`Last security assessment: ${lastAssessment.toLowerCase()}.`]
      : []),
    ...(cyberInsurance
      ? [`Cyber insurance status: ${cyberInsurance.toLowerCase()}.`]
      : []),
    ...(complianceNeeds.length > 0
      ? [`Compliance obligations noted: ${complianceNeeds.join(", ")}.`]
      : []),
    ...(hoursOfOperation
      ? [`Operating hours: ${hoursOfOperation.toLowerCase()}${afterHoursSupport ? `; after-hours support: ${afterHoursSupport.toLowerCase()}` : ""}.`]
      : []),
    ...(ticketVolume
      ? [`Estimated ticket volume: ${ticketVolume.toLowerCase()}.`]
      : []),
    ...(growthHeadcount
      ? [`Projected headcount in 12 months: ${growthHeadcount}.`]
      : []),
    ...(plannedProjects
      ? [`Major projects planned: ${plannedProjects}.`]
      : []),
    ...(currentVendors
      ? [`Key vendors / tools in use: ${currentVendors}.`]
      : []),
    ...(currentSetup
      ? [`Additional notes: ${currentSetup}.`]
      : []),
    ...(priorities.length > 0
      ? [`Top priorities expressed: ${priorities.join(", ")}.`]
      : []),
  ];

  const nextSteps = [
    "Schedule a discovery call with your Siebert Services account executive to finalize service scope.",
    "Review and sign this written plan to formally begin the engagement.",
    "Siebert Services will conduct a full technical onboarding within 5 business days of agreement.",
    ...(budget ? [`Budget alignment discussion based on your stated range of ${budget}.`] : []),
    ...(timeline ? [`Target go-live aligned to your preferred timeline: ${timeline}.`] : []),
  ];

  const envSentence = envSummary ? ` The environment snapshot includes ${envSummary}.` : "";
  const notesSentence = currentSetup ? ` Additional notes: ${currentSetup}` : "";

  return {
    executiveSummary: `This IT assessment plan has been prepared for ${company} following a discovery session with Siebert Services. Based on our evaluation of your current environment, security posture, support model, and business objectives, this document outlines key findings, recommended services, and a clear path forward to modernize and secure your technology infrastructure. Siebert Services is committed to delivering measurable improvements in uptime, security, and operational efficiency for your organization.`,
    currentEnvironment: `${company} maintains an IT environment supporting approximately ${headcount} employees across ${locations}.${envSentence}${notesSentence} This assessment identifies areas where targeted improvements will deliver the greatest business value.`,
    keyFindings,
    recommendedServices,
    recommendedProducts: [],
    nextSteps,
  };
}

// ─── Consumer plan content generation ────────────────────────────────────────

const CONSUMER_PAIN_POINT_LABELS: Record<string, string> = {
  slow_internet:  "slow or unreliable internet",
  cybersecurity:  "cybersecurity / virus concerns",
  smart_home:     "smart home connectivity issues",
  tech_support:   "general tech support",
  identity_theft: "identity theft / fraud concerns",
  home_security:  "home security / surveillance",
  privacy:        "online privacy",
  device_mgmt:    "managing multiple devices",
};

const CONSUMER_PRODUCT_MAP: Record<string, { vendor: string; product: string; category: string; rationale: string }> = {
  slow_internet:  { vendor: "Comcast Xfinity", product: "Xfinity Gigabit Internet + xFi Gateway", category: "Home Internet", rationale: "Gigabit download speeds with the xFi Gateway router eliminate dead zones and provide whole-home Wi-Fi coverage for all connected devices." },
  cybersecurity:  { vendor: "Bitdefender", product: "Bitdefender Total Security (5 devices)", category: "Personal Security", rationale: "Award-winning antivirus, anti-malware, and ransomware protection for up to 5 household devices, with real-time threat monitoring and built-in VPN." },
  smart_home:     { vendor: "Google Nest", product: "Google Nest Hub Max", category: "Smart Home Hub", rationale: "Central smart home control hub with a 10-inch display, built-in security camera, and seamless integration with existing smart home devices." },
  tech_support:   { vendor: "Siebert Services", product: "Residential Support Plan (Unlimited Remote)", category: "Tech Support", rationale: "Unlimited remote support sessions for all household devices — computers, phones, tablets, and smart TVs — with guaranteed response times." },
  identity_theft: { vendor: "LifeLock", product: "LifeLock Ultimate Plus", category: "Identity Protection", rationale: "Comprehensive identity monitoring with up to $1M in identity theft expense coverage, dark-web scanning, and U.S.-based remediation specialists." },
  home_security:  { vendor: "Vivint", product: "Vivint Smart Home Security System", category: "Home Security", rationale: "Professionally installed security cameras, smart doorbell, motion sensors, and 24/7 professional monitoring — all managed from one mobile app." },
  privacy:        { vendor: "NordVPN", product: "NordVPN Plus (Annual Plan)", category: "Privacy / VPN", rationale: "Military-grade encryption across all household devices with a strict no-logs policy, threat protection, and a dedicated IP option." },
  device_mgmt:    { vendor: "Siebert Services", product: "Home Device Management Suite", category: "Device Management", rationale: "Automated security patches, software updates, and remote health monitoring across all household devices so nothing falls behind." },
};

const CONSUMER_PAIN_POINT_SERVICE_MAP: Record<string, { service: string; description: string }> = {
  slow_internet:  { service: "Home Internet Optimization", description: "Wi-Fi audit, router upgrade recommendations, and ISP plan review to get the fastest, most reliable connection for your home." },
  cybersecurity:  { service: "Personal Cybersecurity Bundle", description: "Antivirus, password manager, and threat-monitoring tools to protect all household devices from malware, phishing, and ransomware." },
  smart_home:     { service: "Smart Home Setup & Support", description: "Device pairing, network segmentation for IoT devices, and ongoing support to keep your smart home running smoothly." },
  tech_support:   { service: "Residential Tech Support", description: "On-demand remote or on-site help for computers, phones, tablets, printers, and software — whenever you need it." },
  identity_theft: { service: "Identity Protection Monitoring", description: "Continuous dark-web monitoring, credit alerts, and recovery assistance to protect your personal information and financial identity." },
  home_security:  { service: "Home Security System", description: "Professional-grade cameras, smart doorbell, motion sensors, and 24/7 monitoring to keep your family and property safe." },
  privacy:        { service: "Privacy & VPN Protection", description: "VPN setup, browser privacy hardening, and data-broker opt-out assistance to keep your online activity private." },
  device_mgmt:    { service: "Device Management & Setup", description: "Setup, update, and maintenance of all household devices — phones, tablets, computers, and smart TVs — so everything works together." },
};

function generateConsumerPlanContent(answers: QuestionnaireAnswers): PlanContentShape {
  const clientName  = strVal(answers.clientName)  || "the client";
  const numDevices  = strVal(answers.numDevices);
  const speed       = strVal(answers.internetSpeed);
  const networkQuality = strVal(answers.homeNetworkQuality);
  const provider    = strVal(answers.internetProvider);
  const smartDevices = arrVal(answers.smartHomeDevices).filter(d => d && d !== "None");
  const antivirus   = strVal(answers.consumerAntivirus);
  const alarm       = strVal(answers.homeAlarmSystem);
  const idProtect   = strVal(answers.identityProtection);
  const securityTools = strVal(answers.currentSecurityTools).trim();
  const painPoints  = arrVal(answers.consumerPainPoints);
  const priorities  = arrVal(answers.consumerPriorities);
  const budget      = strVal(answers.budgetRange) || null;
  const timeline    = strVal(answers.preferredTimeline) || null;
  const additionalContext = strVal(answers.additionalContext).trim();

  const recommendedServices: { service: string; description: string }[] = [];
  const recommendedProducts: { vendor: string; product: string; category: string; rationale: string }[] = [];
  const seenSvc = new Set<string>();
  const seenProd = new Set<string>();

  function addService(svc: { service: string; description: string }) {
    if (!seenSvc.has(svc.service)) { seenSvc.add(svc.service); recommendedServices.push(svc); }
  }
  function addProduct(prod: { vendor: string; product: string; category: string; rationale: string }) {
    if (!seenProd.has(prod.product)) { seenProd.add(prod.product); recommendedProducts.push(prod); }
  }

  for (const pp of painPoints) {
    const svc = CONSUMER_PAIN_POINT_SERVICE_MAP[pp];
    if (svc) addService(svc);
    const prod = CONSUMER_PRODUCT_MAP[pp];
    if (prod) addProduct(prod);
  }

  if (antivirus.startsWith("No") || antivirus.startsWith("Unsure")) {
    addService(CONSUMER_PAIN_POINT_SERVICE_MAP.cybersecurity);
    addProduct(CONSUMER_PRODUCT_MAP.cybersecurity);
  }
  if (alarm.startsWith("No") || alarm.startsWith("Considering")) {
    addService(CONSUMER_PAIN_POINT_SERVICE_MAP.home_security);
    addProduct(CONSUMER_PRODUCT_MAP.home_security);
  }
  if (idProtect.startsWith("No") || idProtect.startsWith("Considering")) {
    addService(CONSUMER_PAIN_POINT_SERVICE_MAP.identity_theft);
    addProduct(CONSUMER_PRODUCT_MAP.identity_theft);
  }
  if (networkQuality && (networkQuality.startsWith("Poor") || networkQuality.startsWith("Okay"))) {
    addService(CONSUMER_PAIN_POINT_SERVICE_MAP.slow_internet);
    addProduct(CONSUMER_PRODUCT_MAP.slow_internet);
  }

  if (recommendedServices.length === 0) {
    addService(CONSUMER_PAIN_POINT_SERVICE_MAP.cybersecurity);
    addService(CONSUMER_PAIN_POINT_SERVICE_MAP.tech_support);
    addProduct(CONSUMER_PRODUCT_MAP.cybersecurity);
    addProduct(CONSUMER_PRODUCT_MAP.tech_support);
  }

  const keyFindings: string[] = [
    ...(numDevices ? [`Household has approximately ${numDevices} connected devices requiring protection and support.`] : []),
    ...(speed ? [`Current home internet speed: ${speed}.`] : []),
    ...(networkQuality ? [`Network reliability rating: ${networkQuality.toLowerCase()}.`] : []),
    ...(provider ? [`Current internet provider: ${provider}.`] : []),
    ...(smartDevices.length > 0 ? [`Smart home devices in use: ${smartDevices.join(", ")}.`] : []),
    ...(antivirus ? [`Antivirus / security software: ${antivirus.toLowerCase()}.`] : ["No formal antivirus software noted — endpoint protection gap identified."]),
    ...(alarm ? [`Home alarm / security system: ${alarm.toLowerCase()}.`] : []),
    ...(idProtect ? [`Identity protection status: ${idProtect.toLowerCase()}.`] : []),
    ...(securityTools ? [`Other security tools in use: ${securityTools}.`] : []),
    ...(painPoints.length > 0 ? [`Key concerns identified: ${painPoints.map(p => CONSUMER_PAIN_POINT_LABELS[p] || p).join(", ")}.`] : []),
    ...(priorities.length > 0 ? [`Top priorities: ${priorities.join(", ")}.`] : []),
    ...(additionalContext ? [`Additional context: ${additionalContext}.`] : []),
  ].filter(Boolean);

  if (keyFindings.length === 0) keyFindings.push("A general home technology assessment was conducted to identify improvement opportunities.");

  const envParts: string[] = [];
  if (numDevices) envParts.push(`${numDevices} connected devices`);
  if (speed) envParts.push(`internet speed: ${speed}`);
  if (provider) envParts.push(`provider: ${provider}`);
  if (smartDevices.length > 0) envParts.push(`smart home devices: ${smartDevices.slice(0, 3).join(", ")}${smartDevices.length > 3 ? " and more" : ""}`);

  const envSummary = envParts.length > 0 ? ` The home setup includes: ${envParts.join("; ")}.` : "";

  const nextSteps = [
    "Schedule a quick consultation with your Siebert Services advisor to review this plan.",
    "Review and approve this plan to begin your technology service journey.",
    "Siebert Services will reach out within 1-2 business days to arrange onboarding.",
    ...(budget ? [`Budget alignment discussion based on your stated range of ${budget}.`] : []),
    ...(timeline ? [`Target go-live aligned to your preferred timeline: ${timeline}.`] : []),
  ];

  return {
    executiveSummary: `This residential technology plan has been prepared for ${clientName} by Siebert Services following a home technology discovery session. Based on our evaluation of your home setup, connected devices, security posture, and personal goals, this document outlines key findings, recommended services, and a clear path to a safer, faster, and more reliable home technology experience.`,
    currentEnvironment: `${clientName}'s home technology environment has been assessed as part of this engagement.${envSummary} This plan identifies targeted improvements to deliver the best value and peace of mind.`,
    keyFindings,
    recommendedServices,
    recommendedProducts,
    nextSteps,
  };
}

// ─── AI-assisted plan content generation ─────────────────────────────────────

const PLAN_CONTENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    executiveSummary: {
      type: "string",
      description: "2-4 sentences. Professional, consultative tone. References the client by name and summarizes the engagement and what this plan delivers. No marketing fluff.",
    },
    currentEnvironment: {
      type: "string",
      description: "2-4 sentences. Describes the client's current IT environment in plain prose: headcount, locations, on-prem vs cloud footprint, support model, and any notable posture details. Uses information from the questionnaire only — never invent specifics.",
    },
    keyFindings: {
      type: "array",
      minItems: 4,
      maxItems: 12,
      items: { type: "string", description: "One concise finding per item, ~10-25 words. Each finding should be specific and grounded in the questionnaire data." },
    },
    recommendedServices: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["service", "description", "vendor", "product"],
        properties: {
          service: { type: "string", description: "Short Siebert service name, verbatim from the service catalog, e.g. 'Cybersecurity Bundle', 'Microsoft 365 Management', 'Backup & Disaster Recovery'." },
          description: { type: "string", description: "1-2 sentences explaining why this service is recommended for this client (cite the questionnaire signal) and what is included." },
          vendor: { type: "string", description: "Vendor name (verbatim from the Siebert vendor catalog) of the specific product Siebert will use to deliver this service, e.g. 'Microsoft 365 Defender', 'Datto (Kaseya)', 'Microsoft 365 (Teams Phone)', 'Cisco Meraki'." },
          product: { type: "string", description: "Specific product / SKU / tier (verbatim from the catalog) that delivers this service, e.g. 'Defender for Endpoint Plan 2', 'Datto SaaS Protection (M365 / Google Workspace backup)', 'Teams Phone Standard', 'Meraki MX85 + MR46 access points'." },
        },
      },
    },
    recommendedProducts: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      description: "Specific vendor products from the Siebert vendor catalog that pair with the recommended services. Use vendor and product names verbatim from the catalog. Pick products that fit the client's stated environment, scale, compliance needs, and pain points. Do NOT invent vendors or products not in the catalog.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["vendor", "product", "category", "rationale"],
        properties: {
          vendor: { type: "string", description: "Vendor name exactly as it appears in the Siebert vendor catalog, e.g. 'Comcast Business', 'RingCentral', 'Microsoft 365', 'Cisco Meraki'." },
          product: { type: "string", description: "Specific product / SKU / tier from that vendor, e.g. 'Business Internet Gigabit Extra (1.25 Gbps)', 'RingEX Advanced', 'Microsoft 365 Business Premium', 'Meraki MX85 + MR46 access points'." },
          category: { type: "string", description: "Short category label, e.g. 'Internet / Connectivity', 'UCaaS / Phone System', 'Endpoint Security', 'Backup / DR', 'SD-WAN / Networking', 'Productivity Suite'." },
          rationale: { type: "string", description: "1-2 sentences explaining why this specific product fits this client's stated needs (reference the questionnaire data: location count, headcount, compliance, pain point, etc.)." },
        },
      },
    },
    nextSteps: {
      type: "array",
      minItems: 3,
      maxItems: 7,
      items: { type: "string", description: "One actionable next step per item." },
    },
  },
  required: ["executiveSummary", "currentEnvironment", "keyFindings", "recommendedServices", "recommendedProducts", "nextSteps"],
} as const;

// ─── Build the full vendor catalog from the suppliers data file ──────────────
// Auto-generated so it stays in sync with `data/suppliers.ts` (≈280 vendors).
// We keep the curated, grouped "preferred / common" section first to anchor
// the AI on what to reach for in typical IT-assessment scenarios, then list
// the long-tail catalog below so the AI can recommend any specialty vendor.
const FULL_SUPPLIER_CATALOG = SUPPLIERS
  .map(s => `- ${s.name} [${s.industry}] — ${s.keyProducts}`)
  .join("\n");

const SIEBERT_VENDOR_CATALOG = `Siebert Services partners with these vendors. When recommending products, use the vendor name and product/SKU verbatim from this catalog. Do NOT invent vendors or products that are not listed.

INTERNET / CONNECTIVITY (ISP & dedicated fiber)
- Comcast Business — Internet tiers (300 Mbps, 500 Mbps, 1.25 Gbps, 2 Gbps), Comcast Business Mobile, Ethernet Dedicated Internet (EDI), SecurityEdge, ActiveCore SD-WAN.
- Spectrum Business — Fiber-Powered Internet, Business Internet (300 Mbps – 1 Gbps), Dedicated Fiber Internet (up to 100 Gbps), Managed SD-WAN, Business Voice.
- AT&T Business — AT&T Business Fiber (up to 5 Gbps symmetric), AT&T Dedicated Internet (ADI), AT&T Business Internet Air (FWA), AT&T VPN (AVPN), AT&T Switched Ethernet, FirstNet.
- Verizon Business — Verizon Business Internet (Fios), Verizon Business 5G Internet, Private 5G Network, DDoS Shield, Verizon SD-WAN.
- Cox Business — Cox Business Internet (300 Mbps – 2 Gbps), Internet Backup (4G LTE), VoiceManager, Complete Care security, Managed WiFi.
- Lumen — Dynamic Connections, Fiber+ Internet, Lumen SASE, Managed Security Services, Edge Compute.
- T-Mobile Business — T-Mobile 5G Business Internet, Cradlepoint E300/W1850 routers, Business Unlimited wireless plans.
- Altice Business — Optimum Business Fiber (up to 5 Gbps), Optimum Business Hosted Voice, SD-WAN.
- AireSpring — Managed SD-WAN, Dedicated Internet Access (DIA), Managed Failover, AirePBX UCaaS, AireContact CCaaS.
- Bigleaf Networks — Bigleaf Cloud Connect (Essential, Premier, High Availability), Bigleaf Wireless Connect.
- 11:11 Systems — Managed Last-Mile, NaaS, SD-WAN, Global Cloud Native Backbone.

UCAAS / VOIP / PHONE SYSTEMS
- RingCentral — RingEX (Core, Advanced, Ultra), RingCX contact center, RingSense AI, AIR (AI Receptionist).
- 8x8 — 8x8 X Series (X2, X4, X6, X8), 8x8 Work, 8x8 Contact Center, 8x8 Engage.
- Microsoft 365 (Teams Phone) — Teams Phone Standard, Teams Phone with Calling Plan, Teams Premium.
- Dialpad — Dialpad Connect (Standard $15, Pro $25, Enterprise), Dialpad Support (AI Contact Center), Dialpad Sell, Dialpad Ai.
- Zoom — Zoom Phone (Metered, Unlimited Regional, Pro Global Select), Zoom Contact Center, Zoom Workplace.
- Vonage Business — Vonage Business Communications (Mobile, Premium, Advanced), Vonage Fusion, VBC SmartWAN.
- Nextiva — Nextiva NEXT Platform (Core $15, Engage $25, Scale $75), Contact Center Basic, NextOS.
- GoTo — GoTo Connect (Phone System, CX, Contact Center), GoTo Meeting, GoTo Webinar.
- Sangoma — Sangoma Phone, PBXact, FreePBX, Sangoma CX, Sangoma Meet.

PRODUCTIVITY / EMAIL / CLOUD WORKPLACE
- Microsoft 365 — Microsoft 365 Business Basic, Business Standard, Business Premium, Apps for Business, E3, E5.
- Google Workspace — Business Starter, Business Standard, Business Plus, Enterprise.
- Microsoft Azure — Azure Virtual Desktop (AVD), Azure Backup, Azure Site Recovery, Microsoft Sentinel.

SECURITY / EDR / MDR / EMAIL SECURITY
- Microsoft 365 Defender — Defender for Endpoint Plan 1/Plan 2, Defender for Office 365, Defender for Identity, Microsoft Sentinel.
- Fortinet — FortiGate firewalls (40F, 60F, 100F, 200F), FortiClient EMS, FortiEDR, FortiSASE.
- Palo Alto Networks — Cortex XDR, Cortex XSIAM, Prisma Access SASE, NGFW PA-Series.
- Cisco Meraki — MX security appliances (MX67, MX85, MX95, MX105), MS switches, MR access points, Meraki Systems Manager (MDM).
- Arctic Wolf — Arctic Wolf Managed Detection and Response (MDR), Managed Risk, Managed Security Awareness, Cloud Detection and Response.
- CrowdStrike — Falcon Go, Falcon Pro, Falcon Enterprise, Falcon Complete (managed XDR).
- SentinelOne — Singularity Core, Singularity Control, Singularity Complete, Singularity Commercial.
- Mimecast — Mimecast Email Security, Awareness Training, Archive, Brand Exploit Protect.
- Proofpoint — Proofpoint Essentials Business / Advanced / Professional (email security + awareness training for SMB).

NETWORKING / SD-WAN / WIFI HARDWARE
- Cisco Meraki — see Security; same vendor handles SD-WAN (MX appliances) and cloud-managed WiFi/switching.
- Extreme Networks — ExtremeCloud IQ, Universal Switching, ExtremeWireless access points, Extreme Fabric.
- Juniper Networks — Mist AI WiFi, EX Series switches, SRX firewalls, Apstra fabric automation.
- HP / Aruba — Aruba Instant On, Aruba Central, Aruba CX switches, Aruba Access Points.

BACKUP / DR / BUSINESS CONTINUITY
- Datto (Kaseya) — Datto SIRIS (BCDR appliance), Datto ALTO, Datto SaaS Protection (M365 / Google Workspace backup), Datto Cloud Continuity.
- Veeam — Veeam Data Platform (Foundation, Advanced, Premium), Veeam Backup for Microsoft 365, Veeam Cloud Connect.
- Acronis — Acronis Cyber Protect Cloud (Standard, Advanced, Premium), Acronis Cyber Backup.
- Rubrik — Rubrik Security Cloud, Rubrik Enterprise Edition, Rubrik for Microsoft 365.

HARDWARE / ENDPOINTS
- Dell — Dell Latitude / OptiPlex / Precision laptops & desktops, PowerEdge servers, ProSupport Plus.
- HP — HP EliteBook / ProBook laptops, HP Z workstations, HP ProLiant servers.

PHYSICAL SECURITY
- ADT Business — ADT Commercial intrusion, video surveillance, access control, fire monitoring.
- Vivint — Vivint Smart Business security and monitoring.

NOTE: When the client environment already lists a vendor (e.g., "Microsoft 365" in cloud platforms), prefer adjacent products from that same vendor before suggesting a switch. When a competing primary product is suggested, briefly justify the switch.

═══════════════════════════════════════════════════════════════════════════════
FULL VENDOR CATALOG (long tail — use these for specialty needs the curated list above does not cover, e.g., contact-center, IoT, data-center colocation, legal/practice-management, AV/digital-signage, OT/SCADA, public-safety, point-of-sale, etc.)
═══════════════════════════════════════════════════════════════════════════════

${FULL_SUPPLIER_CATALOG}`;

const SIEBERT_SERVICE_CATALOG = `Siebert Services offers these service lines (use names verbatim when recommending; do not invent new ones):
- Managed IT Support — proactive monitoring, helpdesk, rapid incident response.
- Cybersecurity Bundle — EDR, threat monitoring, security hardening, MFA enforcement.
- Compliance Services — HIPAA, SOC 2, CMMC program management.
- Microsoft 365 Management — full M365 administration, security, licensing.
- Cloud Migration & Management — Azure / AWS / M365 strategy and migration.
- Backup & Disaster Recovery — immutable, tested backups with rapid restore.
- VoIP & Unified Communications — modern phone systems and integrations.
- Vendor & ISP Management — single point of accountability for tech vendors.
- Hardware Lifecycle Management — procurement, deployment, refresh planning.
- Remote Workforce Enablement — secure VPN, MFA, collaboration tools.`;

async function generatePlanContentAI(
  answers: QuestionnaireAnswers,
  meta: { clientCompany: string; clientName: string },
): Promise<PlanContentShape> {
  const systemPrompt = `You are a senior IT consultant at Siebert Services LLC, a U.S. managed services provider. Your job is to write a concise, professional, contract-grade IT Assessment and Written Plan for a prospective client based on their discovery questionnaire answers.

Tone: consultative, factual, restrained. Avoid marketing language ("cutting-edge", "world-class", "leverage", "synergy"). Avoid hyperbole. Write the way a Big-4 consultant or attorney would.

GROUNDING RULES (most important — every recommendation must be traceable to the questionnaire):
- Every key finding, every recommended service, and every recommended product MUST be directly justified by a specific answer in the questionnaire. If a fact is not in the answers, you may NOT use it.
- Never invent client-specific facts: headcount, locations, workstations, server count, cloud platforms, vendors in use, compliance scope, MFA status, backup status, ticket volume, hours of operation, budget, timeline, planned projects — these come ONLY from the answers.
- EACH recommended service MUST name the specific Siebert vendor product/SKU (vendor + product, verbatim from the catalog) that Siebert will use to deliver that service. A service without a concrete product is not acceptable. Example: service "Backup & Disaster Recovery" → vendor "Datto (Kaseya)", product "Datto SaaS Protection (M365 / Google Workspace backup)".
- For EACH recommended product and EACH recommended service, the rationale/description must explicitly reference the questionnaire signal that triggered it. Use any signal in the answers, including (when present): primary internet speed, internet redundancy/failover, firewall in use, WiFi infrastructure, current phone system, number of phone users, contact-center needs, email security in place, MDR/SOC monitoring, security awareness training, hardware age, mobile device management (MDM), physical security in place, industry/specialty software, headcount, locations, servers, cloud platforms, MFA status, backup solution, compliance requirements, ticket volume, hours of operation, after-hours support, pain points, priorities, budget, and timeline. If you cannot tie a recommendation to a specific answer, do NOT include it.
- Match product scale to client size: do not recommend enterprise-tier products to a 5-person company; do not recommend small-business tiers to a 500-person multi-site company. Use headcount, location count, server count, and ticket volume from the answers to pick the right tier.
- When the client already lists a vendor in the answers (e.g., Microsoft 365 in cloudPlatforms, "Spectrum Business 300 Mbps" in currentVendors), prefer adjacent products from THAT same vendor before suggesting a competing vendor. If you do recommend a switch, the rationale must explain why based on a stated pain point or stated priority.
- If the answers say a control is already in place (e.g., MFA "Yes - everywhere", a documented backup solution, EDR already deployed), do NOT recommend duplicating it. Recommend complementary or higher-tier products only when there is a stated gap or stated priority for improvement.

WRITING RULES:
- Use ONLY information present in the questionnaire answers. No outside facts about the client.
- Reference the client by their company name where natural. Address them in second person sparingly ("your environment", "your team") — this document is read by the client.
- Do not mention pricing, fees, or dollar amounts unless the answers contain a budget range, in which case you may reference it neutrally.
- Recommend services from the Siebert service catalog only.
- Recommend specific vendor products from the Siebert vendor catalog only — never invent vendors or product SKUs.
- Findings should be specific and grounded ("MFA is enforced everywhere" / "no formal backup solution noted") — not generic best-practice statements.
- Next steps are concrete actions for the next 1–2 weeks.

${SIEBERT_SERVICE_CATALOG}

${SIEBERT_VENDOR_CATALOG}`;

  const userPrompt = `Client company: ${meta.clientCompany}
Primary contact: ${meta.clientName}

Discovery questionnaire answers (JSON):
${JSON.stringify(answers, null, 2)}

Generate the structured IT Assessment & Written Plan content. Return JSON matching the schema exactly.`;

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "plan_content",
        strict: true,
        schema: PLAN_CONTENT_JSON_SCHEMA,
      },
    },
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("AI returned empty content");
  const parsed = JSON.parse(raw) as PlanContentShape;
  if (
    !parsed.executiveSummary ||
    !parsed.currentEnvironment ||
    !Array.isArray(parsed.keyFindings) ||
    !Array.isArray(parsed.recommendedServices) ||
    !Array.isArray(parsed.nextSteps)
  ) {
    throw new Error("AI returned invalid plan content shape");
  }
  return parsed;
}

/**
 * Tries the AI generator first, falls back to the deterministic templated
 * generator if AI fails for any reason. Always returns a valid PlanContentShape.
 */
async function generatePlanContentSmart(
  answers: QuestionnaireAnswers,
  meta: { clientCompany: string; clientName: string },
): Promise<{ content: PlanContentShape; source: "ai" | "template"; error?: string }> {
  try {
    const content = await generatePlanContentAI(answers, meta);
    return { content, source: "ai" };
  } catch (err) {
    console.warn("[WrittenPlans] AI generation failed, falling back to template:", err);
    const content = generatePlanContent({ ...answers, clientCompany: meta.clientCompany, clientName: meta.clientName });
    return { content, source: "template", error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Partner email resolver ───────────────────────────────────────────────────

async function resolvePartnerEmail(partnerId: number | null): Promise<string | undefined> {
  if (!partnerId) return undefined;
  try {
    const [partner] = await db.select({ email: partnersTable.email }).from(partnersTable).where(eq(partnersTable.id, partnerId)).limit(1);
    return partner?.email || undefined;
  } catch { return undefined; }
}

// ─── Post-approval client portal provisioning ────────────────────────────────

async function triggerPostApprovalClientPortal(plan: typeof writtenPlansTable.$inferSelect): Promise<void> {
  // Issue a magic-link token for this client (revokes any existing active tokens)
  const tokenRow = await issueClientPortalToken({
    partnerId: plan.partnerId,
    planId: plan.id,
    clientEmail: plan.clientEmail,
    clientName: plan.clientName,
    clientCompany: plan.clientCompany,
  });

  // Create onboarding row (one per plan; idempotent on re-trigger)
  const [existing] = await db.select().from(clientOnboardingTable)
    .where(and(
      eq(clientOnboardingTable.planId, plan.id),
      eq(clientOnboardingTable.clientEmail, plan.clientEmail),
    )).limit(1);
  if (!existing) {
    await db.insert(clientOnboardingTable).values({
      partnerId: plan.partnerId,
      planId: plan.id,
      clientEmail: plan.clientEmail,
      clientCompany: plan.clientCompany,
      status: "in_progress",
      currentStep: "welcome",
      stepData: {},
    });
  }

  // Send the welcome + onboarding email
  const baseUrl = process.env.PARTNER_PORTAL_URL || "https://siebertrservices.com/partners";
  const dashboardUrl = `${baseUrl}/c/${tokenRow.token}`;
  const onboardingUrl = `${baseUrl}/c/${tokenRow.token}/onboarding`;
  const result = await sendClientPortalWelcomeEmail({
    clientName: plan.clientName,
    clientEmail: plan.clientEmail,
    clientCompany: plan.clientCompany,
    planNumber: plan.planNumber,
    dashboardUrl,
    onboardingUrl,
  });
  if (!result.ok) {
    console.error("[ClientPortal] welcome email failed:", result.error, result.errorMessage);
  }
}

// ─── Partner/Admin Routes ────────────────────────────────────────────────────

router.get("/partner/plans", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  try {
    const partnerId = req.partnerId!;
    const { status, limit: limitParam, offset: offsetParam } = req.query as Record<string, string | undefined>;
    const VALID_STATUSES = ["draft", "sent", "viewed", "approved", "declined", "call_requested"];
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: "invalid_status", message: `status must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }
    const limit = Math.min(Math.max(parseInt(limitParam || "500", 10) || 500, 1), 1000);
    const offset = Math.max(parseInt(offsetParam || "0", 10) || 0, 0);
    const partnerFilter = partnerId !== MAIN_SITE_ADMIN_SENTINEL ? eq(writtenPlansTable.partnerId, partnerId) : undefined;
    const statusFilter = status ? eq(writtenPlansTable.status, status) : undefined;
    const where = partnerFilter && statusFilter ? and(partnerFilter, statusFilter) : partnerFilter ?? statusFilter;
    const plans = await db.select().from(writtenPlansTable)
      .where(where)
      .orderBy(desc(writtenPlansTable.createdAt))
      .limit(limit)
      .offset(offset);
    res.json({ plans });
  } catch (err) {
    console.error("[WrittenPlans] list error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/partner/plans/:id", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "invalid_id", message: "Invalid plan ID" }); return; }
    const [plan] = await db.select().from(writtenPlansTable).where(eq(writtenPlansTable.id, id)).limit(1);
    if (!plan) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && plan.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    const events = await db.select().from(planActivityEventsTable)
      .where(eq(planActivityEventsTable.planId, id))
      .orderBy(planActivityEventsTable.createdAt);
    // Build complete revision lineage: root plan + all children
    const rootId = plan.parentPlanId ?? plan.id;
    const rootFetch = plan.parentPlanId
      ? db.select().from(writtenPlansTable).where(eq(writtenPlansTable.id, rootId)).limit(1)
      : Promise.resolve([plan]);
    const childrenFetch = db.select().from(writtenPlansTable)
      .where(eq(writtenPlansTable.parentPlanId, rootId))
      .orderBy(writtenPlansTable.version);
    const [[rootPlan], children] = await Promise.all([rootFetch, childrenFetch]);
    const revisions = rootPlan
      ? [rootPlan, ...children].sort((a, b) => a.version - b.version)
      : children.sort((a, b) => a.version - b.version);
    res.json({ plan, events, revisions });
  } catch (err) {
    console.error("[WrittenPlans] get error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/partner/plans/draft", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const { clientName, clientEmail, clientTitle, clientCompany, clientPhone, questionnaireAnswers, onBehalfOfPartnerId, planType } = req.body;
    const isConsumer = planType === "consumer";
    const effectiveCompany = isConsumer ? (clientCompany || "Individual / Residential") : clientCompany;
    if (!clientName || !clientEmail || !effectiveCompany) {
      res.status(400).json({ error: "validation_error", message: "clientName and clientEmail are required" });
      return;
    }
    const planNumber = generatePlanNumber();
    let effectivePartnerId: number | null = req.partnerId === MAIN_SITE_ADMIN_SENTINEL ? null : req.partnerId ?? null;
    if (req.partnerId === MAIN_SITE_ADMIN_SENTINEL && onBehalfOfPartnerId && typeof onBehalfOfPartnerId === "number") {
      const [partnerExists] = await db.select({ id: partnersTable.id }).from(partnersTable).where(eq(partnersTable.id, onBehalfOfPartnerId)).limit(1);
      if (!partnerExists) {
        res.status(400).json({ error: "invalid_partner", message: "onBehalfOfPartnerId does not refer to an existing partner" });
        return;
      }
      effectivePartnerId = onBehalfOfPartnerId;
    }
    const [plan] = await db.insert(writtenPlansTable).values({
      partnerId: effectivePartnerId,
      planNumber,
      clientName, clientEmail,
      clientTitle: clientTitle || null,
      clientCompany: effectiveCompany, clientPhone: clientPhone || null,
      questionnaireAnswers: questionnaireAnswers || {},
      planContent: {},
      validityDays: 30,
      planType: isConsumer ? "consumer" : "business",
    }).returning();
    await logEvent(plan.id, "created", { planNumber, draft: true });
    res.status(201).json({ plan });
  } catch (err) {
    console.error("[WrittenPlans] draft create error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/partner/plans", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const { clientName, clientEmail, clientTitle, clientCompany, clientPhone, questionnaireAnswers, validityDays, onBehalfOfPartnerId, planType } = req.body;
    const isConsumer = planType === "consumer";
    const effectiveCompany = isConsumer ? (clientCompany || "Individual / Residential") : clientCompany;
    if (!clientName || !clientEmail || !effectiveCompany) {
      res.status(400).json({ error: "validation_error", message: "clientName and clientEmail are required" });
      return;
    }
    // For business plans, validate required questionnaire fields; consumer plans use their own simpler flow
    if (!isConsumer) {
      const qaErrors = validateQuestionnaireAnswers({ ...(questionnaireAnswers || {}), clientName, clientEmail, clientCompany: effectiveCompany });
      if (qaErrors.length > 0) {
        res.status(400).json({ error: "validation_error", message: qaErrors.join("; ") });
        return;
      }
    }
    const qa = (questionnaireAnswers as QuestionnaireAnswers) ?? {};
    let planContent: PlanContentShape;
    let contentSource: string;
    if (isConsumer) {
      planContent = generateConsumerPlanContent(qa);
      contentSource = "template";
    } else {
      const result = await generatePlanContentSmart(qa, { clientCompany: effectiveCompany, clientName });
      planContent = result.content;
      contentSource = result.source;
    }
    const planNumber = generatePlanNumber();
    // Admin can create on behalf of a specific partner
    let effectivePartnerId: number | null = req.partnerId === MAIN_SITE_ADMIN_SENTINEL ? null : req.partnerId ?? null;
    if (req.partnerId === MAIN_SITE_ADMIN_SENTINEL && onBehalfOfPartnerId && typeof onBehalfOfPartnerId === "number") {
      const [partnerExists] = await db.select({ id: partnersTable.id }).from(partnersTable).where(eq(partnersTable.id, onBehalfOfPartnerId)).limit(1);
      if (!partnerExists) {
        res.status(400).json({ error: "invalid_partner", message: "onBehalfOfPartnerId does not refer to an existing partner" });
        return;
      }
      effectivePartnerId = onBehalfOfPartnerId;
    }
    const [plan] = await db.insert(writtenPlansTable).values({
      partnerId: effectivePartnerId,
      planNumber,
      clientName, clientEmail,
      clientTitle: clientTitle || null,
      clientCompany: effectiveCompany, clientPhone: clientPhone || null,
      questionnaireAnswers: questionnaireAnswers || {},
      planContent,
      validityDays: resolveValidityDays(validityDays),
      planType: isConsumer ? "consumer" : "business",
    }).returning();
    await logEvent(plan.id, "created", { planNumber, contentSource });
    res.status(201).json({ plan, contentSource });
  } catch (err) {
    console.error("[WrittenPlans] create error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.put("/partner/plans/:id", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "invalid_id", message: "Invalid plan ID" }); return; }
    const [existing] = await db.select().from(writtenPlansTable).where(eq(writtenPlansTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && existing.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    if (existing.status === "approved") {
      res.status(400).json({ error: "cannot_edit_approved" }); return;
    }
    const { clientName, clientEmail, clientTitle, clientCompany, clientPhone, questionnaireAnswers, planContent, validityDays, personalNote } = req.body;
    const [plan] = await db.update(writtenPlansTable).set({
      clientName: clientName || existing.clientName,
      clientEmail: clientEmail || existing.clientEmail,
      clientTitle: clientTitle ?? existing.clientTitle,
      clientCompany: clientCompany || existing.clientCompany,
      clientPhone: clientPhone ?? existing.clientPhone,
      questionnaireAnswers: questionnaireAnswers ?? existing.questionnaireAnswers,
      planContent: planContent ?? existing.planContent,
      validityDays: validityDays != null ? resolveValidityDays(validityDays, existing.validityDays) : existing.validityDays,
      personalNote: personalNote ?? existing.personalNote,
      updatedAt: new Date(),
    }).where(eq(writtenPlansTable.id, id)).returning();
    res.json({ plan });
  } catch (err) {
    console.error("[WrittenPlans] update error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.put("/partner/plans/:id/regenerate", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "invalid_id", message: "Invalid plan ID" }); return; }
    const [existing] = await db.select().from(writtenPlansTable).where(eq(writtenPlansTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && existing.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    if (existing.status === "approved") {
      res.status(400).json({ error: "plan_approved", message: "Cannot regenerate an approved plan. Create a revision instead." });
      return;
    }
    const answers = (existing.questionnaireAnswers as QuestionnaireAnswers) ?? {};
    const isConsumerPlan = existing.planType === "consumer";
    let planContent: PlanContentShape;
    let contentSource: string;
    if (isConsumerPlan) {
      planContent = generateConsumerPlanContent(answers);
      contentSource = "template";
    } else {
      const result = await generatePlanContentSmart(
        answers,
        { clientCompany: existing.clientCompany, clientName: existing.clientName },
      );
      planContent = result.content;
      contentSource = result.source;
    }
    const [plan] = await db.update(writtenPlansTable).set({ planContent, updatedAt: new Date() })
      .where(eq(writtenPlansTable.id, id)).returning();
    await logEvent(plan.id, "regenerated", { contentSource });
    res.json({ plan, contentSource });
  } catch (err) {
    console.error("[WrittenPlans] regenerate error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/partner/plans/:id/send", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "invalid_id", message: "Invalid plan ID" }); return; }
    const [existing] = await db.select().from(writtenPlansTable).where(eq(writtenPlansTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && existing.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    if (["approved", "declined", "call_requested"].includes(existing.status)) {
      res.status(400).json({ error: "cannot_send_terminal", message: "Cannot resend a plan that has been approved, declined, or where a call has been requested. Create a revision instead." });
      return;
    }
    const existingContent = existing.planContent as PlanContentShape | null;
    if (!existingContent?.executiveSummary || !existingContent?.recommendedServices?.length) {
      res.status(400).json({ error: "plan_content_missing", message: "Plan content must be generated before sending. Use 'Generate Plan' first." });
      return;
    }
    const { personalNote, validityDays, clientEmail } = req.body;
    const token = generateReviewToken();
    const vdays = resolveValidityDays(validityDays, existing.validityDays || 30);
    const expiresAt = new Date(Date.now() + vdays * 86400000);
    const finalEmail = clientEmail || existing.clientEmail;

    const baseUrl = (process.env.PARTNER_PORTAL_URL || "https://siebertrservices.com/partners").replace(/\/$/, "");
    const reviewUrl = `${baseUrl}/plan-review/${token}`;

    const content = existing.planContent as PlanContentShape | null;

    const emailResult = await sendPlanReadyEmail({
      clientName: existing.clientName,
      clientEmail: finalEmail,
      company: existing.clientCompany,
      planNumber: existing.planNumber,
      reviewUrl,
      expiresAt,
      executiveSummary: content?.executiveSummary || "",
      personalNote: personalNote ?? existing.personalNote ?? undefined,
    });

    if (!emailResult.ok) {
      console.error(`[WrittenPlans] plan ${id} email failed (${emailResult.error}): ${emailResult.errorMessage}`);
      await logEvent(id, "send_failed", {
        reason: emailResult.error || "unknown",
        detail: emailResult.errorMessage || "",
        to: finalEmail,
      });
      const userMessage =
        emailResult.error === "smtp_not_configured"
          ? "Email is not configured on the server. Contact your administrator."
          : emailResult.error === "template_error"
          ? "Failed to build the plan email. Contact your administrator."
          : "The mail server rejected the message. Please try again or contact your administrator.";
      res.status(502).json({
        error: "email_send_failed",
        reason: emailResult.error,
        message: userMessage,
      });
      return;
    }

    const [plan] = await db.update(writtenPlansTable).set({
      status: "sent",
      reviewToken: token,
      expiresAt,
      validityDays: vdays,
      personalNote: personalNote ?? existing.personalNote,
      clientEmail: finalEmail,
      sentAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(writtenPlansTable.id, id)).returning();

    await logEvent(plan.id, "sent", { to: finalEmail });

    res.json({ plan, reviewUrl });
  } catch (err) {
    console.error("[WrittenPlans] send error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.put("/partner/plans/:id/extend", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "invalid_id", message: "Invalid plan ID" }); return; }
    const [existing] = await db.select().from(writtenPlansTable).where(eq(writtenPlansTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && existing.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    if (!["sent", "viewed"].includes(existing.status)) {
      res.status(400).json({ error: "invalid_status", message: "Only sent or viewed plans can have their deadline extended." });
      return;
    }
    const ALLOWED_DAYS = [7, 14, 30, 60];
    const raw = req.body?.validityDays;
    const days = typeof raw === "number" ? raw : parseInt(raw, 10);
    if (!ALLOWED_DAYS.includes(days)) {
      res.status(400).json({ error: "invalid_validity", message: "validityDays must be one of 7, 14, 30, 60." });
      return;
    }
    const previousExpiresAt = existing.expiresAt;
    const expiresAt = new Date(Date.now() + days * 86400000);

    // Rotate the review token on every extension. Reactivating the original
    // token would resurrect any previously delivered, forwarded, archived,
    // or compromised copies of the review URL the moment the deadline is
    // pushed out, which is exactly the replay risk an "extend" must close.
    // Treat extension as a fresh issuance event: mint a new token, retire
    // the old one, and notify the client with the replacement URL only.
    const newToken = generateReviewToken();
    const [plan] = await db.update(writtenPlansTable).set({
      expiresAt,
      validityDays: days,
      reviewToken: newToken,
      updatedAt: new Date(),
    }).where(eq(writtenPlansTable.id, id)).returning();

    const baseUrl = (process.env.PARTNER_PORTAL_URL || "https://siebertrservices.com/partners").replace(/\/$/, "");
    const reviewUrl = `${baseUrl}/plan-review/${newToken}`;

    // Notify the client with the replacement URL. We do not block the extend
    // operation on email delivery — the old token is already dead in the DB
    // (security objective met) and the partner can manually convey the new
    // link if email delivery fails.
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const content = plan.planContent as PlanContentShape | null;
      const result = await sendPlanReadyEmail({
        clientName: plan.clientName,
        clientEmail: plan.clientEmail,
        company: plan.clientCompany,
        planNumber: plan.planNumber,
        reviewUrl,
        expiresAt,
        executiveSummary: content?.executiveSummary || "",
        personalNote: plan.personalNote ?? undefined,
      });
      emailSent = result.ok;
      if (!result.ok) emailError = result.error || "smtp_error";
    } catch (e: any) {
      emailError = e?.message || "send_failed";
      console.error(`[WrittenPlans] extend email failed for plan ${id}:`, e);
    }

    await logEvent(plan.id, "extended", {
      validityDays: days,
      newExpiresAt: expiresAt.toISOString(),
      previousExpiresAt: previousExpiresAt ? previousExpiresAt.toISOString() : null,
      tokenRotated: true,
      emailSent,
      emailError,
    });
    res.json({ plan, reviewUrl, emailSent, emailError });
  } catch (err) {
    console.error("[WrittenPlans] extend error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/partner/plans/:id/revise", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "invalid_id", message: "Invalid plan ID" }); return; }
    const [existing] = await db.select().from(writtenPlansTable).where(eq(writtenPlansTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && existing.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    const parentId = existing.parentPlanId || existing.id;
    const siblings = await db.select().from(writtenPlansTable).where(eq(writtenPlansTable.parentPlanId, parentId));
    const nextVersion = Math.max(existing.version, ...siblings.map(s => s.version)) + 1;
    const planNumber = generatePlanNumber();
    const [newPlan] = await db.insert(writtenPlansTable).values({
      partnerId: existing.partnerId,
      planNumber,
      version: nextVersion,
      parentPlanId: parentId,
      clientName: existing.clientName,
      clientEmail: existing.clientEmail,
      clientTitle: existing.clientTitle,
      clientCompany: existing.clientCompany,
      clientPhone: existing.clientPhone,
      questionnaireAnswers: existing.questionnaireAnswers as QuestionnaireAnswers,
      planContent: existing.planContent as PlanContentShape,
      validityDays: existing.validityDays,
      personalNote: existing.personalNote,
    }).returning();
    await logEvent(newPlan.id, "revised", { fromPlanId: id, fromVersion: existing.version });
    res.status(201).json({ plan: newPlan });
  } catch (err) {
    console.error("[WrittenPlans] revise error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/partner/plans/:id", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  if (!teamMemberCan(req, res, "canCreatePlans")) return;
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "invalid_id", message: "Invalid plan ID" }); return; }
    const [existing] = await db.select().from(writtenPlansTable).where(eq(writtenPlansTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && existing.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    if (existing.status === "approved") {
      res.status(400).json({ error: "cannot_delete_approved", message: "Approved plans cannot be deleted for audit retention." });
      return;
    }
    await db.delete(planActivityEventsTable).where(eq(planActivityEventsTable.planId, id));
    await db.delete(writtenPlansTable).where(eq(writtenPlansTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[WrittenPlans] delete error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ─── PDF Download ─────────────────────────────────────────────────────────────

router.get("/partner/plans/:id/pdf", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "invalid_id", message: "Invalid plan ID" }); return; }
    const [plan] = await db.select().from(writtenPlansTable).where(eq(writtenPlansTable.id, id)).limit(1);
    if (!plan) { res.status(404).json({ error: "not_found" }); return; }
    if (req.partnerId !== MAIN_SITE_ADMIN_SENTINEL && plan.partnerId !== req.partnerId) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    const pdfBuffer = await generatePlanPdf(plan);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="plan-${plan.planNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[WrittenPlans] PDF error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ─── Public Routes (token-based, no auth) ────────────────────────────────────

// Strip internal/sensitive fields before sending plan data to unauthenticated clients
function toPublicPlan(plan: typeof writtenPlansTable.$inferSelect, includeSignature: boolean) {
  return {
    id: plan.id,
    planNumber: plan.planNumber,
    version: plan.version,
    clientName: plan.clientName,
    clientEmail: plan.clientEmail,
    clientCompany: plan.clientCompany,
    clientTitle: plan.clientTitle,
    planContent: plan.planContent,
    questionnaireAnswers: plan.questionnaireAnswers,
    validityDays: plan.validityDays,
    status: plan.status,
    expiresAt: plan.expiresAt,
    personalNote: plan.personalNote,
    approvedAt: plan.approvedAt,
    signerName: plan.signerName,
    signerTitle: plan.signerTitle,
    signatureImage: includeSignature ? plan.signatureImage : null,
    declineReason: plan.declineReason,
    declineNote: plan.declineNote,
    createdAt: plan.createdAt,
  };
}

router.get("/public/plan-review/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const [plan] = await db.select().from(writtenPlansTable)
      .where(eq(writtenPlansTable.reviewToken, token)).limit(1);
    if (!plan) { res.status(404).json({ error: "not_found" }); return; }
    if (plan.expiresAt && plan.expiresAt < new Date()) {
      res.status(410).json({ error: "expired", message: "This plan link has expired." });
      return;
    }
    let responsePlan = plan;
    if (plan.status === "sent") {
      const [updatedPlan] = await db.update(writtenPlansTable).set({ status: "viewed", viewedAt: new Date(), updatedAt: new Date() })
        .where(eq(writtenPlansTable.id, plan.id)).returning();
      await logEvent(plan.id, "viewed");
      responsePlan = updatedPlan;
    }
    res.json({ plan: toPublicPlan(responsePlan, responsePlan.status === "approved"), expired: false });
  } catch (err) {
    console.error("[WrittenPlans] public get error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/public/plan-review/:token/sign", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { signerName, signerTitle, signatureImage } = req.body;
    if (!signerName || !signatureImage) {
      res.status(400).json({ error: "validation_error", message: "signerName and signatureImage are required" });
      return;
    }
    if (typeof signerName !== "string" || !signerName.trim()) {
      res.status(400).json({ error: "validation_error", message: "signerName must be a non-empty string" });
      return;
    }
    if (signerName.trim().length > 200) {
      res.status(400).json({ error: "validation_error", message: "signerName must be 200 characters or fewer" });
      return;
    }
    if (signerTitle !== undefined && signerTitle !== null && (typeof signerTitle !== "string" || signerTitle.length > 200)) {
      res.status(400).json({ error: "validation_error", message: "signerTitle must be a string of 200 characters or fewer" });
      return;
    }
    if (typeof signatureImage !== "string" || !signatureImage.startsWith("data:image/png;base64,")) {
      res.status(400).json({ error: "validation_error", message: "signatureImage must be a PNG base64 data URL (data:image/png;base64,...)" });
      return;
    }
    const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024;
    if (Buffer.byteLength(signatureImage, "utf8") > MAX_SIGNATURE_BYTES) {
      res.status(400).json({ error: "validation_error", message: "signatureImage exceeds the 5 MB size limit" });
      return;
    }
    const [plan] = await db.select().from(writtenPlansTable)
      .where(eq(writtenPlansTable.reviewToken, token)).limit(1);
    if (!plan) { res.status(404).json({ error: "not_found" }); return; }
    if (plan.expiresAt && plan.expiresAt < new Date()) {
      res.status(400).json({ error: "expired" }); return;
    }
    if (["approved", "declined", "call_requested"].includes(plan.status)) {
      res.status(400).json({ error: "already_responded" }); return;
    }
    const normalizedSignerName = signerName.trim();
    const normalizedSignerTitle = signerTitle ? signerTitle.trim() || null : null;
    // Atomic UPDATE: require the review_token to still be present in the WHERE
    // clause so two concurrent sign requests cannot both succeed on the same link.
    const [updated] = await db.update(writtenPlansTable).set({
      status: "approved",
      approvedAt: new Date(),
      signerName: normalizedSignerName,
      signerTitle: normalizedSignerTitle,
      signatureImage,
      reviewToken: null,
      updatedAt: new Date(),
    }).where(and(eq(writtenPlansTable.id, plan.id), eq(writtenPlansTable.reviewToken, token))).returning();
    if (!updated) {
      res.status(409).json({ error: "already_responded", message: "This review link has already been used." });
      return;
    }
    await logEvent(plan.id, "approved", { signerName: normalizedSignerName, signerTitle: normalizedSignerTitle });

    resolvePartnerEmail(updated.partnerId).then(partnerEmail =>
      sendPlanApprovedEmail(updated, partnerEmail).catch(e => console.error("[Email] plan approved error:", e))
    );

    // Provision client portal: issue magic-link token, create onboarding row, send welcome email.
    triggerPostApprovalClientPortal(updated).catch(e =>
      console.error("[ClientPortal] post-approval provisioning error:", e)
    );

    res.json({ success: true, plan: toPublicPlan(updated, true) });
  } catch (err) {
    console.error("[WrittenPlans] sign error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/public/plan-review/:token/decline", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { reason, note } = req.body;
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      res.status(400).json({ error: "validation_error", message: "A decline reason is required" });
      return;
    }
    const VALID_DECLINE_REASONS = [
      "Budget constraints",
      "Timing isn't right",
      "Going with another provider",
      "Scope doesn't match our needs",
      "Other",
    ];
    if (!VALID_DECLINE_REASONS.includes(reason.trim())) {
      res.status(400).json({ error: "validation_error", message: `Decline reason must be one of: ${VALID_DECLINE_REASONS.join(", ")}` });
      return;
    }
    if (note !== undefined && note !== null && (typeof note !== "string" || note.length > 2000)) {
      res.status(400).json({ error: "validation_error", message: "Decline note must be 2000 characters or fewer" });
      return;
    }
    const [plan] = await db.select().from(writtenPlansTable)
      .where(eq(writtenPlansTable.reviewToken, token)).limit(1);
    if (!plan) { res.status(404).json({ error: "not_found" }); return; }
    if (plan.expiresAt && plan.expiresAt < new Date()) {
      res.status(400).json({ error: "expired" }); return;
    }
    if (["approved", "declined", "call_requested"].includes(plan.status)) {
      res.status(400).json({ error: "already_responded" }); return;
    }
    // Atomic UPDATE: require the review_token in the WHERE clause so concurrent
    // decline/sign/call-request races cannot both commit on the same link.
    const [declineUpdated] = await db.update(writtenPlansTable).set({
      status: "declined",
      declineReason: reason.trim(),
      declineNote: note || null,
      reviewToken: null,
      updatedAt: new Date(),
    }).where(and(eq(writtenPlansTable.id, plan.id), eq(writtenPlansTable.reviewToken, token))).returning();
    if (!declineUpdated) {
      res.status(409).json({ error: "already_responded", message: "This review link has already been used." });
      return;
    }
    await logEvent(plan.id, "declined", { reason: reason.trim(), note });
    resolvePartnerEmail(plan.partnerId).then(partnerEmail =>
      sendPlanDeclinedEmail(plan, reason.trim(), note, partnerEmail).catch(e => console.error("[Email] plan declined error:", e))
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[WrittenPlans] decline error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/public/plan-review/:token/request-call", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const [plan] = await db.select().from(writtenPlansTable)
      .where(eq(writtenPlansTable.reviewToken, token)).limit(1);
    if (!plan) { res.status(404).json({ error: "not_found" }); return; }
    if (plan.expiresAt && plan.expiresAt < new Date()) {
      res.status(400).json({ error: "expired" }); return;
    }
    if (["approved", "declined", "call_requested"].includes(plan.status)) {
      res.status(400).json({ error: "already_responded" }); return;
    }
    // Atomic UPDATE: require the review_token in the WHERE clause so concurrent
    // requests cannot both succeed on the same bearer link.
    const [callUpdated] = await db.update(writtenPlansTable).set({ status: "call_requested", reviewToken: null, updatedAt: new Date() })
      .where(and(eq(writtenPlansTable.id, plan.id), eq(writtenPlansTable.reviewToken, token))).returning();
    if (!callUpdated) {
      res.status(409).json({ error: "already_responded", message: "This review link has already been used." });
      return;
    }
    await logEvent(plan.id, "call_requested");
    resolvePartnerEmail(plan.partnerId).then(partnerEmail =>
      sendPlanCallRequestedEmail(plan, partnerEmail).catch(e => console.error("[Email] call requested error:", e))
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[WrittenPlans] request-call error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/public/plan-review/:token/pdf", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const [plan] = await db.select().from(writtenPlansTable)
      .where(eq(writtenPlansTable.reviewToken, token)).limit(1);
    if (!plan) { res.status(404).json({ error: "not_found" }); return; }
    if (plan.status === "declined") {
      res.status(403).json({ error: "plan_declined", message: "PDF is unavailable for declined plans." });
      return;
    }
    if (plan.expiresAt && plan.expiresAt < new Date()) {
      res.status(410).json({ error: "expired", message: "This plan has expired." });
      return;
    }
    const pdfBuffer = await generatePlanPdf(plan);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="plan-${plan.planNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[WrittenPlans] public PDF error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ─── Reminder Cron ───────────────────────────────────────────────────────────

const REMINDER_ADVISORY_LOCK_ID = 202604211; // stable integer for pg advisory lock

export async function sendPlanExpiryReminders() {
  try {
    // Use a transaction-level advisory lock so acquire and unlock stay on the same
    // connection — automatically released on commit/rollback, no manual unlock needed
    await db.transaction(async (tx) => {
      const lockResult = await tx.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(${REMINDER_ADVISORY_LOCK_ID}) AS acquired`
      );
      const lockRow = lockResult.rows?.[0];
      if (!lockRow?.acquired) return;
      await runReminderBatch(tx);
    });
  } catch (err) {
    console.error("[WrittenPlans] reminder cron error:", err);
  }
}

async function runReminderBatch(qb: typeof db) {
  try {
    const now = new Date();
    const threeDaysOut = new Date(Date.now() + 3 * 86400000);
    // Include sent AND viewed; exclude already expired plans
    const plans = await qb.select().from(writtenPlansTable)
      .where(
        and(
          inArray(writtenPlansTable.status, ["sent", "viewed"]),
          lt(writtenPlansTable.expiresAt, threeDaysOut),
          gt(writtenPlansTable.expiresAt, now)
        )
      );
    for (const plan of plans) {
      // Single reminder per plan — skip if any reminder has ever been sent
      const events = await qb.select().from(planActivityEventsTable)
        .where(and(eq(planActivityEventsTable.planId, plan.id), eq(planActivityEventsTable.eventType, "reminder_sent")))
        .limit(1);
      if (events.length > 0) continue;
      const partnerEmail = await resolvePartnerEmail(plan.partnerId);
      await sendPlanExpiringEmail(plan, partnerEmail).catch(e => console.error("[Email] expiry reminder error:", e));
      await qb.insert(planActivityEventsTable).values({ planId: plan.id, eventType: "reminder_sent", metadata: {} });
    }
  } catch (err) {
    console.error("[WrittenPlans] reminder cron error:", err);
  }
}

export function startPlanReminderScheduler(): void {
  const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  // Run immediately on boot so near-expiry reminders aren't delayed by the first interval
  sendPlanExpiryReminders();
  setInterval(() => { sendPlanExpiryReminders(); }, INTERVAL_MS);
  console.log("[WrittenPlans] Expiry reminder scheduler started (interval: 6h)");
}

export default router;
