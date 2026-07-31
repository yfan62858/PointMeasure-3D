import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import type {
  MeasurementDataSource,
  MeasurementLocalBox,
  MeasurementPlaneConstraint,
  MeasurementPickOptions,
  MeasurementPickResult,
  MeasurementSnapLine,
  MeasurementSnapPlane,
  PickQuery,
  PickResult,
  ScreenRectangle,
  StructuralBoundaryFitResult,
  StructuralBoundarySide,
  TrustedPlaneFitResult
} from "../../shared/PointCloudDataSource";
import type { PointCloudMetadata, Vector3Like } from "../../shared/types";
import { fromThreeVector } from "../utils/math3d";
import { CameraController, type MovementMode } from "./CameraController";
import { addSceneHelpers, computeCameraHome } from "./SceneHelpers";
import { createPointCloudMaterial, type PointRenderPreset } from "./PointCloudMaterialFactory";
import { createRoomPlanOverlay, disposeRoomPlanOverlay } from "./RoomPlanOverlay";
import { refinePlaneFromPoints } from "./RobustPlaneFit";
import {
  createPlaneSupportGeometry,
  evaluateTrustedPlaneQuality,
  fitStructurallyConstrainedPlane
} from "./TrustedPlaneFit";
import { fitStructuralBoundary } from "./StructuralRectangleFit";

export type ViewerFrameInfo = {
  cameraPosition: Vector3Like;
  isFirstPerson: boolean;
  movementMode: MovementMode;
};

export type PointDisplayFilter = "none" | "clean" | "strict";
export type ScreenProjection = {
  x: number;
  y: number;
  depth: number;
  visible: boolean;
};

type DisplayPointMaterial = THREE.ShaderMaterial | THREE.PointsMaterial;
let roundPointTexture: THREE.CanvasTexture | null = null;
const RAW_PICK_MAX_POINTS = 2_000_000;
const PREVIEW_PICK_SAMPLE_LIMIT = 240_000;
const FINAL_PICK_SAMPLE_LIMIT = 1_600_000;
const PREVIEW_LOCAL_SAMPLE_LIMIT = 180_000;
const FINAL_LOCAL_SAMPLE_LIMIT = 900_000;
const PREVIEW_MAX_LOCAL_CANDIDATES = 2_400;
const FINAL_MAX_LOCAL_CANDIDATES = 7_500;
const FINAL_MAX_REGION_CANDIDATES = 18_000;
const REGION_PREVIEW_POINT_LIMIT = 1_200;
const EDGE_MIN_NORMAL_CROSS = 0.48;
const LOCAL_CORNER_MAX_NORMAL_DOT = 0.88;

