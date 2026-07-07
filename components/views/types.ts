import type { Dataset } from "@/lib/types";
import type { PeriodSelection } from "@/lib/timeIntelligence";

export interface ViewProps {
  dataset: Dataset;
  /** Normalized brand key (e.g. "eabl"), or null for "All Principals". */
  selectedPrincipalKey: string | null;
  period: PeriodSelection;
}
