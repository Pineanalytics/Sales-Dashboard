"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search20Regular } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { buildSearchIndex, searchIndex, searchResultTypeLabel, type SearchResult, type SearchResultType } from "@/lib/search";

const TYPE_ORDER: SearchResultType[] = ["principal", "rep", "customer", "location"];

/** Global header search over Reps/Principals/Locations/Customers, built from the
 *  already-loaded Dataset — no new API surface. Product search is intentionally
 *  not included: Product master data lives only in a server-side Prisma table,
 *  never loaded into the client Dataset. */
export function SearchBar() {
  const dataset = useDashboardStore((s) => s.dataset);
  const selectPrincipal = useDashboardStore((s) => s.selectPrincipal);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const index = useMemo(() => (dataset ? buildSearchIndex(dataset) : []), [dataset]);
  const results = useMemo(() => searchIndex(index, query), [index, query]);
  const grouped = useMemo(() => {
    const byType = new Map<SearchResultType, SearchResult[]>();
    for (const r of results) {
      const list = byType.get(r.type) ?? [];
      list.push(r);
      byType.set(r.type, list);
    }
    return TYPE_ORDER.map((type) => ({ type, items: (byType.get(type) ?? []).slice(0, 5) })).filter((g) => g.items.length > 0);
  }, [results]);

  if (!dataset) return null;

  function handleSelect(result: SearchResult) {
    if (result.type === "principal") {
      selectPrincipal(result.key);
      router.push("/sales");
    } else if (result.type === "rep") {
      router.push("/reps");
    } else if (result.type === "customer") {
      router.push("/customers");
    }
    // Locations have no filter/drill-down target anywhere in the app today —
    // informational only, just closes the dropdown.
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md">
      <div className="flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-3.5 py-2">
        <Search20Regular className="h-4 w-4 text-white/70 shrink-0" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search reps, principals, customers, locations…"
          className="w-full bg-transparent text-xs text-white placeholder:text-white/50 outline-none"
        />
      </div>

      {open && query.trim() && grouped.length > 0 ? (
        <div className="absolute left-0 right-0 mt-2 rounded-2xl bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)] overflow-hidden text-foreground z-50">
          <div className="max-h-80 overflow-y-auto">
            {grouped.map(({ type, items }) => (
              <div key={type}>
                <div className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                  {searchResultTypeLabel(type)}
                </div>
                {items.map((item) => (
                  <button
                    key={`${item.type}-${item.key}`}
                    onMouseDown={() => handleSelect(item)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-surface-hover transition-colors"
                  >
                    <div className="font-medium truncate">{item.label}</div>
                    {item.sublabel ? <div className="text-muted truncate">{item.sublabel}</div> : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : open && query.trim() ? (
        <div className="absolute left-0 right-0 mt-2 rounded-2xl bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)] px-3 py-3 text-xs text-muted z-50">
          No matches for &quot;{query}&quot;.
        </div>
      ) : null}
    </div>
  );
}
