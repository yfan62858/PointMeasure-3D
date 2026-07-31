import type {
  ScreenRectangle,
  StructuralBoundaryFitResult,
  StructuralBoundarySide,
  StructuralDimensionMode,
  StructuralRectangleFitResult,
  StructuralSpanFitResult,
  TrustedPlaneFitResult,
  TrustedPlaneQualityStatus
} from "../../shared/PointCloudDataSource";
import type { Vector3Like } from "../../shared/types";

export type StructuralBoundarySample = {
  point: Vector3Like;
  screenX?: number;
  screenY?: number;
};

type ProjectedBoundarySample = StructuralBoundarySample & {
  target: number;
  tangent: number;
  planeDistance: number;
};

const MIN_BOUNDARY_CANDIDATES = 30;
const MIN_PLANE_POINTS = 22;
const MIN_EDGE_INLIERS = 12;
const MIN_TANGENT_SPAN_METERS = 0.08;
const MIN_CENTER_OFFSET_METERS = 0.025;
const MIN_SCREEN_MARGIN_PIXELS = 4;
const MAX_BOUNDARY_RMS_METERS = 0.025;
const PREVIEW_POINT_LIMIT = 360;

export function fitStructuralBoundary(
  samples: readonly StructuralBoundarySample[],
  planeFit: TrustedPlaneFitResult,
  side: StructuralBoundarySide,
  rectangle?: ScreenRectangle
): StructuralBoundaryFitResult | null {
  if (samples.length < 3) {
    return null;
  }

  const normal = normalize(planeFit.plane.normal);
  const horizontal = normalize(planeFit.horizontal);
  const vertical = normalize(planeFit.vertical);
  const targetAxis = isHorizontalBoundary(side) ? vertical : horizontal;
  const tangentAxis = isHorizontalBoundary(side) ? horizontal : vertical;
  const planeThreshold = clamp(
    Math.max(0.009, (planeFit.plane.rmsMeters ?? 0.006) * 2.8),
    0.009,
    0.028
  );
  const projected = samples.map<ProjectedBoundarySample>((sample) => ({
    ...sample,
    target: dot(sample.point, targetAxis),
    tangent: dot(sample.point, tangentAxis),
    planeDistance: Math.abs(dot(sample.point, normal) + planeFit.plane.constant)
  }));
  const planeSamples = projected.filter((sample) => sample.planeDistance <= planeThreshold);
  if (planeSamples.length < 8) {
    return null;
  }

  const centerCoordinate = dot(planeFit.point, targetAxis);
  const medianCoordinate = median(planeSamples.map((sample) => sample.target));
  const outwardSign = medianCoordinate >= centerCoordinate ? 1 : -1;
  const tangents = planeSamples.map((sample) => sample.tangent);
  const tangentLow = quantile(tangents, 0.02);
  const tangentHigh = quantile(tangents, 0.98);
  const tangentSpanMeters = tangentHigh - tangentLow;
  const sliceCount = chooseSliceCount(planeSamples.length, tangentSpanMeters);
  const sliceEdges: number[] = [];

  if (tangentSpanMeters > 1e-6) {
    for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
      const sliceStart = tangentLow + tangentSpanMeters * sliceIndex / sliceCount;
      const sliceEnd = tangentLow + tangentSpanMeters * (sliceIndex + 1) / sliceCount;
      const sliceTargets = planeSamples
        .filter((sample) => (
          sample.tangent >= sliceStart &&
          (sliceIndex === sliceCount - 1 ? sample.tangent <= sliceEnd : sample.tangent < sliceEnd)
        ))
        .map((sample) => sample.target);
      if (sliceTargets.length < 4) {
        continue;
      }
      sliceEdges.push(quantile(sliceTargets, outwardSign > 0 ? 0.975 : 0.025));
    }
  }

  if (sliceEdges.length < 2) {
    sliceEdges.push(quantile(
      planeSamples.map((sample) => sample.target),
      outwardSign > 0 ? 0.975 : 0.025
    ));
  }
  const offsetMeters = median(sliceEdges);
  const sliceResiduals = sliceEdges.map((value) => Math.abs(value - offsetMeters));
  const rmsMeters = rootMeanSquare(sliceResiduals);
  const madMeters = median(sliceResiduals);
  const edgeBandMeters = clamp(Math.max(0.012, madMeters * 3 + 0.008), 0.012, 0.035);
  const edgeSamples = planeSamples.filter(
    (sample) => Math.abs(sample.target - offsetMeters) <= edgeBandMeters
  );
  const tangentCenter = median(edgeSamples.length > 0
    ? edgeSamples.map((sample) => sample.tangent)
    : tangents);
  const planeOrigin = scale(normal, -planeFit.plane.constant);
  const linePoint = add(
    planeOrigin,
    add(scale(targetAxis, offsetMeters), scale(tangentAxis, tangentCenter))
  );
  const lineStart = add(
    planeOrigin,
    add(scale(targetAxis, offsetMeters), scale(tangentAxis, tangentLow))
  );
  const lineEnd = add(
    planeOrigin,
    add(scale(targetAxis, offsetMeters), scale(tangentAxis, tangentHigh))
  );
  const screenMarginPixels = getBoundaryScreenMargin(edgeSamples, rectangle);
  const centerOffsetMeters = offsetMeters - centerCoordinate;
  const quality = evaluateBoundaryQuality({
    candidateCount: samples.length,
    planePointCount: planeSamples.length,
    edgeInlierCount: edgeSamples.length,
    validSliceCount: sliceEdges.length,
    tangentSpanMeters,
    centerOffsetMeters: Math.abs(centerOffsetMeters),
    rmsMeters,
    screenMarginPixels
  });

  return {
    side,
    line: {
      point: linePoint,
      direction: tangentAxis,
      inlierCount: edgeSamples.length
    },
    lineStart,
    lineEnd,
    offsetMeters,
    centerOffsetMeters,
    candidateCount: samples.length,
    planePointCount: planeSamples.length,
    inlierCount: edgeSamples.length,
    sliceCount: sliceEdges.length,
    tangentMinimumMeters: tangentLow,
    tangentMaximumMeters: tangentHigh,
    tangentSpanMeters,
    rmsMeters,
    madMeters,
    screenMarginPixels,
    confidence: quality.confidence,
    qualityStatus: quality.status,
    qualityIssues: quality.issues,
    inlierPreviewPoints: samplePoints(
      edgeSamples.map((sample) => sample.point),
      PREVIEW_POINT_LIMIT
    )
  };
}

