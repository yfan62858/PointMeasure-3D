import "./styles.css";
import type { ModelSurfaceKind, PlaneModelSurface } from "../shared/ModelTypes";
import type { MeasurementPickOptions, MeasurementPickResult, MeasurementSnapMode } from "../shared/PointCloudDataSource";
import type { PointCloudMetadata, ScanFolderPayload } from "../shared/types";
import { formatBytes, formatDistance, formatVector } from "./utils/format";
import { MeasurementManager } from "./measurement/MeasurementManager";
import { MeasurementRenderer } from "./measurement/MeasurementRenderer";
import type { MeasurementRecord, PlaneMeasurementBasis, PlaneMeasurementRecord } from "./measurement/MeasurementTypes";
import { getModelSurfaceKindLabel, ModelManager } from "./modeling/ModelManager";
import { ModelRenderer } from "./modeling/ModelRenderer";
import { measurementsToCsv } from "./measurement/CsvExporter";
import { PointCloudLoader } from "./viewer/PointCloudLoader";
import type { MovementMode } from "./viewer/CameraController";
import type { PointDisplayFilter } from "./viewer/PointCloudViewer";
import { buildPointCloudInfoRows } from "./viewer/PointCloudDebugInfo";
import type { PointRenderPreset } from "./viewer/PointCloudMaterialFactory";
import { ViewerController } from "./viewer/ViewerController";
import { ViewerMode } from "../shared/ViewerModeTypes";

const elements = {
  canvas: query<HTMLCanvasElement>("#viewport"),
  importPly: query<HTMLButtonElement>("#importPly"),
  importScanFolder: query<HTMLButtonElement>("#importScanFolder"),
  loadSample: query<HTMLButtonElement>("#loadSample"),
  resetView: query<HTMLButtonElement>("#resetView"),
  firstPerson: query<HTMLButtonElement>("#firstPerson"),
  measureDistance: query<HTMLButtonElement>("#measureDistance"),
  measurePlane: query<HTMLButtonElement>("#measurePlane"),
  saveModel: query<HTMLButtonElement>("#saveModel"),
  loadModel: query<HTMLButtonElement>("#loadModel"),
  clearCurrent: query<HTMLButtonElement>("#clearCurrent"),
  clearAll: query<HTMLButtonElement>("#clearAll"),
  exportCsv: query<HTMLButtonElement>("#exportCsv"),
  renderPreset: query<HTMLSelectElement>("#renderPreset"),
  renderPresetValue: query<HTMLOutputElement>("#renderPresetValue"),
  visualFilter: query<HTMLSelectElement>("#visualFilter"),
  visualFilterValue: query<HTMLOutputElement>("#visualFilterValue"),
  gridVisible: query<HTMLInputElement>("#gridVisible"),
  axesVisible: query<HTMLInputElement>("#axesVisible"),
  roomPlanOverlayVisible: query<HTMLInputElement>("#roomPlanOverlayVisible"),
  roomPlanOverlayAutoAlign: query<HTMLInputElement>("#roomPlanOverlayAutoAlign"),
  pointSize: query<HTMLInputElement>("#pointSize"),
  pointSizeValue: query<HTMLOutputElement>("#pointSizeValue"),
  sampling: query<HTMLSelectElement>("#sampling"),
  rayThreshold: query<HTMLInputElement>("#rayThreshold"),
  rayThresholdValue: query<HTMLOutputElement>("#rayThresholdValue"),
  snapMode: query<HTMLSelectElement>("#snapMode"),
  snapModeValue: query<HTMLOutputElement>("#snapModeValue"),
  snapRadius: query<HTMLInputElement>("#snapRadius"),
  snapRadiusValue: query<HTMLOutputElement>("#snapRadiusValue"),
  moveSpeed: query<HTMLInputElement>("#moveSpeed"),
  moveSpeedValue: query<HTMLOutputElement>("#moveSpeedValue"),
  endpointSize: query<HTMLInputElement>("#endpointSize"),
  endpointSizeValue: query<HTMLOutputElement>("#endpointSizeValue"),
  lineThickness: query<HTMLInputElement>("#lineThickness"),
  lineThicknessValue: query<HTMLOutputElement>("#lineThicknessValue"),
  cloudInfo: query<HTMLDivElement>("#cloudInfo"),
  scanMetadata: query<HTMLDivElement>("#scanMetadata"),
  roomPlanStats: query<HTMLDivElement>("#roomPlanStats"),
  records: query<HTMLDivElement>("#measurementRecords"),
  modelSurfaces: query<HTMLDivElement>("#modelSurfaces"),
  modeStatus: query<HTMLSpanElement>("#modeStatus"),
  cameraStatus: query<HTMLSpanElement>("#cameraStatus"),
  hintStatus: query<HTMLSpanElement>("#hintStatus"),
  errorStatus: query<HTMLSpanElement>("#errorStatus")
};

