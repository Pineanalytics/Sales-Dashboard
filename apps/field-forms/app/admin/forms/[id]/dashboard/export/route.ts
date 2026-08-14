import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFormFieldsAndRows } from "@/lib/formData";
import { buildExportData } from "@/lib/dashboardExport";
import { renderDashboardHtml } from "@/lib/renderDashboardHtml";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, assigned_form_id")
    .eq("id", user.id)
    .single();
  const canExport =
    profile?.role === "super_admin" ||
    (profile?.role === "admin" && profile.assigned_form_id === id);
  if (!canExport) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { form, fields, rows } = await getFormFieldsAndRows(supabase, id, { from, to });
  if (!form) {
    return new NextResponse("Not found", { status: 404 });
  }

  const exportData = buildExportData(fields, rows);
  const html = renderDashboardHtml(form.title, exportData, from && to ? `${from} – ${to}` : from ? `From ${from}` : to ? `Through ${to}` : undefined);
  const rangeSuffix = from || to ? `_${from ?? "start"}_to_${to ?? "now"}` : "";
  const filename = `${form.title.replace(/[^a-z0-9]+/gi, "_")}_dashboard${rangeSuffix}.html`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
