import * as THREE from "three";

export type MovementMode = "walk" | "fly";

export type CameraHome = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  near: number;
  far: number;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const MIN_DIRECTION_LENGTH_SQ = 1e-8;
const MIN_PITCH = -Math.PI / 2 + 0.01;
const MAX_PITCH = Math.PI / 2 - 0.01;

export class CameraController {
  static computeHome(box: THREE.Box3): CameraHome {
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z, 1);

    return {
      position: center.clone().add(new THREE.Vector3(radius * 0.65, radius * 0.45, radius * 0.85)),
      target: center,
      near: Math.max(0.001, radius / 10_000),
      far: Math.max(1000, radius * 100)
    };
  }

  static getYawPitch(camera: THREE.Camera): { yaw: number; pitch: number } {
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
    return {
      yaw: euler.y,
      pitch: THREE.MathUtils.clamp(euler.x, MIN_PITCH, MAX_PITCH)
    };
  }

  static applyYawPitch(camera: THREE.Camera, yaw: number, pitch: number): void {
    camera.quaternion.setFromEuler(new THREE.Euler(
      THREE.MathUtils.clamp(pitch, MIN_PITCH, MAX_PITCH),
      yaw,
      0,
      "YXZ"
    ));
    camera.updateMatrixWorld();
  }

  static getYawForward(yaw: number): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
  }

  static getYawRight(yaw: number): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();
  }

  static getMovementForward(camera: THREE.Camera, mode: MovementMode, yaw?: number): THREE.Vector3 {
    if (mode === "walk") {
      return CameraController.getYawForward(yaw ?? CameraController.getYawPitch(camera).yaw);
    }

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    return forward.normalize();
  }

  static getMovementRight(camera: THREE.Camera, mode: MovementMode, forward?: THREE.Vector3, yaw?: number): THREE.Vector3 {
    if (mode === "walk") {
      return CameraController.getYawRight(yaw ?? CameraController.getYawPitch(camera).yaw);
    }

    const horizontalForward = forward?.clone() ?? CameraController.getMovementForward(camera, mode);
    horizontalForward.y = 0;
    if (horizontalForward.lengthSq() >= MIN_DIRECTION_LENGTH_SQ) {
      return horizontalForward.normalize().cross(WORLD_UP).normalize();
    }

    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    right.y = 0;
    if (right.lengthSq() < MIN_DIRECTION_LENGTH_SQ) {
      return CameraController.getYawRight(yaw ?? CameraController.getYawPitch(camera).yaw);
    }
    return right.normalize();
  }

  static getWheelZoomDirection(camera: THREE.Camera): THREE.Vector3 {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    return direction.normalize();
  }
}
