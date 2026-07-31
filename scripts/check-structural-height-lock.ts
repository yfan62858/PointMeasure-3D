import assert from "node:assert/strict";
import type { MeasurementPickResult } from "../src/shared/PointCloudDataSource";
import { MeasurementManager } from "../src/renderer/measurement/MeasurementManager";

function createPick(x: number, y: number, z: number, structural = true): MeasurementPickResult {
  return {
    point: { x, y, z },
    rawPoint: { x, y, z },
    kind: structural ? "plane" : "nearest",
    confidence: structural ? 0.92 : 0.45,
    candidateCount: structural ? 240 : 1,
    inlierCount: structural ? 190 : 1,
    analysisRadiusMeters: 0.12,
    plane: structural ? {
      normal: { x: 0, y: 1, z: 0 },
      constant: -y,
      inlierCount: 190,
      rmsMeters: 0.002,
      madMeters: 0.0015
    } : undefined,
    structuralBoundary: structural ? "horizontal" : undefined
  };
}

function measure(
  manager: MeasurementManager,
  x: number,
  lowerY: number,
  upperY: number,
  structural = true
) {
  manager.beginDrag(createPick(x, lowerY, 0, structural));
  const record = manager.finishDrag(createPick(x, upperY, 0, structural));
  assert.ok(record, "measurement should be created");
  return record;
}

const manager = new MeasurementManager();
manager.setMeasurementPreset("beam_column");
manager.setDistanceMode("vertical");

const first = measure(manager, 0, 1.000, 1.671);
const second = measure(manager, 0.5, 1.003, 1.667);
const third = measure(manager, 1.0, 0.998, 1.672);
const fallback = measure(manager, 1.2, 1.010, 1.680, false);

const sameRectangle = manager.getRecords().slice(0, 4);
assert.deepEqual(
  sameRectangle.map((record) => Number(record.distanceMeters.toFixed(6))),
  [0.671, 0.671, 0.671, 0.671],
  "same rectangle must reuse one exact height"
);
assert.deepEqual(
  sameRectangle.slice(0, 3).map((record) => Number(record.rawDistanceMeters.toFixed(3))),
  [0.671, 0.664, 0.674],
  "raw measurements must remain available for audit"
);
assert.equal(new Set(sameRectangle.map((record) => record.structuralLockId)).size, 1);
assert.ok(sameRectangle.every((record) => record.structuralHeightLocked));
const lockedCentimeters = sameRectangle.slice(0, 3).map((record) => Number((record.distanceMeters * 100).toFixed(1)));
const fallbackLockedCentimeters = Number((fallback.distanceMeters * 100).toFixed(1));

const farStructure = measure(manager, 4.0, 1.002, 1.668);
assert.notEqual(farStructure.structuralLockId, first.structuralLockId, "distant structure needs a separate lock");

const differentHeight = measure(manager, 0.8, 1.100, 1.800);
assert.notEqual(differentHeight.structuralLockId, first.structuralLockId, "different boundary levels need a separate lock");

manager.setMeasurementPreset("generic");
const generic = measure(manager, 0.25, 1.001, 1.670);
assert.equal(generic.structuralHeightLocked, undefined, "generic measurements must not be structurally locked");

manager.deleteRecord(first.id);
const afterReferenceDelete = manager.getRecords().filter((record) =>
  record.id === second.id || record.id === third.id || record.id === fallback.id
);
assert.equal(new Set(afterReferenceDelete.map((record) => record.distanceMeters.toFixed(6))).size, 1);
assert.equal(new Set(afterReferenceDelete.map((record) => record.structuralLockId)).size, 1);

manager.clearAll();
assert.equal(manager.getRecords().length, 0);

console.log(JSON.stringify({
  inputCentimeters: [67.1, 66.4, 67.4],
  lockedCentimeters,
  fallbackLockedCentimeters,
  distantStructureHasOwnLock: farStructure.structuralLockId !== first.structuralLockId,
  differentHeightHasOwnLock: differentHeight.structuralLockId !== first.structuralLockId
}, null, 2));
