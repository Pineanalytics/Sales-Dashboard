import type { ReactNode } from "react";

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted sticky top-0">
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
    <th className={`px-3 py-3 font-medium border-b border-border ${ALIGN_CLASS[align]} whitespace-nowrap`}>
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
  return <tr className="bg-background-elevated font-semibold">{children}</tr>;
}
