import "./styles.css";
import type { ModelSurfaceKind, PlaneModelSurface } from "../shared/ModelTypes";
import type { MeasurementPickOptions, MeasurementPickResult, MeasurementSnapMode } from "../shared/PointCloudDataSource";
import type { PointCloudMetadata, ScanFolderPayload } from "../shared/types";
import { formatBytes, formatDistance, formatVector } from "./utils/format";
import { MeasurementManager } from "./measurement/MeasurementManager";
import { MeasurementRenderer } from "./measurement/MeasurementRenderer";
import type { MeasurementDistanceMode, MeasurementRecord, PlaneMeasurementBasis, PlaneMeasurementRecord } from "./measurement/MeasurementTypes";
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
  distanceMode: query<HTMLSelectElement>("#distanceMode"),
  distanceModeValue: query<HTMLOutputElement>("#distanceModeValue"),
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
  elements.cameraStatus.textContent = `相機：${formatVector(info.cameraPosition)}`;
  updateMovementModeStatus(info.movementMode);
  if (info.isFirstPerson && !measureMode && !planeMeasureMode) {
    setDefaultNavigationHint();
  }
});

viewer.focusViewport();
updateModeStatus();

elements.importPly.addEventListener("click", async () => {
  try {
    setBusy(true, "正在開啟 PLY 選擇視窗...");
    const selection = await window.pointMeasure3D.openPlyDialog();
    if (!selection) {
      setBusy(false, "已取消匯入");
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
    setBusy(true, "正在開啟掃描資料夾選擇視窗...");
    const scanFolder = await window.pointMeasure3D.openScanFolderDialog();
    if (!scanFolder) {
      setBusy(false, "已取消匯入");
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
    setBusy(true, "正在載入範例 PLY...");
    viewer.setRoomPlanOverlay(null);
    renderScanMetadataStatus("尚未載入掃描資料夾");
    renderRoomPlanStatsStatus("尚未載入 RoomPlan");
    const result = await loader.loadSample();
    await applyLoadedPointCloud(result);
    if (result.header.detectedMode === ViewerMode.POINT_CLOUD) {
      setHint("範例點雲已載入");
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
  setHint("視角已重設");
});

elements.firstPerson.addEventListener("click", () => {
  if (measureMode || planeMeasureMode) {
    setMeasureMode(false);
    setPlaneMeasureMode(false);
  }
  viewer.enterFirstPerson();
  setHint("已進入第一人稱。WASD 移動 | Space/Ctrl 上下 | Shift 加速 | M 步行/飛行 | Esc 解除滑鼠鎖定");
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
  setHint("已清除目前預覽");
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
  setHint("已清除全部量測與模型");
});

elements.exportCsv.addEventListener("click", async () => {
  const records = measurementManager.getRecords();
  const planeRecords = measurementManager.getPlaneRecords();
  if (records.length === 0 && planeRecords.length === 0) {
    setHint("沒有可匯出的量測紀錄");
    return;
  }

  try {
    const result = await window.pointMeasure3D.saveCsv(measurementsToCsv(records, planeRecords));
    setHint(result.canceled ? "已取消匯出 CSV" : `已匯出 CSV：${result.filePath ?? "measurements.csv"}`);
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
  setHint(`已切換顯示模式：${getRenderPresetLabel(value)}`);
});

elements.visualFilter.addEventListener("change", () => {
  const value = elements.visualFilter.value as PointDisplayFilter;
  const metadata = viewer.setDisplayFilter(value);
  if (metadata) {
    currentMetadata = metadata;
    renderCloudInfo(metadata);
  }
  elements.visualFilterValue.value = getVisualFilterLabel(value);
  setHint(`已套用視覺過濾：${getVisualFilterLabel(value)}。量測仍會使用原始點與 mesh。`);
});

elements.gridVisible.addEventListener("change", () => {
  viewer.setGridVisible(elements.gridVisible.checked);
});

elements.axesVisible.addEventListener("change", () => {
  viewer.setAxesVisible(elements.axesVisible.checked);
});

elements.roomPlanOverlayVisible.addEventListener("change", () => {
  viewer.setRoomPlanOverlayVisible(elements.roomPlanOverlayVisible.checked);
  setHint(elements.roomPlanOverlayVisible.checked ? "RoomPlan 疊圖已開啟" : "RoomPlan 疊圖已關閉");
});

elements.roomPlanOverlayAutoAlign.addEventListener("change", () => {
  viewer.setRoomPlanOverlayAutoAlign(elements.roomPlanOverlayAutoAlign.checked);
  setHint(elements.roomPlanOverlayAutoAlign.checked ? "RoomPlan 已自動對齊" : "RoomPlan 使用原始座標");
});

elements.sampling.addEventListener("change", () => {
  const metadata = viewer.setDisplaySampling(Number(elements.sampling.value));
  if (metadata) {
    currentMetadata = metadata;
    renderCloudInfo(metadata);
    setHint(`顯示取樣已改為每 ${elements.sampling.value} 點顯示 1 點`);
  }
});

elements.rayThreshold.addEventListener("input", () => {
  const value = Number(elements.rayThreshold.value);
  viewer.setRaycastThreshold(value);
  elements.rayThresholdValue.value = value.toFixed(3);
});

elements.distanceMode.addEventListener("change", () => {
  const value = elements.distanceMode.value as MeasurementDistanceMode;
  measurementManager.setDistanceMode(value);
  elements.distanceModeValue.value = getDistanceModeShortLabel(value);
  setHint(getDistanceModeHint(value));
});

elements.snapMode.addEventListener("change", () => {
  const value = elements.snapMode.value as MeasurementSnapMode;
  elements.snapModeValue.value = getSnapModeShortLabel(value);
  setHint(getSnapModeHint(value));
});

elements.snapRadius.addEventListener("input", () => {
  const value = Number(elements.snapRadius.value);
  elements.snapRadiusValue.value = `${value.toFixed(2)} m`;
  setHint(`吸附半徑：${value.toFixed(2)} m`);
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
    setHint("找不到穩定平面。請加大吸附半徑，或點選更平整的門/牆面。");
    return;
  }

  lastPreviewPickAt = performance.now();
  const preview = measurementManager.beginPlaneDrag(pick, pick.point, basis);
  measurementRenderer.updatePlanePreview(preview);
  measurementRenderer.showSnapIndicator(pick);
  updateModeStatus();
  setHint(`已鎖定平面 ${formatSnap(pick)}。在此面上拖曳矩形即可量測寬高。`);
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
    setHint("游標射線與鎖定平面平行，無法取得落點");
    return;
  }

  const preview = measurementManager.updatePlaneDrag(point);
  if (preview) {
    measurementRenderer.updatePlanePreview(preview);
    setHint(`平面預覽：${formatPlaneMeasurement(preview)}`);
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
    setHint("沒有選到平面終點，已取消平面量測");
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
    setHint(`已建立平面模型：${surface.name} | ${formatPlaneMeasurement(record)}`);
  } else {
    setHint("平面矩形太小，已取消量測");
  }
});

elements.canvas.addEventListener("mousedown", (event) => {
  if (!measureMode || event.button !== 0) {
    return;
  }

  event.preventDefault();
  const pick = measurementManager.pickPoint(event.clientX, event.clientY, getPickOptions("final"));
  if (!pick) {
    setHint("沒有選到起點");
    return;
  }

  lastPreviewPickAt = performance.now();
  const preview = measurementManager.beginDrag(pick);
  measurementRenderer.updatePreview(preview);
  measurementRenderer.showSnapIndicator(pick);
  updateModeStatus();
  setHint(`起點 ${formatSnap(pick)}。拖曳可預覽，放開滑鼠完成量測。`);
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
    setHint("沒有選到點");
    return;
  }

  const preview = measurementManager.updateDrag(pick);
  if (preview) {
    measurementRenderer.updatePreview(preview);
    measurementRenderer.showSnapIndicator(pick);
    setHint(`預覽：${formatDistance(preview.distanceMeters)} | ${formatSnap(pick)}`);
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
    setHint("沒有選到終點，已取消量測");
    return;
  }

  const record = measurementManager.finishDrag(pick);
  measurementRenderer.clearPreview();
  measurementRenderer.showSnapIndicator(pick);
  if (record) {
    measurementRenderer.addRecord(record);
    renderRecords();
    updateModeStatus();
    setHint(`已新增量測：${formatDistance(record.distanceMeters)} | ${formatSnap(pick)}`);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && (measurementManager.isDragging() || measurementManager.isPlaneDragging())) {
    measurementManager.cancelCurrent();
    measurementRenderer.clearPreview();
    measurementRenderer.clearSnapIndicator();
    updateModeStatus();
    setHint("已取消目前量測");
  }
});

async function loadPly(filePath: string): Promise<void> {
  viewer.setRoomPlanOverlay(null);
  renderScanMetadataStatus("尚未載入掃描資料夾");
  renderRoomPlanStatsStatus("尚未載入 RoomPlan");
  setHint("正在載入 PLY...");
  const result = await loader.loadPlyDirect(filePath);
  await applyLoadedPointCloud(result);
  if (result.header.detectedMode === ViewerMode.POINT_CLOUD) {
    setHint(`已載入 ${result.metadata.fileName}`);
  }
}

async function loadScanFolder(scanFolder: ScanFolderPayload): Promise<void> {
  viewer.setRoomPlanOverlay(null);
  renderScanMetadataStatus("正在載入 metadata...");
  renderRoomPlanStatsStatus("正在載入 RoomPlan...");

  if (!scanFolder.pointcloudPath) {
    renderScanMetadataStatus("metadata.json 尚未載入");
    renderRoomPlanStatsStatus("RoomPlan 尚未載入");
    throw new Error(`${scanFolder.scanFolderPath} 缺少 pointcloud.ply`);
  }

  setHint("正在載入掃描點雲 pointcloud.ply...");
  const result = await loader.loadPlyDirect(scanFolder.pointcloudPath);
  await applyLoadedPointCloud(result);
  const meshIssue = await loadReferenceMeshForScan(scanFolder, result.metadata);

  const issues = renderScanBundleInfo(scanFolder);
  if (meshIssue) {
    issues.push(meshIssue);
  }
  const roomPlan = parseRoomPlanForOverlay(scanFolder.roomplanJson);
  viewer.setRoomPlanOverlayAutoAlign(elements.roomPlanOverlayAutoAlign.checked);
  viewer.setRoomPlanOverlay(roomPlan);
  viewer.setRoomPlanOverlayVisible(elements.roomPlanOverlayVisible.checked);
  if (issues.length > 0) {
    elements.hintStatus.textContent = `已載入掃描資料夾 ${basename(scanFolder.scanFolderPath)}，但有警告`;
    setError(issues.join(" | "));
  } else {
    setHint(`已載入掃描資料夾 ${basename(scanFolder.scanFolderPath)}`);
  }
}

async function loadReferenceMeshForScan(scanFolder: ScanFolderPayload, metadata: PointCloudMetadata): Promise<string | null> {
  viewer.clearReferenceMesh();
  if (!scanFolder.meshPath) {
    return null;
  }

  try {
    setHint("正在載入 mesh.ply...");
    const result = await loader.loadMeshDirect(scanFolder.meshPath, {
      min: metadata.boundingBoxMin,
      max: metadata.boundingBoxMax,
      marginMeters: 0.75
    });
    viewer.loadReferenceMesh(result.geometry);
    setHint(`Mesh 已載入：${result.keptFaceCount.toLocaleString()} / ${result.originalFaceCount.toLocaleString()} 個面可用`);
    return result.discardedFaceCount > 0
      ? `mesh.ply 已載入，已過濾 ${result.discardedFaceCount.toLocaleString()} 個超出範圍的面`
      : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `mesh.ply 載入失敗：${message}`;
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
    setHint("偵測到 Gaussian Splat PLY。目前 Gaussian Splat 模式仍在實驗中，先以 x y z + RGB 顯示點雲預覽。");
  } else {
    currentMetadata = viewer.loadPointCloud(result.geometry, result.metadata);
    if (result.header.detectedMode === ViewerMode.UNKNOWN) {
      setHint("偵測模式：未知。PLY header 欄位不足，無法明確判斷為點雲或 Gaussian Splat。");
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
    setHint(`距離量測：${getSnapModeHint(elements.snapMode.value as MeasurementSnapMode)}`);
  } else {
    measurementManager.cancelCurrent();
    measurementRenderer.clearPreview();
    measurementRenderer.clearSnapIndicator();
    setHint("距離量測已關閉");
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
    setHint("平面量測：點選門/牆面鎖定 RANSAC 平面，再拖曳矩形取得寬高");
  } else {
    measurementManager.cancelCurrent();
    measurementRenderer.clearPreview();
    measurementRenderer.clearSnapIndicator();
    setHint("平面量測已關閉");
  }
  updateModeStatus();
}

function renderCloudInfo(metadata: PointCloudMetadata): void {
  elements.cloudInfo.innerHTML = "";
  const rows: Array<[string, string]> = [
    ...buildPointCloudInfoRows(metadata),
    ["單位", metadata.unit],
    ["載入點數", `${metadata.loadedPoints.toLocaleString()} / ${metadata.totalPoints.toLocaleString()}`],
    ["記憶體估算", formatBytes(metadata.estimatedMemoryBytes)]
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
      ["掃描資料夾", scanFolder.scanFolderPath],
      ["metadata", "缺少 metadata.json"],
      ["mesh.ply", formatPresence(Boolean(scanFolder.meshPath))],
      ["roomplan.usdz", formatPresence(Boolean(scanFolder.roomplanUsdzPath))]
    ]);
    issues.push("缺少 metadata.json");
    return;
  }

  const parsed = parseJsonObject(scanFolder.metadataJson, "metadata.json", issues);
  if (!parsed) {
    renderScanMetadataRows([
      ["掃描資料夾", scanFolder.scanFolderPath],
      ["metadata", "metadata.json 解析失敗"],
      ["mesh.ply", formatPresence(Boolean(scanFolder.meshPath))],
      ["roomplan.usdz", formatPresence(Boolean(scanFolder.roomplanUsdzPath))]
    ]);
    return;
  }

  const rows: Array<[string, string]> = [
    ["掃描資料夾", scanFolder.scanFolderPath],
    ["點數", formatJsonValue(parsed.point_count)],
    ["建立時間", formatJsonValue(parsed.created_at)],
    ["App 版本", formatJsonValue(parsed.app_version)],
    ["座標系統", formatJsonValue(parsed.coordinate_system)],
    ["輸出模式", formatJsonValue(parsed.export_mode)],
    ["含點雲", formatJsonValue(parsed.has_pointcloud)],
    ["含 mesh", formatJsonValue(parsed.has_mesh)],
    ["mesh 頂點", formatJsonValue(parsed.mesh_vertex_count)],
    ["mesh 面數", formatJsonValue(parsed.mesh_face_count)],
    ["mesh 對齊", formatJsonValue(parsed.pointcloud_mesh_alignment)],
    ["含 RoomPlan JSON", formatJsonValue(parsed.has_roomplan_json)],
    ["含 RoomPlan USDZ", formatJsonValue(parsed.has_roomplan_usdz)],
    ["mesh.ply", formatPresence(Boolean(scanFolder.meshPath))],
    ["roomplan.usdz", formatPresence(Boolean(scanFolder.roomplanUsdzPath))]
  ];

  renderScanMetadataRows(rows);
}

function renderRoomPlanStats(scanFolder: ScanFolderPayload, issues: string[]): void {
  if (!scanFolder.roomplanJson) {
    renderInfoRows(elements.roomPlanStats, [["roomplan", "缺少 roomplan.json"]]);
    issues.push("缺少 roomplan.json");
    return;
  }

  const parsed = parseJsonObject(scanFolder.roomplanJson, "roomplan.json", issues);
  if (!parsed) {
    renderInfoRows(elements.roomPlanStats, [["roomplan", "roomplan.json 解析失敗"]]);
    return;
  }

  const rows: Array<[string, string]> = [
    ["牆面", countJsonArray(parsed.walls)],
    ["窗戶", countJsonArray(parsed.windows)],
    ["門", countJsonArray(parsed.doors)],
    ["地板", countJsonArray(parsed.floors)],
    ["物件", countJsonArray(parsed.objects)]
  ];

  if ("openings" in parsed) {
    rows.push(["開口", countJsonArray(parsed.openings)]);
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
  renderInfoRows(elements.scanMetadata, [["狀態", message]]);
}

function renderRoomPlanStatsStatus(message: string): void {
  renderInfoRows(elements.roomPlanStats, [["狀態", message]]);
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
    elements.records.textContent = "尚無量測紀錄";
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
    elements.modelSurfaces.textContent = "尚無模型平面";
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
  nameInput.setAttribute("aria-label", "模型平面名稱");
  nameInput.addEventListener("change", () => {
    const updated = modelManager.updateSurface(surface.id, { name: nameInput.value });
    if (updated) {
      modelRenderer.addOrUpdate(updated);
      renderModelSurfaces();
      setHint(`已更新 ${updated.name}`);
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
      setHint(`${updated.name} 類型：${getModelSurfaceKindLabel(updated.kind)}`);
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
      setHint(`${updated.name} 已${updated.visible ? "顯示" : "隱藏"}`);
    }
  });
  visibleLabel.append(visibleCheckbox, "顯示");

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-record";
  deleteButton.textContent = "刪除";
  deleteButton.addEventListener("click", () => {
    modelManager.deleteSurface(surface.id);
    modelRenderer.remove(surface.id);
    renderModelSurfaces();
    setHint(`已刪除 ${surface.name}`);
  });

  const metrics = document.createElement("div");
  metrics.className = "model-metrics";
  metrics.textContent = `${surface.widthMeters.toFixed(3)} m x ${surface.heightMeters.toFixed(3)} m | ${surface.areaSquareMeters.toFixed(3)} m2`;

  const qa = document.createElement("div");
  qa.className = getModelQaClass(surface);
  qa.textContent = `品質 ${getModelQaLabel(surface)} | 信心度 ${Math.round(surface.confidence * 100)}% | 內點 ${surface.inlierCount}/${surface.candidateCount}`;

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
  title.textContent = `${getDistanceModeShortLabel(record.distanceMode)} ${formatDistance(record.distanceMeters)}`;

  const details = document.createElement("div");
  details.className = "record-details";
  details.textContent = `模式 ${getDistanceModeLabel(record.distanceMode)} | P1 ${formatVector(record.start)} (${formatSnapShort(record.startSnap)}) | P2 ${formatVector(record.end)} (${formatSnapShort(record.endSnap)})`;

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-record";
  deleteButton.textContent = "刪除";
  deleteButton.addEventListener("click", () => {
    measurementManager.deleteRecord(record.id);
    measurementRenderer.removeRecord(record.id);
    renderRecords();
    updateModeStatus();
    setHint("量測紀錄已刪除");
  });

  item.append(title, details, deleteButton);
  return item;
}

function createPlaneRecordElement(record: PlaneMeasurementRecord): HTMLElement {
  const item = document.createElement("article");
  item.className = "record plane-record";

  const title = document.createElement("div");
  title.className = "record-title";
  title.textContent = `平面 ${record.widthMeters.toFixed(3)} m x ${record.heightMeters.toFixed(3)} m`;

  const details = document.createElement("div");
  details.className = "record-details";
  details.textContent = `面積 ${record.areaSquareMeters.toFixed(3)} m2 | 起點 ${formatVector(record.start)} | 吸附 ${formatSnapShort(record.startSnap)}`;

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-record";
  deleteButton.textContent = "刪除";
  deleteButton.addEventListener("click", () => {
    measurementManager.deletePlaneRecord(record.id);
    measurementRenderer.removeRecord(record.id);
    renderRecords();
    updateModeStatus();
    setHint("平面量測已刪除");
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
    setHint("請先載入 PLY 或掃描資料夾，再儲存模型");
    return;
  }

  try {
    const result = await window.pointMeasure3D.saveModel(currentMetadata.filePath, modelManager.toDocument());
    setHint(result.canceled ? "已取消儲存模型" : `模型已儲存：${result.filePath ?? "pointmeasure-model.json"}`);
  } catch (error) {
    handleError(error);
  }
}

async function loadCurrentModel(silent = false): Promise<void> {
  if (!currentMetadata?.filePath) {
    if (!silent) {
      setHint("請先載入 PLY 或掃描資料夾，再載入模型");
    }
    return;
  }

  try {
    const document = await window.pointMeasure3D.loadModel(currentMetadata.filePath);
    if (!document) {
      if (!silent) {
        setHint("此點雲旁沒有找到 PointMeasure 3D 模型檔");
      }
      return;
    }

    modelManager.loadDocument(document);
    modelRenderer.rebuild(modelManager.getSurfaces());
    renderModelSurfaces();
    if (!silent) {
      setHint(`已載入 ${document.surfaces.length} 個模型平面`);
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
  elements.modeStatus.textContent = `移動模式：${formatMovementMode(mode)}`;
}

function setHint(message: string): void {
  elements.hintStatus.textContent = message;
  elements.errorStatus.textContent = "";
}

function getRenderPresetLabel(value: PointRenderPreset): string {
  return value === "default" ? "預設點雲" : "穩定點";
}

function getVisualFilterLabel(value: PointDisplayFilter): string {
  if (value === "clean") {
    return "清理";
  }
  if (value === "strict") {
    return "嚴格";
  }
  return "不過濾";
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
  return `寬 ${record.widthMeters.toFixed(3)} m | 高 ${record.heightMeters.toFixed(3)} m | 面積 ${record.areaSquareMeters.toFixed(3)} m2`;
}

function getModelSurfaceKinds(): ModelSurfaceKind[] {
  return ["door", "wall", "column_face", "beam_face", "cabinet_face", "custom"];
}

function getModelQaLabel(surface: PlaneModelSurface): string {
  const status = getModelQaStatus(surface);
  if (status === "good") {
    return "良好";
  }
  if (status === "check") {
    return "需檢查";
  }
  return "偏弱";
}

function getModelQaClass(surface: PlaneModelSurface): string {
  return `model-qa ${getModelQaStatus(surface)}`;
}

function getModelQaStatus(surface: PlaneModelSurface): "good" | "check" | "weak" {
  if (surface.confidence >= 0.72 && surface.inlierCount >= 120) {
    return "good";
  }
  if (surface.confidence >= 0.52 && surface.inlierCount >= 45) {
    return "check";
  }
  return "weak";
}

function formatSnap(pick: MeasurementPickResult): string {
  const confidence = Math.round(pick.confidence * 100);
  if (pick.kind === "mesh") {
    return `mesh 吸附 ${confidence}%`;
  }
  if (pick.kind === "edge") {
    return `邊線吸附 ${confidence}% (${pick.inlierCount}/${pick.candidateCount})`;
  }
  if (pick.kind === "plane") {
    return `平面吸附 ${confidence}% (${pick.inlierCount}/${pick.candidateCount})`;
  }
  return `點吸附 ${confidence}%`;
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
    return "舊版";
  }

  if (pick.kind === "edge") {
    return "邊線";
  }
  if (pick.kind === "plane") {
    return "平面";
  }
  if (pick.kind === "mesh") {
    return "mesh";
  }
  return "點";
}

function getDistanceModeShortLabel(mode: MeasurementDistanceMode): string {
  if (mode === "horizontal") {
    return "水平";
  }
  if (mode === "vertical") {
    return "垂直";
  }
  return "3D";
}

function getDistanceModeLabel(mode: MeasurementDistanceMode): string {
  if (mode === "horizontal") {
    return "水平距離";
  }
  if (mode === "vertical") {
    return "垂直距離";
  }
  return "3D 距離";
}

function getDistanceModeHint(mode: MeasurementDistanceMode): string {
  if (mode === "horizontal") {
    return "水平距離：忽略高度差，只計算地面平面上的距離";
  }
  if (mode === "vertical") {
    return "垂直距離：只計算高度差";
  }
  return "3D 距離：計算兩點之間的直接距離";
}

function getSnapModeShortLabel(mode: MeasurementSnapMode): string {
  if (mode === "smart") {
    return "智慧";
  }
  if (mode === "edge") {
    return "邊線";
  }
  if (mode === "plane") {
    return "平面";
  }
  return "最近點";
}

function getSnapModeHint(mode: MeasurementSnapMode): string {
  if (mode === "smart") {
    return "智慧吸附：優先使用 mesh 表面，再依序嘗試邊線、局部 RANSAC 平面與最近點";
  }
  if (mode === "edge") {
    return "邊線吸附：擬合兩個局部平面，吸附到交線";
  }
  if (mode === "plane") {
    return "平面吸附：擬合局部 RANSAC 平面，並將點投影到平面";
  }
  return "最近點：不做平面或邊線擬合，只使用點選結果";
}

function setError(message: string): void {
  elements.errorStatus.textContent = message;
}

function setDefaultNavigationHint(): void {
  elements.hintStatus.textContent = "WASD 移動 | Space/Ctrl 上下 | Shift 加速 | 滾輪縮放 | 右鍵拖曳旋轉 | M 步行/飛行";
  elements.errorStatus.textContent = "";
}

function formatMovementMode(mode: MovementMode): string {
  return mode === "walk" ? "步行" : "飛行";
}

function handleError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  elements.errorStatus.textContent = message;
  elements.hintStatus.textContent = "發生錯誤";
  console.error(error);
}

function parseJsonObject(text: string, fileName: string, issues: string[]): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    issues.push(`${fileName} 內容不是 JSON 物件`);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(`${fileName} 解析失敗：${message}`);
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
    return value ? "是" : "否";
  }
  return "-";
}

function formatPresence(present: boolean): string {
  return present ? "存在" : "缺少";
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
    throw new Error(`找不到介面元素 ${selector}`);
  }
  return element;
}
