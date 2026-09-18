const output=document.querySelector("#output");const buttons=[...document.querySelectorAll("button")];let busy=false;
const line=(text,kind="")=>{output.textContent+= "\n"+text;output.scrollTop=output.scrollHeight;if(kind==="err")output.classList.add("has-error")};
const date=new Date().toISOString().slice(0,10);document.querySelector("#date").value=date;
function setBusy(value){busy=value;buttons.forEach(button=>button.disabled=value)}
function fmt(value){return value?new Date(value).toLocaleString():"-"}
async function refresh(){const status=await window.consoleApi.getStatus();document.querySelector("#scope").textContent=status.config?status.config.branch+" - "+status.config.projectPath:(status.error||"Configuration unavailable");document.querySelector("#health").textContent=status.ok?"Local checks available":"Needs attention";const tasks=document.querySelector("#tasks");tasks.replaceChildren();for(const task of status.tasks||[]){const row=document.createElement("div");row.className="task";for(const value of [task.name,task.state,"Last: "+fmt(task.lastRunTime),"Result: "+(task.lastTaskResult??"-")]){const cell=document.createElement("span");cell.textContent=value;row.append(cell)}tasks.append(row)}}
document.querySelector("#refresh").onclick=refresh;
document.querySelectorAll("[data-action]").forEach(button=>button.onclick=()=>{const action=button.dataset.action;if((action==="stop"||action==="pause")&&!confirm("Confirm "+action+" of the Smart task."))return;output.textContent="";window.consoleApi.runAction(action)});
document.querySelector("#backfill").onclick=()=>{const selected=document.querySelector("#date").value;if(!selected)return;if(!confirm("Run a Sales & Returns backfill for "+selected+"?"))return;output.textContent="";window.consoleApi.runAction("backfill",{date:selected})};
window.consoleApi.onActionStarted(({actionId})=>{setBusy(true);line("Started: "+actionId)});
window.consoleApi.onActionLine(({stream,text})=>line(text,stream));
window.consoleApi.onActionDone((result)=>{setBusy(false);line(result.ok?"Completed successfully.":"Failed: "+(result.error||"exit code "+result.code));refresh()});
refresh();setInterval(()=>{if(!busy)refresh()},8000);
