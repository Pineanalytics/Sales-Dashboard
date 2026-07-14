import nodemailer from "nodemailer";

// The dashboard doesn't own the pinefrost.co.ke domain's DNS, so it can't verify it with
// a transactional-email API (Resend, SES, etc.) to send *as* analytics@pinefrost.co.ke.
// Instead this sends via a dedicated mailbox's own SMTP (e.g. a Gmail account with an App
// Password) and sets Reply-To so replies still land in the real inbox.
const REPLY_TO = "analytics@pinefrost.co.ke";
const DEFAULT_APP_URL = "https://pinefrostdb.netlify.app";
const DEFAULT_SMTP_HOST = "smtp.gmail.com";
const DEFAULT_SMTP_PORT = 465;

function appUrl(): string {
  return process.env.APP_URL || DEFAULT_APP_URL;
}

/** Optional feature, same pattern as UPLOAD_API_KEY elsewhere in this project — a no-op
 *  (logged, not thrown) when SMTP_USER/SMTP_PASSWORD aren't set, so approvals still work
 *  end to end before email sending is wired up with real mailbox credentials. */
export async function sendApprovalEmail(to: string, name: string | null): Promise<{ sent: boolean; error?: string }> {
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  if (!user || !password) {
    console.warn(`[email] SMTP_USER/SMTP_PASSWORD not set — skipped sending approval email to ${to}`);
    return { sent: false, error: "Email sending is not configured (SMTP_USER/SMTP_PASSWORD unset)." };
  }

  const loginUrl = `${appUrl()}/login`;
  const greeting = name ? `Hi ${name},` : "Hi,";
  const fromName = process.env.SMTP_FROM_NAME || "Pinefrost Limited Performance Dashboard";

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || DEFAULT_SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || DEFAULT_SMTP_PORT,
      secure: true,
      auth: { user, pass: password },
    });

    await transporter.sendMail({
      from: `"${fromName}" <${user}>`,
      replyTo: REPLY_TO,
      to,
      subject: "Your Pinefrost Dashboard access has been approved",
      text: `${greeting}\n\nYour account request for the Pinefrost Limited Performance Dashboard has been created and approved. You can now sign in here:\n\n${loginUrl}\n\nIf you didn't request this account, please contact your administrator.`,
      html: `<p>${greeting}</p><p>Your account request for the <strong>Pinefrost Limited Performance Dashboard</strong> has been created and approved. You can now sign in:</p><p><a href="${loginUrl}">${loginUrl}</a></p><p>If you didn't request this account, please contact your administrator.</p>`,
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "Unknown error sending email." };
  }
}

/** One-off announcement email (new modules added), reusing the same transporter/env-var
 *  pattern as sendApprovalEmail. Not wired into any action — sent manually via
 *  scripts/send-new-modules-announcement.ts. */
export async function sendNewModulesAnnouncementEmail(to: string, name: string | null): Promise<{ sent: boolean; error?: string }> {
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  if (!user || !password) {
    console.warn(`[email] SMTP_USER/SMTP_PASSWORD not set — skipped sending announcement email to ${to}`);
    return { sent: false, error: "Email sending is not configured (SMTP_USER/SMTP_PASSWORD unset)." };
  }

  const loginUrl = `${appUrl()}/login`;
  const greeting = name ? `Hi ${name},` : "Hi,";
  const fromName = process.env.SMTP_FROM_NAME || "Pinefrost Limited Performance Dashboard";

  const modules = [
    ["Active Outlets", "distinct buying-outlet counts per Principal, with Channel/Sub Channel and Primary/Secondary breakdowns"],
    ["Timestamps", "rep call activity for the current month, with time-of-day and productivity detail"],
    ["JP Adherence", "planned vs. actual visit routes, with adherence and strike-rate tracking"],
  ] as const;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || DEFAULT_SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || DEFAULT_SMTP_PORT,
      secure: true,
      auth: { user, pass: password },
    });

    await transporter.sendMail({
      from: `"${fromName}" <${user}>`,
      replyTo: REPLY_TO,
      to,
      subject: "New modules added to the Pinefrost Dashboard",
      text: `${greeting}\n\nThree new modules have been added to the Pinefrost Limited Performance Dashboard:\n\n${modules
        .map(([title, desc]) => `- ${title} — ${desc}`)
        .join("\n")}\n\nTo see the new pages in your sidebar, please sign out and sign back in — this refreshes your access so the new modules appear.\n\nSign in here: ${loginUrl}\n\nIf you don't see the new modules after signing back in, let your administrator know.`,
      html: `<p>${greeting}</p><p>Three new modules have been added to the <strong>Pinefrost Limited Performance Dashboard</strong>:</p><ul>${modules
        .map(([title, desc]) => `<li><strong>${title}</strong> — ${desc}</li>`)
        .join("")}</ul><p>To see the new pages in your sidebar, please sign out and sign back in — this refreshes your access so the new modules appear.</p><p><a href="${loginUrl}">${loginUrl}</a></p><p>If you don't see the new modules after signing back in, let your administrator know.</p>`,
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "Unknown error sending email." };
  }
}
