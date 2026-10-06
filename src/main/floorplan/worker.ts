import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readPly } from "./ReadPly";
import { extractPlan } from "./ExtractPlan";
import { renderPlan } from "./RenderPlan";
import type { FloorplanResult } from "../../shared/FloorplanTypes";
async function run(){const started=Date.now();const progress=(text:string)=>parentPort!.postMessage({type:"progress",text});
 const {points,sourcePoints}=await readPly(workerData.filePath,workerData.options,progress);
 const plan=extractPlan(points,progress);progress("計算每段牆長與尺寸標示…");
 const fileName=path.basename(path.dirname(workerData.filePath))+" / "+path.basename(workerData.filePath);
 const svg=renderPlan(plan,fileName),overlay=renderPlan(plan,fileName,true);
 const image=(s:string)=>"data:image/svg+xml;base64,"+Buffer.from(s).toString("base64");
 // Export vertices return to original horizontal axes, in metres.
 const c=Math.cos(plan.angle),s=Math.sin(plan.angle);
 const inverse=(p:[number,number]):[number,number]=>[c*p[0]-s*p[1],s*p[0]+c*p[1]];
 const result:FloorplanResult={scanId:randomUUID(),fileName,dimensionImage:image(svg),evidenceImage:image(overlay),svg,
 walls:plan.walls.map(w=>({...w,start:inverse(w.start),end:inverse(w.end)})),diagnostics:{algorithm:"local-multiheight-outline-v1",outlineUsed:plan.outlineUsed,observedWallCount:plan.observedWalls.length,sourcePoints,sampledPoints:points.length/3,floorM:plan.floor,ceilingM:plan.ceiling,rotationDeg:plan.angle*180/Math.PI,cellM:plan.cell,elapsedSeconds:(Date.now()-started)/1000,warnings:plan.warnings,options:workerData.options}};
 parentPort!.postMessage({type:"result",result});
}
run().catch(error=>parentPort!.postMessage({type:"error",message:error instanceof Error?error.message:String(error)}));
