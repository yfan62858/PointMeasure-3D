/** View-only transform: never changes geometry, dimensions, or exported images. */
export function installFloorplanZoom(viewport: HTMLElement, image: HTMLImageElement, output: HTMLElement, resetButton: HTMLButtonElement) {
  let zoom = 1, x = 0, y = 0;
  let drag: { id: number; x: number; y: number } | null = null;
  function update() {
    x = Math.max(viewport.clientWidth * (1 - zoom), Math.min(0, x));
    y = Math.max(viewport.clientHeight * (1 - zoom), Math.min(0, y));
    image.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    output.textContent = `${Math.round(zoom * 100)}%`;
    viewport.dataset.zoom = String(zoom);
    viewport.classList.toggle("is-zoomed", zoom > 1);
  }
  function endDrag() {
    if (drag && viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id);
    drag = null;
    viewport.classList.remove("is-dragging");
  }
  function reset() { endDrag(); zoom = 1; x = y = 0; update(); }
  viewport.addEventListener("wheel", event => {
    if (image.hidden || !image.hasAttribute("src")) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    const next = Math.max(1, Math.min(8, zoom * Math.exp(-Math.max(-300, Math.min(300, delta)) * .002)));
    const bounds = viewport.getBoundingClientRect();
    const px = event.clientX - bounds.left, py = event.clientY - bounds.top;
    x = px - (px - x) * next / zoom;
    y = py - (py - y) * next / zoom;
    zoom = next;
    update();
  }, { passive: false });
  viewport.addEventListener("pointerdown", event => {
    if (event.button !== 0 || zoom <= 1) return;
    event.preventDefault(); event.stopPropagation();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-dragging");
  });
  viewport.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault(); event.stopPropagation();
    x += event.clientX - drag.x; y += event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY; update();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) viewport.addEventListener(name, endDrag);
  image.addEventListener("dragstart", event => event.preventDefault());
  resetButton.addEventListener("click", reset);
  viewport.addEventListener("dblclick", reset);
  new ResizeObserver(update).observe(viewport);
  reset();
  return { reset };
}
