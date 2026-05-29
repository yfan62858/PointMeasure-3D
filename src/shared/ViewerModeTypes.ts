export enum ViewerMode {
  POINT_CLOUD = "POINT_CLOUD",
  GAUSSIAN_SPLAT = "GAUSSIAN_SPLAT",
  UNKNOWN = "UNKNOWN"
}

export type PointRenderPreset = "stable" | "default";

export function formatViewerMode(mode: ViewerMode): string {
  switch (mode) {
    case ViewerMode.POINT_CLOUD:
      return "點雲";
    case ViewerMode.GAUSSIAN_SPLAT:
      return "Gaussian Splat";
    case ViewerMode.UNKNOWN:
    default:
      return "未知";
  }
}
