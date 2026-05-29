import * as THREE from "three";
import type { MeasurementPickResult } from "../../shared/PointCloudDataSource";
import { constrainedMeasurementEnd, midpoint, toThreeVector } from "../utils/math3d";
import type { MeasurementPreview, MeasurementRecord, PlaneMeasurementPreview, PlaneMeasurementRecord } from "./MeasurementTypes";

export type MeasurementRenderStyle = {
  endpointRadius: number;
  lineRadius: number;
};

type MeasurementLabelTone = "main" | "preview" | "edge";

type MeasurementLabelOptions = {
  tone?: MeasurementLabelTone;
  pointer?: boolean;
};

const FINAL_LINE_COLOR = 0x41e7ff;
const PREVIEW_LINE_COLOR = 0xffffff;
const PLANE_LINE_COLOR = 0xf8fbff;
const ENDPOINT_OUTER_COLOR = 0xf8fbff;
const START_ENDPOINT_COLOR = 0x5ffb91;
const END_ENDPOINT_COLOR = 0xfff6a0;
const ACTIVE_ENDPOINT_COLOR = 0xfff176;

export class MeasurementRenderer {
  private readonly group = new THREE.Group();
  private readonly snapGroup = new THREE.Group();
  private previewGroup: THREE.Group | null = null;
  private readonly finalGroups = new Map<string, THREE.Group>();
  private style: MeasurementRenderStyle = {
    endpointRadius: 0.018,
    lineRadius: 0.008
  };

  constructor(scene: THREE.Scene) {
    this.group.name = "measurements";
    scene.add(this.group);
    this.snapGroup.name = "measurement-snap-indicator";
    scene.add(this.snapGroup);
  }

  setStyle(style: Partial<MeasurementRenderStyle>): void {
    this.style = {
      ...this.style,
      ...style
    };
  }

  rebuildRecords(records: MeasurementRecord[]): void {
    for (const group of this.finalGroups.values()) {
      this.group.remove(group);
      this.disposeObject(group);
    }
    this.finalGroups.clear();

    for (const record of records) {
      this.addRecord(record);
    }
  }

  rebuildPlaneRecords(records: PlaneMeasurementRecord[]): void {
    for (const record of records) {
      this.addPlaneRecord(record);
    }
  }

  updatePreview(preview: MeasurementPreview): void {
    this.clearPreview();
    const previewGroup = new THREE.Group();
    previewGroup.name = "measurement-preview";

    const start = toThreeVector(preview.start);
    const displayEnd = constrainedMeasurementEnd(preview.start, preview.current, preview.distanceMode);
    const end = toThreeVector(displayEnd);
    const line = this.createMeasurementLine(start, end, PREVIEW_LINE_COLOR, this.style.lineRadius, 0.98);

    previewGroup.add(line);
    previewGroup.add(this.createEndpoint(start, START_ENDPOINT_COLOR));
    previewGroup.add(this.createEndpoint(end, ACTIVE_ENDPOINT_COLOR));

    const label = this.createTextSprite(formatMeasurementLabel(preview.distanceMeters, preview.distanceMode), { tone: "preview" });
    label.position.copy(midpoint(preview.start, displayEnd));
    label.position.y += 0.055;
    previewGroup.add(label);

    this.previewGroup = previewGroup;
    this.group.add(previewGroup);
  }

  clearPreview(): void {
    if (!this.previewGroup) {
      return;
    }

    this.group.remove(this.previewGroup);
    this.disposeObject(this.previewGroup);
    this.previewGroup = null;
  }

  updatePlanePreview(preview: PlaneMeasurementPreview): void {
    this.clearPreview();
    const previewGroup = this.createPlaneMeasurementGroup(preview, {
      fillColor: 0xffffff,
      lineColor: PREVIEW_LINE_COLOR,
      opacity: 0.055,
      renderOrder: 1005,
      name: "plane-measurement-preview"
    });
    this.previewGroup = previewGroup;
    this.group.add(previewGroup);
  }

