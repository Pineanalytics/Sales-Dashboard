"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function CoachingAdminNav({ formId }: { formId: string }) {
  const pathname = usePathname();
  const base = `/admin/forms/${formId}/coaching`;

  const tabs = [
    { href: `${base}/dashboard`, label: "Overview" },
    { href: `${base}/management`, label: "Feedback & attainment" },
    { href: `${base}/master-data`, label: "Master Data" },
    { href: `${base}/templates`, label: "Templates" },
    { href: `${base}/review`, label: "Supervisor Review" },
    { href: `${base}/action-plans`, label: "Action Plans" },
    { href: `${base}/reports`, label: "Reports" },
  ];

  return (
    <nav className="flex items-center gap-1 border-b border-[var(--line)] mb-8 flex-wrap">
      {tabs.map((t) => {
        const active = pathname?.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
              active
                ? "border-[var(--pine-700)] text-[var(--pine-700)] font-medium"
                : "border-transparent text-[var(--ink-600)] hover:text-[var(--pine-700)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
