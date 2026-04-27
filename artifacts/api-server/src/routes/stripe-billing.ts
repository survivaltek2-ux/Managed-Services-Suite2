import { Router, type IRouter, type Request, type Response } from "express";
import { db, invoicesTable, subscriptionsTable, partnersTable, usersTable, pricingTiersTable, partnerCommissionsTable, documentsTable } from "@workspace/db";
import { eq, desc, and, or } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { getStripe, isStripeConfigured, STRIPE_PUBLISHABLE_KEY, getSubscriptionPeriod } from "../lib/stripe.js";
import { sendContractEmail, sendSubscriptionPendingEmail, sendSubscriptionApprovedEmail, sendSubscriptionRejectedEmail } from "../lib/email.js";
import { generateMSAContract } from "../lib/contract.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import jwt from "jsonwebtoken";

const objStorage = new ObjectStorageService();

const router: IRouter = Router();

function getBaseUrl(req: Request): string {
  // PUBLIC_URL (or PUBLIC_BASE_URL) is the most authoritative — set it in
  // production to pin success/cancel redirects to the canonical hostname.
  const explicit = (process.env.PUBLIC_URL || process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;

  // On Replit deployments and the preview proxy, the X-Forwarded-* headers
  // point at the public hostname the user actually sees. Prefer those over
  // req.protocol/host (which can be the internal node socket).
  const host = req.get("x-forwarded-host") || req.get("host") || "";
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  if (host) return `${proto}://${host}`;

  // Last-resort fallbacks for local dev and Replit preview.
  if (process.env.REPLIT_DOMAINS) return `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}`;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 8080}`;
}

/** Log the resolved base URL once on the first checkout attempt so misconfig is visible. */
let baseUrlLogged = false;
function logResolvedBaseUrlOnce(req: Request): string {
  const base = getBaseUrl(req);
  if (!baseUrlLogged) {
    baseUrlLogged = true;
    console.log(`[Stripe Checkout] Resolved base URL = ${base} (PUBLIC_URL=${process.env.PUBLIC_URL ? "set" : "unset"})`);
  }
  return base;
}

/** Stripe error codes that mean a cached product/price ID is unusable and we should refresh. */
const STRIPE_STALE_RESOURCE_CODES = new Set<string>([
  "resource_missing",
  "product_not_active",
  "price_not_active",
  "invalid_request_error",
]);
function isStaleResourceError(err: any): boolean {
  if (!err) return false;
  const code = err?.code || err?.raw?.code;
  if (code && STRIPE_STALE_RESOURCE_CODES.has(code)) return true;
  // 404 from Stripe is always a stale-id situation.
  if (err?.statusCode === 404) return true;
  // Fallback: parameter messages naming our cached product/price IDs.
  const msg: string = String(err?.message || err?.raw?.message || "");
  return /(?:No such (?:product|price)|product:.*\bprod_|price:.*\bprice_)/i.test(msg);
}

/** Structured one-line log for every checkout attempt — easy to grep. */
function logCheckoutAttempt(fields: Record<string, unknown>): void {
  try {
    console.log(`[Stripe Checkout] ${JSON.stringify(fields)}`);
  } catch {
    console.log("[Stripe Checkout]", fields);
  }
}

function stripeNotConfiguredError(res: Response) {
  res.status(503).json({ error: "stripe_not_configured", message: "Stripe payment processing is not yet configured." });
}

router.get("/billing/config", (_req, res) => {
  res.json({ publishableKey: STRIPE_PUBLISHABLE_KEY, configured: isStripeConfigured() });
});

router.post("/invoices/:id/pay", requireAuth, async (req: any, res) => {
  if (!isStripeConfigured()) return stripeNotConfiguredError(res);
  try {
    const stripe = getStripe();
    const id = parseInt(req.params.id);
    const userId = req.userId;

    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!invoice) { res.status(404).json({ error: "not_found" }); return; }
    if (invoice.userId !== userId) { res.status(403).json({ error: "forbidden" }); return; }
    if (invoice.status === "paid") { res.status(400).json({ error: "already_paid" }); return; }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    let customerId = user?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user?.email, name: user?.name, metadata: { userId: String(userId) } });
      customerId = customer.id;
      await db.update(usersTable).set({ stripeCustomerId: customerId }).where(eq(usersTable.id, userId));
    }

    const base = getBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: invoice.title || `Invoice ${invoice.invoiceNumber}` },
          unit_amount: Math.round(parseFloat(invoice.total) * 100),
        },
        quantity: 1,
      }],
      metadata: { invoiceId: String(invoice.id), type: "invoice_payment" },
      success_url: `${base}/partners/billing?payment=success&invoice=${invoice.id}`,
      cancel_url: `${base}/partners/billing?payment=cancelled`,
    });

    await db.update(invoicesTable).set({ stripeCheckoutSessionId: session.id }).where(eq(invoicesTable.id, id));
    res.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    console.error("[Stripe] Invoice pay error:", err);
    res.status(500).json({ error: "stripe_error", message: err.message });
  }
});

router.get("/billing/subscription", requireAuth, async (req: any, res) => {
  try {
    const userId = req.userId;
    const subs = await db.select().from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.userId, userId)))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(1);
    res.json({ subscription: subs[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/admin/billing/subscriptions", requireAdmin, async (req: any, res) => {
  if (!isStripeConfigured()) return stripeNotConfiguredError(res);
  try {
    const stripe = getStripe();
    const { userId, partnerId, tierId, billingCycle = "monthly" } = req.body;

    let tier: any = null;
    if (tierId) {
      const [t] = await db.select().from(pricingTiersTable).where(eq(pricingTiersTable.id, parseInt(tierId)));
      tier = t;
    }
    if (!tier) { res.status(404).json({ error: "tier_not_found" }); return; }

    const annualPriceRaw = parseFloat(tier.annualPrice ?? "0");
    const effectiveAnnualPrice = annualPriceRaw > 0 ? tier.annualPrice : tier.startingPrice;
    const priceAmount = billingCycle === "annual"
      ? Math.round(parseFloat(effectiveAnnualPrice) * 100)
      : Math.round(parseFloat(tier.startingPrice) * 100);

    let email = "";
    let name = "";
    let existingCustomerId: string | null | undefined = null;

    if (userId) {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parseInt(userId)));
      if (!user) { res.status(404).json({ error: "user_not_found" }); return; }
      email = user.email; name = user.name; existingCustomerId = user.stripeCustomerId;
    } else if (partnerId) {
      const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, parseInt(partnerId)));
      if (!partner) { res.status(404).json({ error: "partner_not_found" }); return; }
      email = partner.email; name = partner.contactName; existingCustomerId = partner.stripeCustomerId;
    } else {
      res.status(400).json({ error: "must_provide_userId_or_partnerId" }); return;
    }

    let customerId = existingCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email, name, metadata: { userId: userId || "", partnerId: partnerId || "" } });
      customerId = customer.id;
      if (userId) await db.update(usersTable).set({ stripeCustomerId: customerId }).where(eq(usersTable.id, parseInt(userId)));
      if (partnerId) await db.update(partnersTable).set({ stripeCustomerId: customerId }).where(eq(partnersTable.id, parseInt(partnerId)));
    }

    const product = await stripe.products.create({ name: `${tier.name} Plan`, metadata: { tierId: String(tier.id), tierSlug: tier.slug } });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: priceAmount,
      currency: "usd",
      recurring: { interval: billingCycle === "annual" ? "year" : "month" },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      metadata: { tierId: String(tier.id), planSlug: tier.slug, userId: userId || "", partnerId: partnerId || "" },
    });

    const [saved] = await db.insert(subscriptionsTable).values({
      userId: userId ? parseInt(userId) : null,
      partnerId: partnerId ? parseInt(partnerId) : null,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId,
      stripePriceId: price.id,
      stripeProductId: product.id,
      planId: tier.slug,
      planName: tier.name,
      status: subscription.status as any,
      currentPeriodStart: getSubscriptionPeriod(subscription).currentPeriodStart,
      currentPeriodEnd: getSubscriptionPeriod(subscription).currentPeriodEnd,
      cancelAtPeriodEnd: (subscription as any).cancel_at_period_end ?? false,
      billingCycle,
      amount: String(priceAmount / 100),
    }).returning();

    // Generate and send MSA contract (non-blocking — errors don't fail the subscription creation)
    (async () => {
      try {
        const effectiveDate = getSubscriptionPeriod(subscription).currentPeriodStart ?? new Date();
        const seats = 1; // Admin-created subscriptions are per-entity, not seat-counted; default to 1
        const cycle = billingCycle as "monthly" | "annual";
        const companyName = name;

        const pdfBuffer = await generateMSAContract({
          customerName: name,
          customerEmail: email,
          companyName,
          planName: tier.name,
          planSlug: tier.slug,
          billingCycle: cycle,
          pricePerUser: priceAmount / 100,
          seats,
          subscriptionId: subscription.id,
          effectiveDate,
        });

        await sendContractEmail({
          customerName: name,
          customerEmail: email,
          companyName,
          planName: tier.name,
          billingCycle: cycle,
          pricePerUser: priceAmount / 100,
          seats,
          subscriptionId: subscription.id,
          effectiveDate,
          contractPdf: pdfBuffer,
        });

        const refId = subscription.id.replace("sub_", "").slice(0, 12).toUpperCase();
        const filename1 = `Siebert_Services_MSA_${refId}.pdf`;
        const storagePath1 = await objStorage.uploadBuffer(pdfBuffer, filename1, "application/pdf");
        await db.insert(documentsTable).values({
          name: `MSA — ${companyName} — ${tier.name} Plan`,
          description: `Managed Services Agreement created by admin. Plan: ${tier.name} (${billingCycle}), effective ${effectiveDate.toISOString().slice(0, 10)}.`,
          filename: filename1,
          mimeType: "application/pdf",
          size: pdfBuffer.length,
          content: null,
          storagePath: storagePath1,
          category: "contract" as any,
          partnerId: partnerId ? parseInt(partnerId) : null,
          uploadedBy: "admin",
          tags: JSON.stringify(["contract", "msa", "admin-created", tier.slug]),
          active: true,
        });

        console.log(`[Admin Billing] Contract generated and sent to ${email} for subscription ${subscription.id}`);
      } catch (contractErr) {
        console.error("[Admin Billing] Contract generation failed (non-fatal):", contractErr);
      }
    })();

    res.status(201).json({ subscription: saved, stripeSubscription: subscription });
  } catch (err: any) {
    console.error("[Stripe] Create subscription error:", err);
    res.status(500).json({ error: "stripe_error", message: err.message });
  }
});

router.put("/admin/billing/subscriptions/:id/cancel", requireAdmin, async (req: any, res) => {
  if (!isStripeConfigured()) return stripeNotConfiguredError(res);
  try {
    const stripe = getStripe();
    const id = parseInt(req.params.id);
    const { immediately = false } = req.body;

    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    if (!sub) { res.status(404).json({ error: "not_found" }); return; }

    if (immediately) {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      await db.update(subscriptionsTable).set({ status: "canceled", canceledAt: new Date(), updatedAt: new Date() }).where(eq(subscriptionsTable.id, id));
    } else {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
      await db.update(subscriptionsTable).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(subscriptionsTable.id, id));
    }

    const [updated] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    res.json({ subscription: updated });
  } catch (err: any) {
    console.error("[Stripe] Cancel subscription error:", err);
    res.status(500).json({ error: "stripe_error", message: err.message });
  }
});

// ─── Pending signups list ────────────────────────────────────────────────────

router.get("/admin/billing/pending-signups", requireAdmin, async (_req, res) => {
  try {
    const pending = await db.select().from(subscriptionsTable)
      .where(eq(subscriptionsTable.approvalStatus, "pending"))
      .orderBy(desc(subscriptionsTable.createdAt));
    res.json(pending);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

// ─── Approve a pending signup (capture pre-auth, send contract) ──────────────

router.post("/admin/billing/subscriptions/:id/approve", requireAdmin, async (req: any, res) => {
  if (!isStripeConfigured()) return stripeNotConfiguredError(res);
  try {
    const stripe = getStripe();
    const id = parseInt(req.params.id);

    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    if (!sub) { res.status(404).json({ error: "not_found" }); return; }
    if (sub.approvalStatus !== "pending") {
      res.status(400).json({ error: "not_pending", message: "Subscription is not in pending approval state." });
      return;
    }

    const paymentIntentId = sub.stripePaymentIntentId;
    if (!paymentIntentId) {
      res.status(400).json({ error: "no_payment_intent", message: "No pre-authorization payment intent found for this signup." });
      return;
    }

    // 1. Capture the pre-authorized payment — this charges the card for the first period.
    const captured = await stripe.paymentIntents.capture(paymentIntentId);
    const paymentMethodId = captured.payment_method as string | null;

    // 2. Create the recurring subscription starting from the next billing period.
    //    The first period is already covered by the captured one-time payment.
    const seats = sub.seats || 1;
    const cycle = (sub.billingCycle || "monthly") as "monthly" | "annual";
    const nextPeriodSecs = Math.floor(Date.now() / 1000) + (cycle === "annual" ? 365 : 30) * 24 * 60 * 60;

    let newStripeSubId = sub.stripeSubscriptionId; // keep placeholder if sub creation fails
    try {
      const priceId = sub.stripePriceId;
      if (priceId && paymentMethodId && sub.stripeCustomerId) {
        // Attach payment method to customer if not already attached.
        await stripe.paymentMethods.attach(paymentMethodId, { customer: sub.stripeCustomerId }).catch(() => { /* already attached */ });

        const newSub = await stripe.subscriptions.create({
          customer: sub.stripeCustomerId,
          items: [{ price: priceId, quantity: seats }],
          default_payment_method: paymentMethodId,
          // trial_end = start of next period so customer isn't double-charged.
          trial_end: nextPeriodSecs,
          metadata: { planSlug: sub.planId, billingCycle: cycle, seats: String(seats), type: "approved_checkout" },
        });
        newStripeSubId = newSub.id;
        console.log(`[Billing] Created subscription ${newSub.id} for approved signup ${sub.stripePaymentIntentId}`);
      } else {
        console.warn(`[Billing] Missing priceId, paymentMethod, or customerId — subscription not created. PI: ${paymentIntentId}`);
      }
    } catch (subErr) {
      console.error("[Billing] Subscription creation failed (non-fatal — first period was captured):", subErr);
    }

    // 3. Mark approved in the database.
    await db.update(subscriptionsTable)
      .set({
        stripeSubscriptionId: newStripeSubId,
        approvalStatus: "approved",
        status: "trialing" as any, // trialing until next period billing kicks in
        currentPeriodEnd: new Date(nextPeriodSecs * 1000),
        updatedAt: new Date(),
      })
      .where(eq(subscriptionsTable.id, id));

    // Send the MSA contract + welcome email now that they're approved.
    try {
      const customerEmail = sub.customerEmail || "";
      const customerName = sub.customerName || "Valued Customer";
      if (customerEmail) {
        let tierRecord: any = null;
        const tiers = await db.select().from(pricingTiersTable);
        tierRecord = tiers.find((t: any) => t.slug === sub.planId) || tiers[0];

        const pricePerUser = parseFloat(tierRecord?.startingPrice || sub.amount || "89");
        const effectiveDate = sub.currentPeriodStart || new Date();

        const pdfBuffer = await generateMSAContract({
          customerName,
          customerEmail,
          companyName: customerName,
          planName: sub.planName || "Managed Services",
          planSlug: sub.planId || "essentials",
          billingCycle: cycle,
          pricePerUser,
          seats,
          subscriptionId: sub.stripeSubscriptionId,
          effectiveDate,
          customerType: (sub.customerType === "consumer" ? "consumer" : "business") as "business" | "consumer",
        });

        await sendContractEmail({
          customerName,
          customerEmail,
          companyName: customerName,
          planName: sub.planName || "Managed Services",
          billingCycle: cycle,
          pricePerUser,
          seats,
          subscriptionId: sub.stripeSubscriptionId,
          effectiveDate,
          contractPdf: pdfBuffer,
        });

        // Store the contract in App Storage + admin documents for records.
        const refId = sub.stripeSubscriptionId.replace("sub_", "").slice(0, 12).toUpperCase();
        const filename2 = `Siebert_Services_MSA_${refId}.pdf`;
        const storagePath2 = await objStorage.uploadBuffer(pdfBuffer, filename2, "application/pdf");
        await db.insert(documentsTable).values({
          name: `MSA — ${customerName} — ${sub.planName} Plan`,
          description: `MSA generated on admin approval. Plan: ${sub.planName} (${cycle}), ${seats} seats.`,
          filename: filename2,
          mimeType: "application/pdf",
          size: pdfBuffer.length,
          content: null,
          storagePath: storagePath2,
          category: "contract" as any,
          uploadedBy: "system",
          tags: JSON.stringify(["contract", "msa", "auto-generated", sub.planId]),
          active: true,
        });

        await sendSubscriptionApprovedEmail({ customerName, customerEmail, planName: sub.planName || "Managed Services", billingCycle: cycle, seats, amount: parseFloat(sub.amount || "0") });
        console.log(`[Billing] Subscription ${sub.stripeSubscriptionId} approved — contract sent to ${customerEmail}`);
      }
    } catch (emailErr) {
      console.error("[Billing] Approval email/contract failed (non-fatal):", emailErr);
    }

    const [updated] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    res.json({ subscription: updated, message: "Subscription approved and customer notified." });
  } catch (err: any) {
    console.error("[Stripe] Approve subscription error:", err);
    res.status(500).json({ error: "stripe_error", message: err.message });
  }
});

// ─── Reject a pending signup (cancel pre-auth + subscription) ────────────────

router.post("/admin/billing/subscriptions/:id/reject", requireAdmin, async (req: any, res) => {
  if (!isStripeConfigured()) return stripeNotConfiguredError(res);
  try {
    const stripe = getStripe();
    const id = parseInt(req.params.id);
    const { reason = "" } = req.body;

    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    if (!sub) { res.status(404).json({ error: "not_found" }); return; }
    if (sub.approvalStatus !== "pending") {
      res.status(400).json({ error: "not_pending", message: "Subscription is not in pending approval state." });
      return;
    }

    // Cancel the pre-authorization payment intent — releases the card hold with no charge.
    if (sub.stripePaymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(sub.stripePaymentIntentId);
        if (pi.status === "requires_capture") {
          await stripe.paymentIntents.cancel(sub.stripePaymentIntentId);
        }
      } catch (piErr) {
        console.error("[Billing] PI cancellation failed (non-fatal):", piErr);
      }
    }

    await db.update(subscriptionsTable)
      .set({ approvalStatus: "rejected", status: "canceled" as any, canceledAt: new Date(), updatedAt: new Date() })
      .where(eq(subscriptionsTable.id, id));

    // Notify the customer.
    try {
      const customerEmail = sub.customerEmail || "";
      const customerName = sub.customerName || "Valued Customer";
      if (customerEmail) {
        await sendSubscriptionRejectedEmail({ customerName, customerEmail, planName: sub.planName || "Managed Services", reason });
        console.log(`[Billing] Subscription ${sub.stripeSubscriptionId} rejected — customer notified at ${customerEmail}`);
      }
    } catch (emailErr) {
      console.error("[Billing] Rejection email failed (non-fatal):", emailErr);
    }

    const [updated] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    res.json({ subscription: updated, message: "Subscription rejected and pre-authorization released." });
  } catch (err: any) {
    console.error("[Stripe] Reject subscription error:", err);
    res.status(500).json({ error: "stripe_error", message: err.message });
  }
});

const MANAGE_TOKEN_PURPOSE = "consumer_manage";
const MANAGE_TOKEN_MAX_SESSION_AGE_SECS = 30 * 24 * 60 * 60; // 30 days

function getManageJwtSecret(): string | null {
  const s = process.env.JWT_SECRET;
  return s && s.length >= 20 ? s : null;
}

function manageSecretRequiredError(res: Response): void {
  res.status(503).json({ error: "not_configured", message: "Self-service billing management is not available. Please contact support." });
}

function issueManageToken(secret: string, stripeCustomerId: string): string {
  return jwt.sign({ stripeCustomerId, purpose: MANAGE_TOKEN_PURPOSE }, secret, { expiresIn: "24h" });
}

function verifyManageToken(secret: string, token: string): { stripeCustomerId: string } | null {
  try {
    const payload = jwt.verify(token, secret) as any;
    if (payload?.purpose !== MANAGE_TOKEN_PURPOSE || !payload?.stripeCustomerId) return null;
    return { stripeCustomerId: payload.stripeCustomerId };
  } catch {
    return null;
  }
}

router.get("/billing/manage-token", async (req: Request, res: Response) => {
  if (!isStripeConfigured()) return stripeNotConfiguredError(res);
  const secret = getManageJwtSecret();
  if (!secret) return manageSecretRequiredError(res);
  try {
    const stripe = getStripe();
    const { session_id } = req.query as { session_id?: string };
    if (!session_id || typeof session_id !== "string" || !session_id.startsWith("cs_")) {
      res.status(400).json({ error: "invalid_request", message: "A valid checkout session ID is required." });
      return;
    }
    let session: any;
    try { session = await stripe.checkout.sessions.retrieve(session_id); } catch {
      res.status(404).json({ error: "session_not_found", message: "Session not found or has expired." });
      return;
    }
    if (session.mode !== "subscription" || session.metadata?.type !== "auto_checkout") {
      res.status(403).json({ error: "forbidden", message: "This session is not eligible for consumer self-management." });
      return;
    }
    if (session.payment_status !== "paid" && session.status !== "complete") {
      res.status(403).json({ error: "forbidden", message: "Payment has not completed for this session." });
      return;
    }
    const nowSecs = Math.floor(Date.now() / 1000);
    if (session.created && nowSecs - session.created > MANAGE_TOKEN_MAX_SESSION_AGE_SECS) {
      res.status(403).json({ error: "session_too_old", message: "This checkout link has expired. Please contact support to manage your subscription." });
      return;
    }
    const customerId = typeof session.customer === "string" ? session.customer : (session.customer as any)?.id;
    if (!customerId) { res.status(404).json({ error: "no_customer", message: "No billing account found for this session." }); return; }
    res.json({ token: issueManageToken(secret, customerId) });
  } catch (err: any) {
    console.error("[Stripe] manage-token error:", err);
    res.status(500).json({ error: "server_error", message: "Unable to generate management token. Please try again." });
  }
});

router.get("/billing/subscription-info", async (req: Request, res: Response) => {
  const secret = getManageJwtSecret();
  if (!secret) return manageSecretRequiredError(res);
  try {
    const { token } = req.query as { token?: string };
    if (!token) { res.status(400).json({ error: "token_required" }); return; }
    const payload = verifyManageToken(secret, token);
    if (!payload) { res.status(401).json({ error: "invalid_token", message: "This link has expired or is invalid. Please return to your welcome page." }); return; }
    const subs = await db.select().from(subscriptionsTable)
      .where(and(
        eq(subscriptionsTable.stripeCustomerId, payload.stripeCustomerId),
        or(
          eq(subscriptionsTable.status, "active"),
          eq(subscriptionsTable.status, "trialing"),
          eq(subscriptionsTable.status, "past_due"),
        )
      ))
      .orderBy(desc(subscriptionsTable.currentPeriodEnd));
    const sub = subs[0];
    if (!sub) { res.status(404).json({ error: "not_found", message: "No active subscription found for this account." }); return; }
    const [tier] = await db.select().from(pricingTiersTable).where(eq(pricingTiersTable.slug, sub.planId));
    let features: string[] = [];
    try { features = JSON.parse(tier?.features || "[]"); } catch { features = []; }
    res.json({
      planName: sub.planName,
      planSlug: sub.planId,
      status: sub.status,
      billingCycle: sub.billingCycle,
      amount: sub.amount,
      seats: sub.seats,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      customerName: sub.customerName,
      customerEmail: sub.customerEmail,
      features,
      autoActivated: sub.autoActivated,
    });
  } catch (err: any) {
    console.error("[Stripe] subscription-info error:", err);
    res.status(500).json({ error: "server_error", message: "Unable to load subscription details. Please try again." });
  }
});

router.get("/billing/portal", async (req: Request, res: Response) => {
  if (!isStripeConfigured()) return stripeNotConfiguredError(res);
  try {
    const stripe = getStripe();
    const { session_id, token } = req.query as { session_id?: string; token?: string };
    const base = getBaseUrl(req);
    let customerId: string | null = null;

    if (token) {
      const secret = getManageJwtSecret();
      if (!secret) return manageSecretRequiredError(res);
      const payload = verifyManageToken(secret, token);
      if (!payload) {
        res.status(401).json({ error: "invalid_token", message: "This link has expired or is invalid. Please return to the welcome page." });
        return;
      }
      customerId = payload.stripeCustomerId;
    } else {
      if (!session_id || typeof session_id !== "string" || !session_id.startsWith("cs_")) {
        res.status(400).json({ error: "invalid_request", message: "A valid checkout session ID is required." });
        return;
      }
      let session: any;
      try {
        session = await stripe.checkout.sessions.retrieve(session_id);
      } catch {
        res.status(404).json({ error: "session_not_found", message: "Session not found or has expired." });
        return;
      }
      if (session.mode !== "subscription" || session.metadata?.type !== "auto_checkout") {
        res.status(403).json({ error: "forbidden", message: "Billing portal access is not available for this session." });
        return;
      }
      if (session.payment_status !== "paid" && session.status !== "complete") {
        res.status(403).json({ error: "forbidden", message: "Payment has not completed for this session." });
        return;
      }
      customerId = typeof session.customer === "string" ? session.customer : (session.customer as any)?.id ?? null;
      if (!customerId) {
        res.status(404).json({ error: "no_customer", message: "No billing account found for this session." });
        return;
      }
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId!,
      return_url: token
        ? `${base}/manage/subscription?token=${encodeURIComponent(token)}`
        : `${base}/welcome?managed=1`,
    });
    res.json({ url: portalSession.url });
  } catch (err: any) {
    console.error("[Stripe] Consumer billing portal error:", err);
    res.status(500).json({ error: "server_error", message: "Unable to open the billing portal. Please try again." });
  }
});

router.get("/admin/billing/subscriptions/:id/portal", requireAdmin, async (req: Request, res: Response) => {
  if (!isStripeConfigured()) return stripeNotConfiguredError(res);
  try {
    const stripe = getStripe();
    const id = parseInt(req.params.id);
    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
    if (!sub) { res.status(404).json({ error: "not_found" }); return; }
    if (!sub.stripeCustomerId) { res.status(400).json({ error: "no_customer", message: "This subscription has no Stripe customer ID." }); return; }
    const base = getBaseUrl(req);
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${base}/partners/billing`,
    });
    res.json({ url: portalSession.url });
  } catch (err: any) {
    console.error("[Stripe] Admin billing portal error:", err);
    res.status(500).json({ error: "server_error", message: "Unable to open the billing portal. Please try again." });
  }
});

