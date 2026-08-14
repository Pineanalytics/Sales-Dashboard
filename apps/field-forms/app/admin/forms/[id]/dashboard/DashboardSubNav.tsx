"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import DateRangePicker from "@/components/DateRangePicker";

export default function DashboardSubNav({ formId }: { formId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = `/admin/forms/${formId}/dashboard`;
  const qs = searchParams.toString();

  const tabs = [
    { href: base, label: "Summary", exact: true },
    { href: `${base}/outlets`, label: "Branches" },
    { href: `${base}/retailers`, label: "Retailers" },
    { href: `${base}/merchandisers`, label: "Merchandisers" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname?.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={qs ? `${t.href}?${qs}` : t.href}
              className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-[var(--pine-700)] text-white"
                  : "bg-white border border-[var(--line)] text-[var(--ink-600)] hover:border-[var(--pine-500)] hover:text-[var(--pine-700)]"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      <DateRangePicker />
    </div>
  );
}
