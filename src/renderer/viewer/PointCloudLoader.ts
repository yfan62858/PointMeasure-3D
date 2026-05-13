import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { parsePlyHeader as parseSharedPlyHeader } from "../../shared/PointCloudHeader";
import type { PlyHeaderInfo, PointCloudMetadata, Vector3Like } from "../../shared/types";
import { ViewerMode } from "../../shared/ViewerModeTypes";
import { PointBudgetManager } from "./PointBudgetManager";

declare global {
  interface Window {
    officeMeasure: import("../../shared/types").OfficeMeasureApi;
  }
}

export type PointCloudLoadResult = {
  geometry: THREE.BufferGeometry;
  metadata: PointCloudMetadata;
  header: PlyHeaderInfo;
  buffer: ArrayBuffer;
};

export class PointCloudLoader {
  private readonly plyLoader = new PLYLoader();
  private readonly pointBudgetManager = new PointBudgetManager();

  async loadPlyDirect(filePath: string): Promise<PointCloudLoadResult> {
    const payload = await window.officeMeasure.readPlyFile(filePath);
    const header = parsePlyHeader(payload.buffer);
    if (!header.hasPosition) {
      throw new Error("PLY is missing x y z vertex properties.");
    }

    const geometry = this.plyLoader.parse(payload.buffer);
    const position = geometry.getAttribute("position");
    if (!position || position.count <= 0) {
      throw new Error("PLY loaded, but no valid position points were found.");
    }
    normalizeColorAttribute(geometry);

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const metadata = this.createMetadata(payload.fileName, filePath, geometry, header, payload.sizeBytes);
    return { geometry, metadata, header, buffer: payload.buffer };
  }

  async loadSample(): Promise<PointCloudLoadResult> {
    const samplePath = await window.officeMeasure.getSamplePlyPath();
    return this.loadPlyDirect(samplePath);
  }

  async loadPreviewFromCache(_projectPath: string): Promise<PointCloudLoadResult> {
    throw new Error("Optimized Cache Mode preview loading is reserved for the next milestone.");
  }

  async loadTile(_tileId: string): Promise<THREE.BufferGeometry> {
    throw new Error("LOD tile loading is not implemented in the MVP.");
  }

  async unloadTile(_tileId: string): Promise<void> {
    // TODO: dispose loaded tile geometries once chunked loading is implemented.
  }

  async loadLodTiles(_cameraState: unknown): Promise<THREE.BufferGeometry[]> {
    // TODO: choose LOD tiles from camera state and point budget.
    return [];
  }

  getPointBudget(): number {
    return this.pointBudgetManager.getBudget();
  }

  private createMetadata(
    fileName: string,
    filePath: string,
    geometry: THREE.BufferGeometry,
    header: PlyHeaderInfo,
    fileSizeBytes: number
  ): PointCloudMetadata {
    const position = geometry.getAttribute("position");
    const pointCount = position?.count ?? header.vertexCount;
    const boxSize = new THREE.Vector3();
    const boxMin = geometry.boundingBox?.min.clone() ?? new THREE.Vector3();
    const boxMax = geometry.boundingBox?.max.clone() ?? new THREE.Vector3();
    geometry.boundingBox?.getSize(boxSize);
    const hasRgb = geometry.hasAttribute("color") || header.hasRgb;
    const renderingMode =
      header.detectedMode === ViewerMode.GAUSSIAN_SPLAT ? "Gaussian Splat" :
        header.detectedMode === ViewerMode.POINT_CLOUD ? "Point Cloud" :
          "Unknown";
    const estimatedGeometryBytes = estimateGeometryBytes(geometry);

    return {
      fileName,
      filePath,
      pointCount,
      displayedPointCount: pointCount,
      loadedPoints: pointCount,
      totalPoints: header.vertexCount || pointCount,
      hasRgb,
      detectedMode: header.detectedMode,
      renderingMode,
      unit: "meter",
      loadingMode: renderingMode === "Gaussian Splat" ? "Gaussian Splat Mode" : this.pointBudgetManager.describeMode(pointCount),
      estimatedMemoryBytes: Math.max(estimatedGeometryBytes, fileSizeBytes),
      boundingBoxMin: vectorFromThree(boxMin),
      boundingBoxMax: vectorFromThree(boxMax),
      boundingBoxSize: vectorFromThree(boxSize),
      pointBudget: this.pointBudgetManager.getBudget(),
      pointSizePx: 2,
      currentPreset: "cloudcompare",
      header
    };
  }
}

function vectorFromThree(v: THREE.Vector3): Vector3Like {
  return { x: v.x, y: v.y, z: v.z };
}

function estimateGeometryBytes(geometry: THREE.BufferGeometry): number {
  let total = 0;
  for (const key of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(key);
    total += attribute.array.byteLength;
  }
  if (geometry.index) {
    total += geometry.index.array.byteLength;
  }
  return total;
}

export function parsePlyHeader(buffer: ArrayBuffer): PlyHeaderInfo {
  return parsePlyHeaderFromShared(buffer);
}

function normalizeColorAttribute(geometry: THREE.BufferGeometry): void {
  const color = geometry.getAttribute("color");
  if (!color) {
    return;
  }

  let requiresNormalization = false;
  for (let index = 0; index < color.count; index += 1) {
    if (color.getX(index) > 1 || color.getY(index) > 1 || color.getZ(index) > 1) {
      requiresNormalization = true;
      break;
    }
  }

  if (!requiresNormalization) {
    return;
  }

  const colors = new Float32Array(color.count * 3);
  for (let index = 0; index < color.count; index += 1) {
    colors[index * 3] = THREE.MathUtils.clamp(color.getX(index) / 255, 0, 1);
    colors[index * 3 + 1] = THREE.MathUtils.clamp(color.getY(index) / 255, 0, 1);
    colors[index * 3 + 2] = THREE.MathUtils.clamp(color.getZ(index) / 255, 0, 1);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function parsePlyHeaderFromShared(buffer: ArrayBuffer): PlyHeaderInfo {
  return parseSharedPlyHeader(buffer);
}
