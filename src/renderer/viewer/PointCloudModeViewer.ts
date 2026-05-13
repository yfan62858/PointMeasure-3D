import * as THREE from "three";
import type { PointCloudMetadata } from "../../shared/types";
import { PointCloudViewer } from "./PointCloudViewer";

export class PointCloudModeViewer extends PointCloudViewer {
  loadStandardPointCloud(geometry: THREE.BufferGeometry, metadata: PointCloudMetadata): PointCloudMetadata {
    return this.loadPointCloud(geometry, metadata);
  }
}
