import assert from "node:assert/strict";
import type {
  ScreenRectangle,
  StructuralBoundarySide,
  TrustedPlaneFitResult
} from "../src/shared/PointCloudDataSource";
import type { Vector3Like } from "../src/shared/types";
import {
  fitStructuralBoundary,
  solveStructuralRectangle,
  solveStructuralSpan,
  type StructuralBoundarySample
} from "../src/renderer/viewer/StructuralRectangleFit";

const expectedWidth = 1.4;
const expectedHeight = 0.7;
const planeFit: TrustedPlaneFitResult = {
  plane: {
    normal: { x: 0, y: 0, z: 1 },
    constant: 0,
    inlierCount: 600,
    rmsMeters: 0.003,
    madMeters: 0.002
  },
  point: { x: 0, y: 0, z: 0 },
  horizontal: { x: 1, y: 0, z: 0 },
  vertical: { x: 0, y: 1, z: 0 },
  corners: [
    { x: -0.45, y: -0.22, z: 0 },
    { x: 0.45, y: -0.22, z: 0 },
    { x: 0.45, y: 0.22, z: 0 },
    { x: -0.45, y: 0.22, z: 0 }
  ],
  localBox: {
    min: { x: -0.45, y: -0.22, z: -0.01 },
    max: { x: 0.45, y: 0.22, z: 0.01 }
  },
  widthMeters: 0.9,
  heightMeters: 0.44,
  areaSquareMeters: 0.396,
  candidateCount: 650,
  inlierCount: 600,
  inlierRatio: 600 / 650,
  confidence: 0.94,
  requestedConstraint: "vertical",
  appliedConstraint: "vertical",
  orientationAdjustmentDegrees: 0.8,
  qualityStatus: "good",
  qualityIssues: [],
  inlierPreviewPoints: [],
  outlierPreviewPoints: []
};

const sides: StructuralBoundarySide[] = ["top", "bottom", "left", "right"];
const fits = sides.map((side) => {
  const fixture = createBoundaryFixture(side);
  const fit = fitStructuralBoundary(fixture.samples, planeFit, side, fixture.rectangle);
  assert.ok(fit, `${side} boundary should fit`);
  assert.notEqual(fit.qualityStatus, "rejected", `${side}: ${fit.qualityIssues.join(", ")}`);
  return fit;
});
const rectangle = solveStructuralRectangle(planeFit, fits);
assert.ok(rectangle, "rectangle should solve");
assert.notEqual(rectangle.qualityStatus, "rejected", rectangle.qualityIssues.join(", "));
assert.ok(Math.abs(rectangle.widthMeters - expectedWidth) < 0.012);
assert.ok(Math.abs(rectangle.heightMeters - expectedHeight) < 0.012);
assert.ok(Math.abs(rectangle.widthMeters - planeFit.widthMeters) > 0.3);
assert.ok(Math.abs(rectangle.heightMeters - planeFit.heightMeters) > 0.2);

const heightSpan = solveStructuralSpan(planeFit, fits, "height");
assert.ok(heightSpan);
assert.notEqual(heightSpan.qualityStatus, "rejected", heightSpan.qualityIssues.join(", "));
assert.ok(Math.abs(heightSpan.distanceMeters - expectedHeight) < 0.012);
const widthSpan = solveStructuralSpan(planeFit, fits, "width");
assert.ok(widthSpan);
assert.notEqual(widthSpan.qualityStatus, "rejected", widthSpan.qualityIssues.join(", "));
assert.ok(Math.abs(widthSpan.distanceMeters - expectedWidth) < 0.012);

const invalidBottom = {
  ...fits[1],
  offsetMeters: fits[0].offsetMeters - 0.01,
  centerOffsetMeters: Math.abs(fits[0].centerOffsetMeters)
};
const invalid = solveStructuralRectangle(planeFit, [fits[0], invalidBottom, fits[2], fits[3]]);
assert.ok(invalid);
assert.equal(invalid.qualityStatus, "rejected");

