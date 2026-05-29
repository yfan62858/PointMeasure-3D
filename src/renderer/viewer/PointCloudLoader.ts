import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { parsePlyHeader as parseSharedPlyHeader } from "../../shared/PointCloudHeader";
import type { PlyHeaderInfo, PointCloudMetadata, Vector3Like } from "../../shared/types";
import { ViewerMode } from "../../shared/ViewerModeTypes";
import { PointBudgetManager } from "./PointBudgetManager";

declare global {
  interface Window {
    pointMeasure3D: import("../../shared/types").PointMeasureApi;
  }
}

export type PointCloudLoadResult = {
  geometry: THREE.BufferGeometry;
  metadata: PointCloudMetadata;
  header: PlyHeaderInfo;
  buffer: ArrayBuffer;
};

export type ReferenceMeshLoadResult = {
  geometry: THREE.BufferGeometry;
  filePath: string;
  fileName: string;
  originalVertexCount: number;
  originalFaceCount: number;
  keptVertexCount: number;
  keptFaceCount: number;
  discardedFaceCount: number;
};

export type ReferenceMeshBounds = {
  min: Vector3Like;
  max: Vector3Like;
  marginMeters?: number;
};

export class PointCloudLoader {
  private readonly plyLoader = new PLYLoader();
  private readonly pointBudgetManager = new PointBudgetManager();

  async loadPlyDirect(filePath: string): Promise<PointCloudLoadResult> {
    const payload = await window.pointMeasure3D.readPlyFile(filePath);
    const header = parsePlyHeader(payload.buffer);
    if (!header.hasPosition) {
      throw new Error("PLY 缺少 x y z 頂點座標欄位。");
    }

    const geometry = this.plyLoader.parse(payload.buffer);
    const position = geometry.getAttribute("position");
    if (!position || position.count <= 0) {
      throw new Error("PLY 已載入，但找不到有效的座標點。");
    }
    normalizeColorAttribute(geometry);

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const metadata = this.createMetadata(payload.fileName, filePath, geometry, header, payload.sizeBytes);
    return { geometry, metadata, header, buffer: payload.buffer };
  }

  async loadSample(): Promise<PointCloudLoadResult> {
    const samplePath = await window.pointMeasure3D.getSamplePlyPath();
    return this.loadPlyDirect(samplePath);
  }

  async loadMeshDirect(filePath: string, bounds: ReferenceMeshBounds): Promise<ReferenceMeshLoadResult> {
    const payload = await window.pointMeasure3D.readPlyFile(filePath);
    const rawGeometry = this.plyLoader.parse(payload.buffer);
    const headerText = getPlyHeaderText(payload.buffer);
    const originalVertexCount = getPlyElementCount(headerText, "vertex") ?? rawGeometry.getAttribute("position")?.count ?? 0;
    const originalFaceCount = getPlyElementCount(headerText, "face") ?? Math.floor((rawGeometry.index?.count ?? 0) / 3);
    normalizeColorAttribute(rawGeometry);

    const sanitized = sanitizeReferenceMeshGeometry(rawGeometry, bounds);
    rawGeometry.dispose();

    return {
      geometry: sanitized.geometry,
      filePath,
      fileName: payload.fileName,
      originalVertexCount,
      originalFaceCount,
      keptVertexCount: sanitized.keptVertexCount,
      keptFaceCount: sanitized.keptFaceCount,
      discardedFaceCount: Math.max(0, originalFaceCount - sanitized.keptFaceCount)
    };
  }

  async loadPreviewFromCache(_projectPath: string): Promise<PointCloudLoadResult> {
    throw new Error("最佳化快取預覽載入保留給下一階段實作。");
  }

