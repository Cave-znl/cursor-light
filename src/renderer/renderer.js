const lamps = [...document.querySelectorAll(".lamp")];
const setupPanel = document.querySelector("#setupPanel");
const setupConfirm = document.querySelector("#setupConfirm");
const setupSkip = document.querySelector("#setupSkip");

const { core, event, window: tauriWindow } = window.__TAURI__;
const appWindow = tauriWindow.getCurrentWindow();

function setOrientation(orientation = "horizontal") {
  document.documentElement.dataset.orientation = orientation;
}

function paint({ currentState }) {
  const status = currentState.status || "yellow";
  lamps.forEach((lamp) => lamp.classList.toggle("active", lamp.dataset.status === status));
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
  core.invoke("show_context_menu", { x: event.clientX, y: event.clientY });
});

window.addEventListener("pointerdown", async (event) => {
  if (
    event.button !== 0 ||
    event.target.closest("button") ||
    event.target.closest(".setup-panel")
  ) {
    return;
  }
  try {
    await appWindow.startDragging();
  } catch (error) {
    console.error("Failed to drag window", error);
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
