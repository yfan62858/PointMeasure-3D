import * as THREE from "three";

type RoomPlanSurface = {
  category?: Record<string, unknown>;
  dimensions?: unknown;
  transform?: unknown;
  polygonCorners?: unknown;
};

type RoomPlanData = {
  floors?: unknown;
  walls?: unknown;
  windows?: unknown;
  doors?: unknown;
  openings?: unknown;
  objects?: unknown;
  referenceOriginTransform?: unknown;
};

const WALL_COLOR = 0x43a2ff;
const WINDOW_COLOR = 0x57e5ff;
const DOOR_COLOR = 0x5ef0a3;
const OPENING_COLOR = 0xffd166;
const OBJECT_COLOR = 0xff9f4a;
const FLOOR_COLOR = 0x7ccf90;

export function createRoomPlanOverlay(data: RoomPlanData): THREE.Group {
  const group = new THREE.Group();
  group.name = "roomplan-overlay";
  const wallAlignmentBox = new THREE.Box3();
  const referenceMatrix = matrixFromRoomPlan(data.referenceOriginTransform);

  for (const floor of asRoomPlanItems(data.floors)) {
    addFloorOverlay(group, floor, referenceMatrix);
  }

  for (const wall of asRoomPlanItems(data.walls)) {
    const points = addRectSurfaceOverlay(group, wall, referenceMatrix, WALL_COLOR, 0.012, "roomplan-wall");
    for (const point of points) {
      wallAlignmentBox.expandByPoint(point);
    }
  }

  for (const window of asRoomPlanItems(data.windows)) {
    addRectSurfaceOverlay(group, window, referenceMatrix, WINDOW_COLOR, 0.025, "roomplan-window");
  }

  for (const door of asRoomPlanItems(data.doors)) {
    addRectSurfaceOverlay(group, door, referenceMatrix, DOOR_COLOR, 0.03, "roomplan-door");
  }

  for (const opening of asRoomPlanItems(data.openings)) {
    addRectSurfaceOverlay(group, opening, referenceMatrix, OPENING_COLOR, 0.035, "roomplan-opening");
  }

  for (const object of asRoomPlanItems(data.objects)) {
    addObjectOverlay(group, object, referenceMatrix);
  }

  if (!wallAlignmentBox.isEmpty()) {
    group.userData.alignmentBox = wallAlignmentBox;
  }

  return group;
}

export function disposeRoomPlanOverlay(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.LineSegments || child instanceof THREE.LineLoop || child instanceof THREE.Mesh) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

function addFloorOverlay(group: THREE.Group, item: RoomPlanSurface, referenceMatrix: THREE.Matrix4 | null): void {
  const matrix = matrixFromRoomPlan(item.transform, referenceMatrix);
  const corners = asPolygonCorners(item.polygonCorners);
  if (!matrix || corners.length < 3) {
    return;
  }

  const points = corners.map((corner) => new THREE.Vector3(corner[0], corner[1], corner[2]).applyMatrix4(matrix));
  const line = createLineLoop(points, FLOOR_COLOR, "roomplan-floor");
  group.add(line);

  const triangles = THREE.ShapeUtils.triangulateShape(points.map((point) => new THREE.Vector2(point.x, point.z)), []);
  if (triangles.length === 0) {
    return;
  }

  const positions: number[] = [];
  for (const triangle of triangles) {
    for (const index of triangle) {
      const point = points[index];
      positions.push(point.x, point.y + 0.01, point.z);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.MeshBasicMaterial({
    color: FLOOR_COLOR,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "roomplan-floor-fill";
  group.add(mesh);
}

function addRectSurfaceOverlay(
  group: THREE.Group,
  item: RoomPlanSurface,
  referenceMatrix: THREE.Matrix4 | null,
  color: number,
  normalOffset: number,
  name: string
): THREE.Vector3[] {
  const dimensions = asNumberArray(item.dimensions);
  const matrix = matrixFromRoomPlan(item.transform, referenceMatrix);
  if (!matrix || dimensions.length < 2) {
    return [];
  }

  const width = dimensions[0];
  const height = dimensions[1];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return [];
  }

  const localPoints = [
    new THREE.Vector3(-width / 2, -height / 2, normalOffset),
    new THREE.Vector3(width / 2, -height / 2, normalOffset),
    new THREE.Vector3(width / 2, height / 2, normalOffset),
    new THREE.Vector3(-width / 2, height / 2, normalOffset)
  ];
  const points = localPoints.map((point) => point.applyMatrix4(matrix));

  group.add(createLineLoop(points, color, name));

  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    ...points[0].toArray(), ...points[1].toArray(), ...points[2].toArray(),
    ...points[0].toArray(), ...points[2].toArray(), ...points[3].toArray()
  ], 3));
  const fillMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: name === "roomplan-wall" ? 0.055 : 0.12,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const fill = new THREE.Mesh(fillGeometry, fillMaterial);
  fill.name = `${name}-fill`;
  group.add(fill);
  return points;
}

function addObjectOverlay(group: THREE.Group, item: RoomPlanSurface, referenceMatrix: THREE.Matrix4 | null): void {
  const dimensions = asNumberArray(item.dimensions);
  const matrix = matrixFromRoomPlan(item.transform, referenceMatrix);
  if (!matrix || dimensions.length < 3) {
    return;
  }

  const [width, height, depth] = dimensions;
  if ([width, height, depth].some((value) => !Number.isFinite(value) || value <= 0)) {
    return;
  }

  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.applyMatrix4(matrix);
  const edges = new THREE.EdgesGeometry(geometry);
  geometry.dispose();

  const line = new THREE.LineSegments(edges, createLineMaterial(OBJECT_COLOR));
  line.name = `roomplan-object-${getCategoryName(item.category)}`;
  group.add(line);
}

function createLineLoop(points: THREE.Vector3[], color: number, name: string): THREE.LineLoop {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.LineLoop(geometry, createLineMaterial(color));
  line.name = name;
  return line;
}

function createLineMaterial(color: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    depthTest: true,
    depthWrite: false
  });
}

function matrixFromRoomPlan(value: unknown, referenceMatrix: THREE.Matrix4 | null = null): THREE.Matrix4 | null {
  const elements = asNumberArray(value);
  if (elements.length !== 16) {
    return null;
  }

  const matrix = new THREE.Matrix4().fromArray(elements);
  return referenceMatrix ? referenceMatrix.clone().multiply(matrix) : matrix;
}

function asRoomPlanItems(value: unknown): RoomPlanSurface[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is RoomPlanSurface => Boolean(item) && typeof item === "object");
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is number => typeof item === "number");
}

function asPolygonCorners(value: unknown): Array<[number, number, number]> {
  if (!Array.isArray(value)) {
    return [];
  }

  const corners: Array<[number, number, number]> = [];
  for (const item of value) {
    const numbers = asNumberArray(item);
    if (numbers.length >= 3) {
      corners.push([numbers[0], numbers[1], numbers[2]]);
    }
  }
  return corners;
}

function getCategoryName(category: unknown): string {
  if (!category || typeof category !== "object") {
    return "unknown";
  }

  return Object.keys(category)[0] ?? "unknown";
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    item.dispose();
  }
}
