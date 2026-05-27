const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cursorLight", {
  getState: () => ipcRenderer.invoke("state:get"),
  showMenu: () => ipcRenderer.send("menu:show"),
  startDrag: () => ipcRenderer.send("drag:start"),
  stopDrag: () => ipcRenderer.send("drag:stop"),
  onHookEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("hook-event", listener);
    return () => ipcRenderer.removeListener("hook-event", listener);
  },
  onOrientationChanged: (callback) => {
    const listener = (_event, orientation) => callback(orientation);
    ipcRenderer.on("orientation-changed", listener);
    return () => ipcRenderer.removeListener("orientation-changed", listener);
  }
});
