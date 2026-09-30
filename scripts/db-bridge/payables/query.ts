import type sql from "mssql";

export interface SapPayableOpenItemRow {
  id: string;
  vendorCode: string;
  vendorName: string;
  documentRef: string | null;
  transactionType: number;
  postingDate: Date;
  dueDate: Date;
  openBalance: number;
}

/**
 * SAP is queried with the same provisioned read-only login as Receivables.
 * Vendors are OCRD rows with CardType = 'S'. JDT1's BalDueCred/BalDueDeb are
 * the mirror image of the customer side: for a vendor (a credit-normal
 * liability), the amount Pinefrost owes is BalDueCred - BalDueDeb, not
 * BalDueDeb - BalDueCred — confirmed against live SAP data before shipping
 * this (see the finance-module session notes), not assumed from symmetry.
 */
export async function fetchPayables(pool: sql.ConnectionPool): Promise<{
  openItems: SapPayableOpenItemRow[];
}> {
  const openItemResult = await pool.request().query(`
    SELECT
      CONCAT(J.TransId, ':', J.Line_ID) AS ItemId,
      J.ShortName AS CardCode,
      C.CardName,
      NULLIF(LTRIM(RTRIM(J.BaseRef)), '') AS DocumentRef,
      J.TransType,
      J.RefDate,
      J.DueDate,
      (J.BalDueCred - J.BalDueDeb) AS OpenBalance
    FROM JDT1 J
    INNER JOIN OCRD C ON C.CardCode = J.ShortName AND C.CardType = 'S'
    WHERE ABS(J.BalDueDeb - J.BalDueCred) > 0.005
  `);

  return {
    openItems: openItemResult.recordset.map((row) => ({
      id: String(row.ItemId),
      vendorCode: String(row.CardCode).trim(),
      vendorName: String(row.CardName).trim(),
      documentRef: row.DocumentRef ? String(row.DocumentRef).trim() : null,
      transactionType: Number(row.TransType),
      postingDate: new Date(row.RefDate),
      dueDate: new Date(row.DueDate),
      openBalance: Number(row.OpenBalance),
    })),
  };
}
