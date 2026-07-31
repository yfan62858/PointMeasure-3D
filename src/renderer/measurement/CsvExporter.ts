import type {
  ClearanceMeasurementRecord,
  MeasurementRecord,
  PlaneMeasurementRecord
} from "./MeasurementTypes";

function escapeCsv(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll("\"", "\"\"")}"`;
}

export function measurementsToCsv(
  records: MeasurementRecord[],
  planeRecords: PlaneMeasurementRecord[] = [],
  clearanceRecords: ClearanceMeasurementRecord[] = []
): string {
  const header = [
    "type",
    "distance_mode",
    "measurement_source",
    "id",
    "created_at",
    "start_x_m",
    "start_y_m",
    "start_z_m",
    "end_x_m",
    "end_y_m",
    "end_z_m",
    "distance_m",
    "distance_cm",
    "uncertainty_m",
    "width_m",
    "height_m",
    "area_m2",
    "start_snap",
    "end_snap",
    "start_confidence",
    "end_confidence",
    "measurement_preset",
    "raw_distance_m",
    "raw_distance_cm",
    "structural_lock_id",
    "structural_height_locked"
  ];

  const rows = records.map((record) => [
    "distance",
    record.distanceMode,
    record.source,
    record.id,
    record.createdAtIso,
    record.start.x.toFixed(6),
    record.start.y.toFixed(6),
    record.start.z.toFixed(6),
    record.end.x.toFixed(6),
    record.end.y.toFixed(6),
    record.end.z.toFixed(6),
    record.distanceMeters.toFixed(6),
    (record.distanceMeters * 100).toFixed(3),
    record.uncertaintyMeters?.toFixed(6) ?? "",
    "",
    "",
    "",
    record.startSnap?.kind ?? "legacy",
    record.endSnap?.kind ?? "legacy",
    record.startSnap ? record.startSnap.confidence.toFixed(3) : "",
    record.endSnap ? record.endSnap.confidence.toFixed(3) : "",
    record.measurementPreset,
    record.rawDistanceMeters.toFixed(6),
    (record.rawDistanceMeters * 100).toFixed(3),
    record.structuralLockId ?? "",
    record.structuralHeightLocked ? "true" : "false"
  ]);

  const planeRows = planeRecords.map((record) => [
    "plane",
    "",
    record.structuralFit ? "four_boundary_rectangle" : "plane_patch",
    record.id,
    record.createdAtIso,
    record.corners[0].x.toFixed(6),
    record.corners[0].y.toFixed(6),
    record.corners[0].z.toFixed(6),
    record.corners[2].x.toFixed(6),
    record.corners[2].y.toFixed(6),
    record.corners[2].z.toFixed(6),
    "",
    "",
    record.structuralFit
      ? Math.max(
        record.structuralFit.widthUncertaintyMeters,
        record.structuralFit.heightUncertaintyMeters
      ).toFixed(6)
      : "",
    record.widthMeters.toFixed(6),
    record.heightMeters.toFixed(6),
    record.areaSquareMeters.toFixed(6),
    record.startSnap.kind,
    "locked_plane",
    record.startSnap.confidence.toFixed(3),
    record.startSnap.confidence.toFixed(3),
    "",
    "",
    "",
    "",
    ""
  ]);

  const clearanceRows = clearanceRecords.map((record) => [
    "clearance",
    "vertical",
    "shared_horizontal_planes",
    record.id,
    record.createdAtIso,
    record.lowerPoint.x.toFixed(6),
    record.lowerPoint.y.toFixed(6),
    record.lowerPoint.z.toFixed(6),
    record.upperPoint.x.toFixed(6),
    record.upperPoint.y.toFixed(6),
    record.upperPoint.z.toFixed(6),
    record.heightMeters.toFixed(6),
    (record.heightMeters * 100).toFixed(3),
    record.uncertaintyMeters?.toFixed(6) ?? "",
    "",
    "",
    "",
    "shared_lower_plane",
    "shared_upper_plane",
    record.lowerPick.confidence.toFixed(3),
    record.upperPick.confidence.toFixed(3),
    "beam_column",
    record.heightMeters.toFixed(6),
    (record.heightMeters * 100).toFixed(3),
    record.planePairId,
    "true"
  ]);

  return [header, ...rows, ...planeRows, ...clearanceRows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\r\n");
}
