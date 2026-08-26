const ALLOWED_ROOTS = new Set(["dsr", "sales-analytics"]);

const CHART_THEME_REPLACEMENTS = [
  ["#2563EB", "#24754F"],
  ["#D97706", "#A87022"],
  ["#16A34A", "#218C5A"],
  ["#DC2626", "#B6533A"],
  ["#7C3AED", "#2F7E78"],
  ["#0891B2", "#1F6A4E"],
  ["#DB2777", "#C29A42"],
  ["#65A30D", "#71B741"],
  ["#E7EEFC", "#123F37"],
  ["#64748B", "#64756E"],
  ["rgba(255,255,255,.08)", "rgba(11,61,53,.09)"],
] as const;

const EMBEDDED_THEME = `<style id="pinefrost-sales-dashboard-theme">
:root{
  --navy:#0b3d35;--navy2:#155b4a;--navy3:#24754f;
  --cobalt:#24754f;--cobalt2:#1f6a4e;--cobalt3:#24754f;--cobalt4:#d9e8d6;
  --amber:#a87022;--amber2:#c29a42;--amber3:#f3eadb;
  --slate:#64756e;--slate2:#71817b;
  --bg:#f6f8f4;--frost:#ffffff;--card:#ffffff;--ink:#123f37;
  --line:#d8e3d6;--green:#218c5a;--red:#b6533a;--orange:#a87022;
  --sidebar-w:210px;
  --c1:#24754f;--c2:#a87022;--c3:#218c5a;--c4:#b6533a;
  --c5:#2f7e78;--c6:#1f6a4e;--c7:#c29a42;--c8:#71b741;
  --sans:"Segoe UI","Segoe UI Variable",system-ui,sans-serif;
}
html,body{width:100%;min-height:100%;background:var(--bg);color:var(--ink)}
body{font-family:var(--sans)}
.shell{width:100%;min-height:100vh;background:var(--bg)}
.sidebar{background:linear-gradient(180deg,#0b3d35 0%,#155b4a 100%);box-shadow:2px 0 14px rgba(11,61,53,.16)}
.side-top{border-bottom-color:rgba(255,255,255,.16)}
.wordmark h1{color:#fff}.wordmark .sep{background:#71b741}.wordmark .sub,.stamp{color:#cfe2d5}
nav.t1 button,nav.t2 button{color:#cfe2d5}
nav.t1 button:hover,nav.t2 button:hover{color:#fff;background:rgba(255,255,255,.09)}
nav.t1 button.on{color:#fff;border-left-color:#71b741;background:rgba(255,255,255,.12)}
nav.t2 button.on{color:#0b3d35;background:#d9e8d6}
.content{width:calc(100% - var(--sidebar-w));min-width:0;background:var(--bg)}
.topbar{background:rgba(255,255,255,.97);border-bottom:1px solid var(--line);box-shadow:0 3px 12px rgba(11,61,53,.06)}
.topbar-inner,.status,main{width:100%;max-width:none}
.topbar-inner{padding:10px clamp(16px,2vw,32px) 0}
.status{padding:4px clamp(16px,2vw,32px) 8px;color:var(--slate)}
main{padding:20px clamp(16px,2vw,32px) 56px}
.field label{color:var(--secondary-blue,#1f6a4e)}
.field input,.field select,.msf-btn,.sig-name-field input,.cm-textarea,.cm-select{
  border-color:var(--line);background:#fff;color:var(--ink);border-radius:7px;box-shadow:0 1px 2px rgba(11,61,53,.04)
}
.msf-btn.active{border-color:var(--cobalt);color:var(--cobalt)}
.msf-panel,.modal{background:#fff;border-color:var(--line);box-shadow:0 14px 38px rgba(11,61,53,.18)}
.msf-search,.outlet-bar select{background:#fff;color:var(--ink);border-color:var(--line)}
.msf-opt:hover{background:#e7f0e5}.msf-clear{color:var(--cobalt)}
.seg{border-color:var(--line);border-radius:7px}.seg button{background:#edf3ec;color:var(--slate)}
.seg button.on{background:var(--navy);color:#fff}
button.apply,.btn-pdf{background:var(--navy);color:#fff;border-radius:7px}
button.apply:hover,.btn-pdf:hover{background:var(--navy2)}
.kpis{gap:10px;background:transparent;border:none;overflow:visible;box-shadow:none}
.kpi,.card,.rep-card,.tbl-wrap{background:#fff;border:1px solid var(--line);box-shadow:0 3px 12px rgba(11,61,53,.06)}
.kpi{border-radius:9px}.kpi::before{background:#d9e8d6}.kpi.k-amber::before{background:#f3eadb}.kpi.k-green::before{background:#dceee4}.kpi.k-red::before{background:#f2dfda}
.kpi .v,.rep-card h3,.rep-stat .si .val,.sh h2,.modal h3,.sig-status .name,.cm-item .cm-text{color:var(--ink)}
.sh .rule{background:var(--line)}
th{background:#edf3ec;color:#3d554d;border-bottom-color:#b7c9b4}
td{border-bottom-color:#e7eee8;color:var(--ink)}
tbody tr:hover{background:#e7f0e5}
.tbl-wrap{border-radius:10px}
.tape .track,.mbar{background:#dfe9e1}.tape .fill{background:#24754f}.tape .fill.hit{background:#a87022}
.pill{background:#edf3ec;border-color:#d8e3d6}.pill .pv{color:#155b4a}
.mover-item,.cm-item{background:#edf3ec;border-color:var(--line)}
.modal-overlay{background:rgba(11,61,53,.42)}
footer{color:var(--slate)}
@media(max-width:900px){.content{width:100%}.sidebar{background:#0b3d35}}
</style>`;

export function validateEablDsrProxyPath(path: string[]): string | null {
  if (path.length === 0 || !ALLOWED_ROOTS.has(path[0])) return null;
  if (path.some((segment) => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))) return null;
  return `/${path.join("/")}`;
}

/** Keep the legacy dashboard's root-relative requests inside this protected proxy. */
export function rewriteEablDsrDashboardHtml(html: string): string {
  let rewritten = html
    .replaceAll("fetch(`/", "fetch(`/api/eabl-dsr-review/")
    .replaceAll("fetch('/", "fetch('/api/eabl-dsr-review/")
    .replace("<title>", "<title>EABL DSR Review · ");
  for (const [from, to] of CHART_THEME_REPLACEMENTS) rewritten = rewritten.replaceAll(from, to);
  return rewritten.replace("</head>", `${EMBEDDED_THEME}</head>`);
}
