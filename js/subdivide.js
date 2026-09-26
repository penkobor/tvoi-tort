import * as THREE from 'three';

// Loop subdivision for an indexed mesh with relative morph targets and vertex colours.
// Every rule is a linear combination of vertices, so morph deltas and colours use the same stencils.

function weld(geo, precision = 100) {
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  const morphs = geo.morphAttributes.position || [];
  const map = new Map();
  const remap = new Int32Array(pos.count);
  const channels = 2 + morphs.length;
  const data = [];
  const counts = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * precision)},${Math.round(pos.getY(i) * precision)},${Math.round(pos.getZ(i) * precision)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = counts.length;
      map.set(key, id);
      counts.push(0);
      const v = new Float32Array(channels * 3);
      v.set([pos.getX(i), pos.getY(i), pos.getZ(i)], 0);
      morphs.forEach((m, k) => v.set([m.getX(i), m.getY(i), m.getZ(i)], (2 + k) * 3));
      data.push(v);
    }
    const v = data[id];
    v[3] += col.getX(i); v[4] += col.getY(i); v[5] += col.getZ(i);
    counts[id]++;
    remap[i] = id;
  }
  data.forEach((v, id) => { v[3] /= counts[id]; v[4] /= counts[id]; v[5] /= counts[id]; });
  const idx = geo.index;
  const faces = [];
  for (let f = 0; f < idx.count; f += 3) {
    const a = remap[idx.getX(f)], b = remap[idx.getX(f + 1)], c = remap[idx.getX(f + 2)];
    if (a !== b && b !== c && a !== c) faces.push(a, b, c);
  }
  return { verts: data, faces, channels };
}

function loopStep({ verts, faces, channels }) {
  const n = verts.length;
  const L = channels * 3;
  const edges = new Map();
  const ekey = (a, b) => (a < b ? a * n + b : b * n + a);
  const neighbors = Array.from({ length: n }, () => new Set());
  for (let f = 0; f < faces.length; f += 3) {
    const tri = [faces[f], faces[f + 1], faces[f + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3], c = tri[(e + 2) % 3];
      const k = ekey(a, b);
      let rec = edges.get(k);
      if (!rec) { rec = { a, b, opp: [], id: -1 }; edges.set(k, rec); }
      rec.opp.push(c);
      neighbors[a].add(b);
      neighbors[b].add(a);
    }
  }
  const boundaryNb = Array.from({ length: n }, () => []);
  for (const rec of edges.values()) {
    if (rec.opp.length === 1) {
      boundaryNb[rec.a].push(rec.b);
      boundaryNb[rec.b].push(rec.a);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(L);
    const nb = [...neighbors[i]];
    if (boundaryNb[i].length >= 2) {
      const [p, q] = boundaryNb[i];
      for (let c = 0; c < L; c++) v[c] = 0.75 * verts[i][c] + 0.125 * (verts[p][c] + verts[q][c]);
    } else {
      const k = nb.length;
      const beta = k === 3 ? 3 / 16 : 3 / (8 * k);
      for (let c = 0; c < L; c++) {
        let s = 0;
        for (const j of nb) s += verts[j][c];
        v[c] = (1 - k * beta) * verts[i][c] + beta * s;
      }
    }
    // Colours are not smoothed, so thin dark regions (mane, legs) keep their colour.
    v.set(verts[i].subarray(3, 6), 3);
    out.push(v);
  }
  for (const rec of edges.values()) {
    const v = new Float32Array(L);
    const A = verts[rec.a], B = verts[rec.b];
    if (rec.opp.length === 2) {
      const C = verts[rec.opp[0]], D = verts[rec.opp[1]];
      for (let c = 0; c < L; c++) v[c] = 0.375 * (A[c] + B[c]) + 0.125 * (C[c] + D[c]);
      for (let c = 3; c < 6; c++) v[c] = 0.5 * (A[c] + B[c]);
    } else {
      for (let c = 0; c < L; c++) v[c] = 0.5 * (A[c] + B[c]);
    }
    rec.id = out.length;
    out.push(v);
  }
  const nf = [];
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    const ab = edges.get(ekey(a, b)).id, bc = edges.get(ekey(b, c)).id, ca = edges.get(ekey(c, a)).id;
    nf.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
  }
  return { verts: out, faces: nf, channels };
}

export function subdivide(geo, levels = 2) {
  let mesh = weld(geo);
  for (let l = 0; l < levels; l++) mesh = loopStep(mesh);
  const { verts, faces, channels } = mesh;
  const n = verts.length;
  const read = (ch) => {
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set(verts[i].subarray(ch * 3, ch * 3 + 3), i * 3);
    return a;
  };
  const out = new THREE.BufferGeometry();
  const base = read(0);
  out.setAttribute('position', new THREE.BufferAttribute(base, 3));
  out.setAttribute('color', new THREE.BufferAttribute(read(1), 3));
  out.setIndex(faces);
  out.computeVertexNormals();
  const baseN = out.attributes.normal.array;
  const tmp = new THREE.BufferGeometry();
  tmp.setIndex(faces);
  const morphPos = [], morphNor = [];
  for (let k = 2; k < channels; k++) {
    const d = read(k);
    const abs = new Float32Array(n * 3);
    for (let i = 0; i < abs.length; i++) abs[i] = base[i] + d[i];
    tmp.setAttribute('position', new THREE.BufferAttribute(abs, 3));
    tmp.deleteAttribute('normal');
    tmp.computeVertexNormals();
    const tn = tmp.attributes.normal.array;
    const dn = new Float32Array(n * 3);
    for (let i = 0; i < dn.length; i++) dn[i] = tn[i] - baseN[i];
    morphPos.push(new THREE.BufferAttribute(d, 3));
    morphNor.push(new THREE.BufferAttribute(dn, 3));
  }
  out.morphAttributes.position = morphPos;
  out.morphAttributes.normal = morphNor;
  out.morphTargetsRelative = true;
  out.computeBoundingSphere();
  return out;
}
