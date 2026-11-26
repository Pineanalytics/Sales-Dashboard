// The months a SAP month-by-month sync covers, from its command-line arguments.
import type { SfaMonth } from "./syncMonth";

/** `--backfill` (1 January of this year to now), `--months=N` (the last N), `--from=YYYY-MM` / `--to=YYYY-MM`; otherwise the current month. */
export function monthRange(args: string[], asOf: Date): SfaMonth[] {
  const flag = (name: string) => args.includes(`--${name}`);
  const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const current: SfaMonth = { year: asOf.getUTCFullYear(), monthIndex: asOf.getUTCMonth() };
  const parse = (value: string): SfaMonth => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    if (!match) throw new Error(`Expected YYYY-MM, got "${value}".`);
    return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
  };
  let start = current;
  let end = current;
  if (flag("backfill")) start = { year: current.year, monthIndex: 0 };
  else if (option("months")) {
    const count = Number(option("months"));
    if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error("--months must be 1-24.");
    const d = new Date(Date.UTC(current.year, current.monthIndex - (count - 1), 1));
    start = { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() };
  }
  if (option("from")) start = parse(option("from")!);
  if (option("to")) end = parse(option("to")!);

  const months: SfaMonth[] = [];
  let y = start.year;
  let m = start.monthIndex;
  while (y < end.year || (y === end.year && m <= end.monthIndex)) {
    months.push({ year: y, monthIndex: m });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return months;
}
