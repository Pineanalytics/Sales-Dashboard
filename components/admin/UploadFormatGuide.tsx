import { exampleValue, UPLOAD_FORMATS, type ExampleTable, type UploadKind } from "@/lib/uploadExamples";

/** Under an upload form: what file it takes, a button that downloads an example built from the data already in the dashboard, and (opened on
 *  demand) every column with whether it is required, what goes in it and a real value. The example is in the exact shape the upload reads. */
export function UploadFormatGuide({ kind, example }: { kind: UploadKind; example: ExampleTable | null }) {
  const format = UPLOAD_FORMATS[kind];
  const rows = example?.rows.length ?? 0;
  return (
    <div className="mt-4 rounded-xl border border-border bg-background-elevated/50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-muted">
          <span className="font-semibold text-foreground">Accepts:</span> {format.accepts}
        </p>
        {rows > 0 ? (
          <a
            href={`/api/admin/upload-example/${kind}`}
            download
            className="inline-flex items-center rounded-full border border-secondary-blue/30 bg-surface px-4 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft"
          >
            Download example ({rows} real row{rows === 1 ? "" : "s"}, .{format.fileType})
          </a>
        ) : (
          <span className="text-xs text-muted">No data in the dashboard yet to build an example from.</span>
        )}
      </div>
      <details className="mt-2 group">
        <summary className="cursor-pointer select-none text-xs font-semibold text-primary-blue hover:underline">Format guide: columns and example values</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-muted">
          {format.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[12px]">
            <thead>
              <tr className="bg-background-elevated text-left uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">Column</th>
                <th className="px-3 py-2 font-medium">Required</th>
                <th className="px-3 py-2 font-medium">What goes in it</th>
                <th className="px-3 py-2 font-medium">Example from your data</th>
              </tr>
            </thead>
            <tbody>
              {format.columns.map((column) => {
                const value = exampleValue(example, column.name);
                return (
                  <tr key={column.name} className="border-t border-border/60 align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold text-brand-navy">{column.name}</td>
                    <td className="px-3 py-2">{column.required ? <span className="font-semibold text-accent-red">Required</span> : <span className="text-muted">Optional</span>}</td>
                    <td className="px-3 py-2 text-muted">{column.meaning}</td>
                    <td className="max-w-[260px] break-words px-3 py-2 font-mono text-foreground">{value || <span className="text-muted">(blank)</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
