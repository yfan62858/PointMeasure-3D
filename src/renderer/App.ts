import "./styles.css";
import * as THREE from "three";
import type { ModelSurfaceKind, PlaneModelSurface } from "../shared/ModelTypes";
import type {
  MeasurementPlaneConstraint,
  MeasurementPickOptions,
  MeasurementPickPreset,
  MeasurementPickResult,
  MeasurementSnapLine,
  MeasurementSnapMode,
  MeasurementSnapPlane,
  ScreenRectangle,
  StructuralBoundaryFitResult,
  StructuralBoundarySide,
  StructuralDimensionMode,
  TrustedPlaneFitResult
} from "../shared/PointCloudDataSource";
import type { PointCloudMetadata, ScanFolderPayload, Vector3Like } from "../shared/types";
import { formatBytes, formatDistance, formatVector } from "./utils/format";
import { MeasurementManager } from "./measurement/MeasurementManager";
import { MeasurementRenderer } from "./measurement/MeasurementRenderer";
import type {
  ClearanceMeasurementRecord,
  MeasurementDistanceMode,
  MeasurementRecord,
  PlaneMeasurementRecord
} from "./measurement/MeasurementTypes";
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
import { CornerDetector, type Corner3D } from "../cornerDetector";
import { solveStructuralSpan } from "./viewer/StructuralRectangleFit";

