"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownload20Regular, Dismiss16Regular } from "@fluentui/react-icons";
import { DSR_EXTRACT_MAX_DAYS } from "@/lib/eablDsrExtractLimits";

interface DsrMeta {
  min_date?: string;
  max_date?: string;
  salesmen?: string[];
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The full DSR extract: a button in the DSR toolbar that opens a small form (dates, salesman) and downloads one workbook with every DSR section. */
export function EablDsrExtractMenu() {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<DsrMeta | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [salesman, setSalesman] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // The date bounds and the salesman list come from the DSR service, the first time the form opens. The range starts as this month so far.
  useEffect(() => {
    if (!open || meta) return;
    const controller = new AbortController();
    fetch("/api/eabl-dsr-review/dsr/meta", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<DsrMeta>) : Promise.reject(new Error())))
      .then((body) => {
        setMeta(body);
        const latest = body.max_date ?? ymd(new Date());
        const monthStart = `${latest.slice(0, 7)}-01`;
        setEnd((current) => current || latest);
        setStart((current) => current || (body.min_date && monthStart < body.min_date ? body.min_date : monthStart));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setMeta({});
        const today = new Date();
        setEnd((current) => current || ymd(today));
        setStart((current) => current || ymd(new Date(today.getFullYear(), today.getMonth(), 1)));
      });
    return () => controller.abort();
  }, [open, meta]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onPointer = (event: PointerEvent) => { if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const days = start && end ? Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1 : 0;
  const problem = !start || !end ? "Pick both dates." : days < 1 ? "The end date is before the start date." : days > DSR_EXTRACT_MAX_DAYS ? `Pick at most ${DSR_EXTRACT_MAX_DAYS} days (you picked ${days}).` : null;

  async function download() {
    if (problem || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({ start, end });
      if (salesman) query.set("salesman", salesman);
      const response = await fetch(`/api/eabl-dsr-extract?${query}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "The extract could not be built.");
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? `eabl-dsr-${start}-to-${end}.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(`Downloaded ${name}`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 block w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-brand-navy";
  return <div ref={panel} className="relative shrink-0">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" title="Download the full DSR analysis as one Excel workbook" className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-primary-blue/40 bg-accent-blue-soft px-3 py-1.5 text-xs font-semibold text-primary-blue transition-colors hover:bg-primary-blue hover:text-white"><ArrowDownload20Regular className="h-4 w-4" />Full DSR extract</button>
    {open ? <div role="dialog" aria-label="Full DSR extract" className="absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-4 shadow-[0_12px_32px_rgba(11,61,53,0.18)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-brand-navy">Full DSR extract</h2>
          <p className="mt-0.5 text-[11px] text-muted">One workbook: summary, salesmen, daily trend, brands, customers, outlets, every call, strike rates, odometer, unsold stock and sign-off.</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-background-elevated"><Dismiss16Regular className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-muted">From<input type="date" value={start} min={meta?.min_date} max={meta?.max_date} onChange={(event) => setStart(event.target.value)} className={field} /></label>
        <label className="text-xs font-semibold text-muted">To<input type="date" value={end} min={meta?.min_date} max={meta?.max_date} onChange={(event) => setEnd(event.target.value)} className={field} /></label>
      </div>
      <label className="mt-3 block text-xs font-semibold text-muted">Salesman
        <select value={salesman} onChange={(event) => setSalesman(event.target.value)} className={field}>
          <option value="">All salesmen</option>
          {(meta?.salesmen ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <p className={`mt-3 text-[11px] ${problem ? "text-accent-red" : "text-muted"}`}>{problem ?? `${days} day${days === 1 ? "" : "s"} selected (up to ${DSR_EXTRACT_MAX_DAYS}).`}</p>
      <button type="button" onClick={download} disabled={Boolean(problem) || busy} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-blue px-3 py-2 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"><ArrowDownload20Regular className="h-4 w-4" />{busy ? "Building the workbook..." : "Download Excel"}</button>
      {message ? <p role="status" className="mt-2 text-[11px] text-brand-navy">{message}</p> : null}
    </div> : null}
  </div>;
}
