export interface Corner3D {
  x: number;
  // This project is Y-up. To keep the requested interface shape, `y` stores world Z.
  y: number;
  // This project is Y-up. To keep the requested interface shape, zMin/zMax store world Y range.
  zMin: number;
  zMax: number;
  confidence: number;
}

export type CornerDetectorProgress = {
  stage: "downsample" | "normals" | "edges" | "clusters";
  completed: number;
  total: number;
};

type Vec3 = {
  x: number;
  y: number;
  z: number;
};

type VoxelPoint = Vec3 & {
  count: number;
  normal?: Vec3;
  curvature?: number;
};

type EdgeCandidate = VoxelPoint & {
  variation: number;
  score: number;
};

type VoxelAccum = {
  x: number;
  y: number;
  z: number;
  count: number;
};

type SpatialHash = {
  cellSize: number;
  buckets: Map<string, number[]>;
};

type Bounds3D = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

type EdgeBin = {
  ix: number;
  iz: number;
  count: number;
  weight: number;
  xSum: number;
  zSum: number;
  minY: number;
  maxY: number;
  maxVariation: number;
  verticalBins: Set<number>;
};

type EdgeComponent = {
  count: number;
  weight: number;
  xSum: number;
  zSum: number;
  minY: number;
  maxY: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxVariation: number;
  verticalBins: Set<number>;
};

type NormalStats = {
  maxVariation: number;
  meanVariation: number;
  verticalNormalCount: number;
  hasTwoWallDirections: boolean;
};

type DetectorOptions = {
  voxelSize: number;
  normalK: number;
  normalRadius: number;
  edgeNeighborRadius: number;
  minNormalVariation: number;
  clusterCellSize: number;
  verticalBinSize: number;
  minVerticalSpan: number;
  minVerticalBins: number;
  minClusterVoxels: number;
  maxHorizontalFootprint: number;
  cornerClusterRadius: number;
};

const DEFAULT_OPTIONS: DetectorOptions = {
  voxelSize: 0.05,
  normalK: 20,
  normalRadius: 0.15,
  edgeNeighborRadius: 0.2,
  minNormalVariation: 0.32,
  clusterCellSize: 0.12,
  verticalBinSize: 0.12,
  minVerticalSpan: 0.45,
  minVerticalBins: 4,
  minClusterVoxels: 8,
  maxHorizontalFootprint: 0.55,
  cornerClusterRadius: 0.2
};

export class CornerDetector {
  private readonly options: DetectorOptions;
  private corners: Corner3D[] = [];

