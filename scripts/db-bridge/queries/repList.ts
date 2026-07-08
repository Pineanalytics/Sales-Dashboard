// Mirrors the "SAP_RepList" Power Query — trivial rep-code/rep-name lookup from
// OSLP, used only for cross-checking rep-name spellings, not for sales/stock rows.
import sql from "mssql";

export interface RepListRow {
  slpCode: number;
  slpName: string;
}

export async function fetchRepList(pool: sql.ConnectionPool): Promise<RepListRow[]> {
  const result = await pool.request().query<{ "Sales Rep Code": number; "Sales Employee": string }>(`
    SELECT
        T0.SlpCode AS [Sales Rep Code],
        T0.SlpName AS [Sales Employee]
    FROM OSLP T0
    WHERE
        T0.SlpName IS NOT NULL
        AND LTRIM(RTRIM(T0.SlpName)) <> ''
    ORDER BY
        T0.SlpName
  `);

  return result.recordset.map((r) => ({
    slpCode: r["Sales Rep Code"],
    slpName: r["Sales Employee"],
  }));
}
