import * as THREE from "three";
import type { MeasurementPickResult } from "../../shared/PointCloudDataSource";
import { formatDistance } from "../utils/format";
import { midpoint, toThreeVector } from "../utils/math3d";
import type { MeasurementPreview, MeasurementRecord, PlaneMeasurementPreview, PlaneMeasurementRecord } from "./MeasurementTypes";

export type MeasurementRenderStyle = {
  endpointRadius: number;
  lineRadius: number;
};

export class MeasurementRenderer {
  private readonly group = new THREE.Group();
  private readonly snapGroup = new THREE.Group();
  private previewGroup: THREE.Group | null = null;
  private readonly finalGroups = new Map<string, THREE.Group>();
  private style: MeasurementRenderStyle = {
    endpointRadius: 0.025,
    lineRadius: 0.018
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
    const end = toThreeVector(preview.current);
    const line = this.createMeasurementLine(start, end, 0xffd43b, this.style.lineRadius * 0.8, 0.98);

    previewGroup.add(line);
    previewGroup.add(this.createEndpoint(start, 0xfff3a3));
    previewGroup.add(this.createEndpoint(end, 0xff9f1c));

    const labelText = preview.currentSnap
      ? `${formatDistance(preview.distanceMeters)} | ${formatSnapKind(preview.currentSnap.kind)}`
      : formatDistance(preview.distanceMeters);
    const label = this.createTextSprite(labelText, "#ffe066", "rgba(22, 18, 8, 0.82)");
    label.position.copy(midpoint(preview.start, preview.current));
    label.position.y += 0.08;
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
      fillColor: 0xffd43b,
      lineColor: 0xffd43b,
      labelColor: "#fff6bf",
      labelBackground: "rgba(28, 22, 5, 0.84)",
      opacity: 0.18,
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
    const end = toThreeVector(record.end);
    const line = this.createMeasurementLine(start, end, 0x15d7ff, this.style.lineRadius, 1);

    recordGroup.add(line);
    recordGroup.add(this.createEndpoint(start, 0x6dff8e));
    recordGroup.add(this.createEndpoint(end, 0xff5d48));

    const label = this.createTextSprite(formatDistance(record.distanceMeters), "#f3fbff", "rgba(4, 19, 32, 0.86)");
    label.position.copy(midpoint(record.start, record.end));
    label.position.y += 0.1;
    recordGroup.add(label);

    this.finalGroups.set(record.id, recordGroup);
    this.group.add(recordGroup);
  }

  addPlaneRecord(record: PlaneMeasurementRecord): void {
    const recordGroup = this.createPlaneMeasurementGroup(record, {
      fillColor: 0x12c2ff,
      lineColor: 0x15d7ff,
      labelColor: "#f3fbff",
      labelBackground: "rgba(4, 19, 32, 0.88)",
      opacity: 0.2,
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
      throw new Error("Missing snap plane.");
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
      throw new Error("Missing snap edge.");
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
      labelColor: string;
      labelBackground: string;
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
      group.add(this.createEndpoint(corner, style.lineColor));
    }

    const center = corners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).multiplyScalar(0.25);
    const label = this.createTextSprite(formatPlaneMeasurement(measurement), style.labelColor, style.labelBackground);
    label.position.copy(center);
    label.position.y += 0.08;
    group.add(label);

    const widthLabel = this.createTextSprite(`${measurement.widthMeters.toFixed(3)} m`, "#ffffff", "rgba(9, 24, 36, 0.74)");
    widthLabel.position.copy(corners[0]).add(corners[1]).multiplyScalar(0.5);
    widthLabel.position.y += 0.055;
    widthLabel.scale.set(0.72, 0.18, 1);
    group.add(widthLabel);

    const heightLabel = this.createTextSprite(`${measurement.heightMeters.toFixed(3)} m`, "#ffffff", "rgba(9, 24, 36, 0.74)");
    heightLabel.position.copy(corners[0]).add(corners[3]).multiplyScalar(0.5);
    heightLabel.position.y += 0.055;
    heightLabel.scale.set(0.72, 0.18, 1);
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
    const halo = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 1, radius * 2.35, 10, false),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.22,
        depthTest: false,
        depthWrite: false
      })
    );
    halo.renderOrder = 990;

    const core = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 1, radius, 12, false),
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

  private createEndpoint(position: THREE.Vector3, color: number): THREE.Mesh {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(this.style.endpointRadius, 16, 12),
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false
      })
    );
    marker.position.copy(position);
    marker.renderOrder = 1010;
    return marker;
  }

  private createTextSprite(text: string, color: string, background: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to create label canvas context");
    }

    canvas.width = 512;
    canvas.height = 128;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = background;
    this.roundRect(context, 12, 28, 488, 72, 16);
    context.fill();
    context.font = text.length > 22 ? "600 28px Segoe UI, Arial, sans-serif" : "600 34px Segoe UI, Arial, sans-serif";
    context.fillStyle = color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(1.35, 0.34, 1);
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
  if (kind === "edge") {
    return "edge snap";
  }
  if (kind === "plane") {
    return "plane snap";
  }
  return "point snap";
}

function getSnapColor(kind: MeasurementPickResult["kind"]): number {
  if (kind === "edge") {
    return 0xffd43b;
  }
  if (kind === "plane") {
    return 0x15d7ff;
  }
  return 0x6dff8e;
}

function formatPlaneMeasurement(measurement: PlaneMeasurementPreview): string {
  return `W ${measurement.widthMeters.toFixed(3)} m | H ${measurement.heightMeters.toFixed(3)} m | A ${measurement.areaSquareMeters.toFixed(3)} m2`;
}
