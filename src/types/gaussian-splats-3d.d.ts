declare module "@mkkellogg/gaussian-splats-3d" {
  import * as THREE from "three";

  export enum SceneFormat {
    Ply = 0,
    Splat = 1,
    KSplat = 2
  }

  export enum RenderMode {
    Always = 0,
    OnChange = 1,
    Never = 2
  }

  export enum SceneRevealMode {
    Default = 0,
    Gradual = 1,
    Instant = 2
  }

  export enum LogLevel {
    None = 0,
    Error = 1,
    Warn = 2,
    Info = 3,
    Debug = 4
  }

  export enum WebXRMode {
    None = 0,
    VR = 1,
    AR = 2
  }

  export enum SplatRenderMode {
    ThreeD = 0,
    TwoD = 1
  }

  export type SplatSceneOptions = {
    format?: SceneFormat;
    splatAlphaRemovalThreshold?: number;
    showLoadingUI?: boolean;
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    progressiveLoad?: boolean;
    onProgress?: (event: ProgressEvent) => void;
  };

  export type DropInViewerOptions = {
    gpuAcceleratedSort?: boolean;
    enableSIMDInSort?: boolean;
    sharedMemoryForWorkers?: boolean;
    integerBasedSort?: boolean;
    halfPrecisionCovariancesOnGPU?: boolean;
    dynamicScene?: boolean;
    renderMode?: RenderMode;
    sceneRevealMode?: SceneRevealMode;
    antialiased?: boolean;
    focalAdjustment?: number;
    logLevel?: LogLevel;
    sphericalHarmonicsDegree?: 0 | 1 | 2;
    enableOptionalEffects?: boolean;
    optimizeSplatData?: boolean;
    inMemoryCompressionLevel?: 0 | 1 | 2;
    freeIntermediateSplatData?: boolean;
    splatRenderMode?: SplatRenderMode;
    maxScreenSpaceSplatSize?: number;
    kernel2DSize?: number;
  };

  export class DropInViewer extends THREE.Group {
    viewer: unknown;
    splatMesh: THREE.Object3D | null;

    constructor(options?: DropInViewerOptions);
    addSplatScene(path: string, options?: SplatSceneOptions): Promise<void>;
    removeSplatScene(index: number, showLoadingUI?: boolean): Promise<void>;
    getSceneCount(): number;
    setActiveSphericalHarmonicsDegrees(activeSphericalHarmonicsDegrees: number): void;
    dispose(): Promise<void>;
  }
}
