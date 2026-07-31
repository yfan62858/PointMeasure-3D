import type {
  MeasurementDataSource,
  MeasurementPlaneConstraint,
  MeasurementPickOptions,
  MeasurementPickPreset,
  MeasurementPickResult,
  ScreenRectangle,
  StructuralBoundaryFitResult,
  StructuralBoundarySide,
  StructuralSpanFitResult,
  StructuralRectangleFitResult,
  TrustedPlaneFitResult
} from "../../shared/PointCloudDataSource";
import type { Vector3Like } from "../../shared/types";
import { measurementDistance } from "../utils/math3d";
import type {
  MeasurementDistanceMode,
  ClearanceMeasurementRecord,
  MeasurementPreview,
  MeasurementRecord,
  MeasurementState,
  PlaneMeasurementBasis,
  PlaneMeasurementPreview,
  PlaneMeasurementRecord
} from "./MeasurementTypes";

export class MeasurementManager {
  private readonly records: MeasurementRecord[] = [];
  private readonly planeRecords: PlaneMeasurementRecord[] = [];
  private readonly clearanceRecords: ClearanceMeasurementRecord[] = [];
  private readonly structuralHeightLocks: StructuralHeightLock[] = [];
  private dragStart: MeasurementPickResult | null = null;
  private dragCurrent: MeasurementPickResult | null = null;
  private planeDraft: PlaneMeasurementPreview | null = null;
  private dataSource: MeasurementDataSource | null = null;
  private distanceMode: MeasurementDistanceMode = "3d";
  private measurementPreset: MeasurementPickPreset = "beam_column";

  state: MeasurementState = "idle";

  setDataSource(dataSource: MeasurementDataSource): void {
    this.dataSource = dataSource;
  }

  getDataSource(): MeasurementDataSource | null {
    return this.dataSource;
  }

  setDistanceMode(mode: MeasurementDistanceMode): void {
    this.distanceMode = mode;
  }

  getDistanceMode(): MeasurementDistanceMode {
    return this.distanceMode;
  }

  setMeasurementPreset(preset: MeasurementPickPreset): void {
    this.measurementPreset = preset;
  }

  pickPoint(clientX: number, clientY: number, options?: MeasurementPickOptions): MeasurementPickResult | null {
    if (!this.dataSource) {
      return null;
    }

    const picked = options && this.dataSource.pickMeasurementPoint
      ? this.dataSource.pickMeasurementPoint(clientX, clientY, options)
      : null;
    if (picked) {
      return picked;
    }

    const fallback = this.dataSource.pickPoint?.(clientX, clientY) ?? null;
    return fallback ? createNearestPick(fallback, options?.radiusMeters ?? 0) : null;
  }

  fitTrustedPlaneRegion(
    rectangle: ScreenRectangle,
    constraint: MeasurementPlaneConstraint,
    options: MeasurementPickOptions
  ): TrustedPlaneFitResult | null {
    return this.dataSource?.fitMeasurementPlaneRegion?.(rectangle, constraint, options) ?? null;
  }

  fitStructuralBoundaryRegion(
    rectangle: ScreenRectangle,
    plane: TrustedPlaneFitResult,
    side: StructuralBoundarySide,
    options: MeasurementPickOptions
  ): StructuralBoundaryFitResult | null {
    return this.dataSource?.fitStructuralBoundaryRegion?.(rectangle, plane, side, options) ?? null;
  }

