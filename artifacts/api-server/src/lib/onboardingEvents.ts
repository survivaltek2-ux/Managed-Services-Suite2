import { db } from "@workspace/db";
import { onboardingEventsTable, onboardingSettingsTable, type InsertOnboardingEvent } from "@workspace/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

export type OnboardingFlow =
  | "client_onboarding"
  | "partner_application"
  | "partner_team_invite"
  | "stripe_connect"
  | "admin_account";

export type OnboardingActorType = "system" | "admin" | "partner" | "client";

export interface RecordOnboardingEventArgs {
  flow: OnboardingFlow;
  entityId: number;
  eventType: string;
  actorType?: OnboardingActorType;
  actorId?: number | null;
  actorLabel?: string | null;
  note?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Append a single audit event to the unified onboarding event log.
 * Failures are swallowed (logged) so audit logging never breaks the
 * primary write path.
 */
export async function recordOnboardingEvent(args: RecordOnboardingEventArgs): Promise<void> {
  try {
    const insert: InsertOnboardingEvent = {
      flow: args.flow,
      entityId: args.entityId,
      eventType: args.eventType,
      actorType: args.actorType ?? "system",
      actorId: args.actorId ?? null,
      actorLabel: args.actorLabel ?? null,
      note: args.note ?? null,
      payload: args.payload ?? {},
    };
    await db.insert(onboardingEventsTable).values(insert);
  } catch (err) {
    console.error("[OnboardingEvents] record failed:", err, args);
  }
}

export async function listEventsForEntity(flow: OnboardingFlow, entityId: number, limit = 50) {
  return db
    .select()
    .from(onboardingEventsTable)
    .where(and(eq(onboardingEventsTable.flow, flow), eq(onboardingEventsTable.entityId, entityId)))
    .orderBy(desc(onboardingEventsTable.createdAt))
    .limit(limit);
}

export async function listRecentEvents(limit = 100, flowFilter?: OnboardingFlow[]) {
  const q = db.select().from(onboardingEventsTable).orderBy(desc(onboardingEventsTable.createdAt)).limit(limit);
  if (flowFilter && flowFilter.length > 0) {
    return db
      .select()
      .from(onboardingEventsTable)
      .where(inArray(onboardingEventsTable.flow, flowFilter as string[]))
      .orderBy(desc(onboardingEventsTable.createdAt))
      .limit(limit);
  }
  return q;
}

export interface OnboardingSettingsResolved {
  paused: boolean;
  clientOnboardingOverdueHours: number;
  partnerApplicationOverdueHours: number;
  partnerTeamInviteOverdueHours: number;
  stripeConnectOverdueHours: number;
  adminAccountOverdueHours: number;
  reminderCooldownHours: number;
  maxRemindersPerEntity: number;
}

const DEFAULT_SETTINGS: OnboardingSettingsResolved = {
  paused: false,
  clientOnboardingOverdueHours: 72,
  partnerApplicationOverdueHours: 48,
  partnerTeamInviteOverdueHours: 72,
  stripeConnectOverdueHours: 72,
  adminAccountOverdueHours: 72,
  reminderCooldownHours: 48,
  maxRemindersPerEntity: 3,
};

export async function loadOnboardingSettings(): Promise<OnboardingSettingsResolved> {
  try {
    const [row] = await db.select().from(onboardingSettingsTable).orderBy(onboardingSettingsTable.id).limit(1);
    if (!row) return DEFAULT_SETTINGS;
    return {
      paused: row.paused,
      clientOnboardingOverdueHours: row.clientOnboardingOverdueHours,
      partnerApplicationOverdueHours: row.partnerApplicationOverdueHours,
      partnerTeamInviteOverdueHours: row.partnerTeamInviteOverdueHours,
      stripeConnectOverdueHours: row.stripeConnectOverdueHours,
      adminAccountOverdueHours: row.adminAccountOverdueHours,
      reminderCooldownHours: row.reminderCooldownHours,
      maxRemindersPerEntity: row.maxRemindersPerEntity,
    };
  } catch (err) {
    console.error("[OnboardingSettings] load failed:", err);
    return DEFAULT_SETTINGS;
  }
}

export async function updateOnboardingSettings(patch: Partial<OnboardingSettingsResolved>): Promise<OnboardingSettingsResolved> {
  // Ensure singleton row exists
  await db.execute(sql`INSERT INTO onboarding_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  const updates: Partial<typeof onboardingSettingsTable.$inferInsert> = { updatedAt: new Date() };
  if (patch.paused !== undefined) updates.paused = patch.paused;
  if (patch.clientOnboardingOverdueHours !== undefined) updates.clientOnboardingOverdueHours = patch.clientOnboardingOverdueHours;
  if (patch.partnerApplicationOverdueHours !== undefined) updates.partnerApplicationOverdueHours = patch.partnerApplicationOverdueHours;
  if (patch.partnerTeamInviteOverdueHours !== undefined) updates.partnerTeamInviteOverdueHours = patch.partnerTeamInviteOverdueHours;
  if (patch.stripeConnectOverdueHours !== undefined) updates.stripeConnectOverdueHours = patch.stripeConnectOverdueHours;
  if (patch.adminAccountOverdueHours !== undefined) updates.adminAccountOverdueHours = patch.adminAccountOverdueHours;
  if (patch.reminderCooldownHours !== undefined) updates.reminderCooldownHours = patch.reminderCooldownHours;
  if (patch.maxRemindersPerEntity !== undefined) updates.maxRemindersPerEntity = patch.maxRemindersPerEntity;
  await db.update(onboardingSettingsTable).set(updates).where(eq(onboardingSettingsTable.id, 1));
  return loadOnboardingSettings();
}
