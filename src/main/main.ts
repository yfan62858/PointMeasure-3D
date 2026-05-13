import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { OfficeMeasureModelDocument } from "../shared/ModelTypes";

const isDev = process.env.NODE_ENV === "development";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "OfficeMeasure",
    backgroundColor: "#12161d",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    void mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("dialog:open-ply", async () => {
  const options: OpenDialogOptions = {
    title: "Import PLY",
    properties: ["openFile"],
    filters: [{ name: "PLY point cloud", extensions: ["ply"] }]
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  return {
    filePath,
    fileName: path.basename(filePath)
  };
});

ipcMain.handle("dialog:open-scan-folder", async () => {
  const options: OpenDialogOptions = {
    title: "Import Scan Folder",
    properties: ["openDirectory"]
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedFolderPath = result.filePaths[0];
  const scanFolderPath = await resolveScanFolderPath(selectedFolderPath);
  const pointcloudPath = path.join(scanFolderPath, "pointcloud.ply");
  const metadataPath = path.join(scanFolderPath, "metadata.json");
  const roomplanPath = path.join(scanFolderPath, "roomplan.json");
  const roomplanUsdzPath = path.join(scanFolderPath, "roomplan.usdz");

  return {
    selectedFolderPath,
    scanFolderPath,
    pointcloudPath: await pathExists(pointcloudPath) ? pointcloudPath : undefined,
    metadataPath: await pathExists(metadataPath) ? metadataPath : undefined,
    metadataJson: await readTextIfExists(metadataPath),
    roomplanPath: await pathExists(roomplanPath) ? roomplanPath : undefined,
    roomplanJson: await readTextIfExists(roomplanPath),
    roomplanUsdzPath: await pathExists(roomplanUsdzPath) ? roomplanUsdzPath : undefined
  };
});

ipcMain.handle("file:read-ply", async (_event, filePath: string) => {
  const data = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

  return {
    filePath,
    fileName: path.basename(filePath),
    sizeBytes: stat.size,
    buffer: arrayBuffer
  };
});

ipcMain.handle("file:sample-ply-path", async () => {
  return path.join(app.getAppPath(), "data", "office_sample_300k.ply");
});

ipcMain.handle("file:save-csv", async (_event, csv: string) => {
  const options: SaveDialogOptions = {
    title: "Export measurements.csv",
    defaultPath: "measurements.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }]
  };
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await fs.writeFile(result.filePath, csv, "utf8");
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("model:load", async (_event, pointCloudPath: string) => {
  const modelPath = getModelPath(pointCloudPath);
  if (!await pathExists(modelPath)) {
    return null;
  }

  const text = await fs.readFile(modelPath, "utf8");
  return JSON.parse(text) as OfficeMeasureModelDocument;
});

ipcMain.handle("model:save", async (_event, pointCloudPath: string, model: OfficeMeasureModelDocument) => {
  const modelPath = getModelPath(pointCloudPath);
  await fs.writeFile(modelPath, JSON.stringify(model, null, 2), "utf8");
  return { canceled: false, filePath: modelPath };
});

async function resolveScanFolderPath(selectedFolderPath: string): Promise<string> {
  if (await pathExists(path.join(selectedFolderPath, "pointcloud.ply"))) {
    return selectedFolderPath;
  }

  const entries = await fs.readdir(selectedFolderPath, { withFileTypes: true });
  const nestedScanFolders: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const childPath = path.join(selectedFolderPath, entry.name);
    if (await pathExists(path.join(childPath, "pointcloud.ply"))) {
      nestedScanFolders.push(childPath);
    }
  }

  if (nestedScanFolders.length === 1) {
    return nestedScanFolders[0];
  }

  return selectedFolderPath;
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  if (!await pathExists(filePath)) {
    return undefined;
  }

  return fs.readFile(filePath, "utf8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getModelPath(pointCloudPath: string): string {
  const directory = path.dirname(pointCloudPath);
  if (path.basename(pointCloudPath).toLowerCase() === "pointcloud.ply") {
    return path.join(directory, "officemeasure-model.json");
  }

  const parsed = path.parse(pointCloudPath);
  return path.join(directory, `${parsed.name}.officemeasure-model.json`);
}

void app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
