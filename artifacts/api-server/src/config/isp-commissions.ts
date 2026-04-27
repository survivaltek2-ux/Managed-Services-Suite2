/**
 * Affiliate Commission Configuration — Siebert Services
 *
 * All rates based on publicly documented affiliate programs (2025-2026).
 * Paste your real affiliate links into the `affiliateUrl` fields once approved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO ACTIVATE AFFILIATE LINKS
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Sign up at the relevant network (CJ Affiliate, Impact, PartnerStack, etc.)
 * 2. Apply to each brand's program individually
 * 3. Once approved, generate a deep link to the brand's checkout/order page
 * 4. Paste that link into the `affiliateUrl` field below (replace null)
 *
 * Key affiliate networks used here:
 * - CJ Affiliate:   https://www.cj.com
 * - Impact:         https://impact.com
 * - PartnerStack:   https://partnerstack.com
 * - FlexOffers:     https://www.flexoffers.com
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface CommissionEntry {
  rateUsd: number;
  commissionType: "per_sale" | "per_lead" | "percent_sale" | "negotiated";
  // For percent_sale type, the approximate $ value at an assumed avg order
  percentRate?: string;
  network: string;
  affiliateSignupUrl: string;
  affiliateUrl: string | null;
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIDENTIAL ISP — sorted by rateUsd descending (used for provider card order)
// ─────────────────────────────────────────────────────────────────────────────

export const RESIDENTIAL_COMMISSIONS: Record<string, CommissionEntry> = {
  xfinity: {
    rateUsd: 135,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes: "High-speed internet and cable services for homes with reliable nationwide coverage and flexible plan options.",
  },
  comcast: {
    rateUsd: 135,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes: "Reliable high-speed internet service with nationwide coverage and flexible plan options for every household.",
  },
  "at&t": {
    rateUsd: 100,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes: "Up to $100/sale. 30-day cookie. Also available via FlexOffers.",
  },
  att: {
    rateUsd: 100,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes: "AT&T high-speed internet with bundled wireless options and nationwide coverage.",
  },
  spectrum: {
    rateUsd: 92,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes: "No-contract internet plans with speeds up to 1 Gbps and a free modem included.",
  },
  charter: {
    rateUsd: 92,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes: "Charter Spectrum high-speed internet with no annual contracts and reliable nationwide service.",
  },
  verizon: {
    rateUsd: 75,
    commissionType: "per_sale",
    network: "CJ Affiliate / FlexOffers",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes: "5G and fiber internet with top-rated reliability and consistent speeds for home and business.",
  },
  frontier: {
    rateUsd: 37,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes: "Fiber internet service with transparent pricing and no data caps in select areas.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS CONNECTIVITY — carrier circuits and enterprise internet
// ─────────────────────────────────────────────────────────────────────────────

export const BUSINESS_CONNECTIVITY_COMMISSIONS: Record<string, CommissionEntry> = {
  carrierfinder: {
    rateUsd: 0,
    commissionType: "negotiated",
    network: "CarrierFinder Partner Program",
    affiliateSignupUrl: "https://www.carrierfinder.com/partner",
    affiliateUrl: null,
    notes:
      "Compare business internet carriers to find the best pricing, speeds, and service agreements for your location.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// VOIP & BUSINESS COMMUNICATIONS
// Sign up at the networks noted, then apply to each brand.
// ─────────────────────────────────────────────────────────────────────────────

export const VOIP_COMMISSIONS: Record<string, CommissionEntry> = {
  ringcentral: {
    rateUsd: 100,
    commissionType: "per_sale",
    network: "CJ Affiliate / Impact",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes:
      "All-in-one cloud communications platform with voice, video, and team messaging for businesses of all sizes.",
  },
  nextiva: {
    rateUsd: 50,
    commissionType: "per_sale",
    network: "PartnerStack",
    affiliateSignupUrl: "https://partnerstack.com",
    affiliateUrl: null,
    notes:
      "Business VoIP and contact center platform trusted by over 100,000 businesses nationwide.",
  },
  vonage: {
    rateUsd: 50,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes:
      "Flexible business communications with UCaaS solutions and easy integrations with existing tools.",
  },
  krispcall: {
    rateUsd: 0,
    commissionType: "negotiated",
    network: "Direct (KrispCall affiliate program)",
    affiliateSignupUrl: "https://krispcall.com/affiliate-program/",
    affiliateUrl: "https://try.krispcall.com/siebert",
    notes:
      "Affordable cloud-based business phone with global numbers, SMS/MMS, IVR, and 80+ CRM integrations. 10% off via our partner link.",
  },
  "800.com": {
    rateUsd: 0,
    commissionType: "negotiated",
    network: "Direct (800.com partner program)",
    affiliateSignupUrl: "https://www.800.com/partner",
    affiliateUrl: "https://try.800.com/siebert",
    notes:
      "Get a professional toll-free or vanity business phone number trusted by 45,000+ companies. Includes call forwarding, SMS marketing, call analytics, and a mobile app.",
  },
  talkroute: {
    rateUsd: 175,
    commissionType: "per_sale",
    network: "Direct (Talkroute affiliate program)",
    affiliateSignupUrl: "https://talkroute.com/affiliate-program/",
    affiliateUrl: null,
    notes:
      "Virtual business phone system with no hardware required — work from any device, anywhere.",
  },
  grasshopper: {
    rateUsd: 40,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes:
      "Professional virtual phone system designed specifically for small businesses and entrepreneurs.",
  },
  ooma: {
    rateUsd: 50,
    commissionType: "per_sale",
    network: "FlexOffers",
    affiliateSignupUrl: "https://www.flexoffers.com",
    affiliateUrl: null,
    notes:
      "Affordable VoIP service for home and business with crystal-clear call quality and easy setup.",
  },
  "8x8": {
    rateUsd: 100,
    commissionType: "per_sale",
    network: "Direct (8x8 ReferTo8 Program)",
    affiliateSignupUrl: "https://www.8x8.com/partners",
    affiliateUrl: null,
    notes:
      "$100/qualified sale. 8x8's ReferTo8 referral program. UCaaS + contact center — good MSP fit. Apply at 8x8.com/partners.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CYBERSECURITY & ENDPOINT PROTECTION
// ─────────────────────────────────────────────────────────────────────────────

export const CYBERSECURITY_COMMISSIONS: Record<string, CommissionEntry> = {
  malwarebytes: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "30–40%",
    network: "Impact / Direct",
    affiliateSignupUrl: "https://www.malwarebytes.com/affiliate",
    affiliateUrl: null,
    notes:
      "Advanced threat protection that stops ransomware, malware, and zero-day attacks in real time.",
  },
  acronis: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "15–25%",
    network: "Direct (Acronis Partner Program)",
    affiliateSignupUrl: "https://www.acronis.com/en-us/partners/",
    affiliateUrl: null,
    notes:
      "Integrated backup and cybersecurity protection in a single platform — ideal for business continuity.",
  },
  bitdefender: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "20–36%",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes:
      "Award-winning cybersecurity with AI-driven threat detection for businesses and individuals.",
  },
  kaspersky: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "15–20%",
    network: "Impact",
    affiliateSignupUrl: "https://impact.com",
    affiliateUrl: null,
    notes:
      "Enterprise-grade cybersecurity with real-time threat intelligence and comprehensive endpoint protection.",
  },
  carbonblack: {
    rateUsd: 0,
    commissionType: "negotiated",
    network: "VMware/Broadcom Partner Program",
    affiliateSignupUrl: "https://www.vmware.com/partners.html",
    affiliateUrl: null,
    notes:
      "VMware Carbon Black enterprise platform for advanced threat detection and incident response.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// VPN & NETWORK SECURITY
// ─────────────────────────────────────────────────────────────────────────────

export const VPN_COMMISSIONS: Record<string, CommissionEntry> = {
  nordvpn: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "40–100%",
    network: "Impact",
    affiliateSignupUrl: "https://affiliates.nordvpn.com",
    affiliateUrl: null,
    notes:
      "Fast, secure VPN with thousands of servers worldwide and a strict no-logs privacy policy.",
  },
  nordlayer: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "20–30%",
    network: "Direct (NordLayer Partner Program)",
    affiliateSignupUrl: "https://nordlayer.com/partner-program/",
    affiliateUrl: null,
    notes:
      "Business VPN and network access platform built for growing remote and hybrid teams.",
  },
  expressvpn: {
    rateUsd: 36,
    commissionType: "per_sale",
    network: "Impact",
    affiliateSignupUrl: "https://impact.com",
    affiliateUrl: null,
    notes:
      "Blazing-fast VPN with best-in-class encryption and servers in 94+ countries worldwide.",
  },
  privateinternetaccess: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "33%",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes:
      "Proven VPN service with strong privacy features and unlimited device connections.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD MANAGEMENT & IDENTITY
// ─────────────────────────────────────────────────────────────────────────────

export const PASSWORD_MGMT_COMMISSIONS: Record<string, CommissionEntry> = {
  "1password": {
    rateUsd: 25,
    commissionType: "per_sale",
    network: "PartnerStack",
    affiliateSignupUrl: "https://1password.partnerstack.com",
    affiliateUrl: null,
    notes:
      "$25/sale for individual, higher for Teams/Business plans. Apply at 1password.partnerstack.com.",
  },
  lastpass: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "25%",
    network: "Impact",
    affiliateSignupUrl: "https://impact.com",
    affiliateUrl: null,
    notes:
      "Easy-to-use password manager with enterprise SSO and multi-factor authentication built in.",
  },
  dashlane: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "25%",
    network: "Impact",
    affiliateSignupUrl: "https://impact.com",
    affiliateUrl: null,
    notes:
      "Business password manager with dark web monitoring and secure credential sharing for teams.",
  },
  keeper: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "20%",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes:
      "Zero-knowledge password manager and digital vault with enterprise compliance and audit features.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// BACKUP & CLOUD STORAGE
// ─────────────────────────────────────────────────────────────────────────────

export const BACKUP_COMMISSIONS: Record<string, CommissionEntry> = {
  backblaze: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "10–25%",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes:
      "Simple, affordable cloud backup for business data and computers with S3-compatible storage.",
  },
  idriveenterprise: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "up to 20%",
    network: "FlexOffers / Direct",
    affiliateSignupUrl: "https://www.flexoffers.com",
    affiliateUrl: null,
    notes:
      "Enterprise cloud backup supporting unlimited devices, continuous sync, and hybrid backup options.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HOME SECURITY — residential and SMB/commercial monitoring
// ─────────────────────────────────────────────────────────────────────────────

export const HOME_SECURITY_COMMISSIONS: Record<string, CommissionEntry> = {
  adt: {
    rateUsd: 200,
    commissionType: "per_sale",
    network: "CJ Affiliate / FlexOffers",
    affiliateSignupUrl: "https://www.adt.com/business/affiliates",
    affiliateUrl: null,
    notes:
      "America's #1 smart home security provider with professional installation and 24/7 monitoring.",
  },
  simplisafe: {
    rateUsd: 75,
    commissionType: "per_sale",
    network: "Impact",
    affiliateSignupUrl: "https://www.simplisafe.com/business/affiliate",
    affiliateUrl: "https://simplisafehomeimprovementpros.sjv.io/c/5136149/1807168/21481",
    notes:
      "No contract required. DIY installation with professional monitoring available. Easy for customers to set up and manage.",
  },
  ring: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "~10%",
    network: "Amazon Associates",
    affiliateSignupUrl: "https://affiliate-program.amazon.com",
    affiliateUrl: null,
    notes:
      "Smart home security cameras, doorbells, and alarm systems by Amazon — easy to install and manage remotely.",
  },
  vivint: {
    rateUsd: 150,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.vivint.com/business/affiliates",
    affiliateUrl: null,
    notes:
      "Premium smart home security with professional installation, smart device integration, and 24/7 monitoring.",
  },
  brinks: {
    rateUsd: 100,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.brinks.com/business/affiliate-partners",
    affiliateUrl: null,
    notes:
      "Trusted home security solutions with professional monitoring and full smart home integration.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSUMER ANTIVIRUS & INTERNET SECURITY
// Great cross-sell alongside ISP recommendations.
// ─────────────────────────────────────────────────────────────────────────────

export const CONSUMER_ANTIVIRUS_COMMISSIONS: Record<string, CommissionEntry> = {
  norton360: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "25–50%",
    network: "CJ Affiliate / Impact",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes:
      "All-in-one security suite including antivirus, VPN, identity theft protection, and dark web monitoring.",
  },
  mcafee: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "25%",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.mcafee.com/business/partners",
    affiliateUrl: null,
    notes:
      "Comprehensive online protection for your devices, identity, and personal privacy.",
  },
  avast: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "25–40%",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.avast.com/business/affiliates",
    affiliateUrl: null,
    notes:
      "Real-time protection against viruses, malware, ransomware, and online threats for every device.",
  },
  avgantivirus: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "25–40%",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes:
      "Essential antivirus protection for home and small business use with automatic threat updates.",
  },
  totalav: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "40–70%",
    network: "CJ Affiliate / Direct",
    affiliateSignupUrl: "https://www.totalav.com/affiliate",
    affiliateUrl: null,
    notes:
      "Powerful antivirus and device optimization tools for Windows, Mac, iOS, and Android.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY THEFT PROTECTION
// High-value sell alongside antivirus + ISP recommendations.
// ─────────────────────────────────────────────────────────────────────────────

export const IDENTITY_PROTECTION_COMMISSIONS: Record<string, CommissionEntry> = {
  lifelock: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "up to 20%",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.lifelock.com/business/affiliates",
    affiliateUrl: null,
    notes:
      "Award-winning identity theft protection backed by Norton for individuals and families.",
  },
  aura: {
    rateUsd: 95,
    commissionType: "per_sale",
    network: "Impact",
    affiliateSignupUrl: "https://www.aura.com/business/affiliates",
    affiliateUrl: null,
    notes:
      "All-in-one identity theft protection, antivirus, and VPN coverage in a single subscription.",
  },
  identityguard: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "15–20%",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.cj.com",
    affiliateUrl: null,
    notes:
      "AI-powered identity protection monitoring your personal information across the web and dark web.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CLOUD PRODUCTIVITY (Microsoft 365, Google Workspace)
// Per-user commissions — ideal for business client upsell.
// ─────────────────────────────────────────────────────────────────────────────

export const CLOUD_PRODUCTIVITY_COMMISSIONS: Record<string, CommissionEntry> = {
  microsoft365: {
    rateUsd: 10,
    commissionType: "per_sale",
    network: "Microsoft Affiliate Program (CJ Affiliate)",
    affiliateSignupUrl: "https://www.microsoft.com/en-us/partners",
    affiliateUrl: null,
    notes:
      "Microsoft's cloud productivity suite with Word, Excel, Teams, Outlook, and enterprise-grade security.",
  },
  googleworkspace: {
    rateUsd: 13,
    commissionType: "per_sale",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://workspace.google.com/partners",
    affiliateUrl: null,
    notes:
      "Google's cloud collaboration tools including Gmail, Drive, Docs, and Meet — built for business.",
  },
  dropboxbusiness: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "15–25%",
    network: "Impact",
    affiliateSignupUrl: "https://impact.com",
    affiliateUrl: null,
    notes:
      "Secure cloud storage and collaboration platform for teams with advanced sharing and workflow tools.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// NETWORK MONITORING & IT OPS
// MSP-grade network visibility, mapping, and IT asset management.
// ─────────────────────────────────────────────────────────────────────────────

export const NETWORK_MONITORING_COMMISSIONS: Record<string, CommissionEntry> = {
  auvik: {
    rateUsd: 0,
    commissionType: "negotiated",
    network: "Auvik (PartnerStack)",
    affiliateSignupUrl: "https://www.auvik.com/partners/",
    affiliateUrl: "https://try.auvik.com/siebert",
    notes:
      "Cloud-based network monitoring, automated mapping, and IT asset management built for MSPs and internal IT teams. Delivers full Layer 1–3 visibility, device inventory, and hardware lifecycle data in minutes.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SALES & MARKETING
// B2B SaaS tools for partner programs, affiliate marketing, and sales ops.
// ─────────────────────────────────────────────────────────────────────────────

export const SALES_MARKETING_COMMISSIONS: Record<string, CommissionEntry> = {
  partnerstack: {
    rateUsd: 0,
    commissionType: "negotiated",
    network: "PartnerStack (direct referral)",
    affiliateSignupUrl: "https://partnerstack.com/partners-and-publishers",
    affiliateUrl: "https://try.partnerstack.com/rfyrfhixf3m5",
    notes:
      "The leading B2B SaaS partner-management platform (PRM) for running affiliate, referral, and co-sell programs at scale. Trusted by 600+ companies including monday.com and Formstack.",
  },
  "capsule-crm": {
    rateUsd: 0,
    commissionType: "negotiated",
    network: "Direct (Capsule CRM partner program)",
    affiliateSignupUrl: "https://capsulecrm.com/partner-program/",
    affiliateUrl: "https://get.capsulenow.io/d2t6mmb0qobp",
    notes:
      "Simple yet powerful CRM that puts sales, projects, and customer service in one place. Rated 4.7 on G2. Try free — no credit card required.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// WEB HOSTING & DOMAINS
// High flat commissions; good for residential/small business clients.
// ─────────────────────────────────────────────────────────────────────────────

export const WEB_HOSTING_COMMISSIONS: Record<string, CommissionEntry> = {
  bluehost: {
    rateUsd: 65,
    commissionType: "per_sale",
    network: "CJ Affiliate / Impact",
    affiliateSignupUrl: "https://www.bluehost.com/affiliates",
    affiliateUrl: null,
    notes:
      "Reliable web hosting recommended by WordPress.org, perfect for small to medium-sized businesses.",
  },
  siteground: {
    rateUsd: 50,
    commissionType: "per_sale",
    network: "Direct (SiteGround Affiliate Program)",
    affiliateSignupUrl: "https://www.siteground.com/affiliates",
    affiliateUrl: null,
    notes:
      "High-performance managed hosting with exceptional support, free SSL, and built-in security tools.",
  },
  hostgator: {
    rateUsd: 65,
    commissionType: "per_sale",
    network: "CJ Affiliate / Impact",
    affiliateSignupUrl: "https://www.hostgator.com/affiliates",
    affiliateUrl: null,
    notes:
      "Affordable web hosting with easy setup, unlimited storage, and 24/7 customer support.",
  },
  godaddy: {
    rateUsd: 0,
    commissionType: "percent_sale",
    percentRate: "15%",
    network: "CJ Affiliate",
    affiliateSignupUrl: "https://www.godaddy.com/affiliates",
    affiliateUrl: null,
    notes:
      "Domain registration, web hosting, and website builder tools trusted by millions of businesses worldwide.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY ALIAS (kept for backward compat)
// ─────────────────────────────────────────────────────────────────────────────
export const BUSINESS_COMMISSIONS = BUSINESS_CONNECTIVITY_COMMISSIONS;

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function lookupResidentialCommission(brandName: string): CommissionEntry | null {
  const key = brandName.toLowerCase().trim();
  if (RESIDENTIAL_COMMISSIONS[key]) return RESIDENTIAL_COMMISSIONS[key];
  for (const [k, entry] of Object.entries(RESIDENTIAL_COMMISSIONS)) {
    if (key.includes(k) || k.includes(key)) return entry;
  }
  return null;
}

export function getResidentialCommissionRate(brandName: string): number {
  return lookupResidentialCommission(brandName)?.rateUsd ?? 0;
}

/**
 * All non-ISP affiliate programs in a flat list, sorted by estimated revenue potential.
 * Used for internal reference and admin reporting.
 */
