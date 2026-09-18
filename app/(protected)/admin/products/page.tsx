import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getProductMappingSuggestions } from "@/lib/productMappingSuggestions";
import { createProductAction, updateProductAction, deleteProductAction, uploadProductsAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass =
  "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const labelClass = "text-[13px] font-medium text-muted-strong";

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string; add?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const params = await searchParams;
  const { error, success, edit } = params;
  const [products, suggestions] = await Promise.all([
    prisma.product.findMany({ orderBy: { itemNo: "asc" } }),
    getProductMappingSuggestions(),
  ]);
  const editing = edit ? products.find((p) => p.id === edit) : undefined;
  const addingSuggestion = params.add ? suggestions.find((suggestion) => suggestion.itemNo === params.add) : undefined;
  const classifications = Array.from(new Set(products.map((product) => product.classification?.trim()).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(11,61,53,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Product Master</h1>
        <p className="mt-1 text-sm text-white/70">Item → principal/pack-size reference data used by the SAP sales bridge. Unidentified SAP products remain review-only until mapped here.</p>
      </div>

      <div className="max-w-7xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        <datalist id="product-classifications">
          {classifications.map((classification) => <option key={classification} value={classification} />)}
        </datalist>
        {error ? (
          <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {success}
          </p>
        ) : null}

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-blue-soft text-primary-blue">
              <UploadIcon />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-primary-blue">Update product master</h2>
              <p className="mt-1 text-[13px] text-muted">
                Download, edit, and re-upload the CSV or Products workbook. Existing Item No. rows update in place; new items and product-principal mappings are added without deleting older rows.
              </p>
            </div>
          </div>
          <form action={uploadProductsAction} className="mt-4 flex flex-wrap items-center gap-4">
            <input
              type="file"
              name="file"
              accept=".csv,.xlsx,.xls,.xlsm"
              required
              className="min-w-0 text-sm text-foreground file:mr-4 file:rounded-full file:border-0 file:bg-background-elevated file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-blue hover:file:bg-accent-blue-soft"
            />
            <button type="submit" className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
              <UploadIcon />
              Upload product master
            </button>
            <a href="/api/products/export" className="inline-flex items-center rounded-full border border-secondary-blue/30 bg-surface px-5 py-3 text-sm font-semibold text-primary-blue hover:bg-accent-blue-soft">
              Download CSV
            </a>
          </form>
        </div>

        {suggestions.length > 0 ? <section className="overflow-hidden rounded-2xl border border-accent-amber/30 bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-amber">SAP mapping worklist</p>
              <h2 className="mt-1 text-lg font-semibold text-primary-blue">Unidentified products with sales activity</h2>
              <p className="mt-1 max-w-3xl text-[13px] text-muted">These item codes are in SAP sales but cannot yet be assigned to a dashboard principal. A code-prefix suggestion pre-fills the review form; it is never applied automatically. Branches shown are observed sales locations from warehouse mappings. After approval, run the controlled Sales backfill to include earlier months in mapped dashboard sales.</p>
            </div>
            <span className="rounded-full bg-accent-amber-soft px-3 py-1 text-xs font-semibold text-accent-amber">{suggestions.length} to review</span>
          </div>
          <div className="overflow-x-auto border-t border-border/60">
            <table className="w-full min-w-[1120px] border-collapse text-sm">
              <thead className="bg-background-elevated text-[12px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-3 text-left font-medium">SAP item</th><th className="px-4 py-3 text-left font-medium">Observed months</th><th className="px-4 py-3 text-left font-medium">Branches</th><th className="px-4 py-3 text-right font-medium">SAP revenue</th><th className="px-4 py-3 text-right font-medium">Gross margin</th><th className="px-4 py-3 text-right font-medium">Quantity</th><th className="px-4 py-3 text-left font-medium">Suggested principal</th><th className="px-4 py-3 text-right font-medium">Action</th></tr></thead>
              <tbody>{suggestions.map((suggestion) => <tr key={suggestion.itemNo}>
                <td className="max-w-[310px] border-b border-border/60 px-4 py-3"><p className="font-semibold text-brand-navy">{suggestion.itemNo}</p><p className="mt-0.5 text-xs text-muted">{suggestion.itemDescription}</p></td>
                <td className="border-b border-border/60 px-4 py-3 text-xs">{suggestion.months.join(", ")}</td>
                <td className="border-b border-border/60 px-4 py-3 text-xs">{suggestion.branches.join(", ") || "Warehouse not mapped"}</td>
                <td className="border-b border-border/60 px-4 py-3 text-right font-medium">{suggestion.revenue.toLocaleString("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 })}</td>
                <td className="border-b border-border/60 px-4 py-3 text-right">{suggestion.grossMargin.toLocaleString("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 })}</td>
                <td className="border-b border-border/60 px-4 py-3 text-right">{suggestion.quantity.toLocaleString("en-KE", { maximumFractionDigits: 0 })}</td>
                <td className="max-w-[270px] border-b border-border/60 px-4 py-3"><p className="font-medium text-secondary-blue">{suggestion.suggestedPrincipal ?? "No safe suggestion"}</p><p className="mt-0.5 text-[11px] leading-snug text-muted">{suggestion.suggestionReason}</p></td>
                <td className="border-b border-border/60 px-4 py-3 text-right"><Link href={`/admin/products?add=${encodeURIComponent(suggestion.itemNo)}`} className="inline-flex rounded-full border border-secondary-blue/30 bg-surface px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">Review and map</Link></td>
              </tr>)}</tbody>
            </table>
          </div>
        </section> : <section className="rounded-2xl border border-accent-green/30 bg-surface p-5 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">No unidentified SAP product sales are awaiting Product Master mapping.</section>}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-primary-blue">{addingSuggestion ? `Review SAP product: ${addingSuggestion.itemNo}` : "Add a product"}</h2>{addingSuggestion ? <p className="mt-1 text-[13px] text-muted">{addingSuggestion.itemDescription} · {addingSuggestion.revenue.toLocaleString("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 })} SAP revenue across {addingSuggestion.months.join(", ")}. {addingSuggestion.suggestionReason} SAP pack size and current net purchase price are prefilled when available; SAP pack/UOM detail is offered as an editable Size starting point.</p> : null}</div>{addingSuggestion ? <Link href="/admin/products" className="rounded-full px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">Cancel review</Link> : null}</div>
          <form action={createProductAction} className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Item No.</label>
              <input name="itemNo" required defaultValue={addingSuggestion?.itemNo ?? ""} className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Item description</label>
              <input name="itemDescription" defaultValue={addingSuggestion?.itemDescription ?? ""} className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Series</label>
              <input name="series" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Size</label>
              <input name="size" defaultValue={addingSuggestion?.packDetail ?? ""} className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Principal</label>
              <input name="principal" required defaultValue={addingSuggestion?.suggestedPrincipal ?? ""} className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Classification</label>
              <input name="classification" list="product-classifications" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Pack size</label>
              <input name="packSize" type="number" step="any" defaultValue={addingSuggestion?.packSize ?? ""} className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Cost price (SAP net)</label>
              <input name="costPrice" type="number" step="any" defaultValue={addingSuggestion?.costPrice ?? ""} className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>SSU conversion</label>
              <input name="ssuConversion" type="number" step="any" className={inputClass} />
            </div>
            <div className="sm:col-span-3">
              <button
                type="submit"
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Add product
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0">
            <h2 className="text-lg font-semibold text-primary-blue">Products ({products.length})</h2>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Item No.</th>
                  <th className="px-6 py-3 text-left font-medium">Description</th>
                  <th className="px-6 py-3 text-left font-medium">Principal</th>
                  <th className="px-6 py-3 text-left font-medium">Classification</th>
                  <th className="px-6 py-3 text-right font-medium">Pack size</th>
                  <th className="px-6 py-3 text-right font-medium">Cost price</th>
                  <th className="px-6 py-3 text-right font-medium">SSU conv.</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) =>
                  editing?.id === p.id ? (
                    <tr key={p.id} className="bg-accent-blue-soft/40">
                      <td colSpan={8} className="px-6 py-4 border-b border-border/60">
                        <form action={updateProductAction} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                          <input type="hidden" name="productId" value={p.id} />
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Item No.</label>
                            <input value={p.itemNo} disabled className={inputClass + " opacity-60"} />
                          </div>
                          <div className="flex flex-col gap-1 sm:col-span-2">
                            <label className={labelClass}>Item description</label>
                            <input name="itemDescription" defaultValue={p.itemDescription ?? ""} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Series</label>
                            <input name="series" defaultValue={p.series ?? ""} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Size</label>
                            <input name="size" defaultValue={p.size ?? ""} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Principal</label>
                            <input name="principal" defaultValue={p.principal} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Classification</label>
                            <input name="classification" list="product-classifications" defaultValue={p.classification ?? ""} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Pack size</label>
                            <input name="packSize" type="number" step="any" defaultValue={p.packSize ?? ""} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Cost price</label>
                            <input name="costPrice" type="number" step="any" defaultValue={p.costPrice ?? ""} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>SSU conversion</label>
                            <input name="ssuConversion" type="number" step="any" defaultValue={p.ssuConversion ?? ""} className={inputClass} />
                          </div>
                          <div className="flex gap-2">
                            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                              Save
                            </button>
                            <Link href="/admin/products" className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
                              Cancel
                            </Link>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={p.id}>
                      <td className="px-6 py-3 border-b border-border/60 font-medium">{p.itemNo}</td>
                      <td className="max-w-[320px] px-6 py-3 border-b border-border/60">{p.itemDescription || "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60">{p.principal || "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60">{p.classification || "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{p.packSize ?? "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{p.costPrice ?? "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{p.ssuConversion ?? "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right whitespace-nowrap">
                        <Link href={`/admin/products?edit=${p.id}`} className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300">
                          Edit
                        </Link>
                        <form action={deleteProductAction} className="inline">
                          <input type="hidden" name="productId" value={p.id} />
                          <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300">
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                )}
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-muted">
                      No products yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
