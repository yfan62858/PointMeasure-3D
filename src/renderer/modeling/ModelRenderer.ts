import * as THREE from "three";
import type { PlaneModelSurface } from "../../shared/ModelTypes";
import { toThreeVector } from "../utils/math3d";

export class ModelRenderer {
  private readonly group = new THREE.Group();
  private readonly surfaceGroups = new Map<string, THREE.Group>();

  constructor(scene: THREE.Scene) {
    this.group.name = "model-surfaces";
    scene.add(this.group);
  }

  rebuild(surfaces: PlaneModelSurface[]): void {
    this.clear();
    for (const surface of surfaces) {
      this.addOrUpdate(surface);
    }
  }

  addOrUpdate(surface: PlaneModelSurface): void {
    this.remove(surface.id);
    if (!surface.visible) {
      return;
    }

    const group = new THREE.Group();
    group.name = `model-surface-${surface.id}`;
    const corners = surface.corners.map(toThreeVector);
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
      ...corners[0].toArray(), ...corners[1].toArray(), ...corners[2].toArray(),
      ...corners[0].toArray(), ...corners[2].toArray(), ...corners[3].toArray()
    ]), 3));
    fillGeometry.computeVertexNormals();

    const fill = new THREE.Mesh(
      fillGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x2dd4bf,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.24,
        depthTest: false,
        depthWrite: false
      })
    );
    fill.renderOrder = 930;
    group.add(fill);

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x9ff8e8,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false
    });
    const edgePoints = [corners[0], corners[1], corners[2], corners[3], corners[0]];
    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(edgePoints);
    const edge = new THREE.Line(edgeGeometry, edgeMaterial);
    edge.renderOrder = 940;
    group.add(edge);

    this.surfaceGroups.set(surface.id, group);
    this.group.add(group);
  }

  remove(id: string): void {
    const group = this.surfaceGroups.get(id);
    if (!group) {
      return;
    }

    this.group.remove(group);
    this.disposeObject(group);
    this.surfaceGroups.delete(id);
  }

  clear(): void {
    for (const group of this.surfaceGroups.values()) {
      this.group.remove(group);
      this.disposeObject(group);
    }
    this.surfaceGroups.clear();
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh | THREE.Line;
      if ("geometry" in mesh && mesh.geometry) {
        mesh.geometry.dispose();
      }
      if ("material" in mesh && mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          material.dispose();
        }
      }
    });
  }
}
