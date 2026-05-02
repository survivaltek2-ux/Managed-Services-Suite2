import { db, tsdConfigsTable, tsdSyncLogsTable, partnerLeadsTable, partnerCommissionsTable, partnersTable, tsdDealMappingsTable, telarusOpportunitiesTable, telarusAccountsTable, telarusContactsTable, telarusOrdersTable, telarusQuotesTable, telarusActivitiesTable, telarusTasksTable, telarusVendorsTable } from "@workspace/db";
import type { TsdConfig } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createTsdConnector, createTsdConnectorWithAuth, resolveCredentialRef } from "@workspace/integrations-tsd";
import type { TsdProvider, TsdConnector, TsdAuthCredentials } from "@workspace/integrations-tsd";
import { safeJsonStringify } from "@workspace/integrations-tsd";
import { safeDecryptSecret, getSyncInterval } from "./tsdSecrets.js";
import { clearMfaCode } from "./zoomSms.js";

const TSD_PROVIDERS: TsdProvider[] = ["telarus", "intelisys"];

async function getEnabledConfigs(provider?: TsdProvider): Promise<TsdConfig[]> {
  if (provider) {
    return db.select().from(tsdConfigsTable)
      .where(and(eq(tsdConfigsTable.enabled, true), eq(tsdConfigsTable.provider, provider)));
  }
  return db.select().from(tsdConfigsTable).where(eq(tsdConfigsTable.enabled, true));
}

function buildConnectorForConfig(cfg: TsdConfig): TsdConnector | null {
  const provider = cfg.provider as TsdProvider;

  const envCred = resolveCredentialRef(provider);
  if (envCred) {
    return createTsdConnector(provider, envCred);
  }

  const envUsername = process.env[`${provider.toUpperCase()}_USERNAME`];
  const envPassword = process.env[`${provider.toUpperCase()}_PASSWORD`];
  if (envUsername && envPassword) {
    const credentials: TsdAuthCredentials = {
      type: "username_password",
      username: envUsername,
      password: envPassword,
      agentId: process.env[`${provider.toUpperCase()}_AGENT_ID`] || undefined,
      partnerId: process.env[`${provider.toUpperCase()}_PARTNER_ID`] || undefined,
      securityToken: process.env[`${provider.toUpperCase()}_SECURITY_TOKEN`] || undefined,
    };
    if (provider === "telarus" && cfg.mfaCode) {
      credentials.mfaCode = safeDecryptSecret(cfg.mfaCode) || undefined;
    }
    if (provider === "telarus" && cfg.securityToken && !credentials.securityToken) {
      credentials.securityToken = safeDecryptSecret(cfg.securityToken) || undefined;
    }
    return createTsdConnectorWithAuth(provider, credentials);
  }

  if (cfg.credentialRef) {
    const decrypted = safeDecryptSecret(cfg.credentialRef);
    if (decrypted) return createTsdConnector(provider, decrypted);
  }

  if (cfg.username && cfg.password) {
    const decryptedUsername = safeDecryptSecret(cfg.username);
    const decryptedPassword = safeDecryptSecret(cfg.password);
    if (decryptedUsername && decryptedPassword) {
      const credentials: TsdAuthCredentials = {
        type: "username_password",
        username: decryptedUsername,
        password: decryptedPassword,
        agentId: process.env[`${provider.toUpperCase()}_AGENT_ID`] || undefined,
        partnerId: process.env[`${provider.toUpperCase()}_PARTNER_ID`] || undefined,
        securityToken: process.env[`${provider.toUpperCase()}_SECURITY_TOKEN`] || undefined,
      };
      if (provider === "telarus" && cfg.mfaCode) {
        credentials.mfaCode = safeDecryptSecret(cfg.mfaCode) || undefined;
      }
      if (provider === "telarus" && cfg.securityToken) {
        credentials.securityToken = safeDecryptSecret(cfg.securityToken) || credentials.securityToken;
      }
      return createTsdConnectorWithAuth(provider, credentials);
    }
  }

  return null;
}

