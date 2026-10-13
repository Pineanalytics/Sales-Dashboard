"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { parseUpfieldOutletMaster, UpfieldMasterParseError } from "@/lib/upfieldOutletMaster";
import { replaceUpfieldOutletMaster } from "@/lib/upfieldOutletMasterStore";
import { rebuildOutletUniverse } from "@/lib/outletUniverse/rebuild";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  return session.user;
}

/** Uploads Upfield's outlet list ("OutletsList_KDwise_<date>.xlsx") as the official customer master: the whole list is replaced. */
export async function uploadUpfieldOutletMasterAction(formData: FormData) {
  const user = await requireAdmin();
  const file = formData.get("file");
  if (!file || !(file instanceof File) || file.size === 0) redirect("/admin/upfield-outlets?error=" + encodeURIComponent("Attach the Upfield outlet list (.xlsx) to upload."));

  let parsed;
  try {
    parsed = parseUpfieldOutletMaster(await (file as File).arrayBuffer());
  } catch (error) {
    const message = error instanceof UpfieldMasterParseError ? error.message : "Failed to read the uploaded file.";
    redirect("/admin/upfield-outlets?error=" + encodeURIComponent(message));
  }

  const stored = await replaceUpfieldOutletMaster(parsed.rows, { sourceFile: (file as File).name || null, uploadedBy: user.email ?? null });
  // The Active Outlet universe reads the master: refresh it in the background (about 45 seconds) rather than make the admin wait.
  void rebuildOutletUniverse().catch((error) => console.error("Active Outlet rebuild after the Upfield outlet list upload failed", error));

  const notes = parsed.warnings.length > 0 ? " " + parsed.warnings.join(" ") : "";
  redirect("/admin/upfield-outlets?success=" + encodeURIComponent(`Stored ${stored} Upfield outlets as the customer master.${notes} The Active Outlet module refreshes in about a minute.`));
}