export class PointCloudViewer implements MeasurementDataSource {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(65, 1, 0.01, 10_000);

  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: PointerLockControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly mouse = new THREE.Vector2();
  private readonly clock = new THREE.Clock();
  private readonly keys = new Set<string>();
  private animationId = 0;
  private displayPoints: THREE.Points | null = null;
  private displayVoxels: THREE.InstancedMesh | null = null;
  private pickPoints: THREE.Points | null = null;
  private referenceMesh: THREE.Mesh | null = null;
  private sourceGeometry: THREE.BufferGeometry | null = null;
  private displayGeometry: THREE.BufferGeometry | null = null;
  private pointMaterial: DisplayPointMaterial | null = null;
  private roomPlanOverlay: THREE.Group | null = null;
  private roomPlanAutoAlign = true;
  private metadata: PointCloudMetadata | null = null;
  private samplingStep = 1;
  private moveSpeed = 4;
  private movementMode: MovementMode = "walk";
  private pointSize = 2;
  private renderPreset: PointRenderPreset = "default";
  private displayFilter: PointDisplayFilter = "none";
  private pixelRatioLimit = 2;
  private readonly structuralEdges: StructuralEdge[] = [];
  private rightDragActive = false;
  private lastRightDragX = 0;
  private lastRightDragY = 0;
  private cameraYaw = 0;
  private cameraPitch = 0;
  private onFrame?: (info: ViewerFrameInfo) => void;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x11161d);
    this.camera.position.set(2.2, 1.7, 2.2);
    this.camera.lookAt(0, 0, 0);
    this.syncCameraAnglesFromCamera();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioLimit));
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "PointMeasure 3D viewport");

    this.controls = new PointerLockControls(this.camera, canvas);
    this.raycaster.params.Points = { threshold: 0.05 };

    const ambient = new THREE.AmbientLight(0xffffff, 1.15);
    this.scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
    keyLight.position.set(0.55, 1, 0.35);
    this.scene.add(keyLight);
    addSceneHelpers(this.scene);

    this.bindEvents();
    this.resize();
    this.focusViewport();
    this.animate();
  }

  setFrameCallback(callback: (info: ViewerFrameInfo) => void): void {
    this.onFrame = callback;
  }

  loadPointCloud(geometry: THREE.BufferGeometry, metadata: PointCloudMetadata): PointCloudMetadata {
    this.clearPointCloud();
    const position = geometry.getAttribute("position");
    if (!position || position.count <= 0) {
      throw new Error("Point cloud geometry does not contain any position points.");
    }

    this.sourceGeometry = geometry;
    this.sourceGeometry.computeBoundingBox();
    this.sourceGeometry.computeBoundingSphere();
    this.metadata = { ...metadata, pointSizePx: this.pointSize, currentPreset: this.renderPreset };
    this.setDisplaySampling(this.samplingStep);
    this.resetView();
    this.focusViewport();
    return this.metadata;
  }

  async loadGaussianSplat(
    buffer: ArrayBuffer,
    geometry: THREE.BufferGeometry,
    metadata: PointCloudMetadata,
    fileName: string
  ): Promise<PointCloudMetadata> {
    void buffer;
    void fileName;
    return this.loadPointCloud(geometry, {
      ...metadata,
      renderingMode: "Gaussian Splat",
      loadingMode: "Gaussian Splat Mode"
    });
  }

  loadReferenceMesh(geometry: THREE.BufferGeometry): void {
    this.clearReferenceMesh();
    const material = new THREE.MeshBasicMaterial({
      color: 0x57e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.18,
      wireframe: true,
      depthTest: true,
      depthWrite: false
    });
    this.referenceMesh = new THREE.Mesh(geometry, material);
    this.referenceMesh.name = "reference-mesh";
    this.referenceMesh.frustumCulled = false;
    this.referenceMesh.renderOrder = 20;
    this.scene.add(this.referenceMesh);
  }

  clearReferenceMesh(): void {
    if (!this.referenceMesh) {
      return;
    }

    this.scene.remove(this.referenceMesh);
    this.referenceMesh.geometry.dispose();
    disposeMaterial(this.referenceMesh.material);
    this.referenceMesh = null;
  }

  setPointSize(size: number): void {
    this.pointSize = THREE.MathUtils.clamp(size, 1, 6);
    if (this.displayVoxels && this.sourceGeometry) {
      this.setDisplaySampling(this.samplingStep);
      return;
    }
    if (this.pointMaterial instanceof THREE.ShaderMaterial && "pointSize" in this.pointMaterial.uniforms) {
      this.pointMaterial.uniforms.pointSize.value = this.pointSize;
    } else if (this.pointMaterial instanceof THREE.PointsMaterial) {
      this.pointMaterial.size = this.pointSize;
    }
    const pickMaterial = this.pickPoints?.material;
    if (pickMaterial instanceof THREE.PointsMaterial) {
      pickMaterial.size = this.pointSize;
    }
    if (this.metadata) {
      this.metadata = { ...this.metadata, pointSizePx: this.pointSize };
    }
  }

  setRenderPreset(preset: PointRenderPreset): PointCloudMetadata | null {
    this.renderPreset = preset;
    this.pixelRatioLimit = 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioLimit));
    this.resize();
    return this.setDisplaySampling(this.samplingStep);
  }

  setDisplayFilter(filter: PointDisplayFilter): PointCloudMetadata | null {
    this.displayFilter = filter;
    return this.setDisplaySampling(this.samplingStep);
  }

  setDisplaySampling(step: number): PointCloudMetadata | null {
    this.samplingStep = Math.max(1, Math.floor(step));
    if (!this.sourceGeometry || !this.metadata) {
      return this.metadata;
    }

    if (this.displayPoints) {
      this.scene.remove(this.displayPoints);
      this.disposeDisplayedGeometry();
    }
    if (this.displayVoxels) {
      this.scene.remove(this.displayVoxels);
      this.disposeInstancedMesh(this.displayVoxels);
      this.displayVoxels = null;
      this.disposeDisplayedGeometry();
    }

    const totalPoints = this.sourceGeometry.getAttribute("position")?.count ?? 0;
    const budgetStep = Math.max(1, Math.ceil(totalPoints / Math.max(1, this.metadata.pointBudget)));
    const effectiveStep = Math.max(this.samplingStep, budgetStep);
    this.displayGeometry = buildSampledGeometry(this.sourceGeometry, effectiveStep, this.displayFilter);
    const position = this.displayGeometry.getAttribute("position");
    if (!position || position.count <= 0) {
      throw new Error("Display point cloud has no position points.");
    }
    // PLYLoader normally leaves drawRange at its default, but explicitly reset it
    // whenever the display geometry is rebuilt. This prevents a stale/imported
    // range from silently hiding the tail of a large point cloud.
    this.displayGeometry.setDrawRange(0, position.count);
    if (!this.displayGeometry.boundingBox) {
      this.displayGeometry.computeBoundingBox();
    }
    if (!this.displayGeometry.boundingSphere) {
      this.displayGeometry.computeBoundingSphere();
    }

    const hasColor = this.metadata.hasRgb && this.displayGeometry.hasAttribute("color");
    this.pointMaterial = createDisplayPointMaterial(this.pointSize, hasColor, this.renderPreset);
    this.updateMaterialViewportHeight();
    this.displayPoints = new THREE.Points(this.displayGeometry, this.pointMaterial);
    this.displayPoints.name = "display-point-cloud";
    // A point cloud is already bounded by the camera's near/far planes. Avoid
    // object-level frustum rejection here because very large BufferGeometry
    // bounds can become stale after re-sampling or importing from another tool.
    this.displayPoints.frustumCulled = false;
    this.scene.add(this.displayPoints);
    this.verifyDisplayMaterial();

    const displayedPointCount = this.displayGeometry.getAttribute("position")?.count ?? 0;
    this.metadata = {
      ...this.metadata,
      displayedPointCount,
      loadedPoints: displayedPointCount,
      pointSizePx: this.pointSize,
      currentPreset: this.renderPreset
    };
    return this.metadata;
  }

  setRaycastThreshold(threshold: number): void {
    this.raycaster.params.Points = { threshold };
  }

  setMoveSpeed(speed: number): void {
    this.moveSpeed = speed;
  }

  getMovementMode(): MovementMode {
    return this.movementMode;
  }

  setMovementMode(mode: MovementMode): void {
    this.movementMode = mode;
  }

  toggleMovementMode(): MovementMode {
    this.movementMode = this.movementMode === "walk" ? "fly" : "walk";
    return this.movementMode;
  }

  setGridVisible(visible: boolean): void {
    const grid = this.scene.getObjectByName("floor-grid");
    if (grid) {
      grid.visible = visible;
    }
  }

  setAxesVisible(visible: boolean): void {
    const axes = this.scene.getObjectByName("world-axes");
    if (axes) {
      axes.visible = visible;
    }
  }

  setRoomPlanOverlay(roomPlan: Record<string, unknown> | null): void {
    if (this.roomPlanOverlay) {
      this.scene.remove(this.roomPlanOverlay);
      disposeRoomPlanOverlay(this.roomPlanOverlay);
      this.roomPlanOverlay = null;
    }

    if (!roomPlan) {
      return;
    }

    this.roomPlanOverlay = createRoomPlanOverlay(roomPlan);
    this.applyRoomPlanOverlayAlignment();
    this.scene.add(this.roomPlanOverlay);
  }

  setRoomPlanOverlayVisible(visible: boolean): void {
    if (this.roomPlanOverlay) {
      this.roomPlanOverlay.visible = visible;
    }
  }

  setRoomPlanOverlayAutoAlign(enabled: boolean): void {
    this.roomPlanAutoAlign = enabled;
    this.applyRoomPlanOverlayAlignment();
  }

  enterFirstPerson(): void {
    this.focusViewport();
    this.controls.lock();
  }

  exitFirstPerson(): void {
    this.controls.unlock();
    this.focusViewport();
  }

  focusViewport(): void {
    this.canvas.focus({ preventScroll: true });
  }

  resetView(): void {
    const box = this.sourceGeometry?.boundingBox;
    if (!box) {
      this.camera.near = 0.01;
      this.camera.far = 10_000;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(2.2, 1.7, 2.2);
      this.camera.lookAt(0, 0, 0);
      this.syncCameraAnglesFromCamera();
      return;
    }

    const home = computeCameraHome(box);
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z, 1);
    this.camera.near = Math.max(0.001, radius / 10_000);
    this.camera.far = Math.max(1000, radius * 100);
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(home.position);
    this.camera.lookAt(home.target);
    this.camera.updateMatrixWorld();
    this.syncCameraAnglesFromCamera();
  }

  pickPoint(clientX: number, clientY: number): Vector3Like | null {
    const rawPick = this.pickRawPointFromScreen(clientX, clientY);
    if (rawPick) {
      return rawPick;
    }

    const targetPoints = this.displayPoints ?? this.pickPoints;
    if (!targetPoints || !this.displayGeometry || !this.sourceGeometry) {
      return null;
    }

    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersections = this.raycaster.intersectObject(targetPoints, false);
    const first = intersections[0];
    if (!first || first.index === undefined) {
      return null;
    }

    const sourceIndex = getSourceIndex(this.displayGeometry, first.index);
    const position = this.sourceGeometry.getAttribute("position");
    const point = new THREE.Vector3().fromBufferAttribute(position, sourceIndex);
    return fromThreeVector(point);
  }

  pickMeasurementPoint(clientX: number, clientY: number, options: MeasurementPickOptions): MeasurementPickResult | null {
    const anchor = this.pickSourcePointFromScreen(clientX, clientY, options);
    if (!anchor) {
      return null;
    }

    if (options.mode === "nearest" || (anchor.source === "mesh" && options.mode === "smart")) {
      return this.createNearestMeasurementPick(anchor, options, undefined, 0);
    }

    if (options.mode === "edge" || options.mode === "smart") {
      const localCorner = this.tryResolveLocalCorner(anchor, options);
      if (localCorner) {
        return localCorner;
      }
    }

    const candidates = this.collectLocalCandidates(anchor.point, options);
    const localBox = computeLocalBox(candidates);
    if (candidates.length < 18) {
      return this.createNearestMeasurementPick(anchor, options, localBox, candidates.length);
    }

    const plane = fitPlaneRansac(candidates, {
      distanceThreshold: getPlaneDistanceThreshold(options),
      maxIterations: options.quality === "final" ? 160 : 72,
      seed: getPickSeed(anchor.sourceIndex, candidates.length)
    });

    if (!plane || !isUsablePlane(plane, candidates.length)) {
      return this.createNearestMeasurementPick(anchor, options, localBox, candidates.length);
    }

    if (options.mode === "edge" || options.mode === "smart") {
      const edge = this.tryFitLocalEdge(anchor.point, candidates, plane, options);
      if (edge) {
        return {
          point: fromThreeVector(projectPointToLine(anchor.point, edge.linePoint, edge.direction)),
          rawPoint: fromThreeVector(anchor.point),
          kind: "edge",
          confidence: edge.confidence,
          candidateCount: candidates.length,
          inlierCount: edge.inlierCount,
          sourcePointIndex: anchor.sourceIndex,
          analysisRadiusMeters: options.radiusMeters,
          plane: toMeasurementPlane(plane),
          secondaryPlane: toMeasurementPlane(edge.secondaryPlane),
          edge: toMeasurementLine(edge.linePoint, edge.direction, edge.inlierCount),
          localBox
        };
      }

      if (options.mode === "edge") {
        return this.createNearestMeasurementPick(anchor, options, localBox, candidates.length);
      }
    }

    const snapped = projectPointToPlane(anchor.point, plane.normal, plane.constant);
    return {
      point: fromThreeVector(snapped),
      rawPoint: fromThreeVector(anchor.point),
      kind: "plane",
      confidence: getPlaneConfidence(plane.inlierCount, candidates.length),
      candidateCount: candidates.length,
      inlierCount: plane.inlierCount,
      sourcePointIndex: anchor.sourceIndex,
      analysisRadiusMeters: options.radiusMeters,
      plane: toMeasurementPlane(plane),
      localBox
    };
  }

  fitMeasurementPlaneRegion(
    rectangle: ScreenRectangle,
    constraint: MeasurementPlaneConstraint,
    options: MeasurementPickOptions
  ): TrustedPlaneFitResult | null {
    const candidates = this.collectVisibleRegionCandidates(rectangle, options);
    if (candidates.length < 18) {
      return null;
    }

    const distanceThreshold = getRegionPlaneDistanceThreshold(options);
    const initialPlane = fitPlaneRansac(candidates, {
      distanceThreshold,
      maxIterations: options.quality === "final" ? 280 : 120,
      seed: getPickSeed(candidates[0]?.sourceIndex, candidates.length + 3089)
    });
    if (!initialPlane || initialPlane.inlierCount < 18) {
      return null;
    }

    const points = candidates.map((candidate) => fromThreeVector(candidate.point));
    const constrainedFit = fitStructurallyConstrainedPlane(
      points,
      {
        normal: fromThreeVector(initialPlane.normal),
        constant: initialPlane.constant
      },
      constraint,
      distanceThreshold
    );
    if (!constrainedFit) {
      return null;
    }

    const inlierPoints = constrainedFit.inlierIndices.map((index) => points[index]);
    const support = createPlaneSupportGeometry(
      inlierPoints,
      constrainedFit,
      constrainedFit.appliedConstraint
    );
    const localBox = computeLocalBox(candidates);
    if (!support || !localBox) {
      return null;
    }

    const quality = evaluateTrustedPlaneQuality({
      candidateCount: candidates.length,
      inlierCount: constrainedFit.inlierCount,
      rmsMeters: constrainedFit.rmsMeters,
      widthMeters: support.widthMeters,
      heightMeters: support.heightMeters,
      requestedConstraint: constraint,
      appliedConstraint: constrainedFit.appliedConstraint,
      orientationAdjustmentDegrees: constrainedFit.orientationAdjustmentDegrees
    });
    const inlierIndexSet = new Set(constrainedFit.inlierIndices);
    const outlierPoints = points.filter((_, index) => !inlierIndexSet.has(index));

    return {
      plane: {
        normal: constrainedFit.normal,
        constant: constrainedFit.constant,
        inlierCount: constrainedFit.inlierCount,
        rmsMeters: constrainedFit.rmsMeters,
        madMeters: constrainedFit.madMeters
      },
      point: support.point,
      horizontal: support.horizontal,
      vertical: support.vertical,
      corners: support.corners,
      localBox,
      widthMeters: support.widthMeters,
      heightMeters: support.heightMeters,
      areaSquareMeters: support.areaSquareMeters,
      candidateCount: candidates.length,
      inlierCount: constrainedFit.inlierCount,
      inlierRatio: constrainedFit.inlierCount / Math.max(1, candidates.length),
      confidence: quality.confidence,
      requestedConstraint: constraint,
      appliedConstraint: constrainedFit.appliedConstraint,
      orientationAdjustmentDegrees: constrainedFit.orientationAdjustmentDegrees,
      qualityStatus: quality.status,
      qualityIssues: quality.issues,
      inlierPreviewPoints: samplePreviewPoints(inlierPoints, REGION_PREVIEW_POINT_LIMIT),
      outlierPreviewPoints: samplePreviewPoints(outlierPoints, REGION_PREVIEW_POINT_LIMIT)
    };
  }

  fitStructuralBoundaryRegion(
    rectangle: ScreenRectangle,
    plane: TrustedPlaneFitResult,
    side: StructuralBoundarySide,
    options: MeasurementPickOptions
  ): StructuralBoundaryFitResult | null {
    const candidates = this.collectVisibleRegionCandidates(rectangle, options);
    if (candidates.length < 12) {
      return null;
    }

    return fitStructuralBoundary(
      candidates.map((candidate) => ({
        point: fromThreeVector(candidate.point),
        screenX: candidate.screenX,
        screenY: candidate.screenY
      })),
      plane,
      side,
      rectangle
    );
  }

  projectScreenToPlane(clientX: number, clientY: number, plane: MeasurementSnapPlane): Vector3Like | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const threePlane = new THREE.Plane(
      new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z).normalize(),
      plane.constant
    );
    const projected = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(threePlane, projected);
    return hit ? fromThreeVector(projected) : null;
  }

  projectWorldToScreen(point: Vector3Like): ScreenProjection | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const projected = new THREE.Vector3(point.x, point.y, point.z).project(this.camera);
    return {
      x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
      depth: projected.z,
      visible: projected.z >= -1 && projected.z <= 1
    };
  }

  pickNearestPoint(query: PickQuery): PickResult | null {
    const rawPick = this.pickRawPointFromRay(query);
    if (rawPick) {
      return rawPick;
    }

    const ray = new THREE.Ray(
      new THREE.Vector3(query.origin.x, query.origin.y, query.origin.z),
      new THREE.Vector3(query.direction.x, query.direction.y, query.direction.z).normalize()
    );
    this.raycaster.ray.copy(ray);
    this.raycaster.params.Points = { threshold: query.threshold };

    const targetPoints = this.displayPoints ?? this.pickPoints;
    if (!targetPoints || !this.displayGeometry || !this.sourceGeometry) {
      return null;
    }

    const intersections = this.raycaster.intersectObject(targetPoints, false);
    const first = intersections[0];
    if (!first || first.index === undefined) {
      return null;
    }

    const sourceIndex = getSourceIndex(this.displayGeometry, first.index);
    const position = this.sourceGeometry.getAttribute("position");
    const point = new THREE.Vector3().fromBufferAttribute(position, sourceIndex);
    return {
      point: fromThreeVector(point),
      source: "display",
      pointIndex: sourceIndex
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.clearPointCloud();
    this.renderer.dispose();
  }

  private bindEvents(): void {
    this.canvas.addEventListener("pointerdown", () => this.focusViewport());
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.handlePointerUp(event));
    this.canvas.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => {
      if (!this.shouldHandleKeyboardEvent(event)) {
        return;
      }
      if (event.code === "KeyM") {
        event.preventDefault();
        this.toggleMovementMode();
        return;
      }
      if (isNavigationKey(event.code)) {
        event.preventDefault();
      }
      this.keys.add(event.code);
    });
    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
    });
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.updateMaterialViewportHeight();
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.updateMovement(delta);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.({
      cameraPosition: fromThreeVector(this.camera.position),
      isFirstPerson: this.controls.isLocked,
      movementMode: this.movementMode
    });
  };

  private updateMovement(delta: number): void {
    if (!this.controls.isLocked && document.activeElement !== this.canvas) {
      return;
    }

    const boost = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 3 : 1;
    const distance = this.moveSpeed * boost * delta;
    if (this.controls.isLocked) {
      this.syncCameraAnglesFromCamera();
    }
    const forward = CameraController.getMovementForward(this.camera, this.movementMode, this.cameraYaw);
    const right = CameraController.getMovementRight(this.camera, this.movementMode, forward, this.cameraYaw);
    const movement = new THREE.Vector3();

    if (this.keys.has("KeyW")) movement.add(forward);
    if (this.keys.has("KeyS")) movement.sub(forward);
    if (this.keys.has("KeyA")) movement.sub(right);
    if (this.keys.has("KeyD")) movement.add(right);
    if (this.keys.has("Space")) movement.y += 1;
    if (this.keys.has("ControlLeft") || this.keys.has("ControlRight")) movement.y -= 1;

    if (movement.lengthSq() > 0) {
      this.camera.position.addScaledVector(movement.normalize(), distance);
      this.camera.updateMatrixWorld();
    }
  }

  private shouldHandleKeyboardEvent(event: KeyboardEvent): boolean {
    if (isEditableTarget(event.target)) {
      return false;
    }

    return this.controls.isLocked || document.activeElement === this.canvas;
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 2 || this.controls.isLocked) {
      return;
    }

    event.preventDefault();
    this.rightDragActive = true;
    this.lastRightDragX = event.clientX;
    this.lastRightDragY = event.clientY;
    this.focusViewport();
    this.canvas.setPointerCapture(event.pointerId);
  }

  private handlePointerMove(event: PointerEvent): void {
    if (!this.rightDragActive) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - this.lastRightDragX;
    const deltaY = event.clientY - this.lastRightDragY;
    this.lastRightDragX = event.clientX;
    this.lastRightDragY = event.clientY;
    this.rotateCameraFromDrag(deltaX, deltaY);
  }

  private handlePointerUp(event: PointerEvent): void {
    if (event.button !== 2 && !this.rightDragActive) {
      return;
    }

    this.rightDragActive = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  }

  private rotateCameraFromDrag(deltaX: number, deltaY: number): void {
    this.cameraYaw -= deltaX * 0.003;
    this.cameraPitch -= deltaY * 0.003;
    CameraController.applyYawPitch(this.camera, this.cameraYaw, this.cameraPitch);
    this.syncCameraAnglesFromCamera();
  }

  private syncCameraAnglesFromCamera(): void {
    const angles = CameraController.getYawPitch(this.camera);
    this.cameraYaw = angles.yaw;
    this.cameraPitch = angles.pitch;
  }

  private handleWheel(event: WheelEvent): void {
    if (isEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();
    this.focusViewport();
    const zoomDirection = event.deltaY < 0 ? 1 : -1;
    const zoomRatio = event.ctrlKey ? 0.08 : 0.18;
    const wheelSteps = THREE.MathUtils.clamp(Math.abs(event.deltaY) / 100, 0.25, 4);
    const direction = CameraController.getWheelZoomDirection(this.camera);
    const baseStep = Math.max(0.02, this.getSceneRadius() * zoomRatio);
    this.camera.position.addScaledVector(direction, baseStep * wheelSteps * zoomDirection);
    this.camera.updateMatrixWorld();
  }

  private getSceneRadius(): number {
    const sphere = this.sourceGeometry?.boundingSphere;
    return Math.max(sphere?.radius ?? 1, 1);
  }

  private verifyDisplayMaterial(): void {
    if (!this.displayPoints || !this.pointMaterial) {
      return;
    }

    try {
      this.renderer.compile(this.scene, this.camera);
    } catch (error) {
      console.warn("Round point shader failed, falling back to PointsMaterial.", error);
      disposeMaterial(this.displayPoints.material);
      this.pointMaterial = createFallbackPointMaterial(this.pointSize, this.displayGeometry?.hasAttribute("color") ?? false);
      this.displayPoints.material = this.pointMaterial;
    }
  }

  private updateMaterialViewportHeight(): void {
    if (this.pointMaterial instanceof THREE.ShaderMaterial && "viewportHeight" in this.pointMaterial.uniforms) {
      this.pointMaterial.uniforms.viewportHeight.value = Math.max(1, this.canvas.clientHeight * this.renderer.getPixelRatio());
    }
  }

  private clearPointCloud(): void {
    this.clearReferenceMesh();
    if (this.displayPoints) {
      this.scene.remove(this.displayPoints);
    }
    if (this.displayVoxels) {
      this.scene.remove(this.displayVoxels);
      this.disposeInstancedMesh(this.displayVoxels);
    }
    if (this.pickPoints) {
      this.scene.remove(this.pickPoints);
      disposeMaterial(this.pickPoints.material);
    }
    this.disposeDisplayedGeometry();
    this.displayPoints = null;
    this.displayVoxels = null;
    this.pickPoints = null;

    if (this.sourceGeometry) {
      this.sourceGeometry.dispose();
    }
    this.sourceGeometry = null;
    this.metadata = null;
    this.structuralEdges.length = 0;
  }

  private installPickGeometry(): void {
    if (!this.sourceGeometry || !this.metadata) {
      return;
    }

    if (this.pickPoints) {
      this.scene.remove(this.pickPoints);
      disposeMaterial(this.pickPoints.material);
      this.pickPoints = null;
    }
    this.disposeDisplayedGeometry();

    const totalPoints = this.sourceGeometry.getAttribute("position")?.count ?? 0;
    const budgetStep = Math.max(1, Math.ceil(totalPoints / Math.max(1, this.metadata.pointBudget)));
    const effectiveStep = Math.max(this.samplingStep, budgetStep);
    this.displayGeometry = buildSampledGeometry(this.sourceGeometry, effectiveStep, "none");
    this.pickPoints = new THREE.Points(this.displayGeometry, createPickPointMaterial(this.pointSize));
    this.pickPoints.name = "pick-point-cloud";
    this.pickPoints.frustumCulled = false;
    this.scene.add(this.pickPoints);
  }

  private disposeDisplayedGeometry(): void {
    if (this.displayGeometry && this.displayGeometry !== this.sourceGeometry) {
      this.displayGeometry.dispose();
    }
    this.displayGeometry = null;

    if (this.pointMaterial) {
      this.pointMaterial.dispose();
    }
    this.pointMaterial = null;
  }

  private disposeInstancedMesh(mesh: THREE.InstancedMesh): void {
    mesh.geometry.dispose();
    disposeMaterial(mesh.material);
  }

  private applyRoomPlanOverlayAlignment(): void {
    if (!this.roomPlanOverlay) {
      return;
    }

    this.roomPlanOverlay.position.set(0, 0, 0);
    if (!this.roomPlanAutoAlign || !this.sourceGeometry?.boundingBox) {
      return;
    }

    const roomPlanBox = getRoomPlanAlignmentBox(this.roomPlanOverlay);
    if (!roomPlanBox) {
      return;
    }

    const pointCloudBox = computeRobustPointCloudBox(this.sourceGeometry) ?? this.sourceGeometry.boundingBox;
    const roomPlanCenter = new THREE.Vector3();
    const pointCloudCenter = new THREE.Vector3();
    roomPlanBox.getCenter(roomPlanCenter);
    pointCloudBox.getCenter(pointCloudCenter);

    const fullPointCloudBox = this.sourceGeometry.boundingBox;
    const yOffset = fullPointCloudBox.min.y - roomPlanBox.min.y;
    this.roomPlanOverlay.position.set(
      pointCloudCenter.x - roomPlanCenter.x,
      yOffset,
      pointCloudCenter.z - roomPlanCenter.z
    );
  }

  private pickSourcePointFromScreen(clientX: number, clientY: number, options: MeasurementPickOptions): SourcePick | null {
    const meshPick = this.pickReferenceMeshPointFromScreen(clientX, clientY);
    if (meshPick) {
      return meshPick;
    }

    const sampledPick = this.pickSampledRawPointFromScreen(clientX, clientY, options);
    if (sampledPick) {
      return sampledPick;
    }

    const fallback = this.pickDisplaySourcePointFromScreen(clientX, clientY);
    if (fallback) {
      return fallback;
    }

    const rawPoint = this.pickRawPointFromScreen(clientX, clientY);
    return rawPoint
      ? {
          point: new THREE.Vector3(rawPoint.x, rawPoint.y, rawPoint.z),
          sourceIndex: undefined,
          source: "raw"
        }
      : null;
  }

  private pickReferenceMeshPointFromScreen(clientX: number, clientY: number): SourcePick | null {
    if (!this.referenceMesh) {
      return null;
    }

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersections = this.raycaster.intersectObject(this.referenceMesh, false);
    const first = intersections[0];
    if (!first) {
      return null;
    }

    return {
      point: first.point.clone(),
      source: "mesh"
    };
  }

  private pickSampledRawPointFromScreen(clientX: number, clientY: number, options: MeasurementPickOptions): SourcePick | null {
    const sourcePosition = this.sourceGeometry?.getAttribute("position");
    if (!sourcePosition) {
      return null;
    }

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const targetX = clientX - rect.left;
    const targetY = clientY - rect.top;
    const threshold = this.raycaster.params.Points?.threshold ?? 0.05;
    const qualityScale = options.quality === "final" ? 1.2 : 0.92;
    const pixelRadius = THREE.MathUtils.clamp(threshold * 260 * qualityScale, 8, options.quality === "final" ? 42 : 28);
    const pixelRadiusSq = pixelRadius * pixelRadius;
    const sampleLimit = options.quality === "final" ? FINAL_PICK_SAMPLE_LIMIT : PREVIEW_PICK_SAMPLE_LIMIT;
    const step = Math.max(1, Math.ceil(sourcePosition.count / sampleLimit));
    const projected = new THREE.Vector3();
    const viewPoint = new THREE.Vector3();
    let bestIndex = -1;
    let bestDistanceSq = Infinity;
    let bestViewDepth = Infinity;

    this.camera.updateMatrixWorld();
    for (let index = 0; index < sourcePosition.count; index += step) {
      projected.fromBufferAttribute(sourcePosition, index);
      viewPoint.copy(projected).applyMatrix4(this.camera.matrixWorldInverse);
      if (viewPoint.z >= -this.camera.near || -viewPoint.z > this.camera.far) {
        continue;
      }

      projected.project(this.camera);
      if (projected.z < -1 || projected.z > 1) {
        continue;
      }

      const screenX = (projected.x * 0.5 + 0.5) * rect.width;
      const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
      const deltaX = screenX - targetX;
      const deltaY = screenY - targetY;
      const distanceSq = deltaX * deltaX + deltaY * deltaY;
      if (distanceSq > pixelRadiusSq) {
        continue;
      }

      const viewDepth = -viewPoint.z;
      if (distanceSq < bestDistanceSq - 1.25 || (Math.abs(distanceSq - bestDistanceSq) <= 1.25 && viewDepth < bestViewDepth)) {
        bestIndex = index;
        bestDistanceSq = distanceSq;
        bestViewDepth = viewDepth;
      }
    }

    if (bestIndex < 0) {
      return null;
    }

    return {
      point: new THREE.Vector3().fromBufferAttribute(sourcePosition, bestIndex),
      sourceIndex: bestIndex,
      source: "raw"
    };
  }

  private pickDisplaySourcePointFromScreen(clientX: number, clientY: number): SourcePick | null {
    const targetPoints = this.displayPoints ?? this.pickPoints;
    if (!targetPoints || !this.displayGeometry || !this.sourceGeometry) {
      return null;
    }

    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersections = this.raycaster.intersectObject(targetPoints, false);
    const first = intersections[0];
    if (!first || first.index === undefined) {
      return null;
    }

    const sourceIndex = getSourceIndex(this.displayGeometry, first.index);
    const position = this.sourceGeometry.getAttribute("position");
    return {
      point: new THREE.Vector3().fromBufferAttribute(position, sourceIndex),
      sourceIndex,
      source: "display"
    };
  }

  private createNearestMeasurementPick(
    anchor: SourcePick,
    options: MeasurementPickOptions,
    localBox: MeasurementLocalBox | undefined,
    candidateCount: number
  ): MeasurementPickResult {
    return {
      point: fromThreeVector(anchor.point),
      rawPoint: fromThreeVector(anchor.point),
      kind: anchor.source === "mesh" ? "mesh" : "nearest",
      confidence: anchor.source === "mesh" ? 0.84 : 0.42,
      candidateCount: Math.max(1, candidateCount),
      inlierCount: 1,
      sourcePointIndex: anchor.sourceIndex,
      analysisRadiusMeters: options.radiusMeters,
      localBox
    };
  }

  private collectLocalCandidates(anchor: THREE.Vector3, options: MeasurementPickOptions): LocalCandidate[] {
    return this.collectLocalCandidatesWithinRadius(anchor, options.radiusMeters, options);
  }

  private collectVisibleRegionCandidates(
    rectangle: ScreenRectangle,
    options: MeasurementPickOptions
  ): LocalCandidate[] {
    const sourcePosition = this.sourceGeometry?.getAttribute("position");
    const canvasBounds = this.canvas.getBoundingClientRect();
    if (!sourcePosition || canvasBounds.width <= 0 || canvasBounds.height <= 0) {
      return [];
    }

    const left = THREE.MathUtils.clamp(
      Math.min(rectangle.left, rectangle.right),
      canvasBounds.left,
      canvasBounds.right
    );
    const right = THREE.MathUtils.clamp(
      Math.max(rectangle.left, rectangle.right),
      canvasBounds.left,
      canvasBounds.right
    );
    const top = THREE.MathUtils.clamp(
      Math.min(rectangle.top, rectangle.bottom),
      canvasBounds.top,
      canvasBounds.bottom
    );
    const bottom = THREE.MathUtils.clamp(
      Math.max(rectangle.top, rectangle.bottom),
      canvasBounds.top,
      canvasBounds.bottom
    );
    if (right - left < 8 || bottom - top < 8) {
      return [];
    }

    this.camera.updateMatrixWorld();
    const sampleLimit = options.quality === "final" ? FINAL_PICK_SAMPLE_LIMIT : PREVIEW_PICK_SAMPLE_LIMIT;
    const step = Math.max(1, Math.ceil(sourcePosition.count / sampleLimit));
    const cellSizePixels = options.quality === "final" ? 3 : 5;
    const visibleDepthBandMeters = options.preset === "beam_column" ? 0.045 : 0.06;
    const maxPerCell = options.quality === "final" ? 6 : 3;
    const point = new THREE.Vector3();
    const viewPoint = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const buckets = new Map<string, VisibleRegionBucket>();

    for (let index = 0; index < sourcePosition.count; index += step) {
      point.fromBufferAttribute(sourcePosition, index);
      viewPoint.copy(point).applyMatrix4(this.camera.matrixWorldInverse);
      const viewDepth = -viewPoint.z;
      if (viewDepth <= this.camera.near || viewDepth >= this.camera.far) {
        continue;
      }

      projected.copy(point).project(this.camera);
      if (projected.z < -1 || projected.z > 1) {
        continue;
      }

      const screenX = canvasBounds.left + (projected.x * 0.5 + 0.5) * canvasBounds.width;
      const screenY = canvasBounds.top + (-projected.y * 0.5 + 0.5) * canvasBounds.height;
      if (screenX < left || screenX > right || screenY < top || screenY > bottom) {
        continue;
      }

      const key = `${Math.floor((screenX - left) / cellSizePixels)},${Math.floor((screenY - top) / cellSizePixels)}`;
      const candidate: LocalCandidate = {
        point: point.clone(),
        sourceIndex: index,
        distanceSq: viewDepth * viewDepth,
        screenX,
        screenY
      };
      const bucket = buckets.get(key);
      if (!bucket || viewDepth < bucket.nearestDepth - visibleDepthBandMeters) {
        buckets.set(key, {
          nearestDepth: viewDepth,
          seen: 1,
          candidates: [candidate]
        });
        continue;
      }
      if (viewDepth > bucket.nearestDepth + visibleDepthBandMeters) {
        continue;
      }

      bucket.seen += 1;
      bucket.nearestDepth = Math.min(bucket.nearestDepth, viewDepth);
      if (bucket.candidates.length < maxPerCell) {
        bucket.candidates.push(candidate);
      } else {
        const replacementIndex = deterministicReservoirSlot(bucket.seen, maxPerCell);
        if (replacementIndex >= 0) {
          bucket.candidates[replacementIndex] = candidate;
        }
      }
    }

    const candidates: LocalCandidate[] = [];
    let seen = 0;
    const orderedBuckets = [...buckets.entries()].sort(([first], [second]) => first.localeCompare(second));
    for (const [, bucket] of orderedBuckets) {
      for (const candidate of bucket.candidates) {
        seen += 1;
        if (candidates.length < FINAL_MAX_REGION_CANDIDATES) {
          candidates.push(candidate);
        } else {
          const replacementIndex = deterministicReservoirSlot(seen, FINAL_MAX_REGION_CANDIDATES);
          if (replacementIndex >= 0) {
            candidates[replacementIndex] = candidate;
          }
        }
      }
    }
    return candidates;
  }

  private collectLocalCandidatesWithinRadius(
    anchor: THREE.Vector3,
    radiusMeters: number,
    options: MeasurementPickOptions
  ): LocalCandidate[] {
    const sourcePosition = this.sourceGeometry?.getAttribute("position");
    if (!sourcePosition) {
      return [];
    }

    const sampleLimit = options.quality === "final" ? FINAL_LOCAL_SAMPLE_LIMIT : PREVIEW_LOCAL_SAMPLE_LIMIT;
    const maxCandidates = options.quality === "final" ? FINAL_MAX_LOCAL_CANDIDATES : PREVIEW_MAX_LOCAL_CANDIDATES;
    const step = Math.max(1, Math.ceil(sourcePosition.count / sampleLimit));
    const radiusSq = radiusMeters * radiusMeters;
    const voxelSize = THREE.MathUtils.clamp(
      radiusMeters / (options.preset === "beam_column" ? 18 : 24),
      0.006,
      0.025
    );
    const inverseVoxelSize = 1 / voxelSize;
    const maxPerVoxel = options.quality === "final" ? 8 : 4;
    const point = new THREE.Vector3();
    const voxelBuckets = new Map<string, { seen: number; candidates: LocalCandidate[] }>();

    for (let index = 0; index < sourcePosition.count; index += step) {
      point.fromBufferAttribute(sourcePosition, index);
      const distanceSq = point.distanceToSquared(anchor);
      if (distanceSq > radiusSq) {
        continue;
      }

      const candidate: LocalCandidate = {
        point: point.clone(),
        sourceIndex: index,
        distanceSq
      };
      const key = `${Math.floor(point.x * inverseVoxelSize)},${Math.floor(point.y * inverseVoxelSize)},${Math.floor(point.z * inverseVoxelSize)}`;
      const bucket = voxelBuckets.get(key) ?? { seen: 0, candidates: [] };
      bucket.seen += 1;
      if (bucket.candidates.length < maxPerVoxel) {
        bucket.candidates.push(candidate);
      } else {
        const replacementIndex = deterministicReservoirSlot(bucket.seen, maxPerVoxel);
        if (replacementIndex >= 0) {
          bucket.candidates[replacementIndex] = candidate;
        }
      }
      voxelBuckets.set(key, bucket);
    }

    const candidates: LocalCandidate[] = [];
    let seen = 0;
    const orderedBuckets = [...voxelBuckets.entries()].sort(([first], [second]) => first.localeCompare(second));
    for (const [, bucket] of orderedBuckets) {
      for (const candidate of bucket.candidates) {
        seen += 1;
        if (candidates.length < maxCandidates) {
          candidates.push(candidate);
          continue;
        }
        const replacementIndex = deterministicReservoirSlot(seen, maxCandidates);
        if (replacementIndex >= 0) {
          candidates[replacementIndex] = candidate;
        }
      }
    }
    return candidates;
  }

  private tryResolveLocalCorner(anchor: SourcePick, options: MeasurementPickOptions): MeasurementPickResult | null {
    const radiusMeters = getLocalCornerSearchRadius(options);
    const candidates = this.collectLocalCandidatesWithinRadius(anchor.point, radiusMeters, options);
    if (candidates.length < getMinLocalCornerCandidateCount(options)) {
      return null;
    }

    const localBox = computeLocalBox(candidates);
    const cachedEdge = this.trySnapToStructuralEdge(anchor, options, radiusMeters, localBox, candidates.length);
    if (cachedEdge) {
      return cachedEdge;
    }

    const projectedCorner = fitLocalProjectedCorner(anchor.point, candidates, options, radiusMeters);
    const planeEdge = fitWideLocalPlaneEdge(anchor.point, candidates, options, radiusMeters);
    if (planeEdge) {
      this.rememberStructuralEdge(planeEdge, candidates, radiusMeters);
    }

    return chooseLocalCornerPick({
      anchor,
      candidates,
      localBox,
      projectedCorner,
      planeEdge,
      radiusMeters
    });
  }

  private trySnapToStructuralEdge(
    anchor: SourcePick,
    options: MeasurementPickOptions,
    radiusMeters: number,
    localBox: MeasurementLocalBox | undefined,
    candidateCount: number
  ): MeasurementPickResult | null {
    let best: { edge: StructuralEdge; point: THREE.Vector3; score: number } | null = null;
    const maxDistance = getStructuralEdgeSnapDistance(options, radiusMeters);

    for (const edge of this.structuralEdges) {
      const point = projectPointToLine(anchor.point, edge.linePoint, edge.direction);
      const distance = point.distanceTo(anchor.point);
      if (distance > maxDistance) {
        continue;
      }

      const t = edge.direction.dot(point.clone().sub(edge.linePoint));
      const spanMargin = Math.max(radiusMeters * 0.65, 0.1);
      if (t < edge.minT - spanMargin || t > edge.maxT + spanMargin) {
        continue;
      }

      const horizontalBias = isMostlyHorizontalEdge(edge.direction) ? -0.035 : 0;
      const score = distance + horizontalBias - edge.confidence * 0.02;
      if (!best || score < best.score) {
        best = { edge, point, score };
      }
    }

    if (!best) {
      return null;
    }

    best.edge.updatedAt = performance.now();
    return {
      point: fromThreeVector(best.point),
      rawPoint: fromThreeVector(anchor.point),
      kind: "edge",
      confidence: THREE.MathUtils.clamp(best.edge.confidence + 0.04, 0.62, 0.99),
      candidateCount: Math.max(candidateCount, best.edge.candidateCount),
      inlierCount: best.edge.inlierCount,
      sourcePointIndex: anchor.sourceIndex,
      analysisRadiusMeters: radiusMeters,
      plane: toMeasurementPlane(best.edge.primaryPlane),
      secondaryPlane: toMeasurementPlane(best.edge.secondaryPlane),
      edge: toMeasurementLine(best.edge.linePoint, best.edge.direction, best.edge.inlierCount),
      localBox,
      localCorner: true
    };
  }

  private rememberStructuralEdge(edge: LocalPlaneEdge, candidates: LocalCandidate[], radiusMeters: number): void {
    const span = measureStructuralEdgeSpan(edge.linePoint, edge.direction, candidates, radiusMeters);
    const candidate: StructuralEdge = {
      linePoint: edge.linePoint.clone(),
      direction: edge.direction.clone().normalize(),
      primaryPlane: cloneRansacPlane(edge.primaryPlane),
      secondaryPlane: cloneRansacPlane(edge.secondaryPlane),
      minT: span.minT,
      maxT: span.maxT,
      inlierCount: edge.inlierCount,
      candidateCount: candidates.length,
      confidence: edge.confidence,
      updatedAt: performance.now()
    };

    const mergeTarget = this.structuralEdges.find((existing) => shouldMergeStructuralEdges(existing, candidate, radiusMeters));
    if (mergeTarget) {
      mergeStructuralEdge(mergeTarget, candidate);
    } else {
      this.structuralEdges.push(candidate);
    }
    this.pruneStructuralEdges();
  }

  private pruneStructuralEdges(): void {
    const maxEdges = 32;
    if (this.structuralEdges.length <= maxEdges) {
      return;
    }
    this.structuralEdges.sort((a, b) => b.updatedAt - a.updatedAt);
    this.structuralEdges.length = maxEdges;
  }

  private tryFitLocalEdge(
    anchor: THREE.Vector3,
    candidates: LocalCandidate[],
    primaryPlane: RansacPlane,
    options: MeasurementPickOptions
  ): LocalEdge | null {
    const threshold = getPlaneDistanceThreshold(options);
    const outliers = candidates.filter((candidate) => Math.abs(primaryPlane.normal.dot(candidate.point) + primaryPlane.constant) > threshold * 1.7);
    if (outliers.length < 18 || outliers.length < candidates.length * 0.12) {
      return null;
    }

    const secondaryPlane = fitPlaneRansac(outliers, {
      distanceThreshold: threshold,
      maxIterations: options.quality === "final" ? 120 : 56,
      seed: getPickSeed(outliers[0]?.sourceIndex, outliers.length + 31)
    });
    if (!secondaryPlane || !isUsablePlane(secondaryPlane, outliers.length)) {
      return null;
    }

    const direction = primaryPlane.normal.clone().cross(secondaryPlane.normal);
    const normalCross = direction.length();
    if (normalCross < EDGE_MIN_NORMAL_CROSS) {
      return null;
    }

    direction.divideScalar(normalCross);
    const linePoint = getPlaneIntersectionPoint(primaryPlane, secondaryPlane);
    if (!linePoint || !Number.isFinite(linePoint.x) || !Number.isFinite(linePoint.y) || !Number.isFinite(linePoint.z)) {
      return null;
    }

    const projected = projectPointToLine(anchor, linePoint, direction);
    if (projected.distanceTo(anchor) > getMaxEdgeSnapDistance(options)) {
      return null;
    }

    const support = validateLocalEdgeSupport(anchor, candidates, primaryPlane, secondaryPlane, linePoint, direction, threshold, options);
    if (!support) {
      return null;
    }

    const inlierCount = Math.min(candidates.length, support.primaryInlierCount + support.secondaryInlierCount);
    return {
      linePoint,
      direction,
      secondaryPlane,
      inlierCount,
      confidence: getEdgeConfidence(inlierCount, candidates.length, support, normalCross)
    };
  }

  private pickRawPointFromScreen(clientX: number, clientY: number): Vector3Like | null {
    const sourcePosition = this.sourceGeometry?.getAttribute("position");
    if (!sourcePosition || sourcePosition.count > RAW_PICK_MAX_POINTS) {
      return null;
    }

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const targetX = clientX - rect.left;
    const targetY = clientY - rect.top;
    const threshold = this.raycaster.params.Points?.threshold ?? 0.05;
    const pixelRadius = THREE.MathUtils.clamp(threshold * 220, 5, 26);
    const pixelRadiusSq = pixelRadius * pixelRadius;
    const projected = new THREE.Vector3();
    const viewPoint = new THREE.Vector3();
    let bestIndex = -1;
    let bestDistanceSq = Infinity;
    let bestViewDepth = Infinity;

    this.camera.updateMatrixWorld();
    for (let index = 0; index < sourcePosition.count; index += 1) {
      projected.fromBufferAttribute(sourcePosition, index);
      viewPoint.copy(projected).applyMatrix4(this.camera.matrixWorldInverse);
      if (viewPoint.z >= -this.camera.near || -viewPoint.z > this.camera.far) {
        continue;
      }

      projected.project(this.camera);
      if (projected.z < -1 || projected.z > 1) {
        continue;
      }

      const screenX = (projected.x * 0.5 + 0.5) * rect.width;
      const screenY = (-projected.y * 0.5 + 0.5) * rect.height;
      const deltaX = screenX - targetX;
      const deltaY = screenY - targetY;
      const distanceSq = deltaX * deltaX + deltaY * deltaY;
      if (distanceSq > pixelRadiusSq) {
        continue;
      }

      const viewDepth = -viewPoint.z;
      if (distanceSq < bestDistanceSq - 1.5 || (Math.abs(distanceSq - bestDistanceSq) <= 1.5 && viewDepth < bestViewDepth)) {
        bestIndex = index;
        bestDistanceSq = distanceSq;
        bestViewDepth = viewDepth;
      }
    }

    if (bestIndex < 0) {
      return null;
    }

    projected.fromBufferAttribute(sourcePosition, bestIndex);
    return fromThreeVector(projected);
  }

  private pickRawPointFromRay(query: PickQuery): PickResult | null {
    const sourcePosition = this.sourceGeometry?.getAttribute("position");
    if (!sourcePosition || sourcePosition.count > RAW_PICK_MAX_POINTS) {
      return null;
    }

    const ray = new THREE.Ray(
      new THREE.Vector3(query.origin.x, query.origin.y, query.origin.z),
      new THREE.Vector3(query.direction.x, query.direction.y, query.direction.z).normalize()
    );
    const thresholdSq = query.threshold * query.threshold;
    const point = new THREE.Vector3();
    const toPoint = new THREE.Vector3();
    let bestIndex = -1;
    let bestDistanceSq = Infinity;
    let bestRayDistance = Infinity;

    for (let index = 0; index < sourcePosition.count; index += 1) {
      point.fromBufferAttribute(sourcePosition, index);
      const rayDistance = ray.direction.dot(toPoint.copy(point).sub(ray.origin));
      if (rayDistance < this.camera.near || rayDistance > this.camera.far) {
        continue;
      }

      const distanceSq = ray.distanceSqToPoint(point);
      if (distanceSq <= thresholdSq && (distanceSq < bestDistanceSq || (distanceSq === bestDistanceSq && rayDistance < bestRayDistance))) {
        bestIndex = index;
        bestDistanceSq = distanceSq;
        bestRayDistance = rayDistance;
      }
    }

    if (bestIndex < 0) {
      return null;
    }

    point.fromBufferAttribute(sourcePosition, bestIndex);
    return {
      point: fromThreeVector(point),
      source: "raw",
      pointIndex: bestIndex
    };
  }
}

