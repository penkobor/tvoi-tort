import * as THREE from 'three';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function radialTexture(stops, size = 128) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return toTexture(c);
}

export const glowTexture = () =>
  radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.18, 'rgba(255,255,255,0.75)'],
    [0.45, 'rgba(255,255,255,0.22)'],
    [1, 'rgba(255,255,255,0)'],
  ]);

export const softDotTexture = () =>
  radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.5, 'rgba(255,255,255,0.55)'],
    [1, 'rgba(255,255,255,0)'],
  ], 64);

export function sparkleTexture(size = 128) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const m = size / 2;
  const grad = g.createRadialGradient(m, m, 0, m, m, m);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,255,255,0.95)';
  for (let k = 0; k < 2; k++) {
    g.save();
    g.translate(m, m);
    g.rotate((k * Math.PI) / 2);
    g.beginPath();
    g.moveTo(0, -m);
    g.quadraticCurveTo(size * 0.035, 0, 0, m);
    g.quadraticCurveTo(-size * 0.035, 0, 0, -m);
    g.fill();
    g.restore();
  }
  return toTexture(c);
}

export function ringTexture(size = 256) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const m = size / 2;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = size * 0.018;
  g.shadowColor = 'white';
  g.shadowBlur = size * 0.05;
  g.beginPath();
  g.arc(m, m, m * 0.78, 0, Math.PI * 1.55);
  g.stroke();
  g.lineWidth = size * 0.01;
  g.beginPath();
  g.arc(m, m, m * 0.66, Math.PI * 0.9, Math.PI * 2.2);
  g.stroke();
  return toTexture(c);
}

const particleVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aSize * uScale / max(-mv.z, 0.1), 384.0);
    vColor = aColor;
    vAlpha = aAlpha;
  }
`;

const particleFrag = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

// Cel shading like the film: shadow, mid and lit bands, with warm shadows.
let toonRamp = null;
export function toonGradient() {
  if (toonRamp) return toonRamp;
  toonRamp = new THREE.DataTexture(new Uint8Array([128, 107, 92, 255, 204, 194, 184, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
  toonRamp.generateMipmaps = false;
  toonRamp.needsUpdate = true;
  return toonRamp;
}

export const toon = (opts = {}) => new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...opts });

// Ink outline: a back-face copy of the mesh, pushed out along the normals.
// It shares the geometry and the morph weights, so it follows the animation.
export function addOutline(mesh, { width = 0.012, color = 0x1a0e08 } = {}) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: color, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec3 outN = normalMatrix * objectNormal;
        mvPosition.xyz += outN / max(length(outN), 1e-6) * uOutline * max(1.0, -mvPosition.z / 6.0);
        gl_Position = projectionMatrix * mvPosition;`);
  };
  const hull = new THREE.Mesh(mesh.geometry, mat);
  hull.morphTargetInfluences = mesh.morphTargetInfluences;
  hull.morphTargetDictionary = mesh.morphTargetDictionary;
  hull.frustumCulled = mesh.frustumCulled;
  mesh.add(hull);
  return hull;
}

export const particleMaterials = new Set();

export function setParticleScale(renderer, camera) {
  const h = renderer.domElement.height;
  const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  for (const m of particleMaterials) m.uniforms.uScale.value = s;
}

export function makePointsMaterial(texture, blending = THREE.AdditiveBlending) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture }, uScale: { value: 800 } },
    vertexShader: particleVert,
    fragmentShader: particleFrag,
    transparent: true,
    depthWrite: false,
    blending,
  });
  particleMaterials.add(mat);
  return mat;
}

// CPU-simulated particle pool drawn as one Points object.
export class Particles {
  constructor({ max = 500, texture, blending = THREE.AdditiveBlending, gravity = 0, drag = 0, fade = 1.6, twinkle = 0 }) {
    this.max = max;
    this.gravity = gravity;
    this.drag = drag;
    this.fade = fade;
    this.twinkle = twinkle;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.g = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.points = new THREE.Points(geo, makePointsMaterial(texture, blending));
    this.points.frustumCulled = false;
    this.time = 0;
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, color, alpha = 1, gravityScale = 1) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = alpha;
    this.g[i] = gravityScale;
    this.size[i] = s0; this.alpha[i] = 0;
  }

  copy(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
      this.col[t3 + k] = this.col[f3 + k];
    }
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from]; this.a0[to] = this.a0[from];
    this.g[to] = this.g[from];
  }

  update(dt) {
    this.time += dt;
    const dragK = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.count--;
        if (i !== this.count) this.copy(this.count, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      this.vel[i3 + 1] += this.gravity * this.g[i] * dt;
      this.vel[i3] *= dragK; this.vel[i3 + 1] *= dragK; this.vel[i3 + 2] *= dragK;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      let a = this.a0[i] * Math.min(1, t * 10) * Math.pow(1 - t, this.fade);
      if (this.twinkle) a *= 1 - this.twinkle * (0.5 + 0.5 * Math.sin(this.time * 40 + i * 1.7));
      this.alpha[i] = a;
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
    this.geo.setDrawRange(0, this.count);
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }
}
