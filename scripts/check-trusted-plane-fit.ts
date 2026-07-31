import assert from "node:assert/strict";
import type { Vector3Like } from "../src/shared/types";
import {
  createPlaneSupportGeometry,
  evaluateTrustedPlaneQuality,
  fitStructurallyConstrainedPlane
} from "../src/renderer/viewer/TrustedPlaneFit";

const horizontalPoints: Vector3Like[] = [];
for (let xIndex = -10; xIndex <= 10; xIndex += 1) {
  for (let zIndex = -10; zIndex <= 10; zIndex += 1) {
    const x = xIndex * 0.05;
    const z = zIndex * 0.05;
    const noise = Math.sin(xIndex * 1.7 + zIndex * 0.9) * 0.0015;
    horizontalPoints.push({ x, y: 1.5 + noise, z });
  }
}
horizontalPoints.push(
  { x: 0.1, y: 1.62, z: 0.2 },
  { x: -0.25, y: 1.36, z: -0.1 },
  { x: 0.35, y: 1.7, z: 0.3 }
);

const horizontalFit = fitStructurallyConstrainedPlane(
  horizontalPoints,
  {
    normal: { x: 0.03, y: Math.sqrt(1 - 0.03 ** 2), z: 0 },
    constant: -1.5
  },
  "auto",
  0.012
);
assert.ok(horizontalFit);
assert.equal(horizontalFit.appliedConstraint, "horizontal");
assert.ok(Math.abs(Math.abs(horizontalFit.normal.y) - 1) < 1e-9);
assert.ok(horizontalFit.rmsMeters < 0.003);

const horizontalInliers = horizontalFit.inlierIndices.map((index) => horizontalPoints[index]);
const horizontalSupport = createPlaneSupportGeometry(
  horizontalInliers,
  horizontalFit,
  horizontalFit.appliedConstraint
);
assert.ok(horizontalSupport);
assert.ok(horizontalSupport.widthMeters > 0.95);
assert.ok(horizontalSupport.heightMeters > 0.95);

const horizontalQuality = evaluateTrustedPlaneQuality({
  candidateCount: horizontalPoints.length,
  inlierCount: horizontalFit.inlierCount,
  rmsMeters: horizontalFit.rmsMeters,
  widthMeters: horizontalSupport.widthMeters,
  heightMeters: horizontalSupport.heightMeters,
  requestedConstraint: "auto",
  appliedConstraint: horizontalFit.appliedConstraint,
  orientationAdjustmentDegrees: horizontalFit.orientationAdjustmentDegrees
});
assert.equal(horizontalQuality.status, "good");

const verticalPoints: Vector3Like[] = [];
for (let yIndex = -10; yIndex <= 10; yIndex += 1) {
  for (let zIndex = -10; zIndex <= 10; zIndex += 1) {
    const y = yIndex * 0.05;
    const z = zIndex * 0.05;
    const noise = Math.cos(yIndex * 1.1 - zIndex * 0.8) * 0.0018;
    verticalPoints.push({ x: 2 + noise, y, z });
  }
}

const verticalFit = fitStructurallyConstrainedPlane(
  verticalPoints,
  {
    normal: { x: Math.sqrt(1 - 0.05 ** 2 - 0.002 ** 2), y: 0.05, z: 0.002 },
    constant: -2
  },
  "auto",
  0.012
);
assert.ok(verticalFit);
assert.equal(verticalFit.appliedConstraint, "vertical");
assert.ok(Math.abs(verticalFit.normal.y) < 1e-9);
assert.ok(verticalFit.rmsMeters < 0.003);

const slopedNormal = normalize({ x: 0.55, y: 0.62, z: 0.56 });
const slopedFit = fitStructurallyConstrainedPlane(
  horizontalPoints,
  {
    normal: slopedNormal,
    constant: -slopedNormal.y * 1.5
  },
  "auto",
  0.08
);
assert.ok(slopedFit);
assert.equal(slopedFit.appliedConstraint, "free");

const slopedQuality = evaluateTrustedPlaneQuality({
  candidateCount: horizontalPoints.length,
  inlierCount: slopedFit.inlierCount,
  rmsMeters: slopedFit.rmsMeters,
  widthMeters: 1,
  heightMeters: 1,
  requestedConstraint: "auto",
  appliedConstraint: slopedFit.appliedConstraint,
  orientationAdjustmentDegrees: slopedFit.orientationAdjustmentDegrees
});
assert.equal(slopedQuality.status, "rejected");
assert.ok(slopedQuality.issues.some((issue) => issue.includes("自由斜面")));

const sparseQuality = evaluateTrustedPlaneQuality({
  candidateCount: 20,
  inlierCount: 12,
  rmsMeters: 0.004,
  widthMeters: 0.5,
  heightMeters: 0.5,
  requestedConstraint: "vertical",
  appliedConstraint: "vertical",
  orientationAdjustmentDegrees: 1
});
assert.equal(sparseQuality.status, "rejected");

console.log(JSON.stringify({
  horizontal: {
    status: horizontalQuality.status,
    inliers: horizontalFit.inlierCount,
    rmsCentimeters: Number((horizontalFit.rmsMeters * 100).toFixed(3)),
    adjustmentDegrees: Number(horizontalFit.orientationAdjustmentDegrees.toFixed(3))
  },
  vertical: {
    inliers: verticalFit.inlierCount,
    rmsCentimeters: Number((verticalFit.rmsMeters * 100).toFixed(3)),
    adjustmentDegrees: Number(verticalFit.orientationAdjustmentDegrees.toFixed(3))
  },
  invalidAutoSlope: slopedQuality.status,
  sparse: sparseQuality.status
}, null, 2));

function normalize(vector: Vector3Like): Vector3Like {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}
