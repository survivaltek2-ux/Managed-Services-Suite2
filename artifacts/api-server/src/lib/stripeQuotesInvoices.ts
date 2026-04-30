/**
 * Stripe-rendered Quotes & Invoices.
 *
 * Bridges our app-managed `invoices` and `quote_proposals` rows to native
 * Stripe Invoice / Quote objects so admins can:
 *   - Send a polished, Stripe-hosted invoice email + payment page (collects
 *     payment automatically; status is reconciled by the webhook handler).
 *   - Send a Stripe-finalized quote PDF that mirrors acceptance / cancellation
 *     state via webhook.
 *
 * The original app-internal flows (DIY invoice + token-based proposal page)
 * are untouched — these are additive endpoints surfaced as separate UI
 * actions in the admin portal.
 */

import { db, invoicesTable, quoteProposalsTable, quoteLineItemsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripe } from "./stripe.js";

// ─── Stripe customer lookup/creation ─────────────────────────────────────────

/**
 * Find the existing Stripe customer for the given app user (preferred) or by
 * email, otherwise create one. When a `userId` is provided we also persist
 * the resulting customer id back onto the users row so subsequent calls reuse
 * it without an extra Stripe roundtrip.
 *
 * Falls back to a plain email-keyed lookup so quotes/invoices addressed to a
 * non-account contact (e.g. an inbound prospect) still get a single, stable
 * Stripe customer instead of one per send.
 */
export async function getOrCreateStripeCustomer(opts: {
  userId?: number | null;
  email: string;
  name?: string | null;
  phone?: string | null;
  company?: string | null;
}): Promise<string> {
  const stripe = getStripe();
  const email = opts.email.trim().toLowerCase();

  // 1. Cached customer on the user row (fast path).
  if (opts.userId) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, opts.userId)).limit(1);
    if (user?.stripeCustomerId) {
      // Verify the customer still exists in Stripe before returning it. A
      // mode mismatch (live key against a test customer id, or vice versa)
      // is the most common cause of stale ids — fall through to re-create.
      try {
        const c = await stripe.customers.retrieve(user.stripeCustomerId);
        if (c && !(c as any).deleted) return user.stripeCustomerId;
      } catch {
        /* stale id — recreate below */
      }
    }
  }

  // 2. Lookup by email.
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) {
    const id = existing.data[0]!.id;
    if (opts.userId) {
      await db.update(usersTable).set({ stripeCustomerId: id }).where(eq(usersTable.id, opts.userId));
    }
    return id;
  }

  // 3. Create new.
  const created = await stripe.customers.create({
    email,
    name: opts.name || undefined,
    phone: opts.phone || undefined,
    description: opts.company || undefined,
    metadata: opts.userId ? { app_user_id: String(opts.userId) } : undefined,
  });
  if (opts.userId) {
    await db.update(usersTable).set({ stripeCustomerId: created.id }).where(eq(usersTable.id, opts.userId));
  }
  return created.id;
}

// ─── Money helpers ───────────────────────────────────────────────────────────

function dollarsToCents(amount: string | number): number {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return 0;
  // Use Math.round to avoid 0.1+0.2-style float drift in totals.
  return Math.round(n * 100);
}

// ─── Invoice ────────────────────────────────────────────────────────────────

export interface SendStripeInvoiceResult {
  stripeInvoiceId: string;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  status: string;
}

/**
 * Create + finalize + send a Stripe Invoice for the given app invoice.
 *
 * Requires the app invoice to be linked to a user with an email address —
 * Stripe needs a customer to bill, and `collection_method: "send_invoice"`
 * triggers the Stripe-hosted email + payment page automatically.
 */
