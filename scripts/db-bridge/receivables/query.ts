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
}

export interface SapReceivableOpenItemRow {
  id: string;
  customerCode: string;
  documentRef: string | null;
  transactionType: number;
  postingDate: Date;
  dueDate: Date;
  openBalance: number;
}

/**
 * SAP is queried with the provisioned read-only login. JDT1.BalDueDeb and
 * BalDueCred are SAP's residual/unreconciled values, so this reports open
 * receivables without re-implementing payment matching in the dashboard.
 */
export async function fetchReceivables(pool: sql.ConnectionPool): Promise<{
  terms: SapCreditTermRow[];
  customers: SapCustomerCreditRow[];
  openItems: SapReceivableOpenItemRow[];
}> {
  const [termResult, customerResult, openItemResult] = await Promise.all([
    pool.request().query(`
      SELECT GroupNum, PymntGroup, ExtraDays, ExtraMonth
      FROM OCTG
    `),
    pool.request().query(`
      SELECT CardCode, CardName, ValidFor, CreditLine, Balance, GroupNum
      FROM OCRD
      WHERE CardType = 'C'
    `),
    pool.request().query(`
      SELECT
        CONCAT(J.TransId, ':', J.Line_ID) AS ItemId,
        J.ShortName AS CardCode,
        NULLIF(LTRIM(RTRIM(J.BaseRef)), '') AS DocumentRef,
        J.TransType,
        J.RefDate,
        J.DueDate,
        (J.BalDueDeb - J.BalDueCred) AS OpenBalance
      FROM JDT1 J
      INNER JOIN OCRD C ON C.CardCode = J.ShortName AND C.CardType = 'C'
      WHERE ABS(J.BalDueDeb - J.BalDueCred) > 0.005
    `),
  ]);

  return {
    terms: termResult.recordset.map((row) => ({
      groupNum: Number(row.GroupNum),
      name: String(row.PymntGroup || "(Not assigned)").trim() || "(Not assigned)",
      extraDays: Number(row.ExtraDays || 0),
      extraMonths: Number(row.ExtraMonth || 0),
    })),
    customers: customerResult.recordset.map((row) => ({
      customerCode: String(row.CardCode).trim(),
      customerName: String(row.CardName).trim(),
      active: String(row.ValidFor).toUpperCase() === "Y",
      creditLimit: Number(row.CreditLine || 0),
      masterBalance: Number(row.Balance || 0),
      termGroupNum: row.GroupNum === null || row.GroupNum === undefined ? null : Number(row.GroupNum),
    })),
    openItems: openItemResult.recordset.map((row) => ({
      id: String(row.ItemId),
      customerCode: String(row.CardCode).trim(),
      documentRef: row.DocumentRef ? String(row.DocumentRef).trim() : null,
      transactionType: Number(row.TransType),
      postingDate: new Date(row.RefDate),
      dueDate: new Date(row.DueDate),
      openBalance: Number(row.OpenBalance),
    })),
  };
}
