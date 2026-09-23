// Seam drawing: the pure helpers, then the real workflow in a browser.
//
// The acceptance case is the one the tool has to satisfy: a seam can be drawn on
// the visible surface, the model can be orbited, the seam is continued on the
// other sides and, once the loop closes around the object, the model comes apart
// in two pieces whose cut faces are closed.
import {chromium,expect} from '@playwright/test';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import * as THREE from 'three';
import Module from 'manifold-3d';
import fs from 'node:fs';
import {appendSample,modelSpan,sampleStep,seamClosure,seamLength,seamPayload,seamPoints,smoothStroke,straightStroke,strokeLength,validSample} from '../src/seam-math.js';

// ---------------------------------------------------------------- helpers ---
const sample=(p,r)=>[p[0],p[1],p[2],r[0],r[1],r[2]];
const point=(x,y,z,r=[0,1,0],t=500)=>({p:[x,y,z],r:[...r],t,n:null});
const bounds={min:[0,0,0],max:[100,80,120]};

{ // validity
  if(!validSample(point(1,2,3)))throw Error('A plain sample must be valid');
  if(validSample({p:[1,2,3],r:[0,2,0],t:5}))throw Error('A non unit ray must be rejected');
  if(validSample({p:[1,2,3],r:[0,1,0],t:-1}))throw Error('A negative distance must be rejected');
  if(validSample({p:[1,NaN,3],r:[0,1,0],t:5}))throw Error('A non finite point must be rejected');
  console.log('PASS sample validation');
}

{ // throttling and chaining
  const strokes=[[]];
  const step=sampleStep(bounds);
  if(step<=0||step>modelSpan(bounds)*.01)throw Error('Unexpected sample step');
  appendSample(strokes,point(0,0,0),step);
  if(!appendSample(strokes,point(step*2,0,0),step))throw Error('A far sample must be kept');
  if(appendSample(strokes,point(step*2.1,0,0),step))throw Error('A sample on top of the previous one must be skipped');
  strokes.push([]);
  if(!appendSample(strokes,point(50,0,0),step))throw Error('A second stroke must accept samples');
  if(strokes.length!==2||strokes[0].length!==2||strokes[1].length!==1)throw Error('Strokes were not chained as expected');
  if(Math.abs(strokeLength(strokes[0])-step*2)>1e-9)throw Error('Stroke length is wrong');
  if(Math.abs(seamLength(strokes)-step*2)>1e-9)throw Error('Seam length must add the strokes up');
  if(seamPoints(strokes)!==3)throw Error('Point count is wrong');
  console.log('PASS samples are throttled and chained into one seam');
}

{ // closure: a loop must be recognised, an open seam must not
  const open=[Array.from({length:20},(_,i)=>point(0,10*i,0)),Array.from({length:20},(_,i)=>point(100,10+i*3,0))];
  if(seamClosure(open,bounds).closed)throw Error('An open seam must not be closed');
  const loop=[];
  for(let i=0;i<=72;i++){const a=i/72*Math.PI*2;loop.push(point(50+45*Math.cos(a),40+35*Math.sin(a),60));}
  const closed={...seamClosure([loop],bounds)};
  if(!closed.closed)throw Error('A closed loop must be recognised');
  if(closed.gap>bounds.max[2]*.05)throw Error('Closure gap is too large');
  const nearly=[...loop.slice(0,67)];
  if(seamClosure([nearly],bounds).closed)throw Error('An open arc must not count as a loop');
  console.log('PASS closure detection: gap',closed.gap.toFixed(2),'mm');
}

