import type {
  AppliedPlaneConstraint,
  MeasurementPlaneConstraint,
  TrustedPlaneQualityStatus
} from "../../shared/PointCloudDataSource";
import type { Vector3Like } from "../../shared/types";
import { refinePlaneFromPoints, type PlaneEstimate } from "./RobustPlaneFit";

export type ConstrainedPlaneFit = PlaneEstimate & {
  inlierIndices: number[];
  inlierCount: number;
  rmsMeters: number;
  madMeters: number;
  requestedConstraint: MeasurementPlaneConstraint;
  appliedConstraint: AppliedPlaneConstraint;
  orientationAdjustmentDegrees: number;
};

export type PlaneSupportGeometry = {
  point: Vector3Like;
  horizontal: Vector3Like;
  vertical: Vector3Like;
  corners: [Vector3Like, Vector3Like, Vector3Like, Vector3Like];
  widthMeters: number;
  heightMeters: number;
  areaSquareMeters: number;
};

export type TrustedPlaneQuality = {
  status: TrustedPlaneQualityStatus;
  confidence: number;
  issues: string[];
};

export function fitStructurallyConstrainedPlane(
  points: readonly Vector3Like[],
  initial: PlaneEstimate,
  requestedConstraint: MeasurementPlaneConstraint,
  distanceThreshold: number
): ConstrainedPlaneFit | null {
  if (points.length < 3 || distanceThreshold <= 0) {
    return null;
  }

  const initialNormal = normalize(initial.normal);
  const appliedConstraint = resolvePlaneConstraint(initialNormal, requestedConstraint);
  const constrainedNormal = getConstrainedNormal(initialNormal, appliedConstraint);
  const orientationAdjustmentDegrees = angleBetweenAxesDegrees(initialNormal, constrainedNormal);

  if (appliedConstraint === "free") {
    const refined = refinePlaneFromPoints(points, {
      normal: initialNormal,
      constant: initial.constant
    }, distanceThreshold);
    if (!refined) {
      return null;
    }

    const inlierIndices = collectInlierIndices(points, refined, distanceThreshold * 1.12);
    return {
      ...refined,
      inlierIndices,
      requestedConstraint,
      appliedConstraint,
      orientationAdjustmentDegrees
    };
  }

  let plane: PlaneEstimate = {
    normal: constrainedNormal,
    constant: initial.constant
  };
  let inlierIndices = collectInlierIndices(points, initial, distanceThreshold * 1.5);
  if (inlierIndices.length < 3) {
    inlierIndices = points.map((_, index) => index);
  }

  for (let iteration = 0; iteration < 3; iteration += 1) {
    plane = {
      normal: constrainedNormal,
      constant: -median(inlierIndices.map((index) => dot(constrainedNormal, points[index])))
    };
    inlierIndices = collectInlierIndices(points, plane, distanceThreshold * 1.12);
    if (inlierIndices.length < 3) {
      return null;
    }
  }

  const residuals = inlierIndices.map((index) => pointPlaneDistance(points[index], plane));
  const squaredSum = residuals.reduce((sum, residual) => sum + residual * residual, 0);
  return {
    ...plane,
    inlierIndices,
    inlierCount: inlierIndices.length,
    rmsMeters: Math.sqrt(squaredSum / Math.max(1, residuals.length)),
    madMeters: median(residuals),
    requestedConstraint,
    appliedConstraint,
    orientationAdjustmentDegrees
  };
}

