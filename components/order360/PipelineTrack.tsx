"use client";

import { O360, fmtNum } from "./theme";

export interface PipelineStage {
  key: string;
  stage: string;
  count: number;
  dropCount?: number; // orders stuck between this stage and the next
}

export function PipelineTrack({ stages, onJump }: { stages: PipelineStage[]; onJump: (key: string) => void }) {
  return (
    <div className="overflow-x-auto pb-1">
      <div className="relative flex min-w-[560px] items-start justify-between gap-1 pt-2">
        <div className="absolute left-0 right-0 top-[22px] h-px" style={{ background: "rgba(255,255,255,0.14)" }} />
        {stages.map((s) => (
          <div key={s.key} className="relative z-10 flex flex-1 flex-col items-center gap-1.5 text-center">
            <div className="h-3 w-3 rounded-full ring-4" style={{ background: O360.accent, ["--tw-ring-color" as string]: O360.base }} />
            <div className="text-base font-bold text-white">{fmtNum(s.count)}</div>
            <div className={`text-[11px] ${O360.textMuted}`}>{s.stage}</div>
            {s.dropCount !== undefined ? (
              s.dropCount > 0 ? (
                <button
                  onClick={() => onJump(s.key)}
                  className="mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: `${O360.bad}22`, color: O360.bad }}
                >
                  &minus;{fmtNum(s.dropCount)} stuck
                </button>
              ) : (
                <span className="mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${O360.good}22`, color: O360.good }}>
                  clear
                </span>
              )
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