{ // straight and smooth strokes keep the samples usable
  const from=point(0,0,0,[0,1,0],400),to=point(60,0,30,[0,1,0],300);
  const line=straightStroke(from,to,9);
  if(line.length!==9)throw Error('A straight stroke keeps its sampling');
  if(Math.abs(line[0].p[0])>1e-9||Math.abs(line.at(-1).p[2]-30)>1e-9)throw Error('A straight stroke must keep its ends');
  if(line.some(step=>!validSample(step)))throw Error('Interpolated samples must stay valid');
  const curved=[0,10,0,-10,0,20].map((v,i)=>point(v,i*4,0));
  const smoothed=smoothStroke(curved,2);
  if(smoothed.length!==curved.length)throw Error('Smoothing must keep the sample count');
  if(Math.abs(smoothed[0].p[0])>1e-9||Math.abs(smoothed.at(-1).p[0]-20)>1e-9)throw Error('Smoothing must keep the ends');
  if(Math.abs(smoothed[1].p[0])>=Math.abs(curved[1].p[0]))throw Error('Smoothing must pull the peaks in');
  if(Math.abs(smoothed[3].p[0])>=Math.abs(curved[3].p[0]))throw Error('Smoothing must pull the valleys in');
  const payload=seamPayload([line]);
  if(payload[0][0].r.length!==3||payload[0].length!==line.length)throw Error('Payload mismatch');
  if(payload[0][0].p===line[0].p)throw Error('Payload must be a copy, not a reference');
  console.log('PASS straight strokes, smoothing and payload copy');
}

// ---------------------------------------------------------------- browser ---
const lib=await Module();lib.setup();
const cube=new THREE.Mesh(new THREE.BoxGeometry(100,80,120));
const stl=new STLExporter().parse(cube,{binary:true});
fs.mkdirSync('tests/fixtures',{recursive:true});
fs.writeFileSync('tests/fixtures/cube.stl',Buffer.from(stl.buffer));

const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:1024},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const waitReady=()=>expect(page.locator('#loading')).toBeHidden({timeout:120000});
await page.goto(process.env.TEST_URL||'http://localhost:5173');
await waitReady();
await page.locator('#file-input').setInputFiles('tests/fixtures/cube.stl');
await waitReady();
await expect(page.locator('#file-name')).toHaveText('cube.stl');
await page.waitForTimeout(800);

