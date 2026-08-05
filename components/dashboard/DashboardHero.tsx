import { ArrowSync24Regular } from "@fluentui/react-icons";

/** Navy gradient banner for the Executive Overview, matching the reference Power BI
 *  dashboard's header — large bold white title, abstract angular skyline graphic, and a
 *  brand mark top-right. Scoped to this one page (not the shared AnalyticsShell header),
 *  so every other analytics page keeps its existing slim header unchanged. */
export function DashboardHero({ title }: { title: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-dark-navy via-primary-blue to-secondary-blue px-6 py-7 shadow-[0_10px_30px_rgba(10,31,82,0.30)] md:px-9 md:py-8">
      {/* Abstract angular skyline — decorative only, echoes the reference banner's line graphic. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 opacity-40"
        viewBox="0 0 600 160"
        preserveAspectRatio="none"
        fill="none"
      >
        <polyline points="0,140 80,90 150,120 220,50 300,100 370,40 450,95 520,60 600,110" stroke="var(--brand-cyan)" strokeWidth="3" opacity="0.55" />
        <polyline points="0,150 90,110 170,135 260,80 340,125 420,70 500,115 600,85" stroke="#ffffff" strokeWidth="2" opacity="0.35" />
      </svg>
      <div className="relative flex items-start justify-between gap-4">
        <h1 className="text-[28px] font-bold leading-tight text-white md:text-[38px]">{title}</h1>
        <div className="hidden shrink-0 items-center gap-2 rounded-full bg-white/10 px-3 py-2 backdrop-blur-sm sm:flex">
          <ArrowSync24Regular className="h-5 w-5 text-white/90" />
          <span className="text-sm font-bold tracking-wide text-white">PINEFROST LIMITED</span>
        </div>
      </div>
    </div>
  );
}
