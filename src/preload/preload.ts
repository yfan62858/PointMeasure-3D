import { contextBridge, ipcRenderer } from "electron";
import type { PointMeasureApi, PlyFilePayload, SaveCsvResult, ScanFolderPayload } from "../shared/types";

const api: PointMeasureApi = {
  loadFloorplan: (filePath, options) => ipcRenderer.invoke("floorplan:load", filePath, options),
  cancelFloorplan: () => ipcRenderer.invoke("floorplan:cancel"),
  onFloorplanProgress: callback => {const listener=(_event:Electron.IpcRendererEvent,text:string)=>callback(text);ipcRenderer.on("floorplan:progress",listener);return ()=>ipcRenderer.removeListener("floorplan:progress",listener);},
  exportFloorplan: (scanId, format, pngData) => ipcRenderer.invoke("floorplan:export", scanId, format, pngData),
  openPlyDialog: () => ipcRenderer.invoke("dialog:open-ply"),
  openScanFolderDialog: () => ipcRenderer.invoke("dialog:open-scan-folder") as Promise<ScanFolderPayload | null>,
  readPlyFile: (filePath: string) => ipcRenderer.invoke("file:read-ply", filePath) as Promise<PlyFilePayload>,
  getSamplePlyPath: () => ipcRenderer.invoke("file:sample-ply-path") as Promise<string>,
  saveCsv: (csv: string) => ipcRenderer.invoke("file:save-csv", csv) as Promise<SaveCsvResult>,
  loadModel: (pointCloudPath: string) => ipcRenderer.invoke("model:load", pointCloudPath),
  saveModel: (pointCloudPath: string, model) => ipcRenderer.invoke("model:save", pointCloudPath, model)
};

contextBridge.exposeInMainWorld("pointMeasure3D", api);
