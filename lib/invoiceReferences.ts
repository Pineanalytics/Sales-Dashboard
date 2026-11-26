// What a SAP invoice reference (NumAtCard) says about which SFA system raised it, and the key to look it up there. Pure.
//
//   Leverage          26W003008890_T005400900100105694_18058585   the middle part is the outlet code itself
//   Upfield DataEdge  OI-0719-239013-7111233                      DataEdge invoice OI-0719-239013
//   Pine order        OI-186249                                   pine.orders.ode_invoiceno
//   Pine sale         SI-250936-5621510                           pine.sales.s_invoiceno
//   EABL DMS          CSPFL038000118 (sometimes CSPFL009003300-OLKALAU)   Transactions.Sales number

export type InvoiceReference =
  | { system: "LEVERAGE"; outletKey: string }
  | { system: "UPFIELD" | "PINE_ORDER" | "PINE_SALE" | "EABL"; key: string };

/** How a reference is stored and matched: trimmed, in capitals. Empty for a blank reference. */
export function normalizeReference(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export function parseInvoiceReference(value: string | null | undefined): InvoiceReference | null {
  const ref = normalizeReference(value);
  const leverage = /^[^_]+_(T\d{10,})_\d{6,}$/.exec(ref);
  if (leverage) return { system: "LEVERAGE", outletKey: leverage[1] };
  const upfield = /^(OI-\d+-\d+)-\d+$/.exec(ref);
  if (upfield) return { system: "UPFIELD", key: upfield[1] };
  if (/^OI-\d+$/.test(ref)) return { system: "PINE_ORDER", key: ref };
  if (/^SI-\d+-\d+$/.test(ref)) return { system: "PINE_SALE", key: ref };
  const eabl = /^(C[A-Z]PFL\d+)/.exec(ref);
  if (eabl) return { system: "EABL", key: eabl[1] };
  return null;
}
