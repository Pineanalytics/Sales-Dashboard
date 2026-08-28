BEGIN;

-- Recoverable copy of the two non-canonical 2026 historical imports. The
-- canonical SAP item/customer rows were created on 14 August and reconcile to
-- SalesRecord; the 16/25 August imports layered legacy snapshot grain on top.
CREATE TABLE IF NOT EXISTS "BrandCustomerActualRepairBackup_20260828" AS
SELECT * FROM "BrandCustomerActual" WITH NO DATA;

INSERT INTO "BrandCustomerActualRepairBackup_20260828"
SELECT source.*
FROM "BrandCustomerActual" source
WHERE source.year = '2026'
  AND source."monthIndex" <= 6
  AND (
    (source."createdAt" >= TIMESTAMP '2026-08-16' AND source."createdAt" < TIMESTAMP '2026-08-17')
    OR (source."createdAt" >= TIMESTAMP '2026-08-25' AND source."createdAt" < TIMESTAMP '2026-08-26')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "BrandCustomerActualRepairBackup_20260828" backup
    WHERE backup.id = source.id
  );

DELETE FROM "BrandCustomerActual"
WHERE year = '2026'
  AND "monthIndex" <= 6
  AND (
    ("createdAt" >= TIMESTAMP '2026-08-16' AND "createdAt" < TIMESTAMP '2026-08-17')
    OR ("createdAt" >= TIMESTAMP '2026-08-25' AND "createdAt" < TIMESTAMP '2026-08-26')
  );

DO $$
DECLARE mismatch_count integer;
BEGIN
  SELECT COUNT(*) INTO mismatch_count
  FROM (
    SELECT sales.year, sales."monthIndex",
           ABS(SUM(sales.revenue) - COALESCE(customer.revenue, 0)) AS variance
    FROM "SalesRecord" sales
    LEFT JOIN (
      SELECT year, "monthIndex", SUM(revenue) AS revenue
      FROM "BrandCustomerActual"
      WHERE year = '2026' AND "monthIndex" <= 6
      GROUP BY year, "monthIndex"
    ) customer USING (year, "monthIndex")
    WHERE sales.year = '2026' AND sales."monthIndex" <= 6
    GROUP BY sales.year, sales."monthIndex", customer.revenue
  ) reconciliation
  WHERE reconciliation.variance > 10;

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Brand/customer repair failed reconciliation for % month(s)', mismatch_count;
  END IF;
END $$;

COMMIT;

SELECT year, "monthIndex", ROUND(SUM(revenue)::numeric, 0) AS customer_revenue
FROM "BrandCustomerActual"
WHERE year = '2026' AND "monthIndex" <= 6
GROUP BY year, "monthIndex"
ORDER BY "monthIndex";
