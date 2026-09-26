import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { gap, cake, GAP_WIDTH } from './layout.js';
import { Particles, toTexture, glowTexture, softDotTexture, sparkleTexture, toon, addOutline } from './fx.js';
import { rng, vnoise, clamp, lerp } from './noise.js';
import { loadImage, photoTexture, makeBigGuest, makeTallGuest } from './people.js';

const C = (hex) => new THREE.Color(hex);
const _v = new THREE.Vector3();

// The guests, tray and cake live in one group; this scale sets them against the horse.
const PARTY_SCALE = 0.86;
const TRAY_Y = 0.95;
const TRAY_R = 0.576;

// ---------- Canyon ----------

function canyonWall(width, depth, facing, seed) {
  const geo = new THREE.PlaneGeometry(width, depth, 140, 36);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const bands = [C(0xc2603c), C(0xe0975c), C(0xa24a30), C(0xeeb57a), C(0xc8714a), C(0x8e3f2c)];
  const deep = C(0x3a2140);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const fromTop = depth / 2 - y;
    const top = fromTop < 0.01;
    const band = Math.floor((fromTop + vnoise(x * 0.03, seed) * 4) / 6.5);
    // Ledges: every stratum sticks out a little, plus rough noise.
    const ledge = (band % 2) * 1.4;
    const n = vnoise(x * 0.09 + seed, y * 0.14) * 2.4 + vnoise(x * 0.35, y * 0.5 + seed) * 0.9;
    pos.setZ(i, top ? 0 : n * (0.5 + fromTop / depth) + ledge * Math.min(1, fromTop / 4));
    const shade = 0.8 + 0.35 * vnoise(x * 0.2, y * 0.2 + seed);
    tmp.copy(bands[band % bands.length]).multiplyScalar(shade);
    tmp.lerp(deep, Math.pow(Math.min(1, fromTop / depth), 0.8) * 0.85);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.translate(0, -depth / 2, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x4a1c14, emissiveIntensity: 0.35 }));
  mesh.rotation.y = facing;
  mesh.receiveShadow = true;
  return mesh;
}

function riverMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float s = sin(vUv.x * 300.0 + uTime * 3.0 + sin(vUv.y * 20.0) * 3.0) * 0.5 + 0.5;
        vec3 col = mix(vec3(0.05, 0.28, 0.4), vec3(0.4, 0.8, 0.9), pow(max(s, 0.0), 8.0) * 0.6);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

function mistMaterial(tex) {
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.45, depthWrite: false, color: 0xc9a6d8, fog: false });
}

// ---------- Cake ----------

function textOnCylinderTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  // Piped dots along the edges.
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let x = 0; x < c.width; x += 28) {
    g.beginPath(); g.arc(x + 14, 22, 9, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = fg;
  g.font = '104px "Bad Script", cursive';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(120,20,60,0.35)';
  g.shadowBlur = 6;
  g.fillText(text, c.width / 2, 140);
  // Little hearts around the back.
  g.font = '64px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  g.shadowBlur = 0;
  for (const u of [0.08, 0.2, 0.8, 0.92]) g.fillText('♡', c.width * u, 140);
  const t = toTexture(c);
  t.anisotropy = 4;
  return t;
}

function stripeTexture(a, b) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 64, 256);
  g.fillStyle = b;
  for (let y = -64; y < 320; y += 48) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(64, y + 32); g.lineTo(64, y + 52); g.lineTo(0, y + 20); g.fill();
  }
  return toTexture(c);
}

