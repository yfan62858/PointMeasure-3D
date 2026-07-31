import type { PointCloudMetadata } from "../../shared/types";

export type PointCloudInfoRow = [label: string, value: string];

export function buildPointCloudInfoRows(metadata: PointCloudMetadata): PointCloudInfoRow[] {
  return [
    ["檔名", metadata.fileName],
    ["含 RGB", metadata.hasRgb ? "是" : "否"],
    ["點大小 px", metadata.pointSizePx.toFixed(1)]
  ];
}
