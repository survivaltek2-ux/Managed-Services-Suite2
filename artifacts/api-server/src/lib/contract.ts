import PDFDocument from "pdfkit";

export interface ContractParams {
  customerName: string;
  customerEmail: string;
  companyName: string;
  planName: string;
  planSlug: string;
  billingCycle: "monthly" | "annual" | string;
  pricePerUser: number;
  seats: number;
  subscriptionId: string;
  effectiveDate: Date;
  customerType?: "business" | "consumer";
  initialTermMonths?: number;
  commitmentEndsAt?: Date;
}

const COMPANY_NAME = "Siebert Services LLC";
const COMPANY_ADDRESS = "New York, NY";
const COMPANY_PHONE = "866-484-9180";
const COMPANY_EMAIL = "contracts@siebertrservices.com";
const COMPANY_WEBSITE = "www.siebertrservices.com";
const CONTRACT_VERSION = "v2.1";

const PLAN_FEATURES: Record<string, string[]> = {
  essentials: [
    "Business-hours help desk (Monday–Friday, 8 AM – 5 PM ET)",
    "Remote monitoring and automated patch management",
    "Endpoint antivirus and threat prevention",
    "Microsoft 365 administration and license management",
    "Quarterly system health check reports",
    "Email and phone support",
  ],
  business: [
    "Extended-hours help desk (7 AM – 8 PM ET, Monday–Friday)",
    "Remote monitoring and automated patch management",
    "Endpoint Detection & Response (EDR)",
    "Microsoft 365 administration plus security hardening",
    "Multi-factor authentication rollout and enforcement",
    "Backup and disaster-recovery monitoring",
    "Quarterly business reviews with virtual CIO (vCIO)",
    "On-site dispatch (4 hours/month, New York only)",
  ],
  enterprise: [
    "24/7/365 help desk with dedicated emergency line",
    "Full Endpoint Detection & Response plus Managed SOC monitoring",
    "Microsoft 365 E3/E5 management",
    "MFA, conditional access, and SSO design",
    "Immutable backup with tested restores",
    "Compliance program management (HIPAA, SOC 2, CMMC)",
    "Named vCIO with monthly strategy meetings",
    "Unlimited on-site dispatch (New York only)",
    "Dedicated account team",
  ],
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function bufferDoc(doc: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function addPageNumbers(doc: any) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.height - 32;
    doc.save();
    doc.fontSize(7.5).fillColor("#999999").font("Helvetica");
    doc.text(
      `${COMPANY_NAME}  •  Confidential  •  ${CONTRACT_VERSION}`,
      doc.page.margins.left,
      bottom,
      { lineBreak: false }
    );
    doc.text(
      `Page ${i + 1} of ${total}`,
      doc.page.margins.left,
      bottom,
      {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "right",
        lineBreak: false,
      }
    );
    doc.restore();
  }
}

// ─── BUSINESS CONTRACT ───────────────────────────────────────────────────────

