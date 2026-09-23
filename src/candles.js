import * as THREE from 'three'
import { layerColor } from './palette.js'

// Numeral candles drawn as soft wax tubes, so no font file is needed.
function arc(cx, cy, r, from, to, steps) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return pts
}

function quad(p0, p1, p2, steps) {
  const pts = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]])
  }
  return pts
}

function line(p0, p1, steps) {
  const pts = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    pts.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t])
  }
  return pts
}

const DIGITS = {
  2: () => {
    const top = arc(0, 0.7, 0.26, 160, -25, 14)
    const end = top[top.length - 1]
    const diag = quad(end, [0.02, 0.3], [-0.27, 0.03], 10)
    const base = line([-0.27, 0.03], [0.29, 0.03], 6)
    return { pts: [...top, ...diag, ...base], wick: [0, 0.96] }
  },
  9: () => {
    const stem = quad([-0.14, 0.03], [0.27, 0.08], [0.26, 0.6], 10)
    const loop = arc(0, 0.7, 0.26, -20, 340, 26)
    return { pts: [[-0.14, 0.03], ...stem, ...loop], wick: [0, 0.96] }
  },
}

const flameVertex = /* glsl */ `
  uniform float uTime;
  uniform float uLife;
  uniform float uWind;
  uniform float uSeed;
  uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float flick = 1.0 + 0.10 * sin(uTime * 17.0 + uSeed) + 0.06 * sin(uTime * 29.0 + uSeed * 2.3);
    vec2 p = position.xy;
    float up = p.y + 0.5;
    vec2 size = uSize * vec2(1.0, flick) * uLife;
    float sway = (0.08 * sin(uTime * 6.0 + uSeed) + uWind) * up * up;
    vec3 pos = c.xyz + vec3(p.x * size.x + sway * size.y, up * size.y - size.y * 0.1, 0.0);
    gl_Position = projectionMatrix * vec4(pos, 1.0);
  }
`

const flameFragment = /* glsl */ `
  uniform float uLife;
  varying vec2 vUv;
  void main() {
    float y = vUv.y;
    float hw = 0.47 * 2.6 * sqrt(max(y, 0.0)) * (1.0 - y);
    float d = abs(vUv.x - 0.5) / max(hw, 0.001);
    float body = smoothstep(1.0, 0.55, d) * smoothstep(0.0, 0.06, y);
    float core = smoothstep(0.7, 0.0, d) * smoothstep(0.75, 0.15, y);
    vec3 outer = mix(vec3(1.0, 0.55, 0.18), vec3(1.0, 0.35, 0.25), y);
    vec3 col = mix(outer, vec3(1.0, 0.96, 0.82), core);
    col = mix(col, vec3(0.45, 0.55, 1.0), smoothstep(0.18, 0.0, y) * 0.5);
    gl_FragColor = vec4(col * body * 1.4, body * uLife);
  }
`

const glowVertex = /* glsl */ `
  uniform vec2 uSize;
  uniform float uLife;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec3 pos = c.xyz + vec3(position.xy * uSize * (0.4 + 0.6 * uLife), 0.0);
    gl_Position = projectionMatrix * vec4(pos, 1.0);
  }
`

const glowFragment = /* glsl */ `
  uniform float uLife;
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = exp(-r * r * 5.0) * (0.55 + 0.08 * sin(uTime * 13.0 + uSeed));
    // Alpha must fade too: the canvas is transparent, and alpha 1 would punch a dark square.
    gl_FragColor = vec4(vec3(1.0, 0.72, 0.4), a * uLife);
  }
`

function smokeTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

