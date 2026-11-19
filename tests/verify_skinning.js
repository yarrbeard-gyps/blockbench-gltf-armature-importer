const fs = require('fs');
const core = require(require("path").resolve(process.argv[2]));
const { m4Compose, m4Mul, m4Invert, quatFromEuler, m4ApplyPoint } = core.math;
const file = process.argv[3];
const verbose = process.argv[4] === '-v';
const ab = fs.readFileSync(file); const buf = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength);
(async () => {
  const { json, bin } = core.parseGLB(buf);
  const buffers = await core.loadBuffers(json, bin, null);
  const scale = +(process.env.SCALE||16), order = 'ZYX';
  const r = core.convertGLTF(json, buffers, { scale, eulerOrder: order, mergeQuads: true, animations: true });
  console.log('==', file.split(/[\/]/).pop());
  r.armatures.forEach(a => {
    console.log(`armature "${a.name}": ${a.bones.length} bones, meshes: ${a.meshes.map(m => `${m.name}(${m.vertices.length}v ${m.faces.length}f [${m.faces.filter(f=>f.v.length==4).length} quads] ${m.shading})`).join(', ')}`);
    if (verbose) a.bones.forEach(b => console.log(`  bone ${b.name} parent=${b.parentNode} origin=${b.origin.map(v=>v.toFixed(3))} rot=${b.rotation.map(v=>v.toFixed(2))} len=${b.length.toFixed(2)} w=${b.width.toFixed(2)} conn=${b.connected}`));
  });
  console.log('loose meshes:', r.looseMeshes.map(m => m.name).join(', ') || '-');
  r.animations.forEach(an => console.log(`anim "${an.name}" len=${an.length.toFixed(3)} fps=${an.fps} bones=${an.bones.length} keys=${an.bones.reduce((n,b)=>n+b.rotation.length+b.position.length+b.scale.length,0)}`));
  if (verbose) r.animations.forEach(an => an.bones.forEach(b => console.log(`  ${an.name}/${b.name} rot:`, b.rotation.map(k=>`${k.time.toFixed(3)}:[${k.value.map(v=>v.toFixed(2))}]`).join(' '), 'pos:', b.position.length)));
  if (r.warnings.length) console.log('warnings:', r.warnings);

  // ---------- independent reference: glTF skinning
  const nodes = json.nodes;
  const parentOf = nodes.map(() => -1); nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parentOf[c]=i));
  const rest = nodes.map(n => n.matrix ? {m:n.matrix} : {t:n.translation||[0,0,0], q:n.rotation||[0,0,0,1], s:n.scale||[1,1,1]});
  const acc = i => core.readAccessor(json, buffers, i).data;
  function lerp(a,b,u){return a.map((v,i)=>v+(b[i]-v)*u);}
  function slerp(a,b,u){let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]; if(d<0){b=b.map(x=>-x);d=-d;} if(d>0.9995){const r=lerp(a,b,u);const l=Math.hypot(...r);return r.map(x=>x/l);} const th=Math.acos(d),s=Math.sin(th);return a.map((v,i)=>v*Math.sin((1-u)*th)/s+b[i]*Math.sin(u*th)/s);}
  function worldsAt(anim, t) {
    const L = rest.map(x => ({...x}));
    if (anim) anim.channels.forEach(ch => {
      const smp = anim.samplers[ch.sampler]; const inp = acc(smp.input), out = acc(smp.output);
      const sz = ch.target.path === 'rotation' ? 4 : 3; const val = k => out.slice(k*sz,k*sz+sz);
      let v; if (t<=inp[0]) v=val(0); else if (t>=inp[inp.length-1]) v=val(inp.length-1); else { let k=0; while(inp[k+1]<t) k++; const u=(t-inp[k])/(inp[k+1]-inp[k]); v = smp.interpolation==='STEP'?val(k): sz==4?slerp(val(k),val(k+1),u):lerp(val(k),val(k+1),u); }
      const n = ch.target.node; L[n] = {...L[n]}; L[n][{translation:'t',rotation:'q',scale:'s'}[ch.target.path]] = v;
    });
    const W = [];
    const vis = i => W[i] || (W[i] = (()=>{ const l = L[i].m || m4Compose(L[i].t, L[i].q, L[i].s); return parentOf[i]>=0 ? m4Mul(vis(parentOf[i]), l) : l; })());
    nodes.forEach((_,i)=>vis(i)); return W;
  }
  // ---------- Blockbench forward model from converted output
  function bbWorlds(arm, animBones, t) {
    const W = {};
    const delta = (keys, t, base) => { if (!keys || !keys.length) return [base,base,base]; if (t<=keys[0].time) return keys[0].value; if (t>=keys[keys.length-1].time) return keys[keys.length-1].value; let k=0; while(keys[k+1].time<t) k++; const u=(t-keys[k].time)/(keys[k+1].time-keys[k].time); return keys[k].interpolation==='step'?keys[k].value:lerp(keys[k].value,keys[k+1].value,u); };
    arm.bones.forEach(b => {
      const ab = animBones && animBones.find(x => x.node === b.node);
      const dr = ab ? delta(ab.rotation, t, 0) : [0,0,0], dp = ab ? delta(ab.position, t, 0) : [0,0,0], ds = ab ? delta(ab.scale, t, 1) : [1,1,1];
      const local = m4Compose(b.origin.map((v,i)=>v+dp[i]), quatFromEuler(b.rotation.map((v,i)=>v+dr[i]), order), ds);
      W[b.node] = b.parentNode >= 0 ? m4Mul(W[b.parentNode], local) : local;
    });
    return W;
  }
  const skinOfArm = {}; nodes.forEach(n => { if (n.skin!==undefined) { const j0=json.skins[n.skin].joints[0]; r.armatures.forEach((a,ai)=>{ if(a.bones.find(b=>b.node===j0)) skinOfArm[ai]=n.skin; }); } });
  let worst = 0;
  r.armatures.forEach((arm, ai) => {
    const si = skinOfArm[ai]; if (si === undefined) return;
    const skin = json.skins[si]; const ibmData = acc(skin.inverseBindMatrices); const IBM = {}; skin.joints.forEach((j,k)=>IBM[j]=ibmData.slice(k*16,k*16+16));
    const restW = worldsAt(null, 0); const bindToWorld = m4Mul(restW[skin.joints[0]], IBM[skin.joints[0]]); const invB2W = m4Invert(bindToWorld);
    const bbRest = bbWorlds(arm, null, 0); const bbRestInv = {}; for (const k in bbRest) bbRestInv[k] = m4Invert(bbRest[k]);
    const cases = [{anim:null, an:null, times:[0]}].concat(r.animations.map(an => { const anim = json.animations.find(a=>(a.name||'')===an.name); const ts=new Set(); an.bones.forEach(b=>['rotation','position','scale'].forEach(c=>b[c].forEach(k=>ts.add(k.time)))); return {anim, an, times:[...ts]}; }));
    cases.forEach(({anim, an, times}) => {
      let maxErr = 0, size = 0;
      times.forEach(t => {
        const G = worldsAt(anim, t), B = bbWorlds(arm, an && an.bones.filter(b=>b.armature===ai), t);
        arm.meshes.forEach(m => m.vertices.forEach((v, vi) => {
          const w = m.weights[vi]; if (!Object.keys(w).length) return;
          const vw = v.map(x=>x/scale); const vbind = m4ApplyPoint(invB2W, vw);
          let ref=[0,0,0], got=[0,0,0];
          for (const n in w) { const a = m4ApplyPoint(m4Mul(G[n], IBM[n]), vbind); const b = m4ApplyPoint(m4Mul(B[n], bbRestInv[n]), v); for (let i=0;i<3;i++){ref[i]+=a[i]*w[n]*scale; got[i]+=b[i]*w[n];} }
          maxErr = Math.max(maxErr, Math.hypot(ref[0]-got[0],ref[1]-got[1],ref[2]-got[2])); size = Math.max(size, Math.hypot(...ref));
        }));
      });
      worst = Math.max(worst, maxErr/(size||1));
      console.log(`  skin check ${an ? an.name : 'rest pose'}: max vertex error ${maxErr.toExponential(2)} units (model radius ${size.toFixed(1)}) over ${times.length} key times`);
    });
  });
  console.log(worst < 1e-3 ? 'PASS' : 'FAIL relative error ' + worst);
})().catch(e => { console.error(e); process.exit(1); });
