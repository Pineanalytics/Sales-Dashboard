// SAP item master: every item (OITM) with its item group (OITB), manufacturer (OMRC), preferred vendor (OITM.CardCode -> OCRD) and its
// price on the first "Selling" and first "Purchase" price list (ITM1 / OPLN). SELECT only. The same query as the Product Master extract
// (Product_Query.py) that used to be run by hand and saved to D:\SAP Extraction.
import type sql from "mssql";
import type { SapItemMasterRow } from "../../../lib/sapItemMaster";

export const ITEM_MASTER_QUERY = `
SELECT
    T0.ItemCode, T0.ItemName, T0.FrgnName,
    T0.ItmsGrpCod, T1.ItmsGrpNam,
    T0.FirmCode, T2.FirmName,
    T0.InvntryUom, T0.SalUnitMsr, T0.BuyUnitMsr,
    T0.NumInSale, T0.NumInBuy,
    T0.OnHand, T0.IsCommited, T0.OnOrder,
    T0.AvgPrice, T0.LastPurPrc,
    T0.CardCode, T3.CardName,
    T0.ValidFor, T0.FrozenFor,
    T0.CreateDate, T0.UpdateDate,
    P1.Price AS SellingPrice, P1.Currency AS SellingCurrency,
    P2.Price AS PurchasePrice, P2.Currency AS PurchaseCurrency
FROM OITM T0
LEFT JOIN OITB T1 ON T0.ItmsGrpCod = T1.ItmsGrpCod
LEFT JOIN OMRC T2 ON T0.FirmCode = T2.FirmCode
LEFT JOIN OCRD T3 ON T3.CardCode = T0.CardCode
LEFT JOIN ITM1 P1 ON T0.ItemCode = P1.ItemCode
    AND P1.PriceList = (SELECT TOP 1 ListNum FROM OPLN WHERE ListName LIKE '%Selling%' ORDER BY ListNum)
LEFT JOIN ITM1 P2 ON T0.ItemCode = P2.ItemCode
    AND P2.PriceList = (SELECT TOP 1 ListNum FROM OPLN WHERE ListName LIKE '%Purchase%' ORDER BY ListNum)
WHERE T0.ItemCode IS NOT NULL
ORDER BY T0.ItemCode
`;

export async function fetchItemMaster(pool: sql.ConnectionPool): Promise<SapItemMasterRow[]> {
  const result = await pool.request().query<SapItemMasterRow>(ITEM_MASTER_QUERY);
  return result.recordset;
}
