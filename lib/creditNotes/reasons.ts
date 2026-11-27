// Why credit notes were issued. SAP has a return-reason list, but it is left blank on every document; the reason is typed in
// the credit note's Remarks box, often alongside text SAP or an integration puts there. This reads the typed part and sorts it
// into a fixed set of reason groups. Pure: no database, no clock. The rules were written against the 2026 remarks.

export const REASONS = [
  { id: "payment", label: "Payment or credit limit" },
  { id: "shop", label: "Shop closed or not found" },
  { id: "late", label: "Late delivery" },
  { id: "declined", label: "Not ordered, cancelled or refused" },
  { id: "order", label: "Wrong or changed order" },
  { id: "stockout", label: "Out of stock" },
  { id: "undelivered", label: "Not delivered or not received" },
  { id: "stocked", label: "Customer stocked or goods not selling" },
  { id: "duplicate", label: "Duplicate order or invoice" },
  { id: "lpo", label: "LPO problem" },
  { id: "expiry", label: "Expiry or damage" },
  { id: "price", label: "Price or discount correction" },
  { id: "promo", label: "Promotion, rebate or incentive claim" },
  { id: "account", label: "Account, PIN or printing correction" },
  { id: "rebook", label: "Rebooked to correct the invoice" },
  { id: "recon", label: "Reconciliation or period closing" },
  { id: "partial", label: "Return, cause not stated" },
  { id: "other", label: "Other typed remark" },
  { id: "none", label: "No reason typed" },
  { id: "system", label: "Posted by DMS or SFA, no reason" },
] as const;

export type ReasonId = (typeof REASONS)[number]["id"];

const LABELS = new Map<ReasonId, string>(REASONS.map((r) => [r.id, r.label]));
export const reasonLabel = (id: ReasonId): string => LABELS.get(id) ?? id;

/** The two groups that carry no reason at all. */
export const hasTypedReason = (id: ReasonId): boolean => id !== "none" && id !== "system";

// Text that SAP or an integration writes into Remarks by itself. It is removed before looking for a typed reason.
const AUTOMATIC_TEXT: RegExp[] = [
  /(?:UKL|EABL|UP\s*Field|Sales\s*Edge(?:\s+Van\s+Sales)?)\s+(?:Credit\s*Note|Invoice)\s*No\s*[:.]?\s*[^\s;]+/gi,
  /Printed\s*By\s*[:.]?\s*[^\s;]+/gi,
  /Based\s+on\s+(?:(?:A\/?R|A\/?P)\s+)?(?:Sales\s+Orders?|Invoices?|Return\s+Requests?|Returns?|Deliveries|Delivery\s+Notes?|Credit\s+(?:Memos?|Notes?)|Sales\s+Quotations?)\s*(?:\d+\s*[.,]?\s*)+/gi,
  /Discount percentage deviates from discount total due to rounding\s*\*?/gi,
];

/** A credit note posted by an integration carries that system's own credit note number. */
const INTEGRATION_CREDIT_NOTE = /(?:UKL|EABL|UP\s*Field|Sales\s*Edge(?:\s+Van\s+Sales)?)\s+Credit\s*Note\s*No/i;

/** The part of the Remarks a person typed, or "" when there is none. */
export function typedRemark(remarks: string | null | undefined): string {
  let text = (remarks ?? "").replace(/\s+/g, " ");
  for (const pattern of AUTOMATIC_TEXT) text = text.replace(pattern, " ");
  text = text.replace(/\s+/g, " ").replace(/^[\s.,;:*_/|-]+|[\s.,;:*_/|-]+$/g, "");
  return /[a-z]{2,}/i.test(text) ? text : "";
}