export function createPlaneSupportGeometry(
  points: readonly Vector3Like[],
  plane: PlaneEstimate,
  appliedConstraint: AppliedPlaneConstraint
): PlaneSupportGeometry | null {
  if (points.length < 3) {
    return null;
  }

  const normal = normalize(plane.normal);
  const { horizontal, vertical } = createStructuralPlaneBasis(normal, appliedConstraint);
  let minHorizontal = Number.POSITIVE_INFINITY;
  let maxHorizontal = Number.NEGATIVE_INFINITY;
  let minVertical = Number.POSITIVE_INFINITY;
  let maxVertical = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    const horizontalOffset = dot(point, horizontal);
    const verticalOffset = dot(point, vertical);
    minHorizontal = Math.min(minHorizontal, horizontalOffset);
    maxHorizontal = Math.max(maxHorizontal, horizontalOffset);
    minVertical = Math.min(minVertical, verticalOffset);
    maxVertical = Math.max(maxVertical, verticalOffset);
  }

  const widthMeters = maxHorizontal - minHorizontal;
  const heightMeters = maxVertical - minVertical;
  if (!Number.isFinite(widthMeters) || !Number.isFinite(heightMeters)) {
    return null;
  }

  const planeOrigin = scale(normal, -plane.constant);
  const corners: [Vector3Like, Vector3Like, Vector3Like, Vector3Like] = [
    add(planeOrigin, add(scale(horizontal, minHorizontal), scale(vertical, minVertical))),
    add(planeOrigin, add(scale(horizontal, maxHorizontal), scale(vertical, minVertical))),
    add(planeOrigin, add(scale(horizontal, maxHorizontal), scale(vertical, maxVertical))),
    add(planeOrigin, add(scale(horizontal, minHorizontal), scale(vertical, maxVertical)))
  ];
  const point = scale(add(corners[0], corners[2]), 0.5);

  return {
    point,
    horizontal,
    vertical,
    corners,
    widthMeters,
    heightMeters,
    areaSquareMeters: widthMeters * heightMeters
  };
}

export function evaluateTrustedPlaneQuality(params: {
  candidateCount: number;
  inlierCount: number;
  rmsMeters: number;
  widthMeters: number;
  heightMeters: number;
  requestedConstraint: MeasurementPlaneConstraint;
  appliedConstraint: AppliedPlaneConstraint;
  orientationAdjustmentDegrees: number;
}): TrustedPlaneQuality {
  const inlierRatio = params.inlierCount / Math.max(1, params.candidateCount);
  const minimumSpan = Math.min(params.widthMeters, params.heightMeters);
  const issues: string[] = [];
  let rejected = false;

  if (params.candidateCount < 45) {
    issues.push("框選點數不足");
    rejected = true;
  }
  if (params.inlierCount < 36) {
    issues.push("平面內點不足");
    rejected = true;
  }
  if (inlierRatio < 0.28) {
    issues.push("內點比例過低");
    rejected = true;
  }
  if (params.rmsMeters > 0.025) {
    issues.push("表面厚度超過 2.5 cm");
    rejected = true;
  }
  if (minimumSpan < 0.08) {
    issues.push("有效覆蓋範圍過小");
    rejected = true;
  }
  if (params.requestedConstraint === "auto" && params.appliedConstraint === "free") {
    issues.push("表面不接近水平或垂直，請確認後改用自由斜面");
    rejected = true;
  }
  if (
    params.appliedConstraint !== "free" &&
    params.orientationAdjustmentDegrees > 8
  ) {
    issues.push("軸向修正角度過大");
    rejected = true;
  }

  const isGood = !rejected &&
    params.inlierCount >= 100 &&
    inlierRatio >= 0.5 &&
    params.rmsMeters <= 0.012 &&
    minimumSpan >= 0.18 &&
    params.orientationAdjustmentDegrees <= 4;

  if (!rejected && !isGood) {
    if (inlierRatio < 0.5) issues.push("內點比例普通");
    if (params.rmsMeters > 0.012) issues.push("表面雜訊偏高");
    if (minimumSpan < 0.18) issues.push("覆蓋範圍偏小");
    if (params.orientationAdjustmentDegrees > 4) issues.push("軸向修正角度偏大");
  }

  const ratioScore = clamp((inlierRatio - 0.2) / 0.55, 0, 1);
  const rmsScore = clamp(1 - params.rmsMeters / 0.03, 0, 1);
  const coverageScore = clamp(minimumSpan / 0.35, 0, 1);
  const adjustmentScore = params.appliedConstraint === "free"
    ? 1
    : clamp(1 - params.orientationAdjustmentDegrees / 10, 0, 1);
  const confidence = clamp(
    ratioScore * 0.42 + rmsScore * 0.3 + coverageScore * 0.18 + adjustmentScore * 0.1,
    0.05,
    0.99
  );

  return {
    status: rejected ? "rejected" : isGood ? "good" : "check",
    confidence,
    issues
  };
}

