// The Reckitt buying tenures, kept free of server code so the Active Outlets screen can use them (see reckitt.ts for the rules).
export const RECKITT_TENURES = ["Once in 6 Months", "Once in 3 Months", "Once Per Month"] as const;
export type ReckittTenure = (typeof RECKITT_TENURES)[number];
