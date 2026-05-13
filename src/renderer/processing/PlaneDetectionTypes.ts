import type { Vector3Like } from "../../shared/types";

export type PlaneDetectionMethod = "ransac";

export type PlaneDetectionOptions = {
  method: PlaneDetectionMethod;
  distanceThresholdMeters: number;
  maxIterations: number;
};

export type DetectedPlane = {
  normal: Vector3Like;
  constant: number;
  inlierCount: number;
};
