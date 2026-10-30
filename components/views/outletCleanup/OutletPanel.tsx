"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { OUTLET_SOURCE_LABELS } from "@/lib/outletUniverse/normalize";
import { matchOption } from "@/lib/outletCleanup/validate";
import { ACTIVITY_LABELS } from "@/lib/outletCleanup/activity";
import { RepRouteRow, type RepRouteEdit } from "./RepRouteRow";
import { FIELD_LABELS, IDENTIFICATION_FIELDS, type IdentificationField, type OutletDetail } from "@/lib/outletCleanup/types";

const inputClass = "w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-muted-strong outline-none focus:border-primary-blue disabled:cursor-not-allowed disabled:opacity-60";
const primaryButton = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow disabled:opacity-50";
const ghostButton = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-50";
const cardClass = "rounded-xl border border-border bg-surface p-4";

type FieldError = { field: string; message: string };

export function OutletPanel({ source, outletKey, onClose, onChanged }: { source: string; outletKey: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<OutletDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [draft, setDraft] = useState<Record<IdentificationField, string> | null>(null);
  // What each principal's row holds right now, and a counter that remounts the rows to start them afresh (after a final save or a discarded draft).
  const [rowEdits, setRowEdits] = useState<Record<string, RepRouteEdit>>({});
  const [rowsVersion, setRowsVersion] = useState(0);
  const onRowEdit = useCallback((edit: RepRouteEdit) => setRowEdits((all) => ({ ...all, [edit.principal]: edit })), []);

  const adopt = (next: OutletDetail) => {
    setDetail(next);
    const values = {} as Record<IdentificationField, string>;
    // The form opens with the person's saved draft laid over the saved values, except where a field is locked.
    for (const field of IDENTIFICATION_FIELDS) values[field] = (!next.lockedFields.includes(field) ? next.draft?.identification[field] : undefined) ?? next.verified[field] ?? next.current[field] ?? "";
    setDraft(values);
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/outlet-cleanup/outlet?source=${encodeURIComponent(source)}&key=${encodeURIComponent(outletKey)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load the outlet.");
        if (!cancelled) adopt(body as OutletDetail);
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [source, outletKey]);

  const send = async (body: Record<string, unknown>, success: string): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    setErrors([]);
    try {
      const response = await fetch("/api/outlet-cleanup/outlet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, outletKey, ...body }) });
      const result = await response.json();
      if (!response.ok) {
        if (result.detail) adopt(result.detail as OutletDetail);
        setErrors(result.fields ?? []);
        setMessage({ tone: "error", text: result.error ?? "Failed to save." });
        return false;
      }
      if (result.detail) adopt(result.detail as OutletDetail);
      setMessage({ tone: "ok", text: result.farFromPrevious ? `${success} The new point is ${result.distanceM} m from the old one, so an admin will check it.` : success });
      onChanged();
      return true;
    } catch {
      setMessage({ tone: "error", text: "The change could not be sent. Check the connection and try again." });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message;
  const locked = useMemo(() => new Set<string>(detail?.lockedFields ?? []), [detail]);

  if (loadError) {
    return (
      <div className={cardClass}>
        <p className="text-sm text-accent-red">{loadError}</p>
        <button onClick={onClose} className={`${ghostButton} mt-3`}>Close</button>
      </div>
    );
  }
  if (!detail || !draft) return <div className={cardClass}><p className="text-sm text-muted">Loading the outlet…</p></div>;

  const frozen = !detail.canEdit || detail.state === "DISOWNED";
  const changedFields = IDENTIFICATION_FIELDS.filter((f) => !locked.has(f) && draft[f].trim() !== (detail.verified[f] ?? detail.current[f] ?? "").trim());

  const saveIdentification = () => {
    const set: Partial<Record<IdentificationField, string>> = {};
    for (const field of changedFields) set[field] = draft[field];
    return send({ action: "save", set }, "Saved. The fields you updated are now locked.");
  };

  // Saving the whole form: draft keeps everything typed so far; final commits the changed fields and the reps the person worked on.
  const workedRows = Object.values(rowEdits).filter((e) => e.dirty && !e.off);
  const incompleteRows = workedRows.filter((e) => !e.complete);
  const changedSet = () => {
    const set: Partial<Record<IdentificationField, string>> = {};
    for (const field of changedFields) set[field] = draft[field];
    return set;
  };
  const draftReps = () => workedRows.map((e) => ({ principal: e.principal, repCode: e.repChoice || undefined, routeName: e.routeName || undefined, visitDays: e.days }));
  const finalReps = () => workedRows.map((e) => ({ principal: e.principal, action: e.repChoice === "" ? "CONFIRM" : "CHANGE", repCode: e.repChoice || undefined, routeName: e.routeName, visitDays: e.days }));
  const hasWork = changedFields.length > 0 || workedRows.length > 0;
  const saveDraft = () => send({ action: "draft", set: changedSet(), reps: draftReps() }, "Draft saved. Nothing is locked yet; come back and save it final when you are done.");
  const saveFinal = async () => {
    const saved = await send({ action: "final", set: changedSet(), reps: finalReps() }, "Saved final. What you changed is now locked and has gone to your admin to validate.");
    if (saved) {
      setRowEdits({});
      setRowsVersion((v) => v + 1);
    }
  };
  const discardDraft = async () => {
    if (await send({ action: "discardDraft" }, "Draft discarded.")) {
      setRowEdits({});
      setRowsVersion((v) => v + 1);
    }
  };

  const listFor = (field: IdentificationField): string[] | null =>
    field === "region" ? detail.options.regions : field === "territory" ? detail.options.territories : field === "channel" ? detail.options.channels : field === "customerType" ? detail.options.customerTypes : null;

  const identificationField = (field: IdentificationField) => {
    const list = listFor(field);
    const isLocked = locked.has(field) && !detail.canUnlock;
    const disabled = frozen || isLocked || busy;
    const typedInvalid = list !== null && draft[field].trim() !== "" && matchOption(draft[field], list) === null;
    const control =
      list === null ? (
        <input className={inputClass} disabled={disabled} value={draft[field]} inputMode={field === "contactPhone" ? "tel" : undefined} placeholder={field === "contactPhone" ? "0712 345 678" : "Contact person"} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} />
      ) : list.length > 40 ? (
        <>
          <input className={inputClass} disabled={disabled} list={`cleanup-${field}`} value={draft[field]} placeholder="Type to find, then choose" onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} />
          <datalist id={`cleanup-${field}`}>{list.map((v) => <option key={v} value={v} />)}</datalist>
        </>
      ) : (
        <select className={inputClass} disabled={disabled} value={matchOption(draft[field], list) ?? ""} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}>
          {matchOption(draft[field], list) === null ? <option value="">{draft[field] ? `${draft[field]} (not on the list)` : "Choose…"}</option> : null}
          {list.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      );
    return (
      <div key={field} className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{FIELD_LABELS[field]}</span>
          {locked.has(field) ? <Badge tier="good">Locked ✓</Badge> : null}
        </div>
        {control}
        {typedInvalid ? <span className="text-xs text-accent-red">Choose a value from the list.</span> : null}
        {errorFor(field) ? <span className="text-xs text-accent-red">{errorFor(field)}</span> : null}
        {locked.has(field) && detail.canUnlock ? (
          <button type="button" onClick={() => send({ action: "unlock", fields: [field] }, `${FIELD_LABELS[field]} reopened.`)} disabled={busy} className="w-fit text-xs font-semibold text-primary-blue hover:underline">
            Reopen this field
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardClass} flex flex-wrap items-start justify-between gap-3`}>
        <div>
          <h3 className="text-base font-bold text-brand-navy">{detail.outletName}</h3>
          <p className="mt-1 text-xs text-muted">
            {OUTLET_SOURCE_LABELS[detail.source]} · key {detail.outletKey}
            {detail.shop.shopSize > 1 ? ` · one of ${detail.shop.shopSize} outlets in the same shop` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tier={detail.activity.activity === "ACTIVE" ? "good" : detail.activity.activity === "LOST" ? "bad" : detail.activity.activity === "LAPSED" ? "warn" : "neutral"}>
            {detail.activity.activity === "ACTIVE" || detail.activity.daysSince === null ? ACTIVITY_LABELS[detail.activity.activity] : `${ACTIVITY_LABELS[detail.activity.activity]} · ${detail.activity.daysSince} d`}
          </Badge>
          <Badge tier={detail.state === "VALIDATED" || detail.state === "APPLIED" ? "good" : detail.state === "REJECTED" ? "bad" : detail.state === "UNREVIEWED" ? "neutral" : "warn"}>{detail.state.toLowerCase()}</Badge>
          <button onClick={onClose} className={ghostButton}>Close</button>
        </div>
      </div>

      {message ? <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${message.tone === "ok" ? "border-accent-green/40 text-accent-green" : "border-accent-red/40 text-accent-red"}`}>{message.text}</p> : null}
      {detail.state === "DISOWNED" ? <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-strong">This outlet was marked open and is waiting for another team to claim it{detail.openStatus ? ` (${detail.openStatus.status.toLowerCase()})` : ""}.</p> : null}
      {!detail.canEdit && detail.state !== "DISOWNED" ? <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-strong">You can view this outlet but not change it.</p> : null}

      <section className={cardClass}>
        <h4 className="text-sm font-bold text-primary-blue">1 · Outlet identification</h4>
        <p className="mt-1 text-xs text-muted">Prefilled from the universe. Change only what you have verified, from the lists. Anything you update or confirm is locked afterwards.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{IDENTIFICATION_FIELDS.map(identificationField)}</div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={primaryButton} disabled={frozen || busy || changedFields.length === 0} onClick={saveIdentification}>Save changes</button>
          <button className={ghostButton} disabled={frozen || busy || changedFields.length > 0} onClick={() => send({ action: "save", confirm: "ALL" }, "Marked correct. Region, territory, channel and customer type are now locked.")} title={changedFields.length > 0 ? "Save or undo your changes first" : undefined}>
            Mark all as correct
          </button>
        </div>
        {errorFor("geo") ? <p className="mt-2 text-xs text-accent-red">{errorFor("geo")}</p> : null}
      </section>

      <section className={cardClass}>
        <h4 className="text-sm font-bold text-primary-blue">2 · GPS location</h4>
        <p className="mt-1 text-sm text-muted-strong">
          {detail.geo.missing ? "This outlet has no GPS point. Visit it and tag the location from the outlet." : `Tagged ${detail.geo.latitude?.toFixed(5)}, ${detail.geo.longitude?.toFixed(5)}${detail.geo.taggedBy ? ` by ${detail.geo.taggedBy}` : ""}.`}
        </p>
        {locked.has("geo") && !detail.canUnlock ? (
          <p className="mt-2 text-xs text-muted">The location is locked. Ask your supervisor or an admin to reopen it.</p>
        ) : (
          <GeoTagger disabled={frozen || busy} label={detail.geo.missing ? "Tag location now" : "Re-tag location"} onTag={(tag) => send({ action: "geo", ...tag }, "Location tagged and locked.")} />
        )}
      </section>

      <section className={cardClass}>
        <h4 className="text-sm font-bold text-primary-blue">3 · Reps, routes and visit days</h4>
        <p className="mt-1 text-xs text-muted">For each principal, validate the rep who visits this outlet, the route they visit it on and the days of the week. The suggestions come from how the outlet has actually been visited.</p>
        <div className="mt-3 flex flex-col gap-3">
          {detail.reps.map((row) => (
            <RepRouteRow
              key={`${row.principal}-${rowsVersion}`}
              detail={detail}
              row={row}
              disabled={frozen || busy}
              error={errorFor(row.principal)}
              draft={detail.draft?.reps.find((d) => d.principal.toLowerCase() === row.principal.toLowerCase())}
              onEdit={onRowEdit}
              onSave={(payload) => send({ action: "reps", reps: [payload] }, `${row.principal}: rep, route and days saved.`)}
            />
          ))}
        </div>
      </section>

      {!frozen ? (
        <section aria-label="Save your work on this outlet" className="sticky bottom-3 z-10 rounded-xl border border-primary-blue/40 bg-surface p-4 shadow-lg">
          <div className="flex flex-wrap items-center gap-2">
            <button className={ghostButton} disabled={busy || !hasWork} onClick={saveDraft}>Save draft</button>
            <button className={primaryButton} disabled={busy || !hasWork || incompleteRows.length > 0} onClick={saveFinal}>Save final</button>
            {detail.draft ? <button className="text-xs font-semibold text-accent-red hover:underline disabled:opacity-50" disabled={busy} onClick={discardDraft}>Discard draft</button> : null}
            <span className="text-xs text-muted">
              {detail.draft ? `Draft saved ${new Date(detail.draft.savedAt).toLocaleString()}.` : hasWork ? "You have changes that are not saved yet." : "Nothing changed yet."}
            </span>
          </div>
          {incompleteRows.length > 0 ? <p className="mt-2 text-xs text-accent-red">Choose the route and at least one day for {incompleteRows.map((e) => e.principal).join(", ")} before saving final, or save a draft.</p> : null}
          <p className="mt-2 text-xs text-muted">
            <strong>Save draft</strong> keeps what you have typed so you can finish later: nothing is locked, it does not count as progress and your admin does not see it. <strong>Save final</strong> saves your changed details and reps together, locks them and sends the outlet to your admin to validate. GPS tags, duplicate calls and disowning save at once.
          </p>
        </section>
      ) : null}

      <section className={cardClass}>
        <h4 className="text-sm font-bold text-primary-blue">4 · Possible duplicates</h4>
        {detail.duplicates.length === 0 ? <p className="mt-2 text-sm text-muted">No similar outlet found nearby.</p> : null}
        <div className="mt-3 flex flex-col gap-2">
          {detail.duplicates.map((d) => (
            <div key={`${d.source}|${d.outletKey}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <div className="text-sm">
                <span className="font-semibold text-brand-navy">{d.outletName}</span>
                <span className="ml-2 text-xs text-muted">{OUTLET_SOURCE_LABELS[d.source]} · {d.principals} · {d.territory}{d.distanceM !== null ? ` · ${d.distanceM} m away` : ""}{d.inSameShop ? " · already merged into this shop" : ""}</span>
              </div>
              {d.decision ? <Badge tier={d.decision === "MERGE" ? "warn" : "good"}>{d.decision === "MERGE" ? "Declared the same shop" : "Not a duplicate"}</Badge> : null}
              {!d.decision || detail.canUnlock ? (
                <div className="flex gap-2">
                  <button className={ghostButton} disabled={frozen || busy} onClick={() => send({ action: "duplicate", otherSource: d.source, otherKey: d.outletKey, decision: "MERGE" }, "Declared the same shop. An admin will confirm the merge.")}>Same shop – merge</button>
                  <button className={ghostButton} disabled={frozen || busy} onClick={() => send({ action: "duplicate", otherSource: d.source, otherKey: d.outletKey, decision: "NOT_DUPLICATE" }, "Marked as not a duplicate.")}>Not a duplicate</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {detail.canEdit && detail.state !== "DISOWNED" ? <DisownSection detail={detail} busy={busy} errorFor={errorFor} onDisown={(reason, candidates) => send({ action: "disown", reason, candidates }, "Outlet marked open. The teams you named can now claim it.")} /> : null}

      {detail.history.length > 0 ? (
        <section className={cardClass}>
          <h4 className="text-sm font-bold text-primary-blue">History</h4>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
            {detail.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} · {h.actor} · {h.action.toLowerCase().replace(/_/g, " ")}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function GeoTagger({ disabled, label, onTag }: { disabled: boolean; label: string; onTag: (tag: { latitude: number; longitude: number; accuracyM: number }) => Promise<boolean> }) {
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const locate = () => {
    if (!("geolocation" in navigator)) {
      setProblem("This device cannot share its location. Open the dashboard on a phone.");
      return;
    }
    setProblem(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        await onTag({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyM: position.coords.accuracy });
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        setProblem(error.code === error.PERMISSION_DENIED ? "Location access is blocked. Allow it for this site in your browser settings." : "The phone could not get a location fix. Step outside and try again.");
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
    );
  };
  return (
    <div className="mt-3">
      <button className={primaryButton} disabled={disabled || locating} onClick={locate}>{locating ? "Getting a fix…" : label}</button>
      <p className="mt-2 text-xs text-muted">Stand at the outlet. The point is accepted only when the phone&apos;s fix is within 100 m and inside Kenya.</p>
      {problem ? <p className="mt-1 text-xs text-accent-red">{problem}</p> : null}
    </div>
  );
}

function DisownSection({ detail, busy, errorFor, onDisown }: { detail: OutletDetail; busy: boolean; errorFor: (field: string) => string | undefined; onDisown: (reason: string, candidates: string[]) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [find, setFind] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const shown = detail.teamLeaderOptions.filter((n) => n.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 40);
  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-primary-blue">5 · This is not my outlet</h4>
        <button className={ghostButton} onClick={() => setOpen(!open)}>{open ? "Cancel" : "Disown this outlet"}</button>
      </div>
      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted">The outlet moves to Marked open outlets. Name the team leaders from other teams who may own it; each can claim or decline it.</p>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Why is it not yours?</span>
            <textarea className={inputClass} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            {errorFor("reason") ? <span className="text-xs text-accent-red">{errorFor("reason")}</span> : null}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Possible owners (other teams)</span>
            <input className={inputClass} placeholder="Find a team leader" value={find} onChange={(e) => setFind(e.target.value)} />
          </label>
          <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">
            {shown.map((name) => (
              <button key={name} type="button" aria-pressed={picked.includes(name)} onClick={() => setPicked(picked.includes(name) ? picked.filter((p) => p !== name) : [...picked, name])} className={`rounded-full border px-3 py-1 text-xs font-semibold ${picked.includes(name) ? "border-primary-blue bg-primary-blue text-white" : "border-border text-muted-strong hover:bg-accent-blue-soft"}`}>
                {name}
              </button>
            ))}
          </div>
          {picked.length > 0 ? <p className="text-xs text-muted">Chosen: {picked.join(", ")}</p> : null}
          {errorFor("candidates") ? <span className="text-xs text-accent-red">{errorFor("candidates")}</span> : null}
          <div><button className={primaryButton} disabled={busy || reason.trim().length < 5 || picked.length === 0} onClick={() => onDisown(reason, picked)}>Mark as open</button></div>
        </div>
      ) : null}
    </section>
  );
}
