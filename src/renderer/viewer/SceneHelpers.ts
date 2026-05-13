import * as THREE from "three";

export function addSceneHelpers(scene: THREE.Scene): void {
  const grid = new THREE.GridHelper(20, 40, 0x536071, 0x26313d);
  grid.name = "floor-grid";
  scene.add(grid);

  const axes = new THREE.AxesHelper(1.5);
  axes.name = "world-axes";
  scene.add(axes);
}

export function computeCameraHome(box: THREE.Box3): { position: THREE.Vector3; target: THREE.Vector3 } {
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const radius = Math.max(size.length() * 0.5, 1);
  const verticalFovRadians = THREE.MathUtils.degToRad(65);
  const distance = radius / Math.sin(verticalFovRadians * 0.5);
  const direction = new THREE.Vector3(0.62, 0.42, 0.82).normalize();
  return {
    position: center.clone().addScaledVector(direction, distance),
    target: center
  };
}