  addTrustedPlaneFit(fit: TrustedPlaneFitResult, analysisRadiusMeters: number): PlaneMeasurementRecord {
    const startSnap: MeasurementPickResult = {
      point: cloneVector(fit.point),
      rawPoint: cloneVector(fit.point),
      kind: "plane",
      confidence: fit.confidence,
      candidateCount: fit.candidateCount,
      inlierCount: fit.inlierCount,
      analysisRadiusMeters,
      plane: fit.plane,
      localBox: fit.localBox
    };
    const basis: PlaneMeasurementBasis = {
      normal: cloneVector(fit.plane.normal),
      horizontal: cloneVector(fit.horizontal),
      vertical: cloneVector(fit.vertical),
      plane: fit.plane
    };
    const record: PlaneMeasurementRecord = {
      id: crypto.randomUUID(),
      start: cloneVector(fit.corners[0]),
      current: cloneVector(fit.corners[2]),
      corners: fit.corners.map(cloneVector) as PlaneMeasurementRecord["corners"],
      basis,
      startSnap,
      widthMeters: fit.widthMeters,
      heightMeters: fit.heightMeters,
      areaSquareMeters: fit.areaSquareMeters,
      trustedFit: {
        appliedConstraint: fit.appliedConstraint,
        qualityStatus: fit.qualityStatus,
        qualityIssues: [...fit.qualityIssues],
        inlierRatio: fit.inlierRatio,
        rmsMeters: fit.plane.rmsMeters ?? 0,
        madMeters: fit.plane.madMeters,
        orientationAdjustmentDegrees: fit.orientationAdjustmentDegrees
      },
      createdAtIso: new Date().toISOString()
    };
    this.planeRecords.push(record);
    this.state = "completed";
    return record;
  }

  addStructuralRectangleFit(
    planeFit: TrustedPlaneFitResult,
    rectangleFit: StructuralRectangleFitResult,
    analysisRadiusMeters: number
  ): PlaneMeasurementRecord {
    const startSnap: MeasurementPickResult = {
      point: cloneVector(rectangleFit.corners[0]),
      rawPoint: cloneVector(rectangleFit.corners[0]),
      kind: "edge",
      confidence: rectangleFit.confidence,
      candidateCount: rectangleFit.boundaries.reduce(
        (sum, boundary) => sum + boundary.candidateCount,
        0
      ),
      inlierCount: rectangleFit.boundaries.reduce(
        (sum, boundary) => sum + boundary.inlierCount,
        0
      ),
      analysisRadiusMeters,
      plane: planeFit.plane,
      localBox: planeFit.localBox,
      detectedCorner: true
    };
    const basis: PlaneMeasurementBasis = {
      normal: cloneVector(planeFit.plane.normal),
      horizontal: cloneVector(planeFit.horizontal),
      vertical: cloneVector(planeFit.vertical),
      plane: planeFit.plane
    };
    const record: PlaneMeasurementRecord = {
      id: crypto.randomUUID(),
      start: cloneVector(rectangleFit.corners[0]),
      current: cloneVector(rectangleFit.corners[2]),
      corners: rectangleFit.corners.map(cloneVector) as PlaneMeasurementRecord["corners"],
      basis,
      startSnap,
      widthMeters: rectangleFit.widthMeters,
      heightMeters: rectangleFit.heightMeters,
      areaSquareMeters: rectangleFit.areaSquareMeters,
      trustedFit: {
        appliedConstraint: planeFit.appliedConstraint,
        qualityStatus: planeFit.qualityStatus,
        qualityIssues: [...planeFit.qualityIssues],
        inlierRatio: planeFit.inlierRatio,
        rmsMeters: planeFit.plane.rmsMeters ?? 0,
        madMeters: planeFit.plane.madMeters,
        orientationAdjustmentDegrees: planeFit.orientationAdjustmentDegrees
      },
      structuralFit: {
        qualityStatus: rectangleFit.qualityStatus,
        qualityIssues: [...rectangleFit.qualityIssues],
        widthUncertaintyMeters: rectangleFit.widthUncertaintyMeters,
        heightUncertaintyMeters: rectangleFit.heightUncertaintyMeters,
        boundaries: rectangleFit.boundaries.map((boundary) => ({
          side: boundary.side,
          rmsMeters: boundary.rmsMeters,
          inlierCount: boundary.inlierCount,
          sliceCount: boundary.sliceCount,
          confidence: boundary.confidence
        }))
      },
      createdAtIso: new Date().toISOString()
    };
    this.planeRecords.push(record);
    this.state = "completed";
    return record;
  }

