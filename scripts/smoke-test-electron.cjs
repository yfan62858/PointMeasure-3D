const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const screenshotPath = path.join(root, "debug-smoke-pointcloud.png");

ipcMain.handle("dialog:open-ply", async () => null);
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

async function waitForTruthy(win, script, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await win.webContents.executeJavaScript(script);
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for: ${script}`);
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

  const logs = [];
  win.webContents.on("console-message", (_event, level, message) => {
    logs.push({ level, message });
  });

  await win.loadFile(path.join(root, "dist", "index.html"));
  await waitForTruthy(win, "document.querySelector('#loadSample') !== null");
  await win.webContents.executeJavaScript(`
    window.addEventListener('error', (event) => console.error('window-error', event.message));
    window.addEventListener('unhandledrejection', (event) => console.error('window-rejection', String(event.reason)));
  `);
  await win.webContents.executeJavaScript("document.querySelector('#loadSample').click()");
  await waitForTruthy(
    win,
    "document.querySelector('#cloudInfo')?.textContent?.includes('office_sample_300k.ply')"
  );

  const cloudInfo = await win.webContents.executeJavaScript("document.querySelector('#cloudInfo')?.innerText");
  const initialStatus = await win.webContents.executeJavaScript("document.querySelector('#hintStatus')?.textContent");
  try {
    await win.webContents.executeJavaScript(`
      {
      const filter = document.querySelector('#visualFilter');
      filter.value = 'strict';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `);
  } catch (error) {
    console.error("strict filter failed", error);
    console.error(JSON.stringify(logs, null, 2));
    throw error;
  }
  await waitForTruthy(
    win,
    "document.querySelector('#cloudInfo')?.textContent?.includes('loaded points')"
  );
  const strictCloudInfo = await win.webContents.executeJavaScript("document.querySelector('#cloudInfo')?.innerText");
  await win.webContents.executeJavaScript(`
    {
    const preset = document.querySelector('#renderPreset');
    preset.value = 'voxel';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    }
  `);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await win.webContents.executeJavaScript(`
    {
    const filter = document.querySelector('#visualFilter');
    filter.value = 'clean';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    }
  `);

  await win.webContents.executeJavaScript(`
    const measure = document.querySelector('#measureDistance');
    const canvas = document.querySelector('#viewport');
    measure.click();
    const rect = canvas.getBoundingClientRect();
    const y = rect.top + rect.height * 0.52;
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + rect.width * 0.44, clientY: y, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + rect.width * 0.56, clientY: y, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + rect.width * 0.56, clientY: y, button: 0 }));
  `);

  await new Promise((resolve) => setTimeout(resolve, 500));
  const recordText = await win.webContents.executeJavaScript("document.querySelector('#measurementRecords')?.innerText");
  const finalStatus = await win.webContents.executeJavaScript("document.querySelector('#hintStatus')?.textContent");
  const image = await win.webContents.capturePage();
  await fs.writeFile(screenshotPath, image.toPNG());

  console.log(JSON.stringify({
    cloudInfo,
    strictCloudInfo,
    initialStatus,
    recordText,
    finalStatus,
    logs: logs.filter((entry) => entry.level >= 2),
    screenshotPath
  }, null, 2));

  win.destroy();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
