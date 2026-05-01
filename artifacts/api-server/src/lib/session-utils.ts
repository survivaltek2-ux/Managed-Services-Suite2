// Shared helpers used by every auth middleware (Task #187).
//
// Provides:
//   • A cached lookup against `azure_ad_revoked_sessions` so we can reject
//     a JWT the instant an admin (or Azure-side role removal) revokes it,
//     without paying a DB round-trip on every single request.
//   • A small in-memory cache of the current rollout mode so the request
//     hot-path can decide whether to revalidate against Azure at all.

import { db, azureAdRevokedSessionsTable, securitySettingsTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";
import { getRolloutMode, type RolloutMode } from "./azure-ad-access.js";

const REVOKED_TTL_MS = 30_000;
const ROLLOUT_TTL_MS = 30_000;
const SECURITY_TTL_MS = 30_000;
const SECURITY_SETTINGS_KEY = "main";

const revokedCache = new Map<string, { revoked: boolean; expiresAt: number }>();
let rolloutCache: { mode: RolloutMode; expiresAt: number } | null = null;
let securityCache: { revokedBefore: Date | null; expiresAt: number } | null = null;

/** Returns true when the given JWT id has been added to the revocation list. */
export async function isJtiRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  const now = Date.now();
  const cached = revokedCache.get(jti);
  if (cached && cached.expiresAt > now) return cached.revoked;
  try {
    const [row] = await db
      .select({ id: azureAdRevokedSessionsTable.id })
      .from(azureAdRevokedSessionsTable)
      .where(eq(azureAdRevokedSessionsTable.jti, jti))
      .limit(1);
    const revoked = Boolean(row);
    revokedCache.set(jti, { revoked, expiresAt: now + REVOKED_TTL_MS });
    return revoked;
  } catch (err) {
    console.error("[session-utils] isJtiRevoked error:", err);
    // Fail-open: a transient DB error must not lock everyone out.
    return false;
  }
}

/** Inserts a jti into the revocation list. Idempotent. */
export async function revokeJti(jti: string, reason = "manual", expiresAt?: Date): Promise<void> {
  try {
    await db.insert(azureAdRevokedSessionsTable).values({
      jti,
      reason,
      expiresAt: expiresAt ?? null,
    }).onConflictDoNothing();
    revokedCache.set(jti, { revoked: true, expiresAt: Date.now() + REVOKED_TTL_MS });
  } catch (err) {
    console.error("[session-utils] revokeJti error:", err);
  }
}

/** Cleans up rows whose `expiresAt` has already passed. */
export async function pruneExpiredRevocations(): Promise<number> {
  try {
    const res = await db
      .delete(azureAdRevokedSessionsTable)
      .where(lt(azureAdRevokedSessionsTable.expiresAt, new Date()));
    // drizzle returns affected count via .rowCount on pg
    return ((res as unknown as { rowCount?: number }).rowCount) ?? 0;
  } catch (err) {
    console.error("[session-utils] pruneExpiredRevocations error:", err);
    return 0;
  }
}

/** Cached rollout-mode read (settings table). */
export async function getCachedRolloutMode(): Promise<RolloutMode> {
  const now = Date.now();
  if (rolloutCache && rolloutCache.expiresAt > now) return rolloutCache.mode;
  const mode = await getRolloutMode();
  rolloutCache = { mode, expiresAt: now + ROLLOUT_TTL_MS };
  return mode;
}

/** Bust the rollout cache when an admin flips the switch. */
export function bustRolloutCache(): void {
  rolloutCache = null;
}

/**
 * Returns the global "sessions issued before this timestamp are invalid" value.
 * Cached for SECURITY_TTL_MS to avoid a DB hit on every request.
 */
export async function getSessionsRevokedBefore(): Promise<Date | null> {
  const now = Date.now();
  if (securityCache && securityCache.expiresAt > now) return securityCache.revokedBefore;
  try {
    const [row] = await db
      .select({ sessionsRevokedBefore: securitySettingsTable.sessionsRevokedBefore })
      .from(securitySettingsTable)
      .where(eq(securitySettingsTable.key, SECURITY_SETTINGS_KEY))
      .limit(1);
    const revokedBefore = row?.sessionsRevokedBefore ?? null;
    securityCache = { revokedBefore, expiresAt: now + SECURITY_TTL_MS };
    return revokedBefore;
  } catch (err) {
    console.error("[session-utils] getSessionsRevokedBefore error:", err);
    return null;
  }
}

/**
 * Sets the global sessions-revoked-before timestamp and busts the cache.
 * Upserts the singleton row so it works on first call with no existing row.
 */
export async function setSessionsRevokedBefore(
  revokedBefore: Date,
  byUserId?: number,
  byEmail?: string,
): Promise<void> {
  await db
    .insert(securitySettingsTable)
    .values({
      key: SECURITY_SETTINGS_KEY,
      sessionsRevokedBefore: revokedBefore,
      updatedAt: new Date(),
      updatedByUserId: byUserId ?? null,
      updatedByEmail: byEmail ?? null,
    })
    .onConflictDoUpdate({
      target: securitySettingsTable.key,
      set: {
        sessionsRevokedBefore: revokedBefore,
        updatedAt: new Date(),
        updatedByUserId: byUserId ?? null,
        updatedByEmail: byEmail ?? null,
      },
    });
  securityCache = { revokedBefore, expiresAt: Date.now() + SECURITY_TTL_MS };
}
