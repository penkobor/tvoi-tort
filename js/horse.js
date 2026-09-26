import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { vnoise, lerp, damp, clamp } from './noise.js';
import { terrainHeight, HERD_X } from './layout.js';
import { subdivide } from './subdivide.js';
import { toon, addOutline } from './fx.js';

export const HORSE_SCALE = 0.0105;

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  const files = ['./assets/Horse.glb', './assets/Stork.glb'];
  let done = 0;
  const out = await Promise.all(
    files.map((f) =>
      loader.loadAsync(f).then((g) => {
        onProgress?.(++done / files.length);
        return g;
      }),
    ),
  );
  return { horse: out[0], stork: out[1] };
}

// Original vertex colours of Horse.glb, used as region labels.
const HORSE_REGIONS = {
  body: [0.38, 0.11, 0.04],
  muzzle: [0.11, 0.04, 0.04],
  mane: [0.05, 0.01, 0.01],
  maneLight: [0.52, 0.28, 0.15],
  legs: [0.1, 0.02, 0.01],
  eye: [0.04, 0.01, 0.01],
};

export const PALETTES = {
  spirit: { body: 0xbf7c3c, belly: 0xd29a5e, muzzle: 0x3a2517, mane: 0x16100c, legs: 0x1b120c, eye: 0x060404, tail: 0x19120d },
  bay: { body: 0x7b4426, belly: 0x8e5634, muzzle: 0x24160e, mane: 0x120c09, legs: 0x140e0a, eye: 0x050303, tail: 0x120c09 },
  black: { body: 0x2c2522, belly: 0x352c28, muzzle: 0x1a1412, mane: 0x0e0b0a, legs: 0x120e0c, eye: 0x020202, tail: 0x0e0b0a },
  pinto: { body: 0xf1e7dc, belly: 0xf6eee6, muzzle: 0x6b4a36, mane: 0x3a2618, legs: 0xe8ddd0, eye: 0x050303, tail: 0x3a2618, patch: 0x8a4f2e },
  grulla: { body: 0x8b7e71, belly: 0x9a8e82, muzzle: 0x2a2320, mane: 0x1a1512, legs: 0x1c1714, eye: 0x030303, tail: 0x1a1512 },
};

