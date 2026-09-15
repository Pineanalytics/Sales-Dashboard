const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("consoleApi", {
  getStatus: () => ipcRenderer.invoke("status:get"),
  runAction: (actionId, payload = {}) => ipcRenderer.send("action:run", { actionId, payload }),
  onActionStarted: (callback) => ipcRenderer.on("action:started", (_event, value) => callback(value)),
  onActionLine: (callback) => ipcRenderer.on("action:line", (_event, value) => callback(value)),
  onActionDone: (callback) => ipcRenderer.on("action:done", (_event, value) => callback(value)),
});
