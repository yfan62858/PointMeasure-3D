import { refinePlaneFromPoints, type RobustPlaneFitResult } from "../src/renderer/viewer/RobustPlaneFit";
import type { Vector3Like } from "../src/shared/types";

let randomState = 0x4f1bbcdc;

function random(): number {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x1_0000_0000;
}

function noise(amplitude: number): number {
  return (random() * 2 - 1) * amplitude;
}

function createHorizontalPlane(y: number, count: number): Vector3Like[] {
  return Array.from({ length: count }, () => ({
    x: random() * 2 - 1,
    y: y + noise(0.004),
    z: random() * 2 - 1
  }));
}

function createOutliers(count: number): Vector3Like[] {
  return Array.from({ length: count }, () => ({
    x: random() * 2 - 1,
    y: random() * 1.8 - 0.2,
    z: random() * 2 - 1
  }));
}

function fit(points: Vector3Like[], approximateY: number): RobustPlaneFitResult {
  const result = refinePlaneFromPoints(
    points,
    {
      normal: { x: 0.035, y: 0.998, z: -0.05 },
      constant: -approximateY
    },
    0.014
  );
  if (!result) {
    throw new Error("Robust plane refinement returned no result.");
  }
  return result;
}

function planeYAtOrigin(plane: RobustPlaneFitResult): number {
  return -plane.constant / plane.normal.y;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const topPoints = [...createHorizontalPlane(1.25, 2_400), ...createOutliers(280)];
const bottomPoints = [...createHorizontalPlane(0.74, 2_200), ...createOutliers(260)];
const top = fit(topPoints, 1.23);
const bottom = fit(bottomPoints, 0.76);
const fullDimension = Math.abs(planeYAtOrigin(top) - planeYAtOrigin(bottom));

assert(Math.abs(fullDimension - 0.51) < 0.004, `Expected 0.510 m, received ${fullDimension.toFixed(6)} m.`);
assert(top.rmsMeters < 0.006 && bottom.rmsMeters < 0.006, "Plane RMS exceeded the synthetic noise envelope.");
assert(top.inlierCount > 2_200 && bottom.inlierCount > 2_000, "Too many valid plane points were rejected.");

const repeatedDimensions: number[] = [];
for (let station = -0.55; station <= 0.55; station += 0.11) {
  const selectWindow = (point: Vector3Like) => Math.abs(point.x - station) <= 0.38 && Math.abs(point.z) <= 0.52;
  const stationTop = fit(topPoints.filter(selectWindow), 1.23);
  const stationBottom = fit(bottomPoints.filter(selectWindow), 0.76);
  repeatedDimensions.push(Math.abs(planeYAtOrigin(stationTop) - planeYAtOrigin(stationBottom)));
}

const spread = Math.max(...repeatedDimensions) - Math.min(...repeatedDimensions);
assert(spread < 0.005, `Repeated local fits spread by ${(spread * 100).toFixed(3)} cm.`);

console.log(JSON.stringify({
  expectedMeters: 0.51,
  fittedMeters: Number(fullDimension.toFixed(6)),
  repeatedSpreadMeters: Number(spread.toFixed(6)),
  topRmsMeters: Number(top.rmsMeters.toFixed(6)),
  bottomRmsMeters: Number(bottom.rmsMeters.toFixed(6))
}, null, 2));