  addStructuralSpanFit(span: StructuralSpanFitResult): MeasurementRecord {
    const distanceMode: MeasurementDistanceMode = span.dimension === "height"
      ? "vertical"
      : "horizontal";
    const record: MeasurementRecord = {
      id: crypto.randomUUID(),
      start: cloneVector(span.start),
      end: cloneVector(span.end),
      distanceMeters: span.distanceMeters,
      distanceMode,
      source: "structural_boundaries",
      measurementPreset: "beam_column",
      rawStart: cloneVector(span.start),
      rawEnd: cloneVector(span.end),
      rawDistanceMeters: span.distanceMeters,
      uncertaintyMeters: span.uncertaintyMeters,
      structuralBoundaryFit: {
        dimension: span.dimension,
        qualityStatus: span.qualityStatus,
        qualityIssues: [...span.qualityIssues],
        boundaries: span.boundaries.map((boundary) => ({
          side: boundary.side,
          lineStart: cloneVector(boundary.lineStart),
          lineEnd: cloneVector(boundary.lineEnd),
          rmsMeters: boundary.rmsMeters,
          inlierCount: boundary.inlierCount,
          sliceCount: boundary.sliceCount,
          confidence: boundary.confidence
        }))
      },
      createdAtIso: new Date().toISOString()
    };
    this.records.push(record);
    this.state = "completed";
    return record;
  }

  beginDrag(start: MeasurementPickResult): MeasurementPreview {
    this.planeDraft = null;
    this.dragStart = start;
    this.dragCurrent = start;
    this.state = "measuring_drag";
    return this.getPreview() as MeasurementPreview;
  }

  updateDrag(current: MeasurementPickResult): MeasurementPreview | null {
    if (!this.dragStart) {
      return null;
    }

    this.dragCurrent = current;
    this.state = "measuring_drag";
    return this.getPreview();
  }

  finishDrag(end: MeasurementPickResult): MeasurementRecord | null {
    if (!this.dragStart) {
      this.cancelCurrent();
      return null;
    }

    const structuralPlanePair = this.dragStart.structuralBoundary === "horizontal" && end.structuralBoundary === "horizontal";
    if (structuralPlanePair && !isValidStructuralPlanePair(this.dragStart, end, this.distanceMode)) {
      this.cancelCurrent();
      return null;
    }

    const rawStart = cloneVector(this.dragStart.point);
    const rawEnd = cloneVector(end.point);
    const rawDistanceMeters = measurementDistance(rawStart, rawEnd, this.distanceMode);
    if (rawDistanceMeters <= 0) {
      this.cancelCurrent();
      return null;
    }

    const record: MeasurementRecord = {
      id: crypto.randomUUID(),
      start: cloneVector(rawStart),
      end: cloneVector(rawEnd),
      startSnap: this.dragStart,
      endSnap: end,
      distanceMeters: rawDistanceMeters,
      distanceMode: this.distanceMode,
      source: structuralPlanePair ? "structural_planes" : "point_pair",
      measurementPreset: this.measurementPreset,
      rawStart,
      rawEnd,
      rawDistanceMeters,
      uncertaintyMeters: structuralPlanePair ? getStructuralPlaneUncertainty(this.dragStart, end) : undefined,
      createdAtIso: new Date().toISOString()
    };

    this.records.push(record);
    this.reconcileStructuralHeightLock(record);
    this.dragStart = null;
    this.dragCurrent = null;
    this.state = "completed";
    return record;
  }

  projectScreenToPlane(clientX: number, clientY: number, plane: PlaneMeasurementBasis["plane"]): Vector3Like | null {
    return this.dataSource?.projectScreenToPlane?.(clientX, clientY, plane) ?? null;
  }