type SourcePick = {
  point: THREE.Vector3;
  sourceIndex?: number;
  source?: "mesh" | "raw" | "display";
};

type LocalCandidate = {
  point: THREE.Vector3;
  sourceIndex: number;
  distanceSq: number;
  screenX?: number;
  screenY?: number;
};

type VisibleRegionBucket = {
  nearestDepth: number;
  seen: number;
  candidates: LocalCandidate[];
};

type RansacPlane = {
  normal: THREE.Vector3;
  constant: number;
  inlierCount: number;
  rmsMeters?: number;
  madMeters?: number;
};

type LocalEdge = {
  linePoint: THREE.Vector3;
  direction: THREE.Vector3;
  secondaryPlane: RansacPlane;
  inlierCount: number;
  confidence: number;
};

type LocalPlaneEdge = {
  linePoint: THREE.Vector3;
  direction: THREE.Vector3;
  primaryPlane: RansacPlane;
  secondaryPlane: RansacPlane;
  inlierCount: number;
  confidence: number;
  snapDistance: number;
};

type StructuralEdge = {
  linePoint: THREE.Vector3;
  direction: THREE.Vector3;
  primaryPlane: RansacPlane;
  secondaryPlane: RansacPlane;
  minT: number;
  maxT: number;
  inlierCount: number;
  candidateCount: number;
  confidence: number;
  updatedAt: number;
};

