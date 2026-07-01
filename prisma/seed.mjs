import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SEED_USERS = [
  { email: "admin@example.com", name: "Admin", password: "ChangeMe123!", role: "ADMIN" },
  { email: "viewer@example.com", name: "Viewer", password: "ChangeMe123!", role: "VIEWER" },
];

async function main() {
  for (const u of SEED_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) {
      console.log(`Skipping ${u.email} — already exists.`);
      continue;
    }
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.create({
      data: { email: u.email, name: u.name, passwordHash, role: u.role },
    });
    console.log(`Created ${u.role.toLowerCase()} account: ${u.email} / ${u.password}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