router.get("/admin/billing/subscriptions", requireAdmin, async (_req, res) => {
  try {
    const subs = await db.select().from(subscriptionsTable).orderBy(desc(subscriptionsTable.createdAt));
    res.json(subs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/admin/billing/stats", requireAdmin, async (_req, res) => {
  try {
    const subs = await db.select().from(subscriptionsTable);
    const invoices = await db.select({
      id: invoicesTable.id,
      status: invoicesTable.status,
      total: invoicesTable.total,
      paidAt: invoicesTable.paidAt,
      createdAt: invoicesTable.createdAt,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
      invoiceNumber: invoicesTable.invoiceNumber,
      title: invoicesTable.title,
    }).from(invoicesTable)
      .leftJoin(usersTable, eq(invoicesTable.userId, usersTable.id))
      .orderBy(desc(invoicesTable.createdAt))
      .limit(20);

    const activeSubs = subs.filter(s => s.status === "active" || s.status === "trialing");
    const mrr = activeSubs.reduce((sum, s) => {
      const amt = parseFloat(s.amount || "0");
      return sum + (s.billingCycle === "annual" ? amt / 12 : amt);
    }, 0);

    const allInvoices = await db.select({ status: invoicesTable.status, total: invoicesTable.total }).from(invoicesTable);
    const outstanding = allInvoices.filter(i => i.status === "sent" || i.status === "viewed" || i.status === "overdue").reduce((s, i) => s + parseFloat(i.total || "0"), 0);
    const totalRevenue = allInvoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(i.total || "0"), 0);
    const overdueCount = allInvoices.filter(i => i.status === "overdue").length;

    res.json({ mrr, outstanding, totalRevenue, overdueCount, activeSubscriptions: activeSubs.length, recentInvoices: invoices, subscriptions: subs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/checkout/:tierId", async (req: Request, res: Response) => {
  // Capture context up-front so every exit path can log a structured outcome.
  const ctx: Record<string, unknown> = {
    tierId: req.params.tierId,
    billingCycle: req.body?.billingCycle,
    seatQuantity: req.body?.seatQuantity,
    customerType: req.body?.customerType,
  };

  if (!isStripeConfigured()) {
    logCheckoutAttempt({ ...ctx, outcome: "stripe_not_configured" });
    return stripeNotConfiguredError(res);
  }
  try {
    const stripe = getStripe();
    const tierId = req.params.tierId;
    const { billingCycle: rawBilling, email, seatQuantity = 1, customerType = "business" } = req.body || {};

    // Validate billing cycle. We accept only "monthly" or "annual" (or
    // undefined → defaults to "monthly"). Any other value is a sign the
    // client/page state is corrupt; reject with a stable error code so the
    // inline error UI surfaces it instead of silently charging at the
    // wrong cadence.
    let billingCycle: "monthly" | "annual";
    if (rawBilling === undefined || rawBilling === null || rawBilling === "monthly") {
      billingCycle = "monthly";
    } else if (rawBilling === "annual") {
      billingCycle = "annual";
    } else {
      ctx.billingCycle = rawBilling;
      logCheckoutAttempt({ ...ctx, outcome: "invalid_billing_cycle" });
      res.status(400).json({
        error: "invalid_billing_cycle",
        message: "Billing cycle must be either monthly or annual.",
      });
      return;
    }
    const safeCustomerType: "business" | "consumer" = customerType === "consumer" ? "consumer" : "business";
    ctx.billingCycle = billingCycle;
    ctx.customerType = safeCustomerType;

    // Reject obviously malformed seatQuantity instead of silently coercing.
    const parsedSeats = parseInt(String(seatQuantity), 10);
    if (Number.isNaN(parsedSeats) || parsedSeats < 1 || parsedSeats > 500) {
      logCheckoutAttempt({ ...ctx, outcome: "invalid_seat_quantity", parsedSeats });
      res.status(400).json({ error: "invalid_seat_quantity", message: "Seat quantity must be between 1 and 500." });
      return;
    }

    let tier: any = null;
    const tierIdStr = String(tierId);
    const isSlug = isNaN(parseInt(tierIdStr));
    if (isSlug) {
      const [t] = await db.select().from(pricingTiersTable).where(eq(pricingTiersTable.slug, tierIdStr));
      tier = t;
    } else {
      const [t] = await db.select().from(pricingTiersTable).where(eq(pricingTiersTable.id, parseInt(tierIdStr)));
      tier = t;
    }

    if (!tier) {
      logCheckoutAttempt({ ...ctx, outcome: "tier_not_found" });
      res.status(404).json({ error: "tier_not_found", message: "That plan is no longer available." });
      return;
    }
    ctx.tierSlug = tier.slug;
    if (tier.slug === "enterprise") {
      logCheckoutAttempt({ ...ctx, outcome: "contact_sales" });
      res.status(400).json({ error: "contact_sales", message: "Enterprise plans require a custom quote. Please contact us." });
      return;
    }

    // Seat minimum is derived from the *resolved tier* — not from the
    // client-supplied customerType — so a malicious or buggy client
    // can't request a Business plan with consumer-style seat=1 floor.
    // Consumer tier = 1 seat minimum; every other paid tier = 3 seats.
    const seatFloor = tier.slug === "consumer" ? 1 : 3;
    const seats = Math.max(seatFloor, Math.min(500, parsedSeats));
    ctx.seats = seats;

    // Validate price data BEFORE we hit Stripe so a misconfigured tier
    // surfaces as a clean admin-actionable error rather than a Stripe failure
    // (or, worse, a successful charge at the wrong amount).
    const startingPriceNum = parseFloat(tier.startingPrice ?? "0");
    const annualMonthlyNum = parseFloat(tier.annualPrice ?? "0");
    if (!(startingPriceNum > 0)) {
      logCheckoutAttempt({ ...ctx, outcome: "invalid_tier_price", startingPriceNum });
      res.status(409).json({ error: "invalid_tier_price", message: "This plan's price is not configured. Please contact support." });
      return;
    }
    if (billingCycle === "annual") {
      // annualPrice is the per-seat-per-month equivalent when billed annually.
      // It must be > 0 and ≤ the monthly startingPrice (otherwise the annual rate
      // would actually overcharge vs. monthly, which is clearly misconfigured).
      if (!(annualMonthlyNum > 0) || annualMonthlyNum > startingPriceNum) {
        logCheckoutAttempt({ ...ctx, outcome: "invalid_annual_price", startingPriceNum, annualMonthlyNum });
        res.status(409).json({
          error: "invalid_annual_price",
          message: "This plan's annual pricing is not configured correctly. Please contact support.",
        });
        return;
      }
    }

    const base = logResolvedBaseUrlOnce(req);

    const resolvePriceId = async (retrying = false): Promise<string> => {
      const freshTier = retrying
        ? (await db.select().from(pricingTiersTable).where(eq(pricingTiersTable.id, tier.id)))[0]
        : tier;

      const cachedPriceId: string | null = billingCycle === "annual"
        ? (freshTier.stripeAnnualPriceId || null)
        : (freshTier.stripeMonthlyPriceId || null);

      if (cachedPriceId) return cachedPriceId;

      const freshAnnualRaw = parseFloat(freshTier.annualPrice ?? "0");
      // annualPrice is the per-user per-month equivalent when billed annually (e.g. $76/mo).
      // For a yearly Stripe recurring price we need the annual total: $76 × 12 = $912/seat/year.
      const freshEffectiveAnnualMonthly = freshAnnualRaw > 0 ? freshAnnualRaw : parseFloat(freshTier.startingPrice);
      const priceAmount = billingCycle === "annual"
        ? Math.round(freshEffectiveAnnualMonthly * 12 * 100)   // annual total per seat
        : Math.round(parseFloat(freshTier.startingPrice) * 100); // monthly per seat

      let productId: string | null = freshTier.stripeProductId || null;
      if (!productId) {
        const product = await stripe.products.create({
          name: `${freshTier.name} Plan`,
          description: freshTier.tagline || undefined,
          metadata: { tierId: String(freshTier.id), planSlug: freshTier.slug },
        });
        productId = product.id;
        await db.update(pricingTiersTable).set({ stripeProductId: productId, updatedAt: new Date() }).where(eq(pricingTiersTable.id, freshTier.id));
      }

      const price = await stripe.prices.create({
        product: productId,
        currency: "usd",
        unit_amount: priceAmount,
        recurring: { interval: billingCycle === "annual" ? "year" : "month" },
        metadata: { tierId: String(freshTier.id), planSlug: freshTier.slug, billingCycle },
      });

      if (billingCycle === "annual") {
        await db.update(pricingTiersTable).set({ stripeAnnualPriceId: price.id, updatedAt: new Date() }).where(eq(pricingTiersTable.id, freshTier.id));
      } else {
        await db.update(pricingTiersTable).set({ stripeMonthlyPriceId: price.id, updatedAt: new Date() }).where(eq(pricingTiersTable.id, freshTier.id));
      }

      return price.id;
    };

    // Calculate total for first period (unit price × seats).
    // annualPrice is the per-user per-month equivalent, so multiply by 12 for the annual total.
    const annualMonthlyRate = parseFloat(tier.annualPrice ?? "0");
    const effectiveAnnualMonthlyRate = annualMonthlyRate > 0 ? annualMonthlyRate : parseFloat(tier.startingPrice);
    const unitAmountCents = billingCycle === "annual"
      ? Math.round(effectiveAnnualMonthlyRate * 12 * 100)      // $76/mo × 12 = $912/seat/year
      : Math.round(parseFloat(tier.startingPrice) * 100);       // $89/seat/month
    const totalAmountCents = unitAmountCents * seats;
    const periodLabel = billingCycle === "annual" ? "Year" : "Month";

    const createSession = async (priceId: string) => {
      // Auto-activate plans (e.g. Consumer) skip the approval workflow and create a real
      // Stripe subscription immediately in subscription mode.
      if (tier.autoActivate) {
        return stripe.checkout.sessions.create({
          mode: "subscription",
          ...(email ? { customer_email: email } : {}),
          line_items: [{ price: priceId, quantity: seats }],
          subscription_data: {
            metadata: { tierId: String(tier.id), planSlug: tier.slug, billingCycle, seats: String(seats), type: "auto_checkout", customerType: safeCustomerType },
          },
          metadata: { tierId: String(tier.id), planSlug: tier.slug, billingCycle, seats: String(seats), type: "auto_checkout", priceId, customerType: safeCustomerType },
          success_url: `${base}/welcome?plan=${encodeURIComponent(tier.slug)}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${base}/pricing`,
        });
      }

      // Standard plans use payment mode with a manual-capture pre-auth.
      // The admin captures on approval; cancels on rejection (no charge).
      // setup_future_usage saves the card so we can create the recurring subscription on approval.
      return stripe.checkout.sessions.create({
        mode: "payment",
        ...(email ? { customer_email: email } : {}),
        line_items: [{
          price_data: {
            currency: "usd",
            unit_amount: totalAmountCents,
            product_data: {
              name: `${tier.name} Plan — First ${periodLabel} (${seats} seat${seats !== 1 ? "s" : ""})`,
            },
          },
          quantity: 1,
        }],
        payment_intent_data: {
          capture_method: "manual",
          setup_future_usage: "off_session",
          // Store identifiers so the webhook and approval flow can create the subscription.
          metadata: { type: "self_checkout", tierId: String(tier.id), planSlug: tier.slug, billingCycle, seats: String(seats), priceId, customerType: safeCustomerType },
        },
        metadata: { tierId: String(tier.id), planSlug: tier.slug, billingCycle, seats: String(seats), type: "self_checkout", priceId, customerType: safeCustomerType },
        success_url: `${base}/welcome?plan=${encodeURIComponent(tier.slug)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/pricing`,
      });
    };

    try {
      const priceId = await resolvePriceId();
      const session = await createSession(priceId);
      logCheckoutAttempt({ ...ctx, outcome: "ok", sessionId: session.id });
      res.json({ url: session.url, sessionId: session.id });
    } catch (stripeErr: any) {
      if (isStaleResourceError(stripeErr)) {
        console.warn(
          `[Stripe Checkout] Cached IDs stale for tier=${tier.slug} (code=${stripeErr?.code || "n/a"}, status=${stripeErr?.statusCode || "n/a"}) — clearing and retrying.`,
        );
        await db.update(pricingTiersTable)
          .set({ stripeProductId: null, stripeMonthlyPriceId: null, stripeAnnualPriceId: null, updatedAt: new Date() })
          .where(eq(pricingTiersTable.id, tier.id));
        try {
          const freshPriceId = await resolvePriceId(true);
          const session = await createSession(freshPriceId);
          logCheckoutAttempt({ ...ctx, outcome: "ok_after_self_heal", sessionId: session.id });
          res.json({ url: session.url, sessionId: session.id });
        } catch (retryErr: any) {
          logCheckoutAttempt({ ...ctx, outcome: "stripe_error_after_retry", code: retryErr?.code, statusCode: retryErr?.statusCode });
          console.error("[Stripe Checkout] Retry after self-heal failed:", retryErr);
          res.status(502).json({ error: "stripe_error", message: retryErr?.message || "Stripe checkout failed." });
        }
      } else {
        throw stripeErr;
      }
    }
  } catch (err: any) {
    logCheckoutAttempt({ ...ctx, outcome: "stripe_error", code: err?.code, statusCode: err?.statusCode });
    console.error("[Stripe Checkout] Self-checkout error:", err);
    res.status(502).json({ error: "stripe_error", message: err?.message || "Stripe checkout failed." });
  }
});

router.post("/admin/commissions/:id/payout", requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const { method = "auto" } = req.body;

    const [commission] = await db.select({
      id: partnerCommissionsTable.id,
      amount: partnerCommissionsTable.amount,
      status: partnerCommissionsTable.status,
      partnerId: partnerCommissionsTable.partnerId,
      stripeTransferId: partnerCommissionsTable.stripeTransferId,
    }).from(partnerCommissionsTable).where(eq(partnerCommissionsTable.id, id));

    if (!commission) { res.status(404).json({ error: "not_found" }); return; }
    if (commission.status !== "approved") { res.status(400).json({ error: "not_approved", message: "Commission must be approved before payout." }); return; }

    const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, commission.partnerId));

    let stripeTransferId: string | null = null;
    let resolvedMethod = method;
    let warning: string | undefined;

    const canUseStripe = (method === "stripe" || method === "auto") && isStripeConfigured() && partner?.stripeConnectAccountId;

    if (method === "stripe" && !partner?.stripeConnectAccountId) {
      res.status(400).json({ error: "no_connect_account", message: "Partner does not have a Stripe Connect account. Use manual payout." });
      return;
    }

    if (canUseStripe) {
      const stripe = getStripe();
      const account = await stripe.accounts.retrieve(partner.stripeConnectAccountId!);
      if (!account.payouts_enabled) {
        if (method === "stripe") {
          res.status(400).json({ error: "payouts_not_enabled", message: "Partner's Stripe account is not fully verified. They must complete Stripe onboarding before receiving payouts." });
          return;
        }
        resolvedMethod = "manual";
        warning = "Stripe account not fully verified — payout recorded as manual";
        console.warn(`[Stripe Connect] Auto-fallback to manual for commission #${id}: partner #${commission.partnerId} payouts_enabled=false`);
      } else {
        const transfer = await stripe.transfers.create({
          amount: Math.round(parseFloat(commission.amount) * 100),
          currency: "usd",
          destination: partner.stripeConnectAccountId!,
          metadata: { commissionId: String(id), partnerId: String(commission.partnerId) },
        });
        stripeTransferId = transfer.id;
        resolvedMethod = "stripe";
        console.log(`[Stripe Connect] Transfer ${stripeTransferId} initiated for commission #${id}`);
      }
    } else {
      resolvedMethod = "manual";
    }

    await db.update(partnerCommissionsTable).set({
      status: "paid",
      paidAt: new Date(),
      stripeTransferId: stripeTransferId || null,
      payoutMethod: resolvedMethod,
    }).where(eq(partnerCommissionsTable.id, id));

    const [updated] = await db.select().from(partnerCommissionsTable).where(eq(partnerCommissionsTable.id, id));
    res.json({ commission: updated, stripeTransferId, method: resolvedMethod, ...(warning ? { warning } : {}) });
  } catch (err: any) {
    console.error("[Stripe] Commission payout error:", err);
    res.status(500).json({ error: "stripe_error", message: err.message });
  }
});