  beginPlaneDrag(startSnap: MeasurementPickResult, current: Vector3Like, basis: PlaneMeasurementBasis): PlaneMeasurementPreview {
    this.dragStart = null;
    this.dragCurrent = null;
    this.planeDraft = createPlanePreview(startSnap, current, basis);
    this.state = "measuring_plane";
    return this.planeDraft;
  }

  updatePlaneDrag(current: Vector3Like): PlaneMeasurementPreview | null {
    if (!this.planeDraft) {
      return null;
    }

    this.planeDraft = createPlanePreview(this.planeDraft.startSnap, current, this.planeDraft.basis);
    this.state = "measuring_plane";
    return this.planeDraft;
  }

  finishPlaneDrag(current: Vector3Like): PlaneMeasurementRecord | null {
    if (!this.planeDraft) {
      this.cancelCurrent();
      return null;
    }

    const preview = createPlanePreview(this.planeDraft.startSnap, current, this.planeDraft.basis);
    if (preview.widthMeters < 0.01 || preview.heightMeters < 0.01) {
      this.cancelCurrent();
      return null;
    }

    const record: PlaneMeasurementRecord = {
      ...preview,
      id: crypto.randomUUID(),
      createdAtIso: new Date().toISOString()
    };
    this.planeRecords.push(record);
    this.planeDraft = null;
    this.state = "completed";
    return record;
  }

  cancelCurrent(): void {
    this.dragStart = null;
    this.dragCurrent = null;
    this.planeDraft = null;
    this.state = this.hasCompletedRecords() ? "completed" : "idle";
  }

  clearAll(): void {
    this.records.length = 0;
    this.planeRecords.length = 0;
    this.clearanceRecords.length = 0;
    this.structuralHeightLocks.length = 0;
    this.dragStart = null;
    this.dragCurrent = null;
    this.planeDraft = null;
    this.state = "idle";
  }

  deleteRecord(id: string): void {
    const index = this.records.findIndex((record) => record.id === id);
    if (index >= 0) {
      this.records.splice(index, 1);
      this.rebuildStructuralHeightLocks();
    }
    this.state = this.hasCompletedRecords() ? "completed" : "idle";
  }

  deletePlaneRecord(id: string): void {
    const index = this.planeRecords.findIndex((record) => record.id === id);
    if (index >= 0) {
      this.planeRecords.splice(index, 1);
    }
    this.state = this.hasCompletedRecords() ? "completed" : "idle";
  }

  getRecords(): MeasurementRecord[] {
    return [...this.records];
  }

  getPlaneRecords(): PlaneMeasurementRecord[] {
    return [...this.planeRecords];
  }

  addClearanceMeasurement(
    planePairId: string,
    probeIndex: number,
    upperPick: MeasurementPickResult,
    lowerPick: MeasurementPickResult,
    probePoint: Vector3Like
  ): ClearanceMeasurementRecord | null {
    const record = createClearanceMeasurementRecord(
      planePairId,
      probeIndex,
      upperPick,
      lowerPick,
      probePoint
    );
    if (!record) {
      return null;
    }

    this.clearanceRecords.push(record);
    this.state = "completed";
    return record;
  }

  deleteClearanceRecord(id: string): void {
    const index = this.clearanceRecords.findIndex((record) => record.id === id);
    if (index >= 0) {
      this.clearanceRecords.splice(index, 1);
    }
    this.state = this.hasCompletedRecords() ? "completed" : "idle";
  }

  getClearanceRecords(): ClearanceMeasurementRecord[] {
    return [...this.clearanceRecords];
  }

  getPreview(): MeasurementPreview | null {
    if (!this.dragStart || !this.dragCurrent) {
      return null;
    }

    return {
      start: this.dragStart.point,
      current: this.dragCurrent.point,
      startSnap: this.dragStart,
      currentSnap: this.dragCurrent,
      distanceMeters: measurementDistance(this.dragStart.point, this.dragCurrent.point, this.distanceMode),
      distanceMode: this.distanceMode
    };
  }

