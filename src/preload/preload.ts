import { contextBridge, ipcRenderer } from "electron";
import type { OfficeMeasureApi, PlyFilePayload, SaveCsvResult, ScanFolderPayload } from "../shared/types";

const api: OfficeMeasureApi = {
  openPlyDialog: () => ipcRenderer.invoke("dialog:open-ply"),
  openScanFolderDialog: () => ipcRenderer.invoke("dialog:open-scan-folder") as Promise<ScanFolderPayload | null>,
  readPlyFile: (filePath: string) => ipcRenderer.invoke("file:read-ply", filePath) as Promise<PlyFilePayload>,
  getSamplePlyPath: () => ipcRenderer.invoke("file:sample-ply-path") as Promise<string>,
  saveCsv: (csv: string) => ipcRenderer.invoke("file:save-csv", csv) as Promise<SaveCsvResult>,
  loadModel: (pointCloudPath: string) => ipcRenderer.invoke("model:load", pointCloudPath),
  saveModel: (pointCloudPath: string, model) => ipcRenderer.invoke("model:save", pointCloudPath, model)
};

contextBridge.exposeInMainWorld("officeMeasure", api);