export function solveStructuralSpan(
  planeFit: TrustedPlaneFitResult,
  boundaries: readonly StructuralBoundaryFitResult[],
  dimension: StructuralDimensionMode
): StructuralSpanFitResult | null {
  const expectedSides: readonly StructuralBoundarySide[] = dimension === "height"
    ? ["top", "bottom"]
    : ["left", "right"];
  const first = boundaries.find((boundary) => boundary.side === expectedSides[0]);
  const second = boundaries.find((boundary) => boundary.side === expectedSides[1]);
  if (!first || !second) {
    return null;
  }

  const qualityIssues: string[] = [];
  let rejected = first.qualityStatus === "rejected" || second.qualityStatus === "rejected";
  if (first.centerOffsetMeters * second.centerOffsetMeters >= 0) {
    qualityIssues.push(
      dimension === "height"
        ? "上下邊界沒有位於主平面中心兩側"
        : "左右邊界沒有位於主平面中心兩側"
    );
    rejected = true;
  }

  const tangentMinimum = Math.max(
    first.tangentMinimumMeters,
    second.tangentMinimumMeters
  );
  const tangentMaximum = Math.min(
    first.tangentMaximumMeters,
    second.tangentMaximumMeters
  );
  const tangentOverlap = tangentMaximum - tangentMinimum;
  if (tangentOverlap < 0.04) {
    qualityIssues.push("兩條邊界沿線沒有足夠的共同涵蓋範圍");
    rejected = true;
  }

  const minimumOffset = Math.min(first.offsetMeters, second.offsetMeters);
  const maximumOffset = Math.max(first.offsetMeters, second.offsetMeters);
  const distanceMeters = maximumOffset - minimumOffset;
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0.05) {
    qualityIssues.push("兩條邊界距離過小或無效");
    rejected = true;
  }

  const normal = normalize(planeFit.plane.normal);
  const horizontal = normalize(planeFit.horizontal);
  const vertical = normalize(planeFit.vertical);
  const targetAxis = dimension === "height" ? vertical : horizontal;
  const tangentAxis = dimension === "height" ? horizontal : vertical;
  const planeOrigin = scale(normal, -planeFit.plane.constant);
  const tangentCoordinate = tangentOverlap >= 0
    ? (tangentMinimum + tangentMaximum) * 0.5
    : (dot(first.line.point, tangentAxis) + dot(second.line.point, tangentAxis)) * 0.5;
  const start = add(
    planeOrigin,
    add(scale(targetAxis, minimumOffset), scale(tangentAxis, tangentCoordinate))
  );
  const end = add(
    planeOrigin,
    add(scale(targetAxis, maximumOffset), scale(tangentAxis, tangentCoordinate))
  );
  const uncertaintyMeters = Math.sqrt(first.rmsMeters ** 2 + second.rmsMeters ** 2);
  if (uncertaintyMeters > 0.04) {
    qualityIssues.push("兩條邊界的切片離散程度過大");
    rejected = true;
  }

  const allGood = first.qualityStatus === "good" && second.qualityStatus === "good";
  const qualityStatus: TrustedPlaneQualityStatus = rejected
    ? "rejected"
    : allGood && uncertaintyMeters <= 0.015 ? "good" : "check";
  if (!rejected && qualityStatus === "check") {
    qualityIssues.push("尺寸可用，但建議換位置重做一次比較");
  }
  return {
    dimension,
    start,
    end,
    distanceMeters,
    uncertaintyMeters,
    confidence: clamp(
      Math.min(first.confidence, second.confidence) *
        clamp(1 - uncertaintyMeters / 0.06, 0.4, 1),
      0.05,
      0.99
    ),
    qualityStatus,
    qualityIssues,
    boundaries: [first, second]
  };
}

