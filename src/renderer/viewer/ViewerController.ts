import * as THREE from "three";
import type {
  MeasurementDataSource,
  MeasurementPickOptions,
  MeasurementPickResult,
  MeasurementSnapPlane,
  PickQuery,
  PickResult
} from "../../shared/PointCloudDataSource";
import type { PointCloudMetadata, Vector3Like } from "../../shared/types";
import { ViewerMode } from "../../shared/ViewerModeTypes";
import type { MovementMode } from "./CameraController";
import { GaussianSplatModeViewer } from "./GaussianSplatModeViewer";
import { PointCloudModeViewer } from "./PointCloudModeViewer";
import type { PointDisplayFilter, ViewerFrameInfo } from "./PointCloudViewer";
import type { PointRenderPreset } from "./PointCloudMaterialFactory";

export class ViewerController implements MeasurementDataSource {
  readonly pointCloudViewer: PointCloudModeViewer;
  readonly gaussianSplatViewer: GaussianSplatModeViewer;
  private activeMode = ViewerMode.UNKNOWN;

  constructor(canvas: HTMLCanvasElement) {
    this.pointCloudViewer = new PointCloudModeViewer(canvas);
    this.gaussianSplatViewer = new GaussianSplatModeViewer(this.pointCloudViewer);
  }

  get scene(): THREE.Scene {
    return this.pointCloudViewer.scene;
  }

  getActiveMode(): ViewerMode {
    return this.activeMode;
  }

  setFrameCallback(callback: (info: ViewerFrameInfo) => void): void {
    this.pointCloudViewer.setFrameCallback(callback);
  }

  loadPointCloud(geometry: THREE.BufferGeometry, metadata: PointCloudMetadata): PointCloudMetadata {
    this.activeMode = metadata.detectedMode === ViewerMode.UNKNOWN ? ViewerMode.UNKNOWN : ViewerMode.POINT_CLOUD;
    return this.pointCloudViewer.loadStandardPointCloud(geometry, metadata);
  }

  async loadGaussianSplatPreview(geometry: THREE.BufferGeometry, metadata: PointCloudMetadata): Promise<PointCloudMetadata> {
    this.activeMode = ViewerMode.GAUSSIAN_SPLAT;
    return this.gaussianSplatViewer.loadGaussianSplatPreview(geometry, metadata);
  }

  setPointSize(size: number): void {
    this.pointCloudViewer.setPointSize(size);
  }

  setRenderPreset(preset: PointRenderPreset): PointCloudMetadata | null {
    return this.pointCloudViewer.setRenderPreset(preset);
  }

  setDisplayFilter(filter: PointDisplayFilter): PointCloudMetadata | null {
    return this.pointCloudViewer.setDisplayFilter(filter);
  }

  setDisplaySampling(step: number): PointCloudMetadata | null {
    return this.pointCloudViewer.setDisplaySampling(step);
  }

  setRaycastThreshold(threshold: number): void {
    this.pointCloudViewer.setRaycastThreshold(threshold);
  }

  setMoveSpeed(speed: number): void {
    this.pointCloudViewer.setMoveSpeed(speed);
  }

  getMovementMode(): MovementMode {
    return this.pointCloudViewer.getMovementMode();
  }

  setMovementMode(mode: MovementMode): void {
    this.pointCloudViewer.setMovementMode(mode);
  }

  toggleMovementMode(): MovementMode {
    return this.pointCloudViewer.toggleMovementMode();
  }

  setGridVisible(visible: boolean): void {
    this.pointCloudViewer.setGridVisible(visible);
  }

  setAxesVisible(visible: boolean): void {
    this.pointCloudViewer.setAxesVisible(visible);
  }

  setRoomPlanOverlay(roomPlan: Record<string, unknown> | null): void {
    this.pointCloudViewer.setRoomPlanOverlay(roomPlan);
  }

  setRoomPlanOverlayVisible(visible: boolean): void {
    this.pointCloudViewer.setRoomPlanOverlayVisible(visible);
  }

  setRoomPlanOverlayAutoAlign(enabled: boolean): void {
    this.pointCloudViewer.setRoomPlanOverlayAutoAlign(enabled);
  }

  enterFirstPerson(): void {
    this.pointCloudViewer.enterFirstPerson();
  }

  exitFirstPerson(): void {
    this.pointCloudViewer.exitFirstPerson();
  }

  focusViewport(): void {
    this.pointCloudViewer.focusViewport();
  }

  resetView(): void {
    this.pointCloudViewer.resetView();
  }

  pickPoint(clientX: number, clientY: number): Vector3Like | null {
    return this.pointCloudViewer.pickPoint(clientX, clientY);
  }

  pickMeasurementPoint(clientX: number, clientY: number, options: MeasurementPickOptions): MeasurementPickResult | null {
    return this.pointCloudViewer.pickMeasurementPoint(clientX, clientY, options);
  }

  projectScreenToPlane(clientX: number, clientY: number, plane: MeasurementSnapPlane): Vector3Like | null {
    return this.pointCloudViewer.projectScreenToPlane(clientX, clientY, plane);
  }

  pickNearestPoint(query: PickQuery): PickResult | null {
    return this.pointCloudViewer.pickNearestPoint(query);
  }
}
