import type { Vector3Like } from "../../shared/types";
import type {
  AppliedPlaneConstraint,
  MeasurementPickPreset,
  MeasurementPickResult,
  MeasurementSnapPlane,
  StructuralBoundarySide,
  StructuralDimensionMode,
  TrustedPlaneQualityStatus
} from "../../shared/PointCloudDataSource";

export type MeasurementState = "idle" | "measuring_drag" | "measuring_plane" | "completed";
export type MeasurementDistanceMode = "3d" | "horizontal" | "vertical";

export type MeasurementRecord = {
  id: string;
  start: Vector3Like;
  end: Vector3Like;
  startSnap?: MeasurementPickResult;
  endSnap?: MeasurementPickResult;
  distanceMeters: number;
  distanceMode: MeasurementDistanceMode;
  source: "point_pair" | "structural_planes" | "structural_boundaries";
  measurementPreset: MeasurementPickPreset;
  rawStart: Vector3Like;
  rawEnd: Vector3Like;
  rawDistanceMeters: number;
  structuralLockId?: string;
  structuralHeightLocked?: boolean;
  uncertaintyMeters?: number;
  structuralBoundaryFit?: {
    dimension: StructuralDimensionMode;
    qualityStatus: TrustedPlaneQualityStatus;
    qualityIssues: string[];
    boundaries: Array<{
      side: StructuralBoundarySide;
      lineStart: Vector3Like;
      lineEnd: Vector3Like;
      rmsMeters: number;
      inlierCount: number;
      sliceCount: number;
      confidence: number;
    }>;
  };
  createdAtIso: string;
};

export type MeasurementPreview = {
  start: Vector3Like;
  current: Vector3Like;
  startSnap?: MeasurementPickResult;
  currentSnap?: MeasurementPickResult;
  distanceMeters: number;
  distanceMode: MeasurementDistanceMode;
};

export type PlaneMeasurementBasis = {
  normal: Vector3Like;
  horizontal: Vector3Like;
  vertical: Vector3Like;
  plane: MeasurementSnapPlane;
};

export type PlaneMeasurementPreview = {
  start: Vector3Like;
  current: Vector3Like;
  corners: [Vector3Like, Vector3Like, Vector3Like, Vector3Like];
  basis: PlaneMeasurementBasis;
  startSnap: MeasurementPickResult;
  widthMeters: number;
  heightMeters: number;
  areaSquareMeters: number;
};

export type PlaneMeasurementRecord = PlaneMeasurementPreview & {
  id: string;
  trustedFit?: {
    appliedConstraint: AppliedPlaneConstraint;
    qualityStatus: TrustedPlaneQualityStatus;
    qualityIssues: string[];
    inlierRatio: number;
    rmsMeters: number;
    madMeters?: number;
    orientationAdjustmentDegrees: number;
  };
  structuralFit?: {
    qualityStatus: TrustedPlaneQualityStatus;
    qualityIssues: string[];
    widthUncertaintyMeters: number;
    heightUncertaintyMeters: number;
    boundaries: Array<{
      side: StructuralBoundarySide;
      rmsMeters: number;
      inlierCount: number;
      sliceCount: number;
      confidence: number;
    }>;
  };
  createdAtIso: string;
};

export type ClearanceMeasurementRecord = {
  id: string;
  planePairId: string;
  probeIndex: number;
  upperPoint: Vector3Like;
  lowerPoint: Vector3Like;
  probePoint: Vector3Like;
  heightMeters: number;
  upperPlane: MeasurementSnapPlane;
  lowerPlane: MeasurementSnapPlane;
  upperPick: MeasurementPickResult;
  lowerPick: MeasurementPickResult;
  parallelAngleDegrees: number;
  uncertaintyMeters?: number;
  createdAtIso: string;
};