function buildBusinessContract(doc: any, params: ContractParams) {
  const {
    customerName,
    customerEmail,
    companyName,
    planName,
    planSlug,
    billingCycle,
    pricePerUser,
    seats,
    subscriptionId,
    effectiveDate,
  } = params;

  const totalRecurring = pricePerUser * seats;
  const billingLabel = billingCycle === "annual" ? "annual" : "monthly";
  const intervalLabel = billingCycle === "annual" ? "year" : "month";
  const initialTermMonths = params.initialTermMonths ?? 12;
  const commitmentEndsAt =
    params.commitmentEndsAt ??
    new Date(new Date(effectiveDate).setMonth(effectiveDate.getMonth() + initialTermMonths));
  const initialTermLabel =
    initialTermMonths === 12
      ? "12-month initial term"
      : initialTermMonths === 1
        ? "1-month initial term"
        : `${initialTermMonths}-month initial term`;
  const features = PLAN_FEATURES[planSlug.toLowerCase()] || PLAN_FEATURES["essentials"];
  const refId = `MSA-${subscriptionId.replace("sub_", "").replace("pending_", "").slice(0, 12).toUpperCase()}`;

  const BLUE = "#032d60";
  const LIGHT_BLUE = "#0176d3";
  const GRAY = "#333333";
  const LIGHT_GRAY = "#666666";
  const LINE_GRAY = "#d1d5db";
  const BG_STRIPE = "#f8fafc";
  const pageWidth = doc.page.width - 120;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 18;
  const ensureSpace = (needed: number) => {
    if (doc.y + needed > bottomLimit()) doc.addPage();
  };

  // ── Header banner ─────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 88).fill(BLUE);
  doc
    .fillColor("#ffffff").fontSize(21).font("Helvetica-Bold")
    .text("SIEBERT SERVICES", 60, 22, { lineBreak: false });
  doc
    .fillColor("#93c5fd").fontSize(9).font("Helvetica")
    .text("MANAGED SERVICES AGREEMENT — BUSINESS", 60, 48);
  doc
    .fillColor("#ffffff").fontSize(8.5).font("Helvetica")
    .text(`${COMPANY_WEBSITE}  |  ${COMPANY_PHONE}`, doc.page.width - 250, 48, {
      width: 190, align: "right",
    });

  // Accent bar
  doc.rect(0, 88, doc.page.width, 4).fill(LIGHT_BLUE);
  doc.moveDown(3.2);

  // ── Document title ─────────────────────────────────────────────────────────
  doc
    .fillColor(BLUE).fontSize(15).font("Helvetica-Bold")
    .text("Managed Services Agreement", 60, doc.y, { align: "center" });
  doc.moveDown(0.35);
  doc
    .fillColor(LIGHT_GRAY).fontSize(8.5).font("Helvetica")
    .text(
      `Agreement Reference: ${refId}  |  Effective: ${formatDate(effectiveDate)}  |  ${CONTRACT_VERSION}`,
      60, doc.y, { align: "center" }
    );
  doc.moveDown(1);
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.75).stroke();
  doc.moveDown(0.9);

  // ── Parties ────────────────────────────────────────────────────────────────
  doc.fillColor(BLUE).fontSize(10.5).font("Helvetica-Bold").text("PARTIES TO THIS AGREEMENT");
  doc.moveDown(0.45);

  const colW = pageWidth / 2 - 12;
  const leftX = 60;
  const rightX = 60 + colW + 24;
  const partyY = doc.y;
  const partyH = 90;

  // Provider box
  doc.rect(leftX, partyY, colW, partyH).fillAndStroke("#eef4fc", LINE_GRAY);
  doc.rect(leftX, partyY, 4, partyH).fill(BLUE);
  doc.fillColor(BLUE).fontSize(7.5).font("Helvetica-Bold")
    .text("SERVICE PROVIDER", leftX + 12, partyY + 10);
  doc.fillColor(GRAY).fontSize(9).font("Helvetica-Bold")
    .text(COMPANY_NAME, leftX + 12, partyY + 24);
  doc.fillColor(LIGHT_GRAY).fontSize(8).font("Helvetica")
    .text(`${COMPANY_ADDRESS}\n${COMPANY_EMAIL}\n${COMPANY_PHONE}`, leftX + 12, partyY + 38);

  // Client box
  doc.rect(rightX, partyY, colW, partyH).fillAndStroke("#f0fdf4", LINE_GRAY);
  doc.rect(rightX, partyY, 4, partyH).fill("#16a34a");
  doc.fillColor("#14532d").fontSize(7.5).font("Helvetica-Bold")
    .text("CLIENT (BUSINESS ENTITY)", rightX + 12, partyY + 10);
  doc.fillColor(GRAY).fontSize(9).font("Helvetica-Bold")
    .text(companyName || customerName, rightX + 12, partyY + 24);
  doc.fillColor(LIGHT_GRAY).fontSize(8).font("Helvetica")
    .text(`Authorized Representative: ${customerName}\n${customerEmail}`, rightX + 12, partyY + 38);

  doc.y = partyY + partyH + 14;
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.75).stroke();
  doc.moveDown(0.9);

  // ── Plan & Billing Summary ─────────────────────────────────────────────────
  doc.fillColor(BLUE).fontSize(10.5).font("Helvetica-Bold").text("SERVICE PLAN & BILLING SUMMARY");
  doc.moveDown(0.45);

  const tableY = doc.y;
  const rows = [
    ["Service Plan", `${planName} Plan`],
    ["Billing Cycle", `${billingLabel.charAt(0).toUpperCase()}${billingLabel.slice(1)} — billed per ${intervalLabel}`],
    ["Rate per User Seat", `${formatCurrency(pricePerUser)} / ${intervalLabel}`],
    ["Number of Seats", `${seats} user seat${seats !== 1 ? "s" : ""}`],
    ["Total Recurring Charge", `${formatCurrency(totalRecurring)} / ${intervalLabel}`],
    ["Effective Date", formatDate(effectiveDate)],
    ["Initial Term", `${initialTermLabel} — ends ${formatDate(commitmentEndsAt)}`],
    ["After Initial Term", "Continues month-to-month until canceled with 30 days' written notice"],
    ["Agreement Reference", refId],
  ];

  rows.forEach(([label, value], i) => {
    const rowY = tableY + i * 21;
    if (i % 2 === 0) doc.rect(60, rowY, pageWidth, 21).fill(BG_STRIPE);
    doc.fillColor(GRAY).fontSize(8.5).font("Helvetica-Bold")
      .text(label, 68, rowY + 6.5, { width: 170, lineBreak: false });
    doc.fillColor(GRAY).fontSize(8.5).font("Helvetica")
      .text(value, 248, rowY + 6.5, { width: pageWidth - 193 });
  });

  doc.y = tableY + rows.length * 21 + 12;
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.75).stroke();
  doc.moveDown(0.9);

  // ── Services Included ──────────────────────────────────────────────────────
  ensureSpace(80);
  doc.fillColor(BLUE).fontSize(10.5).font("Helvetica-Bold").text("SERVICES INCLUDED");
  doc.moveDown(0.45);
  doc.fillColor(GRAY).fontSize(8.5).font("Helvetica")
    .text(`The following managed IT services are included under the ${planName} Plan:`, 60, doc.y);
  doc.moveDown(0.4);

  features.forEach((feature) => {
    ensureSpace(16);
    doc.fillColor(LIGHT_BLUE).fontSize(8.5).text("▸", 68, doc.y, { width: 12, lineBreak: false });
    doc.fillColor(GRAY).fontSize(8.5).font("Helvetica")
      .text(feature, 84, doc.y - 8.5, { width: pageWidth - 30 });
    doc.moveDown(0.2);
  });

  doc.moveDown(0.7);
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.75).stroke();
  doc.moveDown(0.9);

  // ── Terms and Conditions ────────────────────────────────────────────────────
  ensureSpace(60);
  doc.fillColor(BLUE).fontSize(10.5).font("Helvetica-Bold").text("TERMS AND CONDITIONS");
  doc.moveDown(0.45);

  const terms: Array<{ title: string; body: string }> = [
    {
      title: "1. Payment Terms",
      body: `Client agrees to pay ${formatCurrency(totalRecurring)} per ${intervalLabel} for ${seats} user seat${seats !== 1 ? "s" : ""} under the ${planName} Plan. Payment is due at the commencement of each billing period and is processed automatically via the credit card or ACH method on file through Stripe, Inc. All fees are non-refundable except as expressly required by applicable law. Siebert Services reserves the right to suspend or terminate services upon non-payment following a ten (10) day written cure notice. A late fee of 1.5% per month (or the maximum permitted by law, whichever is less) may be applied to overdue balances.`,
    },
    {
      title: "2. Service Term, Initial Commitment, and Renewal",
      body: `This Agreement commences on ${formatDate(effectiveDate)} and is composed of two phases: (a) an initial fixed term of ${initialTermMonths} consecutive months ("Initial Term"), ending on ${formatDate(commitmentEndsAt)}; and (b) an open-ended month-to-month renewal phase that begins automatically at the end of the Initial Term ("Renewal Phase"). Services will continue to be billed on the ${billingLabel} cadence selected above throughout both phases. Client agrees to pay the full ${initialTermMonths}-month Initial Term and may not cancel for convenience prior to ${formatDate(commitmentEndsAt)} except as expressly permitted under Section 9 (Termination for Cause). After the Initial Term, Client may cancel for convenience at any time by providing at least thirty (30) calendar days' written notice to ${COMPANY_EMAIL}; services and billing will continue through the end of the then-current paid period and stop on the next renewal date. If Client requests early termination during the Initial Term outside of Section 9, Client remains responsible for the remaining contract balance through ${formatDate(commitmentEndsAt)} (an "early-termination liability") unless Siebert Services agrees in writing to waive or reduce that amount.`,
    },
    {
      title: "3. Service Level Commitment",
      body: "Siebert Services will use commercially reasonable efforts to maintain service availability consistent with the selected plan tier. Response time targets for supported plan levels are set forth in the applicable plan documentation available at the Service Provider's website. Siebert Services shall not be liable for service interruptions caused by: (a) force majeure or acts of God; (b) Client-controlled infrastructure failures; (c) third-party platform outages, including Microsoft 365, cloud hosting providers, or internet service providers; or (d) Client's failure to maintain minimum system requirements.",
    },
    {
      title: "4. Client Responsibilities",
      body: "Client shall: (a) provide timely, reasonable access to systems, devices, and network infrastructure required to deliver services; (b) maintain valid, licensed software for all applications managed under this Agreement; (c) designate a primary point of contact authorized to make decisions regarding IT services; (d) promptly notify Siebert Services of any suspected security incidents, unauthorized access, or data breaches; and (e) ensure that all users within Client's organization comply with reasonable security policies communicated by Siebert Services.",
    },
    {
      title: "5. Confidentiality",
      body: "Each party agrees to hold the other's Confidential Information in strict confidence and not to disclose it to any third party without the prior written consent of the disclosing party. 'Confidential Information' means any non-public information disclosed by one party to the other that is designated as confidential or that reasonably should be understood to be confidential. Confidential Information excludes information that: (a) is or becomes publicly known through no breach of this Agreement; (b) was rightfully known before disclosure; or (c) is independently developed without use of the Confidential Information. This obligation survives termination for three (3) years.",
    },
    {
      title: "6. Data Privacy and Security",
      body: "Siebert Services will handle any personal data accessed in the course of providing services in accordance with all applicable privacy laws, including the New York SHIELD Act and any applicable requirements of the California Consumer Privacy Act (CCPA) where relevant. Client retains full ownership of all Client data. Siebert Services will not sell, rent, or share Client data with third parties except as strictly necessary to deliver the contracted services or as required by law. In the event of a data breach involving Client data, Siebert Services will notify Client within 72 hours of becoming aware of the breach.",
    },
    {
      title: "7. Intellectual Property",
      body: "Each party retains ownership of its pre-existing intellectual property. Any custom tools, scripts, or configurations created by Siebert Services specifically for Client under this Agreement shall be licensed to Client on a non-exclusive, royalty-free basis during the term of this Agreement. Upon termination, Siebert Services may retain copies for its internal records but will not use Client-specific configurations for other clients without written consent.",
    },
    {
      title: "8. Limitation of Liability",
      body: "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, SIEBERT SERVICES' TOTAL CUMULATIVE LIABILITY ARISING OUT OF OR RELATED TO THIS AGREEMENT SHALL NOT EXCEED THE TOTAL FEES PAID BY CLIENT TO SIEBERT SERVICES IN THE THREE (3) CALENDAR MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM. IN NO EVENT SHALL EITHER PARTY BE LIABLE TO THE OTHER FOR INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, CONSEQUENTIAL, OR PUNITIVE DAMAGES — INCLUDING LOST PROFITS, LOST DATA, OR BUSINESS INTERRUPTION — EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS OF LIABILITY; IN SUCH JURISDICTIONS, LIABILITY SHALL BE LIMITED TO THE FULLEST EXTENT PERMITTED BY LAW.",
    },
    {
      title: "9. Termination for Cause",
      body: "Either party may terminate this Agreement immediately upon written notice if the other party: (a) materially breaches this Agreement and fails to cure such breach within fifteen (15) days of receiving written notice describing the breach in reasonable detail; or (b) becomes insolvent, makes a general assignment for the benefit of creditors, or becomes subject to bankruptcy or similar proceedings. Siebert Services may terminate immediately without cure period if Client engages in fraudulent activity, illegal use of services, or non-payment beyond thirty (30) days of the due date.",
    },
    {
      title: "10. Dispute Resolution and Governing Law",
      body: "This Agreement shall be governed by and construed in accordance with the laws of the State of New York, without regard to its conflict-of-law principles. In the event of any dispute, controversy, or claim arising out of or relating to this Agreement, the parties agree to first attempt resolution through good-faith negotiation for thirty (30) days. If negotiation fails, disputes shall be resolved by binding arbitration administered by the American Arbitration Association (AAA) under its Commercial Arbitration Rules, with proceedings conducted in New York County, New York. The arbitrator's decision shall be final and may be entered as a judgment in any court of competent jurisdiction. Each party shall bear its own attorneys' fees, unless the arbitrator determines that a party's claim or defense was frivolous.",
    },
    {
      title: "11. Entire Agreement and Modification",
      body: "This Agreement, together with any applicable order forms, statements of work, or service schedules incorporated herein by reference, constitutes the entire agreement between the parties with respect to its subject matter and supersedes all prior and contemporaneous agreements, representations, and understandings, whether written or oral. This Agreement may only be amended by a written instrument signed by authorized representatives of both parties. No waiver of any provision of this Agreement shall be effective unless in writing and signed by the waiving party.",
    },
    {
      title: "12. Severability and Force Majeure",
      body: "If any provision of this Agreement is found invalid or unenforceable by a court of competent jurisdiction, the remaining provisions shall continue in full force and effect, and the invalid provision shall be modified to the minimum extent necessary to make it valid. Neither party shall be liable for failure or delay in performance to the extent caused by circumstances beyond its reasonable control, including natural disasters, war, terrorism, government actions, epidemics, or widespread internet outages, provided that the affected party gives prompt written notice and uses commercially reasonable efforts to resume performance.",
    },
  ];

  terms.forEach(({ title, body }) => {
    const bodyHeight = doc.heightOfString(body, { width: pageWidth, align: "justify" });
    ensureSpace(bodyHeight + 32);
    doc.fillColor(BLUE).fontSize(8.5).font("Helvetica-Bold").text(title, 60, doc.y);
    doc.moveDown(0.2);
    doc.fillColor(GRAY).fontSize(8).font("Helvetica")
      .text(body, 60, doc.y, { width: pageWidth, align: "justify" });
    doc.moveDown(0.65);
  });

  // ── Acceptance ────────────────────────────────────────────────────────────
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.75).stroke();
  doc.moveDown(0.8);
  ensureSpace(130);

  doc.fillColor(BLUE).fontSize(10.5).font("Helvetica-Bold").text("ACCEPTANCE AND ELECTRONIC SIGNATURE");
  doc.moveDown(0.45);

  doc.fillColor(GRAY).fontSize(8.5).font("Helvetica").text(
    `By completing payment for the ${planName} Plan subscription on ${formatDate(effectiveDate)}, the authorized representative of ${companyName || customerName} acknowledges that they have read, understood, and agree to be bound by all terms of this Managed Services Agreement on behalf of the Client entity. Electronic acceptance via payment constitutes a legally binding signature under the Electronic Signatures in Global and National Commerce Act (E-SIGN Act, 15 U.S.C. § 7001 et seq.) and the New York Electronic Signatures and Records Act (NY ESRA).`,
    60, doc.y, { width: pageWidth, align: "justify" }
  );

  doc.moveDown(1.5);
  ensureSpace(90);

  const sigY = doc.y;
  const sigColW = pageWidth / 2 - 20;

  doc.moveTo(60, sigY + 38).lineTo(60 + sigColW, sigY + 38).strokeColor(GRAY).lineWidth(0.4).stroke();
  doc.fillColor(GRAY).fontSize(8).font("Helvetica-Bold")
    .text("SIEBERT SERVICES LLC — Authorized Representative", 60, sigY + 42);
  doc.fillColor(LIGHT_GRAY).fontSize(7.5).font("Helvetica")
    .text(`Electronically executed on ${formatDate(effectiveDate)}`, 60, sigY + 54);

  const sigRightX = 60 + sigColW + 40;
  doc.moveTo(sigRightX, sigY + 38).lineTo(sigRightX + sigColW, sigY + 38).strokeColor(GRAY).lineWidth(0.4).stroke();
  doc.fillColor(GRAY).fontSize(8).font("Helvetica-Bold")
    .text(`CLIENT — ${companyName || customerName}`, sigRightX, sigY + 42);
  doc.fillColor(LIGHT_GRAY).fontSize(7.5).font("Helvetica")
    .text(`Accepted by: ${customerName} (${customerEmail})`, sigRightX, sigY + 54);

  doc.y = sigY + 72;
  doc.moveDown(1.2);

  // ── Footer rule ───────────────────────────────────────────────────────────
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.4).stroke();
  doc.moveDown(0.4);
  doc.fillColor(LIGHT_GRAY).fontSize(7).font("Helvetica").text(
    `${COMPANY_NAME}  •  ${COMPANY_ADDRESS}  •  ${COMPANY_PHONE}  •  ${COMPANY_EMAIL}  •  Subscription: ${subscriptionId}`,
    60, doc.y, { width: pageWidth, align: "center" }
  );
}

