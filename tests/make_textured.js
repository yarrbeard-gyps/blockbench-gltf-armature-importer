// Builds a 2-bone, 2-material skinned test model in three storage variants.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const out = process.argv[2];
function crc32(buf){let c,crc=0xffffffff;for(let n=0;n<buf.length;n++){c=(crc^buf[n])&0xff;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crc=(crc>>>8)^c;}return (crc^0xffffffff)>>>0;}
function png(w,h,pix){ // pix(x,y)->[r,g,b,a]
  const raw=Buffer.alloc((w*4+1)*h); for(let y=0;y<h;y++){raw[y*(w*4+1)]=0; for(let x=0;x<w;x++){const p=pix(x,y); for(let c=0;c<4;c++) raw[y*(w*4+1)+1+x*4+c]=p[c];}}
  const chunk=(t,d)=>{const len=Buffer.alloc(4);len.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
// texture A: 16x8, quadrants red (top-left), green (top-right), blue (bottom-left), yellow (bottom-right)
const texA = png(16,8,(x,y)=> y<4 ? (x<8?[255,0,0,255]:[0,255,0,255]) : (x<8?[0,0,255,255]:[255,255,0,255]));
// texture B: 4x4 top half white, bottom half black
const texB = png(4,4,(x,y)=> y<2?[255,255,255,255]:[0,0,0,255]);
// Geometry: two stacked quads (lower uses mat A, upper uses mat B), 1 unit tall each, along +Y.
const P=[], N=[], UV=[], J=[], W=[], I=[];
function quad(y0, uvs, j){ const base=P.length/3; [[-0.5,y0],[0.5,y0],[0.5,y0+1],[-0.5,y0+1]].forEach(([x,y],k)=>{P.push(x,y,0);N.push(0,0,1);UV.push(...uvs[k]);J.push(j,0,0,0);W.push(1,0,0,0);}); I.push(base,base+1,base+2, base,base+2,base+3); }
// lower quad: bottom edge samples bottom-left (blue)… top edge samples top (red/green)
quad(0, [[0,1],[1,1],[1,0],[0,0]], 0);
// upper quad: only the left half of texture B, rotated UVs to catch any mix-up
quad(1, [[0.5,0],[0.5,1],[0,1],[0,0]], 1);
const idxA=I.slice(0,6), idxB=I.slice(6);
function f32(a){return Buffer.from(new Float32Array(a).buffer);} function u16(a){return Buffer.from(new Uint16Array(a).buffer);} function u8(a){return Buffer.from(new Uint8Array(a));}
const ibm=[...[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], ...[1,0,0,0,0,1,0,0,0,0,1,0,0,-1,0,1]];
const views=[f32(P),f32(N),f32(UV),u8(J),f32(W),u16(idxA),u16(idxB),f32(ibm)];
const pad=b=>Buffer.concat([b,Buffer.alloc((4-b.length%4)%4)]);
function build(mode){
  let parts=views.map(pad), bufferViews=[], off=0;
  const extra = mode==='glb' ? [texA,texB] : [];
  [...parts, ...extra.map(pad)].forEach((p,i)=>{ const raw = i<views.length? views[i] : extra[i-views.length]; bufferViews.push({buffer:0, byteOffset:off, byteLength:raw.length}); off+=p.length; });
  const bin=Buffer.concat([...parts, ...extra.map(pad)]);
  const nv=P.length/3;
  const json={asset:{version:'2.0',generator:'importer texture test'}, scene:0, scenes:[{nodes:[3]}],
    nodes:[{name:'upper',translation:[0,1,0]},{name:'lower',children:[0]},{name:'cards',mesh:0,skin:0},{name:'rig',children:[1,2]}],
    skins:[{joints:[1,0],inverseBindMatrices:7}],
    accessors:[{bufferView:0,componentType:5126,count:nv,type:'VEC3',min:[-0.5,0,0],max:[0.5,2,0]},{bufferView:1,componentType:5126,count:nv,type:'VEC3'},{bufferView:2,componentType:5126,count:nv,type:'VEC2'},{bufferView:3,componentType:5121,count:nv,type:'VEC4'},{bufferView:4,componentType:5126,count:nv,type:'VEC4'},{bufferView:5,componentType:5123,count:6,type:'SCALAR'},{bufferView:6,componentType:5123,count:6,type:'SCALAR'},{bufferView:7,componentType:5126,count:2,type:'MAT4'}],
    materials:[{name:'matA',pbrMetallicRoughness:{baseColorTexture:{index:0}}},{name:'matB',pbrMetallicRoughness:{baseColorTexture:{index:1}}}],
    textures:[{source:0},{source:1}],
    meshes:[{name:'cards',primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2,JOINTS_0:3,WEIGHTS_0:4},indices:5,material:0},{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2,JOINTS_0:3,WEIGHTS_0:4},indices:6,material:1}]}],
    bufferViews: bufferViews,
    buffers:[{byteLength:bin.length}]};
  if (mode==='glb'){ json.images=[{name:'checker',mimeType:'image/png',bufferView:8},{name:'stripes',mimeType:'image/png',bufferView:9}];
    let js=Buffer.from(JSON.stringify(json)); js=Buffer.concat([js,Buffer.alloc((4-js.length%4)%4,0x20)]);
    const hdr=Buffer.alloc(12); hdr.write('glTF',0); hdr.writeUInt32LE(2,4); hdr.writeUInt32LE(12+8+js.length+8+bin.length,8);
    const ch=(len,type)=>{const b=Buffer.alloc(8);b.writeUInt32LE(len,0);b.writeUInt32LE(type,4);return b;};
    fs.writeFileSync(path.join(out,'tex_embedded.glb'), Buffer.concat([hdr,ch(js.length,0x4E4F534A),js,ch(bin.length,0x004E4942),bin]));
  } else if (mode==='datauri'){ json.buffers[0].uri='data:application/octet-stream;base64,'+bin.toString('base64');
    json.images=[{name:'checker',uri:'data:image/png;base64,'+texA.toString('base64')},{name:'stripes',uri:'data:image/png;base64,'+texB.toString('base64')}];
    fs.writeFileSync(path.join(out,'tex_datauri.gltf'), JSON.stringify(json,null,1));
  } else { json.buffers[0].uri='tex_external.bin'; json.images=[{uri:'checker.png'},{uri:'stripes%20b.png'}];
    fs.writeFileSync(path.join(out,'tex_external.gltf'), JSON.stringify(json,null,1)); fs.writeFileSync(path.join(out,'tex_external.bin'), bin);
    fs.writeFileSync(path.join(out,'checker.png'), texA); fs.writeFileSync(path.join(out,'stripes b.png'), texB);
  }
}
['glb','datauri','external'].forEach(build);
fs.writeFileSync(path.join(out,'expected.json'), JSON.stringify({P,UV,matOfVertex:P.map((_,i)=>i).filter(i=>i%3==0).map(i=>i/3<4?0:1), images:[texA.toString('base64'),texB.toString('base64')]}));
console.log('written', fs.readdirSync(out).join(', '));
