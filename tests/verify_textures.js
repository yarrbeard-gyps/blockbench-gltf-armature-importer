const fs=require('fs'),path=require('path');const core=require(require("path").resolve(process.argv[2]));const dir=process.argv[3];
const exp=JSON.parse(fs.readFileSync(path.join(dir,'expected.json')));
(async()=>{let ok=true;
for (const f of ['tex_embedded.glb','tex_datauri.gltf','tex_external.gltf']){
  const p=path.join(dir,f); const raw=fs.readFileSync(p); let json,bin=null;
  if(f.endsWith('.glb')) ({json,bin}=core.parseGLB(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength))); else json=JSON.parse(raw.toString('utf8'));
  const readExt=async uri=>new Uint8Array(fs.readFileSync(path.join(dir,uri)));
  const buffers=await core.loadBuffers(json,bin,readExt);
  const r=core.convertGLTF(json,buffers,{scale:16,mergeQuads:true,animations:true});
  const imgs=await core.loadImages(json,buffers,readExt);
  const errs=[];
  imgs.forEach((im,i)=>{ if(!im) errs.push('image '+i+' missing'); else if(Buffer.from(im.bytes).toString('base64')!==exp.images[i]) errs.push('image '+i+' bytes differ'); });
  const arm=r.armatures[0]; const m=arm.meshes[0];
  let checked=0;
  m.faces.forEach(face=>{
    const img=core.materialImage(json,face.material);
    face.v.forEach((vi,k)=>{
      const pos=m.vertices[vi].map(x=>x/16); const node=+Object.keys(m.weights[vi])[0];
      const cand=[0,1,2,3,4,5,6,7].filter(o=>Math.abs(exp.P[o*3]-pos[0])<1e-6&&Math.abs(exp.P[o*3+1]-pos[1])<1e-6&&((o<4)===(node===1)));
      if(cand.length!==1){errs.push('vertex match '+cand);return;}
      const o=cand[0]; const wantImg=o<4?0:1; if(img!==wantImg) errs.push(`face corner ${o}: image ${img}, want ${wantImg}`);
      const uv=face.uv[k]; if(Math.abs(uv[0]-exp.UV[o*2])>1e-6||Math.abs(uv[1]-exp.UV[o*2+1])>1e-6) errs.push(`corner ${o}: uv ${uv} want ${exp.UV.slice(o*2,o*2+2)}`);
      checked++;
    });
  });
  console.log(`${f}: ${imgs.length} images (${imgs.map(i=>i&&i.name+' '+i.mime).join(', ')}), ${m.faces.length} faces (${m.faces.map(x=>x.v.length).join('/')}), ${checked} corners checked -> ${errs.length?'FAIL '+errs.join('; '):'PASS'}`);
  if(errs.length) ok=false;
}
process.exit(ok?0:1);})().catch(e=>{console.error(e);process.exit(1);});