const viewer = new ViewerController(elements.canvas);
const loader = new PointCloudLoader();
const measurementManager = new MeasurementManager();
const measurementRenderer = new MeasurementRenderer(viewer.scene);
const modelManager = new ModelManager();
const modelRenderer = new ModelRenderer(viewer.scene);
let measureMode = false;
let planeMeasureMode = false;
let currentMetadata: PointCloudMetadata | null = null;
let lastPreviewPickAt = 0;

measurementManager.setDataSource(viewer);

if (!import.meta.env.DEV) {
  elements.loadSample.hidden = true;
}

viewer.setFrameCallback((info) => {
  elements.cameraStatus.textContent = `camera: ${formatVector(info.cameraPosition)}`;
  updateMovementModeStatus(info.movementMode);
  if (info.isFirstPerson && !measureMode && !planeMeasureMode) {
    setDefaultNavigationHint();
  }
});

viewer.focusViewport();
updateModeStatus();

elements.importPly.addEventListener("click", async () => {
  try {
    setBusy(true, "Opening PLY dialog...");
    const selection = await window.pointMeasure3D.openPlyDialog();
    if (!selection) {
      setBusy(false, "Import canceled");
      return;
    }
    await loadPly(selection.filePath);
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
});

elements.importScanFolder.addEventListener("click", async () => {
  try {
    setBusy(true, "Opening scan folder dialog...");
    const scanFolder = await window.pointMeasure3D.openScanFolderDialog();
    if (!scanFolder) {
      setBusy(false, "Import canceled");
      return;
    }
    await loadScanFolder(scanFolder);
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
});

elements.loadSample.addEventListener("click", async () => {
  try {
    setBusy(true, "Loading sample PLY...");
    viewer.setRoomPlanOverlay(null);
    renderScanMetadataStatus("No scan folder loaded");
    renderRoomPlanStatsStatus("No RoomPlan loaded");
    const result = await loader.loadSample();
    await applyLoadedPointCloud(result);
    if (result.header.detectedMode === ViewerMode.POINT_CLOUD) {
      setHint("Sample point cloud loaded");
    }
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
});

elements.resetView.addEventListener("click", () => {
  viewer.resetView();
  viewer.focusViewport();
  setHint("View reset");
});

elements.firstPerson.addEventListener("click", () => {
  if (measureMode || planeMeasureMode) {
    setMeasureMode(false);
    setPlaneMeasureMode(false);
  }
  viewer.enterFirstPerson();
  setHint("Mouse lock active. WASD move | Space/Ctrl up/down | Shift fast | M Walk/Fly | Esc exits pointer lock");
});

elements.measureDistance.addEventListener("click", () => {
  setMeasureMode(!measureMode);
});

elements.measurePlane.addEventListener("click", () => {
  setPlaneMeasureMode(!planeMeasureMode);
});

elements.saveModel.addEventListener("click", async () => {
  await saveCurrentModel();
});

elements.loadModel.addEventListener("click", async () => {
  await loadCurrentModel();
});

elements.clearCurrent.addEventListener("click", () => {
  measurementManager.cancelCurrent();
  measurementRenderer.clearPreview();
  measurementRenderer.clearSnapIndicator();
  renderRecords();
  updateModeStatus();
  setHint("Current preview cleared");
});

elements.clearAll.addEventListener("click", () => {
  measurementManager.clearAll();
  measurementRenderer.clearAll();
  measurementRenderer.clearSnapIndicator();
  modelManager.clear();
  modelRenderer.clear();
  renderModelSurfaces();
  renderRecords();
  updateModeStatus();
  setHint("All measurements cleared");
});

elements.exportCsv.addEventListener("click", async () => {
  const records = measurementManager.getRecords();
  const planeRecords = measurementManager.getPlaneRecords();
  if (records.length === 0 && planeRecords.length === 0) {
    setHint("No measurements to export");
    return;
  }

  try {
    const result = await window.pointMeasure3D.saveCsv(measurementsToCsv(records, planeRecords));
    setHint(result.canceled ? "CSV export canceled" : `Exported CSV: ${result.filePath ?? "measurements.csv"}`);
  } catch (error) {
    handleError(error);
  }
});

elements.pointSize.addEventListener("input", () => {
  const value = Number(elements.pointSize.value);
  viewer.setPointSize(value);
  elements.pointSizeValue.value = value.toFixed(1);
});

elements.renderPreset.addEventListener("change", () => {
  const value = elements.renderPreset.value as PointRenderPreset;
  const metadata = viewer.setRenderPreset(value);
  elements.renderPresetValue.value = getRenderPresetLabel(value);
  if (metadata) {
    currentMetadata = metadata;
    renderCloudInfo(metadata);
  }
  setHint(`${getRenderPresetLabel(value)} rendering enabled`);
});

elements.visualFilter.addEventListener("change", () => {
  const value = elements.visualFilter.value as PointDisplayFilter;
  const metadata = viewer.setDisplayFilter(value);
  elements.visualFilterValue.value = value;
  if (metadata) {
    currentMetadata = metadata;
    renderCloudInfo(metadata);
  }
  const label = value === "none" ? "No visual cleanup" : value === "clean" ? "Clean visual filter" : "Strict visual filter";
  setHint(`${label} enabled. Measurement still snaps to raw points.`);
});

elements.gridVisible.addEventListener("change", () => {
  viewer.setGridVisible(elements.gridVisible.checked);
});

elements.axesVisible.addEventListener("change", () => {
  viewer.setAxesVisible(elements.axesVisible.checked);
});

elements.roomPlanOverlayVisible.addEventListener("change", () => {
  viewer.setRoomPlanOverlayVisible(elements.roomPlanOverlayVisible.checked);
  setHint(elements.roomPlanOverlayVisible.checked ? "RoomPlan overlay on" : "RoomPlan overlay off");
});

elements.roomPlanOverlayAutoAlign.addEventListener("change", () => {
  viewer.setRoomPlanOverlayAutoAlign(elements.roomPlanOverlayAutoAlign.checked);
  setHint(elements.roomPlanOverlayAutoAlign.checked ? "RoomPlan auto align on" : "RoomPlan raw coordinates");
});

elements.sampling.addEventListener("change", () => {
  const metadata = viewer.setDisplaySampling(Number(elements.sampling.value));
  if (metadata) {
    currentMetadata = metadata;
    renderCloudInfo(metadata);
    setHint(`Display sampling changed to every ${elements.sampling.value} point(s)`);
  }
});

elements.rayThreshold.addEventListener("input", () => {
  const value = Number(elements.rayThreshold.value);
  viewer.setRaycastThreshold(value);
  elements.rayThresholdValue.value = value.toFixed(3);
});

elements.snapMode.addEventListener("change", () => {
  const value = elements.snapMode.value as MeasurementSnapMode;
  elements.snapModeValue.value = value;
  setHint(getSnapModeHint(value));
});

elements.snapRadius.addEventListener("input", () => {
  const value = Number(elements.snapRadius.value);
  elements.snapRadiusValue.value = `${value.toFixed(2)} m`;
  setHint(`Snap radius: ${value.toFixed(2)} m`);
});

elements.moveSpeed.addEventListener("input", () => {
  const value = Number(elements.moveSpeed.value);
  viewer.setMoveSpeed(value);
  elements.moveSpeedValue.value = value.toFixed(1);
});

elements.endpointSize.addEventListener("input", () => {
  const value = Number(elements.endpointSize.value);
  measurementRenderer.setStyle({ endpointRadius: value });
  elements.endpointSizeValue.value = value.toFixed(3);
  refreshMeasurementStyle();
});

elements.lineThickness.addEventListener("input", () => {
  const value = Number(elements.lineThickness.value);
  measurementRenderer.setStyle({ lineRadius: value });
  elements.lineThicknessValue.value = value.toFixed(3);
  refreshMeasurementStyle();
});

elements.canvas.addEventListener("mousedown", (event) => {
  if (!planeMeasureMode || event.button !== 0) {
    return;
  }

  event.preventDefault();
  const pick = measurementManager.pickPoint(event.clientX, event.clientY, getPlanePickOptions("final"));
  const basis = pick ? createPlaneBasis(pick) : null;
  if (!pick || !basis) {
    setHint("No stable plane found. Try increasing Snap radius or click on a flatter area of the door.");
    return;
  }

  lastPreviewPickAt = performance.now();
  const preview = measurementManager.beginPlaneDrag(pick, pick.point, basis);
  measurementRenderer.updatePlanePreview(preview);
  measurementRenderer.showSnapIndicator(pick);
  updateModeStatus();
  setHint(`Plane locked ${formatSnap(pick)}. Drag a rectangle on this face to measure width and height.`);
});

elements.canvas.addEventListener("mousemove", (event) => {
  if (!planeMeasureMode || !measurementManager.isPlaneDragging()) {
    return;
  }

  const now = performance.now();
  if (now - lastPreviewPickAt < 30) {
    return;
  }
  lastPreviewPickAt = now;

  const draft = measurementManager.getPlanePreview();
  if (!draft) {
    return;
  }

  const point = measurementManager.projectScreenToPlane(event.clientX, event.clientY, draft.basis.plane);
  if (!point) {
    setHint("Pointer ray is parallel to the locked plane");
    return;
  }

  const preview = measurementManager.updatePlaneDrag(point);
  if (preview) {
    measurementRenderer.updatePlanePreview(preview);
    setHint(`Plane preview: ${formatPlaneMeasurement(preview)}`);
  }
});

elements.canvas.addEventListener("mouseup", (event) => {
  if (!planeMeasureMode || event.button !== 0 || !measurementManager.isPlaneDragging()) {
    return;
  }

  event.preventDefault();
  const draft = measurementManager.getPlanePreview();
  const point = draft ? measurementManager.projectScreenToPlane(event.clientX, event.clientY, draft.basis.plane) : null;
  if (!point) {
    measurementManager.cancelCurrent();
    measurementRenderer.clearPreview();
    measurementRenderer.clearSnapIndicator();
    updateModeStatus();
    setHint("No plane end point selected; plane measurement canceled");
    return;
  }

  const record = measurementManager.finishPlaneDrag(point);
  measurementRenderer.clearPreview();
  if (record) {
    measurementRenderer.addPlaneRecord(record);
    const surface = modelManager.addSurfaceFromPlane(record);
    modelRenderer.addOrUpdate(surface);
    renderRecords();
    renderModelSurfaces();
    updateModeStatus();
    setHint(`Plane model created: ${surface.name} | ${formatPlaneMeasurement(record)}`);
  } else {
    setHint("Plane rectangle is too small; measurement canceled");
  }
});

elements.canvas.addEventListener("mousedown", (event) => {
  if (!measureMode || event.button !== 0) {
    return;
  }

  event.preventDefault();
  const pick = measurementManager.pickPoint(event.clientX, event.clientY, getPickOptions("final"));
  if (!pick) {
    setHint("No start point selected");
    return;
  }

  lastPreviewPickAt = performance.now();
  const preview = measurementManager.beginDrag(pick);
  measurementRenderer.updatePreview(preview);
  measurementRenderer.showSnapIndicator(pick);
  updateModeStatus();
  setHint(`Start ${formatSnap(pick)}. Drag to preview, release to finish`);
});

elements.canvas.addEventListener("mousemove", (event) => {
  if (!measureMode || !measurementManager.isDragging()) {
    return;
  }

  const now = performance.now();
  if (now - lastPreviewPickAt < 45) {
    return;
  }
  lastPreviewPickAt = now;

  const pick = measurementManager.pickPoint(event.clientX, event.clientY, getPickOptions("preview"));
  if (!pick) {
    setHint("No point selected");
    return;
  }

  const preview = measurementManager.updateDrag(pick);
  if (preview) {
    measurementRenderer.updatePreview(preview);
    measurementRenderer.showSnapIndicator(pick);
    setHint(`Preview: ${formatDistance(preview.distanceMeters)} | ${formatSnap(pick)}`);
  }
});

elements.canvas.addEventListener("mouseup", (event) => {
  if (!measureMode || event.button !== 0 || !measurementManager.isDragging()) {
    return;
  }

  event.preventDefault();
  const pick = measurementManager.pickPoint(event.clientX, event.clientY, getPickOptions("final"));
  if (!pick) {
    measurementManager.cancelCurrent();
    measurementRenderer.clearPreview();
    measurementRenderer.clearSnapIndicator();
    updateModeStatus();
    setHint("No end point selected; measurement canceled");
    return;
  }

  const record = measurementManager.finishDrag(pick);
  measurementRenderer.clearPreview();
  measurementRenderer.showSnapIndicator(pick);
  if (record) {
    measurementRenderer.addRecord(record);
    renderRecords();
    updateModeStatus();
    setHint(`Measurement added: ${formatDistance(record.distanceMeters)} | ${formatSnap(pick)}`);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && (measurementManager.isDragging() || measurementManager.isPlaneDragging())) {
    measurementManager.cancelCurrent();
    measurementRenderer.clearPreview();
    measurementRenderer.clearSnapIndicator();
    updateModeStatus();
    setHint("Current measurement canceled");
  }
});

async function loadPly(filePath: string): Promise<void> {
  viewer.setRoomPlanOverlay(null);
  renderScanMetadataStatus("No scan folder loaded");
  renderRoomPlanStatsStatus("No RoomPlan loaded");
  setHint("Loading PLY...");
  const result = await loader.loadPlyDirect(filePath);
  await applyLoadedPointCloud(result);
  if (result.header.detectedMode === ViewerMode.POINT_CLOUD) {
    setHint(`Loaded ${result.metadata.fileName}`);
  }
}

async function loadScanFolder(scanFolder: ScanFolderPayload): Promise<void> {
  viewer.setRoomPlanOverlay(null);
  renderScanMetadataStatus("Loading metadata...");
  renderRoomPlanStatsStatus("Loading RoomPlan...");

  if (!scanFolder.pointcloudPath) {
    renderScanMetadataStatus("metadata.json not loaded");
    renderRoomPlanStatsStatus("RoomPlan not loaded");
    throw new Error(`pointcloud.ply is missing in ${scanFolder.scanFolderPath}`);
  }

  setHint("Loading scan pointcloud.ply...");
  const result = await loader.loadPlyDirect(scanFolder.pointcloudPath);
  await applyLoadedPointCloud(result);

  const issues = renderScanBundleInfo(scanFolder);
  const roomPlan = parseRoomPlanForOverlay(scanFolder.roomplanJson);
  viewer.setRoomPlanOverlayAutoAlign(elements.roomPlanOverlayAutoAlign.checked);
  viewer.setRoomPlanOverlay(roomPlan);
  viewer.setRoomPlanOverlayVisible(elements.roomPlanOverlayVisible.checked);
  if (issues.length > 0) {
    elements.hintStatus.textContent = `Loaded scan folder ${basename(scanFolder.scanFolderPath)} with warnings`;
    setError(issues.join(" | "));
  } else {
    setHint(`Loaded scan folder ${basename(scanFolder.scanFolderPath)}`);
  }
}

async function applyLoadedPointCloud(result: Awaited<ReturnType<PointCloudLoader["loadPlyDirect"]>>): Promise<void> {
  measurementManager.clearAll();
  measurementRenderer.clearAll();
  measurementRenderer.clearSnapIndicator();
  modelManager.resetForPointCloud(result.metadata);
  modelRenderer.clear();
  if (result.header.detectedMode === ViewerMode.GAUSSIAN_SPLAT) {
    currentMetadata = await viewer.loadGaussianSplatPreview(result.geometry, result.metadata);
    setHint("Detected Gaussian Splat PLY. Gaussian Splat Mode is planned / experimental; showing Point Cloud Preview with x y z + RGB only.");
  } else {
    currentMetadata = viewer.loadPointCloud(result.geometry, result.metadata);
    if (result.header.detectedMode === ViewerMode.UNKNOWN) {
      setHint("Detected Mode: Unknown. Header fields are insufficient for a confident Point Cloud or Gaussian Splat classification.");
    }
  }
  viewer.focusViewport();
  if (currentMetadata) {
    renderCloudInfo(currentMetadata);
  }
  await loadCurrentModel(true);
  renderRecords();
  renderModelSurfaces();
  updateModeStatus();
}

function setMeasureMode(enabled: boolean): void {
  if (enabled && planeMeasureMode) {
    setPlaneMeasureMode(false);
  }
  measureMode = enabled;
  elements.measureDistance.classList.toggle("active", enabled);
  if (enabled) {
    viewer.exitFirstPerson();
    setHint(`Measure mode: ${getSnapModeHint(elements.snapMode.value as MeasurementSnapMode)}`);
  } else {
    measurementManager.cancelCurrent();
    measurementRenderer.clearPreview();
    measurementRenderer.clearSnapIndicator();
    setHint("Measure mode off");
  }
  updateModeStatus();
}

function setPlaneMeasureMode(enabled: boolean): void {
  if (enabled && measureMode) {
    setMeasureMode(false);
  }
  planeMeasureMode = enabled;
  elements.measurePlane.classList.toggle("active", enabled);
  if (enabled) {
    viewer.exitFirstPerson();
    setHint("Plane mode: click the door/wall face to lock a RANSAC plane, then drag a rectangle for width x height");
  } else {
    measurementManager.cancelCurrent();
    measurementRenderer.clearPreview();
    measurementRenderer.clearSnapIndicator();
    setHint("Plane measure mode off");
  }
  updateModeStatus();
}

function renderCloudInfo(metadata: PointCloudMetadata): void {
  elements.cloudInfo.innerHTML = "";
  const rows: Array<[string, string]> = [
    ...buildPointCloudInfoRows(metadata),
    ["unit", metadata.unit],
    ["loaded points", `${metadata.loadedPoints.toLocaleString()} / ${metadata.totalPoints.toLocaleString()}`],
    ["memory estimate", formatBytes(metadata.estimatedMemoryBytes)]
  ];

  for (const [label, value] of rows) {
    const key = document.createElement("span");
    key.className = "info-key";
    key.textContent = label;
    const item = document.createElement("span");
    item.className = "info-value";
    item.textContent = value;
    elements.cloudInfo.append(key, item);
  }
}

function renderScanBundleInfo(scanFolder: ScanFolderPayload): string[] {
  const issues: string[] = [];
  renderScanMetadata(scanFolder, issues);
  renderRoomPlanStats(scanFolder, issues);
  return issues;
}

function renderScanMetadata(scanFolder: ScanFolderPayload, issues: string[]): void {
  if (!scanFolder.metadataJson) {
    renderScanMetadataRows([
      ["scan folder", scanFolder.scanFolderPath],
      ["metadata", "metadata.json missing"],
      ["roomplan.usdz", scanFolder.roomplanUsdzPath ? "present" : "missing"]
    ]);
    issues.push("metadata.json is missing");
    return;
  }

  const parsed = parseJsonObject(scanFolder.metadataJson, "metadata.json", issues);
  if (!parsed) {
    renderScanMetadataRows([
      ["scan folder", scanFolder.scanFolderPath],
      ["metadata", "metadata.json parse failed"],
      ["roomplan.usdz", scanFolder.roomplanUsdzPath ? "present" : "missing"]
    ]);
    return;
  }

  const rows: Array<[string, string]> = [
    ["scan folder", scanFolder.scanFolderPath],
    ["point_count", formatJsonValue(parsed.point_count)],
    ["created_at", formatJsonValue(parsed.created_at)],
    ["app_version", formatJsonValue(parsed.app_version)],
    ["coordinate system", formatJsonValue(parsed.coordinate_system)],
    ["export mode", formatJsonValue(parsed.export_mode)],
    ["has pointcloud", formatJsonValue(parsed.has_pointcloud)],
    ["has roomplan json", formatJsonValue(parsed.has_roomplan_json)],
    ["has roomplan usdz", formatJsonValue(parsed.has_roomplan_usdz)],
    ["roomplan.usdz", scanFolder.roomplanUsdzPath ? "present" : "missing"]
  ];

  renderScanMetadataRows(rows);
}

function renderRoomPlanStats(scanFolder: ScanFolderPayload, issues: string[]): void {
  if (!scanFolder.roomplanJson) {
    renderInfoRows(elements.roomPlanStats, [["roomplan", "roomplan.json missing"]]);
    issues.push("roomplan.json is missing");
    return;
  }

  const parsed = parseJsonObject(scanFolder.roomplanJson, "roomplan.json", issues);
  if (!parsed) {
    renderInfoRows(elements.roomPlanStats, [["roomplan", "roomplan.json parse failed"]]);
    return;
  }

  const rows: Array<[string, string]> = [
    ["walls", countJsonArray(parsed.walls)],
    ["windows", countJsonArray(parsed.windows)],
    ["doors", countJsonArray(parsed.doors)],
    ["floors", countJsonArray(parsed.floors)],
    ["objects", countJsonArray(parsed.objects)]
  ];

  if ("openings" in parsed) {
    rows.push(["openings", countJsonArray(parsed.openings)]);
  }

  renderInfoRows(elements.roomPlanStats, rows);
}

function parseRoomPlanForOverlay(text: string | undefined): Record<string, unknown> | null {
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function renderScanMetadataRows(rows: Array<[string, string]>): void {
  renderInfoRows(elements.scanMetadata, rows);
}

function renderScanMetadataStatus(message: string): void {
  renderInfoRows(elements.scanMetadata, [["status", message]]);
}

function renderRoomPlanStatsStatus(message: string): void {
  renderInfoRows(elements.roomPlanStats, [["status", message]]);
}

function renderInfoRows(container: HTMLElement, rows: Array<[string, string]>): void {
  container.innerHTML = "";
  for (const [label, value] of rows) {
    const key = document.createElement("span");
    key.className = "info-key";
    key.textContent = label;
    const item = document.createElement("span");
    item.className = "info-value";
    item.textContent = value;
    container.append(key, item);
  }
}

function renderRecords(): void {
  const records = measurementManager.getRecords();
  const planeRecords = measurementManager.getPlaneRecords();
  elements.records.innerHTML = "";

  if (records.length === 0 && planeRecords.length === 0) {
    elements.records.classList.add("empty");
    elements.records.textContent = "No measurements";
    return;
  }

  elements.records.classList.remove("empty");
  for (const record of records) {
    elements.records.append(createRecordElement(record));
  }
  for (const record of planeRecords) {
    elements.records.append(createPlaneRecordElement(record));
  }
}

function renderModelSurfaces(): void {
  const surfaces = modelManager.getSurfaces();
  elements.modelSurfaces.innerHTML = "";

  if (surfaces.length === 0) {
    elements.modelSurfaces.classList.add("empty");
    elements.modelSurfaces.textContent = "No model surfaces";
    return;
  }

  elements.modelSurfaces.classList.remove("empty");
  for (const surface of surfaces) {
    elements.modelSurfaces.append(createModelSurfaceElement(surface));
  }
}

function createModelSurfaceElement(surface: PlaneModelSurface): HTMLElement {
  const item = document.createElement("article");
  item.className = "model-surface";

  const nameInput = document.createElement("input");
  nameInput.className = "model-name";
  nameInput.value = surface.name;
  nameInput.setAttribute("aria-label", "Model surface name");
  nameInput.addEventListener("change", () => {
    const updated = modelManager.updateSurface(surface.id, { name: nameInput.value });
    if (updated) {
      modelRenderer.addOrUpdate(updated);
      renderModelSurfaces();
      setHint(`Updated ${updated.name}`);
    }
  });

  const kindSelect = document.createElement("select");
  kindSelect.className = "model-kind";
  for (const kind of getModelSurfaceKinds()) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = getModelSurfaceKindLabel(kind);
    option.selected = surface.kind === kind;
    kindSelect.append(option);
  }
  kindSelect.addEventListener("change", () => {
    const updated = modelManager.updateSurface(surface.id, { kind: kindSelect.value as ModelSurfaceKind });
    if (updated) {
      renderModelSurfaces();
      setHint(`${updated.name} type: ${getModelSurfaceKindLabel(updated.kind)}`);
    }
  });

  const visibleLabel = document.createElement("label");
  visibleLabel.className = "model-visible";
  const visibleCheckbox = document.createElement("input");
  visibleCheckbox.type = "checkbox";
  visibleCheckbox.checked = surface.visible;
  visibleCheckbox.addEventListener("change", () => {
    const updated = modelManager.updateSurface(surface.id, { visible: visibleCheckbox.checked });
    if (updated) {
      modelRenderer.addOrUpdate(updated);
      setHint(`${updated.name} ${updated.visible ? "shown" : "hidden"}`);
    }
  });
  visibleLabel.append(visibleCheckbox, "show");

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-record";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => {
    modelManager.deleteSurface(surface.id);
    modelRenderer.remove(surface.id);
    renderModelSurfaces();
    setHint(`${surface.name} deleted`);
  });

  const metrics = document.createElement("div");
  metrics.className = "model-metrics";
  metrics.textContent = `${surface.widthMeters.toFixed(3)} m x ${surface.heightMeters.toFixed(3)} m | ${surface.areaSquareMeters.toFixed(3)} m2`;

  const qa = document.createElement("div");
  qa.className = getModelQaClass(surface);
  qa.textContent = `QA ${getModelQaLabel(surface)} | confidence ${Math.round(surface.confidence * 100)}% | inliers ${surface.inlierCount}/${surface.candidateCount}`;

  item.append(nameInput, kindSelect, visibleLabel, metrics, qa, deleteButton);
  return item;
}

function refreshMeasurementStyle(): void {
  const preview = measurementManager.getPreview();
  if (preview) {
    measurementRenderer.updatePreview(preview);
  }
  const planePreview = measurementManager.getPlanePreview();
  if (planePreview) {
    measurementRenderer.updatePlanePreview(planePreview);
  }
  measurementRenderer.rebuildRecords(measurementManager.getRecords());
  measurementRenderer.rebuildPlaneRecords(measurementManager.getPlaneRecords());
}

function createRecordElement(record: MeasurementRecord): HTMLElement {
  const item = document.createElement("article");
  item.className = "record";

  const title = document.createElement("div");
  title.className = "record-title";
  title.textContent = formatDistance(record.distanceMeters);

  const details = document.createElement("div");
  details.className = "record-details";
  details.textContent = `P1 ${formatVector(record.start)} (${formatSnapShort(record.startSnap)}) | P2 ${formatVector(record.end)} (${formatSnapShort(record.endSnap)})`;

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-record";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => {
    measurementManager.deleteRecord(record.id);
    measurementRenderer.removeRecord(record.id);
    renderRecords();
    updateModeStatus();
    setHint("Measurement deleted");
  });

  item.append(title, details, deleteButton);
  return item;
}

