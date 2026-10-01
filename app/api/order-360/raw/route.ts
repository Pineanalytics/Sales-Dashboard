import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { getOrder360RawRows, type Order360Filters } from "@/lib/order360Summary";
import type { OrderRecord } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDate(raw: string | null, paramName: string): Date | null | NextResponse {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ error: `"${paramName}" must be a YYYY-MM-DD value.` }, { status: 400 });
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: `"${paramName}" must be valid.` }, { status: 400 });
  return parsed;
}

const VALID_DAY_NAMES = new Set(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

function parseDayNames(raw: string | null): string[] | null | NextResponse {
  if (!raw) return null;
  const names = raw.split(",").map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return null;
  if (!names.every((n) => VALID_DAY_NAMES.has(n))) {
    return NextResponse.json({ error: '"dayNames" must be a comma-separated list of day names.' }, { status: 400 });
  }
  return names;
}

const COLUMNS: { header: string; get: (r: OrderRecord) => string | number | boolean | null }[] = [
  { header: "Order Date", get: (r) => r.orderDate.toISOString().slice(0, 10) },
  { header: "ERP Number", get: (r) => r.erpNumber },
  { header: "Invoice Number", get: (r) => r.invoiceNumber },
  { header: "Picklist ID", get: (r) => r.picklistId },
  { header: "Customer", get: (r) => r.customer },
  { header: "FSR", get: (r) => r.fsr },
  { header: "Amount", get: (r) => r.amount },
  { header: "Cleared By", get: (r) => r.clearedBy },
  { header: "Cleared", get: (r) => r.cleared },
  { header: "Cleared Date", get: (r) => r.clearedDate?.toISOString() ?? null },
  { header: "Picker", get: (r) => r.picker },
  { header: "Picked", get: (r) => r.picked },
  { header: "Pick Date", get: (r) => r.pickDate?.toISOString() ?? null },
  { header: "Dispatcher", get: (r) => r.dispatcher },
  { header: "Dispatched", get: (r) => r.dispatched },
  { header: "Dispatch Date", get: (r) => r.dispatchDate?.toISOString() ?? null },
  { header: "Audited By", get: (r) => r.auditedBy },
  { header: "Audited", get: (r) => r.audited },
  { header: "Van", get: (r) => r.van },
  { header: "Driver", get: (r) => r.driver },
  { header: "Delivered By", get: (r) => r.deliveredBy },
  { header: "Delivered", get: (r) => r.delivered },
  { header: "Delivery Date", get: (r) => r.deliveryDate?.toISOString() ?? null },
  { header: "Is Return", get: (r) => r.isReturn },
  { header: "Return Doc Type", get: (r) => r.returnDocType },
  { header: "Returned By", get: (r) => r.returnedBy },
  { header: "POD Status", get: (r) => r.podStatus },
  { header: "Payment Modes", get: (r) => r.paymentModes },
  { header: "STK", get: (r) => r.stk },
  { header: "STK Push Status", get: (r) => r.stkPushStatus },
  { header: "STK Payment Ref", get: (r) => r.stkPaymentRef },
  { header: "STK Amount Paid", get: (r) => r.stkAmountPaid },
  { header: "Payment Ref", get: (r) => r.paymentRef },
  { header: "Amount Paid", get: (r) => r.amountPaid },
];

function csvEscape(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Raw Data module — every OrderRecord field behind the same scope/filters as
 *  the rest of Order 360, so any viewer with page access can pull the exact
 *  rows backing the dashboard for their own analysis rather than being stuck
 *  with only the pre-aggregated views. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const month = req.nextUrl.searchParams.get("month")?.trim() || null;
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: '"month" must be a YYYY-MM value.' }, { status: 400 });
  }
  const weekLabel = req.nextUrl.searchParams.get("week")?.trim() || null;
  const dateFrom = parseDate(req.nextUrl.searchParams.get("dateFrom"), "dateFrom");
  if (dateFrom instanceof NextResponse) return dateFrom;
  const dateTo = parseDate(req.nextUrl.searchParams.get("dateTo"), "dateTo");
  if (dateTo instanceof NextResponse) return dateTo;
  const dayNames = parseDayNames(req.nextUrl.searchParams.get("dayNames"));
  if (dayNames instanceof NextResponse) return dayNames;

  const filters: Order360Filters = { month, weekLabel: month ? weekLabel : null, dateFrom, dateTo, dayNames };

  try {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);
    const rows = await getOrder360RawRows(new Date(), scope, filters);

    const lines = [COLUMNS.map((c) => csvEscape(c.header)).join(",")];
    for (const row of rows) {
      lines.push(COLUMNS.map((c) => csvEscape(c.get(row))).join(","));
    }

    const filename = `order-360-raw-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Failed to export Order 360 raw data", err);
    return NextResponse.json({ error: "Failed to export Order 360 raw data." }, { status: 500 });
  }
}
