import type { CropBox, PlaneDetectionResult } from "./ProcessingTypes";

export interface ProcessingPipeline {
  voxelDownsample(voxelSize: number): Promise<void>;
  statisticalOutlierRemoval(nbNeighbors: number, stdRatio: number): Promise<void>;
  radiusOutlierRemoval(radius: number, minNeighbors: number): Promise<void>;
  cropBox(box: CropBox): Promise<void>;
  detectPlanes(): Promise<PlaneDetectionResult[]>;
}

export class MvpProcessingPipeline implements ProcessingPipeline {
  async voxelDownsample(_voxelSize: number): Promise<void> {
    throw new Error("voxelDownsample is reserved for an optimized processing backend.");
  }

  async statisticalOutlierRemoval(_nbNeighbors: number, _stdRatio: number): Promise<void> {
    throw new Error("statisticalOutlierRemoval is reserved for an optimized processing backend.");
  }

  async radiusOutlierRemoval(_radius: number, _minNeighbors: number): Promise<void> {
    throw new Error("radiusOutlierRemoval is reserved for an optimized processing backend.");
  }

  async cropBox(_box: CropBox): Promise<void> {
    throw new Error("cropBox is reserved for an optimized processing backend.");
  }

  async detectPlanes(): Promise<PlaneDetectionResult[]> {
    throw new Error("detectPlanes is reserved for an optimized processing backend.");
  }
}
