import { formatTrendPercent, formatCompact, trendTier } from "@/lib/format";
import { tierTextClass } from "@/lib/format";

export function TrendPercent({ value }: { value: number | null | undefined }) {
  return <span className={tierTextClass[trendTier(value)]}>{formatTrendPercent(value)}</span>;
}

export function SignedCompact({ value }: { value: number | null | undefined }) {
  const tier = trendTier(value);
  const sign = value !== null && value !== undefined && value > 0 ? "+" : "";
  return (
    <span className={tierTextClass[tier]}>
      {sign}
      {formatCompact(value)}
    </span>
  );
}
