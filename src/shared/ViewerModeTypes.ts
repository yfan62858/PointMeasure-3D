export enum ViewerMode {
  POINT_CLOUD = "POINT_CLOUD",
  GAUSSIAN_SPLAT = "GAUSSIAN_SPLAT",
  UNKNOWN = "UNKNOWN"
}

export type PointRenderPreset = "stable" | "cloudcompare";

export function formatViewerMode(mode: ViewerMode): string {
  switch (mode) {
    case ViewerMode.POINT_CLOUD:
      return "Point Cloud";
    case ViewerMode.GAUSSIAN_SPLAT:
      return "Gaussian Splat";
    case ViewerMode.UNKNOWN:
    default:
      return "Unknown";
  }
}
