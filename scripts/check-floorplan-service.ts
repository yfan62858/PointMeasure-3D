import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { FloorplanService } from "../src/main/FloorplanService";
async function main(){const service=new FloorplanService(path.resolve('dist-electron/floorplan-worker.cjs'));const dir=path.resolve('.codex-tmp/service-tests');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'pointcloud.ply');
 async function write(width:number){const rows:string[]=[];for(let y=0;y<=3;y+=.1){for(let x=0;x<=width;x+=.05){rows.push(`${x} ${y} 0`,`${x} ${y} 4`);}for(let z=0;z<=4;z+=.05)rows.push(`0 ${y} ${z}`,`${width} ${y} ${z}`);}for(let x=0;x<=width;x+=.1)for(let z=0;z<=4;z+=.1)rows.push(`${x} 0 ${z}`,`${x} 3 ${z}`);await fs.writeFile(file,`ply\nformat ascii 1.0\nelement vertex ${rows.length}\nproperty float x\nproperty float y\nproperty float z\nend_header\n${rows.join('\n')}\n`);}
 const options={upAxis:'y',unit:'m'} as const;await write(5);const stages:string[]=[];const a=await service.load(file,options,7,s=>stages.push(s));assert.ok(stages.length>=4);assert.equal(a.walls.length,4);assert.ok(a.walls.some(w=>Math.abs(w.lengthM-5)<.2));
 await assert.rejects(service.exportBytes(a.scanId,'svg',8),/先產生/);
 await write(7);const b=await service.load(file,options,7);assert.notEqual(a.scanId,b.scanId);assert.ok(b.walls.some(w=>Math.abs(w.lengthM-7)<.2));await assert.rejects(service.exportBytes(a.scanId,'svg',7),/先產生/);
 for(const format of ['svg','csv','json','dxf'] as const)assert.ok((await service.exportBytes(b.scanId,format,7)).length>100);
 for(const wall of b.walls)assert.ok(Math.abs(wall.lengthM-Math.hypot(wall.start[0]-wall.end[0],wall.start[1]-wall.end[1]))<1e-9);
 const pending=service.load(file,options,7);const canceled=assert.rejects(pending,/取消/);service.cancel(7);await canceled;
 assert.equal((await service.load(file,options,7)).walls.length,4);
 await assert.rejects(service.load(file,{upAxis:'invalid',unit:'m'} as never,7),/設定無效/);
 console.log('PASS same filename changed input regenerates dimensions; owner isolation; stale result refusal; progress; four export payloads; distance math; cancel/retry; options validation.');}
void main();