  constructor(options: Partial<DetectorOptions> = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options
    };
  }

  detect(points: Float32Array): Corner3D[] {
    const voxels = this.downsample(points);
    const corners = this.detectFromVoxels(voxels);
    this.corners = corners;
    return corners;
  }

  async detectAsync(points: Float32Array, onProgress?: (progress: CornerDetectorProgress) => void): Promise<Corner3D[]> {
    const voxels = await this.downsampleAsync(points, onProgress);
    const corners = await this.detectFromVoxelsAsync(voxels, onProgress);
    this.corners = corners;
    return corners;
  }

  setCorners(corners: Corner3D[]): void {
    this.corners = [...corners];
  }

  getCorners(): Corner3D[] {
    return [...this.corners];
  }

  snapToCorner(point: Vec3, maxDist = 0.1): Corner3D | null {
    let best: Corner3D | null = null;
    let bestDistanceSq = maxDist * maxDist;
    for (const corner of this.corners) {
      if (point.y < corner.zMin - 0.25 || point.y > corner.zMax + 0.25) {
        continue;
      }

      const dx = point.x - corner.x;
      const dz = point.z - corner.y;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq <= bestDistanceSq) {
        best = corner;
        bestDistanceSq = distanceSq;
      }
    }
    return best;
  }

  private downsample(points: Float32Array): VoxelPoint[] {
    const accum = new Map<string, VoxelAccum>();
    this.accumulatePointRange(points, 0, points.length, accum);
    return accumToVoxels(accum);
  }

  private async downsampleAsync(
    points: Float32Array,
    onProgress?: (progress: CornerDetectorProgress) => void
  ): Promise<VoxelPoint[]> {
    const accum = new Map<string, VoxelAccum>();
    const chunkValues = 1_500_000 - (1_500_000 % 3);
    for (let start = 0; start < points.length; start += chunkValues) {
      this.accumulatePointRange(points, start, Math.min(points.length, start + chunkValues), accum);
      onProgress?.({ stage: "downsample", completed: Math.min(points.length, start + chunkValues), total: points.length });
      await yieldToMain();
    }
    return accumToVoxels(accum);
  }

  private accumulatePointRange(points: Float32Array, start: number, end: number, accum: Map<string, VoxelAccum>): void {
    const invVoxelSize = 1 / this.options.voxelSize;
    const alignedStart = start - (start % 3);
    const alignedEnd = end - (end % 3);
    for (let index = alignedStart; index < alignedEnd; index += 3) {
      const x = points[index];
      const y = points[index + 1];
      const z = points[index + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        continue;
      }

      const key = gridKey(Math.floor(x * invVoxelSize), Math.floor(y * invVoxelSize), Math.floor(z * invVoxelSize));
      const current = accum.get(key);
      if (current) {
        current.x += x;
        current.y += y;
        current.z += z;
        current.count += 1;
      } else {
        accum.set(key, { x, y, z, count: 1 });
      }
    }
  }

  private detectFromVoxels(voxels: VoxelPoint[]): Corner3D[] {
    if (voxels.length < 60) {
      return [];
    }

    this.estimateNormals(voxels);
    return this.detectSharpEdges(voxels);
  }

  private async detectFromVoxelsAsync(
    voxels: VoxelPoint[],
    onProgress?: (progress: CornerDetectorProgress) => void
  ): Promise<Corner3D[]> {
    if (voxels.length < 60) {
      return [];
    }

    await this.estimateNormalsAsync(voxels, onProgress);
    onProgress?.({ stage: "edges", completed: 0, total: voxels.length });
    await yieldToMain();
    const corners = this.detectSharpEdges(voxels);
    onProgress?.({ stage: "clusters", completed: corners.length, total: corners.length });
    return corners;
  }

  private estimateNormals(voxels: VoxelPoint[]): void {
    const hash = buildSpatialHash(voxels, this.options.normalRadius);
    for (let index = 0; index < voxels.length; index += 1) {
      const estimate = estimateNormal(voxels[index], voxels, hash, this.options.normalRadius, this.options.normalK);
      voxels[index].normal = estimate?.normal;
      voxels[index].curvature = estimate?.curvature;
    }
  }

  private async estimateNormalsAsync(
    voxels: VoxelPoint[],
    onProgress?: (progress: CornerDetectorProgress) => void
  ): Promise<void> {
    const hash = buildSpatialHash(voxels, this.options.normalRadius);
    const chunkSize = 2_500;
    for (let start = 0; start < voxels.length; start += chunkSize) {
      const end = Math.min(voxels.length, start + chunkSize);
      for (let index = start; index < end; index += 1) {
        const estimate = estimateNormal(voxels[index], voxels, hash, this.options.normalRadius, this.options.normalK);
        voxels[index].normal = estimate?.normal;
        voxels[index].curvature = estimate?.curvature;
      }
      onProgress?.({ stage: "normals", completed: end, total: voxels.length });
      await yieldToMain();
    }
  }

  private detectSharpEdges(voxels: VoxelPoint[]): Corner3D[] {
    const hash = buildSpatialHash(voxels, this.options.edgeNeighborRadius);
    const candidates: EdgeCandidate[] = [];
    for (const voxel of voxels) {
      const neighbors = queryNeighbors(voxel, voxels, hash, this.options.edgeNeighborRadius, 36);
      const stats = getNormalStats(voxel, neighbors);
      if (!isSharpEdgeCandidate(voxel, stats, this.options)) {
        continue;
      }

      candidates.push({
        ...voxel,
        variation: stats.maxVariation,
        score: stats.maxVariation + stats.meanVariation + Math.min(0.25, voxel.curvature ?? 0) * 2
      });
    }

    return clusterEdgeCandidates(candidates, this.options);
  }
}

function accumToVoxels(accum: Map<string, VoxelAccum>): VoxelPoint[] {
  const voxels: VoxelPoint[] = [];
  for (const item of accum.values()) {
    voxels.push({
      x: item.x / item.count,
      y: item.y / item.count,
      z: item.z / item.count,
      count: item.count
    });
  }
  return voxels;
}

