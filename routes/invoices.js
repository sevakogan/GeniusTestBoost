import express from "express";
import Stripe from "stripe";
import supabase from "../database.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  sendInvoiceCreatedToStudent,
  sendInvoiceCreatedToOwner,
  sendNewStudentToOwner,
} from "../lib/email.js";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const CONNECTED_ACCOUNT = process.env.STRIPE_CONNECTED_ACCOUNT_ID;
const FEE_PERCENT = parseFloat(process.env.STRIPE_APPLICATION_FEE_PERCENT || "0.2");
const STRIPE_PROCESSING_RATE = 0.029; // 2.9%
const STRIPE_PROCESSING_FIXED = 30; // 30 cents

// Public endpoint — no auth required (for shared invoice links)
router.get("/public/:id", async (req, res) => {
  try {
    const { data: invoice, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !invoice)
      return res.status(404).json({ error: "Invoice not found" });

    // Only return non-sensitive fields
    res.json({
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      customer_name: invoice.customer_name,
      customer_email: invoice.customer_email,
      class_name: invoice.class_name,
      description: invoice.description,
      hours: invoice.hours,
      rate_per_hour: invoice.rate_per_hour,
      subtotal: invoice.subtotal,
      extra_fee: invoice.extra_fee,
      extra_fee_label: invoice.extra_fee_label,
      discount: invoice.discount,
      discount_label: invoice.discount_label,
      tax_rate: invoice.tax_rate,
      tax_amount: invoice.tax_amount,
      merchant_fee: invoice.merchant_fee,
      total: invoice.total,
      status: invoice.status,
      due_date: invoice.due_date,
      created_at: invoice.created_at,
      stripe_hosted_url: invoice.stripe_hosted_url,
    });
  } catch (err) {
    console.error("Public invoice error:", err);
    res.status(500).json({ error: "Failed to load invoice" });
  }
});

router.use(requireAuth);

// GET /api/invoices/search-students?q= — Search students by name/email
router.get(
  "/search-students",
  requireRole("owner", "admin"),
  async (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      if (q.length < 2) return res.json([]);

      const { data, error } = await supabase
        .from("user")
        .select("id, name, email, phone, firstName, lastName")
        .or(`name.ilike.%${q}%,email.ilike.%${q}%,firstName.ilike.%${q}%,lastName.ilike.%${q}%`)
        .limit(10);

      if (error) throw error;
      res.json(data || []);
    } catch (err) {
      console.error("Search students error:", err);
      res.status(500).json({ error: "Search failed" });
    }
  }
);

