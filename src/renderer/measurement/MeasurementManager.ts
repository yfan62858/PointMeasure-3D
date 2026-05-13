import type { MeasurementDataSource, MeasurementPickOptions, MeasurementPickResult } from "../../shared/PointCloudDataSource";
import type { Vector3Like } from "../../shared/types";
import { distance3d } from "../utils/math3d";
import type {
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
  private dragStart: MeasurementPickResult | null = null;
  private dragCurrent: MeasurementPickResult | null = null;
  private planeDraft: PlaneMeasurementPreview | null = null;
  private dataSource: MeasurementDataSource | null = null;

  state: MeasurementState = "idle";

  setDataSource(dataSource: MeasurementDataSource): void {
    this.dataSource = dataSource;
  }

  getDataSource(): MeasurementDataSource | null {
    return this.dataSource;
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

    const distanceMeters = distance3d(this.dragStart.point, end.point);
    if (distanceMeters <= 0) {
      this.cancelCurrent();
      return null;
    }

    const record: MeasurementRecord = {
      id: crypto.randomUUID(),
      start: this.dragStart.point,
      end: end.point,
      startSnap: this.dragStart,
      endSnap: end,
      distanceMeters,
      createdAtIso: new Date().toISOString()
    };

    this.records.push(record);
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
    this.state = this.records.length > 0 || this.planeRecords.length > 0 ? "completed" : "idle";
  }

  clearAll(): void {
    this.records.length = 0;
    this.planeRecords.length = 0;
    this.dragStart = null;
    this.dragCurrent = null;
    this.planeDraft = null;
    this.state = "idle";
  }

  deleteRecord(id: string): void {
    const index = this.records.findIndex((record) => record.id === id);
    if (index >= 0) {
      this.records.splice(index, 1);
    }
    this.state = this.records.length > 0 || this.planeRecords.length > 0 ? "completed" : "idle";
  }

  deletePlaneRecord(id: string): void {
    const index = this.planeRecords.findIndex((record) => record.id === id);
    if (index >= 0) {
      this.planeRecords.splice(index, 1);
    }
    this.state = this.records.length > 0 || this.planeRecords.length > 0 ? "completed" : "idle";
  }

  getRecords(): MeasurementRecord[] {
    return [...this.records];
  }

  getPlaneRecords(): PlaneMeasurementRecord[] {
    return [...this.planeRecords];
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
      distanceMeters: distance3d(this.dragStart.point, this.dragCurrent.point)
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
