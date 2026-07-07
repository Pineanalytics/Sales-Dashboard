import type { ReactNode } from "react";

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(10,31,82,0.06)]">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-dark-navy text-[13px] uppercase tracking-wide text-white/85 sticky top-0">
      <tr>{children}</tr>
    </thead>
  );
}

const ALIGN_CLASS = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

export function Th({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <th className={`px-3 py-3 font-medium border-b border-white/10 ${ALIGN_CLASS[align]} whitespace-nowrap`}>
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
  title,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  title?: string;
}) {
  return (
    <td className={`px-3 py-2 border-b border-border/60 ${ALIGN_CLASS[align]} whitespace-nowrap ${className}`} title={title}>
      {children}
    </td>
  );
}

export function TotalRow({ children }: { children: ReactNode }) {
  return (
    <tr
      className={
        "!bg-secondary-blue font-semibold [&_td]:!text-white [&_td]:!border-white/20 " +
        // Tier badges (e.g. AchievementBadge) default to soft-tinted blue/gold/orange
        // pills that would wash out against this same blue background — force a
        // translucent white pill instead so status is still legible in the total row.
        "[&_span]:!bg-white/15 [&_span]:!text-white [&_span]:!border-white/30"
      }
    >
      {children}
    </tr>
  );
}
