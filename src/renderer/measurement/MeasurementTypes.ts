import type { Vector3Like } from "../../shared/types";
import type { MeasurementPickResult, MeasurementSnapPlane } from "../../shared/PointCloudDataSource";

export type MeasurementState = "idle" | "measuring_drag" | "measuring_plane" | "completed";

export type MeasurementRecord = {
  id: string;
  start: Vector3Like;
  end: Vector3Like;
  startSnap?: MeasurementPickResult;
  endSnap?: MeasurementPickResult;
  distanceMeters: number;
  createdAtIso: string;
};

export type MeasurementPreview = {
  start: Vector3Like;
  current: Vector3Like;
  startSnap?: MeasurementPickResult;
  currentSnap?: MeasurementPickResult;
  distanceMeters: number;
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
  createdAtIso: string;
};