async function resolvePartnerJwt(req: any, res: Response): Promise<{ partnerId: number } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader) { res.status(401).json({ error: "unauthorized" }); return null; }
  const token = authHeader.replace("Bearer ", "");
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("[resolvePartnerJwt] JWT_SECRET is not set; refusing to verify token.");
    res.status(500).json({ error: "server_misconfiguration" });
    return null;
  }
  const jwt = await import("jsonwebtoken");
  let payload: any;
  try {
    payload = jwt.default.verify(token, secret);
  } catch {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  const partnerId = payload.partnerId || payload.userId;
  if (!partnerId) { res.status(401).json({ error: "unauthorized" }); return null; }
  return { partnerId };
}

router.get("/partner/billing/invoices", async (req: any, res) => {
  try {
    const auth = await resolvePartnerJwt(req, res);
    if (!auth) return;
    const { partnerId } = auth;

    const invoices = await db.select().from(invoicesTable)
      .where(eq(invoicesTable.partnerId, partnerId))
      .orderBy(desc(invoicesTable.createdAt));

    const subs = await db.select().from(subscriptionsTable)
      .where(eq(subscriptionsTable.partnerId, partnerId))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(1);

    res.json({ invoices: invoices.map(i => ({ ...i, items: JSON.parse(i.items || "[]") })), subscription: subs[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/partner/billing/invoices/history", async (req: any, res) => {
  if (!isStripeConfigured()) { res.json({ invoices: [] }); return; }
  try {
    const auth = await resolvePartnerJwt(req, res);
    if (!auth) return;
    const { partnerId } = auth;

    const [partner] = await db.select({ stripeCustomerId: partnersTable.stripeCustomerId })
      .from(partnersTable)
      .where(eq(partnersTable.id, partnerId));

    const stripeCustomerId = partner?.stripeCustomerId;
    if (!stripeCustomerId) { res.json({ invoices: [] }); return; }

    const stripe = getStripe();
    const allInvoices: any[] = await stripe.invoices.list({
      customer: stripeCustomerId,
      status: "paid",
      limit: 100,
    }).autoPagingToArray({ limit: 1000 });

    const history = allInvoices.map((inv: any) => ({
      id: inv.id,
      number: inv.number,
      description: inv.description || inv.lines?.data?.[0]?.description || "Invoice",
      amount: inv.amount_paid / 100,
      currency: inv.currency,
      date: new Date(inv.created * 1000).toISOString(),
      periodStart: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
      periodEnd: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
      hostedInvoiceUrl: inv.hosted_invoice_url || null,
      invoicePdf: inv.invoice_pdf || null,
    }));

    res.json({ invoices: history });
  } catch (err: any) {
    console.error("[Stripe] Invoice history error:", err);
    res.status(500).json({ error: "stripe_error", message: err.message });
  }
});

export default router;