export function resolvePlaneConstraint(
  normal: Vector3Like,
  requestedConstraint: MeasurementPlaneConstraint
): AppliedPlaneConstraint {
  if (requestedConstraint !== "auto") {
    return requestedConstraint;
  }

  const verticalAlignment = Math.abs(normalize(normal).y);
  if (verticalAlignment >= Math.cos(degreesToRadians(20))) {
    return "horizontal";
  }
  if (verticalAlignment <= Math.sin(degreesToRadians(20))) {
    return "vertical";
  }
  return "free";
}

function getConstrainedNormal(
  initialNormal: Vector3Like,
  constraint: AppliedPlaneConstraint
): Vector3Like {
  if (constraint === "horizontal") {
    return { x: 0, y: initialNormal.y < 0 ? -1 : 1, z: 0 };
  }
  if (constraint === "vertical") {
    const horizontalLength = Math.hypot(initialNormal.x, initialNormal.z);
    if (horizontalLength <= 1e-12) {
      return { x: 1, y: 0, z: 0 };
    }
    return {
      x: initialNormal.x / horizontalLength,
      y: 0,
      z: initialNormal.z / horizontalLength
    };
  }
  return normalize(initialNormal);
}

function createStructuralPlaneBasis(
  normal: Vector3Like,
  constraint: AppliedPlaneConstraint
): { horizontal: Vector3Like; vertical: Vector3Like } {
  const worldUp = { x: 0, y: 1, z: 0 };
  if (constraint === "horizontal" || Math.abs(normal.y) > 0.92) {
    const horizontal = Math.abs(normal.x) < 0.9
      ? normalize(cross({ x: 1, y: 0, z: 0 }, normal))
      : normalize(cross({ x: 0, y: 0, z: 1 }, normal));
    return {
      horizontal,
      vertical: normalize(cross(normal, horizontal))
    };
  }

  const vertical = normalize(subtract(worldUp, scale(normal, dot(worldUp, normal))));
  return {
    horizontal: normalize(cross(vertical, normal)),
    vertical
  };
}

function collectInlierIndices(
  points: readonly Vector3Like[],
  plane: PlaneEstimate,
  threshold: number
): number[] {
  const indices: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (pointPlaneDistance(points[index], plane) <= threshold) {
      indices.push(index);
    }
  }
  return indices;
}

function pointPlaneDistance(point: Vector3Like, plane: PlaneEstimate): number {
  return Math.abs(dot(point, plane.normal) + plane.constant);
}

function angleBetweenAxesDegrees(first: Vector3Like, second: Vector3Like): number {
  const value = clamp(Math.abs(dot(normalize(first), normalize(second))), 0, 1);
  return Math.acos(value) * 180 / Math.PI;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function add(first: Vector3Like, second: Vector3Like): Vector3Like {
  return {
    x: first.x + second.x,
    y: first.y + second.y,
    z: first.z + second.z
  };
}

function subtract(first: Vector3Like, second: Vector3Like): Vector3Like {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z
  };
}

function cross(first: Vector3Like, second: Vector3Like): Vector3Like {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x
  };
}

function dot(first: Vector3Like, second: Vector3Like): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function scale(vector: Vector3Like, scalar: number): Vector3Like {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar
  };
}

function normalize(vector: Vector3Like): Vector3Like {
  const vectorLength = Math.hypot(vector.x, vector.y, vector.z);
  return vectorLength > 1e-12
    ? scale(vector, 1 / vectorLength)
    : { x: 0, y: 1, z: 0 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
