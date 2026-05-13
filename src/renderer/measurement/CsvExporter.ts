import type { MeasurementRecord, PlaneMeasurementRecord } from "./MeasurementTypes";

function escapeCsv(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll("\"", "\"\"")}"`;
}

export function measurementsToCsv(records: MeasurementRecord[], planeRecords: PlaneMeasurementRecord[] = []): string {
  const header = [
    "type",
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
    "width_m",
    "height_m",
    "area_m2",
    "start_snap",
    "end_snap",
    "start_confidence",
    "end_confidence"
  ];

  const rows = records.map((record) => [
    "distance",
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
    "",
    "",
    "",
    record.startSnap?.kind ?? "legacy",
    record.endSnap?.kind ?? "legacy",
    record.startSnap ? record.startSnap.confidence.toFixed(3) : "",
    record.endSnap ? record.endSnap.confidence.toFixed(3) : ""
  ]);

  const planeRows = planeRecords.map((record) => [
    "plane",
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
    record.widthMeters.toFixed(6),
    record.heightMeters.toFixed(6),
    record.areaSquareMeters.toFixed(6),
    record.startSnap.kind,
    "locked_plane",
    record.startSnap.confidence.toFixed(3),
    record.startSnap.confidence.toFixed(3)
  ]);

  return [header, ...rows, ...planeRows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}