  showSnapIndicator(result: MeasurementPickResult): void {
    this.clearSnapIndicator();
    const point = toThreeVector(result.point);
    const color = getSnapColor(result.kind);

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.012, this.style.endpointRadius * 0.72), 16, 12),
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false
      })
    );
    marker.position.copy(point);
    marker.renderOrder = 1120;
    this.snapGroup.add(marker);

    if (result.edge) {
      this.snapGroup.add(this.createSnapLine(result));
    } else if (result.plane) {
      this.snapGroup.add(this.createPlanePatch(result));
    }

    if (result.localBox) {
      const box = new THREE.Box3(toThreeVector(result.localBox.min), toThreeVector(result.localBox.max));
      const helper = new THREE.Box3Helper(box, 0x8fb3ff);
      const material = helper.material as THREE.LineBasicMaterial;
      material.depthTest = false;
      material.depthWrite = false;
      material.transparent = true;
      material.opacity = 0.28;
      helper.renderOrder = 1080;
      this.snapGroup.add(helper);
    }
  }

  clearSnapIndicator(): void {
    while (this.snapGroup.children.length > 0) {
      const child = this.snapGroup.children.pop();
      if (child) {
        this.disposeObject(child);
      }
    }
  }

  addRecord(record: MeasurementRecord): void {
    const recordGroup = new THREE.Group();
    recordGroup.name = `measurement-${record.id}`;

    const start = toThreeVector(record.start);
    const displayEnd = constrainedMeasurementEnd(record.start, record.end, record.distanceMode);
    const end = toThreeVector(displayEnd);
    const line = this.createMeasurementLine(start, end, FINAL_LINE_COLOR, this.style.lineRadius, 1);

    recordGroup.add(line);
    recordGroup.add(this.createEndpoint(start, START_ENDPOINT_COLOR));
    recordGroup.add(this.createEndpoint(end, END_ENDPOINT_COLOR));

    const label = this.createTextSprite(formatMeasurementLabel(record.distanceMeters, record.distanceMode));
    label.position.copy(midpoint(record.start, displayEnd));
    label.position.y += 0.065;
    recordGroup.add(label);

    this.finalGroups.set(record.id, recordGroup);
    this.group.add(recordGroup);
  }

  addPlaneRecord(record: PlaneMeasurementRecord): void {
    const recordGroup = this.createPlaneMeasurementGroup(record, {
      fillColor: 0xffffff,
      lineColor: PLANE_LINE_COLOR,
      opacity: 0.04,
      renderOrder: 1008,
      name: `plane-measurement-${record.id}`
    });

    this.finalGroups.set(record.id, recordGroup);
    this.group.add(recordGroup);
  }

  removeRecord(id: string): void {
    const recordGroup = this.finalGroups.get(id);
    if (!recordGroup) {
      return;
    }

    this.group.remove(recordGroup);
    this.disposeObject(recordGroup);
    this.finalGroups.delete(id);
  }

  clearAll(): void {
    this.clearPreview();
    this.clearSnapIndicator();
    for (const group of this.finalGroups.values()) {
      this.group.remove(group);
      this.disposeObject(group);
    }
    this.finalGroups.clear();
  }

  private createPlanePatch(result: MeasurementPickResult): THREE.Mesh {
    const plane = result.plane;
    if (!plane) {
      throw new Error("缺少吸附平面。");
    }

    const size = Math.max(0.05, result.analysisRadiusMeters * 1.65);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size, 1, 1),
      new THREE.MeshBasicMaterial({
        color: getSnapColor(result.kind),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.16,
        depthTest: false,
        depthWrite: false
      })
    );
    const normal = toThreeVector(plane.normal).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.position.copy(toThreeVector(result.point));
    mesh.renderOrder = 1060;
    return mesh;
  }

  private createSnapLine(result: MeasurementPickResult): THREE.Group {
    const edge = result.edge;
    if (!edge) {
      throw new Error("缺少吸附邊線。");
    }

    const center = toThreeVector(result.point);
    const direction = toThreeVector(edge.direction).normalize();
    const halfLength = Math.max(0.15, result.analysisRadiusMeters * 2.4);
    const start = center.clone().addScaledVector(direction, -halfLength);
    const end = center.clone().addScaledVector(direction, halfLength);
    return this.createMeasurementLine(start, end, getSnapColor(result.kind), this.style.lineRadius * 0.62, 0.72);
  }

  private createPlaneMeasurementGroup(
    measurement: PlaneMeasurementPreview,
    style: {
      fillColor: number;
      lineColor: number;
      opacity: number;
      renderOrder: number;
      name: string;
    }
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = style.name;
    const corners = measurement.corners.map(toThreeVector);

    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
      ...corners[0].toArray(), ...corners[1].toArray(), ...corners[2].toArray(),
      ...corners[0].toArray(), ...corners[2].toArray(), ...corners[3].toArray()
    ]), 3));
    fillGeometry.computeVertexNormals();
    const fill = new THREE.Mesh(
      fillGeometry,
      new THREE.MeshBasicMaterial({
        color: style.fillColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: style.opacity,
        depthTest: false,
        depthWrite: false
      })
    );
    fill.renderOrder = style.renderOrder;
    group.add(fill);

    for (let index = 0; index < corners.length; index += 1) {
      const start = corners[index];
      const end = corners[(index + 1) % corners.length];
      group.add(this.createMeasurementLine(start, end, style.lineColor, this.style.lineRadius * 0.72, 0.96));
    }

    for (const corner of corners) {
      group.add(this.createEndpoint(corner, START_ENDPOINT_COLOR));
    }

    const center = corners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).multiplyScalar(0.25);
    const label = this.createTextSprite(formatPlaneMeasurement(measurement));
    label.position.copy(center);
    label.position.y += 0.07;
    group.add(label);

    const widthLabel = this.createTextSprite(`寬 ${formatOverlayDistance(measurement.widthMeters)}`, { tone: "edge", pointer: false });
    widthLabel.position.copy(corners[0]).add(corners[1]).multiplyScalar(0.5);
    widthLabel.position.y += 0.055;
    group.add(widthLabel);

    const heightLabel = this.createTextSprite(`高 ${formatOverlayDistance(measurement.heightMeters)}`, { tone: "edge", pointer: false });
    heightLabel.position.copy(corners[0]).add(corners[3]).multiplyScalar(0.5);
    heightLabel.position.y += 0.055;
    group.add(heightLabel);

    return group;
  }

  private createMeasurementLine(start: THREE.Vector3, end: THREE.Vector3, color: number, radius: number, opacity: number): THREE.Group {
    const lineGroup = new THREE.Group();
    const distance = start.distanceTo(end);
    if (distance < 0.0001) {
      return lineGroup;
    }

    const curve = new THREE.LineCurve3(start, end);
    const coreRadius = THREE.MathUtils.clamp(radius, 0.0025, 0.014);
    const halo = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 1, coreRadius * 2.35, 10, false),
      new THREE.MeshBasicMaterial({
        color: 0x041017,
        transparent: true,
        opacity: 0.34,
        depthTest: false,
        depthWrite: false
      })
    );
    halo.renderOrder = 990;

    const core = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 1, coreRadius, 12, false),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false
      })
    );
    core.renderOrder = 1000;

    lineGroup.add(halo, core);
    return lineGroup;
  }

  private createEndpoint(position: THREE.Vector3, color: number): THREE.Group {
    const endpoint = new THREE.Group();
    const outerRadius = Math.max(0.009, this.style.endpointRadius);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(outerRadius * 1.28, 20, 12),
      new THREE.MeshBasicMaterial({
        color: 0x03070a,
        transparent: true,
        opacity: 0.32,
        depthTest: false,
        depthWrite: false
      })
    );
    halo.renderOrder = 1008;

    const outer = new THREE.Mesh(
      new THREE.SphereGeometry(outerRadius, 20, 14),
      new THREE.MeshBasicMaterial({
        color: ENDPOINT_OUTER_COLOR,
        depthTest: false,
        depthWrite: false
      })
    );
    outer.renderOrder = 1010;

    const inner = new THREE.Mesh(
      new THREE.SphereGeometry(outerRadius * 0.48, 16, 10),
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false
      })
    );
    inner.renderOrder = 1012;

    endpoint.position.copy(position);
    endpoint.add(halo, outer, inner);
    return endpoint;
  }

  private createTextSprite(text: string, options: MeasurementLabelOptions = {}): THREE.Sprite {
    const tone = options.tone ?? "main";
    const pointer = options.pointer ?? tone !== "edge";
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("無法建立量測標籤畫布。");
    }

    const fontSize = tone === "edge" ? 28 : 30;
    const font = `700 ${fontSize}px Segoe UI, Microsoft JhengHei, Arial, sans-serif`;
    context.font = font;
    const measuredWidth = Math.ceil(context.measureText(text).width);
    const paddingX = tone === "edge" ? 18 : 22;
    const pillHeight = tone === "edge" ? 46 : 52;
    const pointerHeight = pointer ? 9 : 0;
    const pillWidth = Math.min(456, Math.max(tone === "edge" ? 116 : 142, measuredWidth + paddingX * 2));
    canvas.width = pillWidth + 24;
    canvas.height = pillHeight + pointerHeight + 18;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";

    const x = 12;
    const y = 7;
    const centerX = canvas.width / 2;
    context.fillStyle = "rgba(0, 0, 0, 0.2)";
    this.roundRect(context, x + 1, y + 2, pillWidth, pillHeight, pillHeight / 2);
    context.fill();

    if (pointer) {
      context.beginPath();
      context.moveTo(centerX - 8, y + pillHeight - 2);
      context.lineTo(centerX, y + pillHeight + pointerHeight);
      context.lineTo(centerX + 8, y + pillHeight - 2);
      context.closePath();
      context.fillStyle = "rgba(247, 249, 246, 0.96)";
      context.fill();
      context.strokeStyle = "rgba(0, 0, 0, 0.16)";
      context.lineWidth = 2;
      context.stroke();
    }

    context.fillStyle = "rgba(247, 249, 246, 0.96)";
    this.roundRect(context, x, y, pillWidth, pillHeight, pillHeight / 2);
    context.fill();
    context.strokeStyle = "rgba(0, 0, 0, 0.18)";
    context.lineWidth = 2;
    context.stroke();

    context.fillStyle = "#17202a";
    context.fillText(text, centerX, y + pillHeight / 2 + 1);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    const scale = tone === "edge" ? 0.00175 : 0.00195;
    sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
    sprite.renderOrder = 1160;
    return sprite;
  }

  private roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh | THREE.Line | THREE.Sprite;
      if ("geometry" in mesh && mesh.geometry) {
        mesh.geometry.dispose();
      }

      if ("material" in mesh && mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const spriteMaterial = material as THREE.SpriteMaterial;
          if (spriteMaterial.map) {
            spriteMaterial.map.dispose();
          }
          material.dispose();
        }
      }
    });
  }
}

