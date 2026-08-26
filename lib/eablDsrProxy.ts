const ALLOWED_ROOTS = new Set(["dsr", "sales-analytics"]);

export function validateEablDsrProxyPath(path: string[]): string | null {
  if (path.length === 0 || !ALLOWED_ROOTS.has(path[0])) return null;
  if (path.some((segment) => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))) return null;
  return `/${path.join("/")}`;
}

/** Keep the legacy dashboard's root-relative requests inside this protected proxy. */
export function rewriteEablDsrDashboardHtml(html: string): string {
  return html
    .replaceAll("fetch(`/", "fetch(`/api/eabl-dsr-review/")
    .replaceAll("fetch('/", "fetch('/api/eabl-dsr-review/")
    .replace("<title>", "<title>EABL DSR Review · ");
}
