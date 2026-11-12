"use server";

import { redirect } from "next/navigation";
import { acceptProposals, afterNameChange, getRosterActor } from "@/lib/repLinks";

const PAGE = "/admin/employee-master/links";

/** Accepts the exact-match proposals listed on the page: one row's, or all of them. Each is checked again against today's data first, so a
 *  proposal that has stopped being a clean match is skipped, never forced. */
export async function acceptLinkProposalsAction(formData: FormData) {
  const actor = await getRosterActor();
  if (!actor) redirect("/");
  const tokens = Array.from(new Set(formData.getAll("token").map((value) => String(value)).filter(Boolean)));
  if (tokens.length === 0) redirect(`${PAGE}?error=${encodeURIComponent("Nothing selected to accept.")}`);

  const result = await acceptProposals(actor, tokens);
  if (result.nameChanged) await afterNameChange();
  const skipped = result.skipped > 0 ? ` ${result.skipped} no longer matched cleanly and ${result.skipped === 1 ? "was" : "were"} skipped.` : "";
  redirect(`${PAGE}?success=${encodeURIComponent(`Linked ${result.accepted} ${result.accepted === 1 ? "rep" : "reps"}.${skipped}`)}`);
}
