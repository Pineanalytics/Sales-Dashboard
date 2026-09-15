const { app, BrowserWindow, Tray, Menu, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const APP_ROOT = __dirname;
const CONFIG_PATH = path.join(APP_ROOT, "config.json");
const SCRIPTS = {
  status: "Get-Status.ps1",
  start: "Start-Smart.ps1",
  stop: "Stop-Smart.ps1",
  pause: "Pause-Smart.ps1",
  resume: "Resume-Smart.ps1",
  backfill: "Backfill-Date.ps1",
};
let mainWindow;
let tray;
let activeRun = null;

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (!["NAIROBI", "NYERI"].includes(String(config.branch).toUpperCase())) throw new Error("config.json branch must be NAIROBI or NYERI.");
  if (!config.projectPath) throw new Error("config.json projectPath is required.");
  return { branch: String(config.branch).toUpperCase(), projectPath: String(config.projectPath) };
}

function powershell(script, args = [], onLine) {
  return spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { cwd: APP_ROOT, windowsHide: true });
}

function stream(child, send) {
  for (const [stream, name] of [[child.stdout, "out"], [child.stderr, "err"]]) {
    let pending = "";
    stream.on("data", (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) if (line) send(name, line);
    });
    stream.on("end", () => { if (pending) send(name, pending); });
  }
}

function getStatus() {
  return new Promise((resolve) => {
    let config;
    try { config = loadConfig(); } catch (error) { resolve({ ok: false, error: error.message }); return; }
    const child = powershell(path.join(APP_ROOT, "scripts", SCRIPTS.status), ["-ProjectPath", config.projectPath]);
    let output = "";
    child.stdout.on("data", (data) => { output += data.toString(); });
    child.on("error", (error) => resolve({ ok: false, error: error.message }));
    child.on("close", (code) => {
      try { resolve({ ok: code === 0, config, ...JSON.parse(output) }); }
      catch { resolve({ ok: false, config, error: output.trim() || "Unable to read local sync status." }); }
    });
  });
}

function validate(actionId, payload) {
  if (!["start", "stop", "pause", "resume", "backfill"].includes(actionId)) throw new Error("Unsupported action.");
  if (actionId === "backfill" && !/^\d{4}-\d{2}-\d{2}$/.test(String(payload?.date || ""))) throw new Error("Select a valid YYYY-MM-DD backfill date.");
}

ipcMain.handle("status:get", getStatus);
ipcMain.on("action:run", (event, { actionId, payload }) => {
  if (activeRun) { event.sender.send("action:done", { ok: false, error: "Another action is already running." }); return; }
  let config;
  try { validate(actionId, payload); config = loadConfig(); }
  catch (error) { event.sender.send("action:done", { ok: false, error: error.message }); return; }
  const args = ["-ProjectPath", config.projectPath];
  if (actionId === "backfill") args.push("-Date", payload.date);
  const child = powershell(path.join(APP_ROOT, "scripts", SCRIPTS[actionId]), args, () => {});
  activeRun = actionId;
  event.sender.send("action:started", { actionId });
  stream(child, (stream, text) => event.sender.send("action:line", { stream, text }));
  child.on("error", (error) => { activeRun = null; event.sender.send("action:done", { ok: false, error: error.message }); });
  child.on("close", (code) => { activeRun = null; event.sender.send("action:done", { actionId, ok: code === 0, code }); });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980, height: 720, minWidth: 860, minHeight: 620,
    title: "Pinefrost Centegy Sync Console",
    icon: path.join(APP_ROOT, "renderer", "pinefrost-icon.png"),
    webPreferences: { preload: path.join(APP_ROOT, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(APP_ROOT, "renderer", "index.html"));
  mainWindow.on("close", (event) => { if (!app.isQuitting) { event.preventDefault(); mainWindow.hide(); } });
}

app.whenReady().then(() => {
  createWindow();
  tray = new Tray(path.join(APP_ROOT, "renderer", "pinefrost-icon.png"));
  tray.setToolTip("Pinefrost Centegy Sync Console");
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "Open", click: () => mainWindow.show() }, { type: "separator" }, { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } }]));
  tray.on("click", () => mainWindow.show());
  app.on("activate", () => mainWindow.show());
});
app.on("window-all-closed", () => {});