type LocalEdgeSupport = {
  primaryInlierCount: number;
  secondaryInlierCount: number;
  primaryNearLineCount: number;
  secondaryNearLineCount: number;
  primaryOneSidedness: number;
  secondaryOneSidedness: number;
  primarySpanMeters: number;
  secondarySpanMeters: number;
};

type ProjectionPlane = "xz" | "xy" | "yz";

type ProjectedPoint = {
  u: number;
  v: number;
};

type LocalProjectedCorner = {
  projection: ProjectionPlane;
  point: THREE.Vector3;
  primaryLine: ProjectedRansacLine;
  secondaryLine: ProjectedRansacLine;
  primarySupport: ProjectedLineCornerSupport;
  secondarySupport: ProjectedLineCornerSupport;
  inlierCount: number;
  confidence: number;
};

type ProjectedRansacLine = {
  a: number;
  b: number;
  d: number;
  inlierCount: number;
  distanceSum: number;
};

type ProjectedLineCornerSupport = {
  inlierCount: number;
  nearCornerCount: number;
  oneSidedness: number;
  tangentSpanMeters: number;
  freeAxisSpanMeters: number;
  minT: number;
  maxT: number;
};

type ProjectedLineRansacOptions = {
  distanceThreshold: number;
  maxIterations: number;
  seed: number;
};

type PlaneEdgeSupport = {
  inlierCount: number;
  nearLineCount: number;
  oneSidedness: number;
  spanMeters: number;
  minT: number;
  maxT: number;
};

type RansacOptions = {
  distanceThreshold: number;
  maxIterations: number;
  seed: number;
};

type LocalCornerPickInput = {
  anchor: SourcePick;
  candidates: LocalCandidate[];
  localBox?: MeasurementLocalBox;
  projectedCorner: LocalProjectedCorner | null;
  planeEdge: LocalPlaneEdge | null;
  radiusMeters: number;
};

function chooseLocalCornerPick(input: LocalCornerPickInput): MeasurementPickResult | null {
  const projectedPick = input.projectedCorner
    ? createProjectedCornerPickResult(input.anchor, input.projectedCorner, input.candidates, input.localBox, input.radiusMeters)
    : null;
  const planeEdgePick = input.planeEdge
    ? createPlaneEdgePickResult(input.anchor, input.planeEdge, input.candidates, input.localBox, input.radiusMeters)
    : null;

  if (!projectedPick) {
    return planeEdgePick;
  }
  if (!planeEdgePick || !input.planeEdge || !input.projectedCorner) {
    return projectedPick;
  }

  const horizontalPlaneEdge = isMostlyHorizontalEdge(input.planeEdge.direction);
  if (horizontalPlaneEdge && input.planeEdge.snapDistance <= getWideLocalEdgePreferredSnapDistance(input.radiusMeters)) {
    return planeEdgePick;
  }

  if (
    horizontalPlaneEdge &&
    input.planeEdge.confidence >= projectedPick.confidence - 0.1 &&
    input.planeEdge.snapDistance <= distanceThreeToLike(input.anchor.point, projectedPick.point) * 1.8 + 0.025
  ) {
    return planeEdgePick;
  }

  if (!isVerticalProjection(input.projectedCorner.projection) && planeEdgePick.confidence >= projectedPick.confidence - 0.08) {
    return planeEdgePick;
  }

  return projectedPick;
}

