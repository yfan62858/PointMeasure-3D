import type { CameraState, PointCloudTile } from "../../shared/PointCloudDataSource";

export class LodTileManager {
  private readonly loadedTiles = new Map<string, PointCloudTile>();

  async loadTile(tileId: string): Promise<PointCloudTile> {
    const tile: PointCloudTile = {
      id: tileId,
      loadedPoints: 0,
      totalPoints: 0
    };
    this.loadedTiles.set(tileId, tile);
    return tile;
  }

  async unloadTile(tileId: string): Promise<void> {
    this.loadedTiles.delete(tileId);
  }

  async loadLodTiles(_cameraState: CameraState): Promise<PointCloudTile[]> {
    // TODO: load visible octree or chunked tiles based on camera frustum and point budget.
    return [...this.loadedTiles.values()];
  }
}
