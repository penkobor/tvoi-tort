import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight, gap, cake, HERD_X, inGap } from './layout.js';
import { fbm, rng, lerp, clamp, vnoise as vnoiseXZ } from './noise.js';
import { makePointsMaterial, softDotTexture } from './fx.js';

const C = (hex) => new THREE.Color(hex);

const PALETTES = {
  sunset: {
    top: C(0x34448a), mid: C(0xe7879a), horizon: C(0xffc07e), fog: C(0xf3b385),
    sun: C(0xffd9a0), light: C(0xffb574), lightI: 2.4,
    hemiSky: C(0xffd8b0), hemiGround: C(0x6a4a34), hemiI: 1.25,
    cloudLit: C(0xffd6a6), cloudShade: C(0xa26f9c), stars: 0,
  },
  dusk: {
    top: C(0x0a0d2c), mid: C(0x47306e), horizon: C(0xd9788a), fog: C(0x7a5a86),
    sun: C(0xff9a7a), light: C(0xffb08a), lightI: 1.15,
    hemiSky: C(0xa296da), hemiGround: C(0x4a3a44), hemiI: 1.1,
    cloudLit: C(0xff9fa0), cloudShade: C(0x3d2c5a), stars: 1,
  },
};

export const SUN_DIR = new THREE.Vector3(-0.35, 0.075, -1).normalize();
const LIGHT_DIR = new THREE.Vector3(-0.55, 0.5, -1).normalize();

const NOISE_GLSL = /* glsl */ `
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm3(vec2 p) { return vn(p) * 0.55 + vn(p * 2.03 + 7.1) * 0.3 + vn(p * 4.1 + 3.3) * 0.15; }
`;

function makeSky() {
  const uniforms = {
    uTop: { value: PALETTES.sunset.top.clone() },
    uMid: { value: PALETTES.sunset.mid.clone() },
    uHorizon: { value: PALETTES.sunset.horizon.clone() },
    uSun: { value: PALETTES.sunset.sun.clone() },
    uCloudLit: { value: PALETTES.sunset.cloudLit.clone() },
    uCloudShade: { value: PALETTES.sunset.cloudShade.clone() },
    uSunDir: { value: SUN_DIR.clone() },
    uStars: { value: 0 },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHorizon, uSun, uCloudLit, uCloudShade, uSunDir;
      uniform float uStars, uTime;
      varying vec3 vDir;
      ${NOISE_GLSL}
      float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
        col = mix(col, uTop, smoothstep(0.14, 0.72, h));
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSun * (pow(sd, 5.0) * 0.28 + pow(sd, 48.0) * 0.55 + pow(sd, 900.0) * 1.5);
        col = mix(col, vec3(1.6, 1.45, 1.15), smoothstep(0.99955, 0.99975, sd));
        if (h > 0.0 && h < 0.5) {
          vec2 p = d.xz / (h + 0.06);
          float n = fbm3(p * vec2(0.9, 2.6) + vec2(uTime * 0.01, 0.0));
          float c = smoothstep(0.52, 0.78, n) * smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(0.22, 0.5, h));
          vec3 cc = mix(uCloudShade, uCloudLit, pow(sd, 3.0) * 0.8 + 0.2 * n);
          col = mix(col, cc, c * 0.85);
        }
        if (uStars > 0.0 && h > 0.05) {
          vec3 sp = d * 160.0;
          vec3 cell = floor(sp);
          float r = h31(cell);
          if (r > 0.985) {
            vec3 center = cell + 0.5 + 0.35 * (vec3(h31(cell + 1.3), h31(cell + 2.7), h31(cell + 4.1)) - 0.5);
            float dist = length(sp - center);
            float tw = 0.6 + 0.4 * sin(uTime * (1.5 + r * 3.0) + r * 60.0);
            col += vec3(1.0, 0.95, 0.9) * smoothstep(0.18, 0.0, dist) * tw * uStars * smoothstep(0.05, 0.35, h) * 1.4;
          }
        }
        col = mix(col, uHorizon, smoothstep(0.0, -0.06, h));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  mesh.frustumCulled = false;
  // Drawn after the other opaque objects: it sits at the far plane, so the depth test skips every pixel they cover.
  mesh.renderOrder = 10;
  return mesh;
}

