// The six Timestamp modules, all reachable from inside Coverage &
// Productivity's single "Timestamps" tab via local state (TimestampsModuleView)
// instead of their old standalone /timestamps/* routes.
export type TimestampsModule = "pine" | "eabl-calls" | "eabl-dsr" | "upfield-dataedge" | "upfield-visits" | "leverage";

// SfaReportNavigator's four hub-card keys map onto this module set: EABL and
// Upfield each collapse two modules into one hub card (their own ReportTabs
// switch between the two once inside), same as the hub's original routing.
export const SFA_KEY_TO_MODULE: Record<"pine" | "eabl" | "upfield" | "unilever", TimestampsModule> = {
  pine: "pine",
  eabl: "eabl-calls",
  upfield: "upfield-dataedge",
  unilever: "leverage",
};
