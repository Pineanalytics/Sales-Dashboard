// One-off script: emails every approved user (viewer + admin) to announce the
// three new modules (Active Outlets, Timestamps, JP Adherence) and ask them
// to sign out/in so their refreshed page access takes effect. Not wired into
// any admin action — run manually once. Reuses lib/email.ts's existing
// Nodemailer/Gmail SMTP transport (same env vars as the approval email).
// Run with: node --import tsx scripts/send-new-modules-announcement.ts
process.loadEnvFile();

import { prisma } from "../lib/db";
import { sendNewModulesAnnouncementEmail } from "../lib/email";

async function main() {
  const users = await prisma.user.findMany({
    where: { status: "APPROVED" },
    select: { id: true, email: true, name: true },
    orderBy: { email: "asc" },
  });

  console.log(`[announcement] Sending to ${users.length} approved user(s)...`);

  let sent = 0;
  let failed = 0;
  for (const u of users) {
    const result = await sendNewModulesAnnouncementEmail(u.email, u.name);
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
