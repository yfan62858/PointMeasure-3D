export type FloorplanFormat = "png" | "svg" | "csv" | "dxf" | "json";
export type FloorplanOptions = { upAxis: "y" | "z"; unit: "m" | "cm" | "mm" };
export type FloorplanWall = { wallId: string; lengthM: number; lowEvidence: boolean; start: [number, number]; end: [number, number]; evidence: number };
export type FloorplanResult = {
  scanId: string;
  fileName: string;
  dimensionImage: string;
  evidenceImage: string;
  svg: string;
  walls: FloorplanWall[];
  diagnostics: { algorithm:string; outlineUsed:boolean; observedWallCount:number; sourcePoints: number; sampledPoints: number; floorM: number; ceilingM: number; rotationDeg: number; cellM: number; elapsedSeconds: number; warnings: string[]; options: FloorplanOptions };
};
