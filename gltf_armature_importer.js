/*
 * glTF Armature Importer for Blockbench 5.2+
 *
 * Imports .glb / .gltf files with their skeleton, skin weights, textures and
 * animations into a Generic Model project:
 *   glTF skin            -> Armature with ArmatureBones (names, hierarchy, rest pose)
 *   skinned mesh         -> Mesh inside the armature, JOINTS/WEIGHTS -> bone vertex weights
 *   baseColorTexture     -> Texture
 *   glTF animation       -> Animation with rotation / position / scale keyframes per bone
 *
 * The conversion core (everything above "Blockbench layer") has no Blockbench
 * dependencies, so it can be tested in Node.
 */
(function () {
	'use strict';

	const PLUGIN_ID = 'gltf_armature_importer';
	const VERSION = '1.0.0';

	// ---------------------------------------------------------------- math
	// Column-major 4x4 matrices (same layout as glTF and three.js), quaternions [x,y,z,w].

	function m4Identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }

	function m4Mul(a, b) {
		const r = new Array(16);
		for (let c = 0; c < 4; c++) {
			for (let row = 0; row < 4; row++) {
				r[c * 4 + row] =
					a[row] * b[c * 4] + a[4 + row] * b[c * 4 + 1] +
					a[8 + row] * b[c * 4 + 2] + a[12 + row] * b[c * 4 + 3];
			}
		}
		return r;
	}

	function m4Invert(m) {
		const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = m;
		const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
		const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
		const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
		const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
		const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
		if (det === 0) return m4Identity();
		const d = 1 / det;
		return [
			t11 * d,
			(n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d,
			(n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d,
			(n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d,
			t12 * d,
			(n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d,
			(n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d,
			(n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d,
			t13 * d,
			(n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d,
			(n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d,
			(n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d,
			t14 * d,
			(n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d,
			(n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d,
			(n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d,
		];
	}

	function m4Compose(t, q, s) {
		const [x, y, z, w] = q;
		const x2 = x + x, y2 = y + y, z2 = z + z;
		const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
		const wx = w * x2, wy = w * y2, wz = w * z2;
		return [
			(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
			(xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
			(xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
			t[0], t[1], t[2], 1,
		];
	}

	function quatFromRotMatrix(m) { // m: column-major 16, pure rotation in upper 3x3
		const m11 = m[0], m12 = m[4], m13 = m[8], m21 = m[1], m22 = m[5], m23 = m[9], m31 = m[2], m32 = m[6], m33 = m[10];
		const trace = m11 + m22 + m33;
		let x, y, z, w;
		if (trace > 0) {
			const s = 0.5 / Math.sqrt(trace + 1.0);
			w = 0.25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s;
		} else if (m11 > m22 && m11 > m33) {
			const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
			w = (m32 - m23) / s; x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s;
		} else if (m22 > m33) {
			const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
			w = (m13 - m31) / s; x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s;
		} else {
			const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
			w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s;
		}
		return quatNormalize([x, y, z, w]);
	}

	function m4Decompose(m) {
		let sx = Math.hypot(m[0], m[1], m[2]);
		const sy = Math.hypot(m[4], m[5], m[6]);
		const sz = Math.hypot(m[8], m[9], m[10]);
		const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
		if (det < 0) sx = -sx;
		const r = m.slice();
		const isx = sx ? 1 / sx : 0, isy = sy ? 1 / sy : 0, isz = sz ? 1 / sz : 0;
		r[0] *= isx; r[1] *= isx; r[2] *= isx;
		r[4] *= isy; r[5] *= isy; r[6] *= isy;
		r[8] *= isz; r[9] *= isz; r[10] *= isz;
		return { t: [m[12], m[13], m[14]], q: quatFromRotMatrix(r), s: [sx, sy, sz] };
	}

	function m4ApplyPoint(m, p) {
		const [x, y, z] = p;
		const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
		return [
			(m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
			(m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
			(m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
		];
	}

	function m4ApplyDir(m, p) {
		const [x, y, z] = p;
		return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
	}

	function quatNormalize(q) {
		const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
		return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
	}
	function quatConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
	function quatMul(a, b) {
		const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
		return [
			ax * bw + aw * bx + ay * bz - az * by,
			ay * bw + aw * by + az * bx - ax * bz,
			az * bw + aw * bz + ax * by - ay * bx,
			aw * bw - ax * bx - ay * by - az * bz,
		];
	}
	function quatRotate(q, v) {
		return m4ApplyDir(m4Compose([0, 0, 0], q, [1, 1, 1]), v);
	}
	function quatSlerp(a, b, t) {
		let [bx, by, bz, bw] = b;
		let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
		if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
		if (cos > 0.9995) {
			return quatNormalize([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
		}
		const theta = Math.acos(cos), sin = Math.sin(theta);
		const wa = Math.sin((1 - t) * theta) / sin, wb = Math.sin(t * theta) / sin;
		return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
	}

	const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
	const RAD = 180 / Math.PI;

	// Same conventions as THREE.Euler.setFromRotationMatrix / setFromEuler.
	function eulerFromQuat(q, order) {
		const m = m4Compose([0, 0, 0], q, [1, 1, 1]);
		const m11 = m[0], m12 = m[4], m13 = m[8], m21 = m[1], m22 = m[5], m23 = m[9], m31 = m[2], m32 = m[6], m33 = m[10];
		let x, y, z;
		if (order === 'XYZ') {
			y = Math.asin(clamp(m13, -1, 1));
			if (Math.abs(m13) < 0.9999999) { x = Math.atan2(-m23, m33); z = Math.atan2(-m12, m11); }
			else { x = Math.atan2(m32, m22); z = 0; }
		} else { // ZYX (Blockbench default)
			y = Math.asin(-clamp(m31, -1, 1));
			if (Math.abs(m31) < 0.9999999) { x = Math.atan2(m32, m33); z = Math.atan2(m21, m11); }
			else { x = 0; z = Math.atan2(-m12, m22); }
		}
		return [x * RAD, y * RAD, z * RAD];
	}
	function quatFromEuler(e, order) { // degrees
		const [x, y, z] = e.map(v => v / RAD / 2);
		const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z);
		const s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
		if (order === 'XYZ') {
			return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
		}
		return [s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
	}
	// Pick the Euler solution closest to `prev` (both Tait-Bryan solutions, unwrapped by 360°),
	// so Blockbench's per-axis linear interpolation doesn't spin the long way round.
	function eulerNear(q, order, prev) {
		const a = eulerFromQuat(q, order);
		const b = [a[0] + 180, 180 - a[1], a[2] + 180];
		let best = null, bestDist = Infinity;
		for (const cand of [a, b]) {
			const u = cand.map((v, i) => v + 360 * Math.round((prev[i] - v) / 360));
			const dist = Math.abs(u[0] - prev[0]) + Math.abs(u[1] - prev[1]) + Math.abs(u[2] - prev[2]);
			if (dist < bestDist - 1e-9) { best = u; bestDist = dist; }
		}
		return best;
	}

	const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
	const v3scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
	const v3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const v3len = a => Math.hypot(a[0], a[1], a[2]);
	const v3norm = a => { const l = v3len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

	// ---------------------------------------------------------------- glTF reading

	function parseGLB(arrayBuffer) {
		const dv = new DataView(arrayBuffer);
		if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('Not a GLB file (bad magic).');
		const version = dv.getUint32(4, true);
		if (version !== 2) throw new Error('Only glTF 2.0 is supported (file is version ' + version + ').');
		const total = dv.getUint32(8, true);
		let offset = 12, json = null, bin = null;
		while (offset < total) {
			const len = dv.getUint32(offset, true);
			const type = dv.getUint32(offset + 4, true);
			const start = offset + 8;
			if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer, start, len)));
			else if (type === 0x004E4942) bin = new Uint8Array(arrayBuffer, start, len);
			offset = start + len;
		}
		if (!json) throw new Error('GLB has no JSON chunk.');
		return { json, bin };
	}

	function decodeBase64(b64) {
		if (typeof atob === 'function') {
			const s = atob(b64), out = new Uint8Array(s.length);
			for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
			return out;
		}
		return new Uint8Array(Buffer.from(b64, 'base64'));
	}
	function encodeBase64(bytes) {
		if (typeof btoa === 'function') {
			let s = '';
			for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
			return btoa(s);
		}
		return Buffer.from(bytes).toString('base64');
	}
	function parseDataUri(uri) {
		const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri);
		if (!m) return null;
		return { mime: m[1], bytes: m[2] ? decodeBase64(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3])) };
	}

	/**
	 * @param {object} json glTF JSON
	 * @param {Uint8Array|null} glbBin BIN chunk of a .glb
	 * @param {(uri:string)=>Promise<Uint8Array>} readExternal loads files next to the .gltf
	 */
	async function loadBuffers(json, glbBin, readExternal) {
		const unsupported = (json.extensionsRequired || []).filter(e => e !== 'KHR_materials_unlit' && e !== 'KHR_texture_transform' && e !== 'KHR_mesh_quantization');
		if (unsupported.length) {
			throw new Error('This file needs glTF extensions the importer can\'t decode: ' + unsupported.join(', ') +
				'. Re-export it without Draco/meshopt compression.');
		}
		const buffers = [];
		for (let i = 0; i < (json.buffers || []).length; i++) {
			const b = json.buffers[i];
			if (b.uri === undefined) {
				if (!glbBin) throw new Error('Buffer ' + i + ' has no data.');
				buffers.push(glbBin);
			} else if (b.uri.startsWith('data:')) {
				buffers.push(parseDataUri(b.uri).bytes);
			} else {
				buffers.push(await readExternal(decodeURIComponent(b.uri)));
			}
		}
		return buffers;
	}

	const COMPONENT = {
		5120: [Int8Array, 1, 127], 5121: [Uint8Array, 1, 255], 5122: [Int16Array, 2, 32767],
		5123: [Uint16Array, 2, 65535], 5125: [Uint32Array, 4, 0], 5126: [Float32Array, 4, 0],
	};
	const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

	function bufferViewBytes(json, buffers, viewIndex) {
		const view = json.bufferViews[viewIndex];
		const buf = buffers[view.buffer];
		return { bytes: buf, offset: (buf.byteOffset || 0) + (view.byteOffset || 0), length: view.byteLength, stride: view.byteStride || 0 };
	}

	// Returns {data: number[] (flat), size, count}; normalized ints are converted to floats.
	function readAccessor(json, buffers, index) {
		const acc = json.accessors[index];
		const [Ctor, bytesPer, normMax] = COMPONENT[acc.componentType];
		const size = TYPE_SIZE[acc.type];
		const count = acc.count;
		const data = new Array(count * size).fill(0);
		const normalize = acc.normalized && normMax;

		function readInto(viewIndex, byteOffset, n, target, mapIndex) {
			const { bytes, offset, stride } = bufferViewBytes(json, buffers, viewIndex);
			const elemBytes = bytesPer * size;
			const step = stride || elemBytes;
			const dv = new DataView(bytes.buffer, 0, bytes.buffer.byteLength);
			const base = offset + (byteOffset || 0);
			for (let i = 0; i < n; i++) {
				const at = base + i * step;
				for (let c = 0; c < size; c++) {
					const p = at + c * bytesPer;
					let v;
					switch (acc.componentType) {
						case 5120: v = dv.getInt8(p); break;
						case 5121: v = dv.getUint8(p); break;
						case 5122: v = dv.getInt16(p, true); break;
						case 5123: v = dv.getUint16(p, true); break;
						case 5125: v = dv.getUint32(p, true); break;
						default: v = dv.getFloat32(p, true);
					}
					if (normalize) v = Math.max(v / normMax, -1);
					target[(mapIndex ? mapIndex(i) : i) * size + c] = v;
				}
			}
		}
		if (acc.bufferView !== undefined) readInto(acc.bufferView, acc.byteOffset, count, data);
		if (acc.sparse) {
			const sp = acc.sparse;
			const idxCtor = sp.indices.componentType;
			const iv = bufferViewBytes(json, buffers, sp.indices.bufferView);
			const dv = new DataView(iv.bytes.buffer, 0, iv.bytes.buffer.byteLength);
			const ibase = iv.offset + (sp.indices.byteOffset || 0);
			const ib = idxCtor === 5121 ? 1 : idxCtor === 5123 ? 2 : 4;
			const indices = [];
			for (let i = 0; i < sp.count; i++) {
				const p = ibase + i * ib;
				indices.push(ib === 1 ? dv.getUint8(p) : ib === 2 ? dv.getUint16(p, true) : dv.getUint32(p, true));
			}
			readInto(sp.values.bufferView, sp.values.byteOffset, sp.count, data, i => indices[i]);
		}
		void Ctor;
		return { data, size, count };
	}

	function nodeLocalTRS(node) {
		if (node.matrix) {
			const d = m4Decompose(node.matrix);
			return { t: d.t, q: d.q, s: d.s };
		}
		return {
			t: (node.translation || [0, 0, 0]).slice(),
			q: quatNormalize(node.rotation || [0, 0, 0, 1]),
			s: (node.scale || [1, 1, 1]).slice(),
		};
	}

	// ---------------------------------------------------------------- conversion core

	/**
	 * Convert a loaded glTF into a Blockbench-shaped description.
	 * @param {object} json
	 * @param {Uint8Array[]} buffers
	 * @param {{scale:number, eulerOrder:'ZYX'|'XYZ', mergeQuads:boolean, animations:boolean}} opts
	 */
	function convertGLTF(json, buffers, opts) {
		const scale = opts.scale || 16;
		const order = opts.eulerOrder || 'ZYX';
		const nodes = json.nodes || [];
		const warnings = [];

		// --- hierarchy
		const parentOf = new Array(nodes.length).fill(-1);
		nodes.forEach((n, i) => (n.children || []).forEach(c => { parentOf[c] = i; }));
		const restTRS = nodes.map(nodeLocalTRS);
		function computeWorlds(locals) {
			const world = new Array(nodes.length);
			const visit = i => {
				if (world[i]) return world[i];
				const L = locals[i];
				const local = m4Compose(L.t, L.q, L.s);
				world[i] = parentOf[i] >= 0 ? m4Mul(visit(parentOf[i]), local) : local;
				return world[i];
			};
			for (let i = 0; i < nodes.length; i++) visit(i);
			return world;
		}
		const restWorld = computeWorlds(restTRS);

		// --- armatures: one per group of skins that share joints
		const skins = json.skins || [];
		const skinGroup = skins.map((_, i) => i);
		const find = i => (skinGroup[i] === i ? i : (skinGroup[i] = find(skinGroup[i])));
		const jointOwner = {};
		skins.forEach((skin, si) => skin.joints.forEach(j => {
			if (jointOwner[j] !== undefined) skinGroup[find(si)] = find(jointOwner[j]);
			else jointOwner[j] = si;
		}));

		const armatures = [];
		const armatureOfSkin = {};
		const armatureOfJoint = {};
		skins.forEach((skin, si) => {
			const root = find(si);
			if (armatureOfSkin[root] === undefined) {
				armatureOfSkin[root] = armatures.length;
				armatures.push({ name: null, joints: new Set(), skins: [], bones: [], meshes: [], bindWorld: {} });
			}
			const arm = armatures[armatureOfSkin[root]];
			armatureOfSkin[si] = armatureOfSkin[root];
			arm.skins.push(si);
			skin.joints.forEach(j => { arm.joints.add(j); armatureOfJoint[j] = armatureOfSkin[root]; });
		});

		// Bind pose per joint (world space, before scale): inverse(IBM) mapped through the
		// skin's "bind space -> world" matrix, which keeps the mesh where the file shows it.
		const bindToWorldOfSkin = {};
		skins.forEach((skin, si) => {
			const arm = armatures[armatureOfSkin[si]];
			let ibms = null;
			if (skin.inverseBindMatrices !== undefined) {
				const acc = readAccessor(json, buffers, skin.inverseBindMatrices);
				ibms = skin.joints.map((_, k) => acc.data.slice(k * 16, k * 16 + 16));
			}
			const bindToWorld = ibms ? m4Mul(restWorld[skin.joints[0]], ibms[0]) : m4Identity();
			bindToWorldOfSkin[si] = bindToWorld;
			skin.joints.forEach((j, k) => {
				if (arm.bindWorld[j]) return;
				arm.bindWorld[j] = ibms ? m4Mul(bindToWorld, m4Invert(ibms[k])) : restWorld[j];
			});
		});

		// Rigid meshes parented under a joint become part of that joint's armature.
		function jointAncestor(nodeIndex) {
			let p = parentOf[nodeIndex];
			while (p >= 0) { if (armatureOfJoint[p] !== undefined) return p; p = parentOf[p]; }
			return -1;
		}
		function parentBoneOf(arm, j) {
			let p = parentOf[j];
			while (p >= 0 && !arm.joints.has(p)) p = parentOf[p];
			return p;
		}

		// --- bones
		armatures.forEach((arm, ai) => {
			const joints = [...arm.joints].sort((a, b) => a - b);
			const worldTR = {};
			joints.forEach(j => {
				const d = m4Decompose(arm.bindWorld[j]);
				worldTR[j] = { t: d.t, q: d.q };
			});
			arm.worldTR = worldTR;
			const boneOf = {};
			// parent-first order
			const ordered = [];
			const visit = j => {
				if (boneOf[j]) return;
				const p = parentBoneOf(arm, j);
				if (p >= 0) visit(p);
				const local = localTR(worldTR[j], p >= 0 ? worldTR[p] : null, scale);
				const bone = {
					node: j, parentNode: p,
					name: nodes[j].name || ('bone_' + j),
					origin: local.t,
					quat: local.q,
					rotation: eulerNear(local.q, order, [0, 0, 0]),
					children: [],
				};
				boneOf[j] = bone;
				if (p >= 0) boneOf[p].children.push(bone);
				ordered.push(bone);
			};
			joints.forEach(visit);
			arm.bones = ordered;
			arm.boneOf = boneOf;

			// Bone display: length/width/connected (cosmetic only)
			const lengths = [];
			ordered.forEach(b => {
				b.children.forEach(c => {
					const [x, y, z] = c.origin;
					c.connected = y > 0 && Math.hypot(x, z) < 1e-3 * Math.max(1, Math.abs(y));
				});
				if (b.children.length) {
					b.length = Math.max(0.01, v3len(b.children[0].origin));
					lengths.push(b.length);
				}
			});
			ordered.forEach(b => {
				if (b.connected === undefined) b.connected = false;
				if (!b.children.length) b.length = b.parentNode >= 0 ? boneOf[b.parentNode].length || 4 : 4;
			});
			lengths.sort((a, b) => a - b);
			const median = lengths.length ? lengths[lengths.length >> 1] : 8;
			const width = clamp(median * 0.25, 0.1, 2);
			ordered.forEach(b => { b.width = width; });

			// Armature name: the non-joint node holding the root bones, else the skin name
			const roots = ordered.filter(b => b.parentNode < 0);
			const holder = roots.length ? parentOf[roots[0].node] : -1;
			arm.name = (holder >= 0 && nodes[holder].name) || skins[arm.skins[0]].name || ('armature' + (ai ? ai + 1 : ''));
		});

		// --- meshes
		const looseMeshes = [];
		nodes.forEach((node, ni) => {
			if (node.mesh === undefined) return;
			const gMesh = json.meshes[node.mesh];
			let arm = null, skinIndex = -1, rigidBone = -1, toWorld;
			if (node.skin !== undefined && skins[node.skin]) {
				skinIndex = node.skin;
				arm = armatures[armatureOfSkin[skinIndex]];
				toWorld = bindToWorldOfSkin[skinIndex];
			} else {
				const ja = jointAncestor(ni);
				if (ja >= 0) { arm = armatures[armatureOfJoint[ja]]; rigidBone = ja; }
				toWorld = restWorld[ni];
			}
			const converted = convertMesh(json, buffers, gMesh, node.name || gMesh.name || 'mesh', toWorld, scale,
				skinIndex >= 0 ? skins[skinIndex].joints : null, rigidBone, opts.mergeQuads !== false, warnings);
			if (!converted) return;
			if (arm) {
				arm.meshes.push(converted);
			} else {
				// Keep the node's position as the mesh origin so it's easy to move.
				const o = v3scale([restWorld[ni][12], restWorld[ni][13], restWorld[ni][14]], scale);
				converted.origin = o;
				converted.vertices = converted.vertices.map(v => v3sub(v, o));
				looseMeshes.push(converted);
			}
		});

		// --- animations
		const animations = [];
		if (opts.animations !== false) {
			(json.animations || []).forEach((anim, ai) => {
				const converted = convertAnimation(json, buffers, anim, ai, armatures, nodes, parentOf, restTRS, computeWorlds, scale, order, warnings);
				if (converted) animations.push(converted);
			});
		}

		return {
			armatures: armatures.map(a => ({ name: a.name, bones: a.bones, meshes: a.meshes })),
			looseMeshes,
			animations,
			warnings,
		};
	}

	function localTR(world, parentWorld, scale) {
		if (!parentWorld) return { t: v3scale(world.t, scale), q: world.q };
		const inv = quatConj(parentWorld.q);
		return {
			t: v3scale(quatRotate(inv, v3sub(world.t, parentWorld.t)), scale),
			q: quatNormalize(quatMul(inv, world.q)),
		};
	}

	function convertMesh(json, buffers, gMesh, name, toWorld, scale, skinJoints, rigidBone, mergeQuads, warnings) {
		const vertices = [];      // [x,y,z] in Blockbench units
		const weights = [];       // per vertex: {nodeIndex: weight}
		const normalSets = [];    // per vertex: list of normals seen (for flat/smooth guess)
		const weldMap = new Map();
		const tris = [];          // {v:[a,b,c], uv:[[s,t]x3], material, normal}
		const normalMatrix = toWorld;

		gMesh.primitives.forEach((prim, pi) => {
			const mode = prim.mode === undefined ? 4 : prim.mode;
			if (mode !== 4 && mode !== 5 && mode !== 6) {
				warnings.push(`${name}: primitive ${pi} is not triangles (mode ${mode}), skipped.`);
				return;
			}
			const attr = prim.attributes;
			if (attr.POSITION === undefined) return;
			const pos = readAccessor(json, buffers, attr.POSITION);
			const nrm = attr.NORMAL !== undefined ? readAccessor(json, buffers, attr.NORMAL) : null;
			const uv = attr.TEXCOORD_0 !== undefined ? readAccessor(json, buffers, attr.TEXCOORD_0) : null;
			const jointSets = [], weightSets = [];
			for (let s = 0; attr['JOINTS_' + s] !== undefined && attr['WEIGHTS_' + s] !== undefined; s++) {
				jointSets.push(readAccessor(json, buffers, attr['JOINTS_' + s]));
				weightSets.push(readAccessor(json, buffers, attr['WEIGHTS_' + s]));
			}

			// Map this primitive's vertex index -> welded vertex index
			const local = new Array(pos.count);
			for (let i = 0; i < pos.count; i++) {
				const p = v3scale(m4ApplyPoint(toWorld, [pos.data[i * 3], pos.data[i * 3 + 1], pos.data[i * 3 + 2]]), scale);
				let w = {};
				if (skinJoints && jointSets.length) {
					let sum = 0;
					jointSets.forEach((js, s) => {
						for (let c = 0; c < 4; c++) {
							const wt = weightSets[s].data[i * 4 + c];
							if (!(wt > 1e-4)) continue;
							const node = skinJoints[js.data[i * 4 + c]];
							if (node === undefined) continue;
							w[node] = (w[node] || 0) + wt;
							sum += wt;
						}
					});
					if (sum > 0) for (const k in w) w[k] /= sum;
				} else if (rigidBone >= 0) {
					w[rigidBone] = 1;
				}
				const wkey = Object.keys(w).sort().map(k => k + ':' + w[k].toFixed(3)).join(',');
				const key = p.map(v => v.toFixed(4)).join(',') + '|' + wkey;
				let vi = weldMap.get(key);
				if (vi === undefined) {
					vi = vertices.length;
					weldMap.set(key, vi);
					vertices.push(p);
					weights.push(w);
					normalSets.push([]);
				}
				if (nrm) normalSets[vi].push(v3norm(m4ApplyDir(normalMatrix, [nrm.data[i * 3], nrm.data[i * 3 + 1], nrm.data[i * 3 + 2]])));
				local[i] = { vi, uv: uv ? [uv.data[i * 2], uv.data[i * 2 + 1]] : [0, 0] };
			}

			let idx;
			if (prim.indices !== undefined) idx = readAccessor(json, buffers, prim.indices).data;
			else idx = Array.from({ length: pos.count }, (_, i) => i);
			const triIdx = [];
			if (mode === 4) for (let i = 0; i + 2 < idx.length; i += 3) triIdx.push([idx[i], idx[i + 1], idx[i + 2]]);
			else if (mode === 5) for (let i = 0; i + 2 < idx.length; i++) triIdx.push(i % 2 ? [idx[i + 1], idx[i], idx[i + 2]] : [idx[i], idx[i + 1], idx[i + 2]]);
			else for (let i = 1; i + 1 < idx.length; i++) triIdx.push([idx[0], idx[i], idx[i + 1]]);

			// A negative-determinant transform mirrors the mesh: flip winding to keep faces outward.
			const m = toWorld;
			const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
			triIdx.forEach(t => {
				if (det < 0) t = [t[0], t[2], t[1]];
				const c = t.map(k => local[k]);
				const vs = c.map(x => x.vi);
				if (vs[0] === vs[1] || vs[1] === vs[2] || vs[0] === vs[2]) return; // degenerate after welding
				const n = v3cross(v3sub(vertices[vs[1]], vertices[vs[0]]), v3sub(vertices[vs[2]], vertices[vs[0]]));
				tris.push({ v: vs, uv: c.map(x => x.uv), material: prim.material === undefined ? -1 : prim.material, normal: v3norm(n) });
			});
		});
		if (!tris.length) return null;

		// Triangles -> quads where two consecutive triangles form a flat, convex quad.
		const faces = [];
		const sameUV = (a, b) => Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
		function tryMerge(A, B) {
			if (A.material !== B.material) return null;
			const shared = A.v.filter(v => B.v.includes(v));
			if (shared.length !== 2) return null;
			if (v3dot(A.normal, B.normal) < 0.9999) return null;
			// rotate A so its unshared vertex comes first: (p, q, r) with q,r shared
			let k = A.v.findIndex(v => !shared.includes(v));
			const ra = [0, 1, 2].map(i => (k + i) % 3);
			const [p, q, r] = ra.map(i => A.v[i]);
			const uvA = {}; ra.forEach(i => { uvA[A.v[i]] = A.uv[i]; });
			// B must contain the edge r -> q (opposite direction) for consistent winding
			const bi = B.v.indexOf(r);
			if (B.v[(bi + 1) % 3] !== q) return null;
			const sIdx = (bi + 2) % 3;
			const s = B.v[sIdx];
			for (let i = 0; i < 3; i++) if (B.v[i] !== s && !sameUV(B.uv[i], uvA[B.v[i]])) return null;
			const quad = [p, q, s, r];
			for (let i = 0; i < 4; i++) {
				const a = vertices[quad[i]], b = vertices[quad[(i + 1) % 4]], c = vertices[quad[(i + 2) % 4]];
				if (v3dot(v3cross(v3sub(b, a), v3sub(c, b)), A.normal) <= 1e-9) return null;
			}
			const uvs = { ...uvA }; uvs[s] = B.uv[sIdx];
			return { v: quad, uv: quad.map(v => uvs[v]), material: A.material };
		}
		for (let i = 0; i < tris.length; i++) {
			const merged = mergeQuads && i + 1 < tris.length ? tryMerge(tris[i], tris[i + 1]) : null;
			if (merged) { faces.push(merged); i++; }
			else faces.push({ v: tris[i].v, uv: tris[i].uv, material: tris[i].material });
		}

		// Flat or smooth? If welded vertices carried different normals, the file was flat-shaded.
		let split = 0, total = 0;
		normalSets.forEach(list => {
			if (list.length < 2) return;
			total++;
			if (list.some(n => v3dot(n, list[0]) < 0.996)) split++;
		});
		const shading = total && split / total > 0.3 ? 'flat' : (total ? 'smooth' : 'flat');

		return { name, vertices, faces, weights, shading, origin: [0, 0, 0] };
	}

	// ---- animation sampling
	function sampleSampler(json, buffers, sampler, cache) {
		if (!cache.has(sampler)) {
			const input = readAccessor(json, buffers, sampler.input).data;
			const out = readAccessor(json, buffers, sampler.output);
			cache.set(sampler, { input, output: out.data, interp: sampler.interpolation || 'LINEAR' });
		}
		return cache.get(sampler);
	}
	function evalSampler(s, t, size, isQuat) {
		const { input, output, interp } = s;
		const n = input.length;
		const cubic = interp === 'CUBICSPLINE';
		const stride = cubic ? size * 3 : size;
		const valueAt = k => {
			const o = k * stride + (cubic ? size : 0);
			return output.slice(o, o + size);
		};
		if (t <= input[0] || n === 1) return valueAt(0);
		if (t >= input[n - 1]) return valueAt(n - 1);
		let lo = 0, hi = n - 1;
		while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (input[mid] <= t) lo = mid; else hi = mid; }
		const t0 = input[lo], t1 = input[hi], dt = t1 - t0;
		const u = dt > 0 ? (t - t0) / dt : 0;
		if (interp === 'STEP') return valueAt(lo);
		if (cubic) {
			const v0 = valueAt(lo), v1 = valueAt(hi);
			const b0 = output.slice(lo * stride + 2 * size, lo * stride + 3 * size);
			const a1 = output.slice(hi * stride, hi * stride + size);
			const u2 = u * u, u3 = u2 * u;
			const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
			const r = v0.map((_, i) => h00 * v0[i] + h10 * dt * b0[i] + h01 * v1[i] + h11 * dt * a1[i]);
			return isQuat ? quatNormalize(r) : r;
		}
		const a = valueAt(lo), b = valueAt(hi);
		if (isQuat) return quatSlerp(quatNormalize(a), quatNormalize(b), u);
		return a.map((v, i) => v + (b[i] - v) * u);
	}

	function convertAnimation(json, buffers, anim, ai, armatures, nodes, parentOf, restTRS, computeWorlds, scale, order, warnings) {
		const cache = new Map();
		const channelsByNode = {};
		let length = 0;
		anim.channels.forEach(ch => {
			const node = ch.target && ch.target.node;
			const path = ch.target && ch.target.path;
			if (node === undefined || !['translation', 'rotation', 'scale'].includes(path)) return;
			const s = sampleSampler(json, buffers, anim.samplers[ch.sampler], cache);
			length = Math.max(length, s.input[s.input.length - 1] || 0);
			(channelsByNode[node] = channelsByNode[node] || []).push({ path, sampler: s });
		});
		if (!Object.keys(channelsByNode).length) return null;

		const poseCache = new Map();
		function poseAt(t) {
			const key = t.toFixed(6);
			if (poseCache.has(key)) return poseCache.get(key);
			const locals = restTRS.map(trs => ({ t: trs.t, q: trs.q, s: trs.s }));
			for (const node in channelsByNode) {
				const L = locals[node] = { ...locals[node] };
				channelsByNode[node].forEach(({ path, sampler }) => {
					if (path === 'translation') L.t = evalSampler(sampler, t, 3, false);
					else if (path === 'rotation') L.q = quatNormalize(evalSampler(sampler, t, 4, true));
					else L.s = evalSampler(sampler, t, 3, false);
				});
			}
			const world = computeWorlds(locals);
			const pose = { world, locals, tr: {} };
			poseCache.set(key, pose);
			return pose;
		}
		// Blockbench bone world matrices, in Blockbench units:
		//   rest:  W_bb(j) = T(bind position * scale) R(bind rotation)   (no scale)
		//   posed: W_bb(j,t) = K_j(t) * W_bb(j),  K_j(t) = S * W_t(j) * inverse(bindWorld_j) * S^-1
		// K_j is exactly the glTF skinning transform, so meshes deform identically. Each bone's
		// local matrix is then inverse(W_bb(parent,t)) * W_bb(j,t), decomposed into Blockbench's
		// position / rotation / scale. Working with full matrices keeps a parent's non-uniform
		// scale on the parent, the same way three.js (and Blockbench) composes the hierarchy.
		const S = m4Compose([0, 0, 0], [0, 0, 0, 1], [scale, scale, scale]);
		const Sinv = m4Compose([0, 0, 0], [0, 0, 0, 1], [1 / scale, 1 / scale, 1 / scale]);
		const restBB = {}, invBind = {};
		armatures.forEach(arm => arm.bones.forEach(b => {
			const w = arm.worldTR[b.node];
			restBB[b.node] = m4Compose(v3scale(w.t, scale), w.q, [1, 1, 1]);
			invBind[b.node] = m4Invert(arm.bindWorld[b.node]);
		}));
		function bbWorldAt(pose, node) {
			pose.bb = pose.bb || {};
			if (!pose.bb[node]) pose.bb[node] = m4Mul(m4Mul(m4Mul(m4Mul(S, pose.world[node]), invBind[node]), Sinv), restBB[node]);
			return pose.bb[node];
		}

		const result = { name: anim.name || ('animation_' + ai), length, bones: [] };

		armatures.forEach((arm, armIndex) => {
			arm.bones.forEach(bone => {
				const j = bone.node;
				// Nodes whose motion moves this bone relative to its Blockbench parent:
				// the joint itself and any non-joint nodes between it and the parent bone.
				const own = channelsByNode[j] || [];
				const between = [];
				let p = parentOf[j];
				while (p >= 0 && p !== bone.parentNode) { if (channelsByNode[p]) between.push(...channelsByNode[p]); p = parentOf[p]; }

				const timesFor = path => {
					const set = new Set();
					own.filter(c => c.path === path).forEach(c => c.sampler.input.forEach(x => set.add(x)));
					between.forEach(c => c.sampler.input.forEach(x => set.add(x)));
					return set.size ? [...set].sort((a, b) => a - b) : [0];
				};
				const interpFor = path => {
					const c = own.find(c => c.path === path);
					return c && c.sampler.interp === 'STEP' ? 'step' : 'linear';
				};
				const parentNode = bone.parentNode;
				const bbLocal = t => {
					const pose = poseAt(t);
					const w = bbWorldAt(pose, j);
					return m4Decompose(parentNode >= 0 ? m4Mul(m4Invert(bbWorldAt(pose, parentNode)), w) : w);
				};

				const out = { node: j, armature: armIndex, name: bone.name, rotation: [], position: [], scale: [] };
				let prev = bone.rotation;
				timesFor('rotation').forEach(t => {
					const e = eulerNear(bbLocal(t).q, order, prev);
					prev = e;
					out.rotation.push({ time: t, value: v3sub(e, bone.rotation), interpolation: interpFor('rotation') });
				});
				timesFor('translation').forEach(t => {
					out.position.push({ time: t, value: v3sub(bbLocal(t).t, bone.origin), interpolation: interpFor('translation') });
				});
				timesFor('scale').forEach(t => {
					out.scale.push({ time: t, value: bbLocal(t).s, interpolation: interpFor('scale') });
				});
				// Drop channels that never leave the rest pose.
				const still = (keys, base, eps) => keys.every(k => k.value.every(v => Math.abs(v - base) < eps));
				if (still(out.rotation, 0, 1e-3)) out.rotation = [];
				if (still(out.position, 0, 1e-4)) out.position = [];
				if (still(out.scale, 1, 1e-5)) out.scale = [];
				if (out.rotation.length || out.position.length || out.scale.length) result.bones.push(out);
			});
		});

		// Snapping: guess the frame rate the keys were baked at.
		const allTimes = new Set();
		Object.values(channelsByNode).forEach(list => list.forEach(c => c.sampler.input.forEach(x => allTimes.add(x))));
		result.fps = guessFps([...allTimes]);
		if (!result.bones.length) warnings.push(`Animation "${result.name}" only moves non-bone nodes; nothing imported for it.`);
		return result;
	}

	function guessFps(times) {
		for (const fps of [24, 30, 60, 25, 20, 50, 12, 15, 48, 120]) {
			if (times.every(t => Math.abs(t * fps - Math.round(t * fps)) < 0.02)) return fps;
		}
		return 0;
	}

	// Images: returns [{name, mime, bytes}] per glTF image index
	async function loadImages(json, buffers, readExternal) {
		const out = [];
		for (let i = 0; i < (json.images || []).length; i++) {
			const img = json.images[i];
			try {
				let bytes, mime = img.mimeType;
				if (img.bufferView !== undefined) {
					const v = bufferViewBytes(json, buffers, img.bufferView);
					bytes = new Uint8Array(v.bytes.buffer, v.offset, v.length).slice();
				} else if (img.uri && img.uri.startsWith('data:')) {
					const d = parseDataUri(img.uri); bytes = d.bytes; mime = mime || d.mime;
				} else if (img.uri) {
					bytes = await readExternal(decodeURIComponent(img.uri));
					if (!mime) mime = /\.jpe?g$/i.test(img.uri) ? 'image/jpeg' : /\.webp$/i.test(img.uri) ? 'image/webp' : 'image/png';
				}
				const fallback = img.uri && !img.uri.startsWith('data:') ? decodeURIComponent(img.uri).split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : null;
				out.push(bytes ? { name: img.name || fallback || ('texture_' + i), mime: mime || 'image/png', bytes } : null);
			} catch (err) {
				out.push(null);
			}
		}
		return out;
	}
	// material index -> image index (baseColor, or KHR_materials_pbrSpecularGlossiness diffuse)
	function materialImage(json, materialIndex) {
		const mat = (json.materials || [])[materialIndex];
		if (!mat) return -1;
		let texInfo = mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture;
		if (!texInfo && mat.extensions && mat.extensions.KHR_materials_pbrSpecularGlossiness) texInfo = mat.extensions.KHR_materials_pbrSpecularGlossiness.diffuseTexture;
		if (!texInfo) return -1;
		const tex = (json.textures || [])[texInfo.index];
		if (!tex) return -1;
		let src = tex.source;
		if (src === undefined && tex.extensions) {
			for (const k in tex.extensions) if (tex.extensions[k].source !== undefined) src = tex.extensions[k].source;
		}
		return src === undefined ? -1 : src;
	}

	const core = {
		parseGLB, loadBuffers, readAccessor, convertGLTF, loadImages, materialImage,
		math: { m4Compose, m4Mul, m4Invert, m4Decompose, quatFromEuler, eulerFromQuat, quatMul, quatRotate, m4ApplyPoint },
	};
	// Outside Blockbench (Node tests) export the core and stop here.
	if (typeof Plugin === 'undefined' || typeof BARS === 'undefined') {
		if (typeof module === 'object' && module && module.exports) module.exports = core;
		return;
	}

	// ================================================================ Blockbench layer

	let importAction, importDialog;

	function readFileBinary(path) {
		return new Promise((resolve, reject) => {
			Blockbench.read([path], { readtype: 'binary', errorbox: false }, files => {
				if (files && files[0] && files[0].content) resolve(new Uint8Array(files[0].content));
				else reject(new Error('Could not read ' + path));
			});
			setTimeout(() => reject(new Error('Could not read ' + path)), 15000);
		});
	}

	function imageSize(dataUrl) {
		return new Promise(resolve => {
			const img = new Image();
			img.onload = () => resolve([img.naturalWidth || 16, img.naturalHeight || 16]);
			img.onerror = () => resolve([16, 16]);
			img.src = dataUrl;
		});
	}

	async function importFile(file, options) {
		const isGlb = /\.glb$/i.test(file.path || file.name || '') ||
			(file.content instanceof ArrayBuffer && new DataView(file.content).getUint32(0, true) === 0x46546C67);
		let json, bin = null;
		if (isGlb) {
			({ json, bin } = parseGLB(file.content));
		} else {
			const text = typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content);
			json = JSON.parse(text);
		}
		const dir = file.path && typeof PathModule !== 'undefined' ? PathModule.dirname(file.path) : null;
		const readExternal = uri => {
			if (!dir) throw new Error('External file "' + uri + '" can\'t be loaded here. Use a .glb instead.');
			return readFileBinary(PathModule.join(dir, uri));
		};
		const buffers = await loadBuffers(json, bin, readExternal);

		// Make sure we're in a format with armatures and meshes.
		if (!Project || !Format || !Format.armature_rig || !Format.meshes) {
			newProject(Formats.free);
			Project.name = (file.name || 'model').replace(/\.(glb|gltf)$/i, '');
		}

		const result = convertGLTF(json, buffers, {
			scale: options.scale,
			eulerOrder: Format.euler_order || 'ZYX',
			mergeQuads: options.merge_quads,
			animations: options.animations,
		});
		if (!result.armatures.length && !result.looseMeshes.length) {
			throw new Error('No meshes or skins found in this file.');
		}

		// Textures
		const images = await loadImages(json, buffers, uri => readExternal(uri));
		const usedImages = new Set();
		[...result.looseMeshes, ...result.armatures.flatMap(a => a.meshes)].forEach(m => m.faces.forEach(f => {
			const img = materialImage(json, f.material);
			if (img >= 0) usedImages.add(img);
		}));
		const textureOfImage = {};
		const newTextures = [];
		for (const ii of [...usedImages].sort((a, b) => a - b)) {
			const img = images[ii];
			if (!img) continue;
			const dataUrl = 'data:' + img.mime + ';base64,' + encodeBase64(img.bytes);
			const [w, h] = await imageSize(dataUrl);
			const tex = new Texture({ name: img.name });
			tex.uv_width = w;
			tex.uv_height = h;
			tex.fromDataURL(dataUrl);
			textureOfImage[ii] = tex;
			newTextures.push(tex);
		}

		Undo.initEdit({ outliner: true, elements: [], textures: [], animations: options.animations ? [] : undefined, selection: true });
		newTextures.forEach(t => t.add(false));

		const newElements = [];
		const boneByNode = {};

		function buildMesh(m, parent) {
			const mesh = new Mesh({ name: m.name, vertices: {}, origin: m.origin, shading: m.shading });
			const keys = mesh.addVertices(...m.vertices);
			const faces = m.faces.map(f => {
				const tex = textureOfImage[materialImage(json, f.material)];
				const uw = tex ? tex.uv_width : Project.texture_width;
				const uh = tex ? tex.uv_height : Project.texture_height;
				const uv = {};
				f.v.forEach((vi, i) => { uv[keys[vi]] = [f.uv[i][0] * uw, f.uv[i][1] * uh]; });
				return new MeshFace(mesh, { vertices: f.v.map(vi => keys[vi]), uv, texture: tex ? tex.uuid : false });
			});
			mesh.addFaces(...faces);
			mesh.addTo(parent || 'root').init();
			newElements.push(mesh);
			// Skin weights -> bone.vertex_weights ("meshuuid6:vertexkey" since 5.2)
			m.weights.forEach((w, vi) => {
				for (const node in w) {
					const bone = boneByNode[node];
					if (bone && w[node] > 0) bone.setVertexWeight(mesh, keys[vi], w[node]);
				}
			});
			return mesh;
		}

		result.armatures.forEach(a => {
			const armature = new Armature({ name: a.name });
			armature.addTo('root');
			armature.isOpen = true;
			armature.init();
			newElements.push(armature);
			a.bones.forEach(b => {
				const bone = new ArmatureBone({
					origin: b.origin.slice(),
					rotation: b.rotation.slice(),
					length: b.length,
					width: b.width,
					connected: !!b.connected,
				});
				bone.name = b.name; // keep the exact glTF name (e.g. "mixamorig:Hips") so re-exports match
				bone.isOpen = b.parentNode < 0;
				bone.addTo(b.parentNode >= 0 ? boneByNode[b.parentNode] : armature);
				bone.init();
				boneByNode[b.node] = bone;
				newElements.push(bone);
			});
			a.meshes.forEach(m => buildMesh(m, armature));
		});
		result.looseMeshes.forEach(m => buildMesh(m, null));

		// Animations
		const AnimationClass = window.BBAnimation || Animation;
		const newAnimations = [];
		if (options.animations) {
			result.animations.forEach(anim => {
				const animators = {};
				anim.bones.forEach(b => {
					const bone = boneByNode[b.node];
					if (!bone) return;
					const keyframes = [];
					for (const channel of ['rotation', 'position', 'scale']) {
						b[channel].forEach(k => {
							keyframes.push({
								channel,
								time: Math.round(k.time * 1e5) / 1e5,
								interpolation: k.interpolation,
								data_points: [{ x: round(k.value[0]), y: round(k.value[1]), z: round(k.value[2]) }],
							});
						});
					}
					animators[bone.uuid] = { name: bone.name, type: 'armature_bone', keyframes };
				});
				if (!Object.keys(animators).length) return;
				const data = {
					name: anim.name,
					loop: /[-_]loop$/i.test(anim.name) ? 'loop' : 'once',
					length: Math.round(anim.length * 1e5) / 1e5,
					animators,
				};
				if (anim.fps >= 10) data.snapping = anim.fps;
				const animation = new AnimationClass(data).add(false);
				newAnimations.push(animation);
			});
		}

		Canvas.updateAllBones();
		Canvas.updateAll();
		Undo.finishEdit('Import glTF with armature', {
			outliner: true, elements: newElements, textures: newTextures,
			animations: options.animations ? newAnimations : undefined, selection: true,
		});
		updateSelection();

		const boneCount = result.armatures.reduce((n, a) => n + a.bones.length, 0);
		const meshCount = result.looseMeshes.length + result.armatures.reduce((n, a) => n + a.meshes.length, 0);
		Blockbench.showQuickMessage(
			`Imported ${boneCount} bones, ${meshCount} meshes, ${newTextures.length} textures, ${newAnimations.length} animations`, 3000);
		if (result.warnings.length) console.warn('[glTF importer]', result.warnings.join('\n'));
	}

	function round(v) { return Math.round(v * 1e5) / 1e5; }

	function pickAndImport(options) {
		Blockbench.import({
			resource_id: 'gltf',
			extensions: ['glb', 'gltf'],
			type: 'glTF Model',
			readtype: path => (/\.glb$/i.test(path) ? 'binary' : 'text'),
		}, files => {
			if (!files || !files[0]) return;
			importFile(files[0], options).catch(err => {
				console.error(err);
				Blockbench.showMessageBox({ title: 'glTF import failed', message: String(err && err.message || err), icon: 'error' });
			});
		});
	}

	Plugin.register(PLUGIN_ID, {
		title: 'glTF Armature Importer',
		author: 'yarrbeard-gyps',
		description: 'Import .glb/.gltf with armature, bone weights, textures and animations.',
		icon: 'accessibility',
		version: VERSION,
		variant: 'desktop',
		min_version: '5.2.0',
		tags: ['Importer', 'Animation'],
		onload() {
			importDialog = new Dialog('gltf_armature_import_dialog', {
				title: 'Import glTF (with armature)',
				form: {
					// Default 16 = Blockbench's default Model Export Scale, so a default export re-imports 1:1.
					scale: { label: 'Import Scale (units per metre)', description: 'Match the Model Export Scale the file was exported with: 16 by default, 100 for 1 unit = 1 cm.', type: 'number', value: 16, min: 0.0001, step: 1 },
					animations: { label: 'Import animations', type: 'checkbox', value: true },
					merge_quads: { label: 'Rebuild quads from triangles', type: 'checkbox', value: true },
				},
				onConfirm(result) {
					pickAndImport({
						scale: Number(result.scale) || 16,
						animations: !!result.animations,
						merge_quads: !!result.merge_quads,
					});
				},
			});
			importAction = new Action('import_gltf_armature', {
				name: 'Import glTF with Armature...',
				description: 'Import a .glb or .gltf including skeleton, weights, textures and animations',
				icon: 'accessibility',
				category: 'file',
				click() { importDialog.show(); },
			});
			MenuBar.addAction(importAction, 'file.import');
		},
		onunload() {
			if (importAction) importAction.delete();
			if (importDialog) importDialog.delete && importDialog.delete();
		},
	});
})();
