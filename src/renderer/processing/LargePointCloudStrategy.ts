export type LargePointCloudDecision =
  | { mode: "direct"; reason: string }
  | { mode: "optimized_cache_required"; reason: string; cacheLayout: string[] };

export class LargePointCloudStrategy {
  constructor(private readonly directLoadThreshold = 5_000_000) {}

  decide(vertexCount: number): LargePointCloudDecision {
    if (vertexCount <= this.directLoadThreshold) {
      return {
        mode: "direct",
        reason: `Point count ${vertexCount.toLocaleString()} is within Direct PLY Mode threshold.`
      };
    }

    return {
      mode: "optimized_cache_required",
      reason: `Point count ${vertexCount.toLocaleString()} exceeds Direct PLY Mode threshold.`,
      cacheLayout: ["metadata.json", "preview.bin", "tiles/", "measurement_index/", "planes.json"]
    };
  }
}
