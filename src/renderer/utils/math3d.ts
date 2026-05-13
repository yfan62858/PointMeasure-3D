import * as THREE from "three";
import type { Vector3Like } from "../../shared/types";

export function distance3d(a: Vector3Like, b: Vector3Like): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function midpoint(a: Vector3Like, b: Vector3Like): THREE.Vector3 {
  return new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

export function toThreeVector(v: Vector3Like): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

export function fromThreeVector(v: THREE.Vector3): Vector3Like {
  return { x: v.x, y: v.y, z: v.z };
}