export async function sendAppInvoiceViaStripe(appInvoiceId: number): Promise<SendStripeInvoiceResult> {
  const stripe = getStripe();

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, appInvoiceId)).limit(1);
  if (!invoice) throw new Error(`Invoice ${appInvoiceId} not found`);
  if (invoice.stripeInvoiceId) {
    throw new Error("This invoice has already been sent through Stripe.");
  }
  if (!invoice.userId) {
    throw new Error("Cannot send via Stripe — invoice has no associated client. Assign a client first.");
  }

  const [client] = await db.select().from(usersTable).where(eq(usersTable.id, invoice.userId)).limit(1);
  if (!client) throw new Error("Client account for this invoice was not found.");
  if (!client.email) throw new Error("Client has no email address on file.");

  const customerId = await getOrCreateStripeCustomer({
    userId: client.id,
    email: client.email,
    name: client.name,
    phone: client.phone,
    company: client.company,
  });

  // Days-until-due derived from the app invoice dueDate (Stripe requires a
  // positive integer for `send_invoice`; default to 30 if the date is in
  // the past or missing).
  let daysUntilDue = 30;
  if (invoice.dueDate) {
    const diff = Math.ceil((new Date(invoice.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff > 0) daysUntilDue = diff;
  }

  // Parse line items from the app invoice. Stripe requires individual
  // InvoiceItems on the customer *before* the invoice is created — they get
  // pulled in automatically when the invoice is created on that customer.
  let items: Array<{ description?: string; qty?: number; unitPrice?: number | string }> = [];
  try {
    items = JSON.parse(invoice.items || "[]");
  } catch {
    items = [];
  }
  if (items.length === 0) {
    throw new Error("Invoice has no line items to bill.");
  }

  // Create the draft invoice first so we can attach items to it directly via
  // the `invoice` parameter — this avoids a race where unrelated pending
  // invoice items on the customer get swept into the new invoice.
  const draftInvoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: daysUntilDue,
    description: invoice.title || undefined,
    footer: invoice.notes || undefined,
    auto_advance: false,
    metadata: {
      app_invoice_id: String(invoice.id),
      app_invoice_number: invoice.invoiceNumber,
    },
  });

  for (const item of items) {
    const qty = Math.max(1, Number(item.qty ?? 1));
    const unitCents = dollarsToCents(item.unitPrice ?? 0);
    if (unitCents <= 0) continue;
    const lineLabel = qty > 1
      ? `${item.description || invoice.title || "Service"} (${qty} × $${(unitCents / 100).toFixed(2)})`
      : (item.description || invoice.title || "Service");
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: draftInvoice.id,
      amount: unitCents * qty,
      currency: "usd",
      description: lineLabel,
    });
  }

  // Optional tax line: app invoice already stores a precomputed tax dollar
  // amount. Surface it as its own line item so the Stripe-rendered total
  // matches the app's saved total exactly.
  const taxCents = dollarsToCents(invoice.tax || "0");
  if (taxCents > 0) {
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: draftInvoice.id,
      amount: taxCents,
      currency: "usd",
      description: "Tax",
    });
  }

  const finalized = await stripe.invoices.finalizeInvoice(draftInvoice.id!);
  // sendInvoice triggers Stripe to email the customer with the hosted page.
  const sent = await stripe.invoices.sendInvoice(finalized.id!);

  await db.update(invoicesTable).set({
    stripeInvoiceId: sent.id,
    hostedInvoiceUrl: sent.hosted_invoice_url ?? null,
    invoicePdfUrl: sent.invoice_pdf ?? null,
    status: "sent",
    stripeSentAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(invoicesTable.id, invoice.id));

  return {
    stripeInvoiceId: sent.id!,
    hostedInvoiceUrl: sent.hosted_invoice_url ?? null,
    invoicePdfUrl: sent.invoice_pdf ?? null,
    status: sent.status || "open",
  };
}

// ─── Quote ──────────────────────────────────────────────────────────────────

export interface SendStripeQuoteResult {
  stripeQuoteId: string;
  status: string;
  pdfDownloadUrl: string;
}

/**
 * Create + finalize a Stripe Quote for the given proposal.
 *
 * Stripe Quotes don't ship a hosted public-acceptance page (unlike invoices),
 * so we expose the PDF via our public `/api/proposals/:token/stripe-quote.pdf`
 * route which streams it from Stripe using the proposal token as auth. The
 * existing proposal email + public proposal page continues to handle the
 * accept/reject flow; the Stripe quote object is the authoritative PDF and
 * tracks acceptance via webhook.
 */
