import * as THREE from 'three';
import { LANE_W, WISH_FIRST, WISH_STEP, APPROACH_AT, GAP_DIST } from './layout.js';
import { toTexture, glowTexture, ringTexture, sparkleTexture, makePointsMaterial } from './fx.js';
import { rng, clamp, lerp } from './noise.js';

const FONT_LABEL = '"Cormorant Garamond", "Times New Roman", serif';

function labelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.font = `italic 700 82px ${FONT_LABEL}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 26;
  g.fillStyle = 'white';
  g.fillText(text, 256, 66);
  g.shadowBlur = 8;
  g.fillText(text, 256, 66);
  return toTexture(c);
}

function iconTexture(emoji, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, color);
  grad.addColorStop(0.62, color + 'aa');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(128, 128, 128, 0, Math.PI * 2);
  g.fill();
  g.font = `110px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 128, 136);
  return toTexture(c);
}

const beamMaterial = (color) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFres;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFres = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      varying vec2 vUv;
      varying float vFres;
      void main() {
        // With MSAA, edge pixels extrapolate varyings past [0, 1]; pow() of a negative base is NaN,
        // and the bloom spreads one NaN pixel into a black rectangle.
        float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.2) * pow(clamp(vFres, 0.0, 1.0), 1.5) * 0.55;
        a *= 0.8 + 0.2 * sin(vUv.y * 40.0 - uTime * 6.0);
        gl_FragColor = vec4(uColor * 1.4, a);
      }
    `,
  });

class Wish {
  constructor(def, index, glowTex, ringTex) {
    this.def = def;
    this.index = index;
    this.group = new THREE.Group();
    const color = new THREE.Color(def.color);
    const add = (tex, scale, opts = {}) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, ...opts }));
      s.scale.set(scale[0], scale[1], 1);
      this.group.add(s);
      return s;
    };
    this.glow = add(glowTex, [3.2, 3.2], { color, blending: THREE.AdditiveBlending, opacity: 0.9 });
    this.ring = add(ringTex, [2.0, 2.0], { color, blending: THREE.AdditiveBlending });
    this.icon = add(iconTexture(def.emoji, def.color), [1.35, 1.35]);
    this.label = add(labelTexture(def.title, def.color), [2.9, 0.72]);
    this.label.position.y = 1.25;
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 36, 16, 1, true), beamMaterial(def.color));
    this.beam.geometry.translate(0, 18, 0);
    this.beam.position.y = -1.3;
    this.group.add(this.beam);
    this.group.visible = false;
    this.state = 'hidden';
  }
}

export class Track {
  constructor(scene, { fx, hooks, wishes }) {
    this.scene = scene;
    this.fx = fx;
    this.hooks = hooks;
    this.r = rng(4242);
    const glowTex = glowTexture();
    const ringTex = ringTexture();
    this.glowTex = glowTex;
    this.wishes = wishes.map((d, i) => {
      const w = new Wish(d, i, glowTex, ringTex);
      scene.add(w.group);
      return w;
    });

    // Sparkles: one Points object, slots reused.
    const N = 180;
    this.sN = N;
    this.sPos = new Float32Array(N * 3);
    this.sAlive = new Uint8Array(N);
    const col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
    const gold = new THREE.Color(0xffe3a0);
    for (let i = 0; i < N; i++) {
      col.set([gold.r, gold.g, gold.b], i * 3);
      size[i] = 0;
      alpha[i] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    this.sGeo = geo;
    const mat = makePointsMaterial(sparkleTexture());
    mat.uniforms.uTime = { value: 0 };
    mat.vertexShader = mat.vertexShader
      .replace('uniform float uScale;', 'uniform float uScale;\nuniform float uTime;')
      .replace('gl_PointSize = min(', 'float tw = 0.8 + 0.25 * sin(uTime * 7.0 + position.z * 1.3 + position.x);\n    gl_PointSize = tw * min(');
    this.sMat = mat;
    this.sparkles = new THREE.Points(geo, mat);
    this.sparkles.frustumCulled = false;
    scene.add(this.sparkles);

    // Obstacles.
    const bark = new THREE.MeshLambertMaterial({ color: 0x6b4428, flatShading: true });
    const wood = new THREE.MeshLambertMaterial({ color: 0xd9aa72, flatShading: true });
    const logGeo = new THREE.CylinderGeometry(0.3, 0.32, 1.9, 9);
    logGeo.rotateZ(Math.PI / 2);
    const rockGeo = new THREE.DodecahedronGeometry(0.62, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x9c8070, flatShading: true });
    this.obstacles = [];
    for (let i = 0; i < 8; i++) {
      const log = new THREE.Mesh(logGeo, [bark, wood, wood]);
      log.castShadow = true;
      log.visible = false;
      scene.add(log);
      this.obstacles.push({ mesh: log, type: 'log', h: 0.62, active: false });
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.scale.set(1.1, 0.95, 1);
      rock.castShadow = true;
      rock.visible = false;
      scene.add(rock);
      this.obstacles.push({ mesh: rock, type: 'rock', h: 0.95, active: false });
    }
    this.time = 0;
  }

  reset(runStartZ) {
    this.startZ = runStartZ;
    this.nextD = 34;
    this.nextWish = 0;
    this.collected = 0;
    this.sAlive.fill(0);
    for (const o of this.obstacles) { o.active = false; o.mesh.visible = false; }
    let last = 0;
    this.wishes.forEach((w, i) => {
      w.state = 'hidden';
      w.group.visible = false;
      let lane = i === 0 ? 0 : Math.floor(this.r() * 3) - 1;
      if (i > 0 && lane === last && this.r() < 0.65) lane = lane === 0 ? (this.r() < 0.5 ? -1 : 1) : 0;
      w.lane = lane;
      last = lane;
    });
  }

  zAt(d) {
    return this.startZ - d;
  }

  addSparkle(x, y, d) {
    for (let i = 0; i < this.sN; i++) {
      if (!this.sAlive[i]) {
        this.sAlive[i] = 1;
        this.sPos.set([x, y, this.zAt(d)], i * 3);
        this.sGeo.attributes.aSize.array[i] = 0.62;
        return;
      }
    }
  }

  addObstacle(type, lane, d) {
    const o = this.obstacles.find((q) => !q.active && q.type === type);
    if (!o) return;
    o.active = true;
    o.hit = false;
    o.x = lane * LANE_W;
    o.z = this.zAt(d);
    o.vy = 0; o.vx = 0; o.spin = 0;
    o.mesh.visible = true;
    o.mesh.position.set(o.x, type === 'log' ? 0.3 : 0.45, o.z);
    o.mesh.rotation.set(0, type === 'rock' ? this.r() * 6 : (this.r() - 0.5) * 0.25, 0);
  }

  wishD(i) {
    return WISH_FIRST + i * WISH_STEP;
  }

  nearWish(d, pad = 16) {
    for (let i = 0; i < this.wishes.length; i++) if (Math.abs(this.wishD(i) - d) < pad) return i;
    return -1;
  }

  pattern(d) {
    const r = this.r;
    const lane = Math.floor(r() * 3) - 1;
    const wi = this.nearWish(d + 10, 20);
    const wishLane = wi >= 0 ? this.wishes[wi].lane : null;
    const tutorial = d < 125;
    const late = d > APPROACH_AT - 20;
    if (late) {
      for (let k = 0; k < 8; k++) this.addSparkle(0, 1.1, d + k * 3);
      return 26;
    }
    const roll = r();
    if (tutorial || wishLane !== null || roll < 0.3) {
      // Line of sparkles, leading into the wish lane when there is one.
      const target = wishLane ?? lane;
      const from = tutorial ? 0 : Math.floor(r() * 3) - 1;
      for (let k = 0; k < 7; k++) {
        const t = k / 6;
        this.addSparkle(lerp(from, target, Math.min(1, t * 1.6)) * LANE_W, 1.1, d + k * 2.8);
      }
      return 28;
    }
    if (roll < 0.62) {
      this.addObstacle('log', lane, d + 10);
      for (let k = -2; k <= 2; k++) this.addSparkle(lane * LANE_W, 1.2 + 1.35 * (1 - (k / 2.6) ** 2), d + 10 + k * 1.7);
      return 26;
    }
    if (roll < 0.85) {
      const free = lane;
      for (let l = -1; l <= 1; l++) if (l !== free) this.addObstacle('rock', l, d + 9 + (l + 1) * 1.5);
      for (let k = 0; k < 6; k++) this.addSparkle(free * LANE_W, 1.1, d + 2 + k * 2.6);
      return 26;
    }
    if (d > 380) {
      for (let l = -1; l <= 1; l++) this.addObstacle('log', l, d + 11);
      for (let k = -2; k <= 2; k++) this.addSparkle(lane * LANE_W, 1.2 + 1.35 * (1 - (k / 2.6) ** 2), d + 11 + k * 1.7);
      return 28;
    }
    return 18;
  }

  update(dt, G) {
    this.time += dt;
    this.sMat.uniforms.uTime.value = this.time;
    const d = this.startZ - G.z;
    const aheadD = d + 150;

    while (this.nextWish < this.wishes.length && this.wishD(this.nextWish) < aheadD) {
      const w = this.wishes[this.nextWish];
      w.x = w.lane * LANE_W;
      w.y = 1.35;
      w.z = this.zAt(this.wishD(this.nextWish));
      w.state = 'idle';
      w.group.visible = true;
      w.group.scale.setScalar(1);
      this.nextWish++;
    }
    while (this.nextD < aheadD && this.nextD < GAP_DIST - 30) this.nextD += this.pattern(this.nextD);

    const catchZ = G.z - 0.7;
    const headY = G.y + 1.2;

    // Sparkles.
    const sizes = this.sGeo.attributes.aSize.array;
    for (let i = 0; i < this.sN; i++) {
      if (!this.sAlive[i]) continue;
      const i3 = i * 3;
      let sx = this.sPos[i3], sy = this.sPos[i3 + 1], sz = this.sPos[i3 + 2];
      const dz = sz - catchZ;
      if (dz > 6) { this.sAlive[i] = 0; sizes[i] = 0; continue; }
      const dx = sx - G.x;
      if (Math.abs(dz) < 3.2 && Math.abs(dx) < 1.35 && Math.abs(sy - headY) < 1.4) {
        // Magnet.
        const k = 1 - Math.exp(-10 * dt);
        sx += (G.x - sx) * k;
        sy += (headY - sy) * k;
        sz += (catchZ - sz) * k * 0.6;
        this.sPos[i3] = sx; this.sPos[i3 + 1] = sy; this.sPos[i3 + 2] = sz;
      }
      if (Math.abs(sz - catchZ) < 1.1 && Math.abs(sx - G.x) < 0.95 && Math.abs(sy - headY) < 1.15) {
        this.sAlive[i] = 0;
        sizes[i] = 0;
        this.hooks.onSparkle(sx, sy, sz);
      }
    }
    this.sGeo.attributes.position.needsUpdate = true;
    this.sGeo.attributes.aSize.needsUpdate = true;

    // Wishes.
    for (const w of this.wishes) {
      if (w.state === 'hidden' || w.state === 'done') continue;
      const g = w.group;
      w.beam.material.uniforms.uTime.value = this.time;
      w.ring.material.rotation = this.time * 1.5 + w.index;
      w.glow.material.opacity = 0.75 + 0.2 * Math.sin(this.time * 4 + w.index);
      if (w.state === 'idle') {
        const dz = w.z - catchZ;
        const dx = w.x - G.x;
        if (dz > -5 && dz < 1.5 && Math.abs(dx) < 1.8) {
          const k = 1 - Math.exp(-7 * dt);
          w.x += (G.x - w.x) * k;
          w.y += (headY + 0.2 - w.y) * k;
        }
        if (Math.abs(w.z - catchZ) < 1.3 && Math.abs(w.x - G.x) < 1.2) this.collect(w);
        else if (dz > 1.5) {
          w.state = 'chase';
          w.chaseT = 0;
          this.hooks.onWishMissed?.(w);
        }
        g.position.set(w.x, w.y + Math.sin(this.time * 2.4 + w.index) * 0.18, w.z);
      } else if (w.state === 'chase') {
        w.chaseT += dt;
        const k = 1 - Math.exp(-4 * dt);
        w.x += (G.x - w.x) * k;
        w.y += (headY + 0.8 - w.y) * k;
        w.z += (G.z - 1.2 - w.z) * k * 1.4;
        w.beam.visible = false;
        g.position.set(w.x, w.y, w.z);
        if (w.chaseT > 0.9) this.collect(w);
      } else if (w.state === 'pop') {
        w.popT += dt;
        const s = 1 + w.popT * 3;
        g.scale.setScalar(s);
        g.position.set(G.x, G.y + 1.6 + w.popT * 1.5, G.z - 1);
        for (const ch of g.children) if (ch.material?.opacity !== undefined) ch.material.opacity = Math.max(0, 1 - w.popT * 3);
        if (w.popT > 0.35) { w.state = 'done'; g.visible = false; }
      }
    }

    // Obstacles.
    for (const o of this.obstacles) {
      if (!o.active) continue;
      if (o.hit) {
        o.vy -= 22 * dt;
        o.mesh.position.x += o.vx * dt;
        o.mesh.position.y += o.vy * dt;
        o.mesh.rotation.x += o.spin * dt;
        if (o.mesh.position.y < -3) { o.active = false; o.mesh.visible = false; }
        continue;
      }
      if (o.z > G.z + 12) { o.active = false; o.mesh.visible = false; continue; }
      if (Math.abs(o.z - G.z) < 0.95 && Math.abs(o.x - G.x) < 1.05 && G.y < o.h - 0.15) {
        o.hit = true;
        o.vy = 7;
        o.vx = (o.x - G.x >= 0 ? 1 : -1) * 6 + (o.x === 0 ? 5 : 0);
        o.spin = 8;
        this.hooks.onHit(o);
      }
    }
  }

  collect(w) {
    w.beam.visible = false;
    w.state = 'pop';
    w.popT = 0;
    this.collected++;
    this.hooks.onWish(w);
  }

  forceComplete() {
    for (const w of this.wishes) {
      if (w.state === 'hidden') {
        w.state = 'done';
        this.collected++;
        this.hooks.onWish(w, true);
      } else if (w.state === 'idle' || w.state === 'chase') this.collect(w);
    }
  }

  clearAhead() {
    for (const o of this.obstacles) if (!o.hit) { o.active = false; o.mesh.visible = false; }
  }
}