const borderClippedFixture = createBoundaryFixture("top");
const borderClipped = fitStructuralBoundary(
  borderClippedFixture.samples.map((sample) => ({ ...sample, screenY: 101 })),
  planeFit,
  "top",
  borderClippedFixture.rectangle
);
assert.ok(borderClipped);
assert.equal(borderClipped.qualityStatus, "rejected");
assert.ok(borderClipped.qualityIssues.some((issue) => issue.includes("貼近選框")));

console.log(JSON.stringify({
  roiSupportMeters: {
    width: planeFit.widthMeters,
    height: planeFit.heightMeters
  },
  recoveredStructureMeters: {
    width: Number(rectangle.widthMeters.toFixed(4)),
    height: Number(rectangle.heightMeters.toFixed(4))
  },
  independentPairMeasurementsMeters: {
    width: Number(widthSpan.distanceMeters.toFixed(4)),
    height: Number(heightSpan.distanceMeters.toFixed(4))
  },
  boundaryRmsCentimeters: Object.fromEntries(
    fits.map((fit) => [fit.side, Number((fit.rmsMeters * 100).toFixed(3))])
  ),
  missingOppositeSideRejected: true,
  roiClippedBoundaryRejected: true
}, null, 2));

function createBoundaryFixture(side: StructuralBoundarySide): {
  samples: StructuralBoundarySample[];
  rectangle: ScreenRectangle;
} {
  const horizontalBoundary = side === "top" || side === "bottom";
  const positive = side === "top" || side === "right";
  const edge = horizontalBoundary
    ? (positive ? expectedHeight / 2 : -expectedHeight / 2)
    : (positive ? expectedWidth / 2 : -expectedWidth / 2);
  const tangentMinimum = horizontalBoundary ? -expectedWidth / 2 : -expectedHeight / 2;
  const tangentMaximum = horizontalBoundary ? expectedWidth / 2 : expectedHeight / 2;
  const rectangle: ScreenRectangle = horizontalBoundary
    ? { left: 100, top: 100, right: 520, bottom: 210 }
    : { left: 100, top: 100, right: 210, bottom: 520 };
  const samples: StructuralBoundarySample[] = [];

  for (let tangentIndex = 0; tangentIndex < 17; tangentIndex += 1) {
    const tangent = tangentMinimum +
      (tangentMaximum - tangentMinimum) * tangentIndex / 16;
    for (let depthIndex = 0; depthIndex < 9; depthIndex += 1) {
      const inwardDepth = depthIndex * 0.0095;
      const boundaryNoise = Math.sin(tangentIndex * 1.13 + sides.indexOf(side)) * 0.0024;
      const target = edge + boundaryNoise - (positive ? 1 : -1) * inwardDepth;
      const noise = Math.sin(tangentIndex * 1.7 + depthIndex * 0.9) * 0.0018;
      const point = horizontalBoundary
        ? { x: tangent, y: target, z: noise }
        : { x: target, y: tangent, z: noise };
      samples.push({
        point,
        screenX: horizontalBoundary
          ? 126 + tangentIndex / 16 * 368
          : 155 + (positive ? -1 : 1) * depthIndex * 3,
        screenY: horizontalBoundary
          ? 155 + (positive ? 1 : -1) * depthIndex * 3
          : 126 + tangentIndex / 16 * 368
      });
    }

    for (let outsideIndex = 1; outsideIndex <= 3; outsideIndex += 1) {
      const outsideTarget = edge + (positive ? 1 : -1) * outsideIndex * 0.018;
      const point: Vector3Like = horizontalBoundary
        ? { x: tangent, y: outsideTarget, z: 0.075 + outsideIndex * 0.004 }
        : { x: outsideTarget, y: tangent, z: 0.075 + outsideIndex * 0.004 };
      samples.push({
        point,
        screenX: horizontalBoundary
          ? 126 + tangentIndex / 16 * 368
          : 155 + (positive ? 1 : -1) * outsideIndex * 10,
        screenY: horizontalBoundary
          ? 155 + (positive ? -1 : 1) * outsideIndex * 10
          : 126 + tangentIndex / 16 * 368
      });
    }
  }

  return { samples, rectangle };
}