export function solveStructuralRectangle(
  planeFit: TrustedPlaneFitResult,
  boundaries: readonly StructuralBoundaryFitResult[]
): StructuralRectangleFitResult | null {
  const top = boundaries.find((boundary) => boundary.side === "top");
  const bottom = boundaries.find((boundary) => boundary.side === "bottom");
  const left = boundaries.find((boundary) => boundary.side === "left");
  const right = boundaries.find((boundary) => boundary.side === "right");
  if (!top || !bottom || !left || !right) {
    return null;
  }

  const qualityIssues: string[] = [];
  let rejected = [top, bottom, left, right]
    .some((boundary) => boundary.qualityStatus === "rejected");
  if (top.centerOffsetMeters * bottom.centerOffsetMeters >= 0) {
    qualityIssues.push("上下邊界沒有位於主平面中心兩側");
    rejected = true;
  }
  if (left.centerOffsetMeters * right.centerOffsetMeters >= 0) {
    qualityIssues.push("左右邊界沒有位於主平面中心兩側");
    rejected = true;
  }

  const horizontal = normalize(planeFit.horizontal);
  const vertical = normalize(planeFit.vertical);
  const normal = normalize(planeFit.plane.normal);
  const minHorizontal = Math.min(left.offsetMeters, right.offsetMeters);
  const maxHorizontal = Math.max(left.offsetMeters, right.offsetMeters);
  const minVertical = Math.min(top.offsetMeters, bottom.offsetMeters);
  const maxVertical = Math.max(top.offsetMeters, bottom.offsetMeters);
  const widthMeters = maxHorizontal - minHorizontal;
  const heightMeters = maxVertical - minVertical;

  if (widthMeters < 0.06 || heightMeters < 0.06) {
    qualityIssues.push("四條邊界形成的矩形過小");
    rejected = true;
  }
  if (!Number.isFinite(widthMeters) || !Number.isFinite(heightMeters)) {
    return null;
  }

  const planeOrigin = scale(normal, -planeFit.plane.constant);
  const corners: [Vector3Like, Vector3Like, Vector3Like, Vector3Like] = [
    pointOnPlane(planeOrigin, horizontal, vertical, minHorizontal, minVertical),
    pointOnPlane(planeOrigin, horizontal, vertical, maxHorizontal, minVertical),
    pointOnPlane(planeOrigin, horizontal, vertical, maxHorizontal, maxVertical),
    pointOnPlane(planeOrigin, horizontal, vertical, minHorizontal, maxVertical)
  ];
  const widthUncertaintyMeters = Math.sqrt(left.rmsMeters ** 2 + right.rmsMeters ** 2);
  const heightUncertaintyMeters = Math.sqrt(top.rmsMeters ** 2 + bottom.rmsMeters ** 2);
  const maxUncertainty = Math.max(widthUncertaintyMeters, heightUncertaintyMeters);
  if (maxUncertainty > 0.04) {
    qualityIssues.push("邊界重複切片的離散程度過大");
    rejected = true;
  }

  const allGood = [top, bottom, left, right]
    .every((boundary) => boundary.qualityStatus === "good");
  const status: TrustedPlaneQualityStatus = rejected
    ? "rejected"
    : allGood && maxUncertainty <= 0.015 ? "good" : "check";
  if (!rejected && status === "check") {
    qualityIssues.push("部分邊界品質普通，建議換視角重做一次比較");
  }
  const confidence = clamp(
    Math.min(top.confidence, bottom.confidence, left.confidence, right.confidence) *
      clamp(1 - maxUncertainty / 0.06, 0.4, 1),
    0.05,
    0.99
  );

  return {
    corners,
    widthMeters,
    heightMeters,
    areaSquareMeters: widthMeters * heightMeters,
    widthUncertaintyMeters,
    heightUncertaintyMeters,
    confidence,
    qualityStatus: status,
    qualityIssues,
    boundaries: [top, bottom, left, right]
  };
}

