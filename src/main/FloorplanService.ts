import { Worker } from "node:worker_threads";
import path from "node:path";
import type { FloorplanFormat, FloorplanResult, FloorplanOptions } from "../shared/FloorplanTypes";

export class FloorplanService {
  private results = new Map<string, {owner:number; result:FloorplanResult}>();
  private jobs = new Map<number, {worker:Worker; reject:(error:Error)=>void}>();
  constructor(private workerPath: string) {}
  cancel(owner:number):void {const job=this.jobs.get(owner);if(job){this.jobs.delete(owner);void job.worker.terminate();job.reject(new Error("已取消平面圖轉換。"));}}
  async load(plyPath: string, options:FloorplanOptions={upAxis:"y",unit:"m"}, owner=0, progress:(text:string)=>void=()=>{}): Promise<FloorplanResult> {
    if (typeof plyPath !== "string" || !path.isAbsolute(plyPath) || path.extname(plyPath).toLowerCase() !== ".ply") throw new Error("請選擇有效的 PLY 檔案。");
    if(!options||!["y","z"].includes(options.upAxis)||!["m","cm","mm"].includes(options.unit))throw new Error("向上軸或單位設定無效。");
    this.cancel(owner);
    return new Promise((resolve,reject)=>{
      const worker=new Worker(this.workerPath,{workerData:{filePath:plyPath,options}});this.jobs.set(owner,{worker,reject});
      let settled=false;
      const finish=(error?:Error,result?:FloorplanResult)=>{if(settled)return;settled=true;if(this.jobs.get(owner)?.worker===worker)this.jobs.delete(owner);void worker.terminate();if(error)reject(error);else if(result){for(const [id,entry] of this.results)if(entry.owner===owner)this.results.delete(id);this.results.set(result.scanId,{owner,result});resolve(result);}};
      worker.on("message",message=>{if(message.type==="progress")progress(message.text);else if(message.type==="result")finish(undefined,message.result);else if(message.type==="error")finish(new Error(message.message));});
      worker.on("error",error=>finish(error));worker.on("exit",code=>{if(!settled)finish(new Error(`轉換程序已停止（${code}）。`));});
    });
  }
  async exportBytes(scanId: string, format: FloorplanFormat, owner=0, pngData?:string): Promise<Buffer> {
    const entry=this.results.get(scanId);if(!entry||entry.owner!==owner)throw new Error("請先產生平面圖。");const r=entry.result;
    if(format==="svg")return Buffer.from(r.svg);
    if(format==="json")return Buffer.from(JSON.stringify({...r,svg:undefined,dimensionImage:undefined,evidenceImage:undefined},null,2));
    if(format==="csv")return Buffer.from('\uFEFFwall_id,length_m,review,start_x,start_horizontal_2,end_x,end_horizontal_2\r\n'+r.walls.map(w=>[w.wallId,w.lengthM,w.lowEvidence,...w.start,...w.end].join(',')).join('\r\n'));
    if(format==="dxf"){
      const header='0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n';
      return Buffer.from(header+r.walls.map(w=>`0\nLINE\n8\n${w.lowEvidence?'REVIEW':'WALL_CANDIDATE'}\n10\n${w.start[0]}\n20\n${w.start[1]}\n30\n0\n11\n${w.end[0]}\n21\n${w.end[1]}\n31\n0\n`).join('')+'0\nENDSEC\n0\nEOF\n');
    }
    if(format==="png"&&typeof pngData==="string"&&pngData.startsWith('data:image/png;base64,')&&pngData.length<30_000_000){const bytes=Buffer.from(pngData.slice(22),'base64');if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return bytes;}
    throw new Error("匯出格式或圖片資料無效。");
  }
}