  getPlanePreview(): PlaneMeasurementPreview | null {
    return this.planeDraft;
  }

  isDragging(): boolean {
    return this.state === "measuring_drag" && this.dragStart !== null;
  }

  isPlaneDragging(): boolean {
    return this.state === "measuring_plane" && this.planeDraft !== null;
  }

  private reconcileStructuralHeightLock(record: MeasurementRecord): void {
    const candidate = createStructuralHeightCandidate(record);
    if (!candidate) {
      return;
    }

    let lock = findMatchingStructuralHeightLock(candidate, this.structuralHeightLocks);
    if (!lock && record.source === "structural_planes") {
      lock = createStructuralHeightLock(candidate);
      this.structuralHeightLocks.push(lock);
    }
    if (!lock) {
      return;
    }

    applyStructuralHeightLock(record, lock, candidate);
    attachMatchingRecords(lock, this.records);
  }

  private rebuildStructuralHeightLocks(): void {
    this.structuralHeightLocks.length = 0;
    for (const record of this.records) {
      restoreRawMeasurement(record);
    }
    for (const record of this.records) {
      this.reconcileStructuralHeightLock(record);
    }
  }

  private hasCompletedRecords(): boolean {
    return this.records.length > 0 || this.planeRecords.length > 0 || this.clearanceRecords.length > 0;
  }
}

