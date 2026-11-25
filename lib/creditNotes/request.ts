// Reads the module's filter from a request's query string: the dashboard's period (as months) and
// principal selection, plus an optional free-text search. One parser for the page feed and the export,
// so both always read the same filter.
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface CreditNotesParams {
  months: string[];
  principalKeys: string[];
  query: string;
}

export function parseCreditNotesParams(params: URLSearchParams): { value: CreditNotesParams } | { error: string } {
  const months = (params.get("months") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (months.length === 0 || months.length > 24 || !months.every((month) => MONTH_PATTERN.test(month))) {
    return { error: "months must be 1-24 comma-separated YYYY-MM values." };
  }
  const principalKeys = (params.get("principals") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (principalKeys.length > 60 || principalKeys.some((key) => key.length > 80)) return { error: "Too many principals." };
  const query = (params.get("q") ?? "").trim();
  if (query.length > 80) return { error: "The search text is too long." };
  return { value: { months, principalKeys, query } };
}