export function getAllServicePrograms(): Array<CommissionEntry & { slug: string; category: string }> {
  const entries: Array<CommissionEntry & { slug: string; category: string }> = [];

  const addCategory = (map: Record<string, CommissionEntry>, category: string) => {
    for (const [slug, entry] of Object.entries(map)) {
      entries.push({ ...entry, slug, category });
    }
  };

  addCategory(VOIP_COMMISSIONS, "VoIP & Communications");
  addCategory(CYBERSECURITY_COMMISSIONS, "Cybersecurity");
  addCategory(VPN_COMMISSIONS, "VPN & Network Security");
  addCategory(PASSWORD_MGMT_COMMISSIONS, "Password Management");
  addCategory(BACKUP_COMMISSIONS, "Backup & Storage");
  addCategory(BUSINESS_CONNECTIVITY_COMMISSIONS, "Business Connectivity");
  addCategory(HOME_SECURITY_COMMISSIONS, "Home Security");
  addCategory(CONSUMER_ANTIVIRUS_COMMISSIONS, "Consumer Antivirus");
  addCategory(IDENTITY_PROTECTION_COMMISSIONS, "Identity Protection");
  addCategory(CLOUD_PRODUCTIVITY_COMMISSIONS, "Cloud Productivity");
  addCategory(NETWORK_MONITORING_COMMISSIONS, "Network Monitoring & IT Ops");
  addCategory(SALES_MARKETING_COMMISSIONS, "Sales & Marketing");
  addCategory(WEB_HOSTING_COMMISSIONS, "Web Hosting & Domains");

  return entries.sort((a, b) => b.rateUsd - a.rateUsd);
}