const GROUND_SIZE = 400, GROUND_SEG = 100;
const GROUND_STEP = GROUND_SIZE / GROUND_SEG;

function makeGround() {
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SEG, GROUND_SEG);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    uGap: { value: new THREE.Vector2(gap.near, gap.far) },
    uGrassA: { value: C(0x9aa04a) },
    uGrassB: { value: C(0x5f7a3a) },
    uDry: { value: C(0xc9a767) },
    uDirt: { value: C(0xb78a5e) },
    uDirt2: { value: C(0x9c6f48) },
    uRock: { value: C(0x9a6a4e) },
  };
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // The dry patches are ~80 units wide and the grid step is 4, so their noise runs per vertex.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying float vDry;
        ${NOISE_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vDry = fbm3(vWPos.xz * 0.012);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying float vDry;
        uniform vec2 uGap;
        uniform vec3 uGrassA, uGrassB, uDry, uDirt, uDirt2, uRock;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vWPos.z < uGap.x && vWPos.z > uGap.y) discard;
        vec2 wp = vWPos.xz;
        float n1 = vn(wp * 0.07);
        float n2 = vn(wp * 0.6);
        float n3 = vDry;
        vec3 g = mix(uGrassA, uGrassB, smoothstep(0.35, 0.75, n1));
        g = mix(g, uDry, smoothstep(0.42, 0.78, n3) * 0.75);
        g *= 0.82 + 0.3 * n2;
        float ax = abs(vWPos.x);
        float edge = 4.3 + (n1 - 0.5) * 1.8;
        float trail = 1.0 - smoothstep(edge - 1.3, edge, ax);
        vec3 dirt = mix(uDirt, uDirt2, n2 * 0.8 + 0.2 * vn(wp * 2.5));
        float lanes = 0.0;
        for (int k = -1; k <= 1; k++) {
          float lx = abs(vWPos.x - float(k) * 2.1);
          lanes += (1.0 - smoothstep(0.15, 0.5, lx)) * 0.12;
        }
        dirt *= 1.0 - lanes;
        vec3 col = mix(g, dirt, trail);
        float gd = min(abs(vWPos.z - uGap.x), abs(vWPos.z - uGap.y));
        float rim = 1.0 - smoothstep(0.0, 5.0 + n1 * 4.0, gd);
        col = mix(col, uRock * (0.8 + 0.3 * n2), rim);
        diffuseColor.rgb *= col;`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.uniforms = uniforms;
  return mesh;
}

function colorize(geo, hex, jitter = 0, seed = 1) {
  const r = rng(seed);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = C(hex);
  for (let i = 0; i < n; i++) {
    const k = 1 + (r() - 0.5) * jitter;
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function jitterPositions(geo, amount, seed) {
  const pos = geo.attributes.position;
  const r = rng(seed);
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, [(r() - 0.5) * amount, (r() - 0.5) * amount, (r() - 0.5) * amount]);
    const o = map.get(key);
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
  }
  return geo;
}

function pineGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 5).toNonIndexed();
  trunk.translate(0, 0.6, 0);
  parts.push(colorize(trunk, 0x5a3a24, 0.2, 3));
  const tiers = [[1.35, 2.2, 1.9, 0x2d5238], [1.05, 1.9, 3.0, 0x356040], [0.7, 1.5, 3.95, 0x3d6a45]];
  tiers.forEach(([r, h, y, col], k) => {
    const cone = new THREE.ConeGeometry(r, h, 7).toNonIndexed();
    cone.translate(0, y, 0);
    parts.push(colorize(cone, col, 0.25, 10 + k));
  });
  parts.forEach((p) => { p.deleteAttribute('uv'); p.deleteAttribute('normal'); });
  return mergeGeometries(parts);
}

function grassGeometry() {
  const r = rng(77);
  const positions = [], colors = [];
  const base = C(0x55652a), tip = C(0xe0c779);
  for (let b = 0; b < 7; b++) {
    const a = r() * Math.PI * 2;
    const h = 0.35 + r() * 0.45;
    const w = 0.05 + r() * 0.03;
    const ox = Math.cos(a) * 0.12 * r(), oz = Math.sin(a) * 0.12 * r();
    const bx = Math.cos(a) * 0.18, bz = Math.sin(a) * 0.18;
    const px = Math.cos(a + Math.PI / 2) * w, pz = Math.sin(a + Math.PI / 2) * w;
    positions.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox + bx, h, oz + bz);
    colors.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const up = new Float32Array(positions.length);
  for (let i = 1; i < up.length; i += 3) up[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  return geo;
}

const windUniform = { value: 0 };

function addWind(mat, strength) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sway = sin(uTime * 1.9 + ip.x * 0.35 + ip.z * 0.25) * 0.6 + sin(uTime * 3.3 + ip.z * 0.8) * 0.25;
        transformed.x += sway * transformed.y * ${strength.toFixed(3)};
        transformed.z += sway * transformed.y * ${(strength * 0.5).toFixed(3)};`);
  };
}

