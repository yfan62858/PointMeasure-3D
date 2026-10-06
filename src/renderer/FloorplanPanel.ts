import type { FloorplanResult, FloorplanFormat, FloorplanOptions } from "../shared/FloorplanTypes";
import { installFloorplanZoom } from "./FloorplanZoom";

export function installFloorplanPanel(getPath: () => string | undefined): { reset: () => void } {
  const dialog = document.createElement("dialog");
  dialog.className = "floorplan-dialog";
  dialog.innerHTML = `<header><h2>平面圖・牆面長度</h2><button type="button" data-close aria-label="關閉平面圖">關閉</button></header>
    <div class="floorplan-settings"><label>向上軸 <select data-up><option value="y">Y（ARKit）</option><option value="z">Z</option></select></label><label>點雲單位 <select data-unit><option value="m">公尺</option><option value="cm">公分</option><option value="mm">毫米</option></select></label><button data-generate>重新產生</button><button data-cancel hidden>取消轉換</button><label><input type="checkbox" data-evidence /> 疊加點雲證據</label></div>
    <p data-status role="status"></p>
    <div class="floorplan-actions" hidden><button data-format="png">匯出 PNG</button><button data-format="svg">匯出 SVG</button><button data-format="csv">匯出尺寸表 CSV</button><button data-format="dxf">匯出輪廓 DXF</button><button data-format="json">匯出診斷 JSON</button></div>
    <p class="floorplan-note" hidden></p>
    <div class="floorplan-content"><div class="floorplan-image-panel" hidden><div class="floorplan-zoom-tools"><span>滾輪縮放・放大後拖曳平移</span><output data-zoom-label>100%</output><button data-reset-view>重設視圖</button></div><div class="floorplan-viewport" aria-label="平面圖：滾輪縮放，拖曳平移，雙擊重設"><img alt="標示各段牆長的平面圖" draggable="false" hidden /></div></div><table hidden><thead><tr><th>牆段</th><th>長度（m）</th><th>狀態</th></tr></thead><tbody></tbody></table></div>`;
  document.body.append(dialog);
  const status = dialog.querySelector<HTMLElement>("[data-status]")!;
  const image = dialog.querySelector<HTMLImageElement>("img")!;
  const imagePanel = dialog.querySelector<HTMLElement>(".floorplan-image-panel")!;
  const zoomView = installFloorplanZoom(dialog.querySelector<HTMLElement>(".floorplan-viewport")!, image, dialog.querySelector<HTMLElement>("[data-zoom-label]")!, dialog.querySelector<HTMLButtonElement>("[data-reset-view]")!);
  const table = dialog.querySelector<HTMLTableElement>("table")!;
  const actions = dialog.querySelector<HTMLElement>(".floorplan-actions")!;
  const note = dialog.querySelector<HTMLElement>(".floorplan-note")!;
  const up = dialog.querySelector<HTMLSelectElement>("[data-up]")!;
  const unit = dialog.querySelector<HTMLSelectElement>("[data-unit]")!;
  const generate = dialog.querySelector<HTMLButtonElement>("[data-generate]")!;
  const cancel = dialog.querySelector<HTMLButtonElement>("[data-cancel]")!;
  const overlay = dialog.querySelector<HTMLInputElement>("[data-evidence]")!;
  let result: FloorplanResult | null = null;
  let busy = false;
  let generation = 0;
  const setBusy=(value:boolean)=>{busy=value;generate.disabled=up.disabled=unit.disabled=value;cancel.hidden=!value;};
  const clear = () => { generation++; result = null; zoomView.reset(); imagePanel.hidden = image.hidden = table.hidden = actions.hidden = note.hidden = true; image.removeAttribute("src"); table.tBodies[0].replaceChildren(); };
  const stop=()=>{clear();setBusy(false);void window.pointMeasure3D.cancelFloorplan();};
  dialog.querySelector("[data-close]")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", e => e.stopPropagation());
  dialog.addEventListener("close", () => { if (!dialog.open) stop(); });
  window.pointMeasure3D.onFloorplanProgress(text=>{if(busy&&dialog.open)status.textContent=text;});
  cancel.addEventListener("click",()=>{stop();status.textContent="已取消。可調整設定後重新產生。";});
  overlay.addEventListener("change",()=>{if(result)image.src=overlay.checked?result.evidenceImage:result.dimensionImage;});
  async function run() {
    clear();
    const filePath = getPath();
    if (!filePath) { status.textContent = "請先匯入 PLY 點雲，再開啟平面圖。"; return; }
    const run = generation;
    setBusy(true);
    status.textContent = "正在從目前點雲產生平面圖…";
    try {
      const loaded = await window.pointMeasure3D.loadFloorplan(filePath, {upAxis:up.value as FloorplanOptions["upAxis"],unit:unit.value as FloorplanOptions["unit"]});
      if (run !== generation || !dialog.open || getPath() !== filePath) return;
      result = loaded; image.src = overlay.checked?loaded.evidenceImage:loaded.dimensionImage;
      imagePanel.hidden = image.hidden = table.hidden = actions.hidden = note.hidden = false;
      status.textContent = `${loaded.fileName}｜${loaded.diagnostics.sourcePoints.toLocaleString()} 點 → ${loaded.walls.length} 段候選牆線｜${loaded.diagnostics.elapsedSeconds.toFixed(1)} 秒`;
      note.textContent = loaded.diagnostics.warnings.join(" ")+" PNG／SVG 含尺寸；DXF 為公尺輪廓線。";
      for (const wall of loaded.walls) {
        const row = table.tBodies[0].insertRow();
        [wall.wallId, wall.lengthM.toFixed(2), wall.lowEvidence ? "低證據・待確認" : "候選尺寸"].forEach(value => { row.insertCell().textContent = value; });
      }
    } catch (error) { if (run === generation) status.textContent = `無法產生平面圖：${error instanceof Error ? error.message : String(error)}`; }
    finally {if(run===generation)setBusy(false);}
  }
  generate.addEventListener("click",()=>void run());
  document.querySelector("#openFloorplan")!.addEventListener("click",()=>{dialog.showModal();void run();});
  for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-format]")) button.addEventListener("click", async () => {
    if (!result) return;
    const run = generation; button.disabled = true;
    try {
      const snapshot=result;
      let png:string|undefined;
      if(button.dataset.format==="png"){
        const source=new Image();source.src=snapshot.dimensionImage;await source.decode();
        const canvas=document.createElement("canvas");canvas.width=canvas.height=1600;const context=canvas.getContext("2d");if(!context)throw new Error("無法建立圖片。");context.drawImage(source,0,0,1600,1600);png=canvas.toDataURL("image/png");
      }
      const saved = await window.pointMeasure3D.exportFloorplan(snapshot.scanId, button.dataset.format as FloorplanFormat, png);
      if (run === generation) status.textContent = saved.canceled ? "已取消匯出。" : `已匯出：${saved.filePath}`;
    } catch (error) { if (run === generation) status.textContent = `匯出失敗：${error instanceof Error ? error.message : String(error)}`; }
    finally { button.disabled = false; }
  });
  return { reset: () => { stop(); if (dialog.open) dialog.close(); } };
}
