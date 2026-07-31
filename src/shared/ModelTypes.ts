import type { Vector3Like } from "./types";
import type {
  AppliedPlaneConstraint,
  TrustedPlaneQualityStatus
} from "./PointCloudDataSource";

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
  inlierRatio?: number;
  rmsMeters?: number;
  madMeters?: number;
  planeConstraint?: AppliedPlaneConstraint;
  orientationAdjustmentDegrees?: number;
  qualityStatus?: TrustedPlaneQualityStatus;
  qualityIssues?: string[];
  measurementMethod?: "roi_plane" | "four_boundary_rectangle";
  widthUncertaintyMeters?: number;
  heightUncertaintyMeters?: number;
  sourcePointIndex?: number;
  visible: boolean;
  createdAtIso: string;
  updatedAtIso: string;
};

export type PointMeasureModelDocument = {
  schemaVersion: 1;
  pointCloudFilePath?: string;
  pointCloudFileName?: string;
  surfaces: PlaneModelSurface[];
};

export type SaveModelResult = {
  canceled: boolean;
  filePath?: string;
};