// POST /api/invoices/create-student — Create a new student on the fly
router.post(
  "/create-student",
  requireRole("owner", "admin"),
  async (req, res) => {
    try {
      const { name, email, phone } = req.body;
      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required" });
      }

      // Check if student already exists
      const { data: existing } = await supabase
        .from("user")
        .select("id, name, email, phone")
        .eq("email", email)
        .single();

      if (existing) return res.json({ student: existing, existed: true });

      const parts = name.split(" ");
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ") || "";

      const { data: student, error } = await supabase
        .from("user")
        .insert({
          id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
          name,
          email,
          phone: phone || "",
          firstName,
          lastName,
          role: "student",
          isApproved: true,
          emailVerified: false,
        })
        .select()
        .single();

      if (error) throw error;
      // Notify owner about new student (fire and forget)
      sendNewStudentToOwner({ name, email, phone }).catch(() => {});

      res.json({ student, existed: false });
    } catch (err) {
      console.error("Create student error:", err);
      res.status(500).json({ error: "Failed to create student" });
    }
  }
);

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
    const {
      customer_email,
      customer_name,
      description,
      hours,
      rate_per_hour,
      class_name,
      extra_fee,
      extra_fee_label,
      discount_value,
      discount_type,
      discount_label,
      tax_rate,
      pass_merchant_fee,
      due_date,
    } = req.body;

    if (!customer_email || !hours || !rate_per_hour) {
      return res
        .status(400)
        .json({ error: "Student, hours, and rate are required" });
    }

    const hoursNum = parseFloat(hours);
    const rateNum = parseFloat(rate_per_hour);
    const subtotalCents = Math.round(hoursNum * rateNum * 100);
    const extraFeeCents = Math.round(parseFloat(extra_fee || 0) * 100);

    // Discount: percentage or flat
    let discountCents = 0;
    const discountVal = parseFloat(discount_value || 0);
    if (discount_type === "percent" && discountVal > 0) {
      discountCents = Math.round((subtotalCents + extraFeeCents) * (discountVal / 100));
    } else if (discountVal > 0) {
      discountCents = Math.round(discountVal * 100);
    }

    const taxRateNum = parseFloat(tax_rate || 0);
    const preTax = subtotalCents + extraFeeCents - discountCents;
    const taxAmountCents = Math.round(preTax * (taxRateNum / 100));
    let preTotal = preTax + taxAmountCents;

    // Calculate merchant fee if passing to customer
    let merchantFeeCents = 0;
    if (pass_merchant_fee) {
      // Stripe charges 2.9% + 30c — calculate what to add so after Stripe takes its cut, the net is correct
      merchantFeeCents = Math.round(
        (preTotal * STRIPE_PROCESSING_RATE + STRIPE_PROCESSING_FIXED) /
          (1 - STRIPE_PROCESSING_RATE)
      );
      // Simplified: just add the fee directly
      merchantFeeCents = Math.round(
        preTotal * STRIPE_PROCESSING_RATE + STRIPE_PROCESSING_FIXED
      );
    }

    const totalCents = preTotal + merchantFeeCents;
    const applicationFeeCents = Math.round(totalCents * (FEE_PERCENT / 100));

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

    // 2. Create invoice items on connected account
    // Main tutoring line item
    await stripe.invoiceItems.create(
      {
        customer: customer.id,
        amount: subtotalCents,
        currency: "usd",
        description:
          (class_name || "Tutoring Session") +
          (description ? ` — ${description}` : "") +
          ` (${hoursNum} hr${hoursNum !== 1 ? "s" : ""} x $${rateNum.toFixed(2)}/hr)`,
      },
      { stripeAccount: CONNECTED_ACCOUNT }
    );

    // Extra fee line item
    if (extraFeeCents > 0) {
      await stripe.invoiceItems.create(
        {
          customer: customer.id,
          amount: extraFeeCents,
          currency: "usd",
          description: extra_fee_label || "Additional Fee",
        },
        { stripeAccount: CONNECTED_ACCOUNT }
      );
    }

    // Discount line item (negative amount)
    if (discountCents > 0) {
      await stripe.invoiceItems.create(
        {
          customer: customer.id,
          amount: -discountCents,
          currency: "usd",
          description: discount_label || "Discount",
        },
        { stripeAccount: CONNECTED_ACCOUNT }
      );
    }

    // Tax line item
    if (taxAmountCents > 0) {
      await stripe.invoiceItems.create(
        {
          customer: customer.id,
          amount: taxAmountCents,
          currency: "usd",
          description: `Sales Tax (${taxRateNum}%)`,
        },
        { stripeAccount: CONNECTED_ACCOUNT }
      );
    }

    // Merchant fee line item
    if (merchantFeeCents > 0) {
      await stripe.invoiceItems.create(
        {
          customer: customer.id,
          amount: merchantFeeCents,
          currency: "usd",
          description: "Processing Fee",
        },
        { stripeAccount: CONNECTED_ACCOUNT }
      );
    }

    // 3. Create invoice on connected account
    const dueTimestamp = due_date
      ? Math.floor(new Date(due_date).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    const stripeInvoice = await stripe.invoices.create(
      {
        customer: customer.id,
        collection_method: "send_invoice",
        due_date: dueTimestamp,
        auto_advance: false,
        application_fee_amount: applicationFeeCents,
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
        class_name: class_name || "",
        description: description || "",
        hours: hoursNum,
        rate_per_hour: rateNum,
        subtotal: subtotalCents,
        extra_fee: extraFeeCents,
        extra_fee_label: extra_fee_label || "",
        discount: discountCents,
        discount_label: discount_label || "",
        tax_rate: taxRateNum,
        tax_amount: taxAmountCents,
        merchant_fee: merchantFeeCents,
        pass_merchant_fee: !!pass_merchant_fee,
        application_fee: applicationFeeCents,
        total: totalCents,
        status: "draft",
        due_date: due_date || new Date(dueTimestamp * 1000).toISOString(),
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;

    // Send email notifications (fire and forget)
    const desc = (class_name || "") + (description ? ` — ${description}` : "") || "Tutoring Services";
    sendInvoiceCreatedToOwner({
      studentName: customer_name,
      studentEmail: customer_email,
      amount: totalCents,
      description: desc,
    }).catch(() => {});

    res.json({ success: true, invoice });
  } catch (err) {
    console.error("Create invoice error:", err);
    res.status(500).json({
      error: "Failed to create invoice",
      details: err.message,
    });
  }
});

