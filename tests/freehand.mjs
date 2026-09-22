import {chromium,expect} from '@playwright/test';
import * as THREE from 'three';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import Module from 'manifold-3d';
import {unzipSync,strFromU8} from 'fflate';
import {prepareStroke,splitFreehand,strokeWorld} from '../src/freehand-math.js';
import fs from 'node:fs';
const lib=await Module();lib.setup();
const solid=lib.Manifold.cube([100,80,120]);
const frame={origin:[50,40,60],u:[1,0,0],v:[0,1,0],w:[0,0,1],distance:600,perspective:true};
const curve={id:'first',frame,name:'first',kind:'curve',smooth:1,points:[[-80,-10],[-30,10],[0,-10],[40,15],[80,20]]};
const second={...curve,id:'second',points:[[-20,-90],[-10,-40],[10,0],[-10,40],[15,90]]};
for(const cuts of [[curve],[curve,second],[curve,{...second,enabled:false}]]){
 const result=splitFreehand(lib,solid,cuts);const volume=result.reduce((s,p)=>s+p.volume(),0);
 if(Math.abs(volume-solid.volume())>.01)throw Error('Volume not conserved');
 if(result.some(p=>p.status()!=='NoError'))throw Error('Non-manifold output');
 console.log('PASS freehand CSG',cuts.length,'cuts,',result.length,'parts');result.forEach(p=>p.delete());
}
const nonMonotonic={...curve,points:[[-80,-30],[-10,-25],[25,-12],[0,10],[-15,25],[80,30]]};
prepareStroke(solid.boundingBox(),nonMonotonic);console.log('PASS freehand may turn back horizontally (not a monotone Bezier)');
let rejected=false;try{prepareStroke(solid.boundingBox(),{...curve,smooth:0,points:[[-80,-30],[40,30],[-40,30],[80,-30]]});}catch{rejected=true;}if(!rejected)throw Error('Self-crossing path accepted');
const p=[30,20],depth=40,world=strokeWorld(frame,p,depth);const projection=[(world[0]-50)*600/(600-depth),(world[1]-40)*600/(600-depth)];if(projection.some((n,i)=>Math.abs(n-p[i])>1e-6))throw Error('Perspective projection mismatch');
console.log('PASS self-crossing guard and perspective ray match');solid.delete();
fs.mkdirSync('tests/fixtures',{recursive:true});const object=new THREE.Mesh(new THREE.BoxGeometry(100,80,120));const stl=new STLExporter().parse(object,{binary:true});fs.writeFileSync('tests/fixtures/cube.stl',Buffer.from(stl.buffer));
const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-swiftshader']});const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const ready=()=>expect(page.locator('#loading')).toBeHidden({timeout:90000});
await page.goto(process.env.TEST_URL||'http://localhost:5173');await ready();
await expect(page.locator('[data-mode="freehand"]')).toHaveClass('active');await expect(page.locator('.stroke-card')).toHaveCount(0);
await page.locator('#file-input').setInputFiles('tests/fixtures/cube.stl');await ready();
async function gesture(kind='horizontal',withScreenshot=false){
 await page.locator('#viewport-draw').click();await expect(page.locator('#stroke-overlay')).toBeVisible();const r=await page.locator('#stroke-overlay').boundingBox();
 const coordinates=Array.from({length:42},(_,i)=>{const t=i/41;return kind==='horizontal'?[r.x+r.width*(.12+.76*t),r.y+r.height*(.51+.09*Math.sin(t*Math.PI*2))]:[r.x+r.width*(.50+.035*Math.sin(t*Math.PI*2)),r.y+r.height*(.20+.60*t)];});
 await page.mouse.move(...coordinates[0]);await page.mouse.down();for(const p of coordinates.slice(1))await page.mouse.move(...p);
 if(withScreenshot)await page.screenshot({path:'tests/freehand-drawing.png',fullPage:true});
 await page.mouse.up();await expect(page.locator('#stroke-overlay')).toBeHidden();
}
await gesture('horizontal',true);await expect(page.locator('.stroke-card')).toHaveCount(1);await expect(page.locator('#export-all')).toBeDisabled();
await page.locator('#apply-cuts').click();await ready();await expect(page.locator('.part-card')).toHaveCount(2);console.log('PASS actual mouse drawing in perspective creates 2 parts');
await page.locator('#view-orientation').selectOption('top');await gesture('vertical');await expect(page.locator('.stroke-card')).toHaveCount(2);
await page.locator('#apply-cuts').click();await ready();const count=await page.locator('.part-card').count();if(count<3)throw Error('Second cut did not split parts');console.log('PASS multiple freehand cuts from different camera views:',count,'parts');
await page.screenshot({path:'tests/freehand-parts.png',fullPage:true});
const promise=page.waitForEvent('download');await page.locator('#export-all').click();const download=await promise;const files=unzipSync(fs.readFileSync(await download.path()));const profile=JSON.parse(strFromU8(files['profilo-taglio.json']));
if(profile.mode!=='freehand'||profile.freehandCuts.length!==2||profile.freehandCuts[0].points.length<10)throw Error('Export does not preserve freehand paths');
let total=0;
for(const [name,bytes] of Object.entries(files))if(name.endsWith('.stl')){
 const geom=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));const pos=geom.attributes.position.array;
 const mesh=new lib.Mesh({numProp:3,vertProperties:pos,triVerts:Uint32Array.from({length:pos.length/3},(_,i)=>i)});mesh.merge();const s=new lib.Manifold(mesh);if(s.status()!=='NoError')throw Error('STL not closed');total+=s.volume();if(Math.abs(s.boundingBox().min[2])>.001)throw Error('Not grounded');s.delete();geom.dispose();
}
if(Math.abs(total-960000)>1)throw Error('Export changed volume');console.log('PASS closed STL export, metadata, no lost volume:',total);
await page.locator('#viewport-draw').click();await page.keyboard.press('Escape');await expect(page.locator('.stroke-card')).toHaveCount(2);await expect(page.locator('#export-all')).toBeEnabled();
await page.locator('#undo-stroke').click();await expect(page.locator('.stroke-card')).toHaveCount(1);
await page.locator('#apply-cuts').click();await ready();await expect(page.locator('.part-card')).toHaveCount(2);console.log('PASS Escape cancels, Undo restores the previous cut list');
await page.locator('[data-stroke-enabled]').uncheck();await page.locator('#apply-cuts').click();await ready();await expect(page.locator('.part-card')).toHaveCount(1);await expect(page.locator('#export-all')).toBeDisabled();
await page.locator('[data-stroke-enabled]').check();await page.locator('#apply-cuts').click();await ready();await expect(page.locator('.part-card')).toHaveCount(2);
console.log('PASS disable/re-enable cuts');
await page.setViewportSize({width:390,height:844});await page.locator('#viewport-draw').click();await expect(page.locator('#stroke-overlay')).toBeVisible();await page.screenshot({path:'tests/freehand-mobile.png',fullPage:true});await page.keyboard.press('Escape');
if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile horizontal overflow');
await browser.close();if(errors.length)throw Error(errors.join('\n'));console.log('PASS responsive UI and no browser errors');
