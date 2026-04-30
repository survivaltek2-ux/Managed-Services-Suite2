import { Router, type IRouter, type Request, type Response } from "express";
import { db, invoicesTable, subscriptionsTable, partnerCommissionsTable, documentsTable, pricingTiersTable, partnersTable, quoteProposalsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { STRIPE_WEBHOOK_SECRET, isStripeConfigured, getStripe, getSubscriptionPeriod } from "../lib/stripe.js";
import { sendPaymentReceiptEmail, sendContractEmail, sendSubscriptionApprovedEmail } from "../lib/email.js";
import { generateMSAContract } from "../lib/contract.js";

const router: IRouter = Router();

const processedReceiptEventIds = new Set<string>();
const RECEIPT_EVENT_MAX = 1000;

function markReceiptEventProcessed(eventId: string): boolean {
  if (processedReceiptEventIds.has(eventId)) return false;
  if (processedReceiptEventIds.size >= RECEIPT_EVENT_MAX) {
    const first = processedReceiptEventIds.values().next().value;
    if (first) processedReceiptEventIds.delete(first);
  }
  processedReceiptEventIds.add(eventId);
  return true;
}

router.post("/webhooks/stripe", async (req: Request, res: Response) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "stripe_not_configured" });
    return;
  }

  const stripe = getStripe();
  const sig = req.headers["stripe-signature"] as string;

  if (!STRIPE_WEBHOOK_SECRET) {
    console.warn("[Stripe Webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature verification");
    res.status(400).json({ error: "webhook_secret_not_configured" });
    return;
  }

  if (!req.rawBody) {
    res.status(400).json({ error: "missing_raw_body" });
    return;
  }

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    res.status(400).json({ error: "invalid_signature", message: err.message });
    return;
  }

  console.log(`[Stripe Webhook] Received: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const { invoiceId, type } = session.metadata || {};

        if (type === "invoice_payment" && invoiceId) {
          await db.update(invoicesTable).set({
            status: "paid",
            paidAt: new Date(),
            stripePaymentIntentId: session.payment_intent || null,
            stripeCheckoutSessionId: session.id,
            updatedAt: new Date(),
          }).where(eq(invoicesTable.id, parseInt(invoiceId)));
          console.log(`[Stripe Webhook] Invoice #${invoiceId} marked paid`);
        }

        if (type === "auto_checkout") {
          // Auto-activate plans (e.g. Consumer) use subscription mode — Stripe creates
          // the subscription immediately. No admin approval needed.
          const stripeSubId: string = session.subscription || "";
          const { tierId, planSlug, billingCycle, seats: seatsStr } = session.metadata || {};
          const customerEmail: string = session.customer_details?.email || session.customer_email || "";
          const customerName: string = session.customer_details?.name || "Valued Customer";
          const seats: number = parseInt(seatsStr || "1", 10) || 1;
          const stripeCustomerId: string = session.customer || "";

          let tierRecord: any = null;
          if (tierId) {
            const [t] = await db.select().from(pricingTiersTable).where(eq(pricingTiersTable.id, parseInt(tierId)));
            tierRecord = t;
          }
          if (!tierRecord && planSlug) {
            const rows = await db.select().from(pricingTiersTable);
            tierRecord = rows.find((r: any) => r.slug === planSlug) || null;
          }
          const resolvedPlanName: string = tierRecord?.name || (planSlug ? planSlug.charAt(0).toUpperCase() + planSlug.slice(1) : "Consumer");

          // Retrieve the live Stripe subscription to get period dates and amount.
          let subAmount = 0;
          let currentPeriodStart: Date | null = null;
          let currentPeriodEnd: Date | null = null;
          let stripePriceId = "";
          try {
            const stripe = getStripe();
            const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);
            subAmount = (stripeSub.items.data[0]?.price?.unit_amount || 0) / 100;
            const period = getSubscriptionPeriod(stripeSub);
            currentPeriodStart = period.currentPeriodStart;
            currentPeriodEnd = period.currentPeriodEnd;
            stripePriceId = stripeSub.items.data[0]?.price?.id || "";
          } catch (subErr) {
            console.error("[Stripe Webhook] auto_checkout: failed to retrieve subscription:", subErr);
          }

          const existing = await db.select().from(subscriptionsTable)
            .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId));

          if (existing.length === 0 && stripeSubId) {
            await db.insert(subscriptionsTable).values({
              stripeSubscriptionId: stripeSubId,
              stripeCustomerId,
              stripePriceId,
              planId: planSlug || "consumer",
              planName: resolvedPlanName,
              status: "active" as any,
              billingCycle: billingCycle || "monthly",
              amount: String(subAmount / seats),
              approvalStatus: "approved",
              customerEmail,
              customerName,
              seats,
              autoActivated: true,
              customerType: "consumer",
              currentPeriodStart,
              currentPeriodEnd,
            });
            console.log(`[Stripe Webhook] Auto-activated Consumer subscription ${stripeSubId} for ${customerEmail}`);
          }

          // Send confirmation email immediately — no admin approval needed.
          try {
            if (customerEmail) {
              await sendSubscriptionApprovedEmail({
                customerName,
                customerEmail,
                planName: resolvedPlanName,
                billingCycle: (billingCycle || "monthly") as "monthly" | "annual",
                seats,
                amount: subAmount / Math.max(seats, 1),
              });
            }
          } catch (emailErr) {
            console.error("[Stripe Webhook] auto_checkout confirmation email failed (non-fatal):", emailErr);
          }

          break;
        }

        if (type === "self_checkout") {
          // Checkout is in `payment` mode — session.payment_intent holds the pre-auth PI.
          // There is no subscription yet; it is created on admin approval.
          const paymentIntentId: string = session.payment_intent || "";
          const { tierId, planSlug, billingCycle, seats: seatsStr, priceId, customerType: rawCustomerType } = session.metadata || {};
          const customerType: "business" | "consumer" = rawCustomerType === "consumer" ? "consumer" : "business";

          const customerEmail: string = session.customer_details?.email || session.customer_email || "";
          const customerName: string = session.customer_details?.name || "Valued Customer";
          const seats: number = parseInt(seatsStr || "3", 10) || 3;
          const stripeCustomerId: string = session.customer || "";

          if (!paymentIntentId) {
            console.warn("[Stripe Webhook] self_checkout session missing payment_intent:", session.id);
            break;
          }

          let tierRecord: any = null;
          if (tierId) {
            const [t] = await db.select().from(pricingTiersTable).where(eq(pricingTiersTable.id, parseInt(tierId)));
            tierRecord = t;
          }
          if (!tierRecord && planSlug) {
            const rows = await db.select().from(pricingTiersTable);
            tierRecord = rows.find((r: any) => r.slug === planSlug) || null;
          }
          const resolvedPlanName: string = tierRecord?.name || (planSlug ? planSlug.charAt(0).toUpperCase() + planSlug.slice(1) : "Managed Services");

          // Use a stable placeholder for stripeSubscriptionId until admin approves
          // and a real Stripe subscription is created.
          const placeholderSubId = `pending_${session.id}`;

          // Retrieve the PI to get the amount actually authorized.
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
          const authorizedAmount = (pi.amount || 0) / 100; // dollars

          const existing = await db.select().from(subscriptionsTable)
            .where(eq(subscriptionsTable.stripePaymentIntentId, paymentIntentId));

          if (existing.length === 0) {
            await db.insert(subscriptionsTable).values({
              // Placeholder — replaced with real subscription ID on admin approval.
              stripeSubscriptionId: placeholderSubId,
              stripeCustomerId,
              // Store the recurring price ID so the approval flow can create the subscription.
              stripePriceId: priceId || "",
              planId: planSlug || "unknown",
              planName: resolvedPlanName,
              status: "incomplete" as any,
              billingCycle: billingCycle || "monthly",
              amount: String(authorizedAmount / seats), // per-seat amount
              // Approval flow fields.
              approvalStatus: "pending",
              stripePaymentIntentId: paymentIntentId,
              customerEmail,
              customerName,
              seats,
              customerType,
            });
          }

          // Notify the customer that their signup is under review.
          // MSA contract is NOT sent here — it is sent on admin approval.
          try {
            if (customerEmail) {
              const { sendSubscriptionPendingEmail } = await import("../lib/email.js");
              await sendSubscriptionPendingEmail({
                customerName,
                customerEmail,
                planName: resolvedPlanName,
                billingCycle: (billingCycle || "monthly") as "monthly" | "annual",
                seats,
              });
            }
          } catch (emailErr) {
            console.error("[Stripe Webhook] Pending review email failed (non-fatal):", emailErr);
          }

          console.log(`[Stripe Webhook] Self-checkout complete for ${customerEmail} — pre-auth PI: ${paymentIntentId} (amount: $${authorizedAmount}). PENDING admin approval.`);
        }
        break;
      }

      case "invoice.paid": {
        const stripeInvoice = event.data.object as any;
        // Match strategy 1: payment_intent (used by the Checkout-based pay flow).
        if (stripeInvoice.payment_intent) {
          const rows = await db.select().from(invoicesTable).where(eq(invoicesTable.stripePaymentIntentId, stripeInvoice.payment_intent));
          if (rows.length > 0) {
            await db.update(invoicesTable).set({
              status: "paid",
              paidAt: new Date(),
              stripeInvoiceId: stripeInvoice.id,
              updatedAt: new Date(),
            }).where(eq(invoicesTable.stripePaymentIntentId, stripeInvoice.payment_intent));
            console.log(`[Stripe Webhook] Invoice paid via payment_intent ${stripeInvoice.payment_intent}`);
            break;
          }
        }
        // Match strategy 2: stripeInvoiceId direct (used by the new
        // "send via Stripe" flow which never goes through Checkout — the
        // invoice is paid directly on Stripe's hosted invoice page).
        if (stripeInvoice.id) {
          const rows = await db.select().from(invoicesTable).where(eq(invoicesTable.stripeInvoiceId, stripeInvoice.id));
          if (rows.length > 0) {
            await db.update(invoicesTable).set({
              status: "paid",
              paidAt: new Date(),
              hostedInvoiceUrl: stripeInvoice.hosted_invoice_url ?? null,
              invoicePdfUrl: stripeInvoice.invoice_pdf ?? null,
              updatedAt: new Date(),
            }).where(eq(invoicesTable.stripeInvoiceId, stripeInvoice.id));
            console.log(`[Stripe Webhook] Stripe-sent invoice ${stripeInvoice.id} marked paid`);
          }
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const stripeInvoice = event.data.object as any;
        const customerEmail: string | null = stripeInvoice.customer_email || null;

        if (!markReceiptEventProcessed(event.id)) {
          console.log(`[Stripe Webhook] invoice.payment_succeeded ${event.id} already processed — skipping duplicate receipt`);
          break;
        }

        if (customerEmail && stripeInvoice.amount_paid > 0) {
          try {
            await sendPaymentReceiptEmail({
              customerEmail,
              customerName: stripeInvoice.customer_name || null,
              amountPaid: stripeInvoice.amount_paid,
              currency: stripeInvoice.currency || "usd",
              invoiceNumber: stripeInvoice.number || null,
              description: stripeInvoice.description || stripeInvoice.lines?.data?.[0]?.description || null,
              periodStart: stripeInvoice.period_start ? new Date(stripeInvoice.period_start * 1000) : null,
              periodEnd: stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000) : null,
              hostedInvoiceUrl: stripeInvoice.hosted_invoice_url || null,
              invoicePdf: stripeInvoice.invoice_pdf || null,
            });
            console.log(`[Stripe Webhook] Receipt sent to ${customerEmail} for invoice ${stripeInvoice.id}`);
          } catch (emailErr) {
            console.error("[Stripe Webhook] Failed to send receipt email:", emailErr);
          }
        } else {
          console.log(`[Stripe Webhook] invoice.payment_succeeded — no customer email or zero amount, skipping receipt`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const stripeInvoice = event.data.object as any;
        if (stripeInvoice.payment_intent) {
          await db.update(invoicesTable).set({
            status: "overdue",
            updatedAt: new Date(),
          }).where(eq(invoicesTable.stripePaymentIntentId, stripeInvoice.payment_intent));
        }
        break;
      }

      case "quote.accepted": {
        const quote = event.data.object as any;
        const proposalId = quote.metadata?.app_proposal_id;
        if (proposalId) {
          // Idempotent: only mark accepted once. COALESCE preserves the
          // first-acceptance timestamp on duplicate webhook deliveries.
          await db.update(quoteProposalsTable).set({
            status: "accepted",
            stripeQuoteStatus: "accepted",
            respondedAt: sql`COALESCE(${quoteProposalsTable.respondedAt}, NOW())`,
            updatedAt: new Date(),
          }).where(eq(quoteProposalsTable.id, parseInt(proposalId)));
          console.log(`[Stripe Webhook] Stripe quote ${quote.id} accepted — proposal #${proposalId} marked accepted`);
        }
        break;
      }

      case "quote.canceled": {
        const quote = event.data.object as any;
        const proposalId = quote.metadata?.app_proposal_id;
        if (proposalId) {
          // Idempotent: stripeQuoteStatus is naturally idempotent; preserve
          // any existing respondedAt (e.g. if the client previously accepted
          // and then the quote was later canceled in the Stripe dashboard).
          await db.update(quoteProposalsTable).set({
            stripeQuoteStatus: "canceled",
            updatedAt: new Date(),
          }).where(eq(quoteProposalsTable.id, parseInt(proposalId)));
          console.log(`[Stripe Webhook] Stripe quote ${quote.id} canceled — proposal #${proposalId} flagged`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as any;
        const { currentPeriodStart, currentPeriodEnd } = getSubscriptionPeriod(subscription);
        const updates: Record<string, unknown> = {
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
          updatedAt: new Date(),
        };
        if (currentPeriodStart) updates.currentPeriodStart = currentPeriodStart;
        if (currentPeriodEnd) updates.currentPeriodEnd = currentPeriodEnd;
        await db.update(subscriptionsTable).set(updates as any)
          .where(eq(subscriptionsTable.stripeSubscriptionId, subscription.id));
        console.log(`[Stripe Webhook] Subscription ${subscription.id} updated to ${subscription.status}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as any;
        await db.update(subscriptionsTable).set({
          status: "canceled",
          canceledAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(subscriptionsTable.stripeSubscriptionId, subscription.id));
        console.log(`[Stripe Webhook] Subscription ${subscription.id} canceled`);
        break;
      }

      case "transfer.created": {
        const transfer = event.data.object as any;
        const { commissionId } = transfer.metadata || {};
        if (commissionId) {
          await db.update(partnerCommissionsTable).set({
            status: "paid",
            paidAt: new Date(),
            stripeTransferId: transfer.id,
          }).where(eq(partnerCommissionsTable.id, parseInt(commissionId)));
          console.log(`[Stripe Webhook] Commission #${commissionId} payout transfer created`);
        }
        break;
      }

      case "transfer.failed": {
        const transfer = event.data.object as any;
        const { commissionId } = transfer.metadata || {};
        if (commissionId) {
          const failureMessage = transfer.failure_message || "Transfer failed";
          await db.update(partnerCommissionsTable).set({
            status: "approved",
            paidAt: null,
            stripeTransferId: null,
            payoutMethod: null,
            notes: `Stripe transfer failed: ${failureMessage}. Ready to retry.`,
          }).where(eq(partnerCommissionsTable.id, parseInt(commissionId)));
          console.warn(`[Stripe Webhook] Commission #${commissionId} transfer failed: ${failureMessage}`);
        }
        break;
      }

      case "account.updated": {
        const account = event.data.object as any;
        const accountId: string = account.id;
        const payoutsEnabled: boolean = account.payouts_enabled ?? false;
        const detailsSubmitted: boolean = account.details_submitted ?? false;

        const rows = await db.select({ id: partnersTable.id, email: partnersTable.email })
          .from(partnersTable)
          .where(eq(partnersTable.stripeConnectAccountId, accountId))
          .limit(1);

        if (rows.length > 0) {
          console.log(`[Stripe Webhook] account.updated for partner #${rows[0].id}: payoutsEnabled=${payoutsEnabled}, detailsSubmitted=${detailsSubmitted}`);
        } else {
          console.log(`[Stripe Webhook] account.updated for unknown account ${accountId} — no matching partner`);
        }
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true, type: event.type });
  } catch (err) {
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, err);
    res.status(500).json({ error: "processing_error" });
  }
});

export default router;
