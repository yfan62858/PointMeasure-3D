import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { extractPlan } from "../src/main/floorplan/ExtractPlan";
import { readPly } from "../src/main/floorplan/ReadPly";
const quiet=()=>{};
function room(width:number,depth:number,gap=false){const pts:number[]=[];const angle=29*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);const add=(x:number,z:number,y:number)=>pts.push(c*x-s*z,s*x+c*z,y);
 for(let h=0;h<=3;h+=.08){for(let x=0;x<=width;x+=.04){if(!gap||x<1.5||x>2.5)add(x,0,h);add(x,depth,h);}for(let z=0;z<=depth;z+=.04){add(0,z,h);add(width,z,h);}}
 for(let x=0;x<=width;x+=.1)for(let z=0;z<=depth;z+=.1){add(x,z,0);add(x,z,3);}
 return Float64Array.from(pts);
}
async function main(){const a=extractPlan(room(5,4),quiet);console.log('rectangle',a.walls.map(w=>w.lengthM),a.angle*180/Math.PI);assert.equal(a.walls.length,4);assert.ok(a.walls.every(w=>Math.min(Math.abs(w.lengthM-5),Math.abs(w.lengthM-4))<.15));
 const b=extractPlan(room(7,4),quiet);assert.ok(b.walls.some(w=>w.lengthM>6.8));assert.ok(!a.walls.some(w=>w.lengthM>6));
 const open=extractPlan(room(5,4,true),quiet);assert.ok(open.observedWalls.length>=5,'doorway remains split');
 const flat=Float64Array.from(Array.from({length:300},(_,i)=>[i%20,Math.floor(i/20),0]).flat());assert.throws(()=>extractPlan(flat,quiet),/高度範圍/);
 const dir=path.resolve('.codex-tmp/geometry-tests');await fs.mkdir(dir,{recursive:true});
 const xyz=room(5,4);const file=path.join(dir,'same-name.ply');
 // Z-up centimetre input transformed back into canonical x,z,height metres.
 const header=`ply\nformat ascii 1.0\nelement vertex ${xyz.length/3}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
 let body='';for(let i=0;i<xyz.length;i+=3)body+=`${xyz[i]*100} ${xyz[i+1]*100} ${xyz[i+2]*100}\n`;
 await fs.writeFile(file,header+body);const parsed=await readPly(file,{upAxis:'z',unit:'cm'},quiet);assert.equal(parsed.sourcePoints,xyz.length/3);assert.ok(Math.abs(parsed.points[30]-xyz[30])<1e-9);assert.equal(extractPlan(parsed.points,quiet).walls.length,4);
 await fs.writeFile(file,'ply\nformat binary_little_endian 1.0\nelement vertex 100\nproperty float x\nproperty float y\nproperty float z\nend_header\n');await assert.rejects(readPly(file,{upAxis:'y',unit:'m'},quiet),/截斷/);
 console.log('PASS rectangle dimensions/rotation, changed geometry, 1m opening, flat-cloud refusal, ASCII Z-up cm conversion, truncated binary refusal.');}
void main();
