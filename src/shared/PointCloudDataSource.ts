import type { Vector3Like } from "./types";

export type CameraState = {
  position: Vector3Like;
  direction: Vector3Like;
};

export type PickQuery = {
  origin: Vector3Like;
  direction: Vector3Like;
  threshold: number;
};

export type PickResult = {
  point: Vector3Like;
  source: "display" | "raw" | "measurement_index";
  pointIndex?: number;
};

export type MeasurementSnapMode = "nearest" | "plane" | "edge" | "smart";
export type MeasurementPickQuality = "preview" | "final";
export type MeasurementSnapKind = "nearest" | "plane" | "edge";

export type MeasurementSnapPlane = {
  normal: Vector3Like;
  constant: number;
  inlierCount: number;
};

export type MeasurementSnapLine = {
  point: Vector3Like;
  direction: Vector3Like;
  inlierCount: number;
};

export type MeasurementLocalBox = {
  min: Vector3Like;
  max: Vector3Like;
};

export type MeasurementPickOptions = {
  mode: MeasurementSnapMode;
  quality: MeasurementPickQuality;
  radiusMeters: number;
};

export type MeasurementPickResult = {
  point: Vector3Like;
  rawPoint: Vector3Like;
  kind: MeasurementSnapKind;
  confidence: number;
  candidateCount: number;
  inlierCount: number;
  sourcePointIndex?: number;
  analysisRadiusMeters: number;
  plane?: MeasurementSnapPlane;
  secondaryPlane?: MeasurementSnapPlane;
  edge?: MeasurementSnapLine;
  localBox?: MeasurementLocalBox;
};

export interface MeasurementDataSource {
  pickPoint?(clientX: number, clientY: number): Vector3Like | null;
  pickMeasurementPoint?(clientX: number, clientY: number, options: MeasurementPickOptions): MeasurementPickResult | null;
  projectScreenToPlane?(clientX: number, clientY: number, plane: MeasurementSnapPlane): Vector3Like | null;
  pickNearestPoint(query: PickQuery): Promise<PickResult | null> | PickResult | null;
}

export interface PointCloudTile {
  id: string;
  loadedPoints: number;
  totalPoints: number;
}

export interface PointCloudDataSource {
  loadPreviewFromCache(projectPath: string): Promise<void>;
  loadTile(tileId: string): Promise<PointCloudTile>;
  unloadTile(tileId: string): Promise<void>;
  loadLodTiles(cameraState: CameraState): Promise<PointCloudTile[]>;
}