function createPlaneRecordElement(record: PlaneMeasurementRecord): HTMLElement {
  const item = document.createElement("article");
  item.className = "record plane-record";

  const title = document.createElement("div");
  title.className = "record-title";
  title.textContent = `Plane ${record.widthMeters.toFixed(3)} m x ${record.heightMeters.toFixed(3)} m`;

  const details = document.createElement("div");
  details.className = "record-details";
  details.textContent = `Area ${record.areaSquareMeters.toFixed(3)} m2 | origin ${formatVector(record.start)} | snap ${formatSnapShort(record.startSnap)}`;

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-record";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => {
    measurementManager.deletePlaneRecord(record.id);
    measurementRenderer.removeRecord(record.id);
    renderRecords();
    updateModeStatus();
    setHint("Plane measurement deleted");
  });

  item.append(title, details, deleteButton);
  return item;
}

function setBusy(isBusy: boolean, message?: string): void {
  for (const button of [
    elements.importPly,
    elements.importScanFolder,
    elements.loadSample,
    elements.resetView,
    elements.firstPerson,
    elements.measureDistance,
    elements.measurePlane,
    elements.saveModel,
    elements.loadModel,
    elements.clearCurrent,
    elements.clearAll,
    elements.exportCsv
  ]) {
    button.disabled = isBusy;
  }

  if (message) {
    setHint(message);
  }
}