// ─── CONSUMER CONTRACT ───────────────────────────────────────────────────────

function buildConsumerContract(doc: any, params: ContractParams) {
  const {
    customerName,
    customerEmail,
    planName,
    planSlug,
    billingCycle,
    pricePerUser,
    seats,
    subscriptionId,
    effectiveDate,
  } = params;

  const totalRecurring = pricePerUser * seats;
  const billingLabel = billingCycle === "annual" ? "annual" : "monthly";
  const intervalLabel = billingCycle === "annual" ? "year" : "month";
  const initialTermMonths = params.initialTermMonths ?? 12;
  const commitmentEndsAt =
    params.commitmentEndsAt ??
    new Date(new Date(effectiveDate).setMonth(effectiveDate.getMonth() + initialTermMonths));
  const initialTermLabel =
    initialTermMonths === 12
      ? "12-month initial term"
      : initialTermMonths === 1
        ? "1-month initial term"
        : `${initialTermMonths}-month initial term`;
  const features = PLAN_FEATURES[planSlug.toLowerCase()] || PLAN_FEATURES["essentials"];
  const refId = `MSA-${subscriptionId.replace("sub_", "").replace("pending_", "").slice(0, 12).toUpperCase()}`;

  const BLUE = "#032d60";
  const TEAL = "#0d9488";
  const GRAY = "#333333";
  const LIGHT_GRAY = "#666666";
  const LINE_GRAY = "#d1d5db";
  const BG_STRIPE = "#f8fafc";
  const pageWidth = doc.page.width - 120;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 18;
  const ensureSpace = (needed: number) => {
    if (doc.y + needed > bottomLimit()) doc.addPage();
  };

  // ── Header banner ─────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 88).fill(BLUE);
  doc
    .fillColor("#ffffff").fontSize(21).font("Helvetica-Bold")
    .text("SIEBERT SERVICES", 60, 22, { lineBreak: false });
  doc
    .fillColor("#6ee7b7").fontSize(9).font("Helvetica")
    .text("MANAGED SERVICES AGREEMENT — INDIVIDUAL / CONSUMER", 60, 48);
  doc
    .fillColor("#ffffff").fontSize(8.5).font("Helvetica")
    .text(`${COMPANY_WEBSITE}  |  ${COMPANY_PHONE}`, doc.page.width - 250, 48, {
      width: 190, align: "right",
    });

  doc.rect(0, 88, doc.page.width, 4).fill(TEAL);
  doc.moveDown(3.2);

  // ── Document title ─────────────────────────────────────────────────────────
  doc
    .fillColor(BLUE).fontSize(15).font("Helvetica-Bold")
    .text("Managed Services Agreement — Individual", 60, doc.y, { align: "center" });
  doc.moveDown(0.35);
  doc
    .fillColor(LIGHT_GRAY).fontSize(8.5).font("Helvetica")
    .text(
      `Agreement Reference: ${refId}  |  Effective: ${formatDate(effectiveDate)}  |  ${CONTRACT_VERSION}`,
      60, doc.y, { align: "center" }
    );
  doc.moveDown(1);
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.75).stroke();
  doc.moveDown(0.9);

  // ── Plain-language intro ──────────────────────────────────────────────────
  doc.rect(60, doc.y, pageWidth, 42).fill("#f0fdfa");
  doc.fillColor(TEAL).fontSize(7.5).font("Helvetica-Bold")
    .text("PLAIN-LANGUAGE SUMMARY", 72, doc.y + 8);
  doc.fillColor("#134e4a").fontSize(7.5).font("Helvetica")
    .text(
      `This is an agreement between you, ${customerName}, and Siebert Services LLC for managed IT services. You are paying ${formatCurrency(totalRecurring)} every ${intervalLabel} for ${seats} device seat${seats !== 1 ? "s" : ""}. You can cancel with 30 days' written notice. This document contains your full legal rights.`,
      72, doc.y + 2, { width: pageWidth - 24 }
    );
  doc.y += 50;
  doc.moveDown(0.6);
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.75).stroke();
  doc.moveDown(0.9);

  // ── Parties ────────────────────────────────────────────────────────────────
  doc.fillColor(BLUE).fontSize(10.5).font("Helvetica-Bold").text("PARTIES TO THIS AGREEMENT");
  doc.moveDown(0.45);

  const colW = pageWidth / 2 - 12;
  const leftX = 60;
  const rightX = 60 + colW + 24;
  const partyY = doc.y;
  const partyH = 80;

  // Provider box
  doc.rect(leftX, partyY, colW, partyH).fillAndStroke("#eef4fc", LINE_GRAY);
  doc.rect(leftX, partyY, 4, partyH).fill(BLUE);
  doc.fillColor(BLUE).fontSize(7.5).font("Helvetica-Bold")
    .text("SERVICE PROVIDER", leftX + 12, partyY + 10);
  doc.fillColor(GRAY).fontSize(9).font("Helvetica-Bold")
    .text(COMPANY_NAME, leftX + 12, partyY + 24);
  doc.fillColor(LIGHT_GRAY).fontSize(8).font("Helvetica")
    .text(`${COMPANY_ADDRESS}\n${COMPANY_EMAIL}\n${COMPANY_PHONE}`, leftX + 12, partyY + 38);

  // Individual client box
  doc.rect(rightX, partyY, colW, partyH).fillAndStroke("#f0fdfa", LINE_GRAY);
  doc.rect(rightX, partyY, 4, partyH).fill(TEAL);
  doc.fillColor("#134e4a").fontSize(7.5).font("Helvetica-Bold")
    .text("INDIVIDUAL CLIENT", rightX + 12, partyY + 10);
  doc.fillColor(GRAY).fontSize(9).font("Helvetica-Bold")
    .text(customerName, rightX + 12, partyY + 24);
  doc.fillColor(LIGHT_GRAY).fontSize(8).font("Helvetica")
    .text(customerEmail, rightX + 12, partyY + 38);

  doc.y = partyY + partyH + 14;
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.75).stroke();
  doc.moveDown(0.9);

  // ── Plan & Billing Summary ─────────────────────────────────────────────────
  doc.fillColor(BLUE).fontSize(10.5).font("Helvetica-Bold").text("SERVICE PLAN & BILLING SUMMARY");
  doc.moveDown(0.45);

  const tableY = doc.y;
  const rows = [
    ["Service Plan", `${planName} Plan`],
    ["Billing Cycle", `${billingLabel.charAt(0).toUpperCase()}${billingLabel.slice(1)} — billed per ${intervalLabel}`],
    ["Rate per Device Seat", `${formatCurrency(pricePerUser)} / ${intervalLabel}`],
    ["Number of Seats", `${seats} device seat${seats !== 1 ? "s" : ""}`],
    ["Total Recurring Charge", `${formatCurrency(totalRecurring)} / ${intervalLabel}`],
    ["Effective Date", formatDate(effectiveDate)],
    ["Initial Term", `${initialTermLabel} — ends ${formatDate(commitmentEndsAt)}`],
    ["After Initial Term", "Continues month-to-month until you cancel with 30 days' notice"],
    ["Agreement Reference", refId],
  ];

  rows.forEach(([label, value], i) => {
    const rowY = tableY + i * 21;
    if (i % 2 === 0) doc.rect(60, rowY, pageWidth, 21).fill(BG_STRIPE);
    doc.fillColor(GRAY).fontSize(8.5).font("Helvetica-Bold")
      .text(label, 68, rowY + 6.5, { width: 170, lineBreak: false });
    doc.fillColor(GRAY).fontSize(8.5).font("Helvetica")
      .text(value, 248, rowY + 6.5, { width: pageWidth - 193 });
  });

  doc.y = tableY + rows.length * 21 + 12;
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.75).stroke();
  doc.moveDown(0.9);

  // ── Services Included ──────────────────────────────────────────────────────
  ensureSpace(80);
  doc.fillColor(BLUE).fontSize(10.5).font("Helvetica-Bold").text("SERVICES INCLUDED");
  doc.moveDown(0.45);
  doc.fillColor(GRAY).fontSize(8.5).font("Helvetica")
    .text(`The following managed IT services are included under your ${planName} Plan:`, 60, doc.y);
  doc.moveDown(0.4);

  features.forEach((feature) => {
    ensureSpace(16);
    doc.fillColor(TEAL).fontSize(8.5).text("▸", 68, doc.y, { width: 12, lineBreak: false });
    doc.fillColor(GRAY).fontSize(8.5).font("Helvetica")
      .text(feature, 84, doc.y - 8.5, { width: pageWidth - 30 });
    doc.moveDown(0.2);
  });

  doc.moveDown(0.7);
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.75).stroke();
  doc.moveDown(0.9);

  // ── Terms ──────────────────────────────────────────────────────────────────
  ensureSpace(60);
  doc.fillColor(BLUE).fontSize(10.5).font("Helvetica-Bold").text("TERMS AND CONDITIONS");
  doc.moveDown(0.45);

  const terms: Array<{ title: string; body: string }> = [
    {
      title: "1. Payment Terms",
      body: `You agree to pay ${formatCurrency(totalRecurring)} per ${intervalLabel} for your ${planName} Plan covering ${seats} device seat${seats !== 1 ? "s" : ""}. Payments are automatically charged to the payment method you provided at the start of each billing period via Stripe, Inc. All fees paid are non-refundable once the billing period has commenced, except where required by applicable law. If a payment fails, you will receive written notice and have ten (10) days to update your payment information before services may be suspended.`,
    },
    {
      title: "2. Service Term, Initial Commitment, and Your Right to Cancel",
      body: `This Agreement starts on ${formatDate(effectiveDate)} and runs in two phases. Phase 1 — Initial Term: you commit to ${initialTermMonths} months of service, ending on ${formatDate(commitmentEndsAt)}. During the Initial Term you cannot cancel for convenience, but you keep all rights described in Section 7 (Cancellation and Refund Policy) and the right to cancel for cause if we materially fail to deliver services and do not fix the problem within fifteen (15) days after you tell us about it in writing. Phase 2 — Month-to-Month: starting the day after your Initial Term ends, your service automatically continues on a month-to-month basis at the same rate (subject to advance notice of any price change). You may cancel any time during the month-to-month phase by emailing ${COMPANY_EMAIL} at least thirty (30) calendar days before your next billing date. Service continues through the end of your current paid month and stops on the next billing date. If you ask to leave during the Initial Term outside Section 7, you will be responsible for the remaining months through ${formatDate(commitmentEndsAt)}, unless we agree in writing to waive that amount.`,
    },
    {
      title: "3. Service Level Commitment",
      body: "We will make commercially reasonable efforts to provide the services described in your plan on a consistent basis. Response times depend on your plan tier. We are not responsible for service disruptions caused by: (a) events outside our control (storms, power outages, internet provider failures); (b) issues originating on your own devices or home/office network; or (c) outages from third-party platforms such as Microsoft 365 or your cloud storage provider.",
    },
    {
      title: "4. Your Responsibilities",
      body: "To allow us to support you effectively, you agree to: (a) provide timely access to the devices, accounts, and network connections that we need to perform services; (b) keep all software on your supported devices properly licensed; (c) notify us promptly if you suspect any of your devices have been hacked, infected with malware, or accessed without your permission; and (d) have one designated person (which may be you) who can make decisions about your IT services.",
    },
    {
      title: "5. Your Privacy and Data Rights",
      body: "We handle your personal information in accordance with applicable law, including the New York SHIELD Act and, where applicable, the California Consumer Privacy Act (CCPA). You own all of your data. We will not sell or share your personal or business information with any third party except as strictly necessary to deliver your services or as required by law. If we ever become aware of a security incident that may have exposed your data, we will notify you within 72 hours.",
    },
    {
      title: "6. Limitation of Our Liability",
      body: `If something goes wrong as a result of our services, our total liability to you will not exceed the total fees you have paid to us in the three (3) months before the incident. We are not liable for lost profits, lost data, or indirect damages that result from using or being unable to use our services. This limitation applies to the fullest extent permitted by the law in your state.`,
    },
    {
      title: "7. Cancellation and Refund Policy",
      body: "You may cancel this Agreement at any time with 30 days' written notice to the email above. No partial-period refunds are provided once a billing period has started. If services have not yet commenced (e.g., setup has not begun and you cancel within three (3) business days of your effective date), you may request a full refund by contacting us at the email above.",
    },
    {
      title: "8. Governing Law",
      body: "This Agreement is governed by the laws of the State of New York. If a dispute arises and we cannot resolve it informally, it will be settled by binding arbitration in New York County under the rules of the American Arbitration Association. You retain the right to bring a claim in small claims court for disputes within that court's jurisdictional limits.",
    },
    {
      title: "9. Entire Agreement",
      body: "This document is the complete agreement between you and Siebert Services LLC for managed IT services. It replaces any prior discussions, quotes, or understandings. Changes to this Agreement must be in writing and agreed to by both parties.",
    },
  ];

  terms.forEach(({ title, body }) => {
    const bodyHeight = doc.heightOfString(body, { width: pageWidth, align: "justify" });
    ensureSpace(bodyHeight + 32);
    doc.fillColor(BLUE).fontSize(8.5).font("Helvetica-Bold").text(title, 60, doc.y);
    doc.moveDown(0.2);
    doc.fillColor(GRAY).fontSize(8).font("Helvetica")
      .text(body, 60, doc.y, { width: pageWidth, align: "justify" });
    doc.moveDown(0.65);
  });

  // ── Acceptance ────────────────────────────────────────────────────────────
  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.75).stroke();
  doc.moveDown(0.8);
  ensureSpace(130);

  doc.fillColor(BLUE).fontSize(10.5).font("Helvetica-Bold").text("YOUR ACCEPTANCE");
  doc.moveDown(0.45);

  doc.fillColor(GRAY).fontSize(8.5).font("Helvetica").text(
    `By completing payment for the ${planName} Plan on ${formatDate(effectiveDate)}, you, ${customerName}, confirm that you have read and understood this Agreement, including the ${initialTermMonths}-month Initial Term ending ${formatDate(commitmentEndsAt)} and the month-to-month renewal phase that follows, and agree to its terms. Your payment serves as your electronic signature under the Electronic Signatures in Global and National Commerce Act (E-SIGN Act, 15 U.S.C. § 7001 et seq.). You have the right to receive this Agreement in paper form — please contact us at ${COMPANY_EMAIL} to request a copy.`,
    60, doc.y, { width: pageWidth, align: "justify" }
  );

  doc.moveDown(1.5);
  ensureSpace(90);

  const sigY = doc.y;
  const sigColW = pageWidth / 2 - 20;

  doc.moveTo(60, sigY + 38).lineTo(60 + sigColW, sigY + 38).strokeColor(GRAY).lineWidth(0.4).stroke();
  doc.fillColor(GRAY).fontSize(8).font("Helvetica-Bold")
    .text("SIEBERT SERVICES LLC", 60, sigY + 42);
  doc.fillColor(LIGHT_GRAY).fontSize(7.5).font("Helvetica")
    .text(`Electronically executed on ${formatDate(effectiveDate)}`, 60, sigY + 54);

  const sigRightX = 60 + sigColW + 40;
  doc.moveTo(sigRightX, sigY + 38).lineTo(sigRightX + sigColW, sigY + 38).strokeColor(GRAY).lineWidth(0.4).stroke();
  doc.fillColor(GRAY).fontSize(8).font("Helvetica-Bold")
    .text(`INDIVIDUAL CLIENT — ${customerName}`, sigRightX, sigY + 42);
  doc.fillColor(LIGHT_GRAY).fontSize(7.5).font("Helvetica")
    .text(`${customerEmail}  |  ${formatDate(effectiveDate)}`, sigRightX, sigY + 54);

  doc.y = sigY + 72;
  doc.moveDown(1.2);

  doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor(LINE_GRAY).lineWidth(0.4).stroke();
  doc.moveDown(0.4);
  doc.fillColor(LIGHT_GRAY).fontSize(7).font("Helvetica").text(
    `${COMPANY_NAME}  •  ${COMPANY_ADDRESS}  •  ${COMPANY_PHONE}  •  ${COMPANY_EMAIL}  •  Subscription: ${subscriptionId}`,
    60, doc.y, { width: pageWidth, align: "center" }
  );
}

// ─── Public entry point ──────────────────────────────────────────────────────

export function generateMSAContract(params: ContractParams): Promise<Buffer> {
  const isConsumer = params.customerType === "consumer";

  const doc = new PDFDocument({
    margin: 60,
    size: "LETTER",
    bufferPages: true,
    info: {
      Title: `Managed Services Agreement — ${params.planName} Plan`,
      Author: COMPANY_NAME,
      Subject: "Managed Services Agreement",
      Keywords: "MSA, managed services, IT support, Siebert Services",
      Creator: `${COMPANY_NAME} — ${CONTRACT_VERSION}`,
    },
  });

  if (isConsumer) {
    buildConsumerContract(doc, params);
  } else {
    buildBusinessContract(doc, params);
  }

  addPageNumbers(doc);

  return bufferDoc(doc);
}
