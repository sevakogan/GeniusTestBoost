import express from "express";
import Stripe from "stripe";
import supabase from "../database.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const CONNECTED_ACCOUNT = process.env.STRIPE_CONNECTED_ACCOUNT_ID;
const FEE_PERCENT = parseFloat(process.env.STRIPE_APPLICATION_FEE_PERCENT || "0.5");

router.use(requireAuth);

// GET /api/invoices/my — Student sees their invoices (matched by email)
router.get("/my", async (req, res) => {
  try {
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("customer_email", req.user.email)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(invoices || []);
  } catch (err) {
    console.error("My invoices error:", err);
    res.status(500).json({ error: "Failed to load invoices" });
  }
});

// GET /api/invoices — List all invoices (admin/owner)
router.get("/", requireRole("owner", "admin"), async (req, res) => {
  try {
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(invoices || []);
  } catch (err) {
    console.error("List invoices error:", err);
    res.status(500).json({ error: "Failed to load invoices" });
  }
});

// GET /api/invoices/:id — Single invoice
router.get("/:id", async (req, res) => {
  try {
    const { data: invoice, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !invoice)
      return res.status(404).json({ error: "Invoice not found" });

    // Students can only see their own invoices
    if (
      req.user.role === "student" &&
      invoice.customer_email !== req.user.email
    ) {
      return res.status(403).json({ error: "Not your invoice" });
    }

    res.json(invoice);
  } catch (err) {
    console.error("Get invoice error:", err);
    res.status(500).json({ error: "Failed to load invoice" });
  }
});

// POST /api/invoices — Create invoice (admin/owner)
router.post("/", requireRole("owner", "admin"), async (req, res) => {
  try {
    const { customer_email, customer_name, description, amount, due_date } =
      req.body;

    if (!customer_email || !amount) {
      return res
        .status(400)
        .json({ error: "Customer email and amount are required" });
    }

    const amountCents = Math.round(parseFloat(amount) * 100);
    const applicationFee = Math.round(amountCents * (FEE_PERCENT / 100));

    // 1. Find or create customer on connected account
    const existingCustomers = await stripe.customers.list(
      { email: customer_email, limit: 1 },
      { stripeAccount: CONNECTED_ACCOUNT }
    );

    let customer;
    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create(
        { email: customer_email, name: customer_name || undefined },
        { stripeAccount: CONNECTED_ACCOUNT }
      );
    }

    // 2. Create invoice item on connected account
    await stripe.invoiceItems.create(
      {
        customer: customer.id,
        amount: amountCents,
        currency: "usd",
        description: description || "GeniusTestBoost Services",
      },
      { stripeAccount: CONNECTED_ACCOUNT }
    );

    // 3. Create invoice on connected account
    const dueTimestamp = due_date
      ? Math.floor(new Date(due_date).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days

    const stripeInvoice = await stripe.invoices.create(
      {
        customer: customer.id,
        collection_method: "send_invoice",
        due_date: dueTimestamp,
        auto_advance: false,
        application_fee_amount: applicationFee,
      },
      { stripeAccount: CONNECTED_ACCOUNT }
    );

    // 4. Save to our database
    const { data: invoice, error } = await supabase
      .from("invoices")
      .insert({
        stripe_invoice_id: stripeInvoice.id,
        stripe_hosted_url: stripeInvoice.hosted_invoice_url,
        customer_email,
        customer_name: customer_name || "",
        description: description || "GeniusTestBoost Services",
        amount: amountCents,
        application_fee: applicationFee,
        status: "draft",
        due_date: due_date || new Date(dueTimestamp * 1000).toISOString(),
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, invoice });
  } catch (err) {
    console.error("Create invoice error:", err);
    res.status(500).json({
      error: "Failed to create invoice",
      details: err.message,
    });
  }
});

// POST /api/invoices/:id/send — Finalize & send invoice
router.post("/:id/send", requireRole("owner", "admin"), async (req, res) => {
  try {
    const { data: invoice, error: fetchErr } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !invoice)
      return res.status(404).json({ error: "Invoice not found" });

    if (invoice.status !== "draft") {
      return res.status(400).json({ error: "Only draft invoices can be sent" });
    }

    // Finalize the invoice on Stripe
    const finalized = await stripe.invoices.finalizeInvoice(
      invoice.stripe_invoice_id,
      {},
      { stripeAccount: CONNECTED_ACCOUNT }
    );

    // Send the invoice
    const sent = await stripe.invoices.sendInvoice(
      invoice.stripe_invoice_id,
      {},
      { stripeAccount: CONNECTED_ACCOUNT }
    );

    // Update our record
    const { error } = await supabase
      .from("invoices")
      .update({
        status: "sent",
        stripe_hosted_url: finalized.hosted_invoice_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.params.id);

    if (error) throw error;

    res.json({ success: true, hosted_url: finalized.hosted_invoice_url });
  } catch (err) {
    console.error("Send invoice error:", err);
    res.status(500).json({
      error: "Failed to send invoice",
      details: err.message,
    });
  }
});

// POST /api/invoices/:id/void — Void an invoice
router.post("/:id/void", requireRole("owner", "admin"), async (req, res) => {
  try {
    const { data: invoice, error: fetchErr } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !invoice)
      return res.status(404).json({ error: "Invoice not found" });

    if (invoice.status === "paid" || invoice.status === "void") {
      return res
        .status(400)
        .json({ error: "Cannot void a paid or already voided invoice" });
    }

    // Void on Stripe (must be finalized first)
    if (invoice.status === "sent") {
      await stripe.invoices.voidInvoice(
        invoice.stripe_invoice_id,
        {},
        { stripeAccount: CONNECTED_ACCOUNT }
      );
    }

    const { error } = await supabase
      .from("invoices")
      .update({ status: "void", updated_at: new Date().toISOString() })
      .eq("id", req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("Void invoice error:", err);
    res.status(500).json({
      error: "Failed to void invoice",
      details: err.message,
    });
  }
});

export default router;
