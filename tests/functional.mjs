import {chromium,expect} from '@playwright/test';
import * as THREE from 'three';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import Module from 'manifold-3d';
import {unzipSync} from 'fflate';
import fs from 'node:fs';
const lib=await Module();lib.setup();
const cube=new THREE.Mesh(new THREE.BoxGeometry(100,80,120));
const stl=new STLExporter().parse(cube,{binary:true});
fs.mkdirSync('tests/fixtures',{recursive:true});fs.writeFileSync('tests/fixtures/cube.stl',Buffer.from(stl.buffer));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const waitReady=()=>expect(page.locator('#loading')).toBeHidden({timeout:60000});
await page.goto('http://localhost:5173');await waitReady();await page.locator('[data-mode="plane"]').click();await page.locator('#apply-cuts').click();await waitReady();await expect(page.locator('.part-card')).toHaveCount(3);
await page.screenshot({path:'tests/desktop.png',fullPage:true});
async function exportZip(){const promise=page.waitForEvent('download');await page.locator('#export-all').click();const d=await promise;const path=await d.path();return unzipSync(fs.readFileSync(path));}
function validateSTL(bytes){const geom=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));const pos=new Float32Array(geom.attributes.position.array);const mesh=new lib.Mesh({numProp:3,vertProperties:pos,triVerts:Uint32Array.from({length:pos.length/3},(_,i)=>i)});mesh.merge();const solid=new lib.Manifold(mesh);if(solid.status()!=='NoError')throw new Error('Non-manifold export: '+solid.status());const vol=solid.volume();const bounds=solid.boundingBox();if(Math.abs(bounds.min[2])>.001)throw new Error('Export not grounded');solid.delete();geom.dispose();return vol;}
const demoZip=await exportZip();let demoVolume=0;for(const [name,bytes]of Object.entries(demoZip))if(name.endsWith('.stl'))demoVolume+=validateSTL(bytes);console.log('PASS demo export: closed STL parts, total volume',demoVolume);
await page.locator('#file-input').setInputFiles('tests/fixtures/cube.stl');await waitReady();await expect(page.locator('#file-name')).toHaveText('cube.stl');await expect(page.locator('.part-card')).toHaveCount(3);
for(const axis of [2,0,1]){
 if(axis!==2){await page.locator(`[data-axis="${axis}"]`).click();await expect(page.locator('#export-all')).toBeDisabled();await page.locator('#apply-cuts').click();await waitReady();}
 const zip=await exportZip();let vol=0;for(const [name,bytes] of Object.entries(zip))if(name.endsWith('.stl'))vol+=validateSTL(bytes);if(Math.abs(vol-960000)>1)throw new Error(`Volume incorrect on axis ${axis}: ${vol}`);console.log('PASS axis',axis,'3 solids, total volume',vol);
}
await page.locator('#add-plane').click();await page.locator('#apply-cuts').click();await waitReady();await expect(page.locator('.part-card')).toHaveCount(4);console.log('PASS add plane');
while(await page.locator('[data-remove]').count())await page.locator('[data-remove]').first().click();await page.locator('#apply-cuts').click();await waitReady();await expect(page.locator('.part-card')).toHaveCount(1);console.log('PASS remove all planes');
await page.locator('#file-input').setInputFiles({name:'broken.stl',mimeType:'application/octet-stream',buffer:Buffer.from('solid empty\nendsolid empty')});await waitReady();await expect(page.locator('#file-name')).toHaveText('cube.stl');await expect(page.locator('#toast')).toHaveClass(/error/);console.log('PASS rejects invalid STL and preserves current model');
await page.locator('#help').click();await expect(page.locator('#guide-dialog')).toBeVisible();await page.locator('#start-working').click();await page.locator('#wire-view').click();await expect(page.locator('#wire-view')).toHaveClass('active');await page.locator('#solid-view').click();
await page.setViewportSize({width:390,height:844});page.once('dialog',d=>d.accept());await page.locator('#load-demo').click();await waitReady();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'tests/mobile.png',fullPage:true});
if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile horizontal overflow');console.log('PASS mobile layout');
await browser.close();
if(errors.length)throw new Error(errors.join('\n'));
console.log('PASS no JavaScript errors');
