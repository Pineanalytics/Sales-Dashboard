import { stockActionTier } from "@/lib/format";
import { Badge } from "./Badge";

export function StockStatusPill({ action }: { action: string | null | undefined }) {
  const { label, tier } = stockActionTier(action);
  return <Badge tier={tier}>{label}</Badge>;
}