async function saveCurrentModel(): Promise<void> {
  if (!currentMetadata?.filePath) {
    setHint("Load a PLY or scan folder before saving a model");
    return;
  }

  try {
    const result = await window.pointMeasure3D.saveModel(currentMetadata.filePath, modelManager.toDocument());
    setHint(result.canceled ? "Model save canceled" : `Model saved: ${result.filePath ?? "pointmeasure-model.json"}`);
  } catch (error) {
    handleError(error);
  }
}

async function loadCurrentModel(silent = false): Promise<void> {
  if (!currentMetadata?.filePath) {
    if (!silent) {
      setHint("Load a PLY or scan folder before loading a model");
    }
    return;
  }

  try {
    const document = await window.pointMeasure3D.loadModel(currentMetadata.filePath);
    if (!document) {
      if (!silent) {
        setHint("No PointMeasure 3D model found beside this point cloud");
      }
      return;
    }

    modelManager.loadDocument(document);
    modelRenderer.rebuild(modelManager.getSurfaces());
    renderModelSurfaces();
    if (!silent) {
      setHint(`Loaded ${document.surfaces.length} model surface(s)`);
    }
  } catch (error) {
    if (!silent) {
      handleError(error);
    }
  }
}

function updateModeStatus(): void {
  updateMovementModeStatus();
  if (!measureMode && !planeMeasureMode && !measurementManager.isDragging() && !measurementManager.isPlaneDragging()) {
    setDefaultNavigationHint();
  }
}