function estimateNormal(
  point: VoxelPoint,
  voxels: VoxelPoint[],
  hash: SpatialHash,
  radius: number,
  k: number
): { normal: Vec3; curvature: number } | undefined {
  const neighbors = queryNeighbors(point, voxels, hash, radius, k);
  if (neighbors.length < 6) {
    return undefined;
  }

  const covariance = computeCovariance(neighbors);
  const eigen = eigenDecompositionSymmetric(
    covariance.xx,
    covariance.xy,
    covariance.xz,
    covariance.yy,
    covariance.yz,
    covariance.zz
  );
  const sum = eigen.values[0] + eigen.values[1] + eigen.values[2];
  return {
    normal: eigen.vectors[0],
    curvature: sum > 1e-10 ? eigen.values[0] / sum : 0
  };
}

function getNormalStats(point: VoxelPoint, neighbors: VoxelPoint[]): NormalStats {
  const verticalNormals = neighbors
    .map((neighbor) => neighbor.normal)
    .filter((normal): normal is Vec3 => normal !== undefined && Math.abs(normal.y) < 0.78);

  if (!point.normal || verticalNormals.length < 6) {
    return {
      maxVariation: 0,
      meanVariation: 0,
      verticalNormalCount: verticalNormals.length,
      hasTwoWallDirections: false
    };
  }

  let maxVariation = 0;
  let variationSum = 0;
  let variationCount = 0;
  let hasTwoWallDirections = false;
  for (let i = 0; i < verticalNormals.length; i += 1) {
    const first = verticalNormals[i];
    const pointVariation = 1 - Math.abs(dot(point.normal, first));
    variationSum += pointVariation;
    variationCount += 1;
    maxVariation = Math.max(maxVariation, pointVariation);

    for (let j = i + 1; j < verticalNormals.length; j += 1) {
      const second = verticalNormals[j];
      const pairVariation = 1 - Math.abs(dot(first, second));
      maxVariation = Math.max(maxVariation, pairVariation);
      if (horizontalNormalDot(first, second) < 0.58) {
        hasTwoWallDirections = true;
      }
    }
  }

  return {
    maxVariation,
    meanVariation: variationCount > 0 ? variationSum / variationCount : 0,
    verticalNormalCount: verticalNormals.length,
    hasTwoWallDirections
  };
}

function isSharpEdgeCandidate(point: VoxelPoint, stats: NormalStats, options: DetectorOptions): boolean {
  if (stats.verticalNormalCount < 8) {
    return false;
  }
  if (!stats.hasTwoWallDirections && stats.maxVariation < options.minNormalVariation + 0.14) {
    return false;
  }
  if (stats.maxVariation < options.minNormalVariation) {
    return false;
  }

  const curvature = point.curvature ?? 0;
  return stats.hasTwoWallDirections || curvature > 0.055 || stats.meanVariation > 0.18;
}

function clusterEdgeCandidates(candidates: EdgeCandidate[], options: DetectorOptions): Corner3D[] {
  if (candidates.length === 0) {
    return [];
  }

  const bins = new Map<string, EdgeBin>();
  for (const candidate of candidates) {
    const ix = Math.floor(candidate.x / options.clusterCellSize);
    const iz = Math.floor(candidate.z / options.clusterCellSize);
    const key = gridKey2(ix, iz);
    const weight = Math.max(0.1, candidate.score) * Math.max(1, Math.min(4, candidate.count));
    const verticalBin = Math.floor(candidate.y / options.verticalBinSize);
    const bin = bins.get(key);
    if (bin) {
      bin.count += 1;
      bin.weight += weight;
      bin.xSum += candidate.x * weight;
      bin.zSum += candidate.z * weight;
      bin.minY = Math.min(bin.minY, candidate.y);
      bin.maxY = Math.max(bin.maxY, candidate.y);
      bin.maxVariation = Math.max(bin.maxVariation, candidate.variation);
      bin.verticalBins.add(verticalBin);
    } else {
      bins.set(key, {
        ix,
        iz,
        count: 1,
        weight,
        xSum: candidate.x * weight,
        zSum: candidate.z * weight,
        minY: candidate.y,
        maxY: candidate.y,
        maxVariation: candidate.variation,
        verticalBins: new Set([verticalBin])
      });
    }
  }

  const usableKeys = new Set(
    [...bins.entries()]
      .filter(([, bin]) => bin.count >= 2 && bin.verticalBins.size >= 2)
      .map(([key]) => key)
  );
  const visited = new Set<string>();
  const corners: Corner3D[] = [];
  for (const key of usableKeys) {
    if (visited.has(key)) {
      continue;
    }

    const component = collectComponent(key, bins, usableKeys, visited);
    const corner = componentToCorner(component, options);
    if (corner) {
      corners.push(corner);
    }
  }

  return clusterCorners(corners, options.cornerClusterRadius);
}

