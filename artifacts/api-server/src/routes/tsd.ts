import { Router, type IRouter, type Response } from "express";
import { db, tsdConfigsTable, tsdSyncLogsTable, tsdVendorMappingsTable, tsdDealPushLogsTable, partnerDealsTable, partnersTable, tsdProductsTable, telarusOpportunitiesTable, telarusAccountsTable, telarusContactsTable, telarusOrdersTable, telarusQuotesTable, telarusActivitiesTable, telarusTasksTable, telarusVendorsTable } from "@workspace/db";
import { eq, and, desc, inArray, asc } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";
import { requirePartnerAuth, type PartnerRequest } from "../middlewares/partnerAuth.js";
import { resolveCredentialRef, createTsdConnector, createTsdConnectorWithAuth } from "@workspace/integrations-tsd";
import type { TsdProvider, TsdAuthCredentials } from "@workspace/integrations-tsd";
import { syncLeadsFromTSDs, syncCommissionsFromTSDs, syncOpportunitiesFromTelarus, syncAccountsFromTelarus, syncContactsFromTelarus, syncOrdersFromTelarus, syncQuotesFromTelarus, syncActivitiesFromTelarus, syncTasksFromTelarus, syncVendorsFromTelarus, syncAllTelarusData } from "../lib/tsdSync.js";
import { encryptSecret, safeDecryptSecret } from "../lib/tsdSecrets.js";
import { pushDeal, TSD_IDS, TSD_LABELS, type TsdId } from "../lib/tsd-adapter.js";

const router: IRouter = Router();

const TSD_PROVIDERS: TsdProvider[] = ["telarus", "intelisys"];
const TSD_LIST = TSD_IDS.map(id => ({ id, label: TSD_LABELS[id] }));

function credentialStatus(provider: TsdProvider, dbCredRef: string | null, dbUsername: string | null, dbPassword: string | null): {
  hasCredential: boolean;
  credentialSource: "env" | "db" | null;
} {
  const envCred = resolveCredentialRef(provider);
  if (envCred) return { hasCredential: true, credentialSource: "env" };
  if (provider === "telarus") {
    const envUsername = process.env.TELARUS_USERNAME;
    const envPassword = process.env.TELARUS_PASSWORD;
    if (envUsername && envPassword) return { hasCredential: true, credentialSource: "env" };
  }
  if (dbUsername && dbPassword) return { hasCredential: true, credentialSource: "db" };
  if (dbCredRef) return { hasCredential: true, credentialSource: "db" };
  return { hasCredential: false, credentialSource: null };
}

function resolveCredential(provider: TsdProvider, dbCredRef: string | null, dbUsername: string | null, dbPassword: string | null): { type: "api_key" | "username_password"; value: string } | null {
  const envCred = resolveCredentialRef(provider);
  if (envCred) {
    const type = provider === "telarus" ? "api_key" : "username_password";
    return { type, value: envCred };
  }
  if (provider === "telarus") {
    const envUsername = process.env.TELARUS_USERNAME;
    const envPassword = process.env.TELARUS_PASSWORD;
    if (envUsername && envPassword) return { type: "username_password", value: `${envUsername}::${envPassword}` };
  }
  if (dbUsername && dbPassword) {
    const decryptedUsername = safeDecryptSecret(dbUsername);
    const decryptedPassword = safeDecryptSecret(dbPassword);
    return { type: "username_password", value: `${decryptedUsername}::${decryptedPassword}` };
  }
  if (dbCredRef) {
    const decrypted = safeDecryptSecret(dbCredRef);
    if (!decrypted) return null;
    const type = provider === "telarus" ? "api_key" : "username_password";
    return { type, value: decrypted };
  }
  return null;
}

