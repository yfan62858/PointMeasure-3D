const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const screenshotPath = path.join(root, ".codex-tmp", "debug-trusted-plane.png");

ipcMain.handle("dialog:open-ply", async () => null);
ipcMain.handle("dialog:open-scan-folder", async () => null);
ipcMain.handle("file:read-ply", async (_event, filePath) => {
  const data = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  return {
    filePath,
    fileName: path.basename(filePath),
    sizeBytes: stat.size,
    buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  };
});
ipcMain.handle("file:sample-ply-path", async () => path.join(root, "data", "office_sample_300k.ply"));
ipcMain.handle("file:save-csv", async () => ({ canceled: true }));
ipcMain.handle("model:load", async () => null);
ipcMain.handle("model:save", async () => ({ canceled: true }));

async function waitFor(win, predicate, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await win.webContents.executeJavaScript(predicate)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for ${predicate}`);
}

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    webPreferences: {
      preload: path.join(root, "dist-electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const errors = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) errors.push(message);
  });
  await win.loadFile(path.join(root, "dist", "index.html"));
  await win.webContents.executeJavaScript("document.querySelector('#loadSample').click()");
  await waitFor(win, "document.querySelector('#cloudInfo')?.textContent?.includes('office_sample_300k.ply')");
  await new Promise((resolve) => setTimeout(resolve, 700));
  await win.webContents.executeJavaScript("document.querySelector('#measurePlane').click()");

  const regions = [
    [0.08, 0.12, 0.34, 0.38],
    [0.36, 0.12, 0.64, 0.38],
    [0.66, 0.12, 0.92, 0.38],
    [0.08, 0.4, 0.34, 0.67],
    [0.36, 0.4, 0.64, 0.67],
    [0.66, 0.4, 0.92, 0.67],
    [0.08, 0.69, 0.34, 0.92],
    [0.36, 0.69, 0.64, 0.92],
    [0.66, 0.69, 0.92, 0.92]
  ];
  const attempts = [];

  for (const region of regions) {
    await win.webContents.executeJavaScript(`(() => {
      const canvas = document.querySelector('#viewport');
      const bounds = canvas.getBoundingClientRect();
      const startX = bounds.left + bounds.width * ${region[0]};
      const startY = bounds.top + bounds.height * ${region[1]};
      const endX = bounds.left + bounds.width * ${region[2]};
      const endY = bounds.top + bounds.height * ${region[3]};
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button: 0, clientX: startX, clientY: startY
      }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: endX, clientY: endY
      }));
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, button: 0, clientX: endX, clientY: endY
      }));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const hint = await win.webContents.executeJavaScript(
      "document.querySelector('#hintStatus')?.textContent"
    );
    const acceptedMainPlane = hint?.includes("主平面已通過");
    const prematureModelCount = await win.webContents.executeJavaScript(
      "document.querySelectorAll('.model-surface').length"
    );
    attempts.push({ region, hint, acceptedMainPlane, prematureModelCount });
    if (acceptedMainPlane) {
      break;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage();
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await fs.writeFile(screenshotPath, image.toPNG());
  const acceptedMainPlane = attempts.some((attempt) => attempt.acceptedMainPlane);
  const noPrematureDimensions = attempts.every((attempt) => attempt.prematureModelCount === 0);
  const actionableErrors = errors.filter(
    (message) => !message.includes("Electron Security Warning")
  );
  console.log(
    JSON.stringify({
      acceptedMainPlane,
      noPrematureDimensions,
      attempts,
      errors: actionableErrors,
      screenshotPath
    }, null, 2)
  );

  win.destroy();
  app.quit();
  if (!acceptedMainPlane || !noPrematureDimensions || actionableErrors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
