// The phone app: one self-contained page (no framework, no build step, nothing external),
// served at /phone and installable on Android via "Add to Home screen". Written as a
// String.raw template so backslashes in the page's regexes survive; the embedded script
// therefore must not contain backticks or "${".
//
// Setup is a one-time link generated on the PC (scripts\Show-Phone-Link.ps1):
//   https://<host>/phone#k=<phone key>&f=<fingerprint of the PC's public key>
// The fragment never leaves the phone. The page stores both, strips them from the URL,
// and from then on (a) authenticates to the relay with k and (b) refuses to encrypt a
// password/MFA code to any public key whose SHA-256 fingerprint isn't f - so a tampered
// relay can't substitute its own key and read the credentials.
export const PHONE_PAGE = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2563eb"><link rel="manifest" href="/phone/manifest">
<link rel="icon" href="/phone-icon-192.png"><link rel="apple-touch-icon" href="/phone-icon-192.png">
<title>Reports Control</title>
<style>
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--line:#e1e4ea;--text:#1c2330;--mute:#6b7280;--accent:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#0f1218;--card:#181c25;--line:#2a3040;--text:#e6e9ef;--mute:#98a1b3}}
*{box-sizing:border-box}body{margin:0;padding:16px 16px 40px;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:460px;margin:0 auto}h1{font-size:19px;margin:4px 0 12px}h2{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--mute);margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.chip{padding:4px 12px;border-radius:99px;font-size:13px;font-weight:600;background:#e5e7eb;color:#4b5563}
.ok{background:#dcfce7;color:#15803d}.warn{background:#fef3c7;color:#b45309}.bad{background:#fee2e2;color:#b91c1c}
input{width:100%;padding:13px;font-size:18px;border:1px solid var(--line);border-radius:10px;margin:8px 0 10px;background:var(--card);color:var(--text)}
button{padding:13px 16px;font-size:16px;font-weight:600;border:0;border-radius:10px;background:var(--accent);color:#fff;flex:1;min-width:120px}
button.alt{background:transparent;color:var(--text);border:1px solid var(--line)}button:disabled{opacity:.45}
.mute{color:var(--mute);font-size:14px}.msg{color:#b45309;min-height:1.3em;margin:6px 2px}ul{list-style:none;margin:0;padding:0}li{padding:7px 0;border-top:1px solid var(--line);font-size:14px}li:first-child{border-top:0}
</style></head><body><main>
<h1>Reports Control</h1>
<div class="card" id="setup" hidden><h2>One-time setup</h2><p class="mute">Open the setup link from the PC (run <b>scripts\Show-Phone-Link.ps1</b> there) on this phone. It pairs the app and pins the PC's encryption key.</p></div>
<div class="card" id="statusCard" hidden><div class="row"><span id="pcChip" class="chip">Checking...</span><span id="stChip" class="chip"></span></div><p id="stDetail" class="mute"></p><p id="warn" class="msg" style="color:#b91c1c"></p></div>
<div class="card" id="pwCard" hidden><h2>Sign in</h2><label for="pw" class="mute">Password</label>
<input id="pw" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off"><div class="row"><button id="pwGo">Sign in</button></div></div>
<div class="card" id="mfaCard" hidden><h2>MFA code</h2><label for="code" class="mute">6-digit code from your email</label>
<input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"><div class="row"><button id="mfaGo">Confirm code</button></div></div>
<div class="card" id="actCard" hidden><h2>Actions</h2><div class="row"><button class="alt" data-a="start">Start</button><button class="alt" data-a="stop">Stop</button><button class="alt" data-a="push-uploads">Push uploads</button></div>
<p class="mute" style="margin:14px 0 4px">Backfill a date (both reports)</p><div class="row"><input id="bfDate" type="date" style="flex:1;margin:0"><button id="bfGo" style="flex:0 0 auto">Run</button></div></div>
<p id="msg" class="msg"></p>
<div class="card" id="resCard" hidden><h2>Recent</h2><ul id="results"></ul></div>
</main><script>
var LS=window.localStorage,KEY='pr.k',FP='pr.f';
(function(){var h=location.hash.replace(/^#/,'');if(!h)return;var p={};h.split('&').forEach(function(x){var i=x.indexOf('=');if(i>0)p[x.slice(0,i)]=decodeURIComponent(x.slice(i+1))});
if(p.k&&p.f){LS.setItem(KEY,p.k);LS.setItem(FP,p.f.toLowerCase());history.replaceState(null,'',location.pathname)}})();
function $(i){return document.getElementById(i)}
function b64ToBytes(b){var s=atob(b),a=new Uint8Array(s.length);for(var i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a}
function bytesToB64(a){var s='';for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);return btoa(s)}
function hex(buf){return Array.prototype.map.call(new Uint8Array(buf),function(x){return ('0'+x.toString(16)).slice(-2)}).join('')}
function api(path,opts){opts=opts||{};opts.headers=Object.assign({'Content-Type':'application/json','x-phone-relay-key':LS.getItem(KEY)||''},opts.headers||{});
  return fetch(path,opts).then(function(r){return r.json().then(function(j){j._http=r.status;return j})})}
var view=null,pinnedOk=false;
async function checkPin(spki){if(!spki)return false;var fp=hex(await crypto.subtle.digest('SHA-256',b64ToBytes(spki)));return fp===LS.getItem(FP)}
async function encryptFor(spki,type,value){
  var key=await crypto.subtle.importKey('spki',b64ToBytes(spki),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  var n=hex(crypto.getRandomValues(new Uint8Array(12)).buffer);
  var data=new TextEncoder().encode(JSON.stringify({t:type,v:value,ts:Date.now(),n:n}));
  return bytesToB64(new Uint8Array(await crypto.subtle.encrypt({name:'RSA-OAEP'},key,data)))}
function chip(el,text,cls){el.textContent=text;el.className='chip '+(cls||'')}
function say(t){$('msg').textContent=t||''}
async function render(v){
  view=v;var auto=v.agents.automation,panel=v.agents.panel,st=auto.status||{};
  pinnedOk=await checkPin(v.publicKey);
  $('statusCard').hidden=false;$('actCard').hidden=false;
  chip($('pcChip'),auto.online?'PC automation online':(panel.online?'Automation offline - PC reachable':'PC offline'),auto.online?'ok':(panel.online?'warn':'bad'));
  var stage=auto.online?st.stage:null,map={'logged-in':['Logged in','ok'],'need-password':['Login needed','warn'],'need-mfa':['Code needed','warn'],'working':['Working...','warn']};
  var m=map[stage]||[(st.status||'-'),''];chip($('stChip'),m[0],m[1]);
  $('stDetail').textContent=st.message||(st.lastRun&&st.lastRun['document-listing-today']?'Last today-report: '+new Date(st.lastRun['document-listing-today']).toLocaleString():'');
  $('warn').textContent=(v.publicKey&&!pinnedOk)?'Security check failed: the PC key does not match the one pinned on this phone. Do not sign in. Re-open the setup link from the PC.':'';
  $('pwCard').hidden=stage!=='need-password';$('mfaCard').hidden=stage!=='need-mfa';
  var busy=stage==='working';$('pwGo').disabled=$('mfaGo').disabled=busy||!pinnedOk;
  var list=$('results');list.innerHTML='';v.results.forEach(function(r){var li=document.createElement('li');li.textContent=(r.ok?'OK  ':'FAIL  ')+r.type+(r.message?' - '+r.message:'');list.appendChild(li)});
  $('resCard').hidden=!v.results.length}
async function poll(){
  if(!LS.getItem(KEY)){$('setup').hidden=false;return}
  try{var v=await api('/api/phone-relay/status');if(v._http===401||v._http===429||v._http===503){$('statusCard').hidden=false;chip($('pcChip'),v._http===401?'Not authorised - re-open the setup link':(v.error||'Unavailable'),'bad');return}await render(v)}
  catch(e){$('statusCard').hidden=false;chip($('pcChip'),'No connection','bad')}}
async function send(type,extra){var r=await api('/api/phone-relay/commands',{method:'POST',body:JSON.stringify(Object.assign({type:type},extra||{}))});if(r.error)say(r.error);else say('Sent - waiting for the PC...');poll()}
$('pwGo').onclick=async function(){var p=$('pw').value;if(!p||!view||!pinnedOk)return;$('pwGo').disabled=true;say('');
  try{await send('login',{cipher:await encryptFor(view.publicKey,'login',p)})}catch(e){say('Could not encrypt - try again.')}$('pw').value=''};
$('mfaGo').onclick=async function(){var c=$('code').value.trim();if(!/^[0-9]{6}$/.test(c)){say('The code is 6 digits.');return}if(!view||!pinnedOk)return;$('mfaGo').disabled=true;say('');
  try{await send('mfa',{cipher:await encryptFor(view.publicKey,'mfa',c)})}catch(e){say('Could not encrypt - try again.')}$('code').value=''};
document.querySelectorAll('[data-a]').forEach(function(b){b.onclick=function(){var a=b.getAttribute('data-a');if(a==='stop'&&!confirm('Stop the automation?'))return;send(a)}});
$('bfGo').onclick=function(){var d=$('bfDate').value;if(!d){say('Pick a date.');return}if(confirm('Backfill both reports for '+d+'? This stops and restarts the automation.'))send('backfill',{date:d})};
var y=new Date(Date.now()-86400000);$('bfDate').value=y.getFullYear()+'-'+('0'+(y.getMonth()+1)).slice(-2)+'-'+('0'+y.getDate()).slice(-2);
if('serviceWorker' in navigator)navigator.serviceWorker.register('/phone/sw',{scope:'/phone'}).catch(function(){});
poll();setInterval(poll,3000);
</script></body></html>`;

export const PHONE_MANIFEST = {
  name: "Reports Control",
  short_name: "Reports",
  description: "Log in to and control the Scheduled Reports automation from your phone.",
  start_url: "/phone",
  scope: "/phone",
  display: "standalone",
  orientation: "portrait",
  background_color: "#f4f5f7",
  theme_color: "#2563eb",
  icons: [
    { src: "/phone-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "/phone-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
};

// Minimal service worker: present only so Android treats the page as an installable app.
// It deliberately never caches or intercepts anything - login state must always be live.
export const PHONE_SW = "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{});";
