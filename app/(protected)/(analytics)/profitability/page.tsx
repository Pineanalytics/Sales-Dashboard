import { redirect } from "next/navigation";

export default function ProfitabilityPage() {
  redirect("/financials?tab=profitability");
}
