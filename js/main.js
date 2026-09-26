import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BloomPass, makeOutputPass } from './post.js';
import { CONFIG } from './config.js';
import * as L from './layout.js';
import { World } from './world.js';
import { loadModels, Horse, Herd, Eagle, PALETTES } from './horse.js';
import { Track } from './track.js';
import { Finale, BlowDetector } from './finale.js';
import { Particles, softDotTexture, sparkleTexture, setParticleScale } from './fx.js';
import { AudioManager } from './audio.js';
import { UI } from './ui.js';
import { clamp, lerp, damp, easeInOut, smoothstep } from './noise.js';

const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);

const canvas = $('#c');
// No antialias on the canvas: the multisampled scene buffer of the composer does it.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1600);

// Soft bloom on the bright bits: sun, wishes, sparkles, candles, fireworks.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
// The passes after the scene never read its depth, so the multisampled depth is not resolved.
for (const t of [composer.renderTarget1, composer.renderTarget2]) t.resolveDepthBuffer = false;
composer.addPass(new RenderPass(scene, camera));
const bloom = new BloomPass(new THREE.Vector2(1, 1), 0.42, 0.55, 0.95);
composer.addPass(bloom);
const output = makeOutputPass(bloom);
composer.addPass(output);
function setBloom(on) {
  bloom.enabled = on;
  output.uniforms.uBloom.value = on ? 1 : 0;
}
function setSamples(n) {
  for (const t of [composer.renderTarget1, composer.renderTarget2]) {
    t.samples = n;
    t.dispose();
  }
}
setBloom(!params.has('nobloom'));
const ui = new UI(CONFIG);
const audio = new AudioManager(CONFIG.music);
const blow = new BlowDetector();

let world, horse, herd, eagle, track, finale, dust, bursts;

const G = {
  state: 'loading',
  stateTime: 0,
  time: 0,
  timeScale: 1,
  targetTimeScale: 1,
  speed: 11,
  targetSpeed: 11,
  lane: 0,
  x: 0, y: 0, z: 0, vy: 0,
  yaw: 0, pitch: 0, roll: 0,
  airborne: false,
  stumble: 0,
  runStartZ: 0,
  collected: 0,
  sparkles: 0,
  flags: {},
};

// ---------- camera ----------

const rig = { shot: 'intro', from: null, t: 0, dur: 1, arc: 0, look: new THREE.Vector3(), shake: 0 };
const H = () => new THREE.Vector3(G.x, G.y, G.z);
const portrait = () => camera.aspect < 0.9;

function shotPose(name) {
  const P = portrait();
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  let fov = 55;
  const c = L.cake;
  switch (name) {
    case 'intro': {
      const a = 0.95 + Math.sin(G.time * 0.13) * 0.35;
      const r = P ? 8.6 : 6.8;
      pos.set(G.x + Math.sin(a) * r, 1.3, G.z - Math.cos(a) * r);
      look.set(G.x, P ? 1.55 : 1.15, G.z);
      fov = P ? 58 : 44;
      break;
    }
    case 'chase':
      pos.set(G.x * 0.7, (P ? 3.9 : 3.3) + G.y * 0.45, G.z + (P ? 8.4 : 7.2));
      look.set(G.x * 0.85, 1.1 + G.y * 0.35, G.z - 8);
      fov = P ? 68 : 55;
      break;
    case 'approach':
      pos.set(G.x, 5.2, G.z + (P ? 10.5 : 9));
      look.set(G.x, -1.5, G.z - 26);
      fov = P ? 72 : 56;
      break;
    case 'leap': {
      // From the side and a little above, so the drop into the canyon is under the horse.
      const u = G.leapU ?? 0;
      const s = P ? 1.3 : 1;
      pos.set(G.x + lerp(12, 9, u) * s, G.y + lerp(2.6, 1.6, u), G.z + lerp(3, 7, u) * s);
      look.set(G.x, G.y - 1.2, G.z - 1.5);
      fov = P ? 62 : 48;
      break;
    }
    case 'cake':
      pos.set(c.x, P ? 2.0 : 1.9, c.z - (P ? 4.8 : 4.1));
      look.set(c.x, 1.22, c.z + 0.9);
      fov = P ? 60 : 42;
      break;
    case 'celebrate':
      pos.set(c.x, 1.25, c.z - (P ? 8 : 7));
      look.set(c.x, P ? 8.5 : 6.5, c.z + 25);
      fov = P ? 72 : 55;
      break;
  }
  return { pos, look, fov };
}

