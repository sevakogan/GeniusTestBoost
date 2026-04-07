import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = "GeniusTestBoost <noreply@geniustestboost.com>";
const OWNER_EMAIL = process.env.NOTIFICATION_EMAIL || "classroom@geniustestboost.com";

/**
 * Send an email via Resend.
 * @param {Object} opts
 * @param {string} opts.to - Recipient email
 * @param {string} opts.subject - Email subject
 * @param {string} opts.html - HTML body
 */
async function sendEmail({ to, subject, html }) {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });
    if (error) {
      console.error("Resend error:", error);
      return { success: false, error };
    }
    return { success: true, id: data?.id };
  } catch (err) {
    console.error("Email send failed:", err.message);
    return { success: false, error: err.message };
  }
}

// --- Invoice Emails ---

async function sendInvoiceCreatedToStudent({ email, name, invoiceUrl, amount, description, dueDate }) {
  const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "30 days";
  return sendEmail({
    to: email,
    subject: `New Invoice from GeniusTestBoost - $${(amount / 100).toFixed(2)}`,
    html: `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
        <div style="text-align:center;margin-bottom:32px">
          <h1 style="font-size:24px;color:#1a1a2e;margin:0">Genius<span style="color:#C9A84C">TestBoost</span></h1>
        </div>
        <h2 style="color:#1a1a2e;font-size:20px">Hi ${name || "there"},</h2>
        <p style="color:#555;font-size:15px;line-height:1.6">
          A new invoice has been created for you.
        </p>
        <div style="background:#f8f9fa;border-radius:12px;padding:24px;margin:24px 0">
          <p style="margin:0 0 8px;color:#888;font-size:13px;text-transform:uppercase;letter-spacing:1px">Amount Due</p>
          <p style="margin:0;font-size:32px;font-weight:800;color:#1a1a2e">$${(amount / 100).toFixed(2)}</p>
          <p style="margin:8px 0 0;color:#666;font-size:14px">${description || "Tutoring Services"}</p>
          <p style="margin:4px 0 0;color:#888;font-size:13px">Due by ${dueDateStr}</p>
        </div>
        ${invoiceUrl ? `<div style="text-align:center;margin:32px 0"><a href="${invoiceUrl}" style="display:inline-block;padding:14px 36px;background:#C9A84C;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">Pay Invoice</a></div>` : ""}
        <p style="color:#999;font-size:12px;text-align:center;margin-top:40px">
          GeniusTestBoost | classroom@geniustestboost.com | 240.346.8306
        </p>
      </div>
    `,
  });
}

async function sendInvoicePaidToOwner({ studentName, studentEmail, amount, description }) {
  return sendEmail({
    to: OWNER_EMAIL,
    subject: `Payment Received - $${(amount / 100).toFixed(2)} from ${studentName || studentEmail}`,
    html: `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
        <h1 style="font-size:24px;color:#1a1a2e;margin:0 0 24px">Genius<span style="color:#C9A84C">TestBoost</span></h1>
        <h2 style="color:#27ae60;font-size:20px">Payment Received</h2>
        <div style="background:#e8f8f0;border-radius:12px;padding:24px;margin:20px 0">
          <p style="margin:0;font-size:28px;font-weight:800;color:#27ae60">$${(amount / 100).toFixed(2)}</p>
          <p style="margin:8px 0 0;color:#333"><strong>${studentName || "Student"}</strong> (${studentEmail})</p>
          <p style="margin:4px 0 0;color:#666">${description || "Tutoring Services"}</p>
        </div>
        <p style="color:#555;font-size:14px">This payment has been processed through Stripe Connect.</p>
      </div>
    `,
  });
}

async function sendInvoiceCreatedToOwner({ studentName, studentEmail, amount, description }) {
  return sendEmail({
    to: OWNER_EMAIL,
    subject: `Invoice Created - $${(amount / 100).toFixed(2)} for ${studentName || studentEmail}`,
    html: `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
        <h1 style="font-size:24px;color:#1a1a2e;margin:0 0 24px">Genius<span style="color:#C9A84C">TestBoost</span></h1>
        <h2 style="color:#1a1a2e;font-size:20px">New Invoice Created</h2>
        <div style="background:#f8f9fa;border-radius:12px;padding:24px;margin:20px 0">
          <p style="margin:0;font-size:28px;font-weight:800;color:#1a1a2e">$${(amount / 100).toFixed(2)}</p>
          <p style="margin:8px 0 0;color:#333"><strong>${studentName || "Student"}</strong> (${studentEmail})</p>
          <p style="margin:4px 0 0;color:#666">${description || "Tutoring Services"}</p>
        </div>
        <p style="color:#555;font-size:14px">Log in to your dashboard to send this invoice.</p>
      </div>
    `,
  });
}

async function sendNewStudentToOwner({ name, email, phone }) {
  return sendEmail({
    to: OWNER_EMAIL,
    subject: `New Student Registered - ${name}`,
    html: `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
        <h1 style="font-size:24px;color:#1a1a2e;margin:0 0 24px">Genius<span style="color:#C9A84C">TestBoost</span></h1>
        <h2 style="color:#1a1a2e;font-size:20px">New Student</h2>
        <div style="background:#f8f9fa;border-radius:12px;padding:24px;margin:20px 0">
          <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#1a1a2e">${name}</p>
          <p style="margin:0 0 4px;color:#555">${email}</p>
          ${phone ? `<p style="margin:0;color:#555">${phone}</p>` : ""}
        </div>
      </div>
    `,
  });
}

async function sendTeacherApprovedEmail({ email, name }) {
  return sendEmail({
    to: email,
    subject: "Your GeniusTestBoost Account Has Been Approved",
    html: `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
        <div style="text-align:center;margin-bottom:32px">
          <h1 style="font-size:24px;color:#1a1a2e;margin:0">Genius<span style="color:#C9A84C">TestBoost</span></h1>
        </div>
        <h2 style="color:#27ae60;font-size:20px">You're Approved!</h2>
        <p style="color:#555;font-size:15px;line-height:1.6">
          Hi ${name || "there"}, your teacher account has been approved. You can now create courses and manage assignments.
        </p>
        <div style="text-align:center;margin:32px 0">
          <a href="https://geniustestboost.com/login" style="display:inline-block;padding:14px 36px;background:#C9A84C;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">Go to Dashboard</a>
        </div>
        <p style="color:#999;font-size:12px;text-align:center;margin-top:40px">
          GeniusTestBoost | classroom@geniustestboost.com | 240.346.8306
        </p>
      </div>
    `,
  });
}

export {
  sendEmail,
  sendInvoiceCreatedToStudent,
  sendInvoiceCreatedToOwner,
  sendInvoicePaidToOwner,
  sendNewStudentToOwner,
  sendTeacherApprovedEmail,
};