function webhookSecretStatus(provider: TsdProvider, dbSecret: string | null): boolean {
  return !!(process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`] || dbSecret);
}

function encryptOrThrow(value: string): string {
  return encryptSecret(value);
}

// ─── Admin: TSD Config Management ──────────────────────────────────────────────

router.get("/admin/tsd/configs", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const configs = await db.select().from(tsdConfigsTable).orderBy(tsdConfigsTable.provider);
    const result = configs.map(c => {
      const { hasCredential, credentialSource } = credentialStatus(c.provider as TsdProvider, c.credentialRef, c.username, c.password);
      return {
        id: c.id,
        provider: c.provider,
        enabled: c.enabled,
        hasCredential,
        credentialSource,
        hasDbCredential: !!c.credentialRef || (!!c.username && !!c.password),
        hasSecurityToken: !!(c.securityToken || process.env[`${c.provider.toUpperCase()}_SECURITY_TOKEN`]),
        hasWebhookSecret: webhookSecretStatus(c.provider as TsdProvider, c.webhookSecret),
        lastLeadSyncAt: c.lastLeadSyncAt,
        lastCommissionSyncAt: c.lastCommissionSyncAt,
        lastOpportunitySyncAt: c.lastOpportunitySyncAt,
        lastAccountSyncAt: c.lastAccountSyncAt,
        lastContactSyncAt: c.lastContactSyncAt,
        lastOrderSyncAt: c.lastOrderSyncAt,
        lastQuoteSyncAt: c.lastQuoteSyncAt,
        lastActivitySyncAt: c.lastActivitySyncAt,
        lastTaskSyncAt: c.lastTaskSyncAt,
        lastVendorSyncAt: c.lastVendorSyncAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    });
    res.json(result);
  } catch (err) {
    console.error("[TSD] Get configs error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load TSD configs" });
  }
});

router.put("/admin/tsd/configs/:provider", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params as { provider: string };
    if (!TSD_PROVIDERS.includes(provider as TsdProvider)) {
      res.status(400).json({ error: "invalid_provider", message: "Unknown TSD provider" });
      return;
    }

    const { enabled, credentialRef, username, password, mfaPhone, mfaCode, securityToken, webhookSecret } = req.body;

    const existing = await db.select().from(tsdConfigsTable)
      .where(eq(tsdConfigsTable.provider, provider as TsdProvider)).limit(1);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof enabled === "boolean") updateData.enabled = enabled;
    if (credentialRef && credentialRef !== "" && !credentialRef.includes("****")) {
      updateData.credentialRef = encryptOrThrow(credentialRef);
    }
    if (username && username !== "" && !username.includes("****")) {
      updateData.username = encryptOrThrow(username);
    }
    if (password && password !== "" && !password.includes("****")) {
      updateData.password = encryptOrThrow(password);
    }
    if (mfaPhone && mfaPhone !== "" && !mfaPhone.includes("****")) {
      updateData.mfaPhone = encryptOrThrow(mfaPhone);
    }
    if (mfaCode !== undefined && mfaCode !== "" && !mfaCode.includes("****")) {
      updateData.mfaCode = encryptOrThrow(mfaCode);
    }
    if (securityToken !== undefined && securityToken !== "" && !securityToken.includes("****")) {
      updateData.securityToken = encryptOrThrow(securityToken);
    }
    if (webhookSecret !== undefined && webhookSecret !== "" && !webhookSecret.includes("****")) {
      updateData.webhookSecret = encryptOrThrow(webhookSecret);
    }

    let savedConfig;
    if (existing.length === 0) {
      const [created] = await db.insert(tsdConfigsTable).values({
        provider: provider as TsdProvider,
        enabled: typeof enabled === "boolean" ? enabled : false,
        credentialRef: credentialRef && !credentialRef.includes("****") ? encryptOrThrow(credentialRef) : null,
        username: username && !username.includes("****") ? encryptOrThrow(username) : null,
        password: password && !password.includes("****") ? encryptOrThrow(password) : null,
        mfaPhone: mfaPhone && !mfaPhone.includes("****") ? encryptOrThrow(mfaPhone) : null,
        mfaCode: mfaCode && !mfaCode.includes("****") ? encryptOrThrow(mfaCode) : null,
        securityToken: securityToken && !securityToken.includes("****") ? encryptOrThrow(securityToken) : null,
        webhookSecret: webhookSecret && !webhookSecret.includes("****") ? encryptOrThrow(webhookSecret) : null,
      }).returning();
      savedConfig = created;
    } else {
      const [updated] = await db.update(tsdConfigsTable)
        .set(updateData)
        .where(eq(tsdConfigsTable.provider, provider as TsdProvider))
        .returning();
      savedConfig = updated;
    }

    const { hasCredential, credentialSource } = credentialStatus(provider as TsdProvider, savedConfig.credentialRef, savedConfig.username, savedConfig.password);
    res.json({
      id: savedConfig.id,
      provider: savedConfig.provider,
      enabled: savedConfig.enabled,
      hasCredential,
      credentialSource,
      hasDbCredential: !!savedConfig.credentialRef || (!!savedConfig.username && !!savedConfig.password),
      hasSecurityToken: !!(savedConfig.securityToken || process.env[`${provider.toUpperCase()}_SECURITY_TOKEN`]),
      hasWebhookSecret: webhookSecretStatus(provider as TsdProvider, savedConfig.webhookSecret),
      lastLeadSyncAt: savedConfig.lastLeadSyncAt,
      lastCommissionSyncAt: savedConfig.lastCommissionSyncAt,
    });
  } catch (err) {
    console.error("[TSD] Update config error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to update TSD config" });
  }
});

router.post("/admin/tsd/configs/:provider/test", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params as { provider: string };
    if (!TSD_PROVIDERS.includes(provider as TsdProvider)) {
      res.status(400).json({ error: "invalid_provider", message: "Unknown TSD provider" });
      return;
    }

    const [cfg] = await db.select().from(tsdConfigsTable)
      .where(eq(tsdConfigsTable.provider, provider as TsdProvider)).limit(1);

    const cred = resolveCredential(provider as TsdProvider, cfg?.credentialRef || null, cfg?.username || null, cfg?.password || null);
    if (!cred) {
      const credHint = provider === "telarus"
        ? `TELARUS_API_KEY or TELARUS_USERNAME/TELARUS_PASSWORD env vars`
        : `${provider.toUpperCase()}_USERNAME / ${provider.toUpperCase()}_PASSWORD env vars`;
      res.json({ ok: false, error: `No credentials configured. Set ${credHint}, or enter credentials in the admin UI.` });
      return;
    }

    let connector;
    const [part1, part2] = cred.value.split("::");
    if (provider === "telarus") {
      let credentials: TsdAuthCredentials;
      if (cred.type === "api_key") {
        credentials = {
          type: "api_key",
          apiKey: part1,
          agentId: part2 || process.env.TELARUS_AGENT_ID || undefined,
        };
      } else {
        credentials = {
          type: "username_password",
          username: part1,
          password: part2,
          agentId: process.env.TELARUS_AGENT_ID || undefined,
          securityToken: process.env.TELARUS_SECURITY_TOKEN || undefined,
        };
        if (cfg?.mfaCode) {
          credentials.mfaCode = safeDecryptSecret(cfg.mfaCode) || undefined;
        }
        if (cfg?.securityToken && !credentials.securityToken) {
          credentials.securityToken = safeDecryptSecret(cfg.securityToken) || undefined;
        }
      }
      connector = createTsdConnectorWithAuth(provider, credentials);
    } else {
      const credentials: TsdAuthCredentials = {
        type: "username_password",
        username: part1,
        password: part2,
      };
      connector = createTsdConnectorWithAuth(provider as TsdProvider, credentials);
    }

    const result = await connector.testConnection();
    res.json(result);
  } catch (err) {
    console.error("[TSD] Test connection error:", err);
    res.json({ ok: false, error: err instanceof Error ? err.message : "Connection test failed" });
  }
});

router.post("/admin/tsd/sync/:provider/leads", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params as { provider: string };
    const isAll = provider === "all";

    if (!isAll && !TSD_PROVIDERS.includes(provider as TsdProvider)) {
      res.status(400).json({ error: "invalid_provider" });
      return;
    }

    const targetProvider = isAll ? undefined : (provider as TsdProvider);
    syncLeadsFromTSDs(targetProvider).catch(err => console.error("[TSD] Manual lead sync error:", err));
    res.json({ message: "Lead sync started", provider });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Failed to trigger sync" });
  }
});

router.post("/admin/tsd/sync/:provider/commissions", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params as { provider: string };
    const isAll = provider === "all";

    if (!isAll && !TSD_PROVIDERS.includes(provider as TsdProvider)) {
      res.status(400).json({ error: "invalid_provider" });
      return;
    }

    const targetProvider = isAll ? undefined : (provider as TsdProvider);
    syncCommissionsFromTSDs(targetProvider).catch(err => console.error("[TSD] Manual commission sync error:", err));
    res.json({ message: "Commission sync started", provider });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Failed to trigger sync" });
  }
});

router.get("/admin/tsd/logs", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { provider, limit: limitParam } = req.query;
    const limit = Math.min(parseInt(String(limitParam || "50")), 200);

    if (provider && TSD_PROVIDERS.includes(provider as TsdProvider)) {
      const logs = await db.select().from(tsdSyncLogsTable)
        .where(eq(tsdSyncLogsTable.provider, provider as TsdProvider))
        .orderBy(desc(tsdSyncLogsTable.createdAt))
        .limit(limit);
      res.json(logs);
      return;
    }

    const logs = await db.select().from(tsdSyncLogsTable)
      .orderBy(desc(tsdSyncLogsTable.createdAt))
      .limit(limit);
    res.json(logs);
  } catch (err) {
    console.error("[TSD] Get logs error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load sync logs" });
  }
});

// ─── Vendor-to-TSD Mapping ─────────────────────────────────────────────────────

async function getMatchingTSDs(products: string[]): Promise<{ id: TsdId; label: string }[]> {
  if (!products || products.length === 0) return TSD_LIST;
  const mappings = await db.select().from(tsdVendorMappingsTable)
    .where(and(
      eq(tsdVendorMappingsTable.active, true),
      inArray(tsdVendorMappingsTable.productName, products)
    ));
  const matched = new Set<TsdId>();
  for (const m of mappings) {
    const ids: string[] = JSON.parse(m.tsdIds || "[]");
    for (const id of ids) {
      if (TSD_IDS.includes(id as TsdId)) matched.add(id as TsdId);
    }
  }
  if (matched.size === 0) return TSD_LIST;
  return Array.from(matched).map(id => ({ id, label: TSD_LABELS[id] }));
}

router.post("/partner/deals/tsd-matches", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  try {
    const { products } = req.body;
    const matches = await getMatchingTSDs(Array.isArray(products) ? products : []);
    res.json({ matches });
  } catch (err) {
    console.error("[TSD] tsd-matches error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to resolve TSD matches" });
  }
});

router.post("/partner/deals/:id/retry-tsd-push", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  try {
    const dealId = parseInt(req.params.id as string);
    const [deal] = await db.select().from(partnerDealsTable)
      .where(and(eq(partnerDealsTable.id, dealId), eq(partnerDealsTable.partnerId, req.partnerId!)))
      .limit(1);
    if (!deal) { res.status(404).json({ error: "not_found", message: "Deal not found" }); return; }

    const [partner] = await db.select({ companyName: partnersTable.companyName, email: partnersTable.email })
      .from(partnersTable).where(eq(partnersTable.id, req.partnerId!)).limit(1);

    const failedLogs = await db.select().from(tsdDealPushLogsTable)
      .where(and(eq(tsdDealPushLogsTable.dealId, dealId), eq(tsdDealPushLogsTable.status, "failed")));

    if (failedLogs.length === 0) {
      res.json({ message: "No failed pushes to retry", results: [] });
      return;
    }

    const products: string[] = JSON.parse(deal.products || "[]");
    const payload = {
      dealId: deal.id,
      title: deal.title,
      customerName: deal.customerName,
      customerEmail: deal.customerEmail,
      products,
      estimatedValue: deal.estimatedValue,
      partnerCompany: partner?.companyName || "",
      partnerEmail: partner?.email || "",
    };

    const results = [];
    for (const log of failedLogs) {
      const result = await pushDeal(log.tsdId as TsdId, payload);
      await db.update(tsdDealPushLogsTable).set({
        status: result.success ? "success" : "failed",
        errorMessage: result.success ? null : result.errorMessage,
        payload: JSON.stringify({ externalId: result.externalId }),
      }).where(eq(tsdDealPushLogsTable.id, log.id));
      results.push(result);
    }

    const syncLogs = await db.select().from(tsdDealPushLogsTable).where(eq(tsdDealPushLogsTable.dealId, dealId));
    res.json({ results, syncLogs });
  } catch (err) {
    console.error("[TSD] retry-push error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to retry TSD push" });
  }
});

router.get("/partner/deals/:id/tsd-logs", requirePartnerAuth, async (req: PartnerRequest, res: Response) => {
  try {
    const dealId = parseInt(req.params.id as string);
    const [deal] = await db.select({ id: partnerDealsTable.id }).from(partnerDealsTable)
      .where(and(eq(partnerDealsTable.id, dealId), eq(partnerDealsTable.partnerId, req.partnerId!)))
      .limit(1);
    if (!deal) { res.status(404).json({ error: "not_found" }); return; }
    const logs = await db.select().from(tsdDealPushLogsTable).where(eq(tsdDealPushLogsTable.dealId, dealId));
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to fetch TSD logs" });
  }
});

router.get("/admin/tsd-vendor-mappings", requireAdmin, async (_req, res: Response) => {
  try {
    const mappings = await db.select().from(tsdVendorMappingsTable).orderBy(tsdVendorMappingsTable.productName);
    res.json(mappings.map(m => ({ ...m, tsdIds: JSON.parse(m.tsdIds || "[]") })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to load vendor mappings" });
  }
});

router.put("/admin/tsd-vendor-mappings/:id", requireAdmin, async (req, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { tsdIds, active } = req.body;
    const [mapping] = await db.update(tsdVendorMappingsTable).set({
      tsdIds: JSON.stringify(Array.isArray(tsdIds) ? tsdIds : []),
      active: active !== undefined ? active : true,
      updatedAt: new Date(),
    }).where(eq(tsdVendorMappingsTable.id, id)).returning();
    if (!mapping) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ ...mapping, tsdIds: JSON.parse(mapping.tsdIds || "[]") });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to update vendor mapping" });
  }
});

router.post("/admin/tsd-vendor-mappings", requireAdmin, async (req, res: Response) => {
  try {
    const { productName, tsdIds } = req.body;
    if (!productName) { res.status(400).json({ error: "validation_error", message: "productName required" }); return; }
    const [mapping] = await db.insert(tsdVendorMappingsTable).values({
      productName,
      tsdIds: JSON.stringify(Array.isArray(tsdIds) ? tsdIds : []),
    }).returning();
    res.status(201).json({ ...mapping, tsdIds: JSON.parse(mapping.tsdIds || "[]") });
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(400).json({ error: "conflict", message: "A mapping for this product already exists" });
    } else {
      console.error(err);
      res.status(500).json({ error: "server_error", message: "Failed to create vendor mapping" });
    }
  }
});

router.delete("/admin/tsd-vendor-mappings/:id", requireAdmin, async (req, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(tsdVendorMappingsTable).where(eq(tsdVendorMappingsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to delete vendor mapping" });
  }
});

router.get("/admin/tsd-deal-push-logs", requireAdmin, async (_req, res: Response) => {
  try {
    const logs = await db.select().from(tsdDealPushLogsTable).orderBy(desc(tsdDealPushLogsTable.createdAt));
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Failed to fetch TSD deal push logs" });
  }
});

export { getMatchingTSDs };

// ─── TSD Product Catalog ────────────────────────────────────────────────────

router.get("/admin/tsd-products", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const products = await db.select().from(tsdProductsTable)
      .orderBy(tsdProductsTable.category, asc(tsdProductsTable.sortOrder), tsdProductsTable.name);
    res.json(products.map(p => ({ ...p, availableAt: JSON.parse(p.availableAt) })));
  } catch (err) {
    console.error("[TSD] Get products error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to load product catalog" });
  }
});

router.post("/admin/tsd-products", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { category, name, description, availableAt, active, sortOrder } = req.body;
    if (!category || !name) {
      res.status(400).json({ error: "validation_error", message: "category and name are required" });
      return;
    }
    const [product] = await db.insert(tsdProductsTable).values({
      category: category.trim(),
      name: name.trim(),
      description: description?.trim() || null,
      availableAt: JSON.stringify(Array.isArray(availableAt) ? availableAt : []),
      active: active !== false,
      sortOrder: sortOrder || 0,
    }).returning();
    res.status(201).json({ ...product, availableAt: JSON.parse(product.availableAt) });
  } catch (err) {
    console.error("[TSD] Create product error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to create product" });
  }
});

router.put("/admin/tsd-products/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { category, name, description, availableAt, active, sortOrder } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (category !== undefined) updates.category = category.trim();
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (availableAt !== undefined) updates.availableAt = JSON.stringify(Array.isArray(availableAt) ? availableAt : []);
    if (active !== undefined) updates.active = active;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    const [product] = await db.update(tsdProductsTable).set(updates).where(eq(tsdProductsTable.id, id)).returning();
    if (!product) { res.status(404).json({ error: "not_found", message: "Product not found" }); return; }
    res.json({ ...product, availableAt: JSON.parse(product.availableAt) });
  } catch (err) {
    console.error("[TSD] Update product error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to update product" });
  }
});

router.delete("/admin/tsd-products/:id", requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(tsdProductsTable).where(eq(tsdProductsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[TSD] Delete product error:", err);
    res.status(500).json({ error: "server_error", message: "Failed to delete product" });
  }
});

// ─── Telarus Synced Data — Read Endpoints ────────────────────────────────────

router.get("/admin/telarus/opportunities", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(telarusOpportunitiesTable).orderBy(desc(telarusOpportunitiesTable.syncedAt)).limit(500);
    res.json(rows);
  } catch (err) {
    console.error("[TSD] Get opportunities error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/telarus/accounts", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(telarusAccountsTable).orderBy(desc(telarusAccountsTable.syncedAt)).limit(500);
    res.json(rows);
  } catch (err) {
    console.error("[TSD] Get accounts error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/telarus/contacts", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(telarusContactsTable).orderBy(desc(telarusContactsTable.syncedAt)).limit(500);
    res.json(rows);
  } catch (err) {
    console.error("[TSD] Get contacts error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/telarus/orders", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(telarusOrdersTable).orderBy(desc(telarusOrdersTable.syncedAt)).limit(500);
    res.json(rows);
  } catch (err) {
    console.error("[TSD] Get orders error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/telarus/quotes", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(telarusQuotesTable).orderBy(desc(telarusQuotesTable.syncedAt)).limit(500);
    res.json(rows);
  } catch (err) {
    console.error("[TSD] Get quotes error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/telarus/activities", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(telarusActivitiesTable).orderBy(desc(telarusActivitiesTable.syncedAt)).limit(500);
    res.json(rows);
  } catch (err) {
    console.error("[TSD] Get activities error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/telarus/tasks", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(telarusTasksTable).orderBy(desc(telarusTasksTable.syncedAt)).limit(500);
    res.json(rows);
  } catch (err) {
    console.error("[TSD] Get tasks error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ─── Telarus Sync Trigger Endpoints ──────────────────────────────────────────

router.post("/admin/telarus/sync/all", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    syncAllTelarusData().catch(err => console.error("[TSD] Background full sync error:", err));
    res.json({ success: true, message: "Full Telarus sync started" });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.post("/admin/telarus/sync/opportunities", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    syncOpportunitiesFromTelarus().catch(err => console.error("[TSD] Opportunities sync error:", err));
    res.json({ success: true, message: "Opportunities sync started" });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.post("/admin/telarus/sync/accounts", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    syncAccountsFromTelarus().catch(err => console.error("[TSD] Accounts sync error:", err));
    res.json({ success: true, message: "Accounts sync started" });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.post("/admin/telarus/sync/contacts", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    syncContactsFromTelarus().catch(err => console.error("[TSD] Contacts sync error:", err));
    res.json({ success: true, message: "Contacts sync started" });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.post("/admin/telarus/sync/orders", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    syncOrdersFromTelarus().catch(err => console.error("[TSD] Orders sync error:", err));
    res.json({ success: true, message: "Orders sync started" });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.post("/admin/telarus/sync/quotes", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    syncQuotesFromTelarus().catch(err => console.error("[TSD] Quotes sync error:", err));
    res.json({ success: true, message: "Quotes sync started" });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.post("/admin/telarus/sync/activities", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    syncActivitiesFromTelarus().catch(err => console.error("[TSD] Activities sync error:", err));
    res.json({ success: true, message: "Activities sync started" });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.post("/admin/telarus/sync/tasks", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    syncTasksFromTelarus().catch(err => console.error("[TSD] Tasks sync error:", err));
    res.json({ success: true, message: "Tasks sync started" });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

router.get("/admin/telarus/vendors", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(telarusVendorsTable).orderBy(desc(telarusVendorsTable.syncedAt)).limit(500);
    res.json(rows);
  } catch (err) {
    console.error("[TSD] Get vendors error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/telarus/sync/vendors", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    syncVendorsFromTelarus().catch(err => console.error("[TSD] Vendors sync error:", err));
    res.json({ success: true, message: "Vendors sync started" });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

// ─── Admin: Seed test vendors ──────────────────────────────────────────────────

router.post("/admin/seed/vendors", requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const sampleVendors = [
      {
        externalId: "vendor-001",
        name: "Comcast Business",
        accountType: "Partner",
        industry: "Telecommunications",
        website: "https://business.comcast.com",
        partnerType: "Channel Partner",
        isActive: true,
        products: JSON.stringify([
          { name: "Internet 500", category: "Connectivity", description: "500 Mbps internet service" },
          { name: "Voice Solutions", category: "Voice", description: "Business phone systems" },
          { name: "Ethernet", category: "Connectivity", description: "Dedicated ethernet service" },
        ]),
      },
      {
        externalId: "vendor-002",
        name: "AT&T Business",
        accountType: "Partner",
        industry: "Telecommunications",
        website: "https://www.business.att.com",
        partnerType: "Channel Partner",
        isActive: true,
        products: JSON.stringify([
          { name: "AT&T Fiber", category: "Connectivity", description: "High-speed fiber internet" },
          { name: "Unified Communications", category: "Voice", description: "UCaaS platform" },
          { name: "Managed Services", category: "IT Services", description: "Managed IT services" },
        ]),
      },
      {
        externalId: "vendor-003",
        name: "Verizon Business",
        accountType: "Partner",
        industry: "Telecommunications",
        website: "https://www.verizonbusiness.com",
        partnerType: "Channel Partner",
        isActive: true,
        products: JSON.stringify([
          { name: "Fios for Business", category: "Connectivity", description: "Fiber internet service" },
          { name: "Cloud Connect", category: "Cloud Services", description: "Secure cloud connectivity" },
          { name: "Security Services", category: "Security", description: "Threat protection and monitoring" },
        ]),
      },
      {
        externalId: "vendor-004",
        name: "CenturyLink",
        accountType: "Partner",
        industry: "Telecommunications",
        website: "https://www.centurylink.com",
        partnerType: "Channel Partner",
        isActive: true,
        products: JSON.stringify([
          { name: "Prism Internet", category: "Connectivity", description: "Broadband internet service" },
          { name: "VoIP Phone Service", category: "Voice", description: "Business VoIP" },
          { name: "Colocation", category: "Data Center", description: "Data center services" },
        ]),
      },
      {
        externalId: "vendor-005",
        name: "Vonage Business",
        accountType: "Partner",
        industry: "Software/Services",
        website: "https://www.vonage.com/business",
        partnerType: "Technology Partner",
        isActive: true,
        products: JSON.stringify([
          { name: "Cloud Phone", category: "Voice", description: "Cloud-based phone system" },
          { name: "Video Conferencing", category: "Collaboration", description: "Video meeting platform" },
          { name: "Contact Center", category: "Contact Center", description: "Cloud contact center" },
        ]),
      },
    ];

    let created = 0;
    let updated = 0;
    for (const vendor of sampleVendors) {
      const existing = await db.select().from(telarusVendorsTable).where(eq(telarusVendorsTable.externalId, vendor.externalId));
      if (existing.length === 0) {
        await db.insert(telarusVendorsTable).values(vendor);
        created++;
      } else {
        // Update existing vendor with products and other fields
        await db.update(telarusVendorsTable).set({
          name: vendor.name,
          accountType: vendor.accountType,
          industry: vendor.industry,
          website: vendor.website,
          partnerType: vendor.partnerType,
          isActive: vendor.isActive,
          products: vendor.products,
        }).where(eq(telarusVendorsTable.externalId, vendor.externalId));
        updated++;
      }
    }

    res.json({ success: true, message: `Created ${created}, updated ${updated} vendor(s). Total vendors: ${(await db.select().from(telarusVendorsTable)).length}` });
  } catch (err) {
    console.error("[Admin] Seed vendors error:", err);
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

export default router;
