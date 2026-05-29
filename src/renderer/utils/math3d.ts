import * as THREE from "three";
import type { Vector3Like } from "../../shared/types";
import type { MeasurementDistanceMode } from "../measurement/MeasurementTypes";

export function distance3d(a: Vector3Like, b: Vector3Like): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function measurementDistance(a: Vector3Like, b: Vector3Like, mode: MeasurementDistanceMode): number {
  if (mode === "horizontal") {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
  if (mode === "vertical") {
    return Math.abs(b.y - a.y);
  }
  return distance3d(a, b);
}

export function constrainedMeasurementEnd(a: Vector3Like, b: Vector3Like, mode: MeasurementDistanceMode): Vector3Like {
  if (mode === "horizontal") {
    return { x: b.x, y: a.y, z: b.z };
  }
  if (mode === "vertical") {
    return { x: a.x, y: b.y, z: a.z };
  }
  return b;
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
