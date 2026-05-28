const lamps = [...document.querySelectorAll(".lamp")];
const setupPanel = document.querySelector("#setupPanel");
const setupConfirm = document.querySelector("#setupConfirm");
const setupSkip = document.querySelector("#setupSkip");
const contextMenu = document.querySelector("#contextMenu");

const { core, event, window: tauriWindow } = window.__TAURI__;
const appWindow = tauriWindow.getCurrentWindow();

function setOrientation(orientation = "horizontal") {
  document.documentElement.dataset.orientation = orientation;
}

function paint({ currentState }) {
  const status = currentState.status || "yellow";
  lamps.forEach((lamp) => lamp.classList.toggle("active", lamp.dataset.status === status));
}

function hideContextMenu() {
  contextMenu.classList.add("hidden");
}

function showContextMenu(x, y) {
  contextMenu.classList.remove("hidden");
  const gap = 4;
  const rect = contextMenu.getBoundingClientRect();
  const left = Math.min(Math.max(gap, x), window.innerWidth - rect.width - gap);
  const top = Math.min(Math.max(gap, y), window.innerHeight - rect.height - gap);
  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
}

function showSetupPanel() {
  setupPanel.classList.remove("hidden");
}

function hideSetupPanel() {
  setupPanel.classList.add("hidden");
}

async function configureHooks() {
  await core.invoke("configure_cursor_hooks");
  hideSetupPanel();
}

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  showContextMenu(event.clientX, event.clientY);
});

window.addEventListener("pointerdown", async (event) => {
  if (
    event.button !== 0 ||
    event.target.closest("button") ||
    event.target.closest(".context-menu") ||
    event.target.closest(".setup-panel")
  ) {
    return;
  }
  hideContextMenu();
  try {
    await appWindow.startDragging();
    await core.invoke("snap_window");
  } catch (error) {
    console.error("Failed to drag window", error);
  }
});

window.addEventListener("blur", hideContextMenu);

contextMenu.addEventListener("click", async (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  hideContextMenu();

  if (action === "horizontal" || action === "vertical") {
    await core.invoke("set_orientation", { orientation: action });
  } else if (action === "configure") {
    await configureHooks();
  } else if (action === "quit") {
    await core.invoke("quit_app");
  }
});

setupConfirm.addEventListener("click", configureHooks);
setupSkip.addEventListener("click", hideSetupPanel);

core.invoke("get_state").then((state) => {
  setOrientation(state.orientation);
  paint(state);
  if (!state.hooksConfigured) showSetupPanel();
});

event.listen("hook-event", ({ payload }) => paint(payload));
event.listen("orientation-changed", ({ payload }) => setOrientation(payload));
