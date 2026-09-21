import {chromium, expect} from '@playwright/test';
import * as THREE from 'three';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import Module from 'manifold-3d';
import {unzipSync, strFromU8} from 'fflate';
import {splitCurved, newCurve} from '../src/curve-math.js';
import fs from 'node:fs';

const lib=await Module();lib.setup();
const cube=lib.Manifold.cube([100,80,120]);
for(const frame of ['front','side','top'])for(const preset of ['wave','arch','valley']){
  const pieces=splitCurved(lib,cube,newCurve(preset,frame));
  if(pieces.some(p=>p.status()!=='NoError'))throw Error('Invalid curved solid');
  const volume=pieces.reduce((n,p)=>n+p.volume(),0);
  if(Math.abs(volume-cube.volume())>.01)throw Error('Lost volume');
  pieces.forEach(p=>p.delete());
}
console.log('PASS 9 curved CSG combinations: manifold and volume conservation');
// Verify the cut is really non-planar, not just an inclined plane.
const archParts=splitCurved(lib,cube,newCurve('arch','front'));const arch=archParts[0];
const mesh=arch.getMesh();
const uniqueTopZ=new Set();
for(let i=0;i<mesh.vertProperties.length;i+=mesh.numProp){
  const z=mesh.vertProperties[i+2];if(z>1&&z<119)uniqueTopZ.add(Math.round(z*100));
}
if(uniqueTopZ.size<20)throw Error('No curved boundary detected');
console.log('PASS curved boundary:',uniqueTopZ.size,'distinct section elevations');
archParts.forEach(p=>p.delete());cube.delete();

fs.mkdirSync('tests/fixtures',{recursive:true});
const testMesh=new THREE.Mesh(new THREE.BoxGeometry(100,80,120));
const stl=new STLExporter().parse(testMesh,{binary:true});fs.writeFileSync('tests/fixtures/cube.stl',Buffer.from(stl.buffer));
const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const url=process.env.TEST_URL||'http://localhost:5173';
const ready=()=>expect(page.locator('#loading')).toBeHidden({timeout:90000});
await page.goto(url);await ready();
await expect(page.locator('.part-card')).toHaveCount(2);
await expect(page.locator('[data-mode="curve"]')).toHaveClass('active');
async function checkExport(expectedVolume){
  const promise=page.waitForEvent('download');await page.locator('#export-all').click();
  const download=await promise;const files=unzipSync(fs.readFileSync(await download.path()));
  const profile=JSON.parse(strFromU8(files['profilo-taglio.json']));
  if(profile.mode!=='curve')throw Error('Wrong export mode');
  let volume=0,count=0;
  for(const [name,bytes] of Object.entries(files))if(name.endsWith('.stl')){
    count++;
    const g=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const p=g.attributes.position.array;
    const m=new lib.Mesh({numProp:3,vertProperties:p,triVerts:Uint32Array.from({length:p.length/3},(_,i)=>i)});m.merge();
    const solid=new lib.Manifold(m);
    if(solid.status()!=='NoError')throw Error('Exported curve is not manifold');
    if(Math.abs(solid.boundingBox().min[2])>.001)throw Error('STL not grounded');
    volume+=solid.volume();solid.delete();g.dispose();
  }
  if(count!==2)throw Error('Expected 2 STL files');
  if(expectedVolume&&Math.abs(volume-expectedVolume)>1)throw Error('Wrong exported volume: '+volume);
  return volume;
}
console.log('PASS curved demo STL export:',await checkExport());
await page.locator('#edit-curve').click();await expect(page.locator('#curve-overlay')).toBeVisible();
await page.screenshot({path:'tests/curve-editor.png',fullPage:true});
const dBefore=await page.locator('#curve-path').getAttribute('d');
const point=page.locator('[data-curve-point="1"] .handle-core');
const rect=await point.boundingBox();
await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
await page.mouse.move(rect.x+55,rect.y+90,{steps:8});await page.mouse.up();
if(dBefore===await page.locator('#curve-path').getAttribute('d'))throw Error('Drag did not update curve');
await expect(page.locator('#export-all')).toBeDisabled();
await page.locator('#curve-point-select').selectOption('2');await page.locator('#point-v').fill('25');await page.locator('#point-v').press('Tab');
await page.locator('#apply-cuts').click();await ready();await expect(page.locator('#curve-overlay')).toBeHidden();
await checkExport();console.log('PASS mouse editing, numeric input, recompute, closed STL');
await page.locator('#file-input').setInputFiles('tests/fixtures/cube.stl');await ready();
for(const frame of ['front','side','top']){
  await page.locator('#curve-frame').selectOption(frame);
  await page.locator('[data-preset="arch"]').click();
  await page.locator('#apply-cuts').click();await ready();
  await checkExport(960000);console.log('PASS browser',frame,'curve, valid export and unchanged volume');
}
await page.locator('[data-mode="plane"]').click();await expect(page.locator('#straight-controls')).toBeVisible();
await page.locator('#apply-cuts').click();await ready();await expect(page.locator('.part-card')).toHaveCount(3);
await page.locator('[data-mode="curve"]').click();await page.locator('#apply-cuts').click();await ready();await expect(page.locator('.part-card')).toHaveCount(2);
console.log('PASS switching between curved and planar cuts');
await page.setViewportSize({width:390,height:844});
await page.locator('#edit-curve').click();await expect(page.locator('#curve-overlay')).toBeVisible();
await page.locator('[data-curve-point="2"]').focus();
const beforeKey=await page.locator('#curve-path').getAttribute('d');await page.keyboard.press('ArrowUp');
if(beforeKey===await page.locator('#curve-path').getAttribute('d'))throw Error('Keyboard edit did not move point');
await page.screenshot({path:'tests/curve-mobile.png',fullPage:true});
if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
console.log('PASS responsive editor and keyboard point controls');
await browser.close();
if(errors.length)throw Error(errors.join('\n'));
console.log('PASS no JavaScript errors');
