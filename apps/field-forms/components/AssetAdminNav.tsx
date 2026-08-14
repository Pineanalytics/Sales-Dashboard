"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AssetAdminNav({ formId }: { formId: string }) {
  const pathname = usePathname();
  const base = `/admin/forms/${formId}/assets`;

  const tabs = [
    { href: `${base}/queue`, label: "Verification Queue" },
    { href: `${base}/dashboard`, label: "Dashboard" },
    { href: `${base}/reports`, label: "Reports" },
    { href: `${base}/categories`, label: "Categories" },
    { href: `${base}/search`, label: "Search" },
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
