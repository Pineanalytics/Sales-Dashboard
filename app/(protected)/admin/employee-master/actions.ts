"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { recomputeDailyTargets, recomputeRepContribution } from "@/lib/repContribution";

export async function toggleEmployeeMasterActiveAction(formData: FormData) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const employeeCode = String(formData.get("employeeCode") || "").trim();
  if (!employeeCode) redirect("/admin/employee-master?error=Missing%20employee%20code.");

  const employee = await prisma.employeeMaster.findUnique({ where: { employeeCode } });
  if (!employee) redirect("/admin/employee-master?error=Employee%20not%20found.");

  const active = !employee.active;
  await prisma.$transaction([
    prisma.employeeMaster.update({ where: { employeeCode }, data: { active } }),
    prisma.teamLeaderAssignment.updateMany({ where: { employeeCode }, data: { active } }),
  ]);
  await recomputeRepContribution();
  await recomputeDailyTargets();
  redirect(`/admin/employee-master?success=${encodeURIComponent(`${active ? "Activated" : "Deactivated"} ${employee.pineName}.`)}`);
}
