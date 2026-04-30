/**
 * Connector Referral Reward Calculator
 *
 * Tiers (based on closed Annual Contract Value):
 *   Tier 1: ACV ≤ $25,000          → $150
 *   Tier 2: $25,001 – $75,000       → $500
 *   Tier 3: $75,001 – $200,000      → $1,250
 *   Tier 4: ACV > $200,000          → $2,500
 *
 * Multi-location bonus: +$500 when multiLocation === "yes"
 *
 * Payout timeline:
 *   payoutDueAt   = firstInvoicePaidAt + 30 days
 *   clawbackUntil = payoutDueAt        + 90 days
 */

export type RewardTier = "tier1" | "tier2" | "tier3" | "tier4";

export interface RewardResult {
  tierName: RewardTier;
  tierLabel: string;
  baseAmountCents: number;
  multiLocationBonusCents: number;
  totalAmountCents: number;
}

export interface PayoutDates {
  payoutDueAt: Date;
  clawbackUntil: Date;
}

const TIER_THRESHOLDS: Array<{ max: number | null; tier: RewardTier; label: string; cents: number }> = [
  { max: 25_000_00, tier: "tier1", label: "Tier 1 (≤$25K ACV)", cents: 150_00 },
  { max: 75_000_00, tier: "tier2", label: "Tier 2 ($25K–$75K ACV)", cents: 500_00 },
  { max: 200_000_00, tier: "tier3", label: "Tier 3 ($75K–$200K ACV)", cents: 1_250_00 },
  { max: null, tier: "tier4", label: "Tier 4 ($200K+ ACV)", cents: 2_500_00 },
];

const MULTI_LOCATION_BONUS_CENTS = 500_00;
const PAYOUT_DELAY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CLAWBACK_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export function computeReward(
  actualAcvCents: number,
  multiLocation: string | null | undefined,
): RewardResult {
  const tier = TIER_THRESHOLDS.find(
    (t) => t.max === null || actualAcvCents <= t.max,
  )!;

  const multiBonus = multiLocation === "yes" ? MULTI_LOCATION_BONUS_CENTS : 0;

  return {
    tierName: tier.tier,
    tierLabel: tier.label,
    baseAmountCents: tier.cents,
    multiLocationBonusCents: multiBonus,
    totalAmountCents: tier.cents + multiBonus,
  };
}

export function computePayoutDates(firstInvoicePaidAt: Date): PayoutDates {
  const payoutDueAt = new Date(firstInvoicePaidAt.getTime() + PAYOUT_DELAY_MS);
  const clawbackUntil = new Date(payoutDueAt.getTime() + CLAWBACK_WINDOW_MS);
  return { payoutDueAt, clawbackUntil };
}
