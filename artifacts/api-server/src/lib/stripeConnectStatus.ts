import { db, partnersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getStripe, isStripeConfigured } from "./stripe.js";
import { recordOnboardingEvent } from "./onboardingEvents.js";
import type Stripe from "stripe";

export type StripeConnectStatusValue = "not_started" | "in_progress" | "restricted" | "complete" | "invalid";

export interface StripeConnectStatus {
  status: StripeConnectStatusValue;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  blockingRequirement: string | null;
  accountId: string | null;
  accountType: string | null;
  refreshedAt: Date;
}

function summarizeRequirements(account: Stripe.Account): string | null {
  const reqs = account.requirements;
  if (!reqs) return null;
  // Prefer currently_due then past_due then disabled_reason
  const due = reqs.currently_due ?? [];
  const pastDue = reqs.past_due ?? [];
  const disabledReason = reqs.disabled_reason ?? null;
  if (pastDue.length > 0) return `Past due: ${pastDue.slice(0, 3).join(", ")}`;
  if (due.length > 0) return `Currently due: ${due.slice(0, 3).join(", ")}`;
  if (disabledReason) return `Disabled: ${disabledReason}`;
  return null;
}

/**
 * Compute Stripe Connect status from a freshly retrieved Stripe account.
 * Captures the single most blocking requirement so the Onboarding Command
 * Center can display "this is what is stopping payouts".
 */
export function computeStripeStatusFromAccount(account: Stripe.Account): Omit<StripeConnectStatus, "refreshedAt"> {
  const payoutsEnabled = account.payouts_enabled ?? false;
  const detailsSubmitted = account.details_submitted ?? false;
  const blocking = summarizeRequirements(account);
  let status: StripeConnectStatusValue;
  if (payoutsEnabled && !blocking) {
    status = "complete";
  } else if (!detailsSubmitted) {
    status = "in_progress";
  } else if (blocking) {
    status = "restricted";
  } else {
    status = "in_progress";
  }
  return {
    status,
    payoutsEnabled,
    detailsSubmitted,
    blockingRequirement: blocking,
    accountId: account.id,
    accountType: account.type ?? null,
  };
}

/**
 * Refresh and persist the cached Stripe Connect status for one partner.
 * Returns the resolved status (or a synthetic one when Stripe isn't configured
 * or the account ID is missing). Always writes `stripeConnectRefreshedAt`.
 */
export async function refreshPartnerStripeStatus(partnerId: number): Promise<StripeConnectStatus> {
  const [partner] = await db
    .select({
      id: partnersTable.id,
      stripeConnectAccountId: partnersTable.stripeConnectAccountId,
      stripeConnectStatus: partnersTable.stripeConnectStatus,
      stripeConnectBlockingRequirement: partnersTable.stripeConnectBlockingRequirement,
    })
    .from(partnersTable)
    .where(eq(partnersTable.id, partnerId))
    .limit(1);
  if (!partner) {
    throw new Error(`Partner ${partnerId} not found`);
  }
  const refreshedAt = new Date();
  const accountId = partner.stripeConnectAccountId;
  const prevStatus = partner.stripeConnectStatus ?? null;
  const prevBlocking = partner.stripeConnectBlockingRequirement ?? null;
  // Helper: log a stripe_connect onboarding event when the cached status
  // (or the blocking requirement, even within the same status) actually
  // transitions, so the timeline records every meaningful change.
  const logTransition = (nextStatus: string, nextBlocking: string | null) => {
    if (nextStatus === prevStatus && nextBlocking === prevBlocking) return;
    recordOnboardingEvent({
      flow: "stripe_connect", entityId: partnerId, eventType: "status_changed",
      actorType: "system",
      note: `Status ${prevStatus ?? "—"} → ${nextStatus}${nextBlocking ? ` (blocked on ${nextBlocking})` : ""}`,
      payload: { from: prevStatus, to: nextStatus, blockingRequirement: nextBlocking },
    }).catch(() => {});
  };

  if (!isStripeConfigured() || !accountId) {
    const status: StripeConnectStatusValue = "not_started";
    const blocking = !isStripeConfigured() ? "stripe_not_configured" : "no_account";
    await db
      .update(partnersTable)
      .set({
        stripeConnectStatus: status,
        stripeConnectBlockingRequirement: blocking,
        stripeConnectRefreshedAt: refreshedAt,
      })
      .where(eq(partnersTable.id, partnerId));
    logTransition(status, blocking);
    return {
      status,
      payoutsEnabled: false,
      detailsSubmitted: false,
      blockingRequirement: blocking,
      accountId: accountId ?? null,
      accountType: null,
      refreshedAt,
    };
  }

  try {
    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(accountId);
    const computed = computeStripeStatusFromAccount(account);
    await db
      .update(partnersTable)
      .set({
        stripeConnectStatus: computed.status,
        stripeConnectBlockingRequirement: computed.blockingRequirement,
        stripeConnectRefreshedAt: refreshedAt,
      })
      .where(eq(partnersTable.id, partnerId));
    logTransition(computed.status, computed.blockingRequirement);
    return { ...computed, refreshedAt };
  } catch (err) {
    console.error(`[StripeConnect] retrieve failed for partner ${partnerId} (acct=${accountId}):`, err);
    const blocking = err instanceof Error ? err.message : "stripe_retrieve_failed";
    await db
      .update(partnersTable)
      .set({
        stripeConnectStatus: "invalid",
        stripeConnectBlockingRequirement: blocking,
        stripeConnectRefreshedAt: refreshedAt,
      })
      .where(eq(partnersTable.id, partnerId));
    logTransition("invalid", blocking);
    return {
      status: "invalid",
      payoutsEnabled: false,
      detailsSubmitted: false,
      blockingRequirement: blocking,
      accountId,
      accountType: null,
      refreshedAt,
    };
  }
}
