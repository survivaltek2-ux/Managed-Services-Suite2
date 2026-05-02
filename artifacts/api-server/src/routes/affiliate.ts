import { Router, Request, Response } from "express";
import { db, affiliateClicksTable } from "@workspace/db";
import { desc, count, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth.js";
import {
  RESIDENTIAL_COMMISSIONS,
  VOIP_COMMISSIONS,
  CYBERSECURITY_COMMISSIONS,
  VPN_COMMISSIONS,
  PASSWORD_MGMT_COMMISSIONS,
  BACKUP_COMMISSIONS,
  BUSINESS_CONNECTIVITY_COMMISSIONS,
  HOME_SECURITY_COMMISSIONS,
  CONSUMER_ANTIVIRUS_COMMISSIONS,
  IDENTITY_PROTECTION_COMMISSIONS,
  CLOUD_PRODUCTIVITY_COMMISSIONS,
  NETWORK_MONITORING_COMMISSIONS,
  SALES_MARKETING_COMMISSIONS,
  WEB_HOSTING_COMMISSIONS,
  DEVELOPER_TOOLS_COMMISSIONS,
} from "../config/isp-commissions.js";

const router = Router();

/**
 * POST /api/affiliate/click
 * Public endpoint — logs an affiliate button click for first-party analytics.
 * Called by the frontend when a user clicks "Get Started" on a provider card.
 */
router.post("/affiliate/click", async (req: Request, res: Response) => {
  try {
    const {
      providerName,
      technology,
      addressSearched,
      stateCode,
      userType,
      sessionId,
      referrerPath,
    } = req.body;

    if (!providerName) {
      res.status(400).json({ error: "providerName is required" }); return;
    }

    await db.insert(affiliateClicksTable).values({
      providerName: String(providerName).slice(0, 200),
      technology: technology ? String(technology).slice(0, 100) : null,
      addressSearched: addressSearched ? String(addressSearched).slice(0, 500) : null,
      stateCode: stateCode ? String(stateCode).slice(0, 5) : null,
      userType: userType ? String(userType).slice(0, 20) : null,
      sessionId: sessionId ? String(sessionId).slice(0, 100) : null,
      referrerPath: referrerPath ? String(referrerPath).slice(0, 500) : null,
      userAgent: req.headers["user-agent"]?.slice(0, 500) ?? null,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[Affiliate Click] Error logging click:", err);
    // Non-critical — don't block the user's flow
    res.json({ ok: true });
  }
});

/**
 * GET /api/admin/affiliate/clicks
 * Admin only — returns click analytics grouped by provider.
 */
router.get("/admin/affiliate/clicks", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [byProvider, byState, recent, total] = await Promise.all([
      // Clicks grouped by provider, last 90 days
      db
        .select({
          providerName: affiliateClicksTable.providerName,
          technology: affiliateClicksTable.technology,
          clicks: count(),
        })
        .from(affiliateClicksTable)
        .where(sql`${affiliateClicksTable.clickedAt} > NOW() - INTERVAL '90 days'`)
        .groupBy(affiliateClicksTable.providerName, affiliateClicksTable.technology)
        .orderBy(desc(count())),

      // Clicks grouped by state, last 90 days
      db
        .select({
          stateCode: affiliateClicksTable.stateCode,
          userType: affiliateClicksTable.userType,
          clicks: count(),
        })
        .from(affiliateClicksTable)
        .where(sql`${affiliateClicksTable.clickedAt} > NOW() - INTERVAL '90 days'`)
        .groupBy(affiliateClicksTable.stateCode, affiliateClicksTable.userType)
        .orderBy(desc(count()))
        .limit(20),

      // 20 most recent individual clicks
      db
        .select()
        .from(affiliateClicksTable)
        .orderBy(desc(affiliateClicksTable.clickedAt))
        .limit(20),

      // All-time total
      db.select({ total: count() }).from(affiliateClicksTable),
    ]);

    res.json({ byProvider, byState, recent, totalAllTime: total[0]?.total ?? 0 });
  } catch (err) {
    console.error("[Affiliate Admin] Error fetching clicks:", err);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * GET /api/affiliate/programs/live
 * PUBLIC — returns only live affiliate programs (those with tracking links)
 * Used by the public Recommended Products page
 */
router.get("/affiliate/programs/live", (_req: Request, res: Response) => {
  const buildCategory = (name: string, map: Record<string, any>) =>
    Object.entries(map)
      .filter(([, entry]) => entry.affiliateUrl !== null) // Only live programs
      .map(([slug, entry]) => ({
        slug,
        category: name,
        rateUsd: entry.rateUsd,
        percentRate: entry.percentRate ?? null,
        commissionType: entry.commissionType,
        network: entry.network,
        affiliateSignupUrl: entry.affiliateSignupUrl,
        affiliateUrl: entry.affiliateUrl,
        isLive: true,
        notes: entry.notes,
      }));

  const programs = [
    ...buildCategory("Residential ISP", RESIDENTIAL_COMMISSIONS),
    ...buildCategory("Business Connectivity", BUSINESS_CONNECTIVITY_COMMISSIONS),
    ...buildCategory("VoIP & Communications", VOIP_COMMISSIONS),
    ...buildCategory("Cybersecurity", CYBERSECURITY_COMMISSIONS),
    ...buildCategory("VPN & Network Security", VPN_COMMISSIONS),
    ...buildCategory("Password Management", PASSWORD_MGMT_COMMISSIONS),
    ...buildCategory("Backup & Storage", BACKUP_COMMISSIONS),
    ...buildCategory("Home Security", HOME_SECURITY_COMMISSIONS),
    ...buildCategory("Consumer Antivirus", CONSUMER_ANTIVIRUS_COMMISSIONS),
    ...buildCategory("Identity Protection", IDENTITY_PROTECTION_COMMISSIONS),
    ...buildCategory("Cloud Productivity", CLOUD_PRODUCTIVITY_COMMISSIONS),
    ...buildCategory("Network Monitoring & IT Ops", NETWORK_MONITORING_COMMISSIONS),
    ...buildCategory("Sales & Marketing", SALES_MARKETING_COMMISSIONS),
    ...buildCategory("Web Hosting & Domains", WEB_HOSTING_COMMISSIONS),
    ...buildCategory("Developer Tools & AI", DEVELOPER_TOOLS_COMMISSIONS),
  ];

  res.json({ programs, totalLive: programs.length, totalPending: 0 });
});

/**
 * GET /api/admin/affiliate/programs
 * Admin only — returns the full catalog of affiliate programs from config,
 * grouped by category, so the team can see what's live vs. pending sign-up.
 */
router.get("/admin/affiliate/programs", requireAdmin, (_req: Request, res: Response) => {
  const buildCategory = (name: string, map: Record<string, any>) =>
    Object.entries(map).map(([slug, entry]) => ({
      slug,
      category: name,
      rateUsd: entry.rateUsd,
      percentRate: entry.percentRate ?? null,
      commissionType: entry.commissionType,
      network: entry.network,
      affiliateSignupUrl: entry.affiliateSignupUrl,
      isLive: entry.affiliateUrl !== null,
      notes: entry.notes,
    }));

  const programs = [
    ...buildCategory("Residential ISP", RESIDENTIAL_COMMISSIONS),
    ...buildCategory("Business Connectivity", BUSINESS_CONNECTIVITY_COMMISSIONS),
    ...buildCategory("VoIP & Communications", VOIP_COMMISSIONS),
    ...buildCategory("Cybersecurity", CYBERSECURITY_COMMISSIONS),
    ...buildCategory("VPN & Network Security", VPN_COMMISSIONS),
    ...buildCategory("Password Management", PASSWORD_MGMT_COMMISSIONS),
    ...buildCategory("Backup & Storage", BACKUP_COMMISSIONS),
    ...buildCategory("Home Security", HOME_SECURITY_COMMISSIONS),
    ...buildCategory("Consumer Antivirus", CONSUMER_ANTIVIRUS_COMMISSIONS),
    ...buildCategory("Identity Protection", IDENTITY_PROTECTION_COMMISSIONS),
    ...buildCategory("Cloud Productivity", CLOUD_PRODUCTIVITY_COMMISSIONS),
    ...buildCategory("Network Monitoring & IT Ops", NETWORK_MONITORING_COMMISSIONS),
    ...buildCategory("Sales & Marketing", SALES_MARKETING_COMMISSIONS),
    ...buildCategory("Web Hosting & Domains", WEB_HOSTING_COMMISSIONS),
    ...buildCategory("Developer Tools & AI", DEVELOPER_TOOLS_COMMISSIONS),
  ];

  res.json({ programs, totalLive: programs.filter(p => p.isLive).length, totalPending: programs.filter(p => !p.isLive).length });
});

export default router;