function updateMovementModeStatus(mode: MovementMode = viewer.getMovementMode()): void {
  elements.modeStatus.textContent = `Movement Mode: ${formatMovementMode(mode)}`;
}

function setHint(message: string): void {
  elements.hintStatus.textContent = message;
  elements.errorStatus.textContent = "";
}

function getRenderPresetLabel(value: PointRenderPreset): string {
  return value === "default" ? "Default Point Cloud" : "Stable Points";
}

function getPickOptions(quality: MeasurementPickOptions["quality"]): MeasurementPickOptions {
  return {
    mode: elements.snapMode.value as MeasurementSnapMode,
    quality,
    radiusMeters: Number(elements.snapRadius.value)
  };
}

function getPlanePickOptions(quality: MeasurementPickOptions["quality"]): MeasurementPickOptions {
  return {
    mode: "plane",
    quality,
    radiusMeters: Number(elements.snapRadius.value)
  };
}

function createPlaneBasis(pick: MeasurementPickResult): PlaneMeasurementBasis | null {
  if (!pick.plane || pick.kind === "nearest") {
    return null;
  }

  const normal = normalize(pick.plane.normal);
  const worldUp = { x: 0, y: 1, z: 0 };
  let vertical = subtract(worldUp, scale(normal, dot(worldUp, normal)));
  if (lengthSq(vertical) < 0.01) {
    const worldX = { x: 1, y: 0, z: 0 };
    vertical = subtract(worldX, scale(normal, dot(worldX, normal)));
  }
  vertical = normalize(vertical);
  const horizontal = normalize(cross(vertical, normal));

  return {
    normal,
    horizontal,
    vertical,
    plane: {
      ...pick.plane,
      normal
    }
  };
}