  async loadTile(_tileId: string): Promise<THREE.BufferGeometry> {
    throw new Error("MVP 尚未實作 LOD 分塊載入。");
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
      currentPreset: "default",
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

function getPlyHeaderText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const marker = "end_header";
  const decoder = new TextDecoder("ascii");
  const prefix = decoder.decode(bytes.slice(0, Math.min(bytes.length, 16_384)));
  const endIndex = prefix.indexOf(marker);
  return endIndex >= 0 ? prefix.slice(0, endIndex + marker.length) : prefix;
}

function getPlyElementCount(headerText: string, elementName: string): number | null {
  const match = headerText.match(new RegExp(`element\\s+${elementName}\\s+(\\d+)`));
  return match ? Number(match[1]) : null;
}

function sanitizeReferenceMeshGeometry(
  geometry: THREE.BufferGeometry,
  bounds: ReferenceMeshBounds
): { geometry: THREE.BufferGeometry; keptVertexCount: number; keptFaceCount: number } {
  const position = geometry.getAttribute("position");
  if (!position || position.count < 3) {
    throw new Error("mesh.ply loaded, but no valid mesh vertices were found.");
  }

  const expanded = expandBounds(bounds.min, bounds.max, bounds.marginMeters ?? 0.75);
  const sourceToTarget = new Int32Array(position.count);
  sourceToTarget.fill(-1);
  const positions: number[] = [];
  const indices: number[] = [];
  const index = geometry.index;
  const faceCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const a = index ? index.getX(faceIndex * 3) : faceIndex * 3;
    const b = index ? index.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
    const c = index ? index.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;
    if (!isUsableMeshVertex(position, a, expanded) ||
        !isUsableMeshVertex(position, b, expanded) ||
        !isUsableMeshVertex(position, c, expanded) ||
        isDegenerateMeshTriangle(position, a, b, c)) {
      continue;
    }

    indices.push(
      mapMeshVertex(position, sourceToTarget, positions, a),
      mapMeshVertex(position, sourceToTarget, positions, b),
      mapMeshVertex(position, sourceToTarget, positions, c)
    );
  }

  if (indices.length < 3) {
    throw new Error("mesh.ply did not contain usable faces near the point cloud bounds.");
  }

  const cleanGeometry = new THREE.BufferGeometry();
  cleanGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  cleanGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  cleanGeometry.computeVertexNormals();
  cleanGeometry.computeBoundingBox();
  cleanGeometry.computeBoundingSphere();

  return {
    geometry: cleanGeometry,
    keptVertexCount: positions.length / 3,
    keptFaceCount: indices.length / 3
  };
}

function expandBounds(min: Vector3Like, max: Vector3Like, marginMeters: number): { min: Vector3Like; max: Vector3Like } {
  return {
    min: {
      x: min.x - marginMeters,
      y: min.y - marginMeters,
      z: min.z - marginMeters
    },
    max: {
      x: max.x + marginMeters,
      y: max.y + marginMeters,
      z: max.z + marginMeters
    }
  };
}

function isUsableMeshVertex(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  bounds: { min: Vector3Like; max: Vector3Like }
): boolean {
  const x = position.getX(index);
  const y = position.getY(index);
  const z = position.getZ(index);
  return Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(z) &&
    x >= bounds.min.x &&
    x <= bounds.max.x &&
    y >= bounds.min.y &&
    y <= bounds.max.y &&
    z >= bounds.min.z &&
    z <= bounds.max.z;
}

function mapMeshVertex(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  sourceToTarget: Int32Array,
  positions: number[],
  sourceIndex: number
): number {
  const existing = sourceToTarget[sourceIndex];
  if (existing >= 0) {
    return existing;
  }

  const targetIndex = positions.length / 3;
  positions.push(position.getX(sourceIndex), position.getY(sourceIndex), position.getZ(sourceIndex));
  sourceToTarget[sourceIndex] = targetIndex;
  return targetIndex;
}

function isDegenerateMeshTriangle(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  a: number,
  b: number,
  c: number
): boolean {
  if (a === b || b === c || a === c) {
    return true;
  }

  const ax = position.getX(a);
  const ay = position.getY(a);
  const az = position.getZ(a);
  const abx = position.getX(b) - ax;
  const aby = position.getY(b) - ay;
  const abz = position.getZ(b) - az;
  const acx = position.getX(c) - ax;
  const acy = position.getY(c) - ay;
  const acz = position.getZ(c) - az;
  const crossX = aby * acz - abz * acy;
  const crossY = abz * acx - abx * acz;
  const crossZ = abx * acy - aby * acx;
  return crossX * crossX + crossY * crossY + crossZ * crossZ < 1e-10;
}
