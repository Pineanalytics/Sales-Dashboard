import type { Dataset, Principal } from "@/lib/types";

export interface ViewProps {
  dataset: Dataset;
  principal: Principal | null;
}