const elements = {
  canvas: query<HTMLCanvasElement>("#viewport"),
  viewerShell: query<HTMLElement>(".viewer-shell"),
  planeRoiOverlay: query<HTMLDivElement>("#planeRoiOverlay"),
  importPly: query<HTMLButtonElement>("#importPly"),
  importScanFolder: query<HTMLButtonElement>("#importScanFolder"),
  loadSample: query<HTMLButtonElement>("#loadSample"),
  resetView: query<HTMLButtonElement>("#resetView"),
  firstPerson: query<HTMLButtonElement>("#firstPerson"),
  measureDistance: query<HTMLButtonElement>("#measureDistance"),
  measurePlane: query<HTMLButtonElement>("#measurePlane"),
  measureClearance: query<HTMLButtonElement>("#measureClearance"),
  lockCorner: query<HTMLButtonElement>("#lockCorner"),
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
  measurementPreset: query<HTMLSelectElement>("#measurementPreset"),
  measurementPresetValue: query<HTMLOutputElement>("#measurementPresetValue"),
  distanceMode: query<HTMLSelectElement>("#distanceMode"),
  distanceModeValue: query<HTMLOutputElement>("#distanceModeValue"),
  snapMode: query<HTMLSelectElement>("#snapMode"),
  snapModeValue: query<HTMLOutputElement>("#snapModeValue"),
  snapRadius: query<HTMLInputElement>("#snapRadius"),
  snapRadiusValue: query<HTMLOutputElement>("#snapRadiusValue"),
  structuralDimension: query<HTMLSelectElement>("#structuralDimension"),
  structuralDimensionValue: query<HTMLOutputElement>("#structuralDimensionValue"),
  planeConstraint: query<HTMLSelectElement>("#planeConstraint"),
  planeConstraintValue: query<HTMLOutputElement>("#planeConstraintValue"),
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
const cornerDetector = new CornerDetector();
const cornerOverlayGroup = new THREE.Group();
let measureMode = false;
let planeMeasureMode = false;
let clearanceMeasureMode = false;
let cornerLockMode = false;
let currentMetadata: PointCloudMetadata | null = null;
let lastPreviewPickAt = 0;
let detectedCorners: Corner3D[] = [];
let cornerDetectionRunId = 0;
let cornerOverlayVisible = true;
let clearanceUpperPick: MeasurementPickResult | null = null;
let clearanceLowerPick: MeasurementPickResult | null = null;
let clearancePlanePairId: string | null = null;
let clearanceProbeIndex = 0;
let planeRoiStart: { x: number; y: number } | null = null;
let pendingStructuralPlane: TrustedPlaneFitResult | null = null;
let structuralBoundaryFits: StructuralBoundaryFitResult[] = [];

measurementManager.setDataSource(viewer);
measurementManager.setMeasurementPreset(elements.measurementPreset.value as MeasurementPickPreset);
cornerOverlayGroup.name = "detected-structural-corners";
viewer.scene.add(cornerOverlayGroup);

if (!import.meta.env.DEV) {
  elements.loadSample.hidden = true;
}

viewer.setFrameCallback((info) => {
  elements.cameraStatus.textContent = `相機：${formatVector(info.cameraPosition)}`;
  updateMovementModeStatus(info.movementMode);
  if (info.isFirstPerson && !measureMode && !planeMeasureMode && !clearanceMeasureMode) {
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
  if (measureMode || planeMeasureMode || clearanceMeasureMode) {
    setMeasureMode(false);
    setPlaneMeasureMode(false);
    setClearanceMeasureMode(false);
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

elements.measureClearance.title = "舊共用平面方法已停用，待聯合平行平面版本完成後再開放。";

elements.lockCorner.addEventListener("click", () => {
  setCornerLockMode(!cornerLockMode);
});

elements.saveModel.addEventListener("click", async () => {
  await saveCurrentModel();
});

elements.loadModel.addEventListener("click", async () => {
  await loadCurrentModel();
});

elements.clearCurrent.addEventListener("click", () => {
  if (cornerLockMode) {
    setCornerLockMode(false, { keepMeasurement: true });
  }
  measurementManager.cancelCurrent();
  measurementRenderer.clearPreview();
  measurementRenderer.clearSnapIndicator();
  resetStructuralRectangleWorkflow();
  resetClearancePlaneSelection();
  renderRecords();
  updateModeStatus();
  setHint("已清除目前預覽");
});

elements.clearAll.addEventListener("click", () => {
  if (cornerLockMode) {
    setCornerLockMode(false, { keepMeasurement: true });
  }
  measurementManager.clearAll();
  measurementRenderer.clearAll();
  measurementRenderer.clearSnapIndicator();
  resetStructuralRectangleWorkflow();
  modelManager.clear();
  modelRenderer.clear();
  renderModelSurfaces();
  renderRecords();
  resetClearancePlaneSelection();
  updateModeStatus();
  setHint("已清除全部量測與模型");
});

elements.exportCsv.addEventListener("click", async () => {
  const records = measurementManager.getRecords();
  const planeRecords = measurementManager.getPlaneRecords();
  const clearanceRecords = measurementManager.getClearanceRecords();
  if (records.length === 0 && planeRecords.length === 0 && clearanceRecords.length === 0) {
    setHint("沒有可匯出的量測紀錄");
    return;
  }

  try {
    const result = await window.pointMeasure3D.saveCsv(measurementsToCsv(records, planeRecords, clearanceRecords));
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

elements.measurementPreset.addEventListener("change", () => {
  const value = elements.measurementPreset.value as MeasurementPickPreset;
  measurementManager.setMeasurementPreset(value);
  elements.measurementPresetValue.value = value === "beam_column" ? "梁柱" : "一般";
  measurementManager.cancelCurrent();
  measurementRenderer.clearPreview();
  measurementRenderer.clearSnapIndicator();
  setHint(value === "beam_column"
    ? "梁柱量測：優先吸附可信的上下水平面；平面不足時會退回垂直鎖定取點。"
    : "一般量測：使用標準智慧吸附。"
  );
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

elements.structuralDimension.addEventListener("change", () => {
  const dimension = getStructuralDimensionMode();
  elements.structuralDimensionValue.value = getStructuralDimensionLabel(dimension);
  structuralBoundaryFits = [];
  if (pendingStructuralPlane) {
    measurementRenderer.showTrustedPlaneFit(pendingStructuralPlane);
    const firstSide = getCurrentStructuralBoundarySide();
    setHint(
      `已切換為${getStructuralDimensionLabel(dimension)}量測。` +
      `請框選${getStructuralBoundaryLabel(firstSide as StructuralBoundarySide)}窄帶。`
    );
  } else {
    setHint(
      `${getStructuralDimensionLabel(dimension)}量測：先框選梁柱正面內部的可信主平面。`
    );
  }
  updateModeStatus();
});

elements.planeConstraint.addEventListener("change", () => {
  const constraint = elements.planeConstraint.value as MeasurementPlaneConstraint;
  elements.planeConstraintValue.value = getPlaneConstraintShortLabel(constraint);
  setHint(getPlaneConstraintHint(constraint));
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
  if (!clearanceMeasureMode || event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  if (!clearanceUpperPick || !clearanceLowerPick) {
    const pick = measurementManager.pickPoint(event.clientX, event.clientY, getPlanePickOptions("final"));
    if (!pick || !isHorizontalPlanePick(pick)) {
      setHint("找不到穩定的水平面。請點選較平整的水平區域，必要時調整吸附半徑。");
      return;
    }

    if (!clearanceUpperPick) {
      clearanceUpperPick = pick;
      measurementRenderer.showClearancePlaneSelection(clearanceUpperPick, null);
      measurementRenderer.showSnapIndicator(pick);
      setHint(`已鎖定共用上平面（RMS ${formatPlaneRms(pick)}）。下一步：點選下方水平面。`);
      return;
    }

    if (!isValidUpperLowerOrder(clearanceUpperPick, pick)) {
      setHint("下平面必須位於上平面下方。請重新點選下方水平面，或按 Esc 重新開始。");
      return;
    }

    clearanceLowerPick = pick;
    clearancePlanePairId = crypto.randomUUID();
    clearanceProbeIndex = 0;
    measurementRenderer.showClearancePlaneSelection(clearanceUpperPick, clearanceLowerPick);
    measurementRenderer.showSnapIndicator(pick);
    const angle = getPlaneParallelAngleDegrees(clearanceUpperPick.plane, clearanceLowerPick.plane);
    setHint(`上下共用平面已鎖定（夾角 ${angle.toFixed(2)}°）。請在梁的左、右位置依序點選以計算淨高。`);
    return;
  }

  const probePick = measurementManager.pickPoint(event.clientX, event.clientY, {
    ...getPickOptions("final"),
    mode: "nearest"
  });
  if (!probePick || !clearancePlanePairId) {
    setHint("找不到淨高探測位置。請點在目標梁柱附近的可見點雲上。");
    return;
  }

  const nextProbeIndex = clearanceProbeIndex + 1;
  const record = measurementManager.addClearanceMeasurement(
    clearancePlanePairId,
    nextProbeIndex,
    clearanceUpperPick,
    clearanceLowerPick,
    probePick.rawPoint ?? probePick.point
  );
  if (!record) {
    setHint("共用平面無法在此位置形成有效淨高。請確認此位置位於上下平面的有效範圍。");
    return;
  }

  clearanceProbeIndex = nextProbeIndex;
  measurementRenderer.addClearanceRecord(record);
  measurementRenderer.showSnapIndicator({ ...probePick, point: record.lowerPoint });
  renderRecords();
  updateModeStatus();
  setHint(formatClearanceProbeHint(record));
});

elements.canvas.addEventListener("mousedown", (event) => {
  if (!cornerLockMode || event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  const pick = pickLockedCorner(event.clientX, event.clientY);
  if (!pick) {
    setHint("找不到可鎖定的牆角。請靠近牆角點一次，或先用平面量測建立牆面/柱面/梁面當備援。");
    return;
  }

  if (!measureMode) {
    setMeasureMode(true);
  }
  setCornerLockMode(false, { keepMeasurement: true });
  measurementManager.cancelCurrent();
  lastPreviewPickAt = performance.now();
  const preview = measurementManager.beginDrag(pick);
  measurementRenderer.updatePreview(preview);
  measurementRenderer.showSnapIndicator(pick);
  updateModeStatus();
  setHint(`已鎖定 ${formatSnap(pick)} 作為起點，拖曳到另一端後放開完成量測。`);
});

elements.canvas.addEventListener("mousedown", (event) => {
  if (!planeMeasureMode || event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  measurementManager.cancelCurrent();
  measurementRenderer.clearPreview();
  measurementRenderer.clearSnapIndicator();
  planeRoiStart = { x: event.clientX, y: event.clientY };
  updatePlaneRoiOverlay(event.clientX, event.clientY);
  elements.viewerShell.classList.add("plane-roi-active");
  updateModeStatus();
  const boundarySide = getCurrentStructuralBoundarySide();
  setHint(boundarySide
    ? `拖曳一條窄帶橫跨${getStructuralBoundaryLabel(boundarySide)}內外兩側；窄帶要沿著邊界涵蓋足夠長度。`
    : "第一步：在梁柱正面內部框選可信主平面；不要碰到四周邊界。"
  );
});

window.addEventListener("mousemove", (event) => {
  if (!planeMeasureMode || !planeRoiStart) {
    return;
  }
  updatePlaneRoiOverlay(event.clientX, event.clientY);
});

window.addEventListener("mouseup", (event) => {
  if (!planeMeasureMode || event.button !== 0 || !planeRoiStart) {
    return;
  }

  event.preventDefault();
  const rectangle = finishPlaneRoiSelection(event.clientX, event.clientY);
  if (!rectangle) {
    setHint("框選範圍太小，請拖曳框選一整塊表面。");
    return;
  }

  setHint("正在分析框選點雲、排除離群點並檢查平面品質…");
  window.setTimeout(() => completeTrustedPlaneSelection(rectangle), 0);
});

elements.canvas.addEventListener("mousedown", (event) => {
  if (!measureMode || event.button !== 0) {
    return;
  }

  event.preventDefault();
  const pick = pickDistancePoint(event.clientX, event.clientY, getPickOptions("final"));
  if (!pick) {
    setHint(getDistancePickFailureHint());
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

  const pick = pickDistancePoint(event.clientX, event.clientY, getPickOptions("preview"));
  if (!pick) {
    setHint(getDistancePickFailureHint());
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
  const pick = pickDistancePoint(event.clientX, event.clientY, getPickOptions("final"));
  if (!pick) {
    measurementManager.cancelCurrent();
    measurementRenderer.clearPreview();
    measurementRenderer.clearSnapIndicator();
    updateModeStatus();
    setHint(`${getDistancePickFailureHint()} 已取消量測。`);
    return;
  }

  const record = measurementManager.finishDrag(pick);
  measurementRenderer.clearPreview();
  if (record) {
    measurementRenderer.showSnapIndicator({ ...pick, point: record.end });
    // A new reliable structural pair can lock earlier measurements in the same
    // rectangular beam/column group, so rebuild all labels and endpoints.
    rebuildMeasurementScene();
    renderRecords();
    updateModeStatus();
    const lockHint = record.structuralHeightLocked ? " | 已共用同一組結構上下邊界" : "";
    setHint(`已新增量測：${formatDistance(record.distanceMeters)} | ${formatSnap(pick)}${lockHint}`);
  } else {
    measurementRenderer.showSnapIndicator(pick);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.code === "KeyC" && !isEditableEventTarget(event.target)) {
    cornerOverlayVisible = !cornerOverlayVisible;
    cornerOverlayGroup.visible = cornerOverlayVisible;
    setHint(cornerOverlayVisible ? "已顯示結構邊界。" : "已隱藏結構邊界。");
    return;
  }
  if (event.code === "Escape" && clearanceMeasureMode) {
    if (clearanceUpperPick || clearanceLowerPick) {
      resetClearancePlaneSelection();
      measurementRenderer.clearSnapIndicator();
      setHint("已重設共用平面。請重新點選上方水平面。");
    } else {
      setClearanceMeasureMode(false);
    }
    return;
  }
  if (event.code === "Escape" && cornerLockMode) {
    setCornerLockMode(false);
    return;
  }
  if (event.code === "Escape" && planeRoiStart) {
    cancelPlaneRoiSelection();
    measurementRenderer.clearSnapIndicator();
    updateModeStatus();
    setHint("已取消本次平面框選；可重新拖曳框選表面。");
    return;
  }
  if (event.code === "Escape" && planeMeasureMode && pendingStructuralPlane) {
    resetStructuralRectangleWorkflow();
    updateModeStatus();
    setHint("已取消本次四邊界量測。請重新框選梁柱正面的主平面。");
    return;
  }
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
  cornerDetectionRunId += 1;
  detectedCorners = [];
  cornerDetector.setCorners([]);
  rebuildCornerOverlay();
  measurementManager.clearAll();
  measurementRenderer.clearAll();
  measurementRenderer.clearSnapIndicator();
  resetStructuralRectangleWorkflow({ clearIndicator: false });
  resetClearancePlaneSelection();
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
  if (result.header.detectedMode !== ViewerMode.GAUSSIAN_SPLAT) {
    startCornerDetection(result.geometry, cornerDetectionRunId);
  }
  updateModeStatus();
}

function startCornerDetection(geometry: THREE.BufferGeometry, runId: number): void {
  const position = geometry.getAttribute("position");
  if (!position || position.itemSize !== 3 || !(position.array instanceof Float32Array)) {
    console.warn("[CornerDetector] Skipped: position attribute is not a Float32Array XYZ buffer.");
    return;
  }

  console.time("[CornerDetector] detect");
  window.setTimeout(() => {
    void (async () => {
      try {
        const corners = await cornerDetector.detectAsync(position.array as Float32Array, (progress) => {
          if (progress.completed === progress.total) {
            console.debug(`[CornerDetector] ${progress.stage} ${progress.completed}/${progress.total}`);
          }
        });
        if (runId !== cornerDetectionRunId) {
          return;
        }

        detectedCorners = corners;
        cornerDetector.setCorners(corners);
        rebuildCornerOverlay();
        console.timeEnd("[CornerDetector] detect");
        console.log(
          `[CornerDetector] Found ${corners.length} sharp structural edges`,
          corners.map((corner) => ({
            x: Number(corner.x.toFixed(3)),
            z: Number(corner.y.toFixed(3)),
            yMin: Number(corner.zMin.toFixed(3)),
            yMax: Number(corner.zMax.toFixed(3)),
            confidence: Math.round(corner.confidence)
          }))
        );
        setHint(`已偵測 ${corners.length} 條結構邊界。按 C 可顯示/隱藏邊界。`);
      } catch (error) {
        console.timeEnd("[CornerDetector] detect");
        console.error("[CornerDetector] Failed", error);
      }
    })();
  }, 0);
}

function rebuildCornerOverlay(): void {
  while (cornerOverlayGroup.children.length > 0) {
    const child = cornerOverlayGroup.children.pop();
    if (child) {
      disposeThreeObject(child);
    }
  }

  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x3ff5ff,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false
  });
  const sphereMaterial = new THREE.MeshBasicMaterial({
    color: 0x3ff5ff,
    depthTest: false,
    depthWrite: false
  });

  for (const corner of detectedCorners) {
    const bottom = new THREE.Vector3(corner.x, corner.zMin, corner.y);
    const top = new THREE.Vector3(corner.x, corner.zMax, corner.y);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([bottom, top]), lineMaterial.clone());
    line.renderOrder = 1040;
    cornerOverlayGroup.add(line);

    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), sphereMaterial.clone());
    sphere.position.set(corner.x, (corner.zMin + corner.zMax) * 0.5, corner.y);
    sphere.renderOrder = 1042;
    cornerOverlayGroup.add(sphere);
  }
  cornerOverlayGroup.visible = cornerOverlayVisible;
}

function disposeThreeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh | THREE.Line;
    if ("geometry" in mesh && mesh.geometry) {
      mesh.geometry.dispose();
    }
    if ("material" in mesh && mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.dispose();
      }
    }
  });
}

function setMeasureMode(enabled: boolean): void {
  if (enabled && planeMeasureMode) {
    setPlaneMeasureMode(false);
  }
  if (enabled && clearanceMeasureMode) {
    setClearanceMeasureMode(false);
  }
  if (enabled && cornerLockMode) {
    setCornerLockMode(false, { keepMeasurement: true });
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
  if (enabled && clearanceMeasureMode) {
    setClearanceMeasureMode(false);
  }
  if (enabled && cornerLockMode) {
    setCornerLockMode(false);
  }
  planeMeasureMode = enabled;
  elements.measurePlane.classList.toggle("active", enabled);
  cancelPlaneRoiSelection();
  resetStructuralRectangleWorkflow();
  if (enabled) {
    viewer.exitFirstPerson();
    const dimension = getStructuralDimensionMode();
    setHint(
      `${getStructuralDimensionLabel(dimension)}量測：先在正面內部框可信主平面，` +
      `再框${dimension === "height" ? "上、下" : "左、右"}兩條邊界窄帶。`
    );
  } else {
    measurementManager.cancelCurrent();
    measurementRenderer.clearPreview();
    measurementRenderer.clearSnapIndicator();
    setHint("梁柱長寬量測已關閉");
  }
  updateModeStatus();
}

function updatePlaneRoiOverlay(clientX: number, clientY: number): void {
  if (!planeRoiStart) {
    return;
  }
  const bounds = elements.canvas.getBoundingClientRect();
  const startX = clamp(planeRoiStart.x, bounds.left, bounds.right);
  const startY = clamp(planeRoiStart.y, bounds.top, bounds.bottom);
  const currentX = clamp(clientX, bounds.left, bounds.right);
  const currentY = clamp(clientY, bounds.top, bounds.bottom);
  const left = Math.min(startX, currentX) - bounds.left;
  const top = Math.min(startY, currentY) - bounds.top;
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);

  elements.planeRoiOverlay.style.left = `${left}px`;
  elements.planeRoiOverlay.style.top = `${top}px`;
  elements.planeRoiOverlay.style.width = `${width}px`;
  elements.planeRoiOverlay.style.height = `${height}px`;
  const boundarySide = getCurrentStructuralBoundarySide();
  elements.planeRoiOverlay.dataset.label = boundarySide
    ? `${getStructuralBoundaryLabel(boundarySide)}窄帶`
    : "可信主平面";
  elements.viewerShell.classList.toggle("boundary-roi-stage", Boolean(boundarySide));
  elements.planeRoiOverlay.classList.add("visible");
}

function finishPlaneRoiSelection(clientX: number, clientY: number): ScreenRectangle | null {
  const start = planeRoiStart;
  if (!start) {
    return null;
  }

  const bounds = elements.canvas.getBoundingClientRect();
  const rectangle: ScreenRectangle = {
    left: clamp(Math.min(start.x, clientX), bounds.left, bounds.right),
    top: clamp(Math.min(start.y, clientY), bounds.top, bounds.bottom),
    right: clamp(Math.max(start.x, clientX), bounds.left, bounds.right),
    bottom: clamp(Math.max(start.y, clientY), bounds.top, bounds.bottom)
  };
  cancelPlaneRoiSelection();
  return rectangle.right - rectangle.left >= 14 && rectangle.bottom - rectangle.top >= 14
    ? rectangle
    : null;
}

function cancelPlaneRoiSelection(): void {
  planeRoiStart = null;
  elements.planeRoiOverlay.classList.remove("visible");
  elements.viewerShell.classList.remove("plane-roi-active");
  elements.viewerShell.classList.remove("boundary-roi-stage");
}

function completeTrustedPlaneSelection(rectangle: ScreenRectangle): void {
  if (!planeMeasureMode) {
    return;
  }

  const options = getPlanePickOptions("final");
  const boundarySide = getCurrentStructuralBoundarySide();
  if (pendingStructuralPlane && boundarySide) {
    completeStructuralBoundarySelection(rectangle, pendingStructuralPlane, boundarySide, options);
    return;
  }

  const constraint = elements.planeConstraint.value as MeasurementPlaneConstraint;
  const fit = measurementManager.fitTrustedPlaneRegion(rectangle, constraint, options);
  if (!fit) {
    measurementRenderer.clearSnapIndicator();
    setHint("框選區域找不到可用平面。請框大一點，並避開轉角、背景或遮擋區。");
    return;
  }

  measurementRenderer.showTrustedPlaneFit(fit);
  if (fit.qualityStatus === "rejected") {
    setHint(`主平面未通過，尚未進入邊界量測：${formatTrustedPlaneFitSummary(fit)}`);
    return;
  }

  pendingStructuralPlane = fit;
  structuralBoundaryFits = [];
  updateModeStatus();
  const firstSide = getCurrentStructuralBoundarySide() as StructuralBoundarySide;
  setHint(
    `主平面已通過，但尚未產生尺寸。第二步：請框一條窄帶橫跨` +
    `${getStructuralBoundaryLabel(firstSide)}內外兩側，並沿著邊界拉長。 | ` +
    `${formatTrustedPlaneFitSummary(fit)}`
  );
}

function completeStructuralBoundarySelection(
  rectangle: ScreenRectangle,
  plane: TrustedPlaneFitResult,
  side: StructuralBoundarySide,
  options: MeasurementPickOptions
): void {
  const boundary = measurementManager.fitStructuralBoundaryRegion(
    rectangle,
    plane,
    side,
    options
  );
  if (!boundary) {
    measurementRenderer.showStructuralBoundaryProgress(plane, structuralBoundaryFits);
    setHint(
      `${getStructuralBoundaryLabel(side)}找不到足夠的主平面點。` +
      `請把窄帶沿邊界拉長，並同時跨到梁面內側與外側。`
    );
    return;
  }
  if (boundary.qualityStatus === "rejected") {
    measurementRenderer.showStructuralBoundaryProgress(plane, structuralBoundaryFits);
    setHint(
      `${getStructuralBoundaryLabel(side)}未通過：${boundary.qualityIssues.join("、")}。` +
      `請重新框選同一條邊界。`
    );
    return;
  }

  structuralBoundaryFits.push(boundary);
  measurementRenderer.showStructuralBoundaryProgress(plane, structuralBoundaryFits);
  const nextSide = getCurrentStructuralBoundarySide();
  if (nextSide) {
    const qualityLabel = boundary.qualityStatus === "good" ? "良好" : "可用、建議複查";
    setHint(
      `${getStructuralBoundaryLabel(side)}已鎖定（${qualityLabel}，` +
      `切片 RMS ${(boundary.rmsMeters * 100).toFixed(2)} cm）。` +
      `下一步：框選${getStructuralBoundaryLabel(nextSide)}窄帶。`
    );
    updateModeStatus();
    return;
  }

  const dimension = getStructuralDimensionMode();
  const spanFit = solveStructuralSpan(plane, structuralBoundaryFits, dimension);
  if (!spanFit || spanFit.qualityStatus === "rejected") {
    const issues = spanFit?.qualityIssues.join("、") || "兩條邊界無法形成有效尺寸";
    structuralBoundaryFits = [];
    measurementRenderer.showTrustedPlaneFit(plane);
    const firstSide = getCurrentStructuralBoundarySide() as StructuralBoundarySide;
    setHint(
      `${getStructuralDimensionLabel(dimension)}邊界組合未通過：${issues}。` +
      `保留主平面，請從${getStructuralBoundaryLabel(firstSide)}重新框選。`
    );
    updateModeStatus();
    return;
  }

  const record = measurementManager.addStructuralSpanFit(spanFit);
  measurementRenderer.addRecord(record);
  renderRecords();
  structuralBoundaryFits = [];
  measurementRenderer.showTrustedPlaneFit(plane);
  updateModeStatus();
  const status = spanFit.qualityStatus === "good" ? "良好" : "需複查";
  setHint(
    `已完成梁柱${getStructuralDimensionLabel(dimension)}：${formatDistance(spanFit.distanceMeters)} | ` +
    `${status} | 不確定度約 ±${(spanFit.uncertaintyMeters * 100).toFixed(2)} cm。` +
    `主平面已保留；可重測同方向，或切換「尺寸方向」量另一個尺寸。`
  );
}

function getCurrentStructuralBoundarySide(): StructuralBoundarySide | null {
  if (!pendingStructuralPlane) {
    return null;
  }
  return getStructuralBoundaryOrder()[structuralBoundaryFits.length] ?? null;
}

function getStructuralDimensionMode(): StructuralDimensionMode {
  return elements.structuralDimension.value as StructuralDimensionMode;
}

function getStructuralDimensionLabel(dimension: StructuralDimensionMode): string {
  return dimension === "height" ? "高度" : "寬度";
}

function getStructuralBoundaryOrder(): readonly StructuralBoundarySide[] {
  return getStructuralDimensionMode() === "height"
    ? ["top", "bottom"]
    : ["left", "right"];
}

function getStructuralBoundaryLabel(side: StructuralBoundarySide): string {
  if (side === "top") return "上邊界";
  if (side === "bottom") return "下邊界";
  if (side === "left") return "左邊界";
  return "右邊界";
}

function resetStructuralRectangleWorkflow(
  options: { clearIndicator?: boolean } = {}
): void {
  pendingStructuralPlane = null;
  structuralBoundaryFits = [];
  elements.viewerShell.classList.remove("boundary-roi-stage");
  if (options.clearIndicator !== false) {
    measurementRenderer.clearSnapIndicator();
  }
}

function formatTrustedPlaneFitSummary(fit: TrustedPlaneFitResult): string {
  const status = fit.qualityStatus === "good"
    ? "良好"
    : fit.qualityStatus === "check" ? "需檢查" : "未通過";
  const issues = fit.qualityIssues.length > 0 ? ` | ${fit.qualityIssues.join("、")}` : "";
  return `${status} | ${getAppliedPlaneConstraintLabel(fit.appliedConstraint)} | ` +
    `內點 ${fit.inlierCount}/${fit.candidateCount} (${Math.round(fit.inlierRatio * 100)}%) | ` +
    `RMS ${((fit.plane.rmsMeters ?? 0) * 100).toFixed(2)} cm | ` +
    `軸向修正 ${fit.orientationAdjustmentDegrees.toFixed(2)}°${issues}`;
}

function setClearanceMeasureMode(enabled: boolean): void {
  if (enabled && measureMode) {
    setMeasureMode(false);
  }
  if (enabled && planeMeasureMode) {
    setPlaneMeasureMode(false);
  }
  if (enabled && cornerLockMode) {
    setCornerLockMode(false, { keepMeasurement: true });
  }

  clearanceMeasureMode = enabled;
  elements.measureClearance.classList.toggle("active", enabled);
  resetClearancePlaneSelection();
  if (enabled) {
    viewer.exitFirstPerson();
    setHint("共用淨高：先點選上方水平面，再點選下方水平面；鎖定後可連續點選左右位置。");
  } else {
    measurementRenderer.clearSnapIndicator();
    setHint("共用淨高已關閉");
  }
  updateModeStatus();
}

function resetClearancePlaneSelection(): void {
  clearanceUpperPick = null;
  clearanceLowerPick = null;
  clearancePlanePairId = null;
  clearanceProbeIndex = 0;
  measurementRenderer.clearClearancePlaneSelection();
}

function setCornerLockMode(enabled: boolean, options: { keepMeasurement?: boolean } = {}): void {
  if (enabled) {
    if (planeMeasureMode) {
      setPlaneMeasureMode(false);
    }
    if (clearanceMeasureMode) {
      setClearanceMeasureMode(false);
    }
    if (measurementManager.isDragging() || measurementManager.isPlaneDragging()) {
      measurementManager.cancelCurrent();
      measurementRenderer.clearPreview();
      measurementRenderer.clearSnapIndicator();
    }
    viewer.exitFirstPerson();
  }

  cornerLockMode = enabled;
  elements.lockCorner.classList.toggle("active", enabled);
  if (enabled) {
    setHint("鎖定牆角：請點模型平面的角點、邊界，或兩個模型面的交線附近。");
  } else if (!options.keepMeasurement) {
    setHint("已關閉鎖定牆角。");
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
  const clearanceRecords = measurementManager.getClearanceRecords();
  elements.records.innerHTML = "";

  if (records.length === 0 && planeRecords.length === 0 && clearanceRecords.length === 0) {
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
  for (const record of clearanceRecords) {
    elements.records.append(createClearanceRecordElement(record, clearanceRecords));
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
  const structuralUncertainty = surface.measurementMethod === "four_boundary_rectangle"
    ? ` | 寬 ±${((surface.widthUncertaintyMeters ?? 0) * 100).toFixed(2)} cm` +
      `／高 ±${((surface.heightUncertaintyMeters ?? 0) * 100).toFixed(2)} cm`
    : "";
  metrics.textContent =
    `${surface.widthMeters.toFixed(3)} m x ${surface.heightMeters.toFixed(3)} m | ` +
    `${surface.areaSquareMeters.toFixed(3)} m2${structuralUncertainty}`;

  const qa = document.createElement("div");
  qa.className = getModelQaClass(surface);
  const rms = surface.rmsMeters === undefined ? "-" : `${(surface.rmsMeters * 100).toFixed(2)} cm`;
  const ratio = surface.inlierRatio === undefined
    ? `${surface.inlierCount}/${surface.candidateCount}`
    : `${surface.inlierCount}/${surface.candidateCount} (${Math.round(surface.inlierRatio * 100)}%)`;
  const constraint = surface.planeConstraint
    ? getAppliedPlaneConstraintLabel(surface.planeConstraint)
    : "舊版局部平面";
  const issues = surface.qualityIssues && surface.qualityIssues.length > 0
    ? ` | ${surface.qualityIssues.join("、")}`
    : "";
  qa.textContent = `品質 ${getModelQaLabel(surface)} | ${constraint} | RMS ${rms} | 內點 ${ratio}${issues}`;

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
  rebuildMeasurementScene();
}

function rebuildMeasurementScene(): void {
  measurementRenderer.rebuildAll(
    measurementManager.getRecords(),
    measurementManager.getPlaneRecords(),
    measurementManager.getClearanceRecords()
  );
}

function createRecordElement(record: MeasurementRecord): HTMLElement {
  const item = document.createElement("article");
  item.className = "record";

  const title = document.createElement("div");
  title.className = "record-title";
  title.textContent = `${getDistanceModeShortLabel(record.distanceMode)} ${formatDistance(record.distanceMeters)}`;

  const details = document.createElement("div");
  details.className = "record-details";
  const sourceLabel = record.structuralBoundaryFit
    ? record.structuralBoundaryFit.dimension === "height" ? "上下邊界" : "左右邊界"
    : record.structuralHeightLocked
    ? "結構共用線"
    : record.source === "structural_planes" ? "結構平面" : "兩點";
  details.textContent = record.structuralBoundaryFit
    ? `來源 ${sourceLabel}多點擬合 | 不確定度 ±${((record.uncertaintyMeters ?? 0) * 100).toFixed(2)} cm | ` +
      `支撐點 ${record.structuralBoundaryFit.boundaries.reduce((sum, boundary) => sum + boundary.inlierCount, 0)} | ` +
      `切片 ${record.structuralBoundaryFit.boundaries.reduce((sum, boundary) => sum + boundary.sliceCount, 0)}`
    : `模式 ${getDistanceModeLabel(record.distanceMode)} | 來源 ${sourceLabel} | ` +
      `P1 ${formatVector(record.start)} (${formatSnapShort(record.startSnap)}) | ` +
      `P2 ${formatVector(record.end)} (${formatSnapShort(record.endSnap)})`;

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-record";
  deleteButton.textContent = "刪除";
  deleteButton.addEventListener("click", () => {
    measurementManager.deleteRecord(record.id);
    rebuildMeasurementScene();
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
  title.textContent =
    `${record.structuralFit ? "梁柱四邊界" : record.trustedFit ? "可信平面" : "平面"} ` +
    `${record.widthMeters.toFixed(3)} m x ${record.heightMeters.toFixed(3)} m`;

  const details = document.createElement("div");
  details.className = "record-details";
  details.textContent = record.structuralFit
    ? `四條邊界聯合矩形 | 面積 ${record.areaSquareMeters.toFixed(3)} m2 | ` +
      `寬 ±${(record.structuralFit.widthUncertaintyMeters * 100).toFixed(2)} cm | ` +
      `高 ±${(record.structuralFit.heightUncertaintyMeters * 100).toFixed(2)} cm | ` +
      `邊界支撐點 ${record.structuralFit.boundaries.reduce((sum, boundary) => sum + boundary.inlierCount, 0)} | ` +
      `主平面 RMS ${((record.trustedFit?.rmsMeters ?? 0) * 100).toFixed(2)} cm`
    : record.trustedFit
    ? `面積 ${record.areaSquareMeters.toFixed(3)} m2 | ` +
      `${getAppliedPlaneConstraintLabel(record.trustedFit.appliedConstraint)} | ` +
      `RMS ${(record.trustedFit.rmsMeters * 100).toFixed(2)} cm | ` +
      `內點 ${Math.round(record.trustedFit.inlierRatio * 100)}% | ` +
      `軸向修正 ${record.trustedFit.orientationAdjustmentDegrees.toFixed(2)}°`
    : `面積 ${record.areaSquareMeters.toFixed(3)} m2 | 起點 ${formatVector(record.start)} | 吸附 ${formatSnapShort(record.startSnap)}`;

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

function createClearanceRecordElement(
  record: ClearanceMeasurementRecord,
  allRecords: ClearanceMeasurementRecord[]
): HTMLElement {
  const item = document.createElement("article");
  item.className = "record clearance-record";
  const groupRecords = allRecords.filter((candidate) => candidate.planePairId === record.planePairId);
  const heights = groupRecords.map((candidate) => candidate.heightMeters);
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);

  const title = document.createElement("div");
  title.className = "record-title";
  title.textContent = `共用淨高 #${record.probeIndex} ${formatDistance(record.heightMeters)}`;

  const details = document.createElement("div");
  details.className = "record-details";
  const uncertainty = record.uncertaintyMeters === undefined
    ? "-"
    : `${(record.uncertaintyMeters * 100).toFixed(2)} cm`;
  details.textContent =
    `共用組 ${record.planePairId.slice(0, 8)} | 組內 ${groupRecords.length} 點 | ` +
    `範圍 ${formatDistance(minHeight)}～${formatDistance(maxHeight)} | ` +
    `差 ${(maxHeight - minHeight) * 100 < 0.005 ? "0.00" : ((maxHeight - minHeight) * 100).toFixed(2)} cm | ` +
    `平面夾角 ${record.parallelAngleDegrees.toFixed(2)}° | 合成 RMS ${uncertainty}`;

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-record";
  deleteButton.textContent = "刪除";
  deleteButton.addEventListener("click", () => {
    measurementManager.deleteClearanceRecord(record.id);
    measurementRenderer.removeRecord(record.id);
    renderRecords();
    updateModeStatus();
    setHint("共用淨高紀錄已刪除");
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
    elements.measureClearance,
    elements.lockCorner,
    elements.saveModel,
    elements.loadModel,
    elements.clearCurrent,
    elements.clearAll,
    elements.exportCsv
  ]) {
    button.disabled = isBusy || button === elements.measureClearance;
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
  if (
    !measureMode &&
    !planeMeasureMode &&
    !clearanceMeasureMode &&
    !cornerLockMode &&
    !measurementManager.isDragging() &&
    !measurementManager.isPlaneDragging()
  ) {
    setDefaultNavigationHint();
  }
}

function updateMovementModeStatus(mode: MovementMode = viewer.getMovementMode()): void {
  const activeTool = planeMeasureMode
    ? pendingStructuralPlane
      ? ` | 工具：梁柱${getStructuralDimensionLabel(getStructuralDimensionMode())}` +
        `（${structuralBoundaryFits.length}/2）`
      : ` | 工具：梁柱${getStructuralDimensionLabel(getStructuralDimensionMode())}主平面`
    : measureMode ? " | 工具：距離"
      : cornerLockMode ? " | 工具：鎖定牆角"
        : "";
  elements.modeStatus.textContent = `移動模式：${formatMovementMode(mode)}${activeTool}`;
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
    radiusMeters: Number(elements.snapRadius.value),
    preset: elements.measurementPreset.value as MeasurementPickPreset
  };
}

function getPlanePickOptions(quality: MeasurementPickOptions["quality"]): MeasurementPickOptions {
  return {
    mode: "plane",
    quality,
    radiusMeters: Number(elements.snapRadius.value),
    preset: elements.measurementPreset.value as MeasurementPickPreset
  };
}

function getCornerLockPickOptions(): MeasurementPickOptions {
  return {
    mode: "edge",
    quality: "final",
    radiusMeters: Number(elements.snapRadius.value),
    preset: elements.measurementPreset.value as MeasurementPickPreset
  };
}

type ModelSnapCandidate = {
  point: Vector3Like;
  distanceMeters: number;
  confidence: number;
  inlierCount: number;
  candidateCount: number;
  surfaceIds: string[];
  modelSnapKind: NonNullable<MeasurementPickResult["modelSnapKind"]>;
  edge: MeasurementSnapLine;
  plane?: MeasurementSnapPlane;
  secondaryPlane?: MeasurementSnapPlane;
};

type CornerLockCandidate = {
  pick: MeasurementPickResult;
  pixelDistance: number;
  priority: number;
};

type LineInterval = {
  min: number;
  max: number;
};

type SurfaceFrame = {
  origin: Vector3Like;
  u: Vector3Like;
  v: Vector3Like;
  normal: Vector3Like;
  widthMeters: number;
  heightMeters: number;
};

function pickLockedCorner(clientX: number, clientY: number): MeasurementPickResult | null {
  const pointCloudPick = measurementManager.pickPoint(clientX, clientY, getCornerLockPickOptions());
  if (pointCloudPick?.localCorner) {
    return pointCloudPick;
  }

  const modelPick = pickLockedModelCorner(clientX, clientY);
  if (modelPick) {
    return modelPick;
  }

  if (pointCloudPick?.kind === "edge" && pointCloudPick.confidence >= 0.72) {
    return pointCloudPick;
  }

  return null;
}

function pickLockedModelCorner(clientX: number, clientY: number): MeasurementPickResult | null {
  const surfaces = modelManager.getSurfaces().filter((surface) => surface.visible);
  if (surfaces.length === 0) {
    return null;
  }

  let best: CornerLockCandidate | null = null;
  for (const surface of surfaces) {
    const frame = getSurfaceFrame(surface);
    if (!frame) {
      continue;
    }

    for (const candidate of getProjectedSurfaceCornerCandidates(surface, frame, clientX, clientY, surfaces.length)) {
      best = chooseBetterCornerLock(best, candidate);
    }
    for (const candidate of getProjectedSurfaceEdgeCandidates(surface, frame, clientX, clientY, surfaces.length)) {
      best = chooseBetterCornerLock(best, candidate);
    }
  }

  for (let firstIndex = 0; firstIndex < surfaces.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < surfaces.length; secondIndex += 1) {
      const candidate = getProjectedSurfaceIntersectionCandidate(surfaces[firstIndex], surfaces[secondIndex], clientX, clientY, surfaces.length);
      best = chooseBetterCornerLock(best, candidate);
    }
  }

  return best?.pick ?? null;
}

function getProjectedSurfaceCornerCandidates(
  surface: PlaneModelSurface,
  frame: SurfaceFrame,
  clientX: number,
  clientY: number,
  visibleSurfaceCount: number
): CornerLockCandidate[] {
  const candidates: CornerLockCandidate[] = [];
  const plane = surfaceToSnapPlane(surface, frame);
  for (let index = 0; index < surface.corners.length; index += 1) {
    const point = surface.corners[index];
    const screen = viewer.projectWorldToScreen(point);
    if (!screen?.visible) {
      continue;
    }

    const pixelDistance = distance2d(clientX, clientY, screen.x, screen.y);
    if (pixelDistance > 76) {
      continue;
    }

    const direction = getSurfaceCornerDirection(surface, index);
    candidates.push({
      pick: createModelCornerPick({
        point,
        direction,
        confidence: clamp(0.88 + (1 - pixelDistance / 76) * 0.08, 0.88, 0.97),
        surfaceIds: [surface.id],
        modelSnapKind: "surface_edge",
        inlierCount: surface.inlierCount,
        candidateCount: Math.max(visibleSurfaceCount, surface.candidateCount),
        plane
      }),
      pixelDistance,
      priority: 1
    });
  }
  return candidates;
}

function getProjectedSurfaceEdgeCandidates(
  surface: PlaneModelSurface,
  frame: SurfaceFrame,
  clientX: number,
  clientY: number,
  visibleSurfaceCount: number
): CornerLockCandidate[] {
  const candidates: CornerLockCandidate[] = [];
  const plane = surfaceToSnapPlane(surface, frame);
  const edges: Array<[Vector3Like, Vector3Like]> = [
    [surface.corners[0], surface.corners[1]],
    [surface.corners[1], surface.corners[2]],
    [surface.corners[2], surface.corners[3]],
    [surface.corners[3], surface.corners[0]]
  ];

  for (const [start, end] of edges) {
    const startScreen = viewer.projectWorldToScreen(start);
    const endScreen = viewer.projectWorldToScreen(end);
    if (!startScreen?.visible || !endScreen?.visible) {
      continue;
    }

    const segment = closestScreenSegmentPoint(clientX, clientY, startScreen.x, startScreen.y, endScreen.x, endScreen.y);
    if (segment.pixelDistance > 48) {
      continue;
    }

    const edgeVector = subtract(end, start);
    const edgeLength = Math.sqrt(lengthSq(edgeVector));
    if (edgeLength < 0.01) {
      continue;
    }

    const point = add(start, scale(edgeVector, segment.t));
    const direction = scale(edgeVector, 1 / edgeLength);
    candidates.push({
      pick: createModelCornerPick({
        point,
        direction,
        confidence: clamp(0.82 + (1 - segment.pixelDistance / 48) * 0.1, 0.82, 0.94),
        surfaceIds: [surface.id],
        modelSnapKind: "surface_edge",
        inlierCount: surface.inlierCount,
        candidateCount: Math.max(visibleSurfaceCount, surface.candidateCount),
        plane
      }),
      pixelDistance: segment.pixelDistance,
      priority: 2
    });
  }

  return candidates;
}

function getProjectedSurfaceIntersectionCandidate(
  first: PlaneModelSurface,
  second: PlaneModelSurface,
  clientX: number,
  clientY: number,
  visibleSurfaceCount: number
): CornerLockCandidate | null {
  const firstFrame = getSurfaceFrame(first);
  const secondFrame = getSurfaceFrame(second);
  if (!firstFrame || !secondFrame) {
    return null;
  }

  const firstPlane = surfaceToSnapPlane(first, firstFrame);
  const secondPlane = surfaceToSnapPlane(second, secondFrame);
  const directionRaw = cross(firstPlane.normal, secondPlane.normal);
  const directionLength = Math.sqrt(lengthSq(directionRaw));
  if (directionLength < 0.28) {
    return null;
  }

  const linePoint = getPlaneIntersectionPoint(firstPlane, secondPlane);
  if (!linePoint) {
    return null;
  }

  const direction = scale(directionRaw, 1 / directionLength);
  const segment = getSurfaceIntersectionSegment(firstFrame, secondFrame, linePoint, direction, 0.035);
  if (!segment) {
    return null;
  }

  const start = add(linePoint, scale(direction, segment.min));
  const end = add(linePoint, scale(direction, segment.max));
  const startScreen = viewer.projectWorldToScreen(start);
  const endScreen = viewer.projectWorldToScreen(end);
  if (!startScreen?.visible || !endScreen?.visible) {
    return null;
  }

  const screenSegment = closestScreenSegmentPoint(clientX, clientY, startScreen.x, startScreen.y, endScreen.x, endScreen.y);
  if (screenSegment.pixelDistance > 96) {
    return null;
  }

  const point = add(start, scale(subtract(end, start), screenSegment.t));
  return {
    pick: createModelCornerPick({
      point,
      direction,
      confidence: clamp(0.91 + (1 - screenSegment.pixelDistance / 96) * 0.07, 0.91, 0.99),
      surfaceIds: [first.id, second.id],
      modelSnapKind: "surface_intersection",
      inlierCount: first.inlierCount + second.inlierCount,
      candidateCount: Math.max(visibleSurfaceCount, first.candidateCount + second.candidateCount),
      plane: firstPlane,
      secondaryPlane: secondPlane
    }),
    pixelDistance: screenSegment.pixelDistance,
    priority: 0
  };
}

function createModelCornerPick(options: {
  point: Vector3Like;
  direction: Vector3Like;
  confidence: number;
  surfaceIds: string[];
  modelSnapKind: NonNullable<MeasurementPickResult["modelSnapKind"]>;
  inlierCount: number;
  candidateCount: number;
  plane?: MeasurementSnapPlane;
  secondaryPlane?: MeasurementSnapPlane;
}): MeasurementPickResult {
  return {
    point: options.point,
    rawPoint: options.point,
    kind: "edge",
    confidence: options.confidence,
    candidateCount: Math.max(1, options.candidateCount),
    inlierCount: Math.max(1, options.inlierCount),
    analysisRadiusMeters: Number(elements.snapRadius.value),
    plane: options.plane,
    secondaryPlane: options.secondaryPlane,
    edge: {
      point: options.point,
      direction: normalize(options.direction),
      inlierCount: Math.max(1, options.inlierCount)
    },
    modelSurfaceIds: options.surfaceIds,
    modelSnapKind: options.modelSnapKind
  };
}

function chooseBetterCornerLock(current: CornerLockCandidate | null, candidate: CornerLockCandidate | null): CornerLockCandidate | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }

  const currentScore = current.pixelDistance + current.priority * 18 - current.pick.confidence * 8;
  const candidateScore = candidate.pixelDistance + candidate.priority * 18 - candidate.pick.confidence * 8;
  return candidateScore < currentScore ? candidate : current;
}

function getSurfaceCornerDirection(surface: PlaneModelSurface, cornerIndex: number): Vector3Like {
  const corner = surface.corners[cornerIndex];
  const previous = surface.corners[(cornerIndex + surface.corners.length - 1) % surface.corners.length];
  const next = surface.corners[(cornerIndex + 1) % surface.corners.length];
  const toPrevious = subtract(previous, corner);
  const toNext = subtract(next, corner);
  return lengthSq(toPrevious) > lengthSq(toNext) ? normalize(toPrevious) : normalize(toNext);
}

function getSurfaceIntersectionSegment(
  firstFrame: SurfaceFrame,
  secondFrame: SurfaceFrame,
  linePoint: Vector3Like,
  direction: Vector3Like,
  margin: number
): LineInterval | null {
  const interval: LineInterval = { min: -Infinity, max: Infinity };
  if (
    !clipLineToSurfaceFrame(interval, firstFrame, linePoint, direction, margin) ||
    !clipLineToSurfaceFrame(interval, secondFrame, linePoint, direction, margin)
  ) {
    return null;
  }

  if (!Number.isFinite(interval.min) || !Number.isFinite(interval.max) || interval.max - interval.min < 0.015) {
    return null;
  }
  return interval;
}

function clipLineToSurfaceFrame(
  interval: LineInterval,
  frame: SurfaceFrame,
  linePoint: Vector3Like,
  direction: Vector3Like,
  margin: number
): boolean {
  const delta = subtract(linePoint, frame.origin);
  return clipLinearInterval(interval, dot(delta, frame.u), dot(direction, frame.u), -margin, frame.widthMeters + margin) &&
    clipLinearInterval(interval, dot(delta, frame.v), dot(direction, frame.v), -margin, frame.heightMeters + margin);
}

function clipLinearInterval(interval: LineInterval, origin: number, slope: number, min: number, max: number): boolean {
  if (Math.abs(slope) < 1e-8) {
    return origin >= min && origin <= max;
  }

  let first = (min - origin) / slope;
  let second = (max - origin) / slope;
  if (first > second) {
    const temp = first;
    first = second;
    second = temp;
  }
  interval.min = Math.max(interval.min, first);
  interval.max = Math.min(interval.max, second);
  return interval.min <= interval.max;
}

function closestScreenSegmentPoint(
  clientX: number,
  clientY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): { t: number; pixelDistance: number } {
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSq2d = dx * dx + dy * dy;
  const t = lengthSq2d <= 0.0001 ? 0 : clamp(((clientX - startX) * dx + (clientY - startY) * dy) / lengthSq2d, 0, 1);
  const x = startX + dx * t;
  const y = startY + dy * t;
  return {
    t,
    pixelDistance: distance2d(clientX, clientY, x, y)
  };
}

function distance2d(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

function pickDistancePoint(clientX: number, clientY: number, options: MeasurementPickOptions): MeasurementPickResult | null {
  const isStructuralVertical = options.preset === "beam_column" && measurementManager.getDistanceMode() === "vertical";
  // Keep the selected smart/edge mode so a horizontal secondary plane can be
  // considered at a beam edge. Forcing plane mode here only returned the
  // dominant face, which is often the vertical side of a beam or column.
  const pick = measurementManager.pickPoint(clientX, clientY, options);
  if (!pick) {
    return null;
  }

  const featurePick = isStructuralVertical
    ? pick
    : applyDetectedCornerSnap(applyModelSurfaceSnap(pick, options), options);
  return applyAxisConstrainedSnap(featurePick, options);
}

function applyDetectedCornerSnap(pick: MeasurementPickResult, _options: MeasurementPickOptions): MeasurementPickResult {
  return pick;
}

function applyAxisConstrainedSnap(
  pick: MeasurementPickResult,
  options: MeasurementPickOptions
): MeasurementPickResult | null {
  if (measurementManager.getDistanceMode() !== "vertical") {
    return pick;
  }

  if (options.preset === "beam_column") {
    const boundaryPlane = selectHorizontalBoundaryPlane(pick, options);
    if (boundaryPlane) {
      const normalizedPick: MeasurementPickResult = {
        ...pick,
        plane: boundaryPlane,
        secondaryPlane: undefined,
        kind: "plane",
        structuralBoundary: "horizontal"
      };
      if (!measurementManager.isDragging()) {
        return normalizedPick;
      }

      const preview = measurementManager.getPreview();
      const startPlane = selectHorizontalBoundaryPlane(preview?.startSnap, options);
      if (preview && startPlane && areParallelPlanes(startPlane, boundaryPlane, 10)) {
        const lockedPoint = getVerticalLinePlaneIntersection(
          preview.start,
          boundaryPlane,
          Math.cos(THREE.MathUtils.degToRad(15))
        );
        if (lockedPoint) {
          return {
            ...normalizedPick,
            point: lockedPoint,
            confidence: Math.max(pick.confidence, 0.88)
          };
        }
      }
    }

    // Structural fitting is an accuracy enhancement, not a gate. Sparse,
    // occluded or edge-on scans may not expose two clean horizontal planes;
    // keep the user's picked height and lock X/Z to the start point instead of
    // making the endpoint disappear.
    return createVerticalFallbackPick(pick);
  }

  return createVerticalFallbackPick(pick);
}

function createVerticalFallbackPick(pick: MeasurementPickResult): MeasurementPickResult {
  const fallbackPick: MeasurementPickResult = {
    ...pick,
    structuralBoundary: undefined
  };
  if (!measurementManager.isDragging()) {
    return fallbackPick;
  }
  const preview = measurementManager.getPreview();
  if (!preview) {
    return fallbackPick;
  }

  const lockedPoint = getVerticalLockedSnapPoint(preview.start, pick);
  return {
    ...fallbackPick,
    point: lockedPoint ?? {
      x: preview.start.x,
      y: pick.point.y,
      z: preview.start.z
    },
    confidence: lockedPoint ? Math.max(pick.confidence, 0.82) : pick.confidence
  };
}

function getVerticalLockedSnapPoint(start: Vector3Like, pick: MeasurementPickResult): Vector3Like | null {
  const planePoint = getVerticalLinePlaneIntersection(start, pick.plane) ??
    getVerticalLinePlaneIntersection(start, pick.secondaryPlane);
  if (planePoint) {
    return planePoint;
  }

  if (!pick.edge) {
    return null;
  }

  const edgePoint = closestHorizontalEdgePointToVerticalAxis(
    start,
    pick.edge.point,
    pick.edge.direction,
    Math.max(0.14, pick.analysisRadiusMeters * 0.65)
  );
  return edgePoint ? { x: start.x, y: edgePoint.y, z: start.z } : null;
}

function getVerticalLinePlaneIntersection(
  start: Vector3Like,
  plane: MeasurementSnapPlane | undefined,
  minimumUpAlignment = 0.18
): Vector3Like | null {
  if (!plane || Math.abs(plane.normal.y) < minimumUpAlignment) {
    return null;
  }

  const y = -(plane.normal.x * start.x + plane.normal.z * start.z + plane.constant) / plane.normal.y;
  return Number.isFinite(y) ? { x: start.x, y, z: start.z } : null;
}

function selectHorizontalBoundaryPlane(
  pick: MeasurementPickResult | undefined,
  options: MeasurementPickOptions
): MeasurementSnapPlane | null {
  if (!pick) {
    return null;
  }

  const minimumUpAlignment = Math.cos(THREE.MathUtils.degToRad(15));
  const maxRmsMeters = Math.max(0.012, options.radiusMeters * 0.12);
  const candidates = [pick.plane, pick.secondaryPlane]
    .filter((plane): plane is MeasurementSnapPlane => Boolean(plane))
    .filter((plane) => Math.abs(plane.normal.y) >= minimumUpAlignment)
    .filter((plane) => plane.rmsMeters === undefined || plane.rmsMeters <= maxRmsMeters)
    .sort((first, second) => Math.abs(second.normal.y) - Math.abs(first.normal.y));
  return candidates[0] ?? null;
}

function areParallelPlanes(first: MeasurementSnapPlane, second: MeasurementSnapPlane, toleranceDegrees: number): boolean {
  const firstNormal = normalize(first.normal);
  const secondNormal = normalize(second.normal);
  return Math.abs(dot(firstNormal, secondNormal)) >= Math.cos(THREE.MathUtils.degToRad(toleranceDegrees));
}

function closestHorizontalEdgePointToVerticalAxis(
  start: Vector3Like,
  linePoint: Vector3Like,
  direction: Vector3Like,
  maxHorizontalDistance: number
): Vector3Like | null {
  const horizontalLengthSq = direction.x * direction.x + direction.z * direction.z;
  if (horizontalLengthSq < 0.04) {
    return null;
  }

  const t = ((start.x - linePoint.x) * direction.x + (start.z - linePoint.z) * direction.z) / horizontalLengthSq;
  const point = add(linePoint, scale(direction, t));
  if (Math.hypot(point.x - start.x, point.z - start.z) > maxHorizontalDistance) {
    return null;
  }
  return Number.isFinite(point.y) ? point : null;
}

function applyModelSurfaceSnap(pick: MeasurementPickResult, options: MeasurementPickOptions): MeasurementPickResult {
  if (options.mode !== "smart" && options.mode !== "edge") {
    return pick;
  }

  const modelSnap = findModelSurfaceSnap(pick, options);
  if (!modelSnap) {
    return pick;
  }

  if (pick.kind === "edge" && !pick.modelSnapKind && pick.confidence > modelSnap.confidence + 0.1) {
    return pick;
  }

  return {
    ...pick,
    point: modelSnap.point,
    kind: "edge",
    confidence: Math.max(pick.confidence, modelSnap.confidence),
    inlierCount: modelSnap.inlierCount,
    candidateCount: modelSnap.candidateCount,
    plane: modelSnap.plane ?? pick.plane,
    secondaryPlane: modelSnap.secondaryPlane,
    edge: modelSnap.edge,
    modelSurfaceIds: modelSnap.surfaceIds,
    modelSnapKind: modelSnap.modelSnapKind
  };
}

function findModelSurfaceSnap(pick: MeasurementPickResult, options: MeasurementPickOptions): ModelSnapCandidate | null {
  const surfaces = modelManager.getSurfaces().filter((surface) => surface.visible);
  if (surfaces.length === 0) {
    return null;
  }

  const anchor = pick.rawPoint ?? pick.point;
  const maxDistance = getModelSnapMaxDistance(options);
  let best: ModelSnapCandidate | null = null;

  for (const surface of surfaces) {
    const frame = getSurfaceFrame(surface);
    if (!frame) {
      continue;
    }
    for (const candidate of getSurfaceEdgeSnapCandidates(surface, frame, anchor, maxDistance, options)) {
      best = chooseBetterModelSnap(best, candidate);
    }
  }

  for (let firstIndex = 0; firstIndex < surfaces.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < surfaces.length; secondIndex += 1) {
      const candidate = getSurfaceIntersectionSnapCandidate(surfaces[firstIndex], surfaces[secondIndex], anchor, maxDistance, options);
      best = chooseBetterModelSnap(best, candidate);
    }
  }

  return best;
}

function getSurfaceEdgeSnapCandidates(
  surface: PlaneModelSurface,
  frame: SurfaceFrame,
  anchor: Vector3Like,
  maxDistance: number,
  options: MeasurementPickOptions
): ModelSnapCandidate[] {
  const candidates: ModelSnapCandidate[] = [];
  const corners = surface.corners;
  const edges: Array<[Vector3Like, Vector3Like]> = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]]
  ];
  const plane = surfaceToSnapPlane(surface, frame);

  for (const [start, end] of edges) {
    const edgeVector = subtract(end, start);
    const edgeLengthSq = lengthSq(edgeVector);
    if (edgeLengthSq < 0.0004) {
      continue;
    }

    const t = clamp(dot(subtract(anchor, start), edgeVector) / edgeLengthSq, 0, 1);
    const point = add(start, scale(edgeVector, t));
    const distanceMeters = distance(anchor, point);
    if (distanceMeters > maxDistance) {
      continue;
    }

    const edgeLength = Math.sqrt(edgeLengthSq);
    const direction = scale(edgeVector, 1 / edgeLength);
    const closeness = 1 - distanceMeters / Math.max(maxDistance, 0.0001);
    candidates.push({
      point,
      distanceMeters,
      confidence: clamp(0.72 + closeness * 0.2 + surface.confidence * 0.08, 0.72, 0.96),
      inlierCount: Math.max(1, surface.inlierCount),
      candidateCount: Math.max(1, surface.candidateCount),
      surfaceIds: [surface.id],
      modelSnapKind: "surface_edge",
      edge: {
        point,
        direction,
        inlierCount: surface.inlierCount
      },
      plane
    });
  }

  return candidates;
}

function getSurfaceIntersectionSnapCandidate(
  first: PlaneModelSurface,
  second: PlaneModelSurface,
  anchor: Vector3Like,
  maxDistance: number,
  options: MeasurementPickOptions
): ModelSnapCandidate | null {
  const firstFrame = getSurfaceFrame(first);
  const secondFrame = getSurfaceFrame(second);
  if (!firstFrame || !secondFrame) {
    return null;
  }

  const firstPlane = surfaceToSnapPlane(first, firstFrame);
  const secondPlane = surfaceToSnapPlane(second, secondFrame);
  const directionRaw = cross(firstPlane.normal, secondPlane.normal);
  const directionLengthSq = lengthSq(directionRaw);
  if (directionLengthSq < 0.08) {
    return null;
  }

  const direction = scale(directionRaw, 1 / Math.sqrt(directionLengthSq));
  const linePoint = getPlaneIntersectionPoint(firstPlane, secondPlane);
  if (!linePoint) {
    return null;
  }

  const point = projectPointToLine(anchor, linePoint, direction);
  const distanceMeters = distance(anchor, point);
  if (distanceMeters > maxDistance) {
    return null;
  }

  const margin = Math.max(options.radiusMeters * 0.55, 0.045);
  if (!isPointInsideSurface(firstFrame, point, margin) || !isPointInsideSurface(secondFrame, point, margin)) {
    return null;
  }

  const closeness = 1 - distanceMeters / Math.max(maxDistance, 0.0001);
  const confidence = clamp(
    0.82 + closeness * 0.12 + Math.min(first.confidence, second.confidence) * 0.06,
    0.82,
    0.98
  );

  return {
    point,
    distanceMeters,
    confidence,
    inlierCount: Math.max(1, Math.min(first.candidateCount + second.candidateCount, first.inlierCount + second.inlierCount)),
    candidateCount: Math.max(1, first.candidateCount + second.candidateCount),
    surfaceIds: [first.id, second.id],
    modelSnapKind: "surface_intersection",
    edge: {
      point,
      direction,
      inlierCount: first.inlierCount + second.inlierCount
    },
    plane: firstPlane,
    secondaryPlane: secondPlane
  };
}

function chooseBetterModelSnap(current: ModelSnapCandidate | null, candidate: ModelSnapCandidate | null): ModelSnapCandidate | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }

  const currentBias = current.modelSnapKind === "surface_intersection" ? -0.025 : 0;
  const candidateBias = candidate.modelSnapKind === "surface_intersection" ? -0.025 : 0;
  const currentScore = current.distanceMeters + currentBias - current.confidence * 0.015;
  const candidateScore = candidate.distanceMeters + candidateBias - candidate.confidence * 0.015;
  return candidateScore < currentScore ? candidate : current;
}

function getSurfaceFrame(surface: PlaneModelSurface): SurfaceFrame | null {
  const origin = surface.corners[0];
  const uVector = subtract(surface.corners[1], origin);
  const vVector = subtract(surface.corners[3], origin);
  const widthMeters = Math.sqrt(lengthSq(uVector));
  const heightMeters = Math.sqrt(lengthSq(vVector));
  if (widthMeters < 0.01 || heightMeters < 0.01) {
    return null;
  }

  const normalRaw = cross(uVector, vVector);
  const normal = lengthSq(normalRaw) >= 1e-8 ? normalize(normalRaw) : normalize(surface.normal);

  return {
    origin,
    u: scale(uVector, 1 / widthMeters),
    v: scale(vVector, 1 / heightMeters),
    normal,
    widthMeters,
    heightMeters
  };
}

function surfaceToSnapPlane(surface: PlaneModelSurface, frame: SurfaceFrame): MeasurementSnapPlane {
  const normal = normalize(surface.normal);
  const planeNormal = lengthSq(normal) >= 0.5 ? normal : frame.normal;
  return {
    normal: planeNormal,
    constant: -dot(planeNormal, frame.origin),
    inlierCount: surface.inlierCount
  };
}

function isPointInsideSurface(frame: SurfaceFrame, point: Vector3Like, margin: number): boolean {
  const delta = subtract(point, frame.origin);
  const u = dot(delta, frame.u);
  const v = dot(delta, frame.v);
  const planeDistance = Math.abs(dot(delta, frame.normal));
  return planeDistance <= margin * 1.25 &&
    u >= -margin &&
    u <= frame.widthMeters + margin &&
    v >= -margin &&
    v <= frame.heightMeters + margin;
}

function getPlaneIntersectionPoint(first: MeasurementSnapPlane, second: MeasurementSnapPlane): Vector3Like | null {
  const direction = cross(first.normal, second.normal);
  const denominator = lengthSq(direction);
  if (denominator < 1e-8) {
    return null;
  }

  return scale(
    cross(
      subtract(scale(first.normal, second.constant), scale(second.normal, first.constant)),
      direction
    ),
    1 / denominator
  );
}

function projectPointToLine(point: Vector3Like, linePoint: Vector3Like, direction: Vector3Like): Vector3Like {
  return add(linePoint, scale(direction, dot(subtract(point, linePoint), direction)));
}

function getModelSnapMaxDistance(options: MeasurementPickOptions): number {
  return Math.max(options.radiusMeters * (options.quality === "final" ? 1.35 : 1.1), 0.08);
}

function isHorizontalPlanePick(pick: MeasurementPickResult): boolean {
  if (!pick.plane || pick.kind === "nearest") {
    return false;
  }
  const normal = normalize(pick.plane.normal);
  return Math.abs(normal.y) >= Math.cos(THREE.MathUtils.degToRad(20));
}

function isValidUpperLowerOrder(
  upperPick: MeasurementPickResult,
  lowerPick: MeasurementPickResult
): boolean {
  if (!upperPick.plane || !lowerPick.plane) {
    return false;
  }
  const referenceX = (upperPick.point.x + lowerPick.point.x) * 0.5;
  const referenceZ = (upperPick.point.z + lowerPick.point.z) * 0.5;
  const upperY = getPlaneYAt(upperPick.plane, referenceX, referenceZ);
  const lowerY = getPlaneYAt(lowerPick.plane, referenceX, referenceZ);
  return upperY !== null && lowerY !== null && upperY - lowerY > 0.005;
}

function getPlaneYAt(plane: MeasurementSnapPlane, x: number, z: number): number | null {
  if (Math.abs(plane.normal.y) < 0.18) {
    return null;
  }
  const y = -(plane.normal.x * x + plane.normal.z * z + plane.constant) / plane.normal.y;
  return Number.isFinite(y) ? y : null;
}

function getPlaneParallelAngleDegrees(
  first: MeasurementSnapPlane | undefined,
  second: MeasurementSnapPlane | undefined
): number {
  if (!first || !second) {
    return 90;
  }
  const firstNormal = normalize(first.normal);
  const secondNormal = normalize(second.normal);
  const parallelDot = Math.min(1, Math.max(-1, Math.abs(dot(firstNormal, secondNormal))));
  return Math.acos(parallelDot) * 180 / Math.PI;
}

function formatPlaneRms(pick: MeasurementPickResult): string {
  const rmsMeters = pick.plane?.rmsMeters;
  return rmsMeters === undefined ? "未知" : `${(rmsMeters * 100).toFixed(2)} cm`;
}

function formatClearanceProbeHint(record: ClearanceMeasurementRecord): string {
  const groupRecords = measurementManager.getClearanceRecords()
    .filter((candidate) => candidate.planePairId === record.planePairId);
  const heights = groupRecords.map((candidate) => candidate.heightMeters);
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  return `共用淨高 #${record.probeIndex}：${formatDistance(record.heightMeters)} | ` +
    `目前 ${groupRecords.length} 點差異 ${((maxHeight - minHeight) * 100).toFixed(2)} cm。可繼續點選其他位置。`;
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
  if (surface.qualityStatus === "good") {
    return "good";
  }
  if (surface.qualityStatus === "check") {
    return "check";
  }
  if (surface.qualityStatus === "rejected") {
    return "weak";
  }
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
  if (pick.localCorner) {
    return `局部牆角 ${confidence}%`;
  }
  if (pick.detectedCorner) {
    return `結構邊界 ${confidence}%`;
  }
  if (pick.modelSnapKind === "surface_intersection") {
    return `模型交線 ${confidence}%`;
  }
  if (pick.modelSnapKind === "surface_edge") {
    return `模型邊線 ${confidence}%`;
  }
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

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.sqrt(lengthSq(subtract(a, b)));
}

function normalize(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const length = Math.sqrt(lengthSq(v));
  if (length < 0.000001) {
    return { x: 1, y: 0, z: 0 };
  }
  return scale(v, 1 / length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
}

function formatSnapShort(pick: MeasurementPickResult | undefined): string {
  if (pick?.localCorner) {
    return "局部牆角";
  }

  if (!pick) {
    return "舊版";
  }

  if (pick.detectedCorner) {
    return "結構邊界";
  }
  if (pick.modelSnapKind === "surface_intersection") {
    return "模型交線";
  }
  if (pick.modelSnapKind === "surface_edge") {
    return "模型邊線";
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

function getDistancePickFailureHint(): string {
  return "該位置沒有選到點雲；請點在可見點附近，或稍微提高射線容差。";
}

function getPlaneConstraintShortLabel(constraint: MeasurementPlaneConstraint): string {
  if (constraint === "horizontal") return "水平";
  if (constraint === "vertical") return "垂直";
  if (constraint === "free") return "自由";
  return "自動";
}

function getAppliedPlaneConstraintLabel(
  constraint: TrustedPlaneFitResult["appliedConstraint"]
): string {
  if (constraint === "horizontal") return "水平面";
  if (constraint === "vertical") return "垂直面";
  return "自由斜面";
}

function getPlaneConstraintHint(constraint: MeasurementPlaneConstraint): string {
  if (constraint === "horizontal") {
    return "水平面：法向固定為重力方向，適合樓板、梁底與平台。";
  }
  if (constraint === "vertical") {
    return "垂直面：移除法向的重力分量，適合牆面、柱面與梁正面。";
  }
  if (constraint === "free") {
    return "自由斜面：不套用建築軸向約束，只應用於確認為斜面的構件。";
  }
  return "自動：接近水平或垂直才會建立；無法判定時會拒絕並要求確認。";
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
