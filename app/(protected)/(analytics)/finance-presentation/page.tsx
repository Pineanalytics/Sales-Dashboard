import { redirect } from "next/navigation";

// The Finance Presentation now lives in the Financials module as a tab; this keeps old bookmarks working.
export default function FinancePresentationRedirect() {
  redirect("/financials?tab=finance-presentation");
}
