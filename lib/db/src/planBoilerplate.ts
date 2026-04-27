// Static legal & structural boilerplate appended to every Written Plan.
// Rendered at view time (PDF, partner preview, client review) so existing
// plans pick up changes automatically without a JSON schema migration.

export const SERVICE_LEVELS: { tier: string; target: string }[] = [
  { tier: "Critical (production down, security incident)", target: "15-minute response, 4-hour resolution target" },
  { tier: "High (major function impaired, multiple users)", target: "1-hour response, 8-business-hour resolution target" },
  { tier: "Standard (single user / non-blocking issue)", target: "4-business-hour response, next-business-day target" },
  { tier: "Low / scheduled (requests, change windows)", target: "1-business-day response, scheduled per agreement" },
];

export const CLIENT_RESPONSIBILITIES: string[] = [
  "Designate a primary point of contact authorized to approve work and access requests.",
  "Provide timely access to systems, network, credentials, and on-site facilities required to deliver services.",
  "Maintain valid licensing for third-party software and cloud subscriptions covered by this plan.",
  "Notify Siebert Services of material changes to the environment (M&A, new offices, regulatory scope, headcount swings).",
  "Cooperate in good faith with security best-practice recommendations (MFA enforcement, patching cadence, backup testing).",
];

export const ASSUMPTIONS: string[] = [
  "Pricing and scope reflect information provided by the Client during discovery and may be adjusted following on-site or remote technical assessment.",
  "Services are delivered remotely from the United States unless on-site work is expressly scoped.",
  "Hardware, software licenses, telecom circuits, and third-party SaaS are billed at cost plus management fee unless otherwise noted.",
  "Project work outside recurring scope (migrations, deployments, audits) is quoted separately as a Statement of Work.",
];

export const CONFIDENTIALITY_TEXT =
  "This document and any information disclosed during discovery are confidential and proprietary to Siebert Services LLC and the Client. " +
  "Recipient agrees to use the contents solely for the purpose of evaluating the proposed engagement and to not disclose any portion to a third party " +
  "without the prior written consent of Siebert Services LLC, except to legal, accounting, or financial advisors bound by similar confidentiality obligations.";

export const TERMS_TEXT =
  "This Written Plan is a non-binding proposal prepared by Siebert Services LLC. It does not constitute a contract, statement of work, or " +
  "purchase order. Any engagement arising from this plan will be governed by a separate Master Services Agreement (MSA) and applicable " +
  "Statements of Work (SOWs) executed by both parties. Pricing is preliminary and subject to confirmation in the MSA / SOW. To the maximum extent " +
  "permitted by law, Siebert Services' aggregate liability arising out of or relating to this plan is limited to fees actually paid under any " +
  "subsequent agreement during the three (3) months preceding the claim. This plan and any resulting agreement shall be governed by the laws of the " +
  "State of New York, without regard to its conflict-of-laws principles.";

export const ACCEPTANCE_TEXT =
  "By signing below, the undersigned represents that they are duly authorized to act on behalf of the Client and indicates the Client's " +
  "intent to proceed to a Master Services Agreement substantially consistent with the scope and assumptions set forth in this Written Plan. " +
  "Signature does not create binding payment or delivery obligations until an MSA and corresponding Statement of Work are executed by both parties.";

export function investmentSummaryText(answers: Record<string, unknown>): string {
  const budget = typeof answers.budgetRange === "string" ? answers.budgetRange : "";
  const headcount = typeof answers.headcount === "string" ? answers.headcount : "";
  const base = budget
    ? `Client has indicated a target investment range of ${budget}. Final pricing will be confirmed in the Master Services Agreement based on the agreed scope and any options selected during the contracting phase.`
    : "Pricing has not yet been defined. Siebert Services will provide a detailed investment summary in the Master Services Agreement based on the agreed scope.";
  const sizing = headcount
    ? ` Initial sizing assumes a workforce of approximately ${headcount} employees.`
    : "";
  return base + sizing + " All recurring services are billed monthly in advance; project work is invoiced per Statement of Work.";
}

// ─── Consumer / Residential Boilerplate ─────────────────────────────────────

export const CONSUMER_SERVICE_LEVELS: { tier: string; target: string }[] = [
  { tier: "Urgent (security incident, device completely down)", target: "Response within 2 hours, same-day resolution target" },
  { tier: "Standard (general support, setup, connectivity issues)", target: "Response within 4 business hours, next-day resolution target" },
  { tier: "Routine (new device setup, subscription help, advice)", target: "Response within 1 business day, scheduled per agreement" },
];

export const CONSUMER_CLIENT_RESPONSIBILITIES: string[] = [
  "Provide remote access to devices as needed for troubleshooting and maintenance sessions.",
  "Keep devices powered on and connected to the internet to allow for remote support.",
  "Maintain active subscriptions for any third-party software or services included in this plan.",
  "Notify Siebert Services of new devices or significant changes to your home network.",
  "Follow recommended security practices including enabling recommended updates and software patches.",
];

export const CONSUMER_ASSUMPTIONS: string[] = [
  "Services are provided for personal, residential use only and are not intended for commercial or business purposes.",
  "Remote support is delivered from the United States; on-site visits are available by appointment at an additional rate.",
  "Hardware, software licenses, and third-party subscriptions are billed at cost plus a service fee unless otherwise noted.",
  "Scope and pricing reflect information provided during discovery and may be adjusted following a full device assessment.",
];

export function consumerInvestmentSummaryText(answers: Record<string, unknown>): string {
  const budget = typeof answers.budgetRange === "string" ? answers.budgetRange : "";
  const devices = typeof answers.numDevices === "string" ? answers.numDevices : "";
  const base = budget
    ? `Based on your indicated budget of ${budget}, Siebert Services will work with you to select the right mix of services that fit your needs.`
    : "Siebert Services will provide personalized pricing based on your selected services following the initial home technology assessment.";
  const sizing = devices ? ` Initial scope assumes approximately ${devices} connected devices in the home.` : "";
  return base + sizing + " Residential services are billed monthly with no long-term contracts required unless otherwise agreed.";
}

export function validityNotice(validityDays: number, expiresAt: Date | string | null | undefined): string {
  const days = Number.isFinite(validityDays) && validityDays > 0 ? validityDays : 30;
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (!isNaN(d.getTime())) {
      return `This Written Plan is valid for ${days} days from issuance and expires on ${d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. Pricing, scope, and terms may be re-quoted after expiration.`;
    }
  }
  return `This Written Plan is valid for ${days} days from issuance. Pricing, scope, and terms may be re-quoted after expiration.`;
}
