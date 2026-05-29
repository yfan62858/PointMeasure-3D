import type { PointCloudMetadata } from "../../shared/types";
import { formatViewerMode } from "../../shared/ViewerModeTypes";

export type PointCloudInfoRow = [label: string, value: string];

export function buildPointCloudInfoRows(metadata: PointCloudMetadata): PointCloudInfoRow[] {
  const header = metadata.header;
  return [
    ["檔名", metadata.fileName],
    ["偵測模式", formatViewerMode(metadata.detectedMode)],
    ["原始點數", metadata.pointCount.toLocaleString()],
    ["顯示點數", metadata.displayedPointCount.toLocaleString()],
    ["邊界最小值", formatVector(metadata.boundingBoxMin)],
    ["邊界最大值", formatVector(metadata.boundingBoxMax)],
    ["邊界尺寸", formatVector(metadata.boundingBoxSize)],
    ["含 RGB", metadata.hasRgb ? "是" : "否"],
    ["含透明度", header.hasOpacity ? "是" : "否"],
    ["含縮放", header.hasScale ? "是" : "否"],
    ["含旋轉", header.hasRotation ? "是" : "否"],
    ["可能為 Gaussian Splat", header.possibleGaussianSplatPly ? "是" : "否"],
    ["點大小 px", metadata.pointSizePx.toFixed(1)],
    ["目前顯示模式", formatPreset(metadata.currentPreset)],
    ["載入模式", formatLoadingMode(metadata.loadingMode)],
    ["點數上限", metadata.pointBudget.toLocaleString()],
    ["欄位", header.properties.join(", ") || "-"]
  ];
}

function formatVector(value: { x: number; y: number; z: number }): string {
  return `${value.x.toFixed(3)}, ${value.y.toFixed(3)}, ${value.z.toFixed(3)}`;
}

function formatPreset(value: string): string {
  if (value === "stable") {
    return "穩定點";
  }
  if (value === "default") {
    return "預設點雲";
  }
  return value;
}

function formatLoadingMode(value: string): string {
  if (value === "Direct PLY Mode") {
    return "直接 PLY 載入";
  }
  if (value === "Preview Cache Mode") {
    return "預覽快取模式";
  }
  if (value === "Gaussian Splat Mode") {
    return "Gaussian Splat 模式";
  }
  if (value === "LOD Tile Mode") {
    return "LOD 分塊模式";
  }
  return value;
}