function collectComponent(
  startKey: string,
  bins: Map<string, EdgeBin>,
  usableKeys: Set<string>,
  visited: Set<string>
): EdgeComponent {
  const queue = [startKey];
  visited.add(startKey);
  const component: EdgeComponent = {
    count: 0,
    weight: 0,
    xSum: 0,
    zSum: 0,
    minY: Infinity,
    maxY: -Infinity,
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
    maxVariation: 0,
    verticalBins: new Set()
  };

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor];
    const bin = bins.get(key);
    if (!bin) {
      continue;
    }

    component.count += bin.count;
    component.weight += bin.weight;
    component.xSum += bin.xSum;
    component.zSum += bin.zSum;
    component.minY = Math.min(component.minY, bin.minY);
    component.maxY = Math.max(component.maxY, bin.maxY);
    component.minX = Math.min(component.minX, bin.ix * DEFAULT_OPTIONS.clusterCellSize);
    component.maxX = Math.max(component.maxX, (bin.ix + 1) * DEFAULT_OPTIONS.clusterCellSize);
    component.minZ = Math.min(component.minZ, bin.iz * DEFAULT_OPTIONS.clusterCellSize);
    component.maxZ = Math.max(component.maxZ, (bin.iz + 1) * DEFAULT_OPTIONS.clusterCellSize);
    component.maxVariation = Math.max(component.maxVariation, bin.maxVariation);
    for (const verticalBin of bin.verticalBins) {
      component.verticalBins.add(verticalBin);
    }

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        if (dx === 0 && dz === 0) {
          continue;
        }
        const nextKey = gridKey2(bin.ix + dx, bin.iz + dz);
        if (!usableKeys.has(nextKey) || visited.has(nextKey)) {
          continue;
        }
        visited.add(nextKey);
        queue.push(nextKey);
      }
    }
  }

  return component;
}

function componentToCorner(component: EdgeComponent, options: DetectorOptions): Corner3D | null {
  const verticalSpan = component.maxY - component.minY;
  const xSpan = component.maxX - component.minX;
  const zSpan = component.maxZ - component.minZ;
  if (component.count < options.minClusterVoxels) {
    return null;
  }
  if (verticalSpan < options.minVerticalSpan || component.verticalBins.size < options.minVerticalBins) {
    return null;
  }
  if (Math.max(xSpan, zSpan) > options.maxHorizontalFootprint) {
    return null;
  }
  if (component.weight <= 0) {
    return null;
  }

  return {
    x: component.xSum / component.weight,
    y: component.zSum / component.weight,
    zMin: component.minY,
    zMax: component.maxY,
    confidence: component.count * (1 + component.maxVariation)
  };
}

function clusterCorners(candidates: Corner3D[], radius: number): Corner3D[] {
  const radiusSq = radius * radius;
  const ordered = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const used = new Set<number>();
  const clusters: Corner3D[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    if (used.has(index)) {
      continue;
    }

    let weightSum = 0;
    let xSum = 0;
    let zSum = 0;
    let confidenceSum = 0;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let otherIndex = index; otherIndex < ordered.length; otherIndex += 1) {
      if (used.has(otherIndex)) {
        continue;
      }
      const candidate = ordered[otherIndex];
      const dx = ordered[index].x - candidate.x;
      const dz = ordered[index].y - candidate.y;
      if (dx * dx + dz * dz > radiusSq) {
        continue;
      }

      used.add(otherIndex);
      const weight = Math.max(1, candidate.confidence);
      weightSum += weight;
      xSum += candidate.x * weight;
      zSum += candidate.y * weight;
      confidenceSum += candidate.confidence;
      zMin = Math.min(zMin, candidate.zMin);
      zMax = Math.max(zMax, candidate.zMax);
    }

    if (weightSum > 0) {
      clusters.push({
        x: xSum / weightSum,
        y: zSum / weightSum,
        zMin,
        zMax,
        confidence: confidenceSum
      });
    }
  }
  return clusters;
}

