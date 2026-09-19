import { describe, expect, it } from "vitest";
import { isDestructiveSql } from "../scripts/check-schema-safety.mjs";

describe("isDestructiveSql", () => {
  it("does not flag DROP NOT NULL (relaxing a constraint, no data loss)", () => {
    expect(isDestructiveSql('ALTER TABLE "UpfieldVisit" ALTER COLUMN "fsr" DROP NOT NULL;')).toBe(false);
  });

  it("does not flag DROP DEFAULT (removing a default value, no data loss)", () => {
    expect(isDestructiveSql('ALTER TABLE "Foo" ALTER COLUMN "bar" DROP DEFAULT;')).toBe(false);
  });

  it("still flags DROP TABLE", () => {
    expect(isDestructiveSql('DROP TABLE "Foo";')).toBe(true);
  });

  it("still flags DROP COLUMN", () => {
    expect(isDestructiveSql('ALTER TABLE "Foo" DROP COLUMN "bar";')).toBe(true);
  });

  it("still flags DROP CONSTRAINT", () => {
    expect(isDestructiveSql('ALTER TABLE "Foo" DROP CONSTRAINT "Foo_pkey";')).toBe(true);
  });

  it("still flags TRUNCATE", () => {
    expect(isDestructiveSql('TRUNCATE TABLE "Foo";')).toBe(true);
  });

  it("does not flag an empty or additive-only diff", () => {
    expect(isDestructiveSql("")).toBe(false);
    expect(isDestructiveSql('ALTER TABLE "Foo" ADD COLUMN "bar" TEXT;')).toBe(false);
  });

  it("a diff mixing a safe DROP NOT NULL with a real destructive statement is still flagged", () => {
    const sql = 'ALTER TABLE "Foo" ALTER COLUMN "bar" DROP NOT NULL;\nDROP TABLE "Baz";';
    expect(isDestructiveSql(sql)).toBe(true);
  });
});