function evaluateBoundaryQuality(params: {
  candidateCount: number;
  planePointCount: number;
  edgeInlierCount: number;
  validSliceCount: number;
  tangentSpanMeters: number;
  centerOffsetMeters: number;
  rmsMeters: number;
  screenMarginPixels: number;
}): { status: TrustedPlaneQualityStatus; confidence: number; issues: string[] } {
  const issues: string[] = [];
  let rejected = false;
  if (params.candidateCount < MIN_BOUNDARY_CANDIDATES) {
    issues.push("窄帶候選點不足");
    rejected = true;
  }
  if (params.planePointCount < MIN_PLANE_POINTS) {
    issues.push("主平面支撐點不足");
    rejected = true;
  }
  if (params.edgeInlierCount < MIN_EDGE_INLIERS) {
    issues.push("邊界附近支撐點不足");
    rejected = true;
  }
  if (params.validSliceCount < 3) {
    issues.push("有效邊界切片不足");
    rejected = true;
  }
  if (params.tangentSpanMeters < MIN_TANGENT_SPAN_METERS) {
    issues.push("沿邊界方向的涵蓋長度不足");
    rejected = true;
  }
  if (params.centerOffsetMeters < MIN_CENTER_OFFSET_METERS) {
    issues.push("選區太靠近主平面中央");
    rejected = true;
  }
  if (params.rmsMeters > MAX_BOUNDARY_RMS_METERS) {
    issues.push("各切片估出的邊界位置不一致");
    rejected = true;
  }
  if (params.screenMarginPixels < MIN_SCREEN_MARGIN_PIXELS) {
    issues.push("邊界貼近選框，窄帶必須跨過邊界內外兩側");
    rejected = true;
  }

  const good = !rejected &&
    params.candidateCount >= 60 &&
    params.edgeInlierCount >= 24 &&
    params.validSliceCount >= 5 &&
    params.tangentSpanMeters >= 0.16 &&
    params.rmsMeters <= 0.012 &&
    params.screenMarginPixels >= 7;
  if (!rejected && !good) {
    issues.push("邊界可用，但建議增加窄帶長度或點雲涵蓋");
  }
  const supportScore = clamp(params.edgeInlierCount / 45, 0, 1);
  const sliceScore = clamp(params.validSliceCount / 7, 0, 1);
  const spanScore = clamp(params.tangentSpanMeters / 0.3, 0, 1);
  const residualScore = clamp(1 - params.rmsMeters / 0.03, 0, 1);
  const marginScore = clamp(params.screenMarginPixels / 12, 0, 1);
  return {
    status: rejected ? "rejected" : good ? "good" : "check",
    confidence: clamp(
      supportScore * 0.25 +
      sliceScore * 0.2 +
      spanScore * 0.2 +
      residualScore * 0.25 +
      marginScore * 0.1,
      0.05,
      0.99
    ),
    issues
  };
}