function formatPlaneMeasurement(record: { widthMeters: number; heightMeters: number; areaSquareMeters: number }): string {
  return `W ${record.widthMeters.toFixed(3)} m | H ${record.heightMeters.toFixed(3)} m | A ${record.areaSquareMeters.toFixed(3)} m2`;
}

function getModelSurfaceKinds(): ModelSurfaceKind[] {
  return ["door", "wall", "column_face", "beam_face", "cabinet_face", "custom"];
}

function getModelQaLabel(surface: PlaneModelSurface): string {
  if (surface.confidence >= 0.72 && surface.inlierCount >= 120) {
    return "good";
  }
  if (surface.confidence >= 0.52 && surface.inlierCount >= 45) {
    return "check";
  }
  return "weak";
}

function getModelQaClass(surface: PlaneModelSurface): string {
  return `model-qa ${getModelQaLabel(surface)}`;
}

function formatSnap(pick: MeasurementPickResult): string {
  const confidence = Math.round(pick.confidence * 100);
  if (pick.kind === "edge") {
    return `edge snap ${confidence}% (${pick.inlierCount}/${pick.candidateCount})`;
  }
  if (pick.kind === "plane") {
    return `plane snap ${confidence}% (${pick.inlierCount}/${pick.candidateCount})`;
  }
  return `point snap ${confidence}%`;
}

