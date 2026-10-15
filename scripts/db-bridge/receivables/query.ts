import type sql from "mssql";

export interface SapCreditTermRow {
  groupNum: number;
  name: string;
  extraDays: number;
  extraMonths: number;
}

export interface SapCustomerCreditRow {
  customerCode: string;
  customerName: string;
  active: boolean;
  creditLimit: number;
  masterBalance: number;
  termGroupNum: number | null;
  // The Global Ageing report's "Property" (lib/globalAgeing.ts) — see the
  // query below's propertyResult for how this is resolved.
  principal: string | null;
}

export interface SapReceivableOpenItemRow {
  id: string;
  customerCode: string;
  documentRef: string | null;
  transactionType: number;
  postingDate: Date;
  dueDate: Date;
  // JDT1.TaxDate — see ReceivableOpenItem.taxDate's schema comment.
  taxDate: Date | null;
  openBalance: number;
}

/**
 * SAP is queried with the provisioned read-only login. JDT1.BalDueDeb and
 * BalDueCred are SAP's residual/unreconciled values, so this reports open
 * receivables without re-implementing payment matching in the dashboard.
 */
// Resolves each customer's Global Ageing "Property" from OCRD's 64 QryGroup
// boolean flags joined to OCQG's group names — the same mechanism the
// business's own ageing query uses. Ranked per CardCode (lowest matching
// group number wins) so a customer with more than one flag set still
// produces exactly one row rather than silently duplicating that customer's
// balance across two properties.
const PROPERTY_QUERY = `
  WITH PropertyFlags AS (
    ${Array.from({ length: 64 }, (_, i) => `SELECT CardCode, ${i + 1} AS PrpCode FROM OCRD WHERE QryGroup${i + 1} = 'Y'`).join("\n    UNION ALL\n    ")}
  ),
  RankedProperties AS (
    SELECT CardCode, PrpCode, ROW_NUMBER() OVER (PARTITION BY CardCode ORDER BY PrpCode) AS rn
    FROM PropertyFlags
  )
  SELECT R.CardCode, G.GroupName AS Principal
  FROM RankedProperties R
  INNER JOIN OCQG G ON G.GroupCode = R.PrpCode
  WHERE R.rn = 1
`;

export async function fetchReceivables(pool: sql.ConnectionPool): Promise<{
  terms: SapCreditTermRow[];
  customers: SapCustomerCreditRow[];
  openItems: SapReceivableOpenItemRow[];
}> {
  const [termResult, customerResult, propertyResult, openItemResult] = await Promise.all([
    pool.request().query(`
      SELECT GroupNum, PymntGroup, ExtraDays, ExtraMonth
      FROM OCTG
    `),
    pool.request().query(`
      SELECT CardCode, CardName, ValidFor, CreditLine, Balance, GroupNum
      FROM OCRD
      WHERE CardType = 'C'
    `),
    pool.request().query(PROPERTY_QUERY),
    pool.request().query(`
      SELECT
        CONCAT(J.TransId, ':', J.Line_ID) AS ItemId,
        J.ShortName AS CardCode,
        NULLIF(LTRIM(RTRIM(J.BaseRef)), '') AS DocumentRef,
        J.TransType,
        J.RefDate,
        J.DueDate,
        J.TaxDate,
        (J.BalDueDeb - J.BalDueCred) AS OpenBalance
      FROM JDT1 J
      INNER JOIN OCRD C ON C.CardCode = J.ShortName AND C.CardType = 'C'
      WHERE ABS(J.BalDueDeb - J.BalDueCred) > 0.005
    `),
  ]);

  const principalByCustomer = new Map<string, string>();
  for (const row of propertyResult.recordset) {
    principalByCustomer.set(String(row.CardCode).trim(), String(row.Principal).trim());
  }

  return {
    terms: termResult.recordset.map((row) => ({
      groupNum: Number(row.GroupNum),
      name: String(row.PymntGroup || "(Not assigned)").trim() || "(Not assigned)",
      extraDays: Number(row.ExtraDays || 0),
      extraMonths: Number(row.ExtraMonth || 0),
    })),
    customers: customerResult.recordset.map((row) => {
      const customerCode = String(row.CardCode).trim();
      return {
        customerCode,
        customerName: String(row.CardName).trim(),
        active: String(row.ValidFor).toUpperCase() === "Y",
        creditLimit: Number(row.CreditLine || 0),
        masterBalance: Number(row.Balance || 0),
        termGroupNum: row.GroupNum === null || row.GroupNum === undefined ? null : Number(row.GroupNum),
        principal: principalByCustomer.get(customerCode) ?? null,
      };
    }),
    openItems: openItemResult.recordset.map((row) => ({
      id: String(row.ItemId),
      customerCode: String(row.CardCode).trim(),
      documentRef: row.DocumentRef ? String(row.DocumentRef).trim() : null,
      transactionType: Number(row.TransType),
      postingDate: new Date(row.RefDate),
      dueDate: new Date(row.DueDate),
      taxDate: row.TaxDate ? new Date(row.TaxDate) : null,
      openBalance: Number(row.OpenBalance),
    })),
  };
}
