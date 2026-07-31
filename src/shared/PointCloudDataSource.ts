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
export type MeasurementSnapKind = "nearest" | "plane" | "edge" | "mesh";
export type MeasurementPickPreset = "generic" | "beam_column";
export type MeasurementPlaneConstraint = "auto" | "horizontal" | "vertical" | "free";
export type AppliedPlaneConstraint = Exclude<MeasurementPlaneConstraint, "auto">;
export type TrustedPlaneQualityStatus = "good" | "check" | "rejected";
export type StructuralBoundarySide = "top" | "bottom" | "left" | "right";
export type StructuralDimensionMode = "height" | "width";

export type ScreenRectangle = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type MeasurementSnapPlane = {
  normal: Vector3Like;
  constant: number;
  inlierCount: number;
  rmsMeters?: number;
  madMeters?: number;
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
  preset?: MeasurementPickPreset;
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
  modelSurfaceIds?: string[];
  modelSnapKind?: "surface_edge" | "surface_intersection";
  structuralBoundary?: "horizontal";
  detectedCorner?: boolean;
  localCorner?: boolean;
};

export type TrustedPlaneFitResult = {
  plane: MeasurementSnapPlane;
  point: Vector3Like;
  horizontal: Vector3Like;
  vertical: Vector3Like;
  corners: [Vector3Like, Vector3Like, Vector3Like, Vector3Like];
  localBox: MeasurementLocalBox;
  widthMeters: number;
  heightMeters: number;
  areaSquareMeters: number;
  candidateCount: number;
  inlierCount: number;
  inlierRatio: number;
  confidence: number;
  requestedConstraint: MeasurementPlaneConstraint;
  appliedConstraint: AppliedPlaneConstraint;
  orientationAdjustmentDegrees: number;
  qualityStatus: TrustedPlaneQualityStatus;
  qualityIssues: string[];
  inlierPreviewPoints: Vector3Like[];
  outlierPreviewPoints: Vector3Like[];
};

export type StructuralBoundaryFitResult = {
  side: StructuralBoundarySide;
  line: MeasurementSnapLine;
  lineStart: Vector3Like;
  lineEnd: Vector3Like;
  offsetMeters: number;
  centerOffsetMeters: number;
  candidateCount: number;
  planePointCount: number;
  inlierCount: number;
  sliceCount: number;
  tangentMinimumMeters: number;
  tangentMaximumMeters: number;
  tangentSpanMeters: number;
  rmsMeters: number;
  madMeters: number;
  screenMarginPixels: number;
  confidence: number;
  qualityStatus: TrustedPlaneQualityStatus;
  qualityIssues: string[];
  inlierPreviewPoints: Vector3Like[];
};

export type StructuralSpanFitResult = {
  dimension: StructuralDimensionMode;
  start: Vector3Like;
  end: Vector3Like;
  distanceMeters: number;
  uncertaintyMeters: number;
  confidence: number;
  qualityStatus: TrustedPlaneQualityStatus;
  qualityIssues: string[];
  boundaries: [StructuralBoundaryFitResult, StructuralBoundaryFitResult];
};

export type StructuralRectangleFitResult = {
  corners: [Vector3Like, Vector3Like, Vector3Like, Vector3Like];
  widthMeters: number;
  heightMeters: number;
  areaSquareMeters: number;
  widthUncertaintyMeters: number;
  heightUncertaintyMeters: number;
  confidence: number;
  qualityStatus: TrustedPlaneQualityStatus;
  qualityIssues: string[];
  boundaries: [
    StructuralBoundaryFitResult,
    StructuralBoundaryFitResult,
    StructuralBoundaryFitResult,
    StructuralBoundaryFitResult
  ];
};

export interface MeasurementDataSource {
  pickPoint?(clientX: number, clientY: number): Vector3Like | null;
  pickMeasurementPoint?(clientX: number, clientY: number, options: MeasurementPickOptions): MeasurementPickResult | null;
  fitMeasurementPlaneRegion?(
    rectangle: ScreenRectangle,
    constraint: MeasurementPlaneConstraint,
    options: MeasurementPickOptions
  ): TrustedPlaneFitResult | null;
  fitStructuralBoundaryRegion?(
    rectangle: ScreenRectangle,
    plane: TrustedPlaneFitResult,
    side: StructuralBoundarySide,
    options: MeasurementPickOptions
  ): StructuralBoundaryFitResult | null;
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