async function logSync({
  provider,
  direction,
  entityType,
  status,
  recordsAffected,
  payloadSummary,
  errorMessage,
}: {
  provider: TsdProvider;
  direction: "outbound" | "inbound";
  entityType: "deal" | "lead" | "commission" | "webhook" | "opportunity" | "account" | "contact" | "order" | "quote" | "activity" | "task" | "vendor";
  status: "success" | "failure" | "partial";
  recordsAffected?: number;
  payloadSummary?: string;
  errorMessage?: string;
}) {
  await db.insert(tsdSyncLogsTable).values({
    provider,
    direction,
    entityType,
    status,
    recordsAffected: recordsAffected ?? 0,
    payloadSummary: payloadSummary?.slice(0, 1000),
    errorMessage: errorMessage?.slice(0, 2000),
  });
}

export async function pushDealToTSDs(deal: {
  id: number;
  title: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  description?: string | null;
  estimatedValue?: string | null;
  stage: string;
  products: string;
}): Promise<void> {
  const configs = await getEnabledConfigs();
  const products = (() => {
    try { return JSON.parse(deal.products); } catch { return []; }
  })();

  for (const cfg of configs) {
    const connector = buildConnectorForConfig(cfg);
    if (!connector) {
      await logSync({
        provider: cfg.provider as TsdProvider,
        direction: "outbound",
        entityType: "deal",
        status: "failure",
        errorMessage: `No credentials for ${cfg.provider}. Set ${cfg.provider.toUpperCase()}_API_KEY env var or configure via admin UI.`,
        payloadSummary: `Deal: ${deal.title}`,
      });
      continue;
    }

    try {
      const result = await connector.pushDeal({
        title: deal.title,
        customerName: deal.customerName,
        customerEmail: deal.customerEmail,
        customerPhone: deal.customerPhone,
        description: deal.description,
        estimatedValue: deal.estimatedValue,
        stage: deal.stage,
        products,
      });

      if (result.success && result.externalId) {
        await db.insert(tsdDealMappingsTable).values({
          dealId: deal.id,
          provider: cfg.provider as TsdProvider,
          externalId: result.externalId,
        });
      }

      await logSync({
        provider: cfg.provider as TsdProvider,
        direction: "outbound",
        entityType: "deal",
        status: result.success ? "success" : "failure",
        recordsAffected: result.success ? 1 : 0,
        payloadSummary: safeJsonStringify({ dealId: deal.id, title: deal.title, externalId: result.externalId }),
        errorMessage: result.error,
      });
    } catch (err) {
      await logSync({
        provider: cfg.provider as TsdProvider,
        direction: "outbound",
        entityType: "deal",
        status: "failure",
        errorMessage: err instanceof Error ? err.message : String(err),
        payloadSummary: `Deal: ${deal.title}`,
      });
    }
  }
}

