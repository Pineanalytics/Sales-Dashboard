import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { toggleEmployeeMasterActiveAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function EmployeeMasterPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  const params = await searchParams;
  const employees = await prisma.employeeMaster.findMany({
    include: { contributions: { orderBy: { principal: "asc" } } },
    orderBy: [{ active: "desc" }, { pineName: "asc" }],
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 py-6 shadow-[0_2px_10px_rgba(10,31,82,0.25)] md:px-8 md:py-7">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange">
          ← Back to Admin
        </Link>
        <h1 className="mt-3 text-[26px] font-bold leading-tight text-white md:text-[34px]">Employee Master</h1>
        <p className="mt-1 text-sm text-white/70">Employee Roaster supplies Pine names, SAP joins, absolute Timestamp principal, sales role, status, and Contribution principal eligibility for JPA.</p>
      </div>

      <div className="mx-auto flex max-w-[1500px] flex-col gap-5 p-4 md:p-8">
        {params.success ? <div className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{params.success}</div> : null}
        {params.error ? <div className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{params.error}</div> : null}
        <div className="rounded-2xl bg-surface p-5 text-sm text-muted shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          {employees.length} employees loaded. Updating a status here also updates that rep&apos;s Team Leader target assignments; transaction value and volume remain SAP-only.
        </div>
        <div className="overflow-hidden rounded-2xl bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-background-elevated text-[12px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Pine sales rep</th>
                  <th className="px-4 py-3 text-left font-medium">SAP sales rep</th>
                  <th className="px-4 py-3 text-left font-medium">Absolute principal</th>
                  <th className="px-4 py-3 text-left font-medium">JPA principals</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Team leader</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id} className={employee.active ? undefined : "opacity-50"}>
                    <td className="border-b border-border/60 px-4 py-3">{employee.pineName} <span className="text-muted">({employee.employeeCode})</span></td>
                    <td className="border-b border-border/60 px-4 py-3">{employee.sapName}</td>
                    <td className="border-b border-border/60 px-4 py-3 font-medium">{employee.absolutePrincipal}</td>
                    <td className="border-b border-border/60 px-4 py-3">{employee.contributions.map((row) => row.principal).join(", ") || "—"}</td>
                    <td className="border-b border-border/60 px-4 py-3">{employee.salesRole}</td>
                    <td className="border-b border-border/60 px-4 py-3">{employee.teamLeader ?? "—"}</td>
                    <td className="border-b border-border/60 px-4 py-3">{employee.active ? <span className="text-accent-green">Active</span> : <span className="text-accent-red">Inactive</span>}</td>
                    <td className="border-b border-border/60 px-4 py-3 text-right">
                      <form action={toggleEmployeeMasterActiveAction}>
                        <input type="hidden" name="employeeCode" value={employee.employeeCode} />
                        <button className="rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
                          {employee.active ? "Deactivate" : "Activate"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