const flameMaterial = (seed) =>
  new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uLife: { value: 1 }, uLean: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime, uSeed, uLife, uLean;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        float k = uv.y * uv.y;
        p.x += (sin(uTime * 9.0 + uSeed * 10.0) * 0.012 + sin(uTime * 23.0 + uSeed) * 0.004) * uv.y + uLean * k * 0.08;
        p.y *= (0.88 + 0.12 * sin(uTime * 13.0 + uSeed * 7.0)) * (0.2 + 0.8 * uLife);
        p.x *= 0.6 + 0.4 * uLife;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLife;
      varying vec2 vUv;
      void main() {
        float y = clamp(vUv.y, 0.0, 1.0);
        float w = mix(0.5, 0.04, pow(y, 0.9));
        float dx = abs(vUv.x - 0.5) / w;
        float dy = y < 0.28 ? (0.28 - y) / 0.28 : 0.0;
        float d = length(vec2(dx, dy));
        float shape = 1.0 - smoothstep(0.55, 1.0, d);
        shape *= smoothstep(1.0, 0.75, y);
        vec3 core = vec3(1.0, 0.97, 0.85);
        vec3 mid = vec3(1.0, 0.72, 0.25);
        vec3 edge = vec3(1.0, 0.35, 0.08);
        vec3 col = mix(core, mid, smoothstep(0.1, 0.6, d));
        col = mix(col, edge, smoothstep(0.55, 0.95, d));
        col = mix(col, vec3(0.3, 0.45, 1.0), smoothstep(0.2, 0.0, y) * 0.6);
        gl_FragColor = vec4(col * 1.6, shape * uLife);
      }
    `,
  });

function heartShape(s = 1) {
  const sh = new THREE.Shape();
  sh.moveTo(0, -0.9 * s);
  sh.bezierCurveTo(-0.2 * s, -0.6 * s, -1.0 * s, -0.25 * s, -1.0 * s, 0.25 * s);
  sh.bezierCurveTo(-1.0 * s, 0.75 * s, -0.45 * s, 0.95 * s, 0, 0.55 * s);
  sh.bezierCurveTo(0.45 * s, 0.95 * s, 1.0 * s, 0.75 * s, 1.0 * s, 0.25 * s);
  sh.bezierCurveTo(1.0 * s, -0.25 * s, 0.2 * s, -0.6 * s, 0, -0.9 * s);
  return sh;
}

// ---------- Blow detection ----------

export class BlowDetector {
  constructor() {
    this.level = 0;
    this.active = false;
  }

  static available() {
    return !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
  }

  async start(ctx) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.stream = stream;
    const src = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.buf = new Uint8Array(this.analyser.frequencyBinCount);
    this.active = true;
  }

  // 0..1 strength of a blow: loud, low-frequency, broadband.
  read() {
    if (!this.active) return 0;
    this.analyser.getByteFrequencyData(this.buf);
    let low = 0;
    const n = Math.floor(this.buf.length * 0.12);
    for (let i = 1; i < n; i++) low += this.buf[i];
    low /= n * 255;
    this.level = lerp(this.level, low, 0.35);
    return clamp((this.level - 0.35) / 0.3, 0, 1);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.active = false;
  }
}

// ---------- Finale ----------

export class Finale {
  constructor(scene, { people, horseGltf }) {
    this.scene = scene;
    this.peopleCfg = people;
    this.time = 0;
    this.flames = [];
    this.built = false;
    this.fireworks = new Particles({ max: 3200, texture: softDotTexture(), gravity: -2.6, drag: 0.9, fade: 1.2, twinkle: 0.35 });
    this.trail = new Particles({ max: 600, texture: softDotTexture(), gravity: -1, drag: 1.5, fade: 1.5 });
    this.smoke = new Particles({ max: 400, texture: softDotTexture(), blending: THREE.NormalBlending, gravity: 0.25, drag: 0.6, fade: 1.3 });
    scene.add(this.fireworks.points, this.trail.points, this.smoke.points);
    this.rockets = [];
    this.glowTex = glowTexture();
  }

  async prepare() {
    const [font, ...imgs] = await Promise.all([
      new FontLoader().loadAsync('./assets/helvetiker_bold.typeface.json'),
      ...this.peopleCfg.map((p) => loadImage(p.photo)),
    ]);
    this.font = font;
    this.photos = this.peopleCfg.map((p, i) => photoTexture(imgs[i], { fade: p.fade }));
  }

  // Built once at boot so every shader compiles before the first tap; place() moves it later.
  build() {
    if (this.built) return;
    this.built = true;
    this.buildCanyon();
    this.buildCakeSet();
    this.place();
  }

  place() {
    this.canyon.position.z = gap.near;
    this.set.position.set(cake.x, 0, cake.z);
  }

  // The set stays hidden until it is near (see update), so its textures would otherwise upload mid-run.
  uploadTextures(renderer) {
    const textures = new Set();
    for (const root of [this.set, this.canyon]) {
      root.traverse((o) => {
        for (const m of [].concat(o.material || [])) {
          for (const v of Object.values(m)) if (v && v.isTexture) textures.add(v);
          for (const u of Object.values(m.uniforms || {})) if (u.value && u.value.isTexture) textures.add(u.value);
        }
      });
    }
    textures.forEach((t) => renderer.initTexture(t));
  }

  buildCanyon() {
    const g = new THREE.Group();
    const depth = 90, width = 460;
    // Local coordinates: z = 0 is the near edge; place() moves the group.
    const half = GAP_WIDTH / 2;
    const nearWall = canyonWall(width, depth, Math.PI, 1.7);
    nearWall.position.set(0, 0.02, 0);
    const farWall = canyonWall(width, depth, 0, 5.3);
    farWall.position.set(0, 0.02, -GAP_WIDTH);
    g.add(nearWall, farWall);
    const river = new THREE.Mesh(new THREE.PlaneGeometry(width, GAP_WIDTH), riverMaterial());
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, -depth + 4, -half);
    this.river = river;
    g.add(river);
    const mistTex = toTexture((() => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const x = c.getContext('2d');
      for (let i = 0; i < 40; i++) {
        const px = Math.random() * 256, py = Math.random() * 256, r = 30 + Math.random() * 60;
        const gr = x.createRadialGradient(px, py, 0, px, py, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.35)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = gr;
        x.fillRect(0, 0, 256, 256);
      }
      return c;
    })());
    mistTex.wrapS = mistTex.wrapT = THREE.RepeatWrapping;
    mistTex.repeat.set(6, 1);
    this.mists = [];
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, GAP_WIDTH), mistMaterial(mistTex));
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, -14 - k * 18, -half);
      g.add(m);
      this.mists.push(m);
    }
    this.mistTex = mistTex;
    // Rim boulders.
    const r = rng(31);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0xa0664a, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 70);
    const d = new THREE.Object3D();
    for (let i = 0; i < 70; i++) {
      const near = i % 2 === 0;
      let x = (r() - 0.5) * 160;
      if (Math.abs(x) < 3.5) x += Math.sign(x || 1) * 4;
      d.position.set(x, 0.1, (near ? 0 : -GAP_WIDTH) + (near ? 1 : -1) * (0.8 + r() * 3));
      d.scale.set(0.4 + r() * 1.4, 0.3 + r() * 0.8, 0.4 + r() * 1.2);
      d.rotation.set(r(), r() * 6, r());
      d.updateMatrix();
      rocks.setMatrixAt(i, d.matrix);
    }
    g.add(rocks);
    this.scene.add(g);
    this.canyon = g;
  }

  buildCakeSet() {
    const set = new THREE.Group();
    set.position.set(cake.x, 0, cake.z);
    this.set = set;
    this.scene.add(set);

    // The carried group: tray + cake + candles, held by two guests.
    const party = new THREE.Group();
    party.scale.setScalar(PARTY_SCALE);
    set.add(party);
    const carry = new THREE.Group();
    carry.position.y = TRAY_Y;
    carry.scale.setScalar(0.8);
    this.carry = carry;
    party.add(carry);

    const std = (hex, o = {}) => toon({ color: hex, ...o });
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.66, 0.045, 48), std(0xdcbf8c));
    tray.castShadow = true;
    carry.add(tray);
    const doily = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.006, 32), std(0xe8d9c8));
    doily.position.y = 0.026;
    carry.add(doily);

    const t1h = 0.36, t1r = 0.52, t2h = 0.28, t2r = 0.36;
    const sideTex = textOnCylinderTexture('С днём рождения', '#f7c3cf', '#b8325f');
    const pink = std(0xf7c3cf);
    const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(t1r, t1r, t1h, 64), [std(0xffffff, { map: sideTex }), pink, pink]);
    tier1.position.y = 0.03 + t1h / 2;
    tier1.castShadow = true;
    addOutline(tier1, { width: 0.008, color: 0x5a1a30 });
    carry.add(tier1);
    const cream = std(0xfff3e4);
    const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(t2r, t2r, t2h, 56), cream);
    tier2.position.y = 0.03 + t1h + t2h / 2;
    tier2.castShadow = true;
    addOutline(tier2, { width: 0.008, color: 0x5a1a30 });
    carry.add(tier2);
    const topY = 0.03 + t1h + t2h;
    const ganache = new THREE.Mesh(new THREE.CylinderGeometry(t2r + 0.012, t2r + 0.012, 0.03, 56), std(0xff8fb3));
    ganache.position.y = topY;
    carry.add(ganache);

    const r = rng(7);
    // Drips.
    const dripGeo = new THREE.SphereGeometry(1, 8, 6);
    const drips = new THREE.InstancedMesh(dripGeo, std(0xff8fb3), 30);
    const d = new THREE.Object3D();
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + r() * 0.1;
      const len = 0.04 + r() * 0.09;
      d.position.set(Math.sin(a) * (t2r + 0.004), topY - len * 0.9, Math.cos(a) * (t2r + 0.004));
      d.scale.set(0.028, len, 0.028);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      drips.setMatrixAt(i, d.matrix);
    }
    carry.add(drips);
    // Piped pearls.
    const pearlGeo = new THREE.SphereGeometry(1, 8, 6);
    const pearls = new THREE.InstancedMesh(pearlGeo, std(0xffffff), 80);
    let pi = 0;
    for (const [rad, y, n] of [[t1r, 0.045, 44], [t2r, 0.03 + t1h + 0.01, 36]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        d.position.set(Math.sin(a) * rad, y, Math.cos(a) * rad);
        d.scale.setScalar(0.028);
        d.updateMatrix();
        pearls.setMatrixAt(pi++, d.matrix);
      }
    }
    carry.add(pearls);
    // Berries on the lower ledge.
    const berries = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), std(0xffffff), 18);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.17;
      const rr = (t1r + t2r) / 2 + 0.02;
      d.position.set(Math.sin(a) * rr, 0.03 + t1h + 0.03, Math.cos(a) * rr);
      d.scale.setScalar(i % 3 === 0 ? 0.03 : 0.038);
      d.updateMatrix();
      berries.setMatrixAt(i, d.matrix);
      berries.setColorAt(i, C(i % 3 === 0 ? 0x3b4fa8 : 0xd8203f));
    }
    carry.add(berries);

    // Number candles "2" "9".
    const numMat = std(0xffa9c4, { emissive: 0x3a0a1a });
    const numbers = new THREE.Group();
    numbers.rotation.y = Math.PI;
    numbers.position.y = topY + 0.015;
    carry.add(numbers);
    this.candles = [];
    const digits = String(this.age ?? 29).split('');
    digits.forEach((ch, k) => {
      const g = new TextGeometry(ch, { font: this.font, size: 0.24, depth: 0.07, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.008, bevelSegments: 2 });
      g.computeBoundingBox();
      const bb = g.boundingBox;
      g.translate(-(bb.max.x + bb.min.x) / 2, -bb.min.y, -(bb.max.z + bb.min.z) / 2);
      const m = new THREE.Mesh(g, numMat);
      m.castShadow = true;
      m.position.x = (k - (digits.length - 1) / 2) * 0.2;
      numbers.add(m);
      const h = bb.max.y - bb.min.y;
      this.addCandleFlame(numbers, new THREE.Vector3(m.position.x, h + 0.005, 0), k);
    });

    // Small striped candles on the ledge.
    const stripeCols = [['#fff2f6', '#ff8fb3'], ['#fffbea', '#ffc857'], ['#f3f0ff', '#a78bfa'], ['#eefcff', '#5ec8e5']];
    const candleGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.2, 10);
    const N = 7;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.PI / N;
      const rr = (t1r + t2r) / 2 - 0.01;
      const [ca, cb] = stripeCols[i % stripeCols.length];
      const m = new THREE.Mesh(candleGeo, std(0xffffff, { map: stripeTexture(ca, cb) }));
      m.position.set(Math.sin(a) * rr, 0.03 + t1h + 0.1, Math.cos(a) * rr);
      carry.add(m);
      this.addCandleFlame(carry, new THREE.Vector3(m.position.x, m.position.y + 0.1, m.position.z), 10 + i);
    }

    this.candleLight = new THREE.PointLight(0xffa860, 1.2, 6, 1.6);
    this.candleLight.position.set(0, topY + 0.45, -0.1);
    carry.add(this.candleLight);

    // Guests: the big one on the left of the screen (+x), the tall one on the right (-x).
    // They stand just behind the tray, so its rim covers their inner hands.
    const [bigCfg, tallCfg] = this.peopleCfg;
    const pz = TRAY_R + 0.06;
    const big = makeBigGuest(bigCfg, this.photos[0]);
    big.root.position.set(0.76, 0, pz);
    big.root.scale.setScalar(1.2);
    const tall = makeTallGuest(tallCfg, this.photos[1]);
    tall.root.position.set(-0.86, 0, pz);
    this.people = [big, tall];
    this.people.forEach((p, i) => {
      p.phase = i * 1.7;
      party.add(p.root);
    });

    // Balloons.
    const balloonMat = (hex) => toon({ color: hex, emissive: hex, emissiveIntensity: 0.12 });
    const heartGeo = new THREE.ExtrudeGeometry(heartShape(0.2), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 4, curveSegments: 16 });
    heartGeo.center();
    const roundGeo = new THREE.SphereGeometry(0.2, 20, 14);
    roundGeo.scale(1, 1.18, 1);
    this.balloons = [];
    const defs = [
      [1.95, 2.35, 0.5, 0xff3b6b, heartGeo], [2.35, 2.75, 0.9, 0xffc857, roundGeo], [1.75, 2.9, 1.1, 0xff8fb3, heartGeo],
      [-1.95, 2.45, 0.6, 0xff3b6b, heartGeo], [-2.3, 2.85, 1.0, 0xffffff, roundGeo], [-1.7, 3.0, 1.2, 0xff8fb3, heartGeo],
    ];
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    for (const [x, y, z, col, geo] of defs) {
      const m = new THREE.Mesh(geo, balloonMat(col));
      addOutline(m, { width: 0.01 });
      m.position.set(x, y, z);
      const anchor = new THREE.Vector3(x * 0.85, 0.02, z - 0.2);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([anchor, m.position.clone()]);
      const line = new THREE.Line(lineGeo, lineMat);
      set.add(m, line);
      this.balloons.push({ m, line, anchor, base: m.position.clone(), ph: x * 3 + y });
    }

    // Fairy lights on two posts behind.
    const postMat = new THREE.MeshLambertMaterial({ color: 0x6b4a30, flatShading: true });
    const posts = [new THREE.Vector3(-3.4, 0, 3.4), new THREE.Vector3(3.4, 0, 3.4)];
    for (const p of posts) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.1, 6), postMat);
      post.position.set(p.x, 1.55, p.z);
      set.add(post);
    }
    const bulbN = 26;
    const bulbPos = [];
    for (let i = 0; i < bulbN; i++) {
      const t = i / (bulbN - 1);
      const x = lerp(-3.4, 3.4, t);
      const y = 3.0 - Math.sin(t * Math.PI) * 0.75;
      bulbPos.push(new THREE.Vector3(x, y, 3.4));
    }
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bulbPos), new THREE.LineBasicMaterial({ color: 0x2a2018 }));
    set.add(wire);
    const bulbCols = [0xffd27a, 0xff9fb8, 0xfff0c8, 0xffb36b];
    this.bulbs = [];
    for (let i = 0; i < bulbN; i++) {
      const col = C(bulbCols[i % bulbCols.length]);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
      s.position.copy(bulbPos[i]).add(new THREE.Vector3(0, -0.05, 0));
      s.scale.setScalar(0.35);
      set.add(s);
      this.bulbs.push({ s, ph: i * 0.7 });
    }
    // Lanterns.
    this.lanterns = [];
    for (const [x, z] of [[-1.6, -0.9], [1.7, -1.0], [-2.6, 0.9], [2.7, 0.6]]) {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.13, 10), toon({ color: 0xc98a4a, emissive: 0xff9a3c, emissiveIntensity: 0.7 }));
      jar.position.set(x, 0.065, z);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb060, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
      glow.position.set(x, 0.1, z);
      glow.scale.setScalar(0.6);
      set.add(jar, glow);
      this.lanterns.push(glow);
    }
    this.fairyLight = new THREE.PointLight(0xffc27a, 0, 9, 1.4);
    this.fairyLight.position.set(0, 2.6, 2.8);
    set.add(this.fairyLight);

    // A meadow of flowers around the group.
    const flowerN = 220;
    const flowerHead = new THREE.IcosahedronGeometry(0.045, 0);
    flowerHead.scale(1, 0.45, 1);
    const fl = new THREE.InstancedMesh(flowerHead, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x1a0c06 }), flowerN);
    const fcols = [0xfff4d6, 0xffd23f, 0xc78bff, 0xff8fb8, 0xffffff];
    for (let i = 0; i < flowerN; i++) {
      const a = r() * Math.PI * 2, rad = 1.2 + Math.pow(r(), 0.7) * 5;
      const fz = Math.abs(Math.sin(a)) * rad - 0.6;
      d.position.set(Math.cos(a) * rad, 0.12 + r() * 0.08, fz);
      d.scale.setScalar(0.4 + r() * 0.4);
      d.updateMatrix();
      fl.setMatrixAt(i, d.matrix);
      fl.setColorAt(i, C(fcols[i % fcols.length]));
    }
    set.add(fl);

    // Fireflies.
    this.fireflies = new Particles({ max: 60, texture: softDotTexture(), gravity: 0, drag: 0, fade: 0.6 });
    set.add(this.fireflies.points);
    this.set.visible = true;
  }

  addCandleFlame(parent, pos, seed) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.15), flameMaterial(seed * 1.37));
    mesh.geometry.translate(0, 0.07, 0);
    mesh.position.copy(pos);
    parent.add(mesh);
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.035, 4), new THREE.MeshBasicMaterial({ color: 0x1a1410 }));
    wick.position.copy(pos).add(new THREE.Vector3(0, -0.01, 0));
    parent.add(wick);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffa24a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    glow.position.copy(pos).add(new THREE.Vector3(0, 0.06, 0));
    glow.scale.setScalar(0.34);
    parent.add(glow);
    this.flames.push({ mesh, glow, lit: true, life: 1, lean: 0 });
  }

  get litCount() {
    return this.flames.filter((f) => f.lit).length;
  }

  // One puff: put out a few candles, the rest flicker hard.
  gust(n = 3) {
    const lit = this.flames.filter((f) => f.lit);
    for (let i = lit.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lit[i], lit[j]] = [lit[j], lit[i]];
    }
    lit.slice(0, n).forEach((f) => (f.lit = false));
    for (const f of this.flames) f.lean = 1;
  }

  blow(strength, dt) {
    for (const f of this.flames) {
      f.lean = Math.max(f.lean, strength);
      if (f.lit && strength > 0.2) {
        f.hp = (f.hp ?? 1) - strength * dt * (1.2 + Math.random() * 2.5);
        if (f.hp <= 0) f.lit = false;
      }
    }
  }

  relight() {
    for (const f of this.flames) { f.lit = true; f.hp = 1; }
  }

  launch(type, x, z, y, color) {
    this.rockets.push({ type, pos: new THREE.Vector3(x, 0, z), target: y, color: C(color), speed: 22 + Math.random() * 6 });
  }

  burst(r, camera) {
    const p = r.pos;
    const col = r.color;
    const white = C(0xfff4e0);
    if (r.type === 'heart') {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      for (let i = 0; i < 260; i++) {
        const t = (i / 260) * Math.PI * 2;
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        const k = 0.42 * (0.96 + Math.random() * 0.08);
        const v = right.clone().multiplyScalar(hx * k).addScaledVector(up, hy * k);
        this.fireworks.emit(p.x, p.y, p.z, v.x, v.y, v.z, 2.6 + Math.random() * 0.4, 0.55, 0.3, i % 5 ? col : white, 1, 0.25);
      }
    } else if (r.type === 'willow') {
      for (let i = 0; i < 180; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(7 + Math.random() * 2);
        this.fireworks.emit(p.x, p.y, p.z, v.x, v.y, v.z, 3 + Math.random(), 0.45, 0.15, col, 1, 1.4);
      }
    } else {
      const col2 = C([0xff5d8f, 0xffd166, 0xc9a2ff, 0x7be0ff, 0xffffff][Math.floor(Math.random() * 5)]);
      for (let i = 0; i < 200; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(9 + Math.random() * 3);
        this.fireworks.emit(p.x, p.y, p.z, v.x, v.y, v.z, 1.8 + Math.random() * 0.7, 0.6, 0.2, i % 2 ? col : col2, 1, 1);
      }
      for (let i = 0; i < 40; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(3);
        this.fireworks.emit(p.x, p.y, p.z, v.x, v.y, v.z, 0.6, 1.4, 0.3, white, 1, 0);
      }
    }
  }

  update(dt, camera, { cheer = 0, onBurst } = {}) {
    this.time += dt;
    // Far away it is lost in the fog and would only cost ~125 draw calls per frame.
    this.set.visible = this.canyon.visible = Math.abs(camera.position.z - this.canyon.position.z) < 320;
    if (this.river) this.river.material.uniforms.uTime.value = this.time;
    if (this.mistTex) this.mistTex.offset.x = this.time * 0.01;

    for (const f of this.flames) {
      f.life = f.lit ? Math.min(1, f.life + dt * 3) : Math.max(0, f.life - dt * 5);
      f.lean = Math.max(0, f.lean - dt * 2.5);
      const u = f.mesh.material.uniforms;
      u.uTime.value = this.time;
      u.uLife.value = f.life;
      u.uLean.value = f.lean;
      f.mesh.quaternion.copy(camera.quaternion);
      f.mesh.visible = f.life > 0.01;
      f.glow.material.opacity = f.life * (0.85 + 0.15 * Math.sin(this.time * 17 + f.mesh.id));
      if (!f.lit && f.life > 0 && f.life < 0.9 && !f.smoked) {
        f.smoked = true;
        f.smokeT = 1.6;
      }
      if (f.lit) f.smoked = false;
      if (f.smokeT > 0) {
        f.smokeT -= dt;
        const wp = f.mesh.getWorldPosition(new THREE.Vector3());
        if (Math.random() < 0.6) {
          this.smoke.emit(wp.x, wp.y + 0.03, wp.z, (Math.random() - 0.5) * 0.08, 0.25 + Math.random() * 0.15, (Math.random() - 0.5) * 0.08, 1.8, 0.05, 0.28, C(0xd8d0d8), 0.4);
        }
      }
    }
    if (this.candleLight) {
      const lit = this.flames.reduce((s, f) => s + f.life, 0) / Math.max(1, this.flames.length);
      this.candleLight.intensity = 1.25 * lit * (0.9 + 0.1 * Math.sin(this.time * 19));
    }

    if (this.people) {
      this.people.forEach((p, i) => {
        p.root.position.y = cheer * Math.abs(Math.sin(this.time * 7 + i)) * 0.04;
        p.body.position.y = p.baseY + Math.sin(this.time * 2.2 + p.phase) * 0.006;
        p.body.rotation.z = Math.sin(this.time * (cheer ? 5 : 1.3) + p.phase) * (0.012 + cheer * 0.03);
        // Turn to the camera around the vertical axis only, so the standee never tilts back.
        const cam = p.root.parent.worldToLocal(_v.copy(camera.position));
        p.root.rotation.y = Math.atan2(cam.x - p.root.position.x, cam.z - p.root.position.z);
      });
      this.carry.position.y = TRAY_Y + (this.people[0].root.position.y + this.people[1].root.position.y) / 2;
    }
    if (this.balloons) {
      for (const b of this.balloons) {
        b.m.position.set(b.base.x + Math.sin(this.time * 0.9 + b.ph) * 0.06, b.base.y + Math.sin(this.time * 1.3 + b.ph) * 0.07, b.base.z);
        b.m.rotation.set(0, Math.sin(this.time * 0.7 + b.ph) * 0.4, Math.sin(this.time * 0.8 + b.ph) * 0.1);
        const arr = b.line.geometry.attributes.position.array;
        arr[3] = b.m.position.x; arr[4] = b.m.position.y - 0.22; arr[5] = b.m.position.z;
        b.line.geometry.attributes.position.needsUpdate = true;
      }
      for (const bl of this.bulbs) bl.s.material.opacity = 0.75 + 0.25 * Math.sin(this.time * 2 + bl.ph);
      if (this.fireflies.count < 40 && Math.random() < dt * 20) {
        const a = Math.random() * Math.PI * 2, rad = 1.5 + Math.random() * 4;
        this.fireflies.emit(Math.cos(a) * rad, 0.3 + Math.random() * 2, Math.sin(a) * rad, (Math.random() - 0.5) * 0.3, (Math.random() - 0.3) * 0.2, (Math.random() - 0.5) * 0.3, 3 + Math.random() * 2, 0.07, 0.07, C(0xfff0a0), 1);
      }
      this.fireflies.update(dt);
    }

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.pos.y += r.speed * dt;
      r.speed *= Math.exp(-0.6 * dt);
      this.trail.emit(r.pos.x, r.pos.y, r.pos.z, (Math.random() - 0.5) * 0.4, -1, (Math.random() - 0.5) * 0.4, 0.6, 0.35, 0.05, C(0xffd9a0), 0.9);
      if (r.pos.y >= r.target) {
        this.burst(r, camera);
        onBurst?.(r);
        this.rockets.splice(i, 1);
      }
    }
    this.fireworks.update(dt);
    this.trail.update(dt);
    this.smoke.update(dt);
  }
}
