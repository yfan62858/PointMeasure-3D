import type { FloorplanWall } from "../../shared/FloorplanTypes";
import { outline } from "./Outline";
export type PlanGeometry = { walls: FloorplanWall[]; observedWalls:FloorplanWall[]; outlineUsed:boolean; angle: number; floor: number; ceiling: number; cell: number; origin: [number,number]; width:number;height:number; density:Uint32Array; warnings:string[] };
const quantile=(a:number[],q:number)=>a[Math.min(a.length-1,Math.floor(q*(a.length-1)))];
const median=(a:number[])=>{a.sort((x,y)=>x-y);return quantile(a,.5);};
function bits(n:number){n=n-((n>>>1)&0x55555555);n=(n&0x33333333)+((n>>>2)&0x33333333);return (((n+(n>>>4))&0x0f0f0f0f)*0x01010101)>>>24;}
export function extractPlan(points:Float64Array, progress:(s:string)=>void):PlanGeometry {
  progress("估計樓地板、高度範圍與主要牆面方向…");
  const heights:number[]=[],xx:number[]=[],zz:number[]=[];
  for(let i=0;i<points.length;i+=3){heights.push(points[i+2]);xx.push(points[i]);zz.push(points[i+1]);}
  heights.sort((a,b)=>a-b);xx.sort((a,b)=>a-b);zz.sort((a,b)=>a-b);
  const low=quantile(heights,.005),high=quantile(heights,.995),span=high-low;
  if(span<1.2||span>15)throw new Error("高度範圍不適合單層室內平面圖。請檢查向上軸、單位，或先分離樓層。");
  function heightMode(a:number,b:number){const bins=new Uint32Array(Math.ceil((b-a)/.04)+1);for(const h of heights)if(h>=a&&h<=b)bins[Math.floor((h-a)/.04)]++;let best=0;for(let j=1;j<bins.length;j++)if(bins[j]>bins[best])best=j;return a+(best+.5)*.04;}
  const floor=heightMode(low,low+Math.min(.55,span*.2));const ceiling=heightMode(high-Math.min(.55,span*.2),high);
  const selected:number[]=[];const h0=floor+.4,h1=Math.min(ceiling-.25,floor+2.9);
  if(h1-h0<.8)throw new Error("有效牆面高度不足，請檢查向上軸與單位。");
  const stride=Math.max(1,Math.ceil(points.length/3/18000));
  for(let i=0;i<points.length;i+=3*stride)if(points[i+2]>floor+1.2&&points[i+2]<h1)selected.push(points[i],points[i+1]);
  if(selected.length<200)throw new Error("中高處點雲不足，無法辨識牆面方向。");
  // A wall direction produces concentrated marginal distributions on both planar axes.
  const radius=Math.max(quantile(xx,.998)-quantile(xx,.002),quantile(zz,.998)-quantile(zz,.002))*2+2;
  if(radius>500)throw new Error("點雲範圍過大，請檢查單位或裁切成單一樓層。");
  const cx=quantile(xx,.5),cz=quantile(zz,.5),bin=.06,nb=Math.ceil(radius*2/bin)+4;
  let bestAngle=0,bestScore=-Infinity;
  const scoreAngle=(angle:number)=>{const c=Math.cos(angle),s=Math.sin(angle),u=new Uint32Array(nb),v=new Uint32Array(nb);let total=0;
    for(let i=0;i<selected.length;i+=2){const x=selected[i]-cx,z=selected[i+1]-cz;const a=Math.floor((c*x+s*z+radius)/bin),b=Math.floor((-s*x+c*z+radius)/bin);if(a>=0&&a<nb&&b>=0&&b<nb){u[a]++;v[b]++;total++;}}
    let score=0;for(let j=0;j<nb;j++){if(u[j])score+=u[j]*Math.log(u[j]);if(v[j])score+=v[j]*Math.log(v[j]);}return score/Math.max(total,1);};
  for(let deg=0;deg<90;deg+=1){const a=deg*Math.PI/180,s=scoreAngle(a);if(s>bestScore){bestScore=s;bestAngle=a;}}
  const initial=bestAngle;for(let d=-.8;d<=.8;d+=.1){const a=initial+d*Math.PI/180,s=scoreAngle(a);if(s>bestScore){bestScore=s;bestAngle=a;}}
  const c=Math.cos(bestAngle),s=Math.sin(bestAngle);const local=new Float64Array(points.length);const us:number[]=[],vs:number[]=[];
  for(let i=0;i<points.length;i+=3){const u=c*points[i]+s*points[i+1],v=-s*points[i]+c*points[i+1];local[i]=u;local[i+1]=v;local[i+2]=points[i+2];us.push(u);vs.push(v);}
  us.sort((a,b)=>a-b);vs.sort((a,b)=>a-b);
  const origin:[number,number]=[quantile(us,.001)-.15,quantile(vs,.001)-.15];
  const sx=quantile(us,.999)-origin[0]+.15,sy=quantile(vs,.999)-origin[1]+.15;
  const cell=Math.max(.03,Math.max(sx,sy)/850),width=Math.ceil(sx/cell),height=Math.ceil(sy/cell);
  const occupancy=new Uint32Array(width*height),density=new Uint32Array(width*height);
  for(let i=0;i<local.length;i+=3){const x=Math.floor((local[i]-origin[0])/cell),y=Math.floor((local[i+1]-origin[1])/cell);if(x<0||y<0||x>=width||y>=height)continue;density[y*width+x]++;const h=local[i+2];if(h>=h0&&h<h1){const band=Math.min(15,Math.floor((h-h0)/(h1-h0)*16));occupancy[y*width+x]|=1<<band;}}
  progress("融合多高度牆面證據，提取並精修牆線…");
  const mask=new Uint8Array(width*height);
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){let n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)n|=occupancy[(y+dy)*width+x+dx];if(bits(n)>=6&&bits(n&0xff00)>=2&&bits(n&0x00ff)>=2)mask[y*width+x]=1;}
  type Candidate={axis:0|1;fixed:number;lo:number;hi:number;evidence:number};
  const candidates:Candidate[]=[];
  for(const axis of [0,1] as const){const fixedCount=axis===0?height:width,alongCount=axis===0?width:height;
    for(let f=1;f<fixedCount-1;f++){
      let start=-1,last=-1,hits=0;
      const flush=()=>{if(start>=0&&(last-start+1)*cell>=.6&&hits/(last-start+1)>=.7)candidates.push({axis,fixed:f,lo:start,hi:last,evidence:hits/(last-start+1)});start=last=-1;hits=0;};
      for(let a=0;a<alongCount;a++){const value=axis===0?mask[f*width+a]:mask[a*width+f];if(value){if(start<0)start=a;last=a;hits++;}else if(start>=0&&a-last>Math.max(1,Math.floor(.12/cell)))flush();}flush();
    }
  }
  candidates.sort((a,b)=>(b.hi-b.lo)*b.evidence-(a.hi-a.lo)*a.evidence);
  const chosen:Candidate[]=[];
  for(const q of candidates){if(chosen.some(k=>k.axis===q.axis&&Math.abs(k.fixed-q.fixed)*cell<.16&&Math.min(k.hi,q.hi)-Math.max(k.lo,q.lo)>.5*Math.min(k.hi-k.lo,q.hi-q.lo)))continue;chosen.push(q);if(chosen.length>=120)break;}
  const walls:FloorplanWall[]=[];
  for(const q of chosen){const fixedAxis=q.axis===0?1:0,alongAxis=q.axis===0?0:1;let fixed=origin[fixedAxis]+(q.fixed+.5)*cell;let lo=origin[alongAxis]+(q.lo+.5)*cell,hi=origin[alongAxis]+(q.hi+.5)*cell;
    const offsets:number[]=[],along:number[]=[];
    for(let i=0;i<local.length;i+=3)if(local[i+2]>=h0&&local[i+2]<h1&&Math.abs(local[i+fixedAxis]-fixed)<.09&&local[i+alongAxis]>=lo-.04&&local[i+alongAxis]<=hi+.04){offsets.push(local[i+fixedAxis]);along.push(local[i+alongAxis]);}
    if(offsets.length<30)continue;fixed=median(offsets);along.sort((a,b)=>a-b);lo=quantile(along,.005);hi=quantile(along,.995);
    if(hi-lo<.55)continue;
    const a:[number,number]=q.axis===0?[lo,fixed]:[fixed,lo],b:[number,number]=q.axis===0?[hi,fixed]:[fixed,hi];
    walls.push({wallId:String(walls.length+1).padStart(2,"0"),start:a,end:b,lengthM:hi-lo,lowEvidence:q.evidence<.9,evidence:q.evidence});
  }
  // Join nearby perpendicular endpoints only; do not close large unseen openings.
  for(let i=0;i<walls.length;i++)for(let j=i+1;j<walls.length;j++){
    const a=walls[i],b=walls[j],ah=Math.abs(a.start[1]-a.end[1])<1e-8,bh=Math.abs(b.start[1]-b.end[1])<1e-8;if(ah===bh)continue;
    const hit:[number,number]=ah?[b.start[0],a.start[1]]:[a.start[0],b.start[1]];
    const dist=(p:number[])=>Math.hypot(p[0]-hit[0],p[1]-hit[1]);
    const ai=dist(a.start)<dist(a.end)?"start":"end",bi=dist(b.start)<dist(b.end)?"start":"end";
    if(dist(a[ai])<.18&&dist(b[bi])<.18){if(dist(a[ai])>.06)a.lowEvidence=true;if(dist(b[bi])>.06)b.lowEvidence=true;a[ai]=[...hit];b[bi]=[...hit];}
  }
  for(const wall of walls)wall.lengthM=Math.hypot(wall.end[0]-wall.start[0],wall.end[1]-wall.start[1]);
  if(walls.length<2)throw new Error("沒有足夠連續的牆面證據。請確認單位／向上軸，或匯入包含牆面中高處的室內掃描。");
  progress("整理外框並檢查各邊的點雲支持…");
  const perimeter=outline(density,mask,width,height,origin,cell,walls);
  const warnings=[perimeter?"主連通區外框提案：虛線為低證據／未確認連接；分離區域未納入。":"未取得可靠閉合外框，顯示未強制封閉的牆線候選。","採主要正交方向；斜牆／弧牆可能遺漏。","未辨識門窗、牆厚；所有尺寸須覆核。"];
  if(walls.length>=100)warnings.push("候選線較多，家具或多個房間可能影響結果。");
  return {walls:perimeter||walls,observedWalls:walls,outlineUsed:!!perimeter,angle:bestAngle,floor,ceiling,cell,origin,width,height,density,warnings};
}