function cut(name) {
  rig.shot = name;
  rig.from = null;
}

function blendTo(name, dur, arc = 0) {
  const h = H();
  rig.from = { pos: camera.position.clone().sub(h), look: rig.look.clone().sub(h), fov: camera.fov };
  rig.shot = name;
  rig.t = 0;
  rig.dur = dur;
  rig.arc = arc;
}

function updateCamera(dtReal) {
  const target = shotPose(rig.shot);
  let { pos, look, fov } = target;
  if (rig.from) {
    rig.t += dtReal;
    const k = easeInOut(clamp(rig.t / rig.dur, 0, 1));
    const h = H();
    pos = rig.from.pos.clone().add(h).lerp(target.pos, k);
    look = rig.from.look.clone().add(h).lerp(target.look, k);
    fov = lerp(rig.from.fov, target.fov, k);
    if (rig.arc) pos.y += Math.sin(k * Math.PI) * rig.arc;
    if (rig.t >= rig.dur) rig.from = null;
  }
  if (rig.shake > 0) {
    rig.shake = Math.max(0, rig.shake - dtReal * 1.6);
    const s = rig.shake * rig.shake * 0.3;
    pos.x += (Math.random() - 0.5) * s;
    pos.y += (Math.random() - 0.5) * s;
  }
  camera.position.copy(pos);
  rig.look.copy(look);
  camera.lookAt(look);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

// ---------- effects ----------

const DUST = new THREE.Color(0xe6c49a);
// Where the horse stops behind the people holding the cake: side view, facing screen-right.
const HORSE_SPOT = { x: 0.6, dz: 2.3, yaw: -Math.PI / 2 };
const GOLD = new THREE.Color(0xffe0a0);

function dustPuff(n, spread = 1, up = 1) {
  for (let i = 0; i < n; i++) {
    dust.emit(
      G.x + (Math.random() - 0.5) * 0.8 * spread, 0.1, G.z + (Math.random() - 0.3) * 2.4 * spread,
      (Math.random() - 0.5) * 2 * spread, (0.6 + Math.random() * 1.4) * up, (Math.random() - 0.2) * 2 * spread,
      0.9 + Math.random() * 0.6, 0.5, 1.8 + spread, DUST, 0.3,
    );
  }
}

function burstAt(p, color, n = 60, speed = 4) {
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
    bursts.emit(p.x, p.y, p.z, v.x, v.y + 1, v.z, 0.7 + Math.random() * 0.5, 0.35, 0.05, i % 3 ? c : GOLD, 1);
  }
}

