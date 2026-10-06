const {app,BrowserWindow,dialog}=require('electron');const path=require('node:path');const fs=require('node:fs/promises');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const output=path.join(root,'.codex-tmp/floorplan-system');
if(!process.env.FLOORPLAN_TEST_PLY){console.error('Set FLOORPLAN_TEST_PLY to the local 15,935,774-point integration fixture.');process.exit(1);}
const input=path.resolve(process.env.FLOORPLAN_TEST_PLY);
const appRoot=process.env.FLOORPLAN_TEST_APP?path.resolve(process.env.FLOORPLAN_TEST_APP):root;
app.setAppPath(appRoot);process.env.NODE_ENV='production';let savePath;
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[input]});dialog.showSaveDialog=async()=>savePath?({canceled:false,filePath:savePath}):({canceled:true});
require(path.join(appRoot,'dist-electron/main.cjs'));const delay=ms=>new Promise(r=>setTimeout(r,ms));const timeout=setTimeout(()=>{console.error('TIMEOUT');app.exit(1)},120000);
app.whenReady().then(async()=>{try{
 await fs.mkdir(output,{recursive:true});let win;for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await delay(100)}win.hide();const js=s=>win.webContents.executeJavaScript(s);
 async function until(code){for(let i=0;i<600;i++){if(await js(code))return;await delay(100)}throw Error('UI timeout: '+code)}
 await until("!!document.querySelector('#openFloorplan')");await js("document.querySelector('#openFloorplan').click()");assert.match(await js("document.querySelector('[data-status]').textContent"),/請先匯入/);
 await js("document.querySelector('[data-close]').click();document.querySelector('#importPly').click()");await until("document.querySelector('#cloudInfo').textContent.includes('15,935,774') || document.querySelector('#cloudInfo').textContent.includes('15935774')");
 await js("document.querySelector('#openFloorplan').click()");await until("document.querySelector('.floorplan-content tbody').rows.length>1");
 assert.ok((await js("document.querySelector('[data-status]').textContent")).includes(path.basename(input)));
 await js("document.querySelector('.floorplan-content img').decode()");
 const rowCount=await js("document.querySelector('.floorplan-content tbody').rows.length");console.log('UI generated new scan:',rowCount,'segments');
 for(const format of ['png','svg','csv','dxf','json']){savePath=path.join(output,'generated.'+format);await js(`document.querySelector('[data-format="${format}"]').click()`);await until(`document.querySelector('[data-status]').textContent.includes(${JSON.stringify(savePath)})`);assert.ok((await fs.stat(savePath)).size>0);}
 savePath=undefined;await js("document.querySelector('[data-format=svg]').click()");await until("document.querySelector('[data-status]').textContent.includes('取消匯出')");
 await js("document.querySelector('[data-evidence]').click();document.querySelector('.floorplan-content img').decode()");
 win.showInactive();await delay(500);
 const zoomCheck=await js(`(()=>{
  const viewport=document.querySelector('.floorplan-viewport'),image=viewport.querySelector('img'),box=viewport.getBoundingClientRect();
  const beforeScroll=document.querySelector('.floorplan-dialog').scrollTop;
  const px=box.width*.55,py=box.height*.45;
  const wheel=new WheelEvent('wheel',{deltaY:-240,clientX:box.left+px,clientY:box.top+py,bubbles:true,cancelable:true});viewport.dispatchEvent(wheel);
  const matrix=new DOMMatrix(getComputedStyle(image).transform);
  return {zoom:Number(viewport.dataset.zoom),prevented:wheel.defaultPrevented,anchorX:(wheel.clientX-box.left-matrix.e)/matrix.a,anchorY:(wheel.clientY-box.top-matrix.f)/matrix.d,px:wheel.clientX-box.left,py:wheel.clientY-box.top,scroll:document.querySelector('.floorplan-dialog').scrollTop-beforeScroll};
 })()`);
 assert.ok(zoomCheck.zoom>1);assert.equal(zoomCheck.prevented,true);assert.equal(zoomCheck.scroll,0);assert.ok(Math.abs(zoomCheck.anchorX-zoomCheck.px)<.01);assert.ok(Math.abs(zoomCheck.anchorY-zoomCheck.py)<.01);
 const bounds=await js("document.querySelector('.floorplan-viewport').getBoundingClientRect().toJSON()");const mx=Math.round(bounds.x+bounds.width/2),my=Math.round(bounds.y+bounds.height/2);
 const beforePan=await js("document.querySelector('.floorplan-viewport img').style.transform");
 win.webContents.sendInputEvent({type:'mouseDown',x:mx,y:my,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:mx+35,y:my+25,button:'left'});win.webContents.sendInputEvent({type:'mouseUp',x:mx+35,y:my+25,button:'left',clickCount:1});await delay(100);
 assert.notEqual(await js("document.querySelector('.floorplan-viewport img').style.transform"),beforePan);
 await fs.writeFile(path.join(output,'app-zoom-preview.png'),(await win.webContents.capturePage()).toPNG());
 await js("document.querySelector('[data-reset-view]').click()");assert.equal(await js("Number(document.querySelector('.floorplan-viewport').dataset.zoom)"),1);
 await js("document.querySelector('.floorplan-viewport').dispatchEvent(new WheelEvent('wheel',{deltaY:9999,bubbles:true,cancelable:true}))");assert.equal(await js("Number(document.querySelector('.floorplan-viewport').dataset.zoom)"),1);
 await fs.writeFile(path.join(output,'app-preview.png'),(await win.webContents.capturePage()).toPNG());
 console.log('PASS wheel zoom, cursor anchor, scroll isolation, native pointer drag, reset, minimum zoom.');
 // Regeneration uses worker again; closing while processing cancels and reopening recovers.
 await js("document.querySelector('[data-generate]').click();document.querySelector('[data-cancel]').click()");assert.match(await js("document.querySelector('[data-status]').textContent"),/已取消/);
 await js("document.querySelector('[data-generate]').click()");await until("document.querySelector('.floorplan-content tbody').rows.length>1");
 const invalid=path.join(output,'invalid.ply');await fs.writeFile(invalid,'not a valid PLY');assert.equal(await js(`window.pointMeasure3D.loadFloorplan(${JSON.stringify(invalid)},{upAxis:'y',unit:'m'}).then(()=>false,()=>true)`),true);
 await js("document.querySelector('[data-close]').click()");assert.equal(await js("document.querySelector('.floorplan-dialog').open"),false);
 console.log('PASS actual 15.9M-point import, automatic generation/default dimensions, five exports, export cancellation, evidence overlay, worker cancellation/retry, malformed PLY error, close.');clearTimeout(timeout);app.exit(0);
}catch(e){console.error(e);clearTimeout(timeout);app.exit(1)}});