// PUT /api/invoices/:id — Update a draft invoice
router.put("/:id", requireRole("owner", "admin"), async (req, res) => {
  try {
    // Verify it's still a draft
    const { data: existing, error: fetchErr } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !existing)
      return res.status(404).json({ error: "Invoice not found" });

    if (existing.status !== "draft") {
      return res.status(400).json({ error: "Only draft invoices can be edited" });
    }

    const {
      customer_email, customer_name, class_name, description,
      hours, rate_per_hour, extra_fee, extra_fee_label,
      discount_value, discount_type, discount_label,
      tax_rate, pass_merchant_fee, due_date,
    } = req.body;

    const hoursNum = parseFloat(hours || existing.hours);
    const rateNum = parseFloat(rate_per_hour || existing.rate_per_hour);
    const subtotalCents = Math.round(hoursNum * rateNum * 100);
    const extraFeeCents = Math.round(parseFloat(extra_fee || 0) * 100);

    let discountCents = 0;
    const discountVal = parseFloat(discount_value || 0);
    if (discount_type === "percent" && discountVal > 0) {
      discountCents = Math.round((subtotalCents + extraFeeCents) * (discountVal / 100));
    } else if (discountVal > 0) {
      discountCents = Math.round(discountVal * 100);
    }

    const taxRateNum = parseFloat(tax_rate || 0);
    const preTax = subtotalCents + extraFeeCents - discountCents;
    const taxAmountCents = Math.round(preTax * (taxRateNum / 100));
    let preTotal = preTax + taxAmountCents;

    let merchantFeeCents = 0;
    if (pass_merchant_fee) {
      merchantFeeCents = Math.round(preTotal * STRIPE_PROCESSING_RATE + STRIPE_PROCESSING_FIXED);
    }

    const totalCents = preTotal + merchantFeeCents;
    const applicationFeeCents = Math.round(totalCents * (FEE_PERCENT / 100));

    // Delete old Stripe invoice and create a new one
    if (existing.stripe_invoice_id) {
      try {
        await stripe.invoices.del(existing.stripe_invoice_id, {}, { stripeAccount: CONNECTED_ACCOUNT });
      } catch (e) {
        // If delete fails (already voided, etc.), continue
      }
    }

    // Recreate on Stripe
    const email = customer_email || existing.customer_email;
    const name = customer_name || existing.customer_name;

    const existingCustomers = await stripe.customers.list(
      { email, limit: 1 },
      { stripeAccount: CONNECTED_ACCOUNT }
    );

    let customer;
    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create(
        { email, name: name || undefined },
        { stripeAccount: CONNECTED_ACCOUNT }
      );
    }

    await stripe.invoiceItems.create(
      {
        customer: customer.id,
        amount: subtotalCents,
        currency: "usd",
        description:
          (class_name || "Tutoring Session") +
          (description ? ` — ${description}` : "") +
          ` (${hoursNum} hr${hoursNum !== 1 ? "s" : ""} x $${rateNum.toFixed(2)}/hr)`,
      },
      { stripeAccount: CONNECTED_ACCOUNT }
    );

    if (extraFeeCents > 0) {
      await stripe.invoiceItems.create(
        { customer: customer.id, amount: extraFeeCents, currency: "usd", description: extra_fee_label || "Additional Fee" },
        { stripeAccount: CONNECTED_ACCOUNT }
      );
    }
    if (discountCents > 0) {
      await stripe.invoiceItems.create(
        { customer: customer.id, amount: -discountCents, currency: "usd", description: discount_label || "Discount" },
        { stripeAccount: CONNECTED_ACCOUNT }
      );
    }
    if (taxAmountCents > 0) {
      await stripe.invoiceItems.create(
        { customer: customer.id, amount: taxAmountCents, currency: "usd", description: `Sales Tax (${taxRateNum}%)` },
        { stripeAccount: CONNECTED_ACCOUNT }
      );
    }
    if (merchantFeeCents > 0) {
      await stripe.invoiceItems.create(
        { customer: customer.id, amount: merchantFeeCents, currency: "usd", description: "Processing Fee" },
        { stripeAccount: CONNECTED_ACCOUNT }
      );
    }

    const dueTimestamp = due_date
      ? Math.floor(new Date(due_date).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    const stripeInvoice = await stripe.invoices.create(
      {
        customer: customer.id,
        collection_method: "send_invoice",
        due_date: dueTimestamp,
        auto_advance: false,
        application_fee_amount: applicationFeeCents,
      },
      { stripeAccount: CONNECTED_ACCOUNT }
    );

    // Update our DB record
    const { data: updated, error } = await supabase
      .from("invoices")
      .update({
        stripe_invoice_id: stripeInvoice.id,
        stripe_hosted_url: stripeInvoice.hosted_invoice_url,
        customer_email: email,
        customer_name: name,
        class_name: class_name || "",
        description: description || "",
        hours: hoursNum,
        rate_per_hour: rateNum,
        subtotal: subtotalCents,
        extra_fee: extraFeeCents,
        extra_fee_label: extra_fee_label || "",
        discount: discountCents,
        discount_label: discount_label || "",
        tax_rate: taxRateNum,
        tax_amount: taxAmountCents,
        merchant_fee: merchantFeeCents,
        pass_merchant_fee: !!pass_merchant_fee,
        application_fee: applicationFeeCents,
        total: totalCents,
        due_date: due_date || new Date(dueTimestamp * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, invoice: updated });
  } catch (err) {
    console.error("Update invoice error:", err);
    res.status(500).json({ error: "Failed to update invoice", details: err.message });
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

    const finalized = await stripe.invoices.finalizeInvoice(
      invoice.stripe_invoice_id,
      {},
      { stripeAccount: CONNECTED_ACCOUNT }
    );

    await stripe.invoices.sendInvoice(
      invoice.stripe_invoice_id,
      {},
      { stripeAccount: CONNECTED_ACCOUNT }
    );

    const { error } = await supabase
      .from("invoices")
      .update({
        status: "sent",
        stripe_hosted_url: finalized.hosted_invoice_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.params.id);

    if (error) throw error;

    // Email the student with payment link
    sendInvoiceCreatedToStudent({
      email: invoice.customer_email,
      name: invoice.customer_name,
      invoiceUrl: finalized.hosted_invoice_url,
      amount: invoice.total,
      description: invoice.class_name || invoice.description || "Tutoring Services",
      dueDate: invoice.due_date,
    }).catch(() => {});

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