// A recycled field of instances that keeps itself ahead of the horse.
class PropField {
  constructor({ geometry, material, count, place, range = 200, behind = 26, colorFn }) {
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.frustumCulled = false;
    this.count = count;
    this.place = place;
    this.range = range;
    this.behind = behind;
    this.colorFn = colorFn;
    this.z = new Float32Array(count);
    this.data = new Array(count);
    this.dummy = new THREE.Object3D();
    this.r = rng(count * 13 + range);
    this.frozen = false;
  }

  init(horseZ) {
    for (let i = 0; i < this.count; i++) this.spawn(i, horseZ + this.behind - this.r() * this.range);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  spawn(i, z) {
    const p = this.place(this.r, z);
    this.z[i] = z;
    this.data[i] = p;
    this.write(i);
    if (this.colorFn) this.mesh.setColorAt(i, this.colorFn(this.r));
  }

  write(i) {
    const p = this.data[i];
    const d = this.dummy;
    if (!p) {
      d.position.set(0, -500, 0);
      d.scale.setScalar(0.0001);
    } else {
      d.position.set(p.x, terrainHeight(p.x, this.z[i]) + (p.dy || 0), this.z[i]);
      d.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
      d.scale.set(p.s * (p.sx || 1), p.s * (p.sy || 1), p.s * (p.sz || 1));
    }
    d.updateMatrix();
    this.mesh.setMatrixAt(i, d.matrix);
  }

  update(horseZ) {
    if (this.frozen) return;
    let dirty = false;
    const limit = horseZ + this.behind;
    for (let i = 0; i < this.count; i++) {
      if (this.z[i] > limit) {
        this.spawn(i, this.z[i] - this.range);
        dirty = true;
      }
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  refreshHeights() {
    for (let i = 0; i < this.count; i++) this.write(i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const inCakeView = (x, z, padX = 4, padBack = 7, padFront = 7) =>
  Math.abs(x - cake.x) < padX && z < cake.z + padBack && z > cake.z - padFront;

function blocked(x, z) {
  return inGap(z, 2.5);
}

function makeMesas(scene) {
  const uniforms = {
    uRock1: { value: C(0xb8573a) },
    uRock2: { value: C(0xe39a62) },
    uHaze: { value: PALETTES.sunset.fog.clone() },
    uSunDir: { value: SUN_DIR.clone() },
    uSunCol: { value: C(0xffc38a) },
    uAmb: { value: C(0x6a4a5a) },
    uCam: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uRock1, uRock2, uHaze, uSunDir, uSunCol, uAmb, uCam;
      varying vec3 vWPos;
      void main() {
        vec3 n = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        float band = sin(vWPos.y * 0.32 + sin(vWPos.x * 0.021 + vWPos.z * 0.017) * 2.2);
        vec3 base = mix(uRock1, uRock2, smoothstep(-0.35, 0.35, band));
        if (n.y > 0.75) base = uRock2 * 0.85;
        float diff = max(dot(n, uSunDir), 0.0);
        vec3 col = base * (uAmb + uSunCol * diff * 1.2);
        float d = length(vWPos - uCam);
        float haze = 0.16 + 0.6 * clamp((d - 200.0) / 450.0, 0.0, 1.0);
        haze = mix(haze, 1.0, smoothstep(12.0, -30.0, vWPos.y) * 0.85);
        col = mix(col, uHaze, haze);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const group = new THREE.Group();
  const r = rng(2024);
  const N = 18;
  for (let i = 0; i < N; i++) {
    const shape = new THREE.Shape();
    const pts = 8 + Math.floor(r() * 6);
    const rad = 18 + r() * 42;
    for (let k = 0; k < pts; k++) {
      const a = (k / pts) * Math.PI * 2;
      const rr = rad * (0.65 + r() * 0.45);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * (0.6 + r() * 0.3);
      k === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
    }
    const height = 30 + r() * 70;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1, steps: 5 });
    geo.rotateX(-Math.PI / 2);
    // Buttes: a wide talus at the foot, steep walls, an uneven cap.
    const pos = geo.attributes.position;
    const ring = [1.55, 1.12, 1.0, 0.96, 0.9, 0.86];
    const cap = 0.35 + r() * 0.4;
    for (let v = 0; v < pos.count; v++) {
      const t = pos.getY(v) / height;
      const k = Math.min(5, Math.round(t * 5));
      const x = pos.getX(v), z = pos.getZ(v);
      const wob = 1 + (vnoiseXZ(x * 0.08 + i, z * 0.08) - 0.5) * 0.25;
      pos.setX(v, x * ring[k] * wob);
      pos.setZ(v, z * ring[k] * wob);
      if (k === 5 && vnoiseXZ(x * 0.05, z * 0.05 + i) < cap) pos.setY(v, height * 0.82);
    }
    const m = new THREE.Mesh(geo, mat);
    // Denser in front and at the sides, a few behind.
    let a = (r() - 0.5) * Math.PI * (i < 13 ? 1.25 : 2);
    // Keep the view straight down the trail open.
    if (i < 13 && Math.abs(a) < 0.3) a += Math.sign(a || 1) * 0.35;
    const back = i >= 13;
    const dist = 290 + r() * 260;
    m.position.set(Math.sin(a) * dist * (back ? 1 : 1), -30, back ? Math.abs(Math.cos(a)) * dist : -Math.cos(a) * dist);
    m.rotation.y = r() * Math.PI;
    m.frustumCulled = false;
    group.add(m);
  }
  scene.add(group);
  return { group, uniforms };
}

function makeMotes() {
  const N = 160;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
  const r = rng(99);
  const warm = C(0xffe0a0);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = r() * 36; pos[i * 3 + 1] = r() * 7; pos[i * 3 + 2] = r() * 60;
    col[i * 3] = warm.r; col[i * 3 + 1] = warm.g; col[i * 3 + 2] = warm.b;
    size[i] = 0.05 + r() * 0.09;
    alpha[i] = 0.35 + r() * 0.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = makePointsMaterial(softDotTexture());
  mat.uniforms.uCam = { value: new THREE.Vector3() };
  mat.uniforms.uTime = { value: 0 };
  mat.vertexShader = mat.vertexShader
    .replace('uniform float uScale;', 'uniform float uScale;\nuniform vec3 uCam;\nuniform float uTime;')
    .replace('vec4 mv = modelViewMatrix * vec4(position, 1.0);', `
      vec3 box = vec3(36.0, 7.0, 60.0);
      vec3 p = position + vec3(sin(uTime * 0.3 + position.z) * 0.8, sin(uTime * 0.5 + position.x) * 0.4, -uTime * 0.6);
      p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
      p.y = position.y + 0.2 + sin(uTime * 0.7 + position.x * 3.0) * 0.3;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);`)
    .replace('vAlpha = aAlpha;', 'vAlpha = aAlpha * (0.6 + 0.4 * sin(uTime * 2.0 + position.x * 5.0));');
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.dusk = 0;
    this.duskTarget = 0;
    this.time = 0;

    scene.fog = new THREE.Fog(PALETTES.sunset.fog.clone(), 38, 185);
    scene.background = PALETTES.sunset.horizon.clone();

    this.sky = makeSky();
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(PALETTES.sunset.hemiSky, PALETTES.sunset.hemiGround, PALETTES.sunset.hemiI);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(PALETTES.sunset.light, PALETTES.sunset.lightI);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -11; sc.right = 11; sc.top = 11; sc.bottom = -11; sc.near = 1; sc.far = 150;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    this.fill = new THREE.DirectionalLight(0x9fb4ff, 0.35);
    scene.add(this.fill, this.fill.target);

    this.ground = makeGround();
    scene.add(this.ground);
    this.groundSnap = null;
    this.groundHeights = new Float32Array(this.ground.geometry.attributes.position.count);

    this.mesas = makeMesas(scene);
    this.motes = makeMotes();
    scene.add(this.motes);

    this.buildProps();
  }

  buildProps() {
    const lambertVC = (opts = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...opts });

    const grassMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    addWind(grassMat, 0.22);
    this.grass = new PropField({
      geometry: grassGeometry(),
      material: grassMat,
      count: 1700,
      range: 200,
      place: (r, z) => {
        const s = Math.sign(r() - 0.5) || 1;
        const x = s * (4.4 + Math.pow(r(), 1.7) * 62);
        if (blocked(x, z)) return null;
        return { x, s: 0.7 + r() * 0.8, ry: r() * 6.28, dy: -0.02 };
      },
      colorFn: (r) => new THREE.Color().setHSL(0.13 + r() * 0.05, 0.3 + r() * 0.2, 0.55 + r() * 0.25).multiplyScalar(1.5),
    });

    const flowerGeo = new THREE.IcosahedronGeometry(0.06, 0);
    flowerGeo.scale(1, 0.45, 1);
    flowerGeo.translate(0, 0.3, 0);
    const flowerColors = [0xfff4d6, 0xffd23f, 0xc78bff, 0xff8fb8, 0xff9f5a, 0xffffff];
    this.flowers = new PropField({
      geometry: flowerGeo,
      material: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x221108 }),
      count: 900,
      range: 200,
      place: (r, z) => {
        const s = Math.sign(r() - 0.5) || 1;
        const x = s * (4.2 + Math.pow(r(), 1.5) * 38);
        if (blocked(x, z)) return null;
        return { x, s: 0.7 + r() * 0.8 };
      },
      colorFn: (r) => C(flowerColors[Math.floor(r() * flowerColors.length)]),
    });

    this.trees = new PropField({
      geometry: pineGeometry(),
      material: lambertVC(),
      count: 120,
      range: 210,
      behind: 30,
      place: (r, z) => {
        for (let k = 0; k < 8; k++) {
          const s = Math.sign(r() - 0.5) || 1;
          const x = s * (14 + Math.pow(r(), 1.3) * 110);
          if (Math.abs(x - HERD_X) < 8) continue;
          if (fbm(x * 0.03, z * 0.03) < 0.47) continue;
          if (blocked(x, z) || inCakeView(x, z, 6, 8, 10)) continue;
          return { x, s: 0.8 + r() * 1.5, ry: r() * 6.28, dy: -0.1 };
        }
        return null;
      },
      colorFn: (r) => new THREE.Color().setHSL(0.3 + r() * 0.08, 0.25, 0.5 + r() * 0.3).multiplyScalar(2),
    });

    const rockGeo = jitterPositions(new THREE.DodecahedronGeometry(1, 0), 0.35, 5);
    colorize(rockGeo, 0xa98470, 0.15, 6);
    this.rocks = new PropField({
      geometry: rockGeo,
      material: lambertVC(),
      count: 70,
      range: 200,
      place: (r, z) => {
        const s = Math.sign(r() - 0.5) || 1;
        const x = s * (6.5 + Math.pow(r(), 1.4) * 80);
        if (Math.abs(x - HERD_X) < 7 || blocked(x, z) || inCakeView(x, z)) return null;
        return { x, s: 0.3 + Math.pow(r(), 2) * 2.2, sy: 0.6, ry: r() * 6.28, rx: r() * 0.4, dy: -0.1 };
      },
      colorFn: (r) => new THREE.Color().setHSL(0.06, 0.2, 0.5 + r() * 0.3).multiplyScalar(1.8),
    });

    const bushGeo = jitterPositions(new THREE.IcosahedronGeometry(1, 0), 0.3, 8);
    colorize(bushGeo, 0x7d8c58, 0.3, 9);
    this.bushes = new PropField({
      geometry: bushGeo,
      material: lambertVC(),
      count: 110,
      range: 200,
      place: (r, z) => {
        const s = Math.sign(r() - 0.5) || 1;
        const x = s * (5.2 + Math.pow(r(), 1.6) * 55);
        if (Math.abs(x - HERD_X) < 6 || blocked(x, z) || inCakeView(x, z)) return null;
        return { x, s: 0.25 + r() * 0.55, sy: 0.7, ry: r() * 6.28 };
      },
    });

    this.fields = [this.grass, this.flowers, this.trees, this.rocks, this.bushes];
    for (const f of this.fields) this.scene.add(f.mesh);
  }

  init(horseZ) {
    this.updateGround(horseZ, true);
    for (const f of this.fields) f.init(horseZ);
  }

  // Called once the canyon position is known; nothing near it is on screen yet.
  onGapSet() {
    this.ground.userData.uniforms.uGap.value.set(gap.near, gap.far);
  }

  freezeProps() {
    for (const f of this.fields) f.frozen = true;
  }

  updateGround(horseZ, force = false) {
    const snap = Math.round(horseZ / GROUND_STEP) * GROUND_STEP - 60;
    if (!force && snap === this.groundSnap) return;
    const cols = GROUND_SEG + 1;
    const pos = this.ground.geometry.attributes.position;
    const h = this.groundHeights;
    // The snap step is one grid row, so a move by k steps shifts whole rows (row z grows with the index):
    // only the k new rows need the terrain noise.
    const k = this.groundSnap === null ? cols : Math.round((this.groundSnap - snap) / GROUND_STEP);
    let from = 0, to = cols;
    if (!force && k > 0 && k < cols) {
      h.copyWithin(k * cols, 0, (cols - k) * cols);
      to = k;
    } else if (!force && k < 0 && -k < cols) {
      h.copyWithin(0, -k * cols);
      from = cols + k;
    }
    for (let i = from * cols; i < to * cols; i++) h[i] = terrainHeight(pos.getX(i), pos.getZ(i) + snap);
    for (let i = 0; i < pos.count; i++) pos.setY(i, h[i]);
    pos.needsUpdate = true;
    this.groundSnap = snap;
    this.ground.position.z = snap;
  }

  setDuskTarget(k) {
    this.duskTarget = k;
  }

  applyPalette(k) {
    const a = PALETTES.sunset, b = PALETTES.dusk;
    const u = this.sky.material.uniforms;
    u.uTop.value.copy(a.top).lerp(b.top, k);
    u.uMid.value.copy(a.mid).lerp(b.mid, k);
    u.uHorizon.value.copy(a.horizon).lerp(b.horizon, k);
    u.uSun.value.copy(a.sun).lerp(b.sun, k);
    u.uCloudLit.value.copy(a.cloudLit).lerp(b.cloudLit, k);
    u.uCloudShade.value.copy(a.cloudShade).lerp(b.cloudShade, k);
    u.uStars.value = k;
    this.scene.fog.color.copy(a.fog).lerp(b.fog, k);
    this.scene.background.copy(u.uHorizon.value);
    this.sun.color.copy(a.light).lerp(b.light, k);
    this.sun.intensity = lerp(a.lightI, b.lightI, k);
    this.hemi.color.copy(a.hemiSky).lerp(b.hemiSky, k);
    this.hemi.groundColor.copy(a.hemiGround).lerp(b.hemiGround, k);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, k);
    this.mesas.uniforms.uHaze.value.copy(this.scene.fog.color);
    this.mesas.uniforms.uSunCol.value.set(0xffc38a).lerp(C(0x9a6a8a), k);
  }

  update(dt, horse, camera) {
    this.time += dt;
    windUniform.value = this.time;
    this.sky.material.uniforms.uTime.value = this.time;
    this.sky.position.copy(camera.position);

    if (Math.abs(this.dusk - this.duskTarget) > 0.0005) {
      this.dusk += clamp(this.duskTarget - this.dusk, -dt * 0.22, dt * 0.22);
      this.applyPalette(this.dusk);
    }

    this.updateGround(horse.z);
    for (const f of this.fields) f.update(horse.z);

    const hp = new THREE.Vector3(horse.x, 0, horse.z);
    this.sun.position.copy(hp).addScaledVector(LIGHT_DIR, 60);
    this.sun.target.position.copy(hp);
    this.fill.position.set(horse.x + 20, 25, horse.z + 40);
    this.fill.target.position.copy(hp);

    this.mesas.group.position.z = horse.z * 0.9;
    this.mesas.uniforms.uCam.value.copy(camera.position);

    this.motes.material.uniforms.uCam.value.copy(camera.position);
    this.motes.material.uniforms.uTime.value = this.time;
  }
}
