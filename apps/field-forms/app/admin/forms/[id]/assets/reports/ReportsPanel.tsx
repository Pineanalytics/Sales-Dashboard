"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportToCsv, exportToExcel, exportToPdf, type ReportMeta } from "@/lib/reports/exporters";

const REGISTER_HEADERS = [
  "Asset Number",
  "Category",
  "Description",
  "Serial Number",
  "Employee",
  "Department",
  "Cost Centre",
  "Location",
  "Condition",
  "Status",
  "Purchase Date",
  "Warranty End",
];

async function fetchRegisterRows(
  supabase: ReturnType<typeof createClient>,
  formId: string,
  filter?: { field: "current_department" | "current_cost_centre" | "current_location" | "current_employee_id"; value: string }
) {
  let query = supabase
    .from("assets")
    .select(
      "asset_number, category_id, description, serial_number, current_employee_id, current_department, current_cost_centre, current_location, condition, status, purchase_date, warranty_end"
    )
    .eq("form_id", formId);
  if (filter) query = query.eq(filter.field, filter.value);
  const { data: assets } = await query;

  const { data: categories } = await supabase
    .from("asset_categories")
    .select("id, name")
    .eq("form_id", formId);
  const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]));

  const employeeIds = [...new Set((assets ?? []).map((a) => a.current_employee_id).filter(Boolean))] as string[];
  const { data: employees } = employeeIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", employeeIds)
    : { data: [] };
  const employeeName = new Map((employees ?? []).map((e) => [e.id, e.full_name || e.email]));

  return (assets ?? []).map((a) => [
    a.asset_number ?? "",
    categoryName.get(a.category_id ?? "") ?? "",
    a.description ?? "",
    a.serial_number ?? "",
    employeeName.get(a.current_employee_id ?? "") ?? "",
    a.current_department ?? "",
    a.current_cost_centre ?? "",
    a.current_location ?? "",
    a.condition ?? "",
    a.status,
    a.purchase_date ?? "",
    a.warranty_end ?? "",
  ]);
}

function buildMeta(brandName: string, title: string, filtersLabel?: string): ReportMeta {
  return {
    brandName,
    reportTitle: title,
    reportRef: `RPT-${Date.now().toString(36).toUpperCase()}`,
    generatedAt: new Date().toLocaleString(),
    generatedBy: "Admin",
    filtersLabel,
  };
}