function createProjectedCornerPickResult(
  anchor: SourcePick,
  corner: LocalProjectedCorner,
  candidates: LocalCandidate[],
  localBox: MeasurementLocalBox | undefined,
  radiusMeters: number
): MeasurementPickResult {
  const snappedPoint = createProjectedCornerPoint(corner.projection, corner.point, anchor.point);
  const edgeDirection = getProjectionFreeAxis(corner.projection);
  return {
    point: fromThreeVector(snappedPoint),
    rawPoint: fromThreeVector(anchor.point),
    kind: "edge",
    confidence: corner.confidence,
    candidateCount: candidates.length,
    inlierCount: corner.inlierCount,
    sourcePointIndex: anchor.sourceIndex,
    analysisRadiusMeters: radiusMeters,
    plane: toMeasurementPlane(projectedLineToPlane(corner.projection, corner.primaryLine, corner.primarySupport.inlierCount)),
    secondaryPlane: toMeasurementPlane(projectedLineToPlane(corner.projection, corner.secondaryLine, corner.secondarySupport.inlierCount)),
    edge: toMeasurementLine(snappedPoint, edgeDirection, corner.inlierCount),
    localBox,
    localCorner: true
  };
}

function createPlaneEdgePickResult(
  anchor: SourcePick,
  edge: LocalPlaneEdge,
  candidates: LocalCandidate[],
  localBox: MeasurementLocalBox | undefined,
  radiusMeters: number
): MeasurementPickResult {
  const snappedPoint = projectPointToLine(anchor.point, edge.linePoint, edge.direction);
  return {
    point: fromThreeVector(snappedPoint),
    rawPoint: fromThreeVector(anchor.point),
    kind: "edge",
    confidence: edge.confidence,
    candidateCount: candidates.length,
    inlierCount: edge.inlierCount,
    sourcePointIndex: anchor.sourceIndex,
    analysisRadiusMeters: radiusMeters,
    plane: toMeasurementPlane(edge.primaryPlane),
    secondaryPlane: toMeasurementPlane(edge.secondaryPlane),
    edge: toMeasurementLine(edge.linePoint, edge.direction, edge.inlierCount),
    localBox,
    localCorner: true
  };
}

function fitLocalProjectedCorner(
  anchor: THREE.Vector3,
  candidates: LocalCandidate[],
  options: MeasurementPickOptions,
  radiusMeters: number
): LocalProjectedCorner | null {
  const projections: ProjectionPlane[] = ["xz", "xy", "yz"];
  let best: LocalProjectedCorner | null = null;
  for (const projection of projections) {
    const corner = fitLocalProjectedCornerInPlane(projection, anchor, candidates, options, radiusMeters);
    if (!corner) {
      continue;
    }
    if (!best || corner.confidence > best.confidence) {
      best = corner;
    }
  }
  return best;
}

function fitLocalProjectedCornerInPlane(
  projection: ProjectionPlane,
  anchor: THREE.Vector3,
  candidates: LocalCandidate[],
  options: MeasurementPickOptions,
  radiusMeters: number
): LocalProjectedCorner | null {
  const threshold = getLocalCornerLineThreshold(options);
  const iterations = options.quality === "final" ? 180 : 84;
  const firstLine = fitProjectedLineRansac(projection, candidates, {
    distanceThreshold: threshold,
    maxIterations: iterations,
    seed: getPickSeed(candidates[0]?.sourceIndex, candidates.length + 401)
  });
  if (!firstLine || !isInitiallyUsableProjectedLine(firstLine, candidates.length, options)) {
    return null;
  }

  const remaining = candidates.filter((candidate) => distanceToProjectedLine(projection, firstLine, candidate.point) > threshold * 1.65);
  if (remaining.length < getMinLocalCornerCandidateCount(options) * 0.55) {
    return null;
  }

  const secondLine = fitProjectedLineRansac(projection, remaining, {
    distanceThreshold: threshold,
    maxIterations: iterations,
    seed: getPickSeed(remaining[0]?.sourceIndex, remaining.length + 811)
  });
  if (!secondLine) {
    return null;
  }

  const normalDot = Math.abs(firstLine.a * secondLine.a + firstLine.b * secondLine.b);
  const normalCross = Math.abs(firstLine.a * secondLine.b - secondLine.a * firstLine.b);
  if (normalDot > LOCAL_CORNER_MAX_NORMAL_DOT || normalCross < 0.42) {
    return null;
  }

  const intersection = intersectProjectedLines(projection, firstLine, secondLine);
  if (!intersection) {
    return null;
  }

  const projectedDistance = distanceInProjection(projection, anchor, intersection);
  const maxSnapDistance = getLocalCornerMaxSnapDistance(options, radiusMeters);
  if (projectedDistance > maxSnapDistance) {
    return null;
  }

  const primarySupport = measureProjectedLineCornerSupport(projection, firstLine, candidates, intersection, threshold, radiusMeters);
  const secondarySupport = measureProjectedLineCornerSupport(projection, secondLine, candidates, intersection, threshold, radiusMeters);
  if (
    !isUsableProjectedCornerSupport(primarySupport, candidates.length, options, radiusMeters) ||
    !isUsableProjectedCornerSupport(secondarySupport, candidates.length, options, radiusMeters)
  ) {
    return null;
  }

  const primaryLine = { ...firstLine, inlierCount: primarySupport.inlierCount };
  const secondaryLine = { ...secondLine, inlierCount: secondarySupport.inlierCount };
  const inlierCount = Math.min(candidates.length, primarySupport.inlierCount + secondarySupport.inlierCount);
  return {
    projection,
    point: intersection,
    primaryLine,
    secondaryLine,
    primarySupport,
    secondarySupport,
    inlierCount,
    confidence: getLocalCornerConfidence({
      inlierCount,
      candidateCount: candidates.length,
      primarySupport,
      secondarySupport,
      normalCross,
      projectedDistance,
      maxSnapDistance
    })
  };
}

function fitProjectedLineRansac(
  projection: ProjectionPlane,
  candidates: LocalCandidate[],
  options: ProjectedLineRansacOptions
): ProjectedRansacLine | null {
  if (candidates.length < 2) {
    return null;
  }

  const random = createSeededRandom(options.seed);
  let bestLine: ProjectedRansacLine | null = null;
  let bestScore = -Infinity;

  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    const aIndex = Math.floor(random() * candidates.length);
    let bIndex = Math.floor(random() * candidates.length);
    if (bIndex === aIndex) {
      bIndex = (bIndex + 1) % candidates.length;
    }

    const line = createProjectedLineFromPoints(projection, candidates[aIndex].point, candidates[bIndex].point);
    if (!line) {
      continue;
    }

    const evaluated = evaluateProjectedLine(projection, line, candidates, options.distanceThreshold);
    const score = evaluated.inlierCount - evaluated.distanceSum / Math.max(options.distanceThreshold, 0.0001) * 0.04;
    if (score > bestScore) {
      bestScore = score;
      bestLine = evaluated;
    }
  }

  if (!bestLine) {
    return null;
  }

  const inliers = getProjectedLineInliers(projection, bestLine, candidates, options.distanceThreshold * 1.15);
  const refined = refineProjectedLineFromInliers(projection, inliers, bestLine);
  return evaluateProjectedLine(projection, refined ?? bestLine, candidates, options.distanceThreshold);
}

function createProjectedLineFromPoints(projection: ProjectionPlane, first: THREE.Vector3, second: THREE.Vector3): ProjectedRansacLine | null {
  const firstProjected = projectForLine(projection, first);
  const secondProjected = projectForLine(projection, second);
  const du = secondProjected.u - firstProjected.u;
  const dv = secondProjected.v - firstProjected.v;
  const length = Math.hypot(du, dv);
  if (length < 0.025) {
    return null;
  }

  const a = dv / length;
  const b = -du / length;
  return {
    a,
    b,
    d: -(a * firstProjected.u + b * firstProjected.v),
    inlierCount: 0,
    distanceSum: 0
  };
}

function refineProjectedLineFromInliers(
  projection: ProjectionPlane,
  inliers: LocalCandidate[],
  fallback: ProjectedRansacLine
): ProjectedRansacLine | null {
  if (inliers.length < 2) {
    return null;
  }

  let meanU = 0;
  let meanV = 0;
  for (const inlier of inliers) {
    const projected = projectForLine(projection, inlier.point);
    meanU += projected.u;
    meanV += projected.v;
  }
  meanU /= inliers.length;
  meanV /= inliers.length;

  let uu = 0;
  let uv = 0;
  let vv = 0;
  for (const inlier of inliers) {
    const projected = projectForLine(projection, inlier.point);
    const du = projected.u - meanU;
    const dv = projected.v - meanV;
    uu += du * du;
    uv += du * dv;
    vv += dv * dv;
  }

  if (uu + vv < 1e-8) {
    return null;
  }

  const angle = 0.5 * Math.atan2(2 * uv, uu - vv);
  const tangentU = Math.cos(angle);
  const tangentV = Math.sin(angle);
  let a = -tangentV;
  let b = tangentU;
  if (a * fallback.a + b * fallback.b < 0) {
    a = -a;
    b = -b;
  }

  return {
    a,
    b,
    d: -(a * meanU + b * meanV),
    inlierCount: 0,
    distanceSum: 0
  };
}

function evaluateProjectedLine(
  projection: ProjectionPlane,
  line: ProjectedRansacLine,
  candidates: LocalCandidate[],
  threshold: number
): ProjectedRansacLine {
  let inlierCount = 0;
  let distanceSum = 0;
  for (const candidate of candidates) {
    const distance = distanceToProjectedLine(projection, line, candidate.point);
    if (distance <= threshold) {
      inlierCount += 1;
      distanceSum += distance;
    }
  }
  return {
    ...line,
    inlierCount,
    distanceSum
  };
}

function getProjectedLineInliers(
  projection: ProjectionPlane,
  line: ProjectedRansacLine,
  candidates: LocalCandidate[],
  threshold: number
): LocalCandidate[] {
  return candidates.filter((candidate) => distanceToProjectedLine(projection, line, candidate.point) <= threshold);
}

function distanceToProjectedLine(projection: ProjectionPlane, line: ProjectedRansacLine, point: THREE.Vector3): number {
  const projected = projectForLine(projection, point);
  return Math.abs(line.a * projected.u + line.b * projected.v + line.d);
}

function intersectProjectedLines(projection: ProjectionPlane, first: ProjectedRansacLine, second: ProjectedRansacLine): THREE.Vector3 | null {
  const determinant = first.a * second.b - second.a * first.b;
  if (Math.abs(determinant) < 0.42) {
    return null;
  }

  const u = (first.b * second.d - second.b * first.d) / determinant;
  const v = (second.a * first.d - first.a * second.d) / determinant;
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    return null;
  }
  return unprojectLinePoint(projection, u, v);
}

function measureProjectedLineCornerSupport(
  projection: ProjectionPlane,
  line: ProjectedRansacLine,
  candidates: LocalCandidate[],
  corner: THREE.Vector3,
  threshold: number,
  radiusMeters: number
): ProjectedLineCornerSupport {
  const tangent = getProjectedLineTangent(line);
  const cornerProjected = projectForLine(projection, corner);
  const inlierThreshold = threshold * 1.45;
  const nearCornerBand = THREE.MathUtils.clamp(radiusMeters * 0.22, 0.075, 0.18);
  const sideDeadBand = Math.max(threshold * 2.2, 0.018);
  let inlierCount = 0;
  let nearCornerCount = 0;
  let minT = Infinity;
  let maxT = -Infinity;
  let minFree = Infinity;
  let maxFree = -Infinity;
  let positiveSideCount = 0;
  let negativeSideCount = 0;

  for (const candidate of candidates) {
    if (distanceToProjectedLine(projection, line, candidate.point) > inlierThreshold) {
      continue;
    }

    const projected = projectForLine(projection, candidate.point);
    const t = tangent.u * (projected.u - cornerProjected.u) + tangent.v * (projected.v - cornerProjected.v);
    const free = getProjectionFreeCoordinate(projection, candidate.point);
    inlierCount += 1;
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
    minFree = Math.min(minFree, free);
    maxFree = Math.max(maxFree, free);

    if (Math.abs(t) <= nearCornerBand) {
      nearCornerCount += 1;
    }
    if (t > sideDeadBand) {
      positiveSideCount += 1;
    } else if (t < -sideDeadBand) {
      negativeSideCount += 1;
    }
  }

  const sidedCount = positiveSideCount + negativeSideCount;
  return {
    inlierCount,
    nearCornerCount,
    oneSidedness: sidedCount < 8 ? 1 : Math.max(positiveSideCount, negativeSideCount) / sidedCount,
    tangentSpanMeters: inlierCount > 1 ? maxT - minT : 0,
    freeAxisSpanMeters: inlierCount > 1 ? maxFree - minFree : 0,
    minT,
    maxT
  };
}

function isInitiallyUsableProjectedLine(line: ProjectedRansacLine, candidateCount: number, options: MeasurementPickOptions): boolean {
  return line.inlierCount >= getMinLocalCornerLineInliers(candidateCount, options);
}

function isUsableProjectedCornerSupport(
  support: ProjectedLineCornerSupport,
  candidateCount: number,
  options: MeasurementPickOptions,
  radiusMeters: number
): boolean {
  if (support.inlierCount < getMinLocalCornerLineInliers(candidateCount, options)) {
    return false;
  }
  if (support.freeAxisSpanMeters < getMinLocalCornerFreeAxisSpan(options)) {
    return false;
  }
  if (support.tangentSpanMeters < getMinLocalCornerTangentSpan(options, radiusMeters)) {
    return false;
  }

  const cornerMargin = Math.max(0.08, radiusMeters * 0.18);
  if (support.minT > cornerMargin || support.maxT < -cornerMargin) {
    return false;
  }

  const minNearCornerCount = Math.min(
    18,
    Math.max(options.quality === "final" ? 3 : 2, Math.ceil(support.inlierCount * 0.008))
  );
  if (support.nearCornerCount < minNearCornerCount) {
    return false;
  }

  const minOneSidedness = options.quality === "final" ? 0.58 : 0.54;
  return support.oneSidedness >= minOneSidedness;
}

function getProjectedLineTangent(line: ProjectedRansacLine): ProjectedPoint {
  return { u: -line.b, v: line.a };
}

function distanceInProjection(projection: ProjectionPlane, first: THREE.Vector3, second: THREE.Vector3): number {
  const firstProjected = projectForLine(projection, first);
  const secondProjected = projectForLine(projection, second);
  return Math.hypot(firstProjected.u - secondProjected.u, firstProjected.v - secondProjected.v);
}

