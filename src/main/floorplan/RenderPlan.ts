import type { PlanGeometry } from "./ExtractPlan";
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
export function renderPlan(plan:PlanGeometry,title:string,evidence=false):string {
  const {walls}=plan;const xs=walls.flatMap(w=>[w.start[0],w.end[0]]),ys=walls.flatMap(w=>[w.start[1],w.end[1]]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=1040/Math.max(maxX-minX,maxY-minY),cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  const xy=(p:number[])=>[(p[0]-cx)*scale+800,(p[1]-cy)*scale+765];
  const items=['<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600" viewBox="0 0 1600 1600">','<rect width="1600" height="1600" fill="white"/>'];
  const text=(x:number,y:number,s:string,size=27,color="#193346")=>items.push(`<text x="${x}" y="${y}" font-family="Microsoft JhengHei,Arial,sans-serif" font-size="${size}" fill="${color}">${escape(s)}</text>`);
  const line=(a:number[],b:number[],color:string,width:number,dash=false)=>items.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="${width}"${dash?' stroke-dasharray="10 8"':''}/>`);
  text(55,60,"POINTMEASURE 3D｜自動平面圖與牆長",38);text(55,108,title,26,"#577080");
  text(55,153,"由目前點雲即時計算・公尺・待覆核草稿",25,"#577080");
  if(evidence){const jump=Math.max(1,Math.ceil(Math.max(plan.width,plan.height)/450));for(let y=0;y<plan.height;y+=jump)for(let x=0;x<plan.width;x+=jump){let n=0;for(let dy=0;dy<jump&&y+dy<plan.height;dy++)for(let dx=0;dx<jump&&x+dx<plan.width;dx++)n+=plan.density[(y+dy)*plan.width+x+dx];if(!n)continue;const p=xy([plan.origin[0]+x*plan.cell,plan.origin[1]+y*plan.cell]);if(p[0]<100||p[0]>1500||p[1]<180||p[1]>1390)continue;items.push(`<rect x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" width="${(jump*plan.cell*scale).toFixed(1)}" height="${(jump*plan.cell*scale).toFixed(1)}" fill="#657782" opacity="${Math.min(.33,Math.log1p(n)/25).toFixed(2)}"/>`);}}
  for(const wall of walls)line(xy(wall.start),xy(wall.end),wall.lowEvidence?"#c15c20":"#193346",4,wall.lowEvidence);
  const occupied:number[][]=[];
  const crosses=(r:number[])=>walls.some(w=>{const a=xy(w.start),b=xy(w.end);return Math.max(a[0],b[0])+6>=r[0]&&Math.min(a[0],b[0])-6<=r[2]&&Math.max(a[1],b[1])+6>=r[1]&&Math.min(a[1],b[1])-6<=r[3];});
  for(const wall of walls){const a=xy(wall.start),b=xy(wall.end),mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];const horizontal=Math.abs(a[1]-b[1])<1;const label=`${wall.lengthM.toFixed(2)} m${wall.lowEvidence?' *':''}`;const size=walls.length>25?21:28,w=label.length*size*.58+12,h=size+14;let rect:number[]|null=null;
    for(const dist of [45,75,110,150,195,240,290]){for(const sign of [-1,1]){for(const shift of [0,60,-60,120,-120,180,-180]){const x=mid[0]+(horizontal?shift:dist*sign),y=mid[1]+(horizontal?dist*sign:shift);const r=[x-w/2,y-h/2,x+w/2,y+h/2];if(r[0]<24||r[2]>1576||r[1]<180||r[3]>1380||crosses(r))continue;if(occupied.some(q=>!(r[2]+8<q[0]||q[2]+8<r[0]||r[3]+8<q[1]||q[3]+8<r[1])))continue;rect=r;break;}if(rect)break;}if(rect)break;}
    if(!rect){ // Still label every wall; dense plans are marked explicitly for table review.
      rect=[mid[0]-w/2,mid[1]-h/2,mid[0]+w/2,mid[1]+h/2];
    }
    occupied.push(rect);const center=[(rect[0]+rect[2])/2,(rect[1]+rect[3])/2];line(mid,center,"#98aab5",1);items.push(`<rect x="${rect[0]}" y="${rect[1]}" width="${w}" height="${h}" fill="white" fill-opacity=".94"/>`);text(rect[0]+6,rect[1]+size+1,label,size,wall.lowEvidence?"#c15c20":"#193346");
  }
  const bar=Math.min(2,Math.max(.5,Math.floor((maxX-minX)/2)));line([60,1440],[60+bar*scale,1440],"#193346",3);text(60,1425,`${bar} m`,23);
  text(60,1495,"* 低支持線段；所有牆線與尺寸均需覆核。缺口不代表已辨識的門窗。",25,"#577080");
  text(60,1540,"幾何提取採主要正交方向；顯示至 0.01 m 不代表公分級精度。",25,"#577080");
  items.push('</svg>');return items.join('\n');
}
