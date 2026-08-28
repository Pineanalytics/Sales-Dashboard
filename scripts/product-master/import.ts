import { readFile } from "node:fs/promises";
import { prisma } from "../../lib/db";
import { parseProductsWorkbook } from "../../lib/parseProducts";
import { importProductMaster } from "../../lib/productMasterImport";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Usage: npm run product-master:import -- <ProductMasterData.xlsx>");

try {
  const file = await readFile(sourcePath);
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  const rows = parseProductsWorkbook(buffer);
  const result = await importProductMaster(rows);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}
