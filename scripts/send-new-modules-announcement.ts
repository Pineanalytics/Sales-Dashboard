// Emails every approved user (viewer + admin) with the new-modules
// announcement. Superseded day-to-day by the "Save & send to all users"
// button on /admin/users, which edits the same EmailTemplate row this script
// reads — kept as a terminal fallback. Reuses lib/email.ts's existing
// Nodemailer/Gmail SMTP transport (same env vars as the approval email).
// Run with: node --import tsx scripts/send-new-modules-announcement.ts
process.loadEnvFile();

import { prisma } from "../lib/db";
import { sendAnnouncementEmail, ANNOUNCEMENT_TEMPLATE_KEY, DEFAULT_ANNOUNCEMENT_SUBJECT, DEFAULT_ANNOUNCEMENT_BODY } from "../lib/email";

async function main() {
  const template = await prisma.emailTemplate.findUnique({ where: { key: ANNOUNCEMENT_TEMPLATE_KEY } });
  const subject = template?.subject ?? DEFAULT_ANNOUNCEMENT_SUBJECT;
  const body = template?.body ?? DEFAULT_ANNOUNCEMENT_BODY;

  const users = await prisma.user.findMany({
    where: { status: "APPROVED" },
    select: { id: true, email: true, name: true },
    orderBy: { email: "asc" },
  });

  console.log(`[announcement] Sending to ${users.length} approved user(s)...`);

  let sent = 0;
  let failed = 0;
  for (const u of users) {
    const result = await sendAnnouncementEmail(u.email, u.name, subject, body);
    if (result.sent) {
      sent += 1;
      console.log(`[announcement] Sent to ${u.id}`);
    } else {
      failed += 1;
      console.error(`[announcement] FAILED for ${u.id}: ${result.error}`);
    }
  }

  console.log(`[announcement] Done: ${sent} sent, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[announcement] FAILED:", err);
  process.exitCode = 1;
});
