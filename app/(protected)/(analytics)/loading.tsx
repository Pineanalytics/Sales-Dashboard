// Shown the instant a report is chosen, while the page's own data loads on the server. Without a
// loading state, switching reports looked frozen until the server had finished (seconds, on the
// heavier ones). The navigation chrome (sidebar, header, filters) stays in place around it.
export default function AnalyticsLoading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading report">
      <div className="h-7 w-64 animate-pulse rounded-lg bg-background-elevated" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl bg-background-elevated" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-xl bg-background-elevated" />
        <div className="h-72 animate-pulse rounded-xl bg-background-elevated" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