export default function ReportsPanel({
  formId,
  brandName,
  employees,
}: {
  formId: string;
  brandName: string;
  employees: { id: string; name: string }[];
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [filterValue, setFilterValue] = useState<Record<string, string>>({});

  async function runRegisterExport(
    key: string,
    title: string,
    format: "csv" | "excel" | "pdf",
    filter?: { field: "current_department" | "current_cost_centre" | "current_location" | "current_employee_id"; value: string }
  ) {
    setBusy(key + format);
    const rows = await fetchRegisterRows(supabase, formId, filter);
    const meta = buildMeta(brandName, title, filter ? `${filter.field} = ${filter.value}` : undefined);
    const filename = `${title.replace(/\s+/g, "_")}.${format === "excel" ? "xlsx" : format === "pdf" ? "pdf" : "csv"}`;
    if (format === "csv") exportToCsv(filename, REGISTER_HEADERS, rows);
    if (format === "excel") await exportToExcel(filename, title, REGISTER_HEADERS, rows, meta);
    if (format === "pdf") await exportToPdf(filename, REGISTER_HEADERS, rows, meta);
    setBusy(null);
  }

  async function runWarrantyExport(format: "csv" | "excel" | "pdf") {
    setBusy("warranty" + format);
    const { data: assets } = await supabase
      .from("assets")
      .select("asset_number, description, current_employee_id, warranty_end")
      .eq("form_id", formId)
      .not("warranty_end", "is", null)
      .order("warranty_end");
    const employeeIds = [...new Set((assets ?? []).map((a) => a.current_employee_id).filter(Boolean))] as string[];
    const { data: employees } = employeeIds.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", employeeIds)
      : { data: [] };
    const employeeName = new Map((employees ?? []).map((e) => [e.id, e.full_name || e.email]));
    const headers = ["Asset Number", "Description", "Employee", "Warranty End", "Days Remaining"];
    const rows = (assets ?? []).map((a) => {
      const days = a.warranty_end
        ? Math.round((new Date(a.warranty_end).getTime() - Date.now()) / 86400000)
        : "";
      return [
        a.asset_number ?? "",
        a.description ?? "",
        employeeName.get(a.current_employee_id ?? "") ?? "",
        a.warranty_end ?? "",
        days,
      ];
    });
    const meta = buildMeta(brandName, "Warranty Expiry Report");
    const filename = `Warranty_Expiry_Report.${format === "excel" ? "xlsx" : format === "pdf" ? "pdf" : "csv"}`;
    if (format === "csv") exportToCsv(filename, headers, rows);
    if (format === "excel") await exportToExcel(filename, "Warranty Expiry", headers, rows, meta);
    if (format === "pdf") await exportToPdf(filename, headers, rows, meta);
    setBusy(null);
  }

  const buttonClass =
    "text-xs font-medium text-[var(--pine-700)] hover:underline disabled:opacity-50";

  return (
    <div className="space-y-5">
      <ReportCard title="Master Asset Register" description="Every asset in this tenant.">
        {(["csv", "excel", "pdf"] as const).map((f) => (
          <button
            key={f}
            disabled={busy === "master" + f}
            onClick={() => runRegisterExport("master", "Master Asset Register", f)}
            className={buttonClass}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </ReportCard>

      <ReportCard title="Departmental Asset Register" description="Filter by department.">
        <input
          type="text"
          placeholder="Department name"
          value={filterValue.department ?? ""}
          onChange={(e) => setFilterValue((p) => ({ ...p, department: e.target.value }))}
          className="rounded-md border border-[var(--line)] px-2 py-1 text-xs mr-3"
        />
        {(["csv", "excel", "pdf"] as const).map((f) => (
          <button
            key={f}
            disabled={!filterValue.department || busy === "dept" + f}
            onClick={() =>
              runRegisterExport("dept", "Departmental Asset Register", f, {
                field: "current_department",
                value: filterValue.department,
              })
            }
            className={buttonClass}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </ReportCard>

      <ReportCard title="Cost Centre Asset Register" description="Filter by cost centre.">
        <input
          type="text"
          placeholder="Cost centre"
          value={filterValue.costCentre ?? ""}
          onChange={(e) => setFilterValue((p) => ({ ...p, costCentre: e.target.value }))}
          className="rounded-md border border-[var(--line)] px-2 py-1 text-xs mr-3"
        />
        {(["csv", "excel", "pdf"] as const).map((f) => (
          <button
            key={f}
            disabled={!filterValue.costCentre || busy === "cc" + f}
            onClick={() =>
              runRegisterExport("cc", "Cost Centre Asset Register", f, {
                field: "current_cost_centre",
                value: filterValue.costCentre,
              })
            }
            className={buttonClass}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </ReportCard>

      <ReportCard title="Location Asset Register" description="Filter by branch, depot, or warehouse.">
        <input
          type="text"
          placeholder="Location"
          value={filterValue.location ?? ""}
          onChange={(e) => setFilterValue((p) => ({ ...p, location: e.target.value }))}
          className="rounded-md border border-[var(--line)] px-2 py-1 text-xs mr-3"
        />
        {(["csv", "excel", "pdf"] as const).map((f) => (
          <button
            key={f}
            disabled={!filterValue.location || busy === "loc" + f}
            onClick={() =>
              runRegisterExport("loc", "Location Asset Register", f, {
                field: "current_location",
                value: filterValue.location,
              })
            }
            className={buttonClass}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </ReportCard>

      <ReportCard title="Employee Asset Statement" description="Every asset allocated to one employee.">
        <select
          value={filterValue.employee ?? ""}
          onChange={(e) => setFilterValue((p) => ({ ...p, employee: e.target.value }))}
          className="rounded-md border border-[var(--line)] px-2 py-1 text-xs mr-3"
        >
          <option value="">Select employee…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        {(["csv", "excel", "pdf"] as const).map((f) => (
          <button
            key={f}
            disabled={!filterValue.employee || busy === "emp" + f}
            onClick={() =>
              runRegisterExport(
                "emp",
                `Employee Asset Statement - ${employees.find((e) => e.id === filterValue.employee)?.name ?? ""}`,
                f,
                { field: "current_employee_id", value: filterValue.employee }
              )
            }
            className={buttonClass}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </ReportCard>

      <ReportCard title="Warranty Expiry Report" description="All assets with a recorded warranty end date.">
        {(["csv", "excel", "pdf"] as const).map((f) => (
          <button
            key={f}
            disabled={busy === "warranty" + f}
            onClick={() => runWarrantyExport(f)}
            className={buttonClass}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </ReportCard>
    </div>
  );
}

function ReportCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-[var(--line)] rounded-lg p-5">
      <h3 className="font-display text-base text-[var(--ink-900)]">{title}</h3>
      <p className="text-sm text-[var(--ink-600)] mb-3">{description}</p>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </div>
  );
}
