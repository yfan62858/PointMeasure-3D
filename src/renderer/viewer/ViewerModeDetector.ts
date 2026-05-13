import type { PlyHeaderDetection } from "../../shared/PointCloudHeader";
import { parsePlyHeader } from "../../shared/PointCloudHeader";
import { ViewerMode } from "../../shared/ViewerModeTypes";

export class ViewerModeDetector {
  detectFromBuffer(buffer: ArrayBuffer): PlyHeaderDetection {
    return parsePlyHeader(buffer);
  }

  isGaussianSplat(header: PlyHeaderDetection): boolean {
    return header.detectedMode === ViewerMode.GAUSSIAN_SPLAT;
  }
}
