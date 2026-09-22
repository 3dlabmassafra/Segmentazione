// Optional integration test: a closed synthetic relief with > 1 million input
// triangles. It is generated locally, never downloaded and never uploaded.
import * as THREE from 'three';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const filename='tests/fixtures/dense-relief.stl';
if(process.argv.includes('--generate')){
const N=520,L=N+1,layer=L*L;
const positions=new Float32Array(layer*6),indices=[];
for(let y=0;y<=N;y++)for(let x=0;x<=N;x++){
 const i=y*L+x,X=x/N*25.4,Y=y/N*11.5;
 positions.set([X,Y,3+.5*Math.sin(X*1.5)*Math.cos(Y*1.5)],i*3);
 positions.set([X,Y,0],(i+layer)*3);
}
for(let y=0;y<N;y++)for(let x=0;x<N;x++){
 const a=y*L+x,b=a+1,c=a+L+1,d=a+L;
 indices.push(a,b,c,a,c,d,a+layer,c+layer,b+layer,a+layer,d+layer,c+layer);
}
const perimeter=[];
for(let x=0;x<N;x++)perimeter.push(x);
for(let y=0;y<N;y++)perimeter.push(y*L+N);
for(let x=N;x>0;x--)perimeter.push(N*L+x);
for(let y=N;y>0;y--)perimeter.push(y*L);
perimeter.forEach((a,i)=>{const b=perimeter[(i+1)%perimeter.length];indices.push(a+layer,b+layer,b,a+layer,b,a);});
const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.BufferAttribute(positions,3));geom.setIndex(indices);
const bytes=new STLExporter().parse(new THREE.Mesh(geom),{binary:true});
fs.mkdirSync('tests/fixtures',{recursive:true});fs.writeFileSync(filename,Buffer.from(bytes.buffer));
console.log('Synthetic relief:',indices.length/3,'triangles,',bytes.byteLength,'bytes');
process.exit(0);
}
execFileSync(process.execPath,[import.meta.filename,'--generate'],{stdio:'inherit'});
const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173');await expect(page.locator('#loading')).toBeHidden({timeout:90000});
 await page.locator('#file-input').setInputFiles(filename);await expect(page.locator('#file-name')).toHaveText('dense-relief.stl',{timeout:180000});await expect(page.locator('#loading')).toBeHidden({timeout:180000});
 await page.locator('#view-orientation').selectOption('top');await page.locator('#viewport-draw').click();
 const r=await page.locator('#stroke-overlay').boundingBox();await page.mouse.move(r.x+r.width*.2,r.y+r.height*.48);await page.mouse.down();
 for(let i=1;i<=30;i++){const t=i/30;await page.mouse.move(r.x+r.width*(.2+.6*t),r.y+r.height*(.48+.04*Math.sin(t*2*Math.PI)));}
 await page.mouse.up();await expect(page.locator('.stroke-card')).toHaveCount(1);await page.locator('#quick-preview').click();await expect(page.locator('#loading')).toBeHidden({timeout:180000});await expect(page.locator('.part-card')).toHaveCount(2);
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS dense relief imported and split with a freehand stroke');
}finally{await browser.close();fs.unlinkSync(filename);}
