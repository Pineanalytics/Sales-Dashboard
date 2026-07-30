-- One-time production backfill for RepCall. This mirrors classifySalesRole()
-- in scripts/db-bridge/active-outlets/transform.ts, including its Mars mixed-
-- basket handling. RepCall intentionally contains only the current month.
WITH corrected AS (
  SELECT
    id,
    CASE
      WHEN upper(btrim("employeeGroup")) = 'DSR' AND "employeeCode" IN ('1172', '1032') THEN 'Secondary Sales'
      WHEN upper(btrim("employeeGroup")) = 'TDR'
        AND EXISTS (
          SELECT 1
          FROM unnest(string_to_array(COALESCE("costCentresBought", ''), ',')) AS centre
          WHERE lower(btrim(centre)) LIKE 'mars%'
        ) THEN 'Secondary Sales'
      WHEN upper(btrim("employeeGroup")) IN ('DSR', 'TDR', 'KAMS', 'ADMIN') THEN 'Primary Sales'
      ELSE 'Secondary Sales'
    END AS "salesRole"
  FROM "RepCall"
), updated AS (
  UPDATE "RepCall" AS calls
  SET "salesRole" = corrected."salesRole"
  FROM corrected
  WHERE calls.id = corrected.id
    AND calls."salesRole" IS DISTINCT FROM corrected."salesRole"
  RETURNING 1
)
SELECT count(*) AS rows_reclassified FROM updated;
