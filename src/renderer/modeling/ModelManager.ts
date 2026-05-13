import type { OfficeMeasureModelDocument, PlaneModelSurface, ModelSurfaceKind } from "../../shared/ModelTypes";
import type { PointCloudMetadata } from "../../shared/types";
import type { PlaneMeasurementRecord } from "../measurement/MeasurementTypes";

export class ModelManager {
  private readonly surfaces: PlaneModelSurface[] = [];
  private pointCloudFilePath?: string;
  private pointCloudFileName?: string;

  resetForPointCloud(metadata: PointCloudMetadata | null): void {
    this.surfaces.length = 0;
    this.pointCloudFilePath = metadata?.filePath;
    this.pointCloudFileName = metadata?.fileName;
  }

  addSurfaceFromPlane(record: PlaneMeasurementRecord): PlaneModelSurface {
    const now = new Date().toISOString();
    const surface: PlaneModelSurface = {
      id: crypto.randomUUID(),
      name: `Plane ${this.surfaces.length + 1}`,
      kind: "custom",
      corners: record.corners,
      normal: record.basis.normal,
      horizontal: record.basis.horizontal,
      vertical: record.basis.vertical,
      widthMeters: record.widthMeters,
      heightMeters: record.heightMeters,
      areaSquareMeters: record.areaSquareMeters,
      confidence: record.startSnap.confidence,
      inlierCount: record.startSnap.inlierCount,
      candidateCount: record.startSnap.candidateCount,
      sourcePointIndex: record.startSnap.sourcePointIndex,
      visible: true,
      createdAtIso: now,
      updatedAtIso: now
    };
    this.surfaces.push(surface);
    return surface;
  }

  loadDocument(document: OfficeMeasureModelDocument): void {
    this.surfaces.length = 0;
    this.pointCloudFilePath = document.pointCloudFilePath;
    this.pointCloudFileName = document.pointCloudFileName;
    for (const surface of document.surfaces) {
      if (isValidSurface(surface)) {
        this.surfaces.push({
          ...surface,
          visible: surface.visible !== false
        });
      }
    }
  }

  toDocument(): OfficeMeasureModelDocument {
    return {
      schemaVersion: 1,
      pointCloudFilePath: this.pointCloudFilePath,
      pointCloudFileName: this.pointCloudFileName,
      surfaces: this.getSurfaces()
    };
  }

  getSurfaces(): PlaneModelSurface[] {
    return this.surfaces.map((surface) => ({ ...surface, corners: [...surface.corners] as PlaneModelSurface["corners"] }));
  }

  updateSurface(id: string, updates: Partial<Pick<PlaneModelSurface, "name" | "kind" | "visible">>): PlaneModelSurface | null {
    const surface = this.surfaces.find((item) => item.id === id);
    if (!surface) {
      return null;
    }

    if (typeof updates.name === "string") {
      surface.name = updates.name.trim() || surface.name;
    }
    if (updates.kind) {
      surface.kind = updates.kind;
    }
    if (typeof updates.visible === "boolean") {
      surface.visible = updates.visible;
    }
    surface.updatedAtIso = new Date().toISOString();
    return { ...surface, corners: [...surface.corners] as PlaneModelSurface["corners"] };
  }

  deleteSurface(id: string): void {
    const index = this.surfaces.findIndex((surface) => surface.id === id);
    if (index >= 0) {
      this.surfaces.splice(index, 1);
    }
  }

  clear(): void {
    this.surfaces.length = 0;
  }
}

export function getModelSurfaceKindLabel(kind: ModelSurfaceKind): string {
  if (kind === "door") return "Door";
  if (kind === "wall") return "Wall";
  if (kind === "column_face") return "Column";
  if (kind === "beam_face") return "Beam";
  if (kind === "cabinet_face") return "Cabinet";
  return "Custom";
}

function isValidSurface(surface: PlaneModelSurface): boolean {
  return Boolean(surface.id) &&
    Array.isArray(surface.corners) &&
    surface.corners.length === 4 &&
    Number.isFinite(surface.widthMeters) &&
    Number.isFinite(surface.heightMeters);
}
