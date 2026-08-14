"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export default function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");

  function apply(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFrom) params.set("from", nextFrom);
    else params.delete("from");
    if (nextTo) params.set("to", nextTo);
    else params.delete("to");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function clear() {
    setFrom("");
    setTo("");
    apply("", "");
  }

  const hasRange = !!(searchParams.get("from") || searchParams.get("to"));

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6 bg-white border border-[var(--line)] rounded-lg px-3 py-2.5">
      <span className="text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)]">
        Date range
      </span>
      <input
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className="rounded-md border border-[var(--line)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
      />
      <span className="text-[var(--ink-400)] text-sm">to</span>
      <input
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="rounded-md border border-[var(--line)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
      />
      <button
        type="button"
        onClick={() => apply(from, to)}
        className="rounded-md bg-[var(--pine-700)] text-white text-xs font-medium px-3 py-1.5 hover:bg-[var(--pine-900)] transition-colors"
      >
        Apply
      </button>
      {hasRange && (
        <button
          type="button"
          onClick={clear}
          className="text-xs font-medium text-[var(--ink-600)] hover:text-[var(--rust-600)]"
        >
          Clear
        </button>
      )}
    </div>
  );
}
