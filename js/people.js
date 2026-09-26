import * as THREE from 'three';
import { toTexture, toon } from './fx.js';

// Two guests holding the cake: the full photo cutout as a gently curved standee, 3D legs below it.

export async function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// The cutout cropped to its opaque pixels; the bottom edge optionally dissolves.
export function photoTexture(img, { fade = 0 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!img) {
    c.width = 512;
    c.height = 640;
    g.font = '300px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('😊', 256, 200);
    return { tex: toTexture(c), aspect: 0.8 };
  }
  c.width = img.width;
  c.height = img.height;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const scale = Math.min(1, 1000 / Math.max(w, h));
  const pw = Math.round(w * scale), ph = Math.round(h * scale);
  // A dark ink line around the figure, like the outlines on the cartoon characters.
  const line = Math.max(3, Math.round(Math.max(pw, ph) * 0.006));
  const sil = document.createElement('canvas');
  sil.width = pw;
  sil.height = ph;
  const s = sil.getContext('2d');
  s.drawImage(c, x0, y0, w, h, 0, 0, pw, ph);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = '#1a0e08';
  s.fillRect(0, 0, pw, ph);
  const out = document.createElement('canvas');
  out.width = pw + line * 2;
  out.height = ph + line * 2;
  const o = out.getContext('2d');
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    o.drawImage(sil, line + Math.cos(a) * line, line + Math.sin(a) * line);
  }
  o.drawImage(c, x0, y0, w, h, line, line, pw, ph);
  if (fade > 0) {
    o.globalCompositeOperation = 'destination-in';
    const grad = o.createLinearGradient(0, 0, 0, out.height);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1 - fade, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = grad;
    o.fillRect(0, 0, out.width, out.height);
  }
  const tex = toTexture(out);
  tex.anisotropy = 4;
  return { tex, aspect: out.width / out.height };
}

const std = (color) => toon({ color });

function limb(a, b, r, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, a.distanceTo(b), 6, 14), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

// Origin at the bottom centre, facing +z; the sides bend back a little so the light reads as volume.
function standee({ tex, aspect }, height) {
  const width = height * aspect;
  const geo = new THREE.PlaneGeometry(width, height, 24, 1);
  geo.translate(0, height / 2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / (width / 2);
    pos.setZ(i, -0.12 * width * u * u);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, alphaTest: 0.1, roughness: 0.85, side: THREE.DoubleSide,
    emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3,
  });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
  return m;
}

// Ankle, calf, knee and thigh, scaled to the leg length.
function shapedLeg(top, r, mat) {
  const k = top / 0.55;
  const profile = [[0.55, 0.06], [0.55, 0.08], [0.62, 0.16], [1, 0.3], [0.82, 0.42], [1.1, 0.55]];
  const curve = new THREE.SplineCurve(profile.map(([f, y]) => new THREE.Vector2(f * r, y * k)));
  const pts = [new THREE.Vector2(0.001, 0.06 * k), ...curve.getPoints(24), new THREE.Vector2(0.001, 0.56 * k)];
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), mat);
  m.castShadow = true;
  return m;
}

function legs(g, { x, top, r, mat, shoeMat, shoe, shaped = false }) {
  for (const s of [-1, 1]) {
    if (shaped) {
      const leg = shapedLeg(top, r, mat);
      leg.position.set(s * x, 0, -0.06);
      g.add(leg);
    } else {
      g.add(limb(new THREE.Vector3(s * x, 0.1, -0.06), new THREE.Vector3(s * x, top, -0.06), r, mat));
    }
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), shoeMat);
    m.scale.set(...shoe);
    m.position.set(s * x, shoe[1], -0.02);
    m.castShadow = true;
    g.add(m);
  }
}

// Left guest: the photo runs from the head to the dress hem; bare legs and beige shoes below.
export function makeBigGuest(cfg, photo) {
  const g = new THREE.Group();
  legs(g, { x: 0.1, top: 0.5, r: 0.07, shaped: true, mat: std(cfg.legs), shoeMat: std(cfg.shoes), shoe: [0.06, 0.04, 0.12] });
  const body = standee(photo, 1.5);
  body.position.y = 0.34;
  g.add(body);
  return { root: g, body, baseY: 0.34 };
}

// Right guest: the photo runs from the head to the hips; the long coat and trousers continue below.
export function makeTallGuest(cfg, photo) {
  const g = new THREE.Group();
  legs(g, { x: 0.085, top: 0.85, r: 0.058, mat: std(cfg.legs), shoeMat: std(cfg.shoes), shoe: [0.065, 0.045, 0.15] });
  const hem = new THREE.Mesh(
    new THREE.LatheGeometry([[0.02, 0.62], [0.26, 0.62], [0.26, 0.8], [0.27, 1.1], [0.02, 1.1]].map(([r, y]) => new THREE.Vector2(r, y)), 32),
    std(cfg.cloth),
  );
  hem.scale.set(1.25, 1, 0.55);
  hem.position.z = -0.08;
  hem.castShadow = true;
  g.add(hem);
  const body = standee(photo, 1.4);
  body.position.y = 1.0;
  g.add(body);
  return { root: g, body, baseY: 1.0 };
}