function projectedLineToPlane(projection: ProjectionPlane, line: ProjectedRansacLine, inlierCount: number): RansacPlane {
  const normal = projection === "xz"
    ? new THREE.Vector3(line.a, 0, line.b)
    : projection === "xy"
      ? new THREE.Vector3(line.a, line.b, 0)
      : new THREE.Vector3(0, line.a, line.b);
  return { normal, constant: line.d, inlierCount };
}

function projectForLine(projection: ProjectionPlane, point: THREE.Vector3): ProjectedPoint {
  if (projection === "xz") {
    return { u: point.x, v: point.z };
  }
  if (projection === "xy") {
    return { u: point.x, v: point.y };
  }
  return { u: point.y, v: point.z };
}

function unprojectLinePoint(projection: ProjectionPlane, u: number, v: number): THREE.Vector3 {
  if (projection === "xz") {
    return new THREE.Vector3(u, 0, v);
  }
  if (projection === "xy") {
    return new THREE.Vector3(u, v, 0);
  }
  return new THREE.Vector3(0, u, v);
}

function createProjectedCornerPoint(projection: ProjectionPlane, corner: THREE.Vector3, anchor: THREE.Vector3): THREE.Vector3 {
  if (projection === "xz") {
    return new THREE.Vector3(corner.x, anchor.y, corner.z);
  }
  if (projection === "xy") {
    return new THREE.Vector3(corner.x, corner.y, anchor.z);
  }
  return new THREE.Vector3(anchor.x, corner.y, corner.z);
}

function getProjectionFreeAxis(projection: ProjectionPlane): THREE.Vector3 {
  if (projection === "xz") {
    return new THREE.Vector3(0, 1, 0);
  }
  if (projection === "xy") {
    return new THREE.Vector3(0, 0, 1);
  }
  return new THREE.Vector3(1, 0, 0);
}

function getProjectionFreeCoordinate(projection: ProjectionPlane, point: THREE.Vector3): number {
  if (projection === "xz") {
    return point.y;
  }
  if (projection === "xy") {
    return point.z;
  }
  return point.x;
}

function isVerticalProjection(projection: ProjectionPlane): boolean {
  return projection === "xz";
}

function distanceThreeToLike(first: THREE.Vector3, second: Vector3Like): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function getLocalCornerSearchRadius(options: MeasurementPickOptions): number {
  if (options.preset === "beam_column") {
    const minRadius = options.quality === "final" ? 0.26 : 0.22;
    const maxRadius = options.quality === "final" ? 0.5 : 0.4;
    return THREE.MathUtils.clamp(options.radiusMeters * 2.6, minRadius, maxRadius);
  }
  const minRadius = options.quality === "final" ? 0.38 : 0.32;
  const maxRadius = options.quality === "final" ? 0.85 : 0.62;
  return THREE.MathUtils.clamp(options.radiusMeters * 4, minRadius, maxRadius);
}

function getLocalCornerLineThreshold(options: MeasurementPickOptions): number {
  if (options.preset === "beam_column") {
    return THREE.MathUtils.clamp(options.radiusMeters * 0.1, 0.008, 0.018);
  }
  return THREE.MathUtils.clamp(options.radiusMeters * 0.18, 0.012, 0.032);
}

function getLocalCornerMaxSnapDistance(options: MeasurementPickOptions, radiusMeters: number): number {
  if (options.preset === "beam_column") {
    return Math.min(radiusMeters * 0.52, THREE.MathUtils.clamp(options.radiusMeters * 1.4, 0.08, 0.16));
  }
  const scale = options.quality === "final" ? 2.8 : 2.2;
  return Math.min(radiusMeters * 0.75, THREE.MathUtils.clamp(options.radiusMeters * scale, 0.18, 0.36));
}

function getMinLocalCornerCandidateCount(options: MeasurementPickOptions): number {
  return options.quality === "final" ? 42 : 28;
}

function getMinLocalCornerLineInliers(candidateCount: number, options: MeasurementPickOptions): number {
  const floor = options.quality === "final" ? 22 : 14;
  const ratio = options.quality === "final" ? 0.018 : 0.014;
  return Math.max(floor, Math.ceil(candidateCount * ratio));
}

function getMinLocalCornerFreeAxisSpan(options: MeasurementPickOptions): number {
  return options.quality === "final" ? 0.22 : 0.16;
}

function getMinLocalCornerTangentSpan(options: MeasurementPickOptions, radiusMeters: number): number {
  const spanScale = options.quality === "final" ? 0.34 : 0.28;
  const floor = options.quality === "final" ? 0.16 : 0.12;
  return Math.max(floor, radiusMeters * spanScale);
}

function getLocalCornerConfidence(params: {
  inlierCount: number;
  candidateCount: number;
  primarySupport: ProjectedLineCornerSupport;
  secondarySupport: ProjectedLineCornerSupport;
  normalCross: number;
  projectedDistance: number;
  maxSnapDistance: number;
}): number {
  const inlierRatio = params.inlierCount / Math.max(1, params.candidateCount);
  const oneSidedness = Math.min(params.primarySupport.oneSidedness, params.secondarySupport.oneSidedness);
  const spanBalance = Math.min(params.primarySupport.tangentSpanMeters, params.secondarySupport.tangentSpanMeters) /
    Math.max(0.001, Math.max(params.primarySupport.tangentSpanMeters, params.secondarySupport.tangentSpanMeters));
  const freeAxisScore = THREE.MathUtils.clamp(
    Math.min(params.primarySupport.freeAxisSpanMeters, params.secondarySupport.freeAxisSpanMeters) / 0.7,
    0,
    1
  );
  const distanceScore = THREE.MathUtils.clamp(1 - params.projectedDistance / Math.max(0.001, params.maxSnapDistance), 0, 1);
  const confidence = 0.38 +
    inlierRatio * 0.82 +
    params.normalCross * 0.12 +
    distanceScore * 0.14 +
    oneSidedness * 0.12 +
    spanBalance * 0.06 +
    freeAxisScore * 0.06;
  return THREE.MathUtils.clamp(confidence, 0.58, 0.97);
}

function fitPlaneRansac(candidates: LocalCandidate[], options: RansacOptions): RansacPlane | null {
  if (candidates.length < 3) {
    return null;
  }

  const random = createSeededRandom(options.seed);
  const threshold = options.distanceThreshold;
  let bestPlane: RansacPlane | null = null;
  let bestScore = -Infinity;

  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    const aIndex = Math.floor(random() * candidates.length);
    let bIndex = Math.floor(random() * candidates.length);
    let cIndex = Math.floor(random() * candidates.length);
    if (bIndex === aIndex) {
      bIndex = (bIndex + 1) % candidates.length;
    }
    if (cIndex === aIndex || cIndex === bIndex) {
      cIndex = (cIndex + 2) % candidates.length;
    }

    const plane = createPlaneFromPoints(candidates[aIndex].point, candidates[bIndex].point, candidates[cIndex].point);
    if (!plane) {
      continue;
    }

    let inlierCount = 0;
    let distanceSum = 0;
    for (const candidate of candidates) {
      const distance = Math.abs(plane.normal.dot(candidate.point) + plane.constant);
      if (distance <= threshold) {
        inlierCount += 1;
        distanceSum += distance;
      }
    }

    const score = inlierCount - distanceSum / Math.max(threshold, 0.0001) * 0.04;
    if (score > bestScore) {
      bestScore = score;
      bestPlane = {
        ...plane,
        inlierCount
      };
    }
  }

  if (!bestPlane) {
    return null;
  }

  const refined = refinePlaneFromPoints(
    candidates.map((candidate) => candidate.point),
    {
      normal: fromThreeVector(bestPlane.normal),
      constant: bestPlane.constant
    },
    threshold
  );
  if (!refined) {
    return bestPlane;
  }

  return {
    normal: new THREE.Vector3(refined.normal.x, refined.normal.y, refined.normal.z),
    constant: refined.constant,
    inlierCount: refined.inlierCount,
    rmsMeters: refined.rmsMeters,
    madMeters: refined.madMeters
  };
}

function createPlaneFromPoints(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): RansacPlane | null {
  const ab = b.clone().sub(a);
  const ac = c.clone().sub(a);
  const normal = ab.cross(ac);
  if (normal.lengthSq() < 1e-8) {
    return null;
  }

  normal.normalize();
  return {
    normal,
    constant: -normal.dot(a),
    inlierCount: 0
  };
}

function isUsablePlane(plane: RansacPlane, candidateCount: number): boolean {
  if (plane.inlierCount < 18) {
    return false;
  }

  return plane.inlierCount / Math.max(1, candidateCount) >= 0.16;
}

function getPlaneDistanceThreshold(options: MeasurementPickOptions): number {
  if (options.preset === "beam_column") {
    return THREE.MathUtils.clamp(options.radiusMeters * 0.075, 0.005, 0.014);
  }
  return THREE.MathUtils.clamp(options.radiusMeters * 0.1, 0.006, 0.024);
}

function getRegionPlaneDistanceThreshold(options: MeasurementPickOptions): number {
  const localThreshold = getPlaneDistanceThreshold(options);
  return options.preset === "beam_column"
    ? THREE.MathUtils.clamp(localThreshold * 1.15, 0.007, 0.018)
    : THREE.MathUtils.clamp(localThreshold * 1.1, 0.008, 0.024);
}

function getPlaneConfidence(inlierCount: number, candidateCount: number): number {
  return THREE.MathUtils.clamp((inlierCount / Math.max(1, candidateCount)) * 1.18, 0.45, 0.96);
}

function getMaxEdgeSnapDistance(options: MeasurementPickOptions): number {
  const qualityScale = options.quality === "final" ? 1.05 : 0.92;
  return Math.max(options.radiusMeters * qualityScale, 0.05);
}

function fitWideLocalPlaneEdge(
  anchor: THREE.Vector3,
  candidates: LocalCandidate[],
  options: MeasurementPickOptions,
  radiusMeters: number
): LocalPlaneEdge | null {
  const threshold = getWidePlaneDistanceThreshold(options);
  const primaryPlane = fitPlaneRansac(candidates, {
    distanceThreshold: threshold,
    maxIterations: options.quality === "final" ? 240 : 112,
    seed: getPickSeed(candidates[0]?.sourceIndex, candidates.length + 1229)
  });
  if (!primaryPlane || !isUsableWidePlane(primaryPlane, candidates.length, options)) {
    return null;
  }

  const outliers = candidates.filter((candidate) => Math.abs(primaryPlane.normal.dot(candidate.point) + primaryPlane.constant) > threshold * 1.65);
  if (outliers.length < getMinWideLocalPlaneOutliers(options) || outliers.length < candidates.length * 0.08) {
    return null;
  }

  const secondaryPlane = fitPlaneRansac(outliers, {
    distanceThreshold: threshold,
    maxIterations: options.quality === "final" ? 180 : 88,
    seed: getPickSeed(outliers[0]?.sourceIndex, outliers.length + 1877)
  });
  if (!secondaryPlane || !isUsableWidePlane(secondaryPlane, outliers.length, options)) {
    return null;
  }

  const direction = primaryPlane.normal.clone().cross(secondaryPlane.normal);
  const normalCross = direction.length();
  if (normalCross < EDGE_MIN_NORMAL_CROSS) {
    return null;
  }
  direction.divideScalar(normalCross);

  const linePoint = getPlaneIntersectionPoint(primaryPlane, secondaryPlane);
  if (!linePoint || !Number.isFinite(linePoint.x) || !Number.isFinite(linePoint.y) || !Number.isFinite(linePoint.z)) {
    return null;
  }

  const snappedPoint = projectPointToLine(anchor, linePoint, direction);
  const snapDistance = snappedPoint.distanceTo(anchor);
  const maxSnapDistance = getWideLocalEdgeMaxSnapDistance(options, radiusMeters);
  if (snapDistance > maxSnapDistance) {
    return null;
  }

  const support = validateLocalEdgeSupport(anchor, candidates, primaryPlane, secondaryPlane, linePoint, direction, threshold, options);
  if (!support) {
    return null;
  }

  const inlierCount = Math.min(candidates.length, support.primaryInlierCount + support.secondaryInlierCount);
  const confidence = getWideLocalEdgeConfidence({
    baseConfidence: getEdgeConfidence(inlierCount, candidates.length, support, normalCross),
    direction,
    snapDistance,
    maxSnapDistance,
    support
  });

  return {
    linePoint,
    direction,
    primaryPlane,
    secondaryPlane,
    inlierCount,
    confidence,
    snapDistance
  };
}

function getWidePlaneDistanceThreshold(options: MeasurementPickOptions): number {
  if (options.preset === "beam_column") {
    return THREE.MathUtils.clamp(options.radiusMeters * 0.1, 0.008, 0.018);
  }
  return THREE.MathUtils.clamp(options.radiusMeters * 0.16, 0.012, options.quality === "final" ? 0.04 : 0.034);
}

function isUsableWidePlane(plane: RansacPlane, candidateCount: number, options: MeasurementPickOptions): boolean {
  const minInliers = options.quality === "final" ? 24 : 18;
  if (plane.inlierCount < minInliers) {
    return false;
  }
  const minRatio = options.quality === "final" ? 0.07 : 0.055;
  return plane.inlierCount / Math.max(1, candidateCount) >= minRatio;
}

function getMinWideLocalPlaneOutliers(options: MeasurementPickOptions): number {
  return options.quality === "final" ? 28 : 20;
}

function getWideLocalEdgeMaxSnapDistance(options: MeasurementPickOptions, radiusMeters: number): number {
  if (options.preset === "beam_column") {
    return Math.min(radiusMeters * 0.55, THREE.MathUtils.clamp(options.radiusMeters * 1.5, 0.08, 0.18));
  }
  const scale = options.quality === "final" ? 3.4 : 2.75;
  const max = options.quality === "final" ? 0.48 : 0.38;
  return Math.min(radiusMeters * 0.82, THREE.MathUtils.clamp(options.radiusMeters * scale, 0.2, max));
}

function getWideLocalEdgePreferredSnapDistance(radiusMeters: number): number {
  return Math.max(0.08, radiusMeters * 0.45);
}

function getWideLocalEdgeConfidence(params: {
  baseConfidence: number;
  direction: THREE.Vector3;
  snapDistance: number;
  maxSnapDistance: number;
  support: LocalEdgeSupport;
}): number {
  const distanceScore = THREE.MathUtils.clamp(1 - params.snapDistance / Math.max(0.001, params.maxSnapDistance), 0, 1);
  const horizontalBoost = isMostlyHorizontalEdge(params.direction) ? 0.08 : 0.02;
  const supportBalance = Math.min(params.support.primaryInlierCount, params.support.secondaryInlierCount) /
    Math.max(1, Math.max(params.support.primaryInlierCount, params.support.secondaryInlierCount));
  return THREE.MathUtils.clamp(params.baseConfidence + distanceScore * 0.1 + supportBalance * 0.04 + horizontalBoost, 0.56, 0.99);
}

