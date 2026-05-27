const lamps = [...document.querySelectorAll(".lamp")];
let isDragging = false;

function setOrientation(orientation = "horizontal") {
  document.documentElement.dataset.orientation = orientation;
}

function paint({ currentState }) {
  const status = currentState.status || "yellow";
  lamps.forEach((lamp) => lamp.classList.toggle("active", lamp.dataset.status === status));
}

window.cursorLight.getState().then((state) => {
  setOrientation(state.orientation);
  paint(state);
});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.cursorLight.showMenu();
});

window.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  isDragging = true;
  window.cursorLight.startDrag();
});

window.addEventListener("mouseup", () => {
  if (!isDragging) return;
  isDragging = false;
  window.cursorLight.stopDrag();
});

window.addEventListener("mouseleave", () => {
  if (!isDragging) return;
  isDragging = false;
  window.cursorLight.stopDrag();
});

window.cursorLight.onHookEvent(paint);
window.cursorLight.onOrientationChanged(setOrientation);
