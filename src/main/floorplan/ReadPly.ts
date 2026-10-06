import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import type { FloorplanOptions } from "../../shared/FloorplanTypes";
const scalar: Record<string, [number, string]> = {
  char:[1,"getInt8"],int8:[1,"getInt8"],uchar:[1,"getUint8"],uint8:[1,"getUint8"],
  short:[2,"getInt16"],int16:[2,"getInt16"],ushort:[2,"getUint16"],uint16:[2,"getUint16"],
  int:[4,"getInt32"],int32:[4,"getInt32"],uint:[4,"getUint32"],uint32:[4,"getUint32"],
  float:[4,"getFloat32"],float32:[4,"getFloat32"],double:[8,"getFloat64"],float64:[8,"getFloat64"]
};
export async function readPly(file: string, options: FloorplanOptions, progress: (text: string) => void) {
  const handle=await fs.open(file,"r");
  try {
    const head=Buffer.alloc(512*1024);const {bytesRead}=await handle.read(head,0,head.length,0);
    const header=head.subarray(0,bytesRead).toString("latin1");const match=/end_header\r?\n/.exec(header);
    if (!header.startsWith("ply") || !match) throw new Error("PLY 標頭無效或過大。");
    const offset=match.index+match[0].length;
    let format="",count=0,element="",stride=0;const props:{name:string;type:string;offset:number}[]=[];
    for(const line of header.slice(0,match.index).split(/\r?\n/)) {
      const p=line.trim().split(/\s+/);
      if(p[0]==="format") format=p[1];
      if(p[0]==="element") { if(!count && p[1]!=="vertex" && Number(p[2])>0) throw new Error("請使用 vertex 資料在前的 PLY。"); element=p[1];if(element==="vertex")count=Number(p[2]); }
      if(p[0]==="property" && element==="vertex") {
        if(!scalar[p[1]]) throw new Error("頂點含不支援的 list／型別，請匯出標準 XYZ PLY。");
        props.push({name:p[2],type:p[1],offset:stride});stride+=scalar[p[1]][0];
      }
    }
    if(!Number.isSafeInteger(count)||count<100||!stride||count>500_000_000) throw new Error("點數不足或 PLY 頂點數無效。");
    const names=options.upAxis==="y"?["x","z","y"]:["x","y","z"];
    const axes=names.map(name=>props.findIndex(p=>p.name===name));if(axes.some(n=>n<0))throw new Error("PLY 缺少 XYZ。");
    const step=Math.max(1,Math.ceil(count/1_200_000));const points:number[]=[];
    const scale=options.unit==="cm"?.01:options.unit==="mm"?.001:1;
    const add=(v:number[])=>{if(v.every(Number.isFinite))points.push(v[0]*scale,v[1]*scale,v[2]*scale);};
    progress(`讀取 ${count.toLocaleString()} 點，建立處理取樣…`);
    if(format==="ascii") {
      const stream=createReadStream(file,{start:offset});const lines=readline.createInterface({input:stream,crlfDelay:Infinity});let i=0;
      try {for await(const line of lines){if(!line.trim())continue;const values=line.trim().split(/\s+/);if(values.length<props.length)throw new Error("ASCII PLY 頂點資料不完整。");if(i%step===0)add(axes.map(a=>Number(values[a])));if(++i===count)break;}if(i<count)throw new Error("PLY 已截斷。");}
      finally{lines.close();stream.destroy();}
    } else if(format==="binary_little_endian"||format==="binary_big_endian") {
      const stat=await handle.stat();if(stat.size<offset+count*stride)throw new Error("PLY 頂點資料已截斷。");
      const block=Math.max(1,Math.floor(1024*1024/stride));const buffer=Buffer.alloc(block*stride);const little=format==="binary_little_endian";
      for(let first=0;first<count;first+=block){const n=Math.min(block,count-first);let read=0;while(read<n*stride){const r=await handle.read(buffer,read,n*stride-read,offset+first*stride+read);if(!r.bytesRead)throw new Error("PLY 已截斷。");read+=r.bytesRead;}
        const view=new DataView(buffer.buffer,buffer.byteOffset,read);
        for(let i=(step-first%step)%step;i<n;i+=step)add(axes.map(a=>{const prop=props[a];const fn=scalar[prop.type][1] as keyof DataView;return (view[fn] as (o:number,l:boolean)=>number).call(view,i*stride+prop.offset,little);}));
      }
    } else throw new Error("不支援的 PLY 編碼。");
    if(points.length<300)throw new Error("有效點雲不足。");
    return {points:Float64Array.from(points),sourcePoints:count};
  } finally{await handle.close();}
}