function formatSnapKind(kind: MeasurementPickResult["kind"]): string {
  if (kind === "mesh") {
    return "mesh 吸附";
  }
  if (kind === "edge") {
    return "邊線吸附";
  }
  if (kind === "plane") {
    return "平面吸附";
  }
  return "點吸附";
}

function getSnapColor(kind: MeasurementPickResult["kind"]): number {
  if (kind === "mesh") {
    return 0x57e5ff;
  }
  if (kind === "edge") {
    return 0xffd43b;
  }
  if (kind === "plane") {
    return 0x15d7ff;
  }
  return 0x6dff8e;
}

function formatPlaneMeasurement(measurement: PlaneMeasurementPreview): string {
  return `面積 ${measurement.areaSquareMeters.toFixed(3)} 平方公尺`;
}

function formatMeasurementLabel(distanceMeters: number, mode: MeasurementRecord["distanceMode"]): string {
  if (mode === "horizontal") {
    return `水平 ${formatOverlayDistance(distanceMeters)}`;
  }
  if (mode === "vertical") {
    return `垂直 ${formatOverlayDistance(distanceMeters)}`;
  }
  return `3D ${formatOverlayDistance(distanceMeters)}`;
}

function formatOverlayDistance(distanceMeters: number): string {
  const absoluteMeters = Math.abs(distanceMeters);
  if (absoluteMeters < 2) {
    return `${(distanceMeters * 100).toFixed(1)} 公分`;
  }
  return `${distanceMeters.toFixed(3)} 公尺`;
}