const rect=await page.locator('#canvas-container canvas').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
const centre={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
const cardText=()=>page.locator('.stroke-card').first().innerText();
const partSizes=()=>page.locator('.part-card').evaluateAll(cards=>cards.map(card=>{
  const text=card.querySelector('.part-info p').textContent;
  return text.replace(' mm','').split('×').map(v=>Number(v.trim().replace(/\./g,'').replace(',','.')));
}));

// A stroke is a real drag with a held left button: the pointer starts and ends
// outside the silhouette, so the seam crosses the whole visible face.
async function draw(heightRatio=.5){
  const y=rect.y+rect.height*heightRatio;
  await page.mouse.move(rect.x+rect.width*.04,y);
  await page.mouse.down({button:'left'});
  for(let i=1;i<=80;i++)await page.mouse.move(rect.x+rect.width*(.04+.92*i/80),y);
  await page.mouse.up({button:'left'});
  await page.waitForTimeout(600);
}
// OrbitControls turns 360° every canvas height of horizontal drag.
async function orbit(degrees){
  const pixels=rect.height*degrees/360;
  await page.mouse.move(centre.x,centre.y);
  await page.mouse.down({button:'right'});
  for(let i=1;i<=16;i++)await page.mouse.move(centre.x+pixels*i/16,centre.y);
  await page.mouse.up({button:'right'});
  await page.waitForTimeout(900);
}
const setView=async name=>{await page.selectOption('#view-orientation',name);await page.waitForTimeout(400);};

// 1. Draw the seam on the visible face of a known view.
await setView('front');
await expect(page.locator('#camera-label')).toHaveText('Frontale');
await page.locator('#viewport-draw').click();
await expect(page.locator('#stroke-banner')).toBeVisible();
await draw();
const seam=await page.evaluate(()=>window.__seam.state.freeCuts[0].strokes[0]);
if(seam.length<10)throw Error(`The drag was not sampled on the surface: ${seam.length} points`);
if(seam.some(step=>Math.abs(step.p[1]+40)>.5))throw Error('Every sample must sit on the visible face');
const ends=[seam[0].p,seam[seam.length-1].p];
// The blade extends both ends beyond the last sample, so the drawn seam only has
// to cross the visible face, not to touch the silhouette exactly.
if(ends[1][0]-ends[0][0]<90)throw Error(`The seam must cross the whole face: ${JSON.stringify(ends)}`);
await expect(page.locator('.part-card')).toHaveCount(2,{timeout:120000});
console.log('PASS the drag is sampled on the surface:',seam.length,'points across',(ends[1][0]-ends[0][0]).toFixed(1),'mm');

// 2. Orbit around the object and continue the same seam on the next face.
await orbit(90);
await draw();
let text=await cardText();
if(!/2 tratti/.test(text))throw Error(`The second stroke was not chained into the seam: ${text}`);
await expect(page.locator('.part-card')).toHaveCount(2,{timeout:120000});
console.log('PASS right drag orbits the model and the seam continues:',text.replace(/\n/g,' · '));

// 3. Keep orbiting until the loop closes around the object.
await orbit(90); await draw();
await orbit(90); await draw();
text=await cardText();
if(!/anello chiuso/.test(text))throw Error(`The loop around the object did not close: ${text}`);
await expect(page.locator('.part-card')).toHaveCount(2,{timeout:120000});
const parts=await partSizes();
if(parts.some(size=>Math.abs(size[0]-100)>2.5||Math.abs(size[1]-80)>2.5))throw Error(`The parts changed footprint: ${JSON.stringify(parts)}`);
const total=parts.reduce((sum,size)=>sum+size[2],0);
if(Math.abs(total-120)>6)throw Error(`The closed seam must cut around the middle: ${parts.map(s=>s[2]).join(' + ')} mm`);
const closure=await page.evaluate(()=>window.__seam.freehand.closure(window.__seam.state.freeCuts[0]));
console.log('PASS closed loop around the object: gap',closure.gap.toFixed(2),'mm → two parts of',parts.map(s=>s[2].toFixed(1)).join(' + '),'mm');

// 4. «Chiudi il taglio» leaves the drawing mode with the cut in place.
const before=await page.locator('.part-card').count();
await page.locator('#close-seam').click();
await expect(page.locator('#stroke-banner')).toBeHidden();
if(await page.locator('.stroke-card').count()!==1)throw Error('The cut must stay in the list');
if(await page.locator('.part-card').count()!==before)throw Error('Closing the seam changed the parts');
await expect(page.locator('#export-all')).toBeEnabled({timeout:120000});
await expect(page.locator('.part-card')).toHaveCount(2,{timeout:120000});
console.log('PASS «Chiudi il taglio» leaves the drawing mode with the cut applied');

// 5. A seam that does not divide the model is refused, the parts survive.
await page.locator('#viewport-draw').click();
await page.mouse.move(centre.x-40,centre.y-14);
await page.mouse.down({button:'left'});
for(let i=1;i<=14;i++)await page.mouse.move(centre.x-40+i*6,centre.y-14+Math.sin(i/3)*8);
await page.mouse.up({button:'left'});
await page.waitForTimeout(900);
await page.locator('#close-seam').click();
await expect(page.locator('#stroke-banner')).toBeHidden();
await page.locator('#apply-cuts').click();
await waitReady();
const refused=await page.evaluate(()=>document.querySelector('#toast').textContent||'');
if(!/non divide|più ampia|allargare|percorso/i.test(refused))throw Error(`A seam that does not divide the model must be explained: “${refused}”`);
if(await page.locator('.part-card').count()!==before)throw Error(`The refused seam changed the parts (${before} → ${await page.locator('.part-card').count()})`);
console.log('PASS a seam that does not divide the model is refused:',refused.trim());

await page.screenshot({path:'tests/seam.png'});
await browser.close();
if(errors.length)throw Error(errors.join('\n'));
console.log('PASS seam drawing: surface samples, orbit, chained strokes, closed split, guards');
