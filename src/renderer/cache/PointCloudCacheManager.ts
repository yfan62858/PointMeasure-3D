export type OptimizedCacheLayout = {
  metadataPath: string;
  previewPath: string;
  tilesDirectory: string;
  measurementIndexDirectory: string;
  planesPath: string;
};

export class PointCloudCacheManager {
  getExpectedLayout(projectPath: string): OptimizedCacheLayout {
    return {
      metadataPath: `${projectPath}/metadata.json`,
      previewPath: `${projectPath}/preview.bin`,
      tilesDirectory: `${projectPath}/tiles`,
      measurementIndexDirectory: `${projectPath}/measurement_index`,
      planesPath: `${projectPath}/planes.json`
    };
  }

  async hasPreviewCache(_projectPath: string): Promise<boolean> {
    // TODO: check optimized project cache metadata through safe IPC.
    return false;
  }
}
