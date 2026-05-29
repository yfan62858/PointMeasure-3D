import * as THREE from "three";
import type { MeasurementDataSource } from "../../shared/PointCloudDataSource";
import type { PointCloudMetadata, Vector3Like } from "../../shared/types";
import { ViewerMode } from "../../shared/ViewerModeTypes";
import type { PointCloudModeViewer } from "./PointCloudModeViewer";

export class GaussianSplatModeViewer {
  constructor(private readonly previewViewer: PointCloudModeViewer) {}

  async loadGaussianSplatPly(_filePath: string): Promise<void> {
    throw new Error("Gaussian Splat renderer 載入功能保留給後續階段。");
  }

  async loadGaussianSplatPreview(geometry: THREE.BufferGeometry, metadata: PointCloudMetadata): Promise<PointCloudMetadata> {
    return this.previewViewer.loadPointCloud(geometry, {
      ...metadata,
      detectedMode: ViewerMode.GAUSSIAN_SPLAT,
      renderingMode: "Gaussian Splat",
      loadingMode: "Gaussian Splat Mode"
    });
  }

  async initializeGaussianRenderer(): Promise<void> {
    throw new Error("initializeGaussianRenderer 保留給 GaussianSplats3D、Spark 或其他相容 renderer。");
  }

  disposeGaussianRenderer(): void {
    // Reserved for future non-GPL Gaussian renderer cleanup.
  }

  pickGaussianCenter(clientX: number, clientY: number): Vector3Like | null {
    return this.previewViewer.pickPoint(clientX, clientY);
  }

  getMeasurementDataSource(): MeasurementDataSource {
    return this.previewViewer;
  }
}
