import type { Vector3Like } from "../../shared/types";
import { eigenDecompositionSymmetric } from "../../cornerDetector";

export type PlaneEstimate = {
  normal: Vector3Like;
  constant: number;
};

export type RobustPlaneFitResult = PlaneEstimate & {
  inlierCount: number;
  rmsMeters: number;
  madMeters: number;
};

export function refinePlaneFromPoints(
  points: readonly Vector3Like[],
  initial: PlaneEstimate,
  distanceThreshold: number,
  iterationCount = 3
): RobustPlaneFitResult | null {
  if (points.length < 3 || distanceThreshold <= 0) {
    return null;
  }

  let current: PlaneEstimate = {
    normal: normalize(initial.normal),
    constant: initial.constant
  };
  let inliers: Vector3Like[] = [];

  for (let iteration = 0; iteration < iterationCount; iteration += 1) {
    const thresholdScale = iteration === 0 ? 1.35 : 1.12;
    inliers = points.filter((point) => pointPlaneDistance(point, current) <= distanceThreshold * thresholdScale);
    if (inliers.length < 3) {
      return null;
    }

    const refined = fitPlaneTls(inliers, current.normal, current);
    if (!refined) {
      return null;
    }
    current = refined;
  }

  inliers = points.filter((point) => pointPlaneDistance(point, current) <= distanceThreshold * 1.12);
  if (inliers.length < 3) {
    return null;
  }

  const finalPlane = fitPlaneTls(inliers, current.normal, current) ?? current;
  const residuals = inliers.map((point) => pointPlaneDistance(point, finalPlane));
  const squaredSum = residuals.reduce((sum, residual) => sum + residual * residual, 0);

  return {
    ...finalPlane,
    inlierCount: inliers.length,
    rmsMeters: Math.sqrt(squaredSum / Math.max(1, residuals.length)),
    madMeters: median(residuals)
  };
}

function fitPlaneTls(
  points: readonly Vector3Like[],
  preferredNormal: Vector3Like,
  referencePlane: PlaneEstimate
): PlaneEstimate | null {
  if (points.length < 3) {
    return null;
  }

  const signedResiduals = points.map((point) => signedPointPlaneDistance(point, referencePlane));
  const residualMedian = median(signedResiduals);
  const residualMad = median(signedResiduals.map((residual) => Math.abs(residual - residualMedian)));
  const robustScale = Math.max(residualMad * 1.4826, 0.001);

  let weightSum = 0;
  let meanX = 0;
  let meanY = 0;
  let meanZ = 0;
  const weights = signedResiduals.map((residual) => {
    const normalized = Math.abs(residual - residualMedian) / robustScale;
    const weight = normalized <= 1.5 ? 1 : 1.5 / normalized;
    weightSum += weight;
    return weight;
  });

  if (weightSum <= 0) {
    return null;
  }

  for (let index = 0; index < points.length; index += 1) {
    const weight = weights[index];
    meanX += points[index].x * weight;
    meanY += points[index].y * weight;
    meanZ += points[index].z * weight;
  }
  meanX /= weightSum;
  meanY /= weightSum;
  meanZ /= weightSum;

  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (let index = 0; index < points.length; index += 1) {
    const weight = weights[index];
    const dx = points[index].x - meanX;
    const dy = points[index].y - meanY;
    const dz = points[index].z - meanZ;
    xx += dx * dx * weight;
    xy += dx * dy * weight;
    xz += dx * dz * weight;
    yy += dy * dy * weight;
    yz += dy * dz * weight;
    zz += dz * dz * weight;
  }

  const eigen = eigenDecompositionSymmetric(
    xx / weightSum,
    xy / weightSum,
    xz / weightSum,
    yy / weightSum,
    yz / weightSum,
    zz / weightSum
  );
  let normal = normalize(eigen.vectors[0]);
  if (dot(normal, preferredNormal) < 0) {
    normal = scale(normal, -1);
  }

  const offsets = points.map((point) => dot(normal, point));
  return {
    normal,
    constant: -median(offsets)
  };
}

function signedPointPlaneDistance(point: Vector3Like, plane: PlaneEstimate): number {
  return dot(point, plane.normal) + plane.constant;
}

function pointPlaneDistance(point: Vector3Like, plane: PlaneEstimate): number {
  return Math.abs(signedPointPlaneDistance(point, plane));
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
}

function dot(a: Vector3Like, b: Vector3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function scale(vector: Vector3Like, scalar: number): Vector3Like {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function normalize(vector: Vector3Like): Vector3Like {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 1e-12 ? scale(vector, 1 / length) : { x: 0, y: 1, z: 0 };
}