function isMostlyHorizontalEdge(direction: THREE.Vector3): boolean {
  return Math.abs(direction.y) <= 0.5;
}

function getStructuralEdgeSnapDistance(options: MeasurementPickOptions, radiusMeters: number): number {
  if (options.preset === "beam_column") {
    return Math.max(0.05, Math.min(radiusMeters * 0.3, 0.11));
  }
  const scale = options.quality === "final" ? 0.42 : 0.34;
  return Math.max(0.07, Math.min(radiusMeters * scale, options.quality === "final" ? 0.22 : 0.16));
}

function measureStructuralEdgeSpan(
  linePoint: THREE.Vector3,
  direction: THREE.Vector3,
  candidates: LocalCandidate[],
  radiusMeters: number
): { minT: number; maxT: number } {
  const nearLineBand = Math.max(0.055, radiusMeters * 0.14);
  let minT = Infinity;
  let maxT = -Infinity;

  for (const candidate of candidates) {
    const delta = candidate.point.clone().sub(linePoint);
    const t = direction.dot(delta);
    const lineDistance = delta.addScaledVector(direction, -t).length();
    if (lineDistance > nearLineBand) {
      continue;
    }
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
  }

  if (!Number.isFinite(minT) || !Number.isFinite(maxT) || maxT - minT < 0.12) {
    return { minT: -radiusMeters * 0.5, maxT: radiusMeters * 0.5 };
  }

  const margin = Math.max(0.08, radiusMeters * 0.2);
  return { minT: minT - margin, maxT: maxT + margin };
}

function cloneRansacPlane(plane: RansacPlane): RansacPlane {
  return {
    normal: plane.normal.clone(),
    constant: plane.constant,
    inlierCount: plane.inlierCount,
    rmsMeters: plane.rmsMeters,
    madMeters: plane.madMeters
  };
}

function shouldMergeStructuralEdges(existing: StructuralEdge, candidate: StructuralEdge, radiusMeters: number): boolean {
  if (Math.abs(existing.direction.dot(candidate.direction)) < 0.94) {
    return false;
  }

  if (distanceBetweenLines(existing.linePoint, existing.direction, candidate.linePoint, candidate.direction) > Math.max(0.08, radiusMeters * 0.32)) {
    return false;
  }

  return arePlanePairsCompatible(existing.primaryPlane, existing.secondaryPlane, candidate.primaryPlane, candidate.secondaryPlane);
}

function mergeStructuralEdge(target: StructuralEdge, source: StructuralEdge): void {
  const sourceStart = source.linePoint.clone().addScaledVector(source.direction, source.minT);
  const sourceEnd = source.linePoint.clone().addScaledVector(source.direction, source.maxT);
  const sourceStartT = target.direction.dot(sourceStart.sub(target.linePoint));
  const sourceEndT = target.direction.dot(sourceEnd.sub(target.linePoint));
  target.minT = Math.min(target.minT, sourceStartT, sourceEndT);
  target.maxT = Math.max(target.maxT, sourceStartT, sourceEndT);
  target.inlierCount = Math.max(target.inlierCount, source.inlierCount);
  target.candidateCount = Math.max(target.candidateCount, source.candidateCount);
  target.confidence = Math.max(target.confidence, source.confidence);
  target.updatedAt = Math.max(target.updatedAt, source.updatedAt);

  const direction = target.direction.clone().multiplyScalar(0.75).add(source.direction.clone().multiplyScalar(target.direction.dot(source.direction) < 0 ? -0.25 : 0.25));
  if (direction.lengthSq() > 1e-8) {
    target.direction.copy(direction.normalize());
  }
}

function distanceBetweenLines(
  firstPoint: THREE.Vector3,
  firstDirection: THREE.Vector3,
  secondPoint: THREE.Vector3,
  secondDirection: THREE.Vector3
): number {
  const cross = firstDirection.clone().cross(secondDirection);
  const delta = secondPoint.clone().sub(firstPoint);
  if (cross.lengthSq() < 1e-6) {
    return delta.clone().cross(firstDirection).length();
  }
  return Math.abs(delta.dot(cross.normalize()));
}

function arePlanePairsCompatible(
  firstA: RansacPlane,
  firstB: RansacPlane,
  secondA: RansacPlane,
  secondB: RansacPlane
): boolean {
  return (arePlanesCompatible(firstA, secondA) && arePlanesCompatible(firstB, secondB)) ||
    (arePlanesCompatible(firstA, secondB) && arePlanesCompatible(firstB, secondA));
}

function arePlanesCompatible(first: RansacPlane, second: RansacPlane): boolean {
  if (Math.abs(first.normal.dot(second.normal)) < 0.82) {
    return false;
  }
  return Math.abs(first.constant - second.constant) < 0.16 || Math.abs(first.constant + second.constant) < 0.16;
}

function validateLocalEdgeSupport(
  anchor: THREE.Vector3,
  candidates: LocalCandidate[],
  primaryPlane: RansacPlane,
  secondaryPlane: RansacPlane,
  linePoint: THREE.Vector3,
  direction: THREE.Vector3,
  threshold: number,
  options: MeasurementPickOptions
): LocalEdgeSupport | null {
  const inlierThreshold = threshold * 1.45;
  const primaryInliers = collectPlaneInliers(candidates, primaryPlane, inlierThreshold);
  const secondaryInliers = collectPlaneInliers(candidates, secondaryPlane, inlierThreshold);
  if (primaryInliers.length < 18 || secondaryInliers.length < 18) {
    return null;
  }

  const primarySideAxis = getPlaneEdgeSideAxis(direction, primaryPlane.normal);
  const secondarySideAxis = getPlaneEdgeSideAxis(direction, secondaryPlane.normal);
  if (!primarySideAxis || !secondarySideAxis) {
    return null;
  }

  const nearLineBand = getEdgeNearLineBand(options, threshold);
  const sideDeadBand = threshold * 1.75;
  const primarySupport = measurePlaneEdgeSupport(primaryInliers, linePoint, direction, primarySideAxis, nearLineBand, sideDeadBand);
  const secondarySupport = measurePlaneEdgeSupport(secondaryInliers, linePoint, direction, secondarySideAxis, nearLineBand, sideDeadBand);
  const minNearLineCount = getMinNearLineCount(primarySupport.inlierCount, secondarySupport.inlierCount, options);
  if (primarySupport.nearLineCount < minNearLineCount || secondarySupport.nearLineCount < minNearLineCount) {
    return null;
  }

  const minSpanMeters = getMinEdgeSupportSpan(options);
  const averageSpanMeters = (primarySupport.spanMeters + secondarySupport.spanMeters) * 0.5;
  if (
    primarySupport.spanMeters < minSpanMeters * 0.65 ||
    secondarySupport.spanMeters < minSpanMeters * 0.65 ||
    averageSpanMeters < minSpanMeters
  ) {
    return null;
  }

  const snapT = direction.dot(anchor.clone().sub(linePoint));
  const spanMargin = Math.max(options.radiusMeters * 0.28, threshold * 3);
  if (!isSupportedLineParameter(primarySupport, snapT, spanMargin) || !isSupportedLineParameter(secondarySupport, snapT, spanMargin)) {
    return null;
  }

  const minOneSidedness = options.quality === "final" ? 0.66 : 0.6;
  if (primarySupport.oneSidedness < minOneSidedness || secondarySupport.oneSidedness < minOneSidedness) {
    return null;
  }

  return {
    primaryInlierCount: primarySupport.inlierCount,
    secondaryInlierCount: secondarySupport.inlierCount,
    primaryNearLineCount: primarySupport.nearLineCount,
    secondaryNearLineCount: secondarySupport.nearLineCount,
    primaryOneSidedness: primarySupport.oneSidedness,
    secondaryOneSidedness: secondarySupport.oneSidedness,
    primarySpanMeters: primarySupport.spanMeters,
    secondarySpanMeters: secondarySupport.spanMeters
  };
}

function collectPlaneInliers(candidates: LocalCandidate[], plane: RansacPlane, threshold: number): LocalCandidate[] {
  return candidates.filter((candidate) => Math.abs(plane.normal.dot(candidate.point) + plane.constant) <= threshold);
}

function getPlaneEdgeSideAxis(direction: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 | null {
  const axis = direction.clone().cross(normal);
  if (axis.lengthSq() < 1e-8) {
    return null;
  }
  return axis.normalize();
}

function measurePlaneEdgeSupport(
  inliers: LocalCandidate[],
  linePoint: THREE.Vector3,
  direction: THREE.Vector3,
  sideAxis: THREE.Vector3,
  nearLineBand: number,
  sideDeadBand: number
): PlaneEdgeSupport {
  let nearLineCount = 0;
  let minT = Infinity;
  let maxT = -Infinity;
  let positiveSideCount = 0;
  let negativeSideCount = 0;

  for (const inlier of inliers) {
    const delta = inlier.point.clone().sub(linePoint);
    const t = direction.dot(delta);
    const lineDistance = delta.addScaledVector(direction, -t).length();
    if (lineDistance <= nearLineBand) {
      nearLineCount += 1;
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
    }

    const side = sideAxis.dot(inlier.point.clone().sub(linePoint));
    if (side > sideDeadBand) {
      positiveSideCount += 1;
    } else if (side < -sideDeadBand) {
      negativeSideCount += 1;
    }
  }

  const sidedCount = positiveSideCount + negativeSideCount;
  const oneSidedness = sidedCount < 6 ? 1 : Math.max(positiveSideCount, negativeSideCount) / sidedCount;
  const spanMeters = nearLineCount > 1 ? maxT - minT : 0;
  return {
    inlierCount: inliers.length,
    nearLineCount,
    oneSidedness,
    spanMeters,
    minT,
    maxT
  };
}

function getEdgeNearLineBand(options: MeasurementPickOptions, threshold: number): number {
  return THREE.MathUtils.clamp(options.radiusMeters * 0.28, threshold * 2.8, Math.max(0.04, threshold * 5.2));
}

function getMinNearLineCount(primaryInlierCount: number, secondaryInlierCount: number, options: MeasurementPickOptions): number {
  const weakerPlaneCount = Math.min(primaryInlierCount, secondaryInlierCount);
  const qualityFloor = options.quality === "final" ? 4 : 3;
  return Math.min(8, Math.max(qualityFloor, Math.ceil(weakerPlaneCount * 0.03)));
}

function getMinEdgeSupportSpan(options: MeasurementPickOptions): number {
  const radiusScale = options.quality === "final" ? 0.24 : 0.18;
  return Math.max(0.025, options.radiusMeters * radiusScale);
}

function isSupportedLineParameter(support: PlaneEdgeSupport, t: number, margin: number): boolean {
  if (!Number.isFinite(support.minT) || !Number.isFinite(support.maxT)) {
    return false;
  }
  return t >= support.minT - margin && t <= support.maxT + margin;
}

function getEdgeConfidence(
  inlierCount: number,
  candidateCount: number,
  support: LocalEdgeSupport,
  normalCross: number
): number {
  const inlierRatio = inlierCount / Math.max(1, candidateCount);
  const nearLineBalance = Math.min(support.primaryNearLineCount, support.secondaryNearLineCount) /
    Math.max(1, Math.max(support.primaryNearLineCount, support.secondaryNearLineCount));
  const boundaryScore = Math.min(support.primaryOneSidedness, support.secondaryOneSidedness);
  const spanScore = THREE.MathUtils.clamp(
    Math.min(support.primarySpanMeters, support.secondarySpanMeters) / Math.max(0.025, Math.max(support.primarySpanMeters, support.secondarySpanMeters)),
    0,
    1
  );
  const angleScore = THREE.MathUtils.clamp((normalCross - EDGE_MIN_NORMAL_CROSS) / (1 - EDGE_MIN_NORMAL_CROSS), 0, 1);
  const confidence = inlierRatio * 0.9 + nearLineBalance * 0.14 + boundaryScore * 0.12 + spanScore * 0.08 + angleScore * 0.08;
  return THREE.MathUtils.clamp(confidence, 0.52, 0.98);
}

function projectPointToPlane(point: THREE.Vector3, normal: THREE.Vector3, constant: number): THREE.Vector3 {
  const distance = normal.dot(point) + constant;
  return point.clone().addScaledVector(normal, -distance);
}

function projectPointToLine(point: THREE.Vector3, linePoint: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 {
  const distance = direction.dot(point.clone().sub(linePoint));
  return linePoint.clone().addScaledVector(direction, distance);
}

function getPlaneIntersectionPoint(first: RansacPlane, second: RansacPlane): THREE.Vector3 | null {
  const direction = first.normal.clone().cross(second.normal);
  const denominator = direction.lengthSq();
  if (denominator < 1e-8) {
    return null;
  }

  return first.normal.clone()
    .multiplyScalar(second.constant)
    .sub(second.normal.clone().multiplyScalar(first.constant))
    .cross(direction)
    .divideScalar(denominator);
}

function toMeasurementPlane(plane: RansacPlane): MeasurementSnapPlane {
  return {
    normal: fromThreeVector(plane.normal),
    constant: plane.constant,
    inlierCount: plane.inlierCount,
    rmsMeters: plane.rmsMeters,
    madMeters: plane.madMeters
  };
}

function toMeasurementLine(point: THREE.Vector3, direction: THREE.Vector3, inlierCount: number): MeasurementSnapLine {
  return {
    point: fromThreeVector(point),
    direction: fromThreeVector(direction),
    inlierCount
  };
}

function computeLocalBox(candidates: LocalCandidate[]): MeasurementLocalBox | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  const box = new THREE.Box3();
  for (const candidate of candidates) {
    box.expandByPoint(candidate.point);
  }
  return {
    min: fromThreeVector(box.min),
    max: fromThreeVector(box.max)
  };
}

function samplePreviewPoints(points: readonly Vector3Like[], limit: number): Vector3Like[] {
  if (points.length <= limit) {
    return points.map((point) => ({ ...point }));
  }

  const result: Vector3Like[] = [];
  const step = points.length / limit;
  for (let index = 0; index < limit; index += 1) {
    result.push({ ...points[Math.floor(index * step)] });
  }
  return result;
}

function getPickSeed(sourceIndex: number | undefined, salt: number): number {
  return (((sourceIndex ?? 97) + 1) * 2654435761 + salt * 1013904223) >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function deterministicReservoirSlot(seen: number, maxCandidates: number): number {
  const hashed = (Math.imul(seen, 1103515245) + 12345) >>> 0;
  const slot = hashed % seen;
  return slot < maxCandidates ? slot : -1;
}

function getRoomPlanAlignmentBox(group: THREE.Group): THREE.Box3 | null {
  const box = group.userData.alignmentBox;
  return box instanceof THREE.Box3 && !box.isEmpty() ? box : null;
}

function computeRobustPointCloudBox(geometry: THREE.BufferGeometry): THREE.Box3 | null {
  const position = geometry.getAttribute("position");
  if (!position || position.count < 20) {
    return null;
  }

  const sampleLimit = 160_000;
  const step = Math.max(1, Math.floor(position.count / sampleLimit));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];

  for (let index = 0; index < position.count; index += step) {
    xs.push(position.getX(index));
    ys.push(position.getY(index));
    zs.push(position.getZ(index));
  }

  if (xs.length < 20) {
    return null;
  }

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);

  const min = new THREE.Vector3(percentile(xs, 0.03), percentile(ys, 0.03), percentile(zs, 0.03));
  const max = new THREE.Vector3(percentile(xs, 0.97), percentile(ys, 0.97), percentile(zs, 0.97));
  return new THREE.Box3(min, max);
}

