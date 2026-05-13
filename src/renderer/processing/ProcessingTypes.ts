import type { Vector3Like } from "../../shared/types";

export type ProcessingBackend = "web_worker" | "electron_worker_process" | "python_open3d" | "cpp_native";

export type CropBox = {
  min: Vector3Like;
  max: Vector3Like;
};

export type PlaneDetectionResult = {
  normal: Vector3Like;
  constant: number;
  inlierCount: number;
};

export type ProcessingJobStatus = "queued" | "running" | "completed" | "failed";