export async function sendAppProposalViaStripeQuote(proposalId: number): Promise<SendStripeQuoteResult> {
  const stripe = getStripe();

  const [proposal] = await db.select().from(quoteProposalsTable).where(eq(quoteProposalsTable.id, proposalId)).limit(1);
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
  if (proposal.stripeQuoteId) {
    throw new Error("This proposal has already been finalized as a Stripe quote.");
  }
  if (!proposal.clientEmail) throw new Error("Proposal has no client email.");
  if (!proposal.proposalToken) throw new Error("Proposal is missing a secure token.");

  const lineItems = await db.select().from(quoteLineItemsTable)
    .where(eq(quoteLineItemsTable.proposalId, proposalId))
    .orderBy(quoteLineItemsTable.sortOrder);
  if (lineItems.length === 0) {
    throw new Error("Proposal has no line items.");
  }

  // Try to link to an existing user account by email so the Stripe customer
  // gets shared with the invoice flow later. Falls back to anonymous lookup.
  const [maybeUser] = await db.select().from(usersTable).where(eq(usersTable.email, proposal.clientEmail.toLowerCase())).limit(1);
  const customerId = await getOrCreateStripeCustomer({
    userId: maybeUser?.id ?? null,
    email: proposal.clientEmail,
    name: proposal.clientName,
    phone: proposal.clientPhone,
    company: proposal.clientCompany,
  });

  // Build inline line items. Stripe v22 QuoteCreateParams.LineItem.PriceData
  // requires `product` (an existing Product id) — `product_data` is not
  // supported here, so we materialize a Stripe Product per line item.
  const pricedLines = lineItems.filter(li => Number(li.unitPrice) > 0);
  if (pricedLines.length === 0) {
    throw new Error("Proposal has no priced line items.");
  }
  const stripeLineItems: Stripe.QuoteCreateParams.LineItem[] = [];
  for (const li of pricedLines) {
    const product = await stripe.products.create({
      name: li.name || proposal.title || "Service",
      description: li.description || undefined,
      metadata: {
        app_proposal_id: String(proposal.id),
        app_line_item_id: String(li.id),
      },
    });
    stripeLineItems.push({
      quantity: li.quantity || 1,
      price_data: {
        currency: "usd",
        unit_amount: dollarsToCents(li.unitPrice),
        product: product.id,
      },
    });
  }

  // Discount: Stripe quotes accept a one-off coupon. The proposal stores
  // `discount` as the already-computed *dollar* amount (even for percent-
  // type discounts — see routes/quotes.ts), so we always emit an amount_off
  // coupon for an exact match with the app's saved totals.
  let discounts: Stripe.QuoteCreateParams.Discount[] | undefined;
  const discountAmount = parseFloat(proposal.discount || "0");
  if (discountAmount > 0) {
    const coupon = await stripe.coupons.create({
      amount_off: dollarsToCents(discountAmount),
      currency: "usd",
      duration: "once",
      name: `Proposal ${proposal.proposalNumber} discount`,
    });
    discounts = [{ coupon: coupon.id }];
  }

  // Tax: surface as a one-off Stripe TaxRate so the percentage shows on the
  // quote totals row. Back-calculate the percentage from the app's stored
  // tax dollar amount over the post-discount subtotal.
  let defaultTaxRates: string[] | undefined;
  const taxAmount = parseFloat(proposal.tax || "0");
  if (taxAmount > 0) {
    const subtotal = parseFloat(proposal.subtotal || "0");
    const taxableBase = Math.max(subtotal - discountAmount, 0);
    const pct = taxableBase > 0 ? (taxAmount / taxableBase) * 100 : 0;
    if (pct > 0) {
      const rate = await stripe.taxRates.create({
        display_name: "Tax",
        percentage: Number(pct.toFixed(4)),
        inclusive: false,
      });
      defaultTaxRates = [rate.id];
    }
  }

  const draftQuote = await stripe.quotes.create({
    customer: customerId,
    line_items: stripeLineItems,
    discounts,
    default_tax_rates: defaultTaxRates,
    description: proposal.summary || proposal.title,
    footer: proposal.terms || undefined,
    header: proposal.title,
    expires_at: proposal.validUntil
      ? Math.floor(new Date(proposal.validUntil).getTime() / 1000)
      : undefined,
    metadata: {
      app_proposal_id: String(proposal.id),
      app_proposal_number: proposal.proposalNumber,
      app_proposal_token: proposal.proposalToken,
    },
  });

  const finalized = await stripe.quotes.finalizeQuote(draftQuote.id!);

  await db.update(quoteProposalsTable).set({
    stripeQuoteId: finalized.id,
    stripeQuoteStatus: finalized.status || "open",
    stripeQuotePdfUrl: `/api/proposals/${proposal.proposalToken}/stripe-quote.pdf`,
    stripeSentAt: new Date(),
    status: "sent",
    sentAt: proposal.sentAt ?? new Date(),
    updatedAt: new Date(),
  }).where(eq(quoteProposalsTable.id, proposal.id));

  return {
    stripeQuoteId: finalized.id!,
    status: finalized.status || "open",
    pdfDownloadUrl: `/api/proposals/${proposal.proposalToken}/stripe-quote.pdf`,
  };
}

/**
 * Stream a finalized Stripe quote's PDF. The Stripe SDK exposes this as a
 * NodeJS Readable on `quotes.pdf(id)`; callers pipe it to an Express
 * response.
 */
export async function streamStripeQuotePdf(stripeQuoteId: string): Promise<NodeJS.ReadableStream> {
  const stripe = getStripe();
  const pdf = await stripe.quotes.pdf(stripeQuoteId);
  return pdf as unknown as NodeJS.ReadableStream;
}
