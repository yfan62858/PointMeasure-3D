import type { PointCloudMetadata } from "../../shared/types";
import { formatViewerMode } from "../../shared/ViewerModeTypes";

export type PointCloudInfoRow = [label: string, value: string];

export function buildPointCloudInfoRows(metadata: PointCloudMetadata): PointCloudInfoRow[] {
  const header = metadata.header;
  return [
    ["file name", metadata.fileName],
    ["detected mode", formatViewerMode(metadata.detectedMode)],
    ["original point count", metadata.pointCount.toLocaleString()],
    ["displayed point count", metadata.displayedPointCount.toLocaleString()],
    ["bbox min", formatVector(metadata.boundingBoxMin)],
    ["bbox max", formatVector(metadata.boundingBoxMax)],
    ["bbox size", formatVector(metadata.boundingBoxSize)],
    ["has RGB", metadata.hasRgb ? "yes" : "no"],
    ["has opacity", header.hasOpacity ? "yes" : "no"],
    ["has scale", header.hasScale ? "yes" : "no"],
    ["has rotation", header.hasRotation ? "yes" : "no"],
    ["possible Gaussian Splat PLY", header.possibleGaussianSplatPly ? "true" : "false"],
    ["point size px", metadata.pointSizePx.toFixed(1)],
    ["current preset", metadata.currentPreset],
    ["loading mode", metadata.loadingMode],
    ["point budget", metadata.pointBudget.toLocaleString()],
    ["properties", header.properties.join(", ") || "-"]
  ];
}

function formatVector(value: { x: number; y: number; z: number }): string {
  return `${value.x.toFixed(3)}, ${value.y.toFixed(3)}, ${value.z.toFixed(3)}`;
}