export async function syncLeadsFromTSDs(provider?: TsdProvider): Promise<void> {
  const configs = await getEnabledConfigs(provider);

  for (const cfg of configs) {
    const connector = buildConnectorForConfig(cfg);
    if (!connector) continue;

    try {
      if (connector.login && !connector.isAuthenticated?.()) {
        const loginResult = await connector.login();
        if (!loginResult.success) {
          console.warn(`[TSD] ${cfg.provider} login failed: ${loginResult.error}`);
          await logSync({
            provider: cfg.provider as TsdProvider,
            direction: "inbound",
            entityType: "lead",
            status: "failure",
            errorMessage: `Authentication failed: ${loginResult.error}`,
          });
          continue;
        }
        if (cfg.provider === "telarus") {
          await clearMfaCode();
        }
      }

      const since = cfg.lastLeadSyncAt || undefined;
      const leads = await connector.pullLeads(since ?? undefined);

      let imported = 0;
      const source = `tsd:${cfg.provider}`;

      for (const lead of leads) {
        const existing = lead.email
          ? await db
            .select({ id: partnerLeadsTable.id })
            .from(partnerLeadsTable)
            .where(and(
              eq(partnerLeadsTable.source, source),
              eq(partnerLeadsTable.email, lead.email)
            ))
            .limit(1)
          : await db
            .select({ id: partnerLeadsTable.id })
            .from(partnerLeadsTable)
            .where(and(
              eq(partnerLeadsTable.source, source),
              eq(partnerLeadsTable.companyName, lead.companyName),
              eq(partnerLeadsTable.contactName, lead.contactName)
            ))
            .limit(1);

        if (existing.length === 0) {
          const firstPartner = await db.select({ id: partnersTable.id })
            .from(partnersTable)
            .limit(1);

          if (firstPartner.length > 0) {
            await db.insert(partnerLeadsTable).values({
              partnerId: firstPartner[0].id,
              companyName: lead.companyName,
              contactName: lead.contactName,
              email: lead.email || null,
              phone: lead.phone || null,
              source,
              interest: lead.interest || null,
              status: "new",
            });
            imported++;
          }
        }
      }

      await db.update(tsdConfigsTable)
        .set({ lastLeadSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(tsdConfigsTable.id, cfg.id));

      await logSync({
        provider: cfg.provider as TsdProvider,
        direction: "inbound",
        entityType: "lead",
        status: "success",
        recordsAffected: imported,
        payloadSummary: safeJsonStringify({ total: leads.length, imported }),
      });
    } catch (err) {
      await logSync({
        provider: cfg.provider as TsdProvider,
        direction: "inbound",
        entityType: "lead",
        status: "failure",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function syncCommissionsFromTSDs(provider?: TsdProvider): Promise<void> {
  const configs = await getEnabledConfigs(provider);

  for (const cfg of configs) {
    const connector = buildConnectorForConfig(cfg);
    if (!connector) continue;

    try {
      if (connector.login && !connector.isAuthenticated?.()) {
        const loginResult = await connector.login();
        if (!loginResult.success) {
          console.warn(`[TSD] ${cfg.provider} login failed: ${loginResult.error}`);
          await logSync({
            provider: cfg.provider as TsdProvider,
            direction: "inbound",
            entityType: "commission",
            status: "failure",
            errorMessage: `Authentication failed: ${loginResult.error}`,
          });
          continue;
        }
        if (cfg.provider === "telarus") {
          await clearMfaCode();
        }
      }

      const since = cfg.lastCommissionSyncAt || undefined;
      const commissions = await connector.pullCommissions(since ?? undefined);

      let matched = 0;
      let mismatched = 0;

      for (const tsdComm of commissions) {
        if (!tsdComm.dealReference) continue;

        const dealMapping = await db
          .select({ dealId: tsdDealMappingsTable.dealId })
          .from(tsdDealMappingsTable)
          .where(and(
            eq(tsdDealMappingsTable.provider, cfg.provider as TsdProvider),
            eq(tsdDealMappingsTable.externalId, tsdComm.dealReference)
          ))
          .limit(1);

        if (dealMapping.length === 0) continue;

        const localCommissions = await db
          .select()
          .from(partnerCommissionsTable)
          .where(eq(partnerCommissionsTable.dealId, dealMapping[0].dealId))
          .limit(1);

        if (localCommissions.length > 0) {
          const local = localCommissions[0];
          const localAmount = parseFloat(local.amount);
          const tsdAmount = parseFloat(tsdComm.amount);
          const amountMismatch = Math.abs(localAmount - tsdAmount) > 0.01;
          const statusMismatch = local.status !== tsdComm.status;

          if (amountMismatch || statusMismatch) {
            await db.update(partnerCommissionsTable)
              .set({
                tsdDiscrepancy: safeJsonStringify({
                  provider: cfg.provider,
                  externalId: tsdComm.dealReference,
                  tsdAmount,
                  tsdStatus: tsdComm.status,
                  localAmount,
                  localStatus: local.status,
                  detectedAt: new Date().toISOString(),
                }),
              })
              .where(eq(partnerCommissionsTable.id, local.id));
            mismatched++;
          } else {
            await db.update(partnerCommissionsTable)
              .set({ tsdDiscrepancy: null })
              .where(eq(partnerCommissionsTable.id, local.id));
            matched++;
          }
        }
      }

      await db.update(tsdConfigsTable)
        .set({ lastCommissionSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(tsdConfigsTable.id, cfg.id));

      await logSync({
        provider: cfg.provider as TsdProvider,
        direction: "inbound",
        entityType: "commission",
        status: mismatched > 0 ? "partial" : "success",
        recordsAffected: matched + mismatched,
        payloadSummary: safeJsonStringify({ total: commissions.length, matched, mismatched }),
      });
    } catch (err) {
      await logSync({
        provider: cfg.provider as TsdProvider,
        direction: "inbound",
        entityType: "commission",
        status: "failure",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ─── Generic upsert helper ────────────────────────────────────────────────────

async function upsertTelarusRecords<T extends { externalId: string }>(
  table: typeof telarusOpportunitiesTable | typeof telarusAccountsTable | typeof telarusContactsTable | typeof telarusOrdersTable | typeof telarusQuotesTable | typeof telarusActivitiesTable | typeof telarusTasksTable | typeof telarusVendorsTable,
  records: T[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mapper: (r: T) => Record<string, any>
): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const record of records) {
    const values = mapper(record);
    try {
      await (db as unknown as import("drizzle-orm/node-postgres").NodePgDatabase)
        .insert(table as never)
        .values({ ...values, syncedAt: new Date() })
        .onConflictDoUpdate({
          target: (table as { externalId: unknown }).externalId as never,
          set: { ...values, syncedAt: new Date() },
        });
      upserted++;
    } catch {
      // skip individual record errors
    }
  }
  return { upserted };
}

export async function syncOpportunitiesFromTelarus(provider?: TsdProvider): Promise<void> {
  const configs = await getEnabledConfigs(provider ?? "telarus");
  for (const cfg of configs) {
    if (cfg.provider !== "telarus") continue;
    const connector = buildConnectorForConfig(cfg);
    if (!connector?.pullOpportunities) continue;
    try {
      if (connector.login && !connector.isAuthenticated?.()) {
        const r = await connector.login();
        if (!r.success) {
          await logSync({ provider: "telarus", direction: "inbound", entityType: "opportunity", status: "failure", errorMessage: `Auth failed: ${r.error}` });
          continue;
        }
      }
      const since = cfg.lastOpportunitySyncAt ?? undefined;
      const items = await connector.pullOpportunities(since);
      const { upserted } = await upsertTelarusRecords(telarusOpportunitiesTable, items, (r) => ({
        externalId: r.externalId,
        name: r.name,
        accountName: r.accountName ?? null,
        accountId: r.accountId ?? null,
        amount: r.amount ?? null,
        stage: r.stage ?? null,
        probability: r.probability ?? null,
        closeDate: r.closeDate ?? null,
        type: r.type ?? null,
        description: r.description ?? null,
        leadSource: r.leadSource ?? null,
        ownerId: r.ownerId ?? null,
        ownerName: r.ownerName ?? null,
        rawData: JSON.stringify(r.rawData ?? {}),
      }));
      await db.update(tsdConfigsTable).set({ lastOpportunitySyncAt: new Date(), updatedAt: new Date() }).where(eq(tsdConfigsTable.id, cfg.id));
      await logSync({ provider: "telarus", direction: "inbound", entityType: "opportunity", status: "success", recordsAffected: upserted, payloadSummary: `total:${items.length} upserted:${upserted}` });
    } catch (err) {
      await logSync({ provider: "telarus", direction: "inbound", entityType: "opportunity", status: "failure", errorMessage: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function syncAccountsFromTelarus(provider?: TsdProvider): Promise<void> {
  const configs = await getEnabledConfigs(provider ?? "telarus");
  for (const cfg of configs) {
    if (cfg.provider !== "telarus") continue;
    const connector = buildConnectorForConfig(cfg);
    if (!connector?.pullAccounts) continue;
    try {
      if (connector.login && !connector.isAuthenticated?.()) {
        const r = await connector.login();
        if (!r.success) {
          await logSync({ provider: "telarus", direction: "inbound", entityType: "account", status: "failure", errorMessage: `Auth failed: ${r.error}` });
          continue;
        }
      }
      const since = cfg.lastAccountSyncAt ?? undefined;
      const items = await connector.pullAccounts(since);
      const { upserted } = await upsertTelarusRecords(telarusAccountsTable, items, (r) => ({
        externalId: r.externalId,
        name: r.name,
        industry: r.industry ?? null,
        phone: r.phone ?? null,
        website: r.website ?? null,
        billingStreet: r.billingStreet ?? null,
        billingCity: r.billingCity ?? null,
        billingState: r.billingState ?? null,
        billingPostalCode: r.billingPostalCode ?? null,
        billingCountry: r.billingCountry ?? null,
        employeeCount: r.employeeCount ?? null,
        annualRevenue: r.annualRevenue ?? null,
        type: r.type ?? null,
        description: r.description ?? null,
        rawData: JSON.stringify(r.rawData ?? {}),
      }));
      await db.update(tsdConfigsTable).set({ lastAccountSyncAt: new Date(), updatedAt: new Date() }).where(eq(tsdConfigsTable.id, cfg.id));
      await logSync({ provider: "telarus", direction: "inbound", entityType: "account", status: "success", recordsAffected: upserted, payloadSummary: `total:${items.length} upserted:${upserted}` });
    } catch (err) {
      await logSync({ provider: "telarus", direction: "inbound", entityType: "account", status: "failure", errorMessage: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function syncContactsFromTelarus(provider?: TsdProvider): Promise<void> {
  const configs = await getEnabledConfigs(provider ?? "telarus");
  for (const cfg of configs) {
    if (cfg.provider !== "telarus") continue;
    const connector = buildConnectorForConfig(cfg);
    if (!connector?.pullContacts) continue;
    try {
      if (connector.login && !connector.isAuthenticated?.()) {
        const r = await connector.login();
        if (!r.success) {
          await logSync({ provider: "telarus", direction: "inbound", entityType: "contact", status: "failure", errorMessage: `Auth failed: ${r.error}` });
          continue;
        }
      }
      const since = cfg.lastContactSyncAt ?? undefined;
      const items = await connector.pullContacts(since);
      const { upserted } = await upsertTelarusRecords(telarusContactsTable, items, (r) => ({
        externalId: r.externalId,
        firstName: r.firstName ?? null,
        lastName: r.lastName,
        email: r.email ?? null,
        phone: r.phone ?? null,
        mobilePhone: r.mobilePhone ?? null,
        title: r.title ?? null,
        department: r.department ?? null,
        accountId: r.accountId ?? null,
        accountName: r.accountName ?? null,
        mailingCity: r.mailingCity ?? null,
        mailingState: r.mailingState ?? null,
        rawData: JSON.stringify(r.rawData ?? {}),
      }));
      await db.update(tsdConfigsTable).set({ lastContactSyncAt: new Date(), updatedAt: new Date() }).where(eq(tsdConfigsTable.id, cfg.id));
      await logSync({ provider: "telarus", direction: "inbound", entityType: "contact", status: "success", recordsAffected: upserted, payloadSummary: `total:${items.length} upserted:${upserted}` });
    } catch (err) {
      await logSync({ provider: "telarus", direction: "inbound", entityType: "contact", status: "failure", errorMessage: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function syncOrdersFromTelarus(provider?: TsdProvider): Promise<void> {
  const configs = await getEnabledConfigs(provider ?? "telarus");
  for (const cfg of configs) {
    if (cfg.provider !== "telarus") continue;
    const connector = buildConnectorForConfig(cfg);
    if (!connector?.pullOrders) continue;
    try {
      if (connector.login && !connector.isAuthenticated?.()) {
        const r = await connector.login();
        if (!r.success) {
          await logSync({ provider: "telarus", direction: "inbound", entityType: "order", status: "failure", errorMessage: `Auth failed: ${r.error}` });
          continue;
        }
      }
      const since = cfg.lastOrderSyncAt ?? undefined;
      const items = await connector.pullOrders(since);
      const { upserted } = await upsertTelarusRecords(telarusOrdersTable, items, (r) => ({
        externalId: r.externalId,
        name: r.name,
        accountId: r.accountId ?? null,
        accountName: r.accountName ?? null,
        status: r.status ?? null,
        orderAmount: r.orderAmount ?? null,
        startDate: r.startDate ?? null,
        endDate: r.endDate ?? null,
        contractId: r.contractId ?? null,
        type: r.type ?? null,
        description: r.description ?? null,
        rawData: JSON.stringify(r.rawData ?? {}),
      }));
      await db.update(tsdConfigsTable).set({ lastOrderSyncAt: new Date(), updatedAt: new Date() }).where(eq(tsdConfigsTable.id, cfg.id));
      await logSync({ provider: "telarus", direction: "inbound", entityType: "order", status: "success", recordsAffected: upserted, payloadSummary: `total:${items.length} upserted:${upserted}` });
    } catch (err) {
      await logSync({ provider: "telarus", direction: "inbound", entityType: "order", status: "failure", errorMessage: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function syncQuotesFromTelarus(provider?: TsdProvider): Promise<void> {
  const configs = await getEnabledConfigs(provider ?? "telarus");
  for (const cfg of configs) {
    if (cfg.provider !== "telarus") continue;
    const connector = buildConnectorForConfig(cfg);
    if (!connector?.pullQuotes) continue;
    try {
      if (connector.login && !connector.isAuthenticated?.()) {
        const r = await connector.login();
        if (!r.success) {
          await logSync({ provider: "telarus", direction: "inbound", entityType: "quote", status: "failure", errorMessage: `Auth failed: ${r.error}` });
          continue;
        }
      }
      const since = cfg.lastQuoteSyncAt ?? undefined;
      const items = await connector.pullQuotes(since);
      const { upserted } = await upsertTelarusRecords(telarusQuotesTable, items, (r) => ({
        externalId: r.externalId,
        name: r.name,
        opportunityId: r.opportunityId ?? null,
        opportunityName: r.opportunityName ?? null,
        accountId: r.accountId ?? null,
        accountName: r.accountName ?? null,
        status: r.status ?? null,
        totalPrice: r.totalPrice ?? null,
        expirationDate: r.expirationDate ?? null,
        description: r.description ?? null,
        rawData: JSON.stringify(r.rawData ?? {}),
      }));
      await db.update(tsdConfigsTable).set({ lastQuoteSyncAt: new Date(), updatedAt: new Date() }).where(eq(tsdConfigsTable.id, cfg.id));
      await logSync({ provider: "telarus", direction: "inbound", entityType: "quote", status: "success", recordsAffected: upserted, payloadSummary: `total:${items.length} upserted:${upserted}` });
    } catch (err) {
      await logSync({ provider: "telarus", direction: "inbound", entityType: "quote", status: "failure", errorMessage: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function syncActivitiesFromTelarus(provider?: TsdProvider): Promise<void> {
  const configs = await getEnabledConfigs(provider ?? "telarus");
  for (const cfg of configs) {
    if (cfg.provider !== "telarus") continue;
    const connector = buildConnectorForConfig(cfg);
    if (!connector?.pullActivities) continue;
    try {
      if (connector.login && !connector.isAuthenticated?.()) {
        const r = await connector.login();
        if (!r.success) {
          await logSync({ provider: "telarus", direction: "inbound", entityType: "activity", status: "failure", errorMessage: `Auth failed: ${r.error}` });
          continue;
        }
      }
      const since = cfg.lastActivitySyncAt ?? undefined;
      const items = await connector.pullActivities(since);
      const { upserted } = await upsertTelarusRecords(telarusActivitiesTable, items, (r) => ({
        externalId: r.externalId,
        subject: r.subject,
        type: r.type ?? null,
        status: r.status ?? null,
        priority: r.priority ?? null,
        description: r.description ?? null,
        accountId: r.accountId ?? null,
        accountName: r.accountName ?? null,
        whoId: r.whoId ?? null,
        whoName: r.whoName ?? null,
        whatId: r.whatId ?? null,
        whatName: r.whatName ?? null,
        activityDate: r.activityDate ?? null,
        durationMinutes: r.durationMinutes ?? null,
        rawData: JSON.stringify(r.rawData ?? {}),
      }));
      await db.update(tsdConfigsTable).set({ lastActivitySyncAt: new Date(), updatedAt: new Date() }).where(eq(tsdConfigsTable.id, cfg.id));
      await logSync({ provider: "telarus", direction: "inbound", entityType: "activity", status: "success", recordsAffected: upserted, payloadSummary: `total:${items.length} upserted:${upserted}` });
    } catch (err) {
      await logSync({ provider: "telarus", direction: "inbound", entityType: "activity", status: "failure", errorMessage: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function syncTasksFromTelarus(provider?: TsdProvider): Promise<void> {
  const configs = await getEnabledConfigs(provider ?? "telarus");
  for (const cfg of configs) {
    if (cfg.provider !== "telarus") continue;
    const connector = buildConnectorForConfig(cfg);
    if (!connector?.pullTasks) continue;
    try {
      if (connector.login && !connector.isAuthenticated?.()) {
        const r = await connector.login();
        if (!r.success) {
          await logSync({ provider: "telarus", direction: "inbound", entityType: "task", status: "failure", errorMessage: `Auth failed: ${r.error}` });
          continue;
        }
      }
      const since = cfg.lastTaskSyncAt ?? undefined;
      const items = await connector.pullTasks(since);
      const { upserted } = await upsertTelarusRecords(telarusTasksTable, items, (r) => ({
        externalId: r.externalId,
        subject: r.subject,
        status: r.status ?? null,
        priority: r.priority ?? null,
        description: r.description ?? null,
        whoId: r.whoId ?? null,
        whoName: r.whoName ?? null,
        whatId: r.whatId ?? null,
        whatName: r.whatName ?? null,
        ownerId: r.ownerId ?? null,
        ownerName: r.ownerName ?? null,
        activityDate: r.activityDate ?? null,
        isCompleted: r.isCompleted ?? false,
        rawData: JSON.stringify(r.rawData ?? {}),
      }));
      await db.update(tsdConfigsTable).set({ lastTaskSyncAt: new Date(), updatedAt: new Date() }).where(eq(tsdConfigsTable.id, cfg.id));
      await logSync({ provider: "telarus", direction: "inbound", entityType: "task", status: "success", recordsAffected: upserted, payloadSummary: `total:${items.length} upserted:${upserted}` });
    } catch (err) {
      await logSync({ provider: "telarus", direction: "inbound", entityType: "task", status: "failure", errorMessage: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function syncVendorsFromTelarus(provider?: TsdProvider): Promise<void> {
  const configs = await getEnabledConfigs(provider ?? "telarus");
  for (const cfg of configs) {
    if (cfg.provider !== "telarus") continue;
    const connector = buildConnectorForConfig(cfg);
    if (!connector?.pullVendors) continue;
    try {
      if (connector.login && !connector.isAuthenticated?.()) {
        const r = await connector.login();
        if (!r.success) {
          await logSync({ provider: "telarus", direction: "inbound", entityType: "vendor", status: "failure", errorMessage: `Auth failed: ${r.error}` });
          continue;
        }
      }
      const since = cfg.lastVendorSyncAt ?? undefined;
      const items = await connector.pullVendors(since);
      const { upserted } = await upsertTelarusRecords(telarusVendorsTable, items, (r) => ({
        externalId: r.externalId,
        name: r.name,
        accountType: r.accountType ?? null,
        industry: r.industry ?? null,
        phone: r.phone ?? null,
        website: r.website ?? null,
        billingStreet: r.billingStreet ?? null,
        billingCity: r.billingCity ?? null,
        billingState: r.billingState ?? null,
        billingPostalCode: r.billingPostalCode ?? null,
        billingCountry: r.billingCountry ?? null,
        description: r.description ?? null,
        partnerType: r.partnerType ?? null,
        partnerStatus: r.partnerStatus ?? null,
        numberOfEmployees: r.numberOfEmployees ?? null,
        annualRevenue: r.annualRevenue ?? null,
        isActive: r.isActive ?? true,
        products: JSON.stringify((r as any).products ?? []),
        rawData: JSON.stringify(r.rawData ?? {}),
      }));
      await db.update(tsdConfigsTable).set({ lastVendorSyncAt: new Date(), updatedAt: new Date() }).where(eq(tsdConfigsTable.id, cfg.id));
      await logSync({ provider: "telarus", direction: "inbound", entityType: "vendor", status: "success", recordsAffected: upserted, payloadSummary: `total:${items.length} upserted:${upserted}` });
    } catch (err) {
      await logSync({ provider: "telarus", direction: "inbound", entityType: "vendor", status: "failure", errorMessage: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function syncAllTelarusData(): Promise<void> {
  console.log("[TSD] Running full Telarus data sync...");
  await Promise.allSettled([
    syncOpportunitiesFromTelarus(),
    syncAccountsFromTelarus(),
    syncContactsFromTelarus(),
    syncOrdersFromTelarus(),
    syncQuotesFromTelarus(),
    syncActivitiesFromTelarus(),
    syncTasksFromTelarus(),
    syncVendorsFromTelarus(),
  ]);
  console.log("[TSD] Full Telarus data sync complete.");
}

export async function ensureTsdConfigsExist(): Promise<void> {
  for (const provider of TSD_PROVIDERS) {
    const existing = await db.select({ id: tsdConfigsTable.id })
      .from(tsdConfigsTable)
      .where(eq(tsdConfigsTable.provider, provider))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(tsdConfigsTable).values({
        provider,
        enabled: false,
      });
    }
  }
}

export async function startTsdSyncScheduler(): Promise<void> {
  console.log("[TSD] Starting sync scheduler...");

  const leadIntervalMinutes = getSyncInterval("LEAD_SYNC_INTERVAL_MINUTES", 15);
  const commissionIntervalMinutes = getSyncInterval("COMMISSION_SYNC_INTERVAL_MINUTES", 60);

  setInterval(async () => {
    try {
      await syncLeadsFromTSDs();
    } catch (err) {
      console.error("[TSD] Lead sync error:", err);
    }
  }, leadIntervalMinutes * 60 * 1000);

  setInterval(async () => {
    try {
      await syncCommissionsFromTSDs();
    } catch (err) {
      console.error("[TSD] Commission sync error:", err);
    }
  }, commissionIntervalMinutes * 60 * 1000);

  const telarusIntervalMinutes = getSyncInterval("TELARUS_FULL_SYNC_INTERVAL_MINUTES", 120);

  setInterval(async () => {
    try {
      await syncAllTelarusData();
    } catch (err) {
      console.error("[TSD] Telarus full sync error:", err);
    }
  }, telarusIntervalMinutes * 60 * 1000);

  setTimeout(async () => {
    try {
      console.log("[TSD] Running initial sync...");
      await syncLeadsFromTSDs();
      await syncCommissionsFromTSDs();
      await syncAllTelarusData();
      console.log("[TSD] Initial sync complete.");
    } catch (err) {
      console.error("[TSD] Initial sync error:", err);
    }
  }, 10_000);

  console.log(`[TSD] Scheduler started: leads every ${leadIntervalMinutes}min, commissions every ${commissionIntervalMinutes}min, telarus full sync every ${telarusIntervalMinutes}min`);
}