type StructuralHeightLock = {
  id: string;
  lowerY: number;
  upperY: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type StructuralHeightCandidate = {
  record: MeasurementRecord;
  lowerY: number;
  upperY: number;
  axisX: number;
  axisZ: number;
  toleranceMeters: number;
};

const STRUCTURAL_HEIGHT_BASE_TOLERANCE_METERS = 0.04;
const STRUCTURAL_HEIGHT_REGION_GAP_METERS = 1.5;

function createStructuralHeightCandidate(record: MeasurementRecord): StructuralHeightCandidate | null {
  if (record.measurementPreset !== "beam_column" || record.distanceMode !== "vertical") {
    return null;
  }

  const lowerY = Math.min(record.rawStart.y, record.rawEnd.y);
  const upperY = Math.max(record.rawStart.y, record.rawEnd.y);
  if (!Number.isFinite(lowerY) || !Number.isFinite(upperY) || upperY - lowerY < 0.01) {
    return null;
  }

  return {
    record,
    lowerY,
    upperY,
    axisX: (record.rawStart.x + record.rawEnd.x) * 0.5,
    axisZ: (record.rawStart.z + record.rawEnd.z) * 0.5,
    toleranceMeters: Math.max(
      STRUCTURAL_HEIGHT_BASE_TOLERANCE_METERS,
      (record.uncertaintyMeters ?? 0) * 4
    )
  };
}

function createStructuralHeightLock(candidate: StructuralHeightCandidate): StructuralHeightLock {
  return {
    id: crypto.randomUUID(),
    lowerY: candidate.lowerY,
    upperY: candidate.upperY,
    minX: candidate.axisX,
    maxX: candidate.axisX,
    minZ: candidate.axisZ,
    maxZ: candidate.axisZ
  };
}

function findMatchingStructuralHeightLock(
  candidate: StructuralHeightCandidate,
  locks: StructuralHeightLock[]
): StructuralHeightLock | null {
  let best: { lock: StructuralHeightLock; score: number } | null = null;
  for (const lock of locks) {
    const heightError = Math.abs(candidate.lowerY - lock.lowerY) + Math.abs(candidate.upperY - lock.upperY);
    if (
      Math.abs(candidate.lowerY - lock.lowerY) > candidate.toleranceMeters ||
      Math.abs(candidate.upperY - lock.upperY) > candidate.toleranceMeters
    ) {
      continue;
    }

    const regionDistance = distanceToHorizontalBounds(candidate.axisX, candidate.axisZ, lock);
    if (regionDistance > STRUCTURAL_HEIGHT_REGION_GAP_METERS) {
      continue;
    }

    const score = heightError + regionDistance * 0.01;
    if (!best || score < best.score) {
      best = { lock, score };
    }
  }
  return best?.lock ?? null;
}

function attachMatchingRecords(lock: StructuralHeightLock, records: MeasurementRecord[]): void {
  let attached = true;
  while (attached) {
    attached = false;
    for (const record of records) {
      if (record.structuralLockId) {
        continue;
      }
      const candidate = createStructuralHeightCandidate(record);
      if (!candidate || findMatchingStructuralHeightLock(candidate, [lock]) !== lock) {
        continue;
      }
      applyStructuralHeightLock(record, lock, candidate);
      attached = true;
    }
  }
}

function applyStructuralHeightLock(
  record: MeasurementRecord,
  lock: StructuralHeightLock,
  candidate: StructuralHeightCandidate
): void {
  const startIsLower = record.rawStart.y <= record.rawEnd.y;
  record.start = {
    ...record.rawStart,
    y: startIsLower ? lock.lowerY : lock.upperY
  };
  record.end = {
    ...record.rawEnd,
    y: startIsLower ? lock.upperY : lock.lowerY
  };
  record.distanceMeters = lock.upperY - lock.lowerY;
  record.structuralLockId = lock.id;
  record.structuralHeightLocked = true;
  lock.minX = Math.min(lock.minX, candidate.axisX);
  lock.maxX = Math.max(lock.maxX, candidate.axisX);
  lock.minZ = Math.min(lock.minZ, candidate.axisZ);
  lock.maxZ = Math.max(lock.maxZ, candidate.axisZ);
}

function restoreRawMeasurement(record: MeasurementRecord): void {
  record.start = cloneVector(record.rawStart);
  record.end = cloneVector(record.rawEnd);
  record.distanceMeters = record.rawDistanceMeters;
  record.structuralLockId = undefined;
  record.structuralHeightLocked = undefined;
}

function distanceToHorizontalBounds(x: number, z: number, lock: StructuralHeightLock): number {
  const dx = x < lock.minX ? lock.minX - x : x > lock.maxX ? x - lock.maxX : 0;
  const dz = z < lock.minZ ? lock.minZ - z : z > lock.maxZ ? z - lock.maxZ : 0;
  return Math.hypot(dx, dz);
}

function cloneVector(point: Vector3Like): Vector3Like {
  return { x: point.x, y: point.y, z: point.z };
}

export function createClearanceMeasurementRecord(
  planePairId: string,
  probeIndex: number,
  upperPick: MeasurementPickResult,
  lowerPick: MeasurementPickResult,
  probePoint: Vector3Like
): ClearanceMeasurementRecord | null {
  if (!upperPick.plane || !lowerPick.plane) {
    return null;
  }

  const upperPoint = intersectVerticalLineWithPlane(probePoint, upperPick.plane);
  const lowerPoint = intersectVerticalLineWithPlane(probePoint, lowerPick.plane);
  if (!upperPoint || !lowerPoint) {
    return null;
  }

  const heightMeters = upperPoint.y - lowerPoint.y;
  if (!Number.isFinite(heightMeters) || heightMeters <= 0.005) {
    return null;
  }

  const upperNormal = normalize(upperPick.plane.normal);
  const lowerNormal = normalize(lowerPick.plane.normal);
  const parallelDot = Math.min(1, Math.max(-1, Math.abs(dot(upperNormal, lowerNormal))));
  const parallelAngleDegrees = Math.acos(parallelDot) * 180 / Math.PI;
  const upperRms = upperPick.plane.rmsMeters;
  const lowerRms = lowerPick.plane.rmsMeters;

  return {
    id: crypto.randomUUID(),
    planePairId,
    probeIndex,
    upperPoint,
    lowerPoint,
    probePoint: cloneVector(probePoint),
    heightMeters,
    upperPlane: upperPick.plane,
    lowerPlane: lowerPick.plane,
    upperPick,
    lowerPick,
    parallelAngleDegrees,
    uncertaintyMeters: upperRms === undefined || lowerRms === undefined
      ? undefined
      : Math.hypot(upperRms, lowerRms),
    createdAtIso: new Date().toISOString()
  };
}

function intersectVerticalLineWithPlane(
  reference: Vector3Like,
  plane: MeasurementPickResult["plane"]
): Vector3Like | null {
  if (!plane || Math.abs(plane.normal.y) < 0.18) {
    return null;
  }

  const y = -(
    plane.normal.x * reference.x +
    plane.normal.z * reference.z +
    plane.constant
  ) / plane.normal.y;
  return Number.isFinite(y) ? { x: reference.x, y, z: reference.z } : null;
}

function isValidStructuralPlanePair(
  start: MeasurementPickResult,
  end: MeasurementPickResult,
  mode: MeasurementDistanceMode
): boolean {
  if (mode !== "vertical" || start.structuralBoundary !== "horizontal" || end.structuralBoundary !== "horizontal") {
    return false;
  }
  if (!start.plane || !end.plane) {
    return false;
  }

  const startNormal = normalize(start.plane.normal);
  const endNormal = normalize(end.plane.normal);
  const parallel = Math.abs(dot(startNormal, endNormal)) >= Math.cos(10 * Math.PI / 180);
  const horizontal = Math.abs(startNormal.y) >= Math.cos(15 * Math.PI / 180) &&
    Math.abs(endNormal.y) >= Math.cos(15 * Math.PI / 180);
  return parallel && horizontal;
}

function getStructuralPlaneUncertainty(start: MeasurementPickResult, end: MeasurementPickResult): number | undefined {
  const startRms = start.plane?.rmsMeters;
  const endRms = end.plane?.rmsMeters;
  if (startRms === undefined || endRms === undefined) {
    return undefined;
  }
  return Math.hypot(startRms, endRms);
}

function createNearestPick(point: Vector3Like, radiusMeters: number): MeasurementPickResult {
  return {
    point,
    rawPoint: point,
    kind: "nearest",
    confidence: 0.35,
    candidateCount: 1,
    inlierCount: 1,
    analysisRadiusMeters: radiusMeters
  };
}

function createPlanePreview(startSnap: MeasurementPickResult, current: Vector3Like, basis: PlaneMeasurementBasis): PlaneMeasurementPreview {
  const start = startSnap.point;
  const delta = subtract(current, start);
  const signedWidth = dot(delta, basis.horizontal);
  const signedHeight = dot(delta, basis.vertical);
  const widthVector = scale(basis.horizontal, signedWidth);
  const heightVector = scale(basis.vertical, signedHeight);
  const widthCorner = add(start, widthVector);
  const oppositeCorner = add(widthCorner, heightVector);
  const heightCorner = add(start, heightVector);

  return {
    start,
    current: oppositeCorner,
    corners: [start, widthCorner, oppositeCorner, heightCorner],
    basis,
    startSnap,
    widthMeters: Math.abs(signedWidth),
    heightMeters: Math.abs(signedHeight),
    areaSquareMeters: Math.abs(signedWidth * signedHeight)
  };
}

function add(a: Vector3Like, b: Vector3Like): Vector3Like {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vector3Like, b: Vector3Like): Vector3Like {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vector3Like, scalar: number): Vector3Like {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

function dot(a: Vector3Like, b: Vector3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(vector: Vector3Like): Vector3Like {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 1e-12 ? scale(vector, 1 / length) : { x: 0, y: 1, z: 0 };
}
