export type Vector3Like = {
  x: number;
  y: number;
  z: number;
};

export type { PlyHeaderDetection as PlyHeaderInfo } from "./PointCloudHeader";
import type { PlyHeaderDetection } from "./PointCloudHeader";
import type { OfficeMeasureModelDocument, SaveModelResult } from "./ModelTypes";
import type { PointRenderPreset, ViewerMode } from "./ViewerModeTypes";

export type PointCloudMetadata = {
  fileName: string;
  filePath?: string;
  pointCount: number;
  displayedPointCount: number;
  loadedPoints: number;
  totalPoints: number;
  hasRgb: boolean;
  detectedMode: ViewerMode;
  renderingMode: "Point Cloud" | "Gaussian Splat" | "Unknown";
  unit: "meter";
  loadingMode: "Direct PLY Mode" | "Gaussian Splat Mode" | "Preview Cache Mode" | "LOD Tile Mode";
  estimatedMemoryBytes: number;
  boundingBoxMin: Vector3Like;
  boundingBoxMax: Vector3Like;
  boundingBoxSize: Vector3Like;
  pointBudget: number;
  pointSizePx: number;
  currentPreset: PointRenderPreset;
  header: PlyHeaderDetection;
};

export type PlyFilePayload = {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  buffer: ArrayBuffer;
};

export type ScanFolderPayload = {
  selectedFolderPath: string;
  scanFolderPath: string;
  pointcloudPath?: string;
  metadataPath?: string;
  metadataJson?: string;
  roomplanPath?: string;
  roomplanJson?: string;
  roomplanUsdzPath?: string;
};

export type SaveCsvResult = {
  canceled: boolean;
  filePath?: string;
};

export type OfficeMeasureApi = {
  openPlyDialog: () => Promise<{ filePath: string; fileName: string } | null>;
  openScanFolderDialog: () => Promise<ScanFolderPayload | null>;
  readPlyFile: (filePath: string) => Promise<PlyFilePayload>;
  getSamplePlyPath: () => Promise<string>;
  saveCsv: (csv: string) => Promise<SaveCsvResult>;
  loadModel: (pointCloudPath: string) => Promise<OfficeMeasureModelDocument | null>;
  saveModel: (pointCloudPath: string, model: OfficeMeasureModelDocument) => Promise<SaveModelResult>;
};
