import Link from "next/link";
import type { ReactNode } from "react";

/** One width for every admin screen (and the workspace nav above it), so a page
 *  uses the window instead of a narrow centred column with idle space either side. */
export const ADMIN_CONTAINER = "mx-auto w-full max-w-[1800px]";

const CARD = "rounded-2xl bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.08)]";

export type AdminStat = { label: string; value: ReactNode; tone?: "default" | "attention" };

/** The shared admin page shell: a compact gradient header (back link, title, one
 *  line of purpose, headline counts and an optional primary action) over a
 *  full-width body. */
export function AdminPage({
  title,
  description,
  back = { href: "/admin", label: "Back to admin" },
  stats,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  back?: { href: string; label: string } | null;
  stats?: AdminStat[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 py-5 shadow-[0_2px_10px_rgba(11,61,53,0.25)] md:px-8">
        <div className={`${ADMIN_CONTAINER} flex flex-wrap items-end justify-between gap-3`}>
          <div className="min-w-0 max-w-4xl">
            {back ? (
              <Link href={back.href} className="inline-flex items-center gap-2 text-xs font-medium text-white/80 transition-colors hover:text-brand-orange">
                ← {back.label}
              </Link>
            ) : null}
            <h1 className="mt-2 text-[24px] font-bold leading-tight text-white md:text-[30px]">{title}</h1>
            {description ? <p className="mt-1 text-sm text-white/70">{description}</p> : null}
          </div>
          {stats?.length || actions ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/80">
              {stats?.map((stat) => (
                <span key={stat.label} className={stat.tone === "attention" ? "rounded-full bg-brand-orange/80 px-3 py-1 font-semibold text-white" : "rounded-full bg-white/10 px-3 py-1"}>
                  <span className="font-semibold text-white">{stat.value}</span> {stat.label}
                </span>
              ))}
              {actions}
            </div>
          ) : null}
        </div>
      </div>

      <div className={`${ADMIN_CONTAINER} flex flex-col gap-4 p-4 md:px-8 md:py-6`}>{children}</div>
    </div>
  );
}

/** The redirect-carried ?error= / ?success= messages every admin action uses. */
export function AdminNotices({ error, success }: { error?: string | null; success?: string | null }) {
  return (
    <>
      {error ? <p className={`${CARD} rounded-xl border-l-4 border-l-accent-red px-4 py-3 text-sm text-accent-red`}>{error}</p> : null}
      {success ? <p className={`${CARD} rounded-xl border-l-4 border-l-accent-green px-4 py-3 text-sm text-accent-green`}>{success}</p> : null}
    </>
  );
}

/** A titled card. `flush` drops the body padding so a table can run edge to edge. */
export function AdminCard({
  title,
  description,
  eyebrow,
  actions,
  flush = false,
  className = "",
  id,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  flush?: boolean;
  className?: string;
  id?: string;
  children?: ReactNode;
}) {
  const hasHeader = Boolean(title || description || eyebrow || actions);
  return (
    <section id={id} className={`${CARD} ${flush ? "overflow-hidden" : ""} ${className}`}>
      {hasHeader ? (
        <div className={`flex flex-wrap items-start justify-between gap-3 px-5 pt-4 ${flush ? "pb-3" : ""}`}>
          <div className="min-w-0">
            {eyebrow ? <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-blue">{eyebrow}</p> : null}
            {title ? <h2 className="text-base font-semibold text-primary-blue">{title}</h2> : null}
            {description ? <div className="mt-0.5 max-w-4xl text-[13px] text-muted">{description}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {flush ? <div className={hasHeader ? "border-t border-border/60" : ""}>{children}</div> : <div className={`px-5 pb-5 ${hasHeader ? "pt-3" : "pt-5"}`}>{children}</div>}
    </section>
  );
}

/** A collapsible panel for the forms and explanations that are needed now and
 *  then, so the records themselves sit near the top of the page. */
export function AdminDisclosure({
  title,
  description,
  badge,
  defaultOpen = false,
  tone = "default",
  className = "",
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  tone?: "default" | "note";
  className?: string;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className={`group ${CARD} ${tone === "note" ? "border border-border/70 bg-background-elevated/40 shadow-none" : ""} ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 font-semibold text-primary-blue">
            {title}
            {badge}
          </span>
          {description ? <span className="mt-0.5 block text-xs text-muted">{description}</span> : null}
        </span>
        <span className="shrink-0 rounded-full bg-accent-blue-soft px-3 py-1 text-xs font-semibold text-primary-blue group-open:bg-background group-open:text-muted-strong">
          <span className="group-open:hidden">Open</span>
          <span className="hidden group-open:inline">Close</span>
        </span>
      </summary>
      <div className="border-t border-border/60 px-5 pb-5 pt-4">{children}</div>
    </details>
  );
}

/** A small count pill for disclosure titles and card headers. */
export function AdminBadge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "attention" | "good" }) {
  const toneClass =
    tone === "attention" ? "bg-accent-amber-soft text-accent-amber" : tone === "good" ? "bg-accent-green-soft text-accent-green" : "bg-accent-blue-soft text-primary-blue";
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${toneClass}`}>{children}</span>;
}

/** Table-cell classes shared by the admin tables, so every list reads the same. */
export const adminTable = {
  table: "w-full border-collapse text-sm",
  head: "bg-background-elevated text-[12px] uppercase tracking-wide text-muted",
  th: "px-4 py-2.5 text-left font-medium",
  thRight: "px-4 py-2.5 text-right font-medium",
  td: "border-b border-border/60 px-4 py-2.5",
  tdRight: "border-b border-border/60 px-4 py-2.5 text-right",
  empty: "px-4 py-8 text-center text-sm text-muted",
};

/** The `data-search` value for a row that AdminTableSearch filters: its
 *  searchable parts, lower-cased. (Lives here, not in the client component, so
 *  server pages can call it.) */
export function searchText(...parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ")
    .toLowerCase();
}