function getBoundaryScreenMargin(
  edgeSamples: readonly ProjectedBoundarySample[],
  rectangle?: ScreenRectangle
): number {
  if (!rectangle) {
    return Number.POSITIVE_INFINITY;
  }
  const screenSamples = edgeSamples.filter(
    (sample) => Number.isFinite(sample.screenX) && Number.isFinite(sample.screenY)
  );
  if (screenSamples.length === 0) {
    return 0;
  }
  const x = median(screenSamples.map((sample) => sample.screenX as number));
  const y = median(screenSamples.map((sample) => sample.screenY as number));
  return Math.max(0, Math.min(
    x - rectangle.left,
    rectangle.right - x,
    y - rectangle.top,
    rectangle.bottom - y
  ));
}

function chooseSliceCount(pointCount: number, tangentSpanMeters: number): number {
  if (pointCount >= 180 && tangentSpanMeters >= 0.35) return 9;
  if (pointCount >= 90 && tangentSpanMeters >= 0.18) return 7;
  return 5;
}

function isHorizontalBoundary(side: StructuralBoundarySide): boolean {
  return side === "top" || side === "bottom";
}

function pointOnPlane(
  origin: Vector3Like,
  horizontal: Vector3Like,
  vertical: Vector3Like,
  horizontalOffset: number,
  verticalOffset: number
): Vector3Like {
  return add(
    origin,
    add(scale(horizontal, horizontalOffset), scale(vertical, verticalOffset))
  );
}

function samplePoints(points: readonly Vector3Like[], limit: number): Vector3Like[] {
  if (points.length <= limit) {
    return points.map(clone);
  }
  const sampled: Vector3Like[] = [];
  const step = points.length / limit;
  for (let index = 0; index < limit; index += 1) {
    sampled.push(clone(points[Math.floor(index * step)]));
  }
  return sampled;
}

function quantile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const position = clamp(ratio, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const mix = position - lower;
  return sorted[lower] * (1 - mix) + sorted[upper] * mix;
}

function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

function rootMeanSquare(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function add(first: Vector3Like, second: Vector3Like): Vector3Like {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function scale(vector: Vector3Like, scalar: number): Vector3Like {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function dot(first: Vector3Like, second: Vector3Like): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function normalize(vector: Vector3Like): Vector3Like {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 1e-12 ? scale(vector, 1 / length) : { x: 0, y: 1, z: 0 };
}

function clone(vector: Vector3Like): Vector3Like {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