function queryNeighbors(point: VoxelPoint, voxels: VoxelPoint[], hash: SpatialHash, radius: number, k: number): VoxelPoint[] {
  const radiusSq = radius * radius;
  const cx = Math.floor(point.x / hash.cellSize);
  const cy = Math.floor(point.y / hash.cellSize);
  const cz = Math.floor(point.z / hash.cellSize);
  const candidates: Array<{ point: VoxelPoint; distanceSq: number }> = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const bucket = hash.buckets.get(gridKey(cx + dx, cy + dy, cz + dz));
        if (!bucket) {
          continue;
        }
        for (const index of bucket) {
          const candidate = voxels[index];
          const distanceSq = distanceSq3(point, candidate);
          if (distanceSq <= radiusSq) {
            candidates.push({ point: candidate, distanceSq });
          }
        }
      }
    }
  }
  candidates.sort((a, b) => a.distanceSq - b.distanceSq);
  return candidates.slice(0, k).map((candidate) => candidate.point);
}

function computeCovariance(points: Vec3[]): { xx: number; xy: number; xz: number; yy: number; yz: number; zz: number } {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const point of points) {
    cx += point.x;
    cy += point.y;
    cz += point.z;
  }
  cx /= points.length;
  cy /= points.length;
  cz /= points.length;

  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const point of points) {
    const dx = point.x - cx;
    const dy = point.y - cy;
    const dz = point.z - cz;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }

  const inv = 1 / points.length;
  return {
    xx: xx * inv,
    xy: xy * inv,
    xz: xz * inv,
    yy: yy * inv,
    yz: yz * inv,
    zz: zz * inv
  };
}

function eigenDecompositionSymmetric(xx: number, xy: number, xz: number, yy: number, yz: number, zz: number): {
  values: [number, number, number];
  vectors: [Vec3, Vec3, Vec3];
} {
  const a = [
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz]
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];

  for (let sweep = 0; sweep < 8; sweep += 1) {
    jacobiRotate(a, v, 0, 1);
    jacobiRotate(a, v, 0, 2);
    jacobiRotate(a, v, 1, 2);
  }

  const eigen = [
    { value: a[0][0], vector: normalize({ x: v[0][0], y: v[1][0], z: v[2][0] }) },
    { value: a[1][1], vector: normalize({ x: v[0][1], y: v[1][1], z: v[2][1] }) },
    { value: a[2][2], vector: normalize({ x: v[0][2], y: v[1][2], z: v[2][2] }) }
  ].sort((first, second) => first.value - second.value);

  return {
    values: [Math.max(0, eigen[0].value), Math.max(0, eigen[1].value), Math.max(0, eigen[2].value)],
    vectors: [eigen[0].vector, eigen[1].vector, eigen[2].vector]
  };
}

function jacobiRotate(a: number[][], v: number[][], p: number, q: number): void {
  const apq = a[p][q];
  if (Math.abs(apq) < 1e-12) {
    return;
  }

  const app = a[p][p];
  const aqq = a[q][q];
  const tau = (aqq - app) / (2 * apq);
  const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
  const c = 1 / Math.sqrt(1 + t * t);
  const s = t * c;

  for (let index = 0; index < 3; index += 1) {
    if (index !== p && index !== q) {
      const aip = a[index][p];
      const aiq = a[index][q];
      a[index][p] = c * aip - s * aiq;
      a[p][index] = a[index][p];
      a[index][q] = s * aip + c * aiq;
      a[q][index] = a[index][q];
    }
  }

  a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
  a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
  a[p][q] = 0;
  a[q][p] = 0;

  for (let index = 0; index < 3; index += 1) {
    const vip = v[index][p];
    const viq = v[index][q];
    v[index][p] = c * vip - s * viq;
    v[index][q] = s * vip + c * viq;
  }
}

function buildSpatialHash(points: Vec3[], cellSize: number): SpatialHash {
  const buckets = new Map<string, number[]>();
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const key = gridKey(Math.floor(point.x / cellSize), Math.floor(point.y / cellSize), Math.floor(point.z / cellSize));
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      buckets.set(key, [index]);
    }
  }
  return { cellSize, buckets };
}

function gridKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function gridKey2(x: number, z: number): string {
  return `${x},${z}`;
}

function distanceSq3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function horizontalNormalDot(a: Vec3, b: Vec3): number {
  const ah = normalize({ x: a.x, y: 0, z: a.z });
  const bh = normalize({ x: b.x, y: 0, z: b.z });
  return Math.abs(dot(ah, bh));
}

function lengthSq(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

function normalize(v: Vec3): Vec3 {
  const length = Math.sqrt(lengthSq(v));
  if (length < 1e-8) {
    return { x: 0, y: 1, z: 0 };
  }
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}
