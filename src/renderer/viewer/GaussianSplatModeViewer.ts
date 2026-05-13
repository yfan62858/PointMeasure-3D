import * as THREE from "three";
import type { MeasurementDataSource } from "../../shared/PointCloudDataSource";
import type { PointCloudMetadata, Vector3Like } from "../../shared/types";
import { ViewerMode } from "../../shared/ViewerModeTypes";
import type { PointCloudModeViewer } from "./PointCloudModeViewer";

export class GaussianSplatModeViewer {
  constructor(private readonly previewViewer: PointCloudModeViewer) {}

  async loadGaussianSplatPly(_filePath: string): Promise<void> {
    throw new Error("Gaussian Splat renderer loading is planned for a later milestone.");
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
    throw new Error("initializeGaussianRenderer is reserved for GaussianSplats3D, Spark, or another compatible renderer.");
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
