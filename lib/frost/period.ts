import { CANONICAL_MONTHS, type PeriodSelection } from "../timeIntelligence";

export const PERIOD_KEYWORDS = ["mtd", "ytd", "qtd", "last_month"] as const;
export type PeriodKeyword = (typeof PERIOD_KEYWORDS)[number];

/** Keeps the tool schema Claude sees to a small closed set of keywords instead
 *  of the full PeriodSelection shape (kind/year/month/toYear/toMonth) — a
 *  free-form period object is far more likely to come back malformed than a
 *  4-value enum, and every one of these maps onto a real PeriodSelection the
 *  rest of the app already understands. */
export function resolveKeywordPeriod(keyword: PeriodKeyword): PeriodSelection {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = CANONICAL_MONTHS[now.getMonth()];

  switch (keyword) {
    case "mtd":
      return { kind: "MTD", year, month };
    case "ytd":
      return { kind: "YTD", year, month };
    case "qtd":
      return { kind: "QTD", year, month };
    case "last_month": {
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { kind: "MONTH", year: String(lastMonthDate.getFullYear()), month: CANONICAL_MONTHS[lastMonthDate.getMonth()] };
    }
  }
}
