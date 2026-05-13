import type { Vector3Like } from "./types";

export type ModelSurfaceKind = "door" | "wall" | "column_face" | "beam_face" | "cabinet_face" | "custom";

export type PlaneModelSurface = {
  id: string;
  name: string;
  kind: ModelSurfaceKind;
  corners: [Vector3Like, Vector3Like, Vector3Like, Vector3Like];
  normal: Vector3Like;
  horizontal: Vector3Like;
  vertical: Vector3Like;
  widthMeters: number;
  heightMeters: number;
  areaSquareMeters: number;
  confidence: number;
  inlierCount: number;
  candidateCount: number;
  sourcePointIndex?: number;
  visible: boolean;
  createdAtIso: string;
  updatedAtIso: string;
};

export type OfficeMeasureModelDocument = {
  schemaVersion: 1;
  pointCloudFilePath?: string;
  pointCloudFileName?: string;
  surfaces: PlaneModelSurface[];
};

export type SaveModelResult = {
  canceled: boolean;
  filePath?: string;
};
