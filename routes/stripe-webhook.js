import express from "express";
import Stripe from "stripe";
import supabase from "../database.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// POST /api/stripe/webhook — Stripe webhook handler
// NOTE: This route must NOT use express.json() — it needs the raw body
router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  let event;

  try {
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    switch (event.type) {
      case "invoice.paid": {
        const stripeInvoice = event.data.object;
        await supabase
          .from("invoices")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_invoice_id", stripeInvoice.id);
        break;
      }

      case "invoice.payment_failed": {
        const stripeInvoice = event.data.object;
        await supabase
          .from("invoices")
          .update({
            status: "overdue",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_invoice_id", stripeInvoice.id);
        break;
      }

      case "invoice.voided": {
        const stripeInvoice = event.data.object;
        await supabase
          .from("invoices")
          .update({
            status: "void",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_invoice_id", stripeInvoice.id);
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

export default router;
