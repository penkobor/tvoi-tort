import * as THREE from 'three'
import { WISH } from './config.js'

// The letter to next year: a sheet of paper with her wishes that burns from the
// bottom edge over the candle flames, its embers drifting up into the dark.

const PAPER_W = 1.5
const PAPER_H = 1.86
const TEX_W = 750
const TEX_H = 960

export const HAND = '"Caveat", "Marker Felt", cursive'

// Splits text into lines that fit `width` in the context's current font.
export function wrap(g, text, width) {
  const words = text.split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (g.measureText(next).width > width && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function paperTexture(wishes) {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_W
  canvas.height = TEX_H
  const g = canvas.getContext('2d')
  g.fillStyle = '#fbf5ec'
  g.fillRect(0, 0, TEX_W, TEX_H)
  // Faint paper grain.
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(120, 90, 70, ${Math.random() * 0.035})`
    g.fillRect(Math.random() * TEX_W, Math.random() * TEX_H, 2, 2)
  }
  g.fillStyle = 'rgba(59, 42, 61, 0.55)'
  g.font = '600 26px "Manrope", sans-serif'
  g.textAlign = 'center'
  g.fillText(WISH.paperLabel.toUpperCase().split('').join(' '), TEX_W / 2, 92)
  g.strokeStyle = 'rgba(176, 72, 122, 0.35)'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(TEX_W / 2 - 40, 124)
  g.lineTo(TEX_W / 2 + 40, 124)
  g.stroke()

  g.textAlign = 'left'
  g.font = `500 62px ${HAND}`
  g.fillStyle = '#3b2a3d'
  let y = 222
  const lineH = 70
  for (const wish of wishes) {
    const lines = wrap(g, wish, TEX_W - 180)
    g.fillStyle = '#b0487a'
    g.fillText('✦', 72, y - 4)
    g.fillStyle = '#3b2a3d'
    for (const line of lines) {
      if (y > TEX_H - 60) break
      g.fillText(line, 124, y)
      y += lineH
    }
    y += 18
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uBurn;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    // A gentle curl near the burning edge, as paper does over heat.
    p.z += sin(uv.x * 3.1416) * 0.04 + (1.0 - uv.y) * uBurn * 0.12 * sin(uTime * 3.0 + uv.x * 6.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float uBurn;
  uniform float uOpacity;
  uniform vec3 uTint;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
    return v;
  }
  void main() {
    vec4 paper = texture2D(map, vUv);
    // The fire starts at the bottom centre, over the flames, and eats upward.
    float d = vUv.y * 0.85 + abs(vUv.x - 0.5) * 0.35 + fbm(vUv * 5.0) * 0.35;
    float front = uBurn * 1.5 - 0.1;
    if (d < front - 0.03) discard;
    float charred = smoothstep(front + 0.14, front, d);
    float ember = smoothstep(front + 0.02, front - 0.03, d);
    vec3 col = paper.rgb * uTint;
    col = mix(col, vec3(0.13, 0.07, 0.04), charred * 0.85);
    col = mix(col, vec3(1.0, 0.52, 0.14) * 2.4, ember);
    gl_FragColor = vec4(col, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function sparkTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

const SPARKS = 220

export class WishLetter {
  constructor(scene) {
    this.scene = scene
    this.uniforms = {
      map: { value: null },
      uBurn: { value: 0 },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(1, 0.9, 0.78) },
    }
    this.paper = new THREE.Mesh(
      new THREE.PlaneGeometry(PAPER_W, PAPER_H, 24, 30),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    )
    this.paper.visible = false
    this.paper.renderOrder = 20
    scene.add(this.paper)

    // The burning edge lights the cake.
    this.light = new THREE.PointLight(0xff8a3d, 0, 5, 1.6)
    scene.add(this.light)

    const positions = new Float32Array(SPARKS * 3)
    const colors = new Float32Array(SPARKS * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.sparks = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.07,
        map: sparkTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    this.sparks.frustumCulled = false
    scene.add(this.sparks)
    this.pool = Array.from({ length: SPARKS }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1 }))
    this.cursor = 0
    this.state = 'idle'
    this.home = new THREE.Vector3()
    this.goal = new THREE.Vector3()
  }

  // Shows the paper in front of the candles, facing the camera.
  show(wishes, camera, flames) {
    this.uniforms.map.value?.dispose()
    this.uniforms.map.value = paperTexture(wishes)
    this.uniforms.uBurn.value = 0
    this.uniforms.uOpacity.value = 0
    this.flameCenter = flames.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / flames.length)
    const toCamera = camera.position.clone().sub(this.flameCenter).setY(0).normalize()
    this.home.copy(this.flameCenter).addScaledVector(toCamera, 0.35)
    this.home.y += PAPER_H / 2 + 0.25
    // Over the fire: the bottom edge just touches the flame tips.
    this.goal.copy(this.flameCenter).addScaledVector(toCamera, 0.12)
    this.goal.y += PAPER_H / 2 + 0.02
    this.paper.position.copy(this.home)
    this.paper.position.y += 0.3
    this.paper.quaternion.copy(camera.quaternion)
    this.paper.visible = true
    this.state = 'shown'
    this.t = 0
  }

  // Lowers the paper onto the flames and burns it; resolves when it is gone.
  burn() {
    this.state = 'lowering'
    this.t = 0
    return new Promise((resolve) => (this.done = resolve))
  }

  spark(u, v, strength = 1) {
    const s = this.pool[this.cursor]
    this.cursor = (this.cursor + 1) % SPARKS
    s.pos.set((u - 0.5) * PAPER_W, (v - 0.5) * PAPER_H, 0.02)
    this.paper.localToWorld(s.pos)
    s.vel.set((Math.random() - 0.5) * 0.35, 0.5 + Math.random() * 0.9 * strength, (Math.random() - 0.5) * 0.25)
    s.max = 1.2 + Math.random() * 1.8 * strength
    s.life = s.max
  }

  update(dt, time, camera) {
    this.uniforms.uTime.value = time
    const p = this.paper
    if (p.visible) p.quaternion.copy(camera.quaternion)
    if (this.state === 'shown') {
      this.t += dt
      this.uniforms.uOpacity.value = Math.min(1, this.t / 0.6)
      p.position.lerp(this.home, Math.min(1, dt * 3))
      p.position.y += Math.sin(time * 1.6) * 0.0015
      p.rotateZ(Math.sin(time * 1.1) * 0.03)
    } else if (this.state === 'lowering') {
      this.t += dt
      p.position.lerp(this.goal, Math.min(1, dt * 3.2))
      if (this.t > 0.9) {
        this.state = 'burning'
        this.t = 0
      }
    } else if (this.state === 'burning') {
      this.t += dt
      const burn = Math.min(1, this.t / 4.2)
      this.uniforms.uBurn.value = burn
      const front = burn * 1.5 - 0.1
      // Sparks leave along the burning front.
      const n = Math.random() < 0.5 ? 3 : 2
      for (let i = 0; i < n; i++) {
        const u = 0.05 + Math.random() * 0.9
        const v = THREE.MathUtils.clamp((front - Math.abs(u - 0.5) * 0.35 - 0.17) / 0.85, 0, 1)
        if (burn < 0.98) this.spark(u, v)
      }
      const edge = new THREE.Vector3(0, (THREE.MathUtils.clamp((front - 0.2) / 0.85, 0, 1) - 0.5) * PAPER_H, 0.1)
      this.light.position.copy(p.localToWorld(edge))
      this.light.intensity = burn < 0.95 ? 3.5 + Math.sin(time * 23) * 0.8 : Math.max(0, this.light.intensity - dt * 12)
      p.position.y += dt * 0.05
      if (burn >= 1) {
        // A last flurry that rises far: the letter leaves for next year.
        for (let i = 0; i < 40; i++) this.spark(0.2 + Math.random() * 0.6, 0.85 + Math.random() * 0.15, 1.8)
        p.visible = false
        this.light.intensity = 0
        this.state = 'idle'
        this.done?.()
      }
    }

    const pos = this.sparks.geometry.attributes.position
    const col = this.sparks.geometry.attributes.color
    for (let i = 0; i < SPARKS; i++) {
      const s = this.pool[i]
      if (s.life > 0) {
        s.life -= dt
        s.vel.y += dt * 0.25
        s.vel.x += Math.sin(time * 3 + i) * dt * 0.2
        s.pos.addScaledVector(s.vel, dt)
      }
      const k = Math.max(0, s.life / s.max)
      pos.setXYZ(i, s.pos.x, s.pos.y, s.pos.z)
      // Hot yellow at birth, cooling to red, then gone.
      col.setXYZ(i, k * 1.0, k * (0.35 + 0.5 * k), k * k * 0.25)
    }
    pos.needsUpdate = true
    col.needsUpdate = true
  }

  reset() {
    this.paper.visible = false
    this.state = 'idle'
    this.light.intensity = 0
    this.pool.forEach((s) => (s.life = 0))
  }
}