function nearestRegion(r, g, b, table) {
  let best = null, bd = 1e9;
  for (const [name, c] of Object.entries(table)) {
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

function paintHorse(geo, palette) {
  const col = geo.attributes.color;
  const pos = geo.attributes.position;
  const c = {};
  for (const k of Object.keys(palette)) c[k] = new THREE.Color(palette[k]);
  const tmp = new THREE.Color();
  for (let i = 0; i < col.count; i++) {
    const region = nearestRegion(col.getX(i), col.getY(i), col.getZ(i), HORSE_REGIONS);
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (region === 'body') {
      if (z < -128 && y > 30) tmp.copy(c.tail);
      else {
        const k = clamp((y - 45) / 100, 0, 1);
        tmp.copy(c.body).multiplyScalar(0.72 + 0.32 * k);
        if (y < 110 && y > 70 && z > -100 && z < 60) tmp.lerp(c.belly, 0.35);
        if (c.patch) {
          const n = vnoise(x * 0.025 + 3.1, z * 0.02 + y * 0.012);
          if (n > 0.58) tmp.copy(c.patch);
        }
      }
    } else if (region === 'muzzle') tmp.copy(c.muzzle);
    else if (region === 'mane' || region === 'maneLight') tmp.copy(c.mane);
    else if (region === 'legs') tmp.copy(c.legs);
    else tmp.copy(c.eye);
    col.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  col.needsUpdate = true;
}

function addRim(material, color, strength) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new THREE.Color(color) };
    shader.uniforms.uRimStrength = material.userData.rimStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uRimColor * pow(rimF, 2.6) * uRimStrength;`,
      );
  };
}

function retargetClip(clip) {
  const c = clip.clone();
  for (const t of c.tracks) t.name = t.name.slice(t.name.indexOf('.'));
  return c;
}

export class Horse {
  constructor(gltf, palette, { castShadow = false, rim = 0.55, detail = 2 } = {}) {
    const src = gltf.scene.getObjectByProperty('isMesh', true);
    const base = src.geometry.clone();
    base.attributes.color = base.attributes.color.clone();
    paintHorse(base, palette);
    // Smooth the low-poly source: two Loop subdivision steps, morph targets included.
    const geo = detail ? subdivide(base, detail) : base;
    const mat = detail ? toon({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    if (rim) addRim(mat, 0xffc27a, rim);
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.scale.setScalar(HORSE_SCALE);
    this.mesh.rotation.y = Math.PI;
    this.mesh.position.y = -1.0;
    this.mesh.castShadow = castShadow;
    this.mesh.frustumCulled = false;
    if (detail) addOutline(this.mesh);
    this.pivot = new THREE.Group();
    this.pivot.position.y = 1.0;
    this.pivot.add(this.mesh);
    this.root = new THREE.Group();
    this.root.add(this.pivot);
    this.mixer = new THREE.AnimationMixer(this.mesh);
    const clip = retargetClip(gltf.animations[0]);
    this.duration = clip.duration;
    this.action = this.mixer.clipAction(clip);
    this.action.play();
    this.standing = false;
    this.standTime = this.duration * 0.375;
  }

  gallop(dt, speed) {
    if (this.standing) {
      this.standK = Math.min(1, this.standK + dt * 1.6);
      const k = this.standK * this.standK * (3 - 2 * this.standK);
      const inf = this.mesh.morphTargetInfluences;
      for (let i = 0; i < inf.length; i++) inf[i] = lerp(this.fromPose[i], this.standPose[i], k);
      return;
    }
    this.action.timeScale = speed * 0.17;
    this.mixer.update(dt);
  }

  // A standing pose: the average of two opposite gallop phases puts the legs under the body.
  computeStandPose() {
    const a = this.action;
    const saved = a.time;
    const sample = (t) => {
      a.time = t;
      this.mixer.update(0);
      return [...this.mesh.morphTargetInfluences];
    };
    const A = sample(this.standTime);
    const B = sample((this.standTime + this.duration / 2) % this.duration);
    a.time = saved;
    this.mixer.update(0);
    this.standPose = A.map((v, i) => (v + B[i]) / 2);
  }

  stand(instant = false) {
    if (!this.standPose) this.computeStandPose();
    this.standing = true;
    this.fromPose = [...this.mesh.morphTargetInfluences];
    this.standK = instant ? 1 : 0;
  }

  run() {
    this.standing = false;
  }
}

export class Herd {
  constructor(scene, gltf) {
    const defs = [
      { p: PALETTES.pinto, ox: 0, oz: -30, ph: 0.2 },
      { p: PALETTES.bay, ox: -3.2, oz: -26, ph: 1.4 },
      { p: PALETTES.black, ox: 2.2, oz: -24, ph: 2.1 },
      { p: PALETTES.grulla, ox: -1.4, oz: -34, ph: 3.3 },
    ];
    this.members = defs.map((d) => {
      const h = new Horse(gltf, d.p, { rim: 0.35, detail: 1 });
      h.action.time = d.ph;
      scene.add(h.root);
      return { h, ...d, drift: 0, lag: 0 };
    });
    this.leaving = false;
    this.visible = true;
  }

  update(dt, t, horseZ, speed) {
    if (!this.visible) return;
    for (const m of this.members) {
      if (this.leaving) {
        m.drift -= dt * 5;
        m.lag += dt * 9;
      }
      const x = HERD_X + m.ox + Math.sin(t * 0.4 + m.ph) * 1.2 + m.drift;
      const z = horseZ + m.oz + Math.sin(t * 0.3 + m.ph * 2) * 1.8 + m.lag;
      m.h.root.position.set(x, terrainHeight(x, z), z);
      m.h.gallop(dt, speed * (this.leaving ? 0.8 : 1));
    }
  }

  hide() {
    this.visible = false;
    for (const m of this.members) m.h.root.visible = false;
  }
}

const STORK_REGIONS = { body: [0.62, 0.52, 0.52], dark: [0, 0, 0], beak: [0.69, 0.1, 0.02] };

export class Eagle {
  constructor(scene, gltf) {
    const src = gltf.scene.getObjectByProperty('isMesh', true);
    const geo = src.geometry.clone();
    geo.attributes.color = geo.attributes.color.clone();
    const col = geo.attributes.color, pos = geo.attributes.position;
    const brown = new THREE.Color(0x4a3020), dark = new THREE.Color(0x24170e), white = new THREE.Color(0xf4efe4), yellow = new THREE.Color(0xf2b632);
    for (let i = 0; i < col.count; i++) {
      const r = nearestRegion(col.getX(i), col.getY(i), col.getZ(i), STORK_REGIONS);
      let c = brown;
      if (r === 'dark') c = dark;
      else if (r === 'beak') c = yellow;
      else if (pos.getZ(i) > 42) c = white;
      else if (pos.getZ(i) < -38) c = white;
      col.setXYZ(i, c.r, c.g, c.b);
    }
    const mat = toon({ vertexColors: true, side: THREE.DoubleSide });
    addRim(mat, 0xffd29a, 0.5);
    this.mesh = new THREE.Mesh(subdivide(geo, 1), mat);
    addOutline(this.mesh);
    this.mesh.scale.setScalar(0.013);
    this.mesh.rotation.y = Math.PI;
    this.root = new THREE.Group();
    this.root.add(this.mesh);
    scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.mesh);
    this.action = this.mixer.clipAction(retargetClip(gltf.animations[0]));
    this.action.play();
    this.prevX = 0;
    this.mode = 'soar';
    this.pos = new THREE.Vector3(-6, 10, -20);
  }

  update(dt, t, horse) {
    let target;
    if (this.mode === 'leap') {
      target = new THREE.Vector3(horse.x - 3.2, horse.y + 3.2 + Math.sin(t * 2) * 0.3, horse.z - 3);
    } else if (this.mode === 'perch') {
      target = new THREE.Vector3(horse.x - 7 + Math.sin(t * 0.35) * 6, 11 + Math.sin(t * 0.6) * 1.5, horse.z + 6 + Math.cos(t * 0.35) * 6);
    } else {
      target = new THREE.Vector3(horse.x - 5 + Math.sin(t * 0.33) * 4, 8.5 + Math.sin(t * 0.52) * 1.4, horse.z - 16 + Math.sin(t * 0.21) * 5);
    }
    this.pos.x = damp(this.pos.x, target.x, 1.6, dt);
    this.pos.y = damp(this.pos.y, target.y, 1.6, dt);
    this.pos.z = damp(this.pos.z, target.z, this.mode === 'leap' ? 4 : 2.2, dt);
    this.root.position.copy(this.pos);
    const vx = (this.pos.x - this.prevX) / Math.max(dt, 1e-3);
    this.prevX = this.pos.x;
    this.root.rotation.z = damp(this.root.rotation.z, clamp(-vx * 0.12, -0.6, 0.6), 3, dt);
    this.action.timeScale = this.mode === 'leap' ? 1.2 : 0.8 + 0.3 * Math.sin(t * 0.7);
    this.mixer.update(dt);
  }
}

export const lerpAngle = (a, b, t) => a + (((b - a + Math.PI) % (Math.PI * 2)) - Math.PI) * t;
export { lerp };
