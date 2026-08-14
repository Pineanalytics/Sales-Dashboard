"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function FormAdminNav({ formId }: { formId: string }) {
  const pathname = usePathname();
  const [hasMerchandiserCodes, setHasMerchandiserCodes] = useState(false);

  // Only tenants using the merchandiser-code system (Latitude today) see
  // this tab — everyone else's admin nav is unaffected.
  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("merchandiser_codes")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId)
      .then(({ count }) => {
        if (!cancelled) setHasMerchandiserCodes(!!count);
      });
    return () => {
      cancelled = true;
    };
  }, [formId]);

  const tabs = [
    { href: `/admin/forms/${formId}/dashboard`, label: "Dashboard" },
    { href: `/admin/forms/${formId}/submissions`, label: "Submissions" },
    { href: `/admin/forms/${formId}/edit`, label: "Edit form" },
    ...(hasMerchandiserCodes
      ? [{ href: `/admin/forms/${formId}/merchandiser-codes`, label: "Merchandiser Codes" }]
      : []),
  ];

  return (
    <nav className="flex items-center gap-1 border-b border-[var(--line)] mb-8 -mt-2">
      {tabs.map((t) => {
        const active =
          t.label === "Dashboard"
            ? pathname?.startsWith(t.href)
            : pathname === t.href;
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
