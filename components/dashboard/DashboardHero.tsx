import { ArrowSync24Regular } from "@fluentui/react-icons";

/** Shared executive banner with the network motif from the Pinefrost Distribution mark. */
export function DashboardHero({ title }: { title: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-dark-navy via-primary-blue to-secondary-blue px-6 py-7 shadow-[0_12px_30px_rgba(11,61,53,0.24)] md:px-9 md:py-8">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 opacity-50" viewBox="0 0 600 160" preserveAspectRatio="none" fill="none">
        <path d="M258 142 L340 92 L405 35 M340 92 L470 126 M405 35 L510 64" stroke="var(--brand-cyan)" strokeWidth="4" />
        <circle cx="258" cy="142" r="13" fill="none" stroke="var(--brand-cyan)" strokeWidth="5" />
        <circle cx="340" cy="92" r="10" fill="var(--brand-cyan)" />
        <circle cx="405" cy="35" r="16" fill="none" stroke="var(--brand-cyan)" strokeWidth="6" />
        <circle cx="470" cy="126" r="14" fill="none" stroke="var(--brand-cyan)" strokeWidth="5" />
        <circle cx="510" cy="64" r="12" fill="none" stroke="var(--brand-cyan)" strokeWidth="5" />
        <path d="M0 136 C105 90 184 135 270 110 S445 86 600 120" stroke="#ffffff" strokeWidth="2" opacity="0.28" />
      </svg>
      <div className="relative flex items-start justify-between gap-4">
        <h1 className="text-[28px] font-bold leading-tight text-white md:text-[38px]">{title}</h1>
        <div className="hidden shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 backdrop-blur-sm sm:flex">
          <ArrowSync24Regular className="h-5 w-5 text-brand-leaf" />
          <span className="text-sm font-bold tracking-wide text-white">PINEFROST ANALYTICS</span>
        </div>
      </div>
    </div>
  );
}