export class Candles {
  constructor(total) {
    this.group = new THREE.Group()
    this.flames = []
    this.effects = []
    this.smokeMap = smokeTexture()
    this.wind = 0

    const colors = [layerColor(1, total), layerColor(Math.round(total * 0.72), total)]
    const digits = ['2', '9']
    const scale = 0.95
    digits.forEach((digit, i) => {
      const { pts, wick } = DIGITS[digit]()
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal')
      const radius = 0.075
      const wax = new THREE.MeshStandardMaterial({ color: colors[i].clone().offsetHSL(0, 0.08, -0.04), roughness: 0.45 })
      const candle = new THREE.Group()
      candle.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 96, radius, 12, false), wax))
      for (const t of [0, 1]) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), wax)
        cap.position.copy(curve.getPoint(t))
        candle.add(cap)
      }
      const wickMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 6), new THREE.MeshBasicMaterial({ color: 0x3a2d2a }))
      wickMesh.position.set(wick[0], wick[1] + radius + 0.03, 0)
      candle.add(wickMesh)
      candle.scale.setScalar(scale)
      candle.position.x = (i === 0 ? -0.34 : 0.34) * scale
      this.group.add(candle)

      const uniforms = {
        uTime: { value: 0 },
        uLife: { value: 0 },
        uWind: { value: 0 },
        uSeed: { value: i * 3.7 },
        uSize: { value: new THREE.Vector2(0.16, 0.34) },
      }
      const flame = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms,
          vertexShader: flameVertex,
          fragmentShader: flameFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      )
      flame.position.set(wick[0], wick[1] + radius + 0.07, 0)
      flame.frustumCulled = false
      flame.renderOrder = 10
      candle.add(flame)

      const glowUniforms = { uLife: uniforms.uLife, uTime: uniforms.uTime, uSeed: uniforms.uSeed, uSize: { value: new THREE.Vector2(1.1, 1.1) } }
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms: glowUniforms,
          vertexShader: glowVertex,
          fragmentShader: glowFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      )
      glow.position.copy(flame.position).y += 0.1
      glow.frustumCulled = false
      glow.renderOrder = 9
      candle.add(glow)

      this.flames.push({ mesh: flame, uniforms, lit: false, life: 0 })
    })

    // Candles face the camera's diagonal.
    this.group.rotation.y = Math.PI / 4
    this.light = new THREE.PointLight(0xffb36b, 0, 7, 1.4)
    this.light.position.set(0, 1.3, 0)
    this.group.add(this.light)
    this.group.visible = false
  }

  placeOn(top, y) {
    const fit = Math.min(1, (Math.min(top.w, top.d) - 0.2) / 1.25)
    this.group.scale.setScalar(Math.max(0.75, fit))
    this.group.position.set(top.x, y, top.z)
  }

  appear() {
    this.group.visible = true
    let t = 0
    this.effects.push((dt) => {
      t += dt
      const k = Math.min(1, t / 0.7)
      const e = 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2 // back-out
      this.group.children.forEach((c) => c.isGroup && c.scale.setScalar(0.95 * Math.max(0.001, e)))
      return k < 1
    })
  }

  ignite() {
    this.flames.forEach((f, i) => setTimeout(() => (f.lit = true), 250 + i * 350))
  }

  get litCount() {
    return this.flames.filter((f) => f.lit).length
  }

  worldFlamePositions() {
    return this.flames.map((f) => f.mesh.getWorldPosition(new THREE.Vector3()))
  }

  extinguish(index) {
    const f = this.flames[index]
    if (!f || !f.lit) return false
    f.lit = false
    this.puff(f.mesh.getWorldPosition(new THREE.Vector3()))
    return true
  }

  puff(worldPos) {
    const parent = this.group.parent
    if (!parent) return
    const local = parent.worldToLocal(worldPos.clone())
    for (let i = 0; i < 9; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.smokeMap, color: 0xd9d4de, transparent: true, opacity: 0, depthWrite: false }),
      )
      sprite.position.copy(local)
      sprite.scale.setScalar(0.12)
      parent.add(sprite)
      const drift = new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.55 + Math.random() * 0.35, (Math.random() - 0.5) * 0.25)
      const delay = i * 0.07
      let t = -delay
      this.effects.push((dt) => {
        t += dt
        if (t < 0) return true
        sprite.position.addScaledVector(drift, dt)
        drift.x += Math.sin(t * 4 + i) * dt * 0.3
        sprite.scale.setScalar(0.12 + t * 0.55)
        sprite.material.opacity = Math.max(0, 0.5 * Math.sin(Math.min(1, t / 1.8) * Math.PI))
        if (t > 1.8) {
          parent.remove(sprite)
          sprite.material.dispose()
          return false
        }
        return true
      })
    }
  }

  reset() {
    this.flames.forEach((f) => {
      f.lit = false
      f.life = 0
      f.uniforms.uLife.value = 0
    })
    this.group.visible = false
    this.light.intensity = 0
  }

  update(dt, time) {
    let glow = 0
    for (const f of this.flames) {
      f.life += ((f.lit ? 1 : 0) - f.life) * Math.min(1, dt * (f.lit ? 5 : 14))
      f.uniforms.uLife.value = f.life
      f.uniforms.uTime.value = time
      f.uniforms.uWind.value = this.wind
      glow += f.life
    }
    this.light.intensity = glow * (2.2 + Math.sin(time * 11) * 0.25)
    this.effects = this.effects.filter((fx) => fx(dt))
  }
}
