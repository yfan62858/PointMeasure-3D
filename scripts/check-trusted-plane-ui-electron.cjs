const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    webPreferences: {
      preload: path.join(root, "dist-electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(root, "dist", "index.html"));
  const result = await win.webContents.executeJavaScript(`(() => {
    const plane = document.querySelector('#measurePlane');
    const clearance = document.querySelector('#measureClearance');
    const constraint = document.querySelector('#planeConstraint');
    const dimension = document.querySelector('#structuralDimension');
    const canvas = document.querySelector('#viewport');
    const overlay = document.querySelector('#planeRoiOverlay');
    if (!plane || !clearance || !constraint || !dimension || !canvas || !overlay) {
      return { ok: false, reason: 'missing trusted plane controls' };
    }

    plane.click();
    const activated = plane.classList.contains('active');
    const canvasBounds = canvas.getBoundingClientRect();
    const startX = canvasBounds.left + 80;
    const startY = canvasBounds.top + 70;
    canvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      clientX: startX,
      clientY: startY
    }));
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: startX + 180,
      clientY: startY + 120
    }));
    const roiVisible = overlay.classList.contains('visible') &&
      Number.parseFloat(overlay.style.width) >= 170 &&
      Number.parseFloat(overlay.style.height) >= 110 &&
      overlay.dataset.label === '可信主平面';
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Escape' }));
    const escaped = !overlay.classList.contains('visible');

    return {
      ok: activated && plane.textContent.includes('梁柱') &&
        dimension.value === 'height' &&
        clearance.disabled && constraint.value === 'auto' && roiVisible && escaped,
      activated,
      toolLabel: plane.textContent,
      clearanceDisabled: clearance.disabled,
      defaultConstraint: constraint.value,
      defaultDimension: dimension.value,
      roiVisible,
      escaped
    };
  })()`);

  console.log(JSON.stringify(result, null, 2));
  win.destroy();
  app.quit();
  if (!result.ok) {
    process.exitCode = 1;
  }
}).catch((error) => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
