import type { FloorplanWall } from "../../shared/FloorplanTypes";
type P=[number,number];
function morph(input:Uint8Array,w:number,h:number,r:number,dilate:boolean){const a=new Uint8Array(w*h),out=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let value=dilate?0:1;for(let d=-r;d<=r;d++){const v=x+d>=0&&x+d<w?input[y*w+x+d]:0;if(dilate)value|=v;else value&=v;}a[y*w+x]=value;}for(let y=0;y<h;y++)for(let x=0;x<w;x++){let value=dilate?0:1;for(let d=-r;d<=r;d++){const v=y+d>=0&&y+d<h?a[(y+d)*w+x]:0;if(dilate)value|=v;else value&=v;}out[y*w+x]=value;}return out;}
function simplify(p:P[],eps:number):P[]{if(p.length<=2)return p;const a=p[0],b=p[p.length-1],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;let max=0,index=0;for(let i=1;i<p.length-1;i++){const t=den?Math.max(0,Math.min(1,((p[i][0]-a[0])*dx+(p[i][1]-a[1])*dy)/den)):0;const dist=Math.hypot(p[i][0]-a[0]-t*dx,p[i][1]-a[1]-t*dy);if(dist>max){max=dist;index=i;}}if(max<=eps)return[a,b];return[...simplify(p.slice(0,index+1),eps).slice(0,-1),...simplify(p.slice(index),eps)];}
const area=(p:P[])=>p.reduce((a,c,i)=>{const n=p[(i+1)%p.length];return a+c[0]*n[1]-n[0]*c[1];},0)/2;
export function outline(density:Uint32Array,mask:Uint8Array,w:number,h:number,origin:P,cell:number,observed:FloorplanWall[]):FloorplanWall[]|null {
  let occupied=Uint8Array.from(density,n=>n>0?1:0);const r=Math.max(1,Math.round(.12/cell));
  occupied=morph(morph(occupied,w,h,r,true),w,h,r,false);
  const opening=Math.max(1,Math.round(.06/cell));occupied=morph(morph(occupied,w,h,opening,false),w,h,opening,true);
  const seen=new Uint8Array(w*h);let largest:number[]=[];
  for(let seed=0;seed<occupied.length;seed++)if(occupied[seed]&&!seen[seed]){const queue=[seed];seen[seed]=1;for(let i=0;i<queue.length;i++){const k=queue[i],x=k%w,y=Math.floor(k/w);for(const n of [x>0?k-1:-1,x<w-1?k+1:-1,y>0?k-w:-1,y<h-1?k+w:-1])if(n>=0&&occupied[n]&&!seen[n]){seen[n]=1;queue.push(n);}}if(queue.length>largest.length)largest=queue;}
  if(largest.length*cell*cell<2)return null;
  occupied.fill(0);for(const i of largest)occupied[i]=1;
  const step=w+1;const edges=new Map<number,number[]>();
  const add=(a:number,b:number)=>{const list=edges.get(a)||[];list.push(b);edges.set(a,list);};
  for(const k of largest){const x=k%w,y=Math.floor(k/w),a=y*step+x,b=a+1,c=a+step+1,d=a+step;
    if(y===0||!occupied[k-w])add(a,b);if(x===w-1||!occupied[k+1])add(b,c);if(y===h-1||!occupied[k+w])add(c,d);if(x===0||!occupied[k-1])add(d,a);}
  let boundary:P[]=[];
  while(edges.size){const start=edges.keys().next().value as number;let current=start;const path:P[]=[];
    for(let i=0;i<4*w*h;i++){path.push([current%step,Math.floor(current/step)]);const next=edges.get(current);if(!next?.length)break;const n=next.pop()!;if(!next.length)edges.delete(current);current=n;if(current===start)break;}
    if(current===start&&Math.abs(area(path))>Math.abs(area(boundary)))boundary=path;
  }
  if(boundary.length<4)return null;
  let far=1;for(let i=2;i<boundary.length;i++)if(Math.hypot(boundary[i][0]-boundary[0][0],boundary[i][1]-boundary[0][1])>Math.hypot(boundary[far][0]-boundary[0][0],boundary[far][1]-boundary[0][1]))far=i;
  const epsilon=.18/cell;const reduced=[...simplify(boundary.slice(0,far+1),epsilon).slice(0,-1),...simplify([...boundary.slice(far),boundary[0]],epsilon).slice(0,-1)];
  if(reduced.length<4||reduced.length>60)return null;
  type Edge={horizontal:boolean;fixed:number;lo:number;hi:number};const fitted:Edge[]=[];
  for(let i=0;i<reduced.length;i++){const a=reduced[i],b=reduced[(i+1)%reduced.length],horizontal=Math.abs(b[0]-a[0])>Math.abs(b[1]-a[1]);const axis=horizontal?0:1,other=horizontal?1:0;const edge:Edge={horizontal,fixed:origin[other]+(a[other]+b[other])/2*cell,lo:origin[axis]+Math.min(a[axis],b[axis])*cell,hi:origin[axis]+Math.max(a[axis],b[axis])*cell};
    let nearest=.24;for(const wall of observed){const wh=Math.abs(wall.start[1]-wall.end[1])<1e-8;if(wh!==horizontal)continue;const overlap=Math.min(edge.hi,Math.max(wall.start[axis],wall.end[axis]))-Math.max(edge.lo,Math.min(wall.start[axis],wall.end[axis]));const delta=Math.abs(wall.start[other]-edge.fixed);if(overlap>.4*(edge.hi-edge.lo)&&delta<nearest){nearest=delta;edge.fixed=wall.start[other];}}
    if(fitted.length&&fitted[fitted.length-1].horizontal===horizontal){const prev=fitted[fitted.length-1],l=prev.hi-prev.lo,n=edge.hi-edge.lo;prev.fixed=(prev.fixed*l+edge.fixed*n)/(l+n);prev.lo=Math.min(prev.lo,edge.lo);prev.hi=Math.max(prev.hi,edge.hi);}else fitted.push(edge);
  }
  if(fitted.length>1&&fitted[0].horizontal===fitted[fitted.length-1].horizontal){const last=fitted.pop()!;fitted[0].fixed=(fitted[0].fixed+last.fixed)/2;}
  if(fitted.length<4)return null;
  const vertices:P[]=fitted.map((edge,i)=>{const prev=fitted[(i+fitted.length-1)%fitted.length];return edge.horizontal?[prev.fixed,edge.fixed]:[edge.fixed,prev.fixed];});
  for(let i=0;i<vertices.length;i++)for(let j=i+2;j<vertices.length;j++){if(i===0&&j===vertices.length-1)continue;const a=vertices[i],b=vertices[(i+1)%vertices.length],c=vertices[j],d=vertices[(j+1)%vertices.length];const cross=(p:P,q:P,r:P)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return null;}
  if(Math.abs(area(vertices))<1)return null;
  const result=vertices.map((a,i)=>{const b=vertices[(i+1)%vertices.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(2,Math.ceil(length/.03));let hits=0,run=0,maxGap=0;
    for(let k=0;k<=n;k++){const x=Math.floor((a[0]+(b[0]-a[0])*k/n-origin[0])/cell),y=Math.floor((a[1]+(b[1]-a[1])*k/n-origin[1])/cell);let supported=false;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h&&mask[(y+dy)*w+x+dx])supported=true;}if(supported){hits++;run=0;}else{run++;maxGap=Math.max(maxGap,run*length/n);}}
    const evidence=hits/(n+1);return {wallId:String(i+1).padStart(2,'0'),start:a,end:b,lengthM:length,evidence,lowEvidence:evidence<.8||maxGap>.25};});
  if(result.some(w=>w.lengthM<.08))return null;
  return result;
}