function add(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: { x: number; y: number; z: number }, scalar: number): { x: number; y: number; z: number } {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function lengthSq(v: { x: number; y: number; z: number }): number {
  return dot(v, v);
}

function normalize(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const length = Math.sqrt(lengthSq(v));
  if (length < 0.000001) {
    return { x: 1, y: 0, z: 0 };
  }
  return scale(v, 1 / length);
}

function formatSnapShort(pick: MeasurementPickResult | undefined): string {
  if (!pick) {
    return "legacy";
  }

  if (pick.kind === "edge") {
    return "edge";
  }
  if (pick.kind === "plane") {
    return "plane";
  }
  return "point";
}

function getSnapModeHint(mode: MeasurementSnapMode): string {
  if (mode === "smart") {
    return "Smart snap: edge line first, local RANSAC plane second, nearest point fallback";
  }
  if (mode === "edge") {
    return "Edge snap: fits two local planes and snaps to their intersection line";
  }
  if (mode === "plane") {
    return "Plane snap: fits a local RANSAC plane and projects the point onto it";
  }
  return "Nearest point: uses point picking without plane or edge fitting";
}

function setError(message: string): void {
  elements.errorStatus.textContent = message;
}

function setDefaultNavigationHint(): void {
  elements.hintStatus.textContent = "WASD move | Space/Ctrl up/down | Shift fast | Wheel zoom | Right drag rotate | M Walk/Fly";
  elements.errorStatus.textContent = "";
}

function formatMovementMode(mode: MovementMode): string {
  return mode === "walk" ? "Walk" : "Fly";
}

function handleError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  elements.errorStatus.textContent = message;
  elements.hintStatus.textContent = "Error";
  console.error(error);
}

function parseJsonObject(text: string, fileName: string, issues: string[]): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    issues.push(`${fileName} does not contain a JSON object`);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(`${fileName} parse failed: ${message}`);
    return null;
  }
}

function formatJsonValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toString();
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return "-";
}

function countJsonArray(value: unknown): string {
  return Array.isArray(value) ? value.length.toLocaleString() : "0";
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element ${selector}`);
  }
  return element;
}