function percentile(sorted: number[], ratio: number): number {
  const index = THREE.MathUtils.clamp(Math.floor((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index];
}

function buildSampledGeometry(source: THREE.BufferGeometry, step: number, filter: PointDisplayFilter): THREE.BufferGeometry {
  const sourceColor = source.getAttribute("color");
  if (step <= 1 && filter === "none") {
    ensureColorAttribute(source, sourceColor);
    return source;
  }

  const sourcePosition = source.getAttribute("position");
  const sampledIndices = buildDisplaySourceIndices(source, step, filter);
  const count = sampledIndices.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sourceIndices = new Uint32Array(count);

  for (let targetIndex = 0; targetIndex < sampledIndices.length; targetIndex += 1) {
    const sourceIndex = sampledIndices[targetIndex];
    positions[targetIndex * 3] = sourcePosition.getX(sourceIndex);
    positions[targetIndex * 3 + 1] = sourcePosition.getY(sourceIndex);
    positions[targetIndex * 3 + 2] = sourcePosition.getZ(sourceIndex);

    if (sourceColor) {
      colors[targetIndex * 3] = sourceColor.getX(sourceIndex);
      colors[targetIndex * 3 + 1] = sourceColor.getY(sourceIndex);
      colors[targetIndex * 3 + 2] = sourceColor.getZ(sourceIndex);
    } else {
      writeDefaultColor(colors, targetIndex);
    }

    sourceIndices[targetIndex] = sourceIndex;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("sourceIndex", new THREE.BufferAttribute(sourceIndices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildDisplaySourceIndices(source: THREE.BufferGeometry, step: number, filter: PointDisplayFilter): Uint32Array {
  const sourcePosition = source.getAttribute("position");
  const sampledCount = Math.ceil(sourcePosition.count / step);
  const sampledIndices = new Uint32Array(sampledCount);
  let cursor = 0;
  for (let sourceIndex = 0; sourceIndex < sourcePosition.count; sourceIndex += step) {
    sampledIndices[cursor] = sourceIndex;
    cursor += 1;
  }

  if (filter === "none" || sampledIndices.length < 2_000) {
    return sampledIndices;
  }

  const box = source.boundingBox;
  if (!box) {
    return sampledIndices;
  }

  const size = new THREE.Vector3();
  box.getSize(size);
  const diagonal = Math.max(size.length(), 0.001);
  const voxelSize = diagonal / (filter === "strict" ? 110 : 150);
  const inverseVoxelSize = 1 / voxelSize;
  const cellCounts = new Map<string, number>();
  const point = new THREE.Vector3();

  for (let index = 0; index < sampledIndices.length; index += 1) {
    point.fromBufferAttribute(sourcePosition, sampledIndices[index]);
    const key = getVoxelKey(point, box.min, inverseVoxelSize);
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  }

  const minNeighborDensity = filter === "strict" ? 14 : 8;
  const robustBounds = computeRobustBounds(sourcePosition, sampledIndices, filter === "strict" ? 0.015 : 0.003);
  const kept: number[] = [];
  for (let index = 0; index < sampledIndices.length; index += 1) {
    const sourceIndex = sampledIndices[index];
    point.fromBufferAttribute(sourcePosition, sourceIndex);
    if (!isInsideRobustBounds(point, robustBounds)) {
      continue;
    }

    const x = Math.floor((point.x - box.min.x) * inverseVoxelSize);
    const y = Math.floor((point.y - box.min.y) * inverseVoxelSize);
    const z = Math.floor((point.z - box.min.z) * inverseVoxelSize);
    let density = 0;

    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          density += cellCounts.get(`${x + dx},${y + dy},${z + dz}`) ?? 0;
        }
      }
    }

    if (density >= minNeighborDensity) {
      kept.push(sourceIndex);
    }
  }

  if (kept.length < Math.max(1_000, sampledIndices.length * 0.35)) {
    return sampledIndices;
  }

  return Uint32Array.from(kept);
}

type RobustBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

function computeRobustBounds(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, indices: Uint32Array, trimRatio: number): RobustBounds {
  const xs = new Float32Array(indices.length);
  const ys = new Float32Array(indices.length);
  const zs = new Float32Array(indices.length);
  for (let index = 0; index < indices.length; index += 1) {
    const sourceIndex = indices[index];
    xs[index] = position.getX(sourceIndex);
    ys[index] = position.getY(sourceIndex);
    zs[index] = position.getZ(sourceIndex);
  }

  xs.sort();
  ys.sort();
  zs.sort();
  const low = Math.floor((indices.length - 1) * trimRatio);
  const high = Math.ceil((indices.length - 1) * (1 - trimRatio));
  return {
    minX: xs[low],
    maxX: xs[high],
    minY: ys[low],
    maxY: ys[high],
    minZ: zs[low],
    maxZ: zs[high]
  };
}

function isInsideRobustBounds(point: THREE.Vector3, bounds: RobustBounds): boolean {
  return point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY &&
    point.z >= bounds.minZ &&
    point.z <= bounds.maxZ;
}

function getVoxelKey(point: THREE.Vector3, min: THREE.Vector3, inverseVoxelSize: number): string {
  const x = Math.floor((point.x - min.x) * inverseVoxelSize);
  const y = Math.floor((point.y - min.y) * inverseVoxelSize);
  const z = Math.floor((point.z - min.z) * inverseVoxelSize);
  return `${x},${y},${z}`;
}

function createDisplayPointMaterial(pointSize: number, hasColor: boolean, preset: PointRenderPreset): DisplayPointMaterial {
  try {
    return createPointCloudMaterial(pointSize, hasColor, preset);
  } catch (error) {
    console.warn("Unable to create point shader, falling back to PointsMaterial.", error);
    return createFallbackPointMaterial(pointSize, hasColor);
  }
}

function createVoxelPointCloud(displayGeometry: THREE.BufferGeometry, pointSize: number, sceneRadius: number): THREE.InstancedMesh {
  const position = displayGeometry.getAttribute("position");
  const color = displayGeometry.getAttribute("color");
  const count = position.count;
  const voxelSize = Math.max(0.003, sceneRadius / 520) * Math.max(0.25, pointSize * 0.62);
  const cubeGeometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
  const material = createVoxelMaterial();
  const mesh = new THREE.InstancedMesh(cubeGeometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const instanceColor = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    point.fromBufferAttribute(position, index);
    matrix.makeTranslation(point.x, point.y, point.z);
    mesh.setMatrixAt(index, matrix);

    if (color) {
      instanceColor.setRGB(normalizeColorValue(color.getX(index)), normalizeColorValue(color.getY(index)), normalizeColorValue(color.getZ(index)));
    } else {
      instanceColor.set(0xdce6f2);
    }
    mesh.setColorAt(index, instanceColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
  mesh.frustumCulled = false;
  return mesh;
}

function normalizeColorValue(value: number): number {
  return value > 1 ? THREE.MathUtils.clamp(value / 255, 0, 1) : THREE.MathUtils.clamp(value, 0, 1);
}

function createVoxelMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vColor;
      varying float vShade;

      void main() {
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vec3 transformedNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        float diffuse = max(dot(transformedNormal, normalize(vec3(0.35, 0.7, 0.45))), 0.0);
        vShade = 0.74 + diffuse * 0.32;
        vColor = instanceColor;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vShade;

      void main() {
        vec3 color = pow(max(vColor, vec3(0.0)), vec3(0.88)) * vShade;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    depthTest: true,
    depthWrite: true
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    item.dispose();
  }
}

function createFallbackPointMaterial(pointSize: number, hasColor: boolean): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    size: pointSize,
    vertexColors: hasColor,
    color: hasColor ? 0xffffff : 0xdce6f2,
    sizeAttenuation: false,
    transparent: false,
    depthTest: true,
    depthWrite: true
  });
}

function createRoundSpritePointMaterial(pointSize: number, hasColor: boolean): THREE.PointsMaterial {
  const texture = getRoundPointTexture();
  return new THREE.PointsMaterial({
    size: pointSize,
    vertexColors: hasColor,
    color: hasColor ? 0xffffff : 0xdce6f2,
    map: texture,
    alphaMap: texture,
    alphaTest: 0.35,
    sizeAttenuation: false,
    transparent: false,
    depthTest: true,
    depthWrite: true
  });
}

function createPickPointMaterial(pointSize: number): THREE.PointsMaterial {
  const material = new THREE.PointsMaterial({
    size: pointSize,
    sizeAttenuation: false,
    color: 0xffffff,
    depthTest: false,
    depthWrite: false
  });
  material.colorWrite = false;
  return material;
}

function getRoundPointTexture(): THREE.CanvasTexture {
  if (roundPointTexture) {
    return roundPointTexture;
  }

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create round point texture.");
  }

  context.fillStyle = "rgb(0, 0, 0)";
  context.fillRect(0, 0, size, size);
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgb(255, 255, 255)");
  gradient.addColorStop(0.72, "rgb(255, 255, 255)");
  gradient.addColorStop(1, "rgb(0, 0, 0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  context.fill();

  roundPointTexture = new THREE.CanvasTexture(canvas);
  roundPointTexture.colorSpace = THREE.NoColorSpace;
  roundPointTexture.minFilter = THREE.LinearFilter;
  roundPointTexture.magFilter = THREE.LinearFilter;
  roundPointTexture.generateMipmaps = false;
  roundPointTexture.needsUpdate = true;
  return roundPointTexture;
}

function createRoundPointMaterial(pointSize: number, hasColor: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      pointSize: { value: pointSize },
      viewportHeight: { value: 1 },
      fallbackColor: { value: new THREE.Color(0xdce6f2) }
    },
    vertexShader: `
      attribute vec3 color;
      uniform float pointSize;
      uniform float viewportHeight;
      uniform vec3 fallbackColor;
      varying vec3 vColor;

      void main() {
        vColor = ${hasColor ? "color" : "fallbackColor"};
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(pointSize * projectionMatrix[1][1] * viewportHeight / max(0.05, -mvPosition.z), 1.0, 64.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;

      void main() {
        float radius = distance(gl_PointCoord, vec2(0.5));
        if (radius > 0.5) {
          discard;
        }
        gl_FragColor = vec4(vColor, 1.0);
      }
    `,
    depthTest: true,
    depthWrite: true,
    transparent: false,
    vertexColors: false
  });
}

function createSurfaceSplatMaterial(pointSize: number, hasColor: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      pointSize: { value: pointSize },
      viewportHeight: { value: 1 },
      fallbackColor: { value: new THREE.Color(0xdce6f2) },
      opacity: { value: 0.92 }
    },
    vertexShader: `
      attribute vec3 color;
      uniform float pointSize;
      uniform float viewportHeight;
      uniform vec3 fallbackColor;
      varying vec3 vColor;
      varying float vDepthShade;

      void main() {
        vColor = ${hasColor ? "color" : "fallbackColor"};
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float viewDepth = max(0.05, -mvPosition.z);
        float projectedSize = pointSize * 0.08 * projectionMatrix[1][1] * viewportHeight / viewDepth;
        gl_PointSize = clamp(projectedSize, 1.0, 5.0);
        vDepthShade = clamp(1.14 - log2(max(1.0, viewDepth)) * 0.075, 0.58, 1.08);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float opacity;
      varying vec3 vColor;
      varying float vDepthShade;

      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float radiusSquared = dot(coord, coord);
        if (radiusSquared > 0.25) {
          discard;
        }

        float softEdge = smoothstep(0.25, 0.04, radiusSquared);
        if (softEdge < 0.05) {
          discard;
        }

        vec3 color = pow(max(vColor, vec3(0.0)), vec3(0.92)) * vDepthShade;
        gl_FragColor = vec4(color, softEdge * opacity);
      }
    `,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    vertexColors: false
  });
}

function ensureColorAttribute(geometry: THREE.BufferGeometry, sourceColor: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): void {
  if (sourceColor) {
    return;
  }

  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    writeDefaultColor(colors, index);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function ensureSourceIndexAttribute(geometry: THREE.BufferGeometry): void {
  if (geometry.hasAttribute("sourceIndex")) {
    return;
  }

  const position = geometry.getAttribute("position");
  const sourceIndices = new Uint32Array(position.count);
  for (let index = 0; index < sourceIndices.length; index += 1) {
    sourceIndices[index] = index;
  }
  geometry.setAttribute("sourceIndex", new THREE.BufferAttribute(sourceIndices, 1));
}

function getSourceIndex(geometry: THREE.BufferGeometry, displayIndex: number): number {
  const sourceIndex = geometry.getAttribute("sourceIndex");
  if (!sourceIndex) {
    return displayIndex;
  }

  return Math.max(0, Math.floor(sourceIndex.getX(displayIndex)));
}

function writeDefaultColor(colors: Float32Array, index: number): void {
  colors[index * 3] = 0.8627;
  colors[index * 3 + 1] = 0.902;
  colors[index * 3 + 2] = 0.949;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "select" || tagName === "button" || tagName === "textarea" || target.isContentEditable;
}

function isNavigationKey(code: string): boolean {
  return code === "KeyW" ||
    code === "KeyA" ||
    code === "KeyS" ||
    code === "KeyD" ||
    code === "Space" ||
    code === "ControlLeft" ||
    code === "ControlRight";
}
