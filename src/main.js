const { app, BrowserWindow, ipcMain, Menu, screen } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.CURSOR_LIGHT_PORT || 18765);
const MAX_BODY_BYTES = 1024 * 1024;
const SNAP_DISTANCE = 24;

let mainWindow;
let snapTimer;
let isApplyingBounds = false;
let dragTimer;
let dragStart;
let settings = {
  orientation: "horizontal"
};
let currentState = {
  status: "green",
  event: "ready",
  message: "Waiting for Cursor hooks",
  receivedAt: new Date().toISOString(),
  raw: null
};

const history = [];

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getSettingsPath(), "utf8"));
    if (parsed.orientation === "horizontal" || parsed.orientation === "vertical") {
      settings.orientation = parsed.orientation;
    }
  } catch {
    settings = { orientation: "horizontal" };
  }
}

function saveSettings() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function getWidgetSize(display = screen.getPrimaryDisplay()) {
  const { workArea } = display;
  const horizontal = {
    width: Math.max(120, Math.round(workArea.width / 10)),
    height: Math.max(56, Math.round(workArea.height / 15))
  };

  if (settings.orientation === "vertical") {
    return {
      width: Math.max(44, Math.round(workArea.width / 24)),
      height: Math.max(180, Math.round(workArea.height / 5.5))
    };
  }

  return horizontal;
}

function getInitialWidgetBounds() {
  const display = screen.getPrimaryDisplay();
  return {
    x: display.workArea.x,
    y: display.workArea.y,
    ...getWidgetSize(display)
  };
}

function snapBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const { workArea } = display;
  const size = getWidgetSize(display);
  let x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - size.width);
  let y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - size.height);

  if (Math.abs(x - workArea.x) <= SNAP_DISTANCE) x = workArea.x;
  if (Math.abs(y - workArea.y) <= SNAP_DISTANCE) y = workArea.y;
  if (Math.abs(x + size.width - (workArea.x + workArea.width)) <= SNAP_DISTANCE) {
    x = workArea.x + workArea.width - size.width;
  }
  if (Math.abs(y + size.height - (workArea.y + workArea.height)) <= SNAP_DISTANCE) {
    y = workArea.y + workArea.height - size.height;
  }

  return { x, y, ...size };
}

function setWindowBounds(bounds, animate = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  isApplyingBounds = true;
  mainWindow.setBounds(bounds, animate);
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  setTimeout(() => {
    isApplyingBounds = false;
  }, 0);
}

function applyWidgetBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  setWindowBounds(snapBounds(mainWindow.getBounds()), true);
}

function setOrientation(orientation) {
  if (orientation !== "horizontal" && orientation !== "vertical") return;
  settings.orientation = orientation;
  saveSettings();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("orientation-changed", settings.orientation);
    applyWidgetBounds();
  }
}

function showContextMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "横向",
      type: "radio",
      checked: settings.orientation === "horizontal",
      click: () => setOrientation("horizontal")
    },
    {
      label: "竖向",
      type: "radio",
      checked: settings.orientation === "vertical",
      click: () => setOrientation("vertical")
    },
    {
      type: "separator"
    },
    {
      label: "退出",
      click: () => app.quit()
    }
  ]);

  menu.popup({ window: mainWindow });
}

function scheduleSnap() {
  if (!mainWindow || mainWindow.isDestroyed() || isApplyingBounds) return;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    setWindowBounds(snapBounds(mainWindow.getBounds()), true);
  }, 120);
}

function startDrag() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearInterval(dragTimer);
  clearTimeout(snapTimer);

  dragStart = {
    cursor: screen.getCursorScreenPoint(),
    bounds: mainWindow.getBounds()
  };

  dragTimer = setInterval(() => {
    if (!dragStart || !mainWindow || mainWindow.isDestroyed()) return;

    const cursor = screen.getCursorScreenPoint();
    const nextBounds = {
      ...dragStart.bounds,
      x: dragStart.bounds.x + cursor.x - dragStart.cursor.x,
      y: dragStart.bounds.y + cursor.y - dragStart.cursor.y
    };

    setWindowBounds(nextBounds, false);
  }, 16);
}

function stopDrag() {
  clearInterval(dragTimer);
  dragTimer = null;
  dragStart = null;
  applyWidgetBounds();
}

function normalizeStatus(value, eventName, payload) {
  const text = String(value || eventName || "").toLowerCase();
  const failed = payload && (payload.error || payload.exitCode > 0 || payload.success === false);

  if (failed || /fail|error|deny|reject|cancel|exception/.test(text)) return "red";
  if (/before|pre|start|running|pending|tooluse|submit|write|edit|shell/.test(text)) return "yellow";
  if (/after|post|stop|done|success|complete|accept|green/.test(text)) return "green";
  if (/red|yellow|green/.test(text)) return text.match(/red|yellow|green/)[0];

  return "yellow";
}

function summarize(payload) {
  if (!payload || typeof payload !== "object") return "Hook event received";

  if (payload.message) return String(payload.message);
  if (payload.toolName || payload.tool_name) return `Tool: ${payload.toolName || payload.tool_name}`;
  if (payload.command) return `Command: ${payload.command}`;
  if (payload.prompt) return "Prompt submitted";
  if (payload.file || payload.path) return `File: ${payload.file || payload.path}`;

  return "Hook event received";
}

function pushEvent(payload = {}) {
  const eventName = payload.event || payload.hook || payload.hookEventName || payload.type || "hook";
  const status = normalizeStatus(payload.status, eventName, payload);
  currentState = {
    status,
    event: String(eventName),
    message: summarize(payload),
    receivedAt: new Date().toISOString(),
    raw: payload
  };

  history.unshift(currentState);
  history.splice(30);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("hook-event", { currentState, history });
  }
}

function createServer() {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ currentState, history }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/hook") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }

    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8").trim();
      let payload = {};

      if (body) {
        try {
          payload = JSON.parse(body);
        } catch {
          payload = { message: body };
        }
      }

      pushEvent(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, state: currentState }));
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Cursor Light hook receiver listening on http://${HOST}:${PORT}/hook`);
  });

  server.on("error", (error) => {
    console.error("Hook receiver failed:", error);
  });
}

function createWindow() {
  const bounds = getInitialWidgetBounds();

  mainWindow = new BrowserWindow({
    ...bounds,
    title: "Cursor Light",
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: "#101214",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.on("blur", () => {
    mainWindow.setAlwaysOnTop(true, "screen-saver");
  });
  mainWindow.on("move", () => {
    if (!dragStart) scheduleSnap();
  });
  mainWindow.on("system-context-menu", (event) => {
    event.preventDefault();
    showContextMenu();
  });
  mainWindow.webContents.on("context-menu", showContextMenu);

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("state:get", () => ({
  currentState,
  history,
  port: PORT,
  orientation: settings.orientation,
  hookScript: path.join(app.getAppPath(), "hooks", "cursor-hook.js")
}));
ipcMain.on("menu:show", showContextMenu);
ipcMain.on("drag:start", startDrag);
ipcMain.on("drag:stop", stopDrag);

app.whenReady().then(() => {
  loadSettings();
  createServer();
  createWindow();

  screen.on("display-metrics-changed", applyWidgetBounds);
  screen.on("display-added", applyWidgetBounds);
  screen.on("display-removed", applyWidgetBounds);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
