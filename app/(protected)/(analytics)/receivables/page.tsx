import { redirect } from "next/navigation";

export default function ReceivablesPage() {
  redirect("/financials?tab=receivables-summary");
}