function screenPos(v) {
  const p = v.clone().project(camera);
  return [(p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight];
}

// ---------- hooks from the track ----------

const hooks = {
  onSparkle(x, y, z) {
    G.sparkles++;
    ui.setSparkles(G.sparkles);
    audio.sparkle();
    burstAt(new THREE.Vector3(x, y, z), 0xffe7a8, 8, 2.2);
  },
  onWish(w, silent) {
    G.collected++;
    const p = w.group.position.clone();
    if (!silent) {
      const [sx, sy] = screenPos(p);
      ui.flyToSlot(w.index, sx, sy);
      ui.toast(w.def, w.chaseT > 0 ? 'Пожелания всё равно тебя догонят 😉' : null);
      audio.chime();
      burstAt(p, w.def.color, 90, 5);
      ui.flash();
    } else {
      ui.slots[w.index].classList.add('filled');
    }
  },
  onHit() {
    G.stumble = 0.8;
    rig.shake = 0.55;
    audio.thud();
    dustPuff(14, 1.4, 1.2);
    if (!G.flags.hitHint) {
      G.flags.hitHint = true;
      ui.hint('Ничего страшного — скачем дальше! Тап — прыжок', 2600);
    }
  },
};

// ---------- states ----------

function setState(s) {
  G.state = s;
  G.stateTime = 0;
  document.body.dataset.state = s;
}

function startRun({ skipIntro = false } = {}) {
  if (G.state !== 'title') return;
  audio.unlock();
  audio.startMusic();
  document.body.classList.add('started');
  G.runStartZ = G.z;
  L.setGap(G.z - L.GAP_DIST);
  world.onGapSet();
  finale.place();
  track.reset(G.runStartZ);
  ui.hideTitle();
  ui.showHUD(true);
  setState('run');
  G.targetSpeed = 15.5;
  if (skipIntro) cut('chase');
  else blendTo('chase', 2.4);
  setTimeout(() => ui.hint('<span class="k">←</span> свайп — смени тропу <span class="k">→</span>', 4200), 1600);
  setTimeout(() => {
    if (audio.mode === 'youtube' && !audio.isMusicPlaying()) document.body.classList.add('music-nudge-on');
  }, 2500);
}

function laneChange(dir) {
  if (G.state !== 'run') return;
  G.lane = clamp(G.lane + dir, -1, 1);
  if (!G.flags.laneTut) {
    G.flags.laneTut = true;
    setTimeout(() => ui.hint('Тап по экрану — прыжок ✦', 3200), 900);
  }
}

function jump() {
  if (G.state !== 'run' || G.airborne) return;
  G.airborne = true;
  G.vy = 9.5;
  audio.jump();
  dustPuff(6, 0.8, 0.8);
}

function onTap() {
  audio.unlock();
  if (G.state === 'run') jump();
  else if (G.state === 'cake') {
    finale.gust(3);
    audio.blowSound();
  }
}

function enterApproach() {
  setState('approach');
  track.forceComplete();
  track.clearAhead();
  herd.leaving = true;
  G.lane = 0;
  G.targetSpeed = 21;
  ui.letterbox(true);
  ui.hideHint();
  blendTo('approach', 2.6);
}

function startLeap() {
  setState('leap');
  G.leap = { t: 0, T: 2.4, z0: G.z, z1: L.gap.far - 6, h: 8 };
  G.airborne = false;
  G.leapU = 0;
  blendTo('leap', 0.9);
  audio.whoosh(2.4);
  eagle.mode = 'leap';
  dustPuff(24, 1.6, 1.6);
  rig.shake = 0.3;
}

function land() {
  setState('landing');
  G.y = 0;
  G.targetTimeScale = 1;
  rig.shake = 0.7;
  audio.thud();
  dustPuff(40, 2.2, 1.6);
  const p0 = new THREE.Vector2(G.x, G.z);
  const p2 = new THREE.Vector2(HORSE_SPOT.x, L.cake.z + HORSE_SPOT.dz);
  const p1 = new THREE.Vector2(p2.x + 3.2 * Math.sign(HORSE_SPOT.yaw), p2.y);
  const len = p0.distanceTo(p1) + p1.distanceTo(p2) * 0.8;
  G.landing = { t: 0, p0, p1, p2, T: (2 * len) / 19 };
  blendTo('cake', 4.4, 2.8);
  world.setDuskTarget(1);
  herd.hide();
  eagle.mode = 'perch';
  ui.showHUD(false);
  document.body.classList.add('finale');
}

function enterCake() {
  setState('cake');
  world.freezeProps();
  ui.letterbox(false);
  ui.showHUD(false);
  ui.hideHint();
  ui.cakeUI(true, BlowDetector.available());
}

function enterCelebrate() {
  setState('celebrate');
  ui.cakeUI(false);
  blow.stop();
  document.body.classList.remove('mic-on');
  audio.fanfare();
  ui.confetti.burst(180);
  G.fwT = 0.7;
  G.fwN = 0;
}

function launchFirework() {
  const c = L.cake;
  const first = G.fwN === 0;
  const types = ['sphere', 'sphere', 'willow', 'heart'];
  const type = first ? 'heart' : types[Math.floor(Math.random() * types.length)];
  const colors = [0xff5d8f, 0xffd166, 0xc9a2ff, 0x7be0ff, 0xff9f43, 0xff3b6b];
  const x = first ? c.x : c.x + (Math.random() - 0.5) * 40;
  finale.launch(type, x, c.z + 40 + Math.random() * 25, first ? 26 : 20 + Math.random() * 16, type === 'heart' ? 0xff4f7e : colors[G.fwN % colors.length]);
  G.fwN++;
}

// ---------- per-frame ----------

function runPhysics(dt) {
  G.stumble = Math.max(0, G.stumble - dt);
  G.speed = damp(G.speed, G.targetSpeed * (G.stumble > 0 ? 0.5 : 1), G.stumble > 0 ? 6 : 1.3, dt);
  G.z -= G.speed * dt;
  const prevX = G.x;
  G.x = damp(G.x, G.lane * L.LANE_W, 9, dt);
  const vx = (G.x - prevX) / Math.max(dt, 1e-4);
  G.yaw = damp(G.yaw, clamp(-vx * 0.05, -0.35, 0.35), 10, dt);
  G.roll = damp(G.roll, clamp(-vx * 0.025, -0.18, 0.18), 8, dt);
  if (G.airborne) {
    G.vy -= 26 * dt;
    G.y += G.vy * dt;
    if (G.y <= 0) {
      G.y = 0;
      G.vy = 0;
      G.airborne = false;
      dustPuff(8, 1, 0.8);
    }
  }
  const wobble = G.stumble > 0 ? Math.sin(G.time * 30) * 0.12 * G.stumble : 0;
  G.pitch = damp(G.pitch, G.airborne ? clamp(G.vy * 0.035, -0.25, 0.3) : 0, 8, dt) + wobble * dt * 10;
}

function update(dt, dtReal) {
  G.time += dt;
  G.stateTime += dt;

  switch (G.state) {
    case 'title':
      G.targetSpeed = 11;
      runPhysics(dt);
      break;
    case 'run': {
      G.targetSpeed = 15.5 + G.collected * 0.65;
      runPhysics(dt);
      track.update(dt, G);
      const d = G.runStartZ - G.z;
      if (d >= L.APPROACH_AT && (track.collected >= CONFIG.wishes.length || d > L.APPROACH_AT + 40)) enterApproach();
      break;
    }
    case 'approach': {
      runPhysics(dt);
      track.update(dt, G);
      const d = G.runStartZ - G.z;
      // The horse gathers speed on its own for the last stretch before the edge.
      if (d > L.GAP_DIST - 60) G.targetSpeed = 26;
      if (d >= L.GAP_DIST - 1.5) startLeap();
      break;
    }
    case 'leap': {
      const lp = G.leap;
      lp.t += dt;
      const u = clamp(lp.t / lp.T, 0, 1);
      G.leapU = u;
      G.z = lerp(lp.z0, lp.z1, u);
      G.y = 4 * lp.h * u * (1 - u);
      G.x = damp(G.x, 0, 4, dt);
      G.yaw = damp(G.yaw, 0, 4, dt);
      G.roll = damp(G.roll, 0, 4, dt);
      G.pitch = lerp(0.3, -0.28, easeInOut(u));
      G.targetTimeScale = u > 0.07 && u < 0.8 ? 0.34 : 1;
      G.speed = 22;
      for (let i = 0; i < 3; i++) {
        bursts.emit(G.x + (Math.random() - 0.5) * 0.6, G.y + 0.6 + Math.random() * 0.8, G.z + 1 + Math.random() * 1.2,
          (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 1 + Math.random(), 1.2, 0.3, 0.02, GOLD, 0.9);
      }
      if (u >= 1) land();
      break;
    }
    case 'landing': {
      const ld = G.landing;
      ld.t += dt;
      const u = clamp(ld.t / ld.T, 0, 1);
      const s = 1 - (1 - u) * (1 - u);
      const { p0, p1, p2 } = ld;
      G.x = (1 - s) * (1 - s) * p0.x + 2 * (1 - s) * s * p1.x + s * s * p2.x;
      G.z = (1 - s) * (1 - s) * p0.y + 2 * (1 - s) * s * p1.y + s * s * p2.y;
      const tx = 2 * (1 - s) * (p1.x - p0.x) + 2 * s * (p2.x - p1.x);
      const tz = 2 * (1 - s) * (p1.y - p0.y) + 2 * s * (p2.y - p1.y);
      G.speed = Math.hypot(tx, tz) * (2 * (1 - u)) / ld.T;
      if (G.speed > 0.5) G.yaw = damp(G.yaw, Math.atan2(-tx, -tz), 6, dt);
      G.pitch = damp(G.pitch, 0, 5, dt);
      G.roll = damp(G.roll, 0, 5, dt);
      if (G.speed < 4.5 && !horse.standing) horse.stand();
      if (G.stateTime > 2.6) ui.letterbox(false);
      if (u >= 1 && G.stateTime > 4.5) enterCake();
      break;
    }
    case 'cake': {
      if (blow.active) {
        const s = blow.read();
        ui.micLevel(clamp(blow.level * 1.6, 0, 1));
        if (s > 0) finale.blow(s, dt);
      }
      if (finale.litCount === 0 && G.stateTime > 0.5) enterCelebrate();
      break;
    }
    case 'celebrate':
    case 'message': {
      G.fwT -= dt;
      if (G.fwT <= 0) {
        launchFirework();
        G.fwT = G.state === 'message' ? 1.3 + Math.random() : 0.55 + Math.random() * 0.5;
      }
      if (G.state === 'celebrate') {
        if (!G.flags.celebCam && G.stateTime > 1.0) {
          G.flags.celebCam = true;
          blendTo('celebrate', 3.4);
        }
        if (G.stateTime > 4.6) {
          setState('message');
          ui.showMessage();
        }
      }
      break;
    }
  }

  horse.root.position.set(G.x, G.y, G.z);
  horse.root.rotation.y = G.yaw;
  horse.pivot.rotation.x = G.pitch;
  horse.pivot.rotation.z = G.roll;
  horse.gallop(dt, G.state === 'leap' ? 4 : G.speed);
  if (horse.standing) horse.root.scale.y = 1 + Math.sin(G.time * 2.2) * 0.006;

  herd.update(dt, G.time, G.z, G.speed);
  eagle.update(dt, G.time, G);

  if (!G.airborne && G.speed > 4 && G.state !== 'leap') {
    const n = Math.random() < G.speed * dt * 3 ? 1 : 0;
    for (let i = 0; i < n + 1; i++) {
      if (Math.random() > G.speed / 30) continue;
      dust.emit(G.x + (Math.random() - 0.5) * 0.5, 0.08, G.z + (Math.random() - 0.3) * 2.6,
        (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 1.1, 1 + Math.random() * 2, 0.8 + Math.random() * 0.5, 0.35, 1.5, DUST, 0.28);
    }
  }

  const cheer = G.state === 'celebrate' || G.state === 'message' ? 1 : 0;
  finale.update(dt, camera, { cheer, onBurst: () => audio.boom() });
  dust.update(dt);
  bursts.update(dt);

  updateCamera(dtReal);
  world.update(dt, G, camera);
  setParticleScale(renderer, camera);
}

// ---------- loop ----------

let last = performance.now();
let raf = 0, fallback = 0, frame = 0;
const perf = { acc: 0, n: 0, checks: 0 };

function tick() {
  cancelAnimationFrame(raf);
  clearTimeout(fallback);
  const now = performance.now();
  const rawDt = (now - last) / 1000;
  const dtReal = Math.min(0.05, rawDt);
  last = now;
  G.timeScale = damp(G.timeScale, G.targetTimeScale, 4, dtReal);
  update(dtReal * G.timeScale, dtReal);
  // In the finale almost nothing moves, so the shadow map is redrawn every second frame.
  const still = G.state === 'cake' || G.state === 'celebrate' || G.state === 'message';
  renderer.shadowMap.autoUpdate = !still;
  if (still && (frame++ & 1) === 0) renderer.shadowMap.needsUpdate = true;
  composer.render(dtReal);
  adaptQuality(rawDt);
  raf = requestAnimationFrame(tick);
  fallback = setTimeout(tick, 100);
}

function adaptQuality(dt) {
  if (document.hidden || perf.checks > 3 || dt > 0.2) return;
  perf.acc += dt;
  perf.n++;
  if (perf.acc > 2.5) {
    const avg = perf.acc / perf.n;
    // On a slow device, step by step: 2x instead of 4x antialiasing, a little less resolution
    // (both hard to see on a phone), then no bloom, then less resolution again.
    if (avg > 0.02) {
      const step = perf.checks++;
      if (step === 0) setSamples(2);
      else if (step === 2 || pixelRatio <= 1) setBloom(false);
      else {
        pixelRatio = Math.max(1, pixelRatio - 0.3);
        renderer.setPixelRatio(pixelRatio);
        resize();
      }
    }
    perf.acc = 0;
    perf.n = 0;
  }
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  setParticleScale(renderer, camera);
}

// ---------- input ----------

function bindInput() {
  // The song starts on the very first touch, wherever it lands (iOS needs a gesture).
  const firstTouch = () => {
    audio.unlock();
    audio.startMusic();
    setTimeout(() => {
      if (!audio.isMusicPlaying()) return;
      document.removeEventListener('pointerdown', firstTouch, { capture: true });
      document.removeEventListener('touchend', firstTouch, { capture: true });
    }, 800);
  };
  document.addEventListener('pointerdown', firstTouch, { capture: true });
  document.addEventListener('touchend', firstTouch, { capture: true });

  let start = null;
  const layer = canvas;
  layer.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, t: performance.now(), used: false };
  });
  layer.addEventListener('pointermove', (e) => {
    if (!start || start.used) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy) * 1.1) {
      laneChange(Math.sign(dx));
      start.used = true;
    } else if (dy < -34 && Math.abs(dy) > Math.abs(dx)) {
      if (G.state === 'run') jump();
      else onTap();
      start.used = true;
    }
  });
  layer.addEventListener('pointerup', (e) => {
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (!start.used && moved < 20 && performance.now() - start.t < 450) onTap();
    start = null;
  });
  layer.addEventListener('pointercancel', () => (start = null));

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key === 'a') laneChange(-1);
    else if (e.key === 'ArrowRight' || e.key === 'd') laneChange(1);
    else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') {
      e.preventDefault();
      if (G.state === 'title') startRun();
      else onTap();
    }
  });

  document.addEventListener('touchmove', (e) => {
    if (!e.target.closest('.msg-card')) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  $('#start-btn').addEventListener('click', () => startRun());
  $('#mute-btn').addEventListener('click', () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    $('#mute-btn').textContent = audio.muted ? '🔇' : '🔊';
  });
  $('#mic-btn').addEventListener('click', async () => {
    audio.unlock();
    try {
      await blow.start(audio.ctx);
      document.body.classList.add('mic-on');
      ui.hint('Подуй на экран 🌬️', 3000);
    } catch {
      ui.hint('Микрофон недоступен — просто коснись экрана', 3000);
    }
  });
  $('#relight-btn').addEventListener('click', () => {
    ui.hideMessage();
    finale.relight();
    G.flags.celebCam = false;
    blendTo('cake', 2.4);
    setState('cake');
    ui.cakeUI(true, BlowDetector.available());
  });
  $('#replay-btn').addEventListener('click', () => location.reload());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      G.musicWasPlaying = audio.isMusicPlaying();
      if (G.musicWasPlaying) audio.pauseMusic();
    } else if (G.musicWasPlaying) audio.resumeMusic();
  });
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
}

