import type { Vector3Like } from "../../shared/types";

export type SnapMode = "none" | "nearest_point" | "plane";

export type SnapResult = {
  mode: SnapMode;
  point: Vector3Like;
  sourcePointIndex?: number;
  planeId?: string;
};
