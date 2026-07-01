import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 rounded-2xl border border-dashed border-border bg-surface px-6 py-16">
      {icon ? <div className="text-secondary-blue">{icon}</div> : null}
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