// ---------- boot ----------

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
}

async function boot() {
  resize();
  ui.setLoading(0.06);
  const audioInit = audio.init().then(() => {
    if (audio.mode === 'file') document.body.classList.add('music-file');
  });
  const fonts = withTimeout(
    Promise.all([
      document.fonts.load('italic 700 82px "Cormorant Garamond"', 'Сила Успех Здоровье'),
      document.fonts.load('104px "Bad Script"', 'С днём рождения'),
      document.fonts.load('600 16px Manrope', 'Начать'),
    ]),
    3000,
  );
  const models = await loadModels((p) => ui.setLoading(0.1 + p * 0.55));
  await fonts;
  ui.setLoading(0.7);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  world = new World(scene, renderer);
  horse = new Horse(models.horse, PALETTES.spirit, { castShadow: true, rim: 0.38 });
  scene.add(horse.root);
  herd = new Herd(scene, models.horse);
  eagle = new Eagle(scene, models.stork);
  track = new Track(scene, { hooks, wishes: CONFIG.wishes });
  finale = new Finale(scene, { people: CONFIG.people });
  finale.age = CONFIG.age;
  if (params.has('standT')) horse.standTime = +params.get('standT') * horse.duration;
  await finale.prepare();
  finale.build();
  dust = new Particles({ max: 500, texture: softDotTexture(), blending: THREE.NormalBlending, gravity: -0.6, drag: 1.8, fade: 1.4 });
  bursts = new Particles({ max: 900, texture: sparkleTexture(), gravity: -2, drag: 1.6, fade: 1.2 });
  scene.add(dust.points, bursts.points);
  ui.setLoading(0.85);

  world.init(G.z);
  bindInput();
  setState('title');
  ui.showTitle();
  cut('intro');
  updateCamera(0);
  world.update(0, G, camera);
  // Compile for the offscreen target the composer draws into, so the first frames do not stall.
  renderer.setRenderTarget(composer.readBuffer);
  renderer.compile(scene, camera);
  renderer.setRenderTarget(null);
  finale.uploadTextures(renderer);
  ui.setLoading(1);
  await audioInit;

  const scene_ = params.get('scene');
  if (scene_) debugJump(scene_);

  tick();
  setTimeout(() => ui.hideLoader(), 250);
}

// ?scene=run | approach | cake | message — jump straight to a part for testing.
function debugJump(name) {
  startRun({ skipIntro: true });
  if (name === 'run') return;
  if (name === 'approach') {
    G.z = G.runStartZ - (L.APPROACH_AT - 5);
    for (const w of track.wishes) w.state = 'hidden';
    track.nextWish = track.wishes.length;
    track.nextD = L.GAP_DIST;
    track.forceComplete();
    return;
  }
  track.forceComplete();
  herd.hide();
  G.z = L.cake.z + HORSE_SPOT.dz;
  G.x = HORSE_SPOT.x;
  G.yaw = HORSE_SPOT.yaw;
  G.speed = 0;
  horse.stand(true);
  world.dusk = 1;
  world.setDuskTarget(1);
  world.applyPalette(1);
  world.init(G.z);
  document.body.classList.add('finale');
  eagle.mode = 'perch';
  cut('cake');
  enterCake();
  if (params.has('nopeople')) {
    finale.people.forEach((p) => (p.root.visible = false));
    finale.carry.visible = false;
  }
  if (name === 'message') {
    finale.flames.forEach((f) => (f.lit = false));
  }
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('.loader-title').textContent = 'Не получилось загрузить 😢 Обнови страницу';
});
