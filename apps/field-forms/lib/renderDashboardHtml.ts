import type { ExportData } from "./dashboardExport";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}

// A self-contained, shareable snapshot of the live dashboard — same visual
// structure and Chart.js-driven charts, with the current data baked in as a
// static JSON blob so the file works standalone (no login, no server).
export function renderDashboardHtml(formTitle: string, data: ExportData, filterLabel?: string): string {
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");
  const generatedAt = new Date().toLocaleString();
  // The requested filter (e.g. "2026-07-01 – 2026-07-15") is shown alongside
  // the actual span of the matched data — they can differ if the range has
  // gaps or catches zero submissions.
  const rangeText = filterLabel ? `${data.dateRangeLabel} (filtered: ${filterLabel})` : data.dateRangeLabel;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(formTitle)} — Dashboard Export</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
<style>
  :root{
    --navy:#1F3864; --blue:#2E75B6; --lightblue:#EAF1FB; --green:#2E7D32;
    --amber:#C55A11; --red:#C00000; --grey:#F4F6F8; --border:#E2E6EC; --text:#22293B;
  }
  *{box-sizing:border-box;}
  body{margin:0;font-family:'Segoe UI',Arial,sans-serif;background:var(--grey);color:var(--text);}
  header{background:linear-gradient(135deg,var(--navy),var(--blue));color:#fff;padding:28px 32px;}
  header h1{margin:0;font-size:26px;letter-spacing:.3px;}
  header p{margin:6px 0 0;opacity:.85;font-size:14px;}
  .container{max-width:1320px;margin:0 auto;padding:24px 20px 60px;}
  .kpi-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-bottom:26px;}
  .kpi{border-radius:10px;padding:16px 14px;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.08);}
  .kpi .label{font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;opacity:.9;}
  .kpi .value{font-size:26px;font-weight:700;margin-top:8px;}
  .kpi.navy{background:var(--navy);} .kpi.blue{background:var(--blue);}
  .kpi.green{background:var(--green);} .kpi.amber{background:var(--amber);}
  .kpi.red{background:var(--red);} .kpi.dark{background:#3B3B58;}
  .tabs{display:flex;gap:6px;margin-bottom:18px;border-bottom:2px solid var(--border);flex-wrap:wrap;}
  .tab-btn{padding:10px 18px;background:none;border:none;font-size:14px;font-weight:600;color:#6b7280;cursor:pointer;border-bottom:3px solid transparent;transition:all .15s;}
  .tab-btn.active{color:var(--navy);border-bottom-color:var(--blue);}
  .tab-btn:hover{color:var(--navy);}
  .panel{display:none;}
  .panel.active{display:block;animation:fadein .25s ease;}
  @keyframes fadein{from{opacity:0;}to{opacity:1;}}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
  .card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.04);}
  .card h3{margin:0 0 14px;font-size:15px;color:var(--navy);}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th{background:var(--lightblue);color:var(--navy);text-align:left;padding:9px 10px;font-weight:600;position:sticky;top:0;}
  td{padding:8px 10px;border-bottom:1px solid var(--border);}
  tr:hover td{background:#F7FAFF;}
  .badge{padding:3px 9px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;display:inline-block;}
  .badge.yes{background:var(--red);} .badge.no{background:var(--green);}
  .badge.delivered{background:var(--green);} .badge.notdelivered{background:var(--amber);}
  .filters{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;}
  select,input[type=text]{padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:#fff;}
  .scroll-table{max-height:520px;overflow:auto;border:1px solid var(--border);border-radius:8px;}
  .footer-note{font-size:12px;color:#8a92a6;text-align:center;margin-top:30px;}
  .chart-wrap{position:relative;height:300px;}
  .chart-wrap.tall{height:360px;}
  .photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;}
  .photo-item{display:block;text-decoration:none;color:inherit;}
  .photo-item .thumb{aspect-ratio:1/1;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--grey);}
  .photo-item img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .15s;}
  .photo-item:hover img{transform:scale(1.05);}
  .photo-item .cap-title{font-size:12px;font-weight:600;color:var(--text);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .photo-item .cap-sub{font-size:11px;color:#8a92a6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  @media(max-width:1100px){.kpi-grid{grid-template-columns:repeat(3,1fr);}.grid2{grid-template-columns:1fr;}}
  @media(max-width:600px){.kpi-grid{grid-template-columns:repeat(2,1fr);}}
</style>
</head>
<body>

<header>
  <h1>📋 ${esc(formTitle)} — Dashboard</h1>
  <p id="subtitle"></p>
</header>

<div class="container">

  <div class="kpi-grid" id="kpiGrid"></div>

  <div class="tabs">
    <button class="tab-btn active" data-tab="overview">Overview</button>
    <button class="tab-btn" data-tab="teams">Merchandisers &amp; Retailers</button>
    <button class="tab-btn" data-tab="regions">Regions</button>
    <button class="tab-btn" data-tab="oos">OOS Log</button>
    <button class="tab-btn" data-tab="raw">Visit Records</button>
    <button class="tab-btn" data-tab="photos">Photos</button>
  </div>

  <div class="panel active" id="panel-overview">
    <div class="grid2">
      <div class="card"><h3>Visits Logged by Day</h3><div class="chart-wrap"><canvas id="chartDaily"></canvas></div></div>
      <div class="card"><h3>Product Positioning Score Distribution</h3><div class="chart-wrap"><canvas id="chartPos"></canvas></div></div>
      <div class="card"><h3>Purchase Order Status</h3><div class="chart-wrap"><canvas id="chartPO"></canvas></div></div>
      <div class="card"><h3>Delivery Status</h3><div class="chart-wrap"><canvas id="chartDelivery"></canvas></div></div>
    </div>
  </div>

  <div class="panel" id="panel-teams">
    <div class="grid2">
      <div class="card"><h3>Avg Share of Shelf % by Merchandiser</h3><div class="chart-wrap"><canvas id="chartMerchSOS"></canvas></div></div>
      <div class="card"><h3>OOS Rate % by Merchandiser</h3><div class="chart-wrap"><canvas id="chartMerchOOS"></canvas></div></div>
    </div>
    <div class="card">
      <h3>Merchandiser Performance Summary</h3>
      <div class="scroll-table"><table id="tblMerch"></table></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Visit Share by Retailer</h3><div class="chart-wrap"><canvas id="chartRetailerPie"></canvas></div></div>
      <div class="card"><h3>Avg Share of Shelf % by Retailer</h3><div class="chart-wrap"><canvas id="chartRetailerSOS"></canvas></div></div>
    </div>
    <div class="card">
      <h3>Retailer Performance Summary</h3>
      <div class="scroll-table"><table id="tblRetailer"></table></div>
    </div>
  </div>

  <div class="panel" id="panel-regions">
    <div class="grid2">
      <div class="card"><h3>Avg Share of Shelf % by Region</h3><div class="chart-wrap"><canvas id="chartRegionSOS"></canvas></div></div>
      <div class="card"><h3>OOS Rate % by Region</h3><div class="chart-wrap"><canvas id="chartRegionOOS"></canvas></div></div>
    </div>
    <div class="card">
      <h3>Region Performance Summary</h3>
      <div class="scroll-table"><table id="tblRegion"></table></div>
    </div>
  </div>

  <div class="panel" id="panel-oos">
    <div class="card">
      <h3>Out-of-Stock Incidents (<span id="oosCount"></span> of <span id="oosTotal"></span> visits)</h3>
      <div class="scroll-table"><table id="tblOOS"></table></div>
    </div>
  </div>

  <div class="panel" id="panel-raw">
    <div class="card">
      <div class="filters">
        <select id="fltMerch"><option value="">All Merchandisers</option></select>
        <select id="fltRetailer"><option value="">All Retailers</option></select>
        <select id="fltRegion"><option value="">All Regions</option></select>
        <select id="fltOOS"><option value="">OOS: All</option><option value="Yes">OOS: Yes</option><option value="No">OOS: No</option></select>
        <input type="text" id="fltBranch" placeholder="Search branch...">
      </div>
      <div class="scroll-table"><table id="tblRaw"></table></div>
    </div>
  </div>

  <div class="panel" id="panel-photos">
    <div class="card">
      <h3>Shelf Photos (<span id="photoCount"></span>)</h3>
      <div class="photo-grid" id="photoGrid"></div>
    </div>
  </div>

  <p class="footer-note">Generated from ${esc(formTitle)} submissions · ${data.kpis.total_visits} visits · ${esc(rangeText)} · exported ${esc(generatedAt)}</p>
</div>

<script>
const DATA = ${dataJson};

document.getElementById('subtitle').textContent =
  \`\${DATA.kpis.total_visits} store visits across \${DATA.kpis.retailers} retailers, \${DATA.kpis.branches} branches and \${DATA.kpis.regions} regions · ${esc(rangeText)}\`;

const kpis = [
  {label:'Total Visits', value:DATA.kpis.total_visits, cls:'navy'},
  {label:'Avg Share of Shelf', value:DATA.kpis.avg_sos+'%', cls:'blue'},
  {label:'OOS Rate', value:DATA.kpis.oos_rate+'%', cls:'red'},
  {label:'Avg Positioning', value:DATA.kpis.avg_pos+' / 5', cls:'green'},
  {label:'Delivery Rate', value:DATA.kpis.delivery_rate+'%', cls:'amber'},
  {label:'Competitor Activity', value:DATA.kpis.competitor_rate+'%', cls:'dark'},
];
document.getElementById('kpiGrid').innerHTML = kpis.map(k=>
  \`<div class="kpi \${k.cls}"><div class="label">\${k.label}</div><div class="value">\${k.value}</div></div>\`
).join('');

document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
  });
});

const palette = ['#2E75B6','#1F3864','#2E7D32','#C55A11','#C00000','#7C4DFF','#00897B','#8D6E63'];
Chart.defaults.font.family = "'Segoe UI',Arial,sans-serif";
Chart.defaults.font.size = 12;

function barChart(id, labels, values, label, color, horizontal=false){
  new Chart(document.getElementById(id), {
    type:'bar',
    data:{labels, datasets:[{label, data:values, backgroundColor:color, borderRadius:5, maxBarThickness:38}]},
    options:{
      indexAxis: horizontal? 'y':'x',
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{ y:{beginAtZero:true, grid:{color:'#EEF1F5'}}, x:{grid:{display:false}} }
    }
  });
}

function pieChart(id, labels, values, colors){
  new Chart(document.getElementById(id), {
    type:'doughnut',
    data:{labels, datasets:[{data:values, backgroundColor:colors}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right'}}}
  });
}

const dailyLabels = Object.keys(DATA.daily);
barChart('chartDaily', dailyLabels, Object.values(DATA.daily), 'Visits', '#2E75B6');

const posLabels = Object.keys(DATA.pos_dist).sort();
barChart('chartPos', posLabels.map(l=>'Score '+l), posLabels.map(l=>DATA.pos_dist[l]), 'Visits', '#2E7D32');

pieChart('chartPO', Object.keys(DATA.po_dist), Object.values(DATA.po_dist), palette);
pieChart('chartDelivery', Object.keys(DATA.delivery_dist), Object.values(DATA.delivery_dist), ['#2E7D32','#C00000']);

const mNameKey = DATA.merchNameKey, rNameKey = DATA.retailerNameKey, gNameKey = DATA.regionNameKey;
const mLabels = DATA.merch.map(r=>r[mNameKey]);
barChart('chartMerchSOS', mLabels, DATA.merch.map(r=>r.avg_sos), 'Avg SoS %', '#2E75B6');
barChart('chartMerchOOS', mLabels, DATA.merch.map(r=>Math.round(r.oos_rate*1000)/10), 'OOS Rate %', '#C00000');

const rLabels = DATA.retailer.map(r=>r[rNameKey]);
pieChart('chartRetailerPie', rLabels, DATA.retailer.map(r=>r.visits), palette);
barChart('chartRetailerSOS', rLabels, DATA.retailer.map(r=>r.avg_sos), 'Avg SoS %', '#2E75B6', true);

const gLabels = DATA.region.map(r=>r[gNameKey]);
barChart('chartRegionSOS', gLabels, DATA.region.map(r=>r.avg_sos), 'Avg SoS %', '#2E75B6');
barChart('chartRegionOOS', gLabels, DATA.region.map(r=>Math.round(r.oos_rate*1000)/10), 'OOS Rate %', '#C00000');

function renderTable(elId, headers, rows){
  const el = document.getElementById(elId);
  el.innerHTML = '<thead><tr>'+headers.map(h=>\`<th>\${h}</th>\`).join('')+'</tr></thead>'+
    '<tbody>'+rows.join('')+'</tbody>';
}

renderTable('tblMerch',
  ['Merchandiser','Visits','Avg SoS %','Avg Shelf Occ %','OOS Incidents','OOS Rate','Avg Positioning','Delivery Rate'],
  DATA.merch.map(r=>\`<tr><td>\${r[mNameKey]}</td><td>\${r.visits}</td><td>\${r.avg_sos.toFixed(1)}%</td>\` +
    \`<td>\${Math.round(r.avg_shelf_occ*100)}%</td><td>\${r.oos}</td><td>\${Math.round(r.oos_rate*100)}%</td>\` +
    \`<td>\${r.avg_pos.toFixed(2)}</td><td>\${Math.round(r.delivery_rate*100)}%</td></tr>\`)
);

renderTable('tblRetailer',
  ['Retailer','Visits','Avg SoS %','Avg Shelf Occ %','OOS Incidents','OOS Rate','Avg Positioning','Delivery Rate'],
  DATA.retailer.map(r=>\`<tr><td>\${r[rNameKey]}</td><td>\${r.visits}</td><td>\${r.avg_sos.toFixed(1)}%</td>\` +
    \`<td>\${Math.round(r.avg_shelf_occ*100)}%</td><td>\${r.oos}</td><td>\${Math.round(r.oos_rate*100)}%</td>\` +
    \`<td>\${r.avg_pos.toFixed(2)}</td><td>\${Math.round(r.delivery_rate*100)}%</td></tr>\`)
);

renderTable('tblRegion',
  ['Region','Visits','Avg SoS %','Avg Shelf Occ %','OOS Incidents','OOS Rate','Avg Positioning','Delivery Rate'],
  DATA.region.map(r=>\`<tr><td>\${r[gNameKey]}</td><td>\${r.visits}</td><td>\${r.avg_sos.toFixed(1)}%</td>\` +
    \`<td>\${Math.round(r.avg_shelf_occ*100)}%</td><td>\${r.oos}</td><td>\${Math.round(r.oos_rate*100)}%</td>\` +
    \`<td>\${r.avg_pos.toFixed(2)}</td><td>\${Math.round(r.delivery_rate*100)}%</td></tr>\`)
);

document.getElementById('oosCount').textContent = DATA.oos_log.length;
document.getElementById('oosTotal').textContent = DATA.kpis.total_visits;
renderTable('tblOOS',
  ['Date','Merchandiser','Retailer','Branch','Region','Items Reported'],
  DATA.oos_log.map(r=>\`<tr><td>\${r['Visit Date']}</td><td>\${r['Merchandiser Name']}</td><td>\${r['Retailer Name']}</td>\` +
    \`<td>\${r['Retailer Location / Branch']}</td><td>\${r['Region']}</td><td>\${r['OOS List Of Items']}</td></tr>\`)
);

function badgeYesNo(v){ return v==='Yes' ? \`<span class="badge yes">Yes</span>\` : \`<span class="badge no">No</span>\`; }
function badgeDelivery(v){ return v==='Order Delivered' ? \`<span class="badge delivered">Delivered</span>\` : \`<span class="badge notdelivered">Not Delivered</span>\`; }

function fillSelect(id, values){
  const sel = document.getElementById(id);
  [...new Set(values)].filter(Boolean).sort().forEach(v=>{
    const o = document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o);
  });
}
fillSelect('fltMerch', DATA.raw.map(r=>r['Merchandiser Name']));
fillSelect('fltRetailer', DATA.raw.map(r=>r['Retailer Name']));
fillSelect('fltRegion', DATA.raw.map(r=>r['Region']));

function renderRaw(){
  const fm = document.getElementById('fltMerch').value;
  const fr = document.getElementById('fltRetailer').value;
  const fg = document.getElementById('fltRegion').value;
  const fo = document.getElementById('fltOOS').value;
  const fb = document.getElementById('fltBranch').value.toLowerCase();

  const rows = DATA.raw.filter(r=>
    (!fm || r['Merchandiser Name']===fm) &&
    (!fr || r['Retailer Name']===fr) &&
    (!fg || r['Region']===fg) &&
    (!fo || r['Out of Stock (OOS)']===fo) &&
    (!fb || (r['Retailer Location / Branch']||'').toLowerCase().includes(fb))
  );

  renderTable('tblRaw',
    ['Date','Time','Merchandiser','Code','Retailer','Region','Branch','SoS %','OOS','Competitor','SKUs','Positioning','PO Status','Delivery'],
    rows.map(r=>\`<tr><td>\${r['Visit Date']}</td><td>\${r['Visit Time']}</td><td>\${r['Merchandiser Name']}</td>\` +
      \`<td>\${r['Merchandiser Code']||''}</td>\` +
      \`<td>\${r['Retailer Name']}</td><td>\${r['Region']}</td><td>\${r['Retailer Location / Branch']}</td>\` +
      \`<td>\${(r['Share of Shelf (%)']||0).toFixed(1)}%</td><td>\${badgeYesNo(r['Out of Stock (OOS)'])}</td>\` +
      \`<td>\${badgeYesNo(r['Competitor Activity Present'])}</td><td>\${r['SKU Count']}</td>\` +
      \`<td>\${r['Product Positioning (1 = worst, 5 = best)']}</td>\` +
      \`<td>\${r['PO Status Clean']}</td><td>\${badgeDelivery(r['Delivery Status'])}</td></tr>\`)
  );
}
['fltMerch','fltRetailer','fltRegion','fltOOS'].forEach(id=>document.getElementById(id).addEventListener('change', renderRaw));
document.getElementById('fltBranch').addEventListener('input', renderRaw);
renderRaw();

document.getElementById('photoCount').textContent = DATA.photos.length;
document.getElementById('photoGrid').innerHTML = DATA.photos.map(p=>
  \`<a class="photo-item" href="\${p.url}" target="_blank" rel="noopener">
     <div class="thumb"><img src="\${p.url}" loading="lazy" alt="Shelf at \${p.outlet||'branch'}"></div>
     <div class="cap-title">\${p.outlet||'Unknown branch'}</div>
     <div class="cap-sub">\${p.retailer?p.retailer+' · ':''}\${p.date}</div>
   </a>\`
).join('') || '<p style="color:#8a92a6;font-size:13px;">No shelf photos in this dataset.</p>';
</script>
</body>
</html>
`;
}