// Checked in this order; the first match wins. The order matters: "expired LPO" is an LPO problem, "late payment" a payment
// problem, "wrong discount" a price correction, and "partial return, no cash" a payment problem rather than a bare return.
const RULES: [ReasonId, RegExp][] = [
  ["duplicate", /doub|dou+le|ouble inv|dupl|dupic|diplica|repeat|twice|\bd\/inv|same o[a-z]?der|already (?:been )?(?:booked|delivered|invoiced)|delivered previous|deliver(?:ed)? the same|serviced by another/],
  ["promo", /promo|rebate|\bjbp\b|pay ?out|incentive|bonanza|bogof|\btts\b|sponsor|gondola|com[a-z]{0,2}pe[a-z]*sation|conpensation|\bclaim|market support|visibility|refundable|loyalty|salary|\{ ?\d+ ?p/],
  ["recon", /recon|\bmbsr\b|stock loss|closing period|stock adjust|physical count/],
  ["lpo", /\blpo\b/],
  ["expiry", /exp[a-z]{0,2}ir|expir|expres|expit|exip|xp[a-z]{0,2}y\b|swell|da?mag|damge|dmag|broken|leak|\bempt(?:y|ies)\b|\blid\b|\bseal|quality|weevil|infest|crystal|blow ?out|defaced|faded|spoil|(?:good|bad) condition|loose/],
  ["price", /disc(?!reet)|pric|pice issue|\boff?er\b|high cost|expensive|over ?charge/],
  ["payment", /ca+s+h|\bcah\b|\bcsh\b|c[xv] ?c?ash|\bcas\b|\bcahs\b|\bvash\b|c ash|\bno ?c[va][a-z]{1,3}\b|chq|cheq|bounc|\bfunds?\b|money|pay|\bpaid\b|not pad\b|unpaid|limit|insuf?f|deposit|\bterms\b|\bcredit (?:hold|term)/],
  ["stockout", /\bo+s\b|\boos|ou[tf]? of s|stock ?out|(?:stk|stock) (?:issue|problem)|less stock|\bno stock|once stocks? (?:is |are )?received/],
  ["stocked", /over ?stock|stocked|still in stock|eno?u?gh stock|already (?:bought|has)|bought from|elsewhere|somewhere else|another place|purchased from|slow mov|not sold|low turn|refused? to use|did not use/],
  ["shop", /shop.{0,12}(?:clo|c\W?l|l\W?os|not|unk|inkn|location)|(?:no|unknown) shop|unkn|clos(?:ed|ure|ing shop)(?! by mistake)|cl+o[a-z0-9]{0,2}s[ae]*d(?! by mistake)|location|off ?r?o?u[a-z]*te|offoute|\broad|passab|unreach|\baccess|ac+es+[a-z]*ble|not (?:found|traced|known|located)|owner|onwer|not available|unavailable|delivery zone|too far|direction/],
  ["late", /(?<!choco)la+te|\blae d|\blat d|dele?a+y|\bdelay|timing|inadequate time/],
  ["undelivered", /not (?:yet )?(?:been )?(?:rece?i?ved|rcvd|dis?pat|dispat|delie?v|despatch|reached)|did ?n[o']?t receive|no dispatch|no delivery|loadn?g sheet|loading sheet|undelivered|non delivery|under ?supply|less supply|dispatched \d|less in a case/],
  ["account", /\bpin\b|\bacc(?:ount)?\b|a\/c|\bac+ ?n[a-z]{2,3}\b|avcc|account|series|printer|printing|not printed|paper (?:error|tear)|\bqr\b|scan|\betr\b|\bvat\b|\bkra\b|wrong (?:customer|code)|wrong(?:ly)? invoic|wrong invoic|customer'?s? name/],
  ["order", /wr ?o ?[mn]?g|wrr+ong|\brong\b|excess|over ?supply|reduc|top(?:ped)? ?up|add(?:ed)? (?:to )?(?:order|more|sku)|exchange|interchange|change (?:of )?sku|order (?:adjust|error)|error order|amend|incomplete|less order|wanted|new order|\bqty\b|quantit/],
  ["declined", /\bn(?:o ?t|t|o t) ?(?:o+[a-z0-9]*|rd|b?ord)[a-z0-9]*d\b|not? ?or[a-z]*d|no order|did ?n[o']?t order|cancel|ca+nca|calcel|refus|reject|declin|disput|fake o|st[u]?[rb]+orn|not (?:needed|requested)/],
  // After "declined", so that "not ordered" is never read as a changed order.
  ["order", /\bordered\b|needed|\bneeds\b|assort|not complete|order adding/],
  ["rebook", /re+ ?book|re+bok|rebb?o|re ?in[a-z]*oic|reiv|invoic|combine|merge|split|separate|sepatate|re ?open|\bedit|correct|rectify|system|error|change|booked/],
  ["partial", /parti|patial|parital|\bp ?\/{0,2} ?r+tn|prtn|p\/trn|f ?[\/.]? ?rtn|full (?:rtn|return)|\brtn\b|\breturn/],
];

/** The reason group of one credit note, from its whole Remarks text. */
export function classifyReason(remarks: string | null | undefined): { id: ReasonId; typed: string } {
  const typed = typedRemark(remarks);
  if (!typed) return { id: INTEGRATION_CREDIT_NOTE.test(remarks ?? "") ? "system" : "none", typed: "" };
  const text = typed.toLowerCase();
  const match = RULES.find(([, pattern]) => pattern.test(text));
  return { id: match ? match[0] : "other", typed };
}

// ---------------------------------------------------------------------------------------------- the report

/** One credit note's value under one principal (a document spanning two principals gives two rows). */
export interface ReasonRow {
  docEntry: number;
  docNum: string;
  date: string; // YYYY-MM-DD
  customerCode: string;
  customerName: string;
  rep: string;
  /** Brand-level principal, as the Credit Notes report names it. */
  principal: string;
  enteredBy: string;
  remarks: string | null;
  /** Credit value excl. VAT, positive. */
  credit: number;
}

export interface ReasonTotal {
  credit: number;
  documents: number;
}

export interface ReasonSummaryRow extends ReasonTotal {
  id: ReasonId;
  label: string;
  share: number;
  customers: number;
  topPrincipal: string;
  /** Credit per month, aligned to the report's `months`. */
  m: number[];
}

export interface ReasonGroupRow extends ReasonTotal {
  name: string;
  code?: string;
  /** Share of this row's credit that carries a typed reason, 0-100. */
  typedShare: number;
  /** Documents with no reason (whether entered in SAP or posted by an integration). */
  untypedDocuments: number;
  untypedCredit: number;
  /** The largest typed reason of this row; "" when it has none. */
  topReason: string;
  byReason: Partial<Record<ReasonId, number>>;
}

export interface ReasonDocument {
  docNum: string;
  date: string;
  customerCode: string;
  customerName: string;
  principal: string;
  rep: string;
  enteredBy: string;
  reasonId: ReasonId;
  reason: string;
  remark: string;
  credit: number;
}

export interface ReasonReport {
  months: string[];
  total: ReasonTotal;
  typed: ReasonTotal;
  untyped: ReasonTotal;
  system: ReasonTotal;
  reasons: ReasonSummaryRow[];
  principals: ReasonGroupRow[];
  enteredBy: ReasonGroupRow[];
  reps: ReasonGroupRow[];
  customers: ReasonGroupRow[];
  customerCount: number;
  /** The largest credit notes of each reason group, largest first. */
  documents: ReasonDocument[];
}

export interface ReasonReportOptions {
  months: string[];
  /** Cut the customer list; omit for the page default, Infinity for the export. */
  topCustomers?: number;
  /** Documents kept per reason group; omit for the page default, Infinity for the export. */
  documentsPerReason?: number;
}

const DEFAULT_TOP_CUSTOMERS = 50;
const DEFAULT_DOCUMENTS_PER_REASON = 40;
/** A document's credit that nets to less than this is not a credit note worth counting. */
const NIL = 0.005;

interface Group {
  code?: string;
  name: string;
  credit: number;
  docs: Set<number>;
  untypedDocs: Set<number>;
  untypedCredit: number;
  byReason: Map<ReasonId, number>;
}

function addTo(groups: Map<string, Group>, key: string, name: string, row: ReasonRow, id: ReasonId, code?: string): void {
  let group = groups.get(key);
  if (!group) groups.set(key, (group = { code, name, credit: 0, docs: new Set(), untypedDocs: new Set(), untypedCredit: 0, byReason: new Map() }));
  group.credit += row.credit;
  group.docs.add(row.docEntry);
  group.byReason.set(id, (group.byReason.get(id) ?? 0) + row.credit);
  if (!hasTypedReason(id)) {
    group.untypedDocs.add(row.docEntry);
    group.untypedCredit += row.credit;
  }
}

function groupRows(groups: Map<string, Group>): ReasonGroupRow[] {
  return [...groups.values()]
    .map((group): ReasonGroupRow => {
      const typed = [...group.byReason].filter(([id]) => hasTypedReason(id)).sort((a, b) => b[1] - a[1]);
      return {
        name: group.name,
        ...(group.code === undefined ? {} : { code: group.code }),
        credit: group.credit,
        documents: group.docs.size,
        typedShare: group.credit > 0 ? ((group.credit - group.untypedCredit) / group.credit) * 100 : 0,
        untypedDocuments: group.untypedDocs.size,
        untypedCredit: group.untypedCredit,
        topReason: typed.length > 0 ? reasonLabel(typed[0][0]) : "",
        byReason: Object.fromEntries(group.byReason),
      };
    })
    .sort((a, b) => b.credit - a.credit || a.name.localeCompare(b.name));
}

export function buildReasonReport(rows: ReasonRow[], options: ReasonReportOptions): ReasonReport {
  const months = Array.from(new Set(options.months)).sort();
  const monthIndex = new Map(months.map((month, index) => [month, index]));

  const principals = new Map<string, Group>();
  const enteredBy = new Map<string, Group>();
  const reps = new Map<string, Group>();
  const customers = new Map<string, Group>();
  const reasons = new Map<ReasonId, { credit: number; docs: Set<number>; customers: Set<string>; principals: Map<string, number>; m: number[] }>();
  const documents = new Map<number, ReasonDocument & { principalSet: Set<string> }>();
  const classified = new Map<number, { id: ReasonId; typed: string }>();

  for (const row of rows) {
    const index = monthIndex.get(row.date.slice(0, 7));
    if (index === undefined || Math.abs(row.credit) < NIL) continue;
    let reason = classified.get(row.docEntry);
    if (!reason) classified.set(row.docEntry, (reason = classifyReason(row.remarks)));
    const { id, typed } = reason;

    addTo(principals, row.principal, row.principal, row, id);
    addTo(enteredBy, row.enteredBy, row.enteredBy, row, id);
    addTo(reps, row.rep, row.rep, row, id);
    addTo(customers, row.customerCode, row.customerName || row.customerCode, row, id, row.customerCode);

    let entry = reasons.get(id);
    if (!entry) reasons.set(id, (entry = { credit: 0, docs: new Set(), customers: new Set(), principals: new Map(), m: months.map(() => 0) }));
    entry.credit += row.credit;
    entry.docs.add(row.docEntry);
    entry.customers.add(row.customerCode);
    entry.principals.set(row.principal, (entry.principals.get(row.principal) ?? 0) + row.credit);
    entry.m[index] += row.credit;

    let document = documents.get(row.docEntry);
    if (!document) {
      documents.set(row.docEntry, (document = {
        docNum: row.docNum, date: row.date, customerCode: row.customerCode, customerName: row.customerName, principal: "", rep: row.rep, enteredBy: row.enteredBy,
        reasonId: id, reason: reasonLabel(id), remark: typed, credit: 0, principalSet: new Set(),
      }));
    }
    document.credit += row.credit;
    document.principalSet.add(row.principal);
  }

  const total: ReasonTotal = { credit: 0, documents: documents.size };
  const typed: ReasonTotal = { credit: 0, documents: 0 };
  const untyped: ReasonTotal = { credit: 0, documents: 0 };
  const system: ReasonTotal = { credit: 0, documents: 0 };
  for (const [id, entry] of reasons) {
    total.credit += entry.credit;
    const bucket = hasTypedReason(id) ? typed : untyped;
    bucket.credit += entry.credit;
    bucket.documents += entry.docs.size;
    if (id === "system") {
      system.credit += entry.credit;
      system.documents += entry.docs.size;
    }
  }

  const reasonRows: ReasonSummaryRow[] = [...reasons]
    .map(([id, entry]) => ({
      id,
      label: reasonLabel(id),
      credit: entry.credit,
      documents: entry.docs.size,
      share: total.credit > 0 ? (entry.credit / total.credit) * 100 : 0,
      customers: entry.customers.size,
      topPrincipal: [...entry.principals].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      m: entry.m,
    }))
    .sort((a, b) => b.credit - a.credit);

  const perReason = options.documentsPerReason ?? DEFAULT_DOCUMENTS_PER_REASON;
  const kept = new Map<ReasonId, number>();
  const documentRows: ReasonDocument[] = [];
  for (const { principalSet, ...document } of [...documents.values()].sort((a, b) => b.credit - a.credit || a.docNum.localeCompare(b.docNum))) {
    const count = kept.get(document.reasonId) ?? 0;
    if (count >= perReason) continue;
    kept.set(document.reasonId, count + 1);
    documentRows.push({ ...document, principal: [...principalSet].sort().join(", ") });
  }

  const customerRows = groupRows(customers);
  return {
    months,
    total,
    typed,
    untyped,
    system,
    reasons: reasonRows,
    principals: groupRows(principals),
    enteredBy: groupRows(enteredBy),
    reps: groupRows(reps),
    customers: customerRows.slice(0, options.topCustomers ?? DEFAULT_TOP_CUSTOMERS),
    customerCount: customerRows.length,
    documents: documentRows,
  };
}
