"use client";

import { useState, useTransition } from "react";
import { createFeedKeyAction, revokeFeedKeyAction } from "@/app/(protected)/admin/dataset/actions";
import { DATA_FEEDS } from "@/lib/dataFeedScript";
import { AdminBadge, AdminCard } from "@/components/admin/AdminPage";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";

export interface FeedKeyRow {
  id: string;
  name: string;
  feed: string;
  keyPrefix: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }) : "—");

/** Live data feeds: keys that let an Excel workbook (Power Query, e.g. on SharePoint) pull a feed straight from the dashboard, and the ready-made
 *  script for each. A key is shown once, when it is made. */
export function DataFeedsPanel({ keys }: { keys: FeedKeyRow[] }) {
  const [name, setName] = useState("SharePoint Outlet Master");
  const [feedId, setFeedId] = useState(DATA_FEEDS[0].id);
  const feed = DATA_FEEDS.find((item) => item.id === feedId) ?? DATA_FEEDS[0];
  const [period, setPeriod] = useState(feed.defaultPeriod);
  const [created, setCreated] = useState<{ key: string; script: string; feedLabel: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      setError(null);
      setCopied(false);
      const result = await createFeedKeyAction({ name, feed: feedId, period });
      if (result.ok) setCreated({ key: result.key, script: result.script, feedLabel: result.feedLabel });
      else setError(result.error);
    });

  const download = () => {
    if (!created) return;
    const url = URL.createObjectURL(new Blob([created.script], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${feed.id}-power-query.pq`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const input = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-secondary-blue";
  const active = keys.filter((key) => !key.revokedAt);

  return (
    <AdminCard
      title={<>Live data feeds <AdminBadge>{active.length} active key{active.length === 1 ? "" : "s"}</AdminBadge></>}
      description="Let an Excel workbook (for example the Outlet Master on SharePoint) pull data straight from the dashboard and refresh itself. Each key works for one feed; revoke it and every workbook using it stops refreshing."
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted sm:col-span-3">
              Key name (who or what uses it)
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted sm:col-span-2">
              Feed
              <select value={feedId} onChange={(event) => { setFeedId(event.target.value); setPeriod(DATA_FEEDS.find((item) => item.id === event.target.value)?.defaultPeriod ?? period); }} className={input}>
                {DATA_FEEDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted">
              Default period
              <select value={period} onChange={(event) => setPeriod(event.target.value)} className={input}>
                {feed.periods.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">{feed.description} Columns: {feed.defaultColumns.map((column) => feed.defaultRenames[column] ?? column).join(", ")}.</p>
          <div>
            <button type="button" onClick={create} disabled={pending} className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow disabled:opacity-60">
              {pending ? "Creating…" : "Create key and script"}
            </button>
          </div>
          {error ? <p className="text-sm text-accent-red">{error}</p> : null}

          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-background-elevated text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Key</th>
                  <th className="px-3 py-2 text-left font-medium">Last used</th>
                  <th className="px-3 py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className={key.revokedAt ? "opacity-50" : undefined}>
                    <td className="border-b border-border/60 px-3 py-2">
                      <span className="block font-semibold text-brand-navy">{key.name}</span>
                      <span className="block text-[11px] text-muted">
                        {DATA_FEEDS.find((item) => item.id === key.feed)?.label ?? key.feed} · {key.keyPrefix}… · created {fmt(key.createdAt)} by {key.createdBy}
                      </span>
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 text-xs text-muted-strong">{key.revokedAt ? `Revoked ${fmt(key.revokedAt)}` : fmt(key.lastUsedAt)}</td>
                    <td className="border-b border-border/60 px-3 py-2 text-right">
                      {key.revokedAt ? null : (
                        <form action={revokeFeedKeyAction}>
                          <input type="hidden" name="id" value={key.id} />
                          <ConfirmSubmitButton confirmMessage={`Revoke “${key.name}”? Every workbook using this key stops refreshing at once.`} className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft">
                            Revoke
                          </ConfirmSubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
                {keys.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-xs text-muted">No feed keys yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {created ? (
            <>
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <strong>Copy this now: the key is shown only once.</strong> It is inside the script below. Anyone holding a workbook with this script can read the feed, so share the workbook, not the script, and revoke the key if it leaks.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(created.script).then(() => setCopied(true)); }}
                  className="rounded-full bg-primary-blue px-4 py-2 text-xs font-semibold text-white hover:bg-secondary-blue"
                >
                  {copied ? "Copied" : "Copy script"}
                </button>
                <button type="button" onClick={download} className="rounded-full border border-secondary-blue/30 px-4 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
                  Download script (.pq)
                </button>
              </div>
              <textarea readOnly value={created.script} aria-label="Power Query script" className="h-72 w-full rounded-xl border border-border bg-background-elevated p-3 font-mono text-[11px] leading-relaxed text-foreground" />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted">Create a key to get its ready-made Power Query script here.</div>
          )}
          <details className="rounded-xl border border-border/70 bg-background-elevated/40 px-4 py-3 text-xs text-muted-strong">
            <summary className="cursor-pointer font-semibold text-primary-blue">Set up the workbook (about 2 minutes, once)</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>In Excel (desktop): <strong>Data → Get Data → From Other Sources → Blank Query</strong>.</li>
              <li>In the Power Query editor: <strong>Advanced Editor</strong>, select everything, paste the script, <strong>Done</strong>. If asked how to connect, choose <strong>Anonymous</strong> and <strong>Connect</strong> (the key travels in the script&apos;s header).</li>
              <li>Name the query (e.g. <em>Outlet Master Data</em>), then <strong>Close &amp; Load</strong>: the rows land in a table on a new sheet.</li>
              <li><strong>Data → Queries &amp; Connections</strong>, right-click the query, <strong>Properties</strong>: tick <strong>Refresh data when opening the file</strong> and <strong>Refresh every 60 minutes</strong>.</li>
              <li>Save the workbook to the SharePoint folder and share it as before. Opened in desktop Excel, it pulls the latest data on open and every hour.</li>
              <li>To change the period, columns or names: <strong>Advanced Editor</strong>, edit <code>Period</code>, <code>Columns</code> or <code>Renames</code> at the top.</li>
            </ol>
          </details>
        </div>
      </div>
    </AdminCard>
  );
}
