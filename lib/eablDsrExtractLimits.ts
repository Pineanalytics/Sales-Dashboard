// Client-safe limits of the full DSR extract (the server side lives in lib/eablDsrExtract.ts).

/** The widest range one workbook covers. The call-level sheet alone runs to ~10,000 lines a month; this keeps a workbook to a size the server builds
 *  in a few seconds and Excel opens comfortably. */
export const DSR_EXTRACT_MAX_DAYS = 124;
