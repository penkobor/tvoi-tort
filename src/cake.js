import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { SPONGES, CREAMS, GLAZES, DEFAULT_DESIGN } from './config.js'
import { rosetteGeometry } from './decor.js'

export const RADIUS = 1.35
const SPONGE_H = 0.34
const CREAM_H = 0.09
const TOP_H = 0.12
const GLAZE_H = 0.05
const MAX_DECOR = 200

const byId = (list, id) => list.find((x) => x.id === id) || list[0]

// Outline of the cake in the XY plane of a THREE.Shape; world Z = -shape Y.
function outline(kind, size) {
  const shape = new THREE.Shape()
  if (kind === 'round') {
    shape.absarc(0, 0, size, 0, Math.PI * 2, false)
  } else if (kind === 'square') {
    const s = size * 0.9
    const r = 0.32
    shape.moveTo(-s + r, -s)
    shape.lineTo(s - r, -s)
    shape.quadraticCurveTo(s, -s, s, -s + r)
    shape.lineTo(s, s - r)
    shape.quadraticCurveTo(s, s, s - r, s)
    shape.lineTo(-s + r, s)
    shape.quadraticCurveTo(-s, s, -s, s - r)
    shape.lineTo(-s, -s + r)
    shape.quadraticCurveTo(-s, -s, -s + r, -s)
  } else {
    // The classic parametric heart, scaled and centred on its bounding box.
    const k = (size * 1.14) / 16
    const pts = []
    for (let i = 0; i < 160; i++) {
      const t = (i / 160) * Math.PI * 2
      const x = 16 * Math.sin(t) ** 3
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
      pts.push(new THREE.Vector2(x * k, (y + 2.5) * k))
    }
    shape.setFromPoints(pts)
    shape.closePath()
  }
  return shape
}

function slab(kind, size, height, y, bevel) {
  const geometry = new THREE.ExtrudeGeometry(outline(kind, size - bevel), {
    depth: Math.max(0.001, height - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 72,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, y + bevel, 0)
  // Smooth normals across the extrusion seams so the sides read as soft cream.
  geometry.deleteAttribute('uv')
  const smooth = mergeVertices(geometry, 1e-4)
  smooth.computeVertexNormals()
  geometry.dispose()
  return smooth
}

// Evenly spaced points (and outward normals) along the outline, in world XZ.
function ring(kind, size, spacing) {
  const shape = outline(kind, size)
  const length = shape.getLength()
  const count = Math.max(8, Math.round(length / spacing))
  const pts = shape.getSpacedPoints(count).slice(0, count)
  return pts.map((p, i) => {
    const a = pts[(i - 1 + count) % count]
    const b = pts[(i + 1) % count]
    const tangent = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize()
    // Shape is counter-clockwise, so the outward normal is (ty, -tx); flip Y into world Z.
    return { x: p.x, z: -p.y, nx: tangent.y, nz: tangent.x }
  })
}

export class CakeBuilder {
  constructor() {
    this.group = new THREE.Group()
    this.body = new THREE.Group()
    this.decor = new THREE.Group()
    this.group.add(this.body, this.decor)

    this.spongeMat = new THREE.MeshStandardMaterial({ roughness: 0.88 })
    this.creamMat = new THREE.MeshStandardMaterial({ roughness: 0.62 })
    this.pipingMat = new THREE.MeshStandardMaterial({ roughness: 0.55 })
    this.glazeMat = new THREE.MeshStandardMaterial({ roughness: 0.22 })

    this.design = { ...DEFAULT_DESIGN }
    this.history = []
    this.effects = []
    this.buildStand()
    this.rebuild()
    this.recolor()
  }

  buildStand() {
    const porcelain = new THREE.MeshStandardMaterial({ color: 0xfbfaf8, roughness: 0.32 })
    const stand = new THREE.Group()
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 1.95, 0.12, 80), porcelain)
    plate.position.y = -0.06
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.03, 0.045, 12, 100), porcelain)
    rim.rotation.x = Math.PI / 2
    rim.position.y = -0.005
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 0.85, 48), porcelain)
    stem.position.y = -0.55
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.08, 0.12, 64), porcelain)
    foot.position.y = -1.02
    stand.add(plate, rim, stem, foot)
    this.group.add(stand)
    this.stand = stand

    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const g = canvas.getContext('2d')
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(90,60,90,0.26)')
    grad.addColorStop(1, 'rgba(90,60,90,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = -1.09
    this.group.add(shadow)
  }

  get topY() {
    return SPONGE_H * 3 + CREAM_H * 2 + TOP_H + (this.design.glaze !== 'none' ? GLAZE_H - 0.02 : 0)
  }

  get topSize() {
    return this.design.shape === 'heart' ? RADIUS * 1.2 : RADIUS * 1.6
  }

  setDesign(patch) {
    const prev = this.design
    this.design = { ...prev, ...patch }
    if (patch.shape && patch.shape !== prev.shape) {
      this.clearDecor()
      this.rebuild()
    } else if ((patch.glaze && patch.glaze !== prev.glaze) || (patch.border && patch.border !== prev.border)) {
      this.rebuild()
    }
    this.recolor()
    this.bounce()
  }

  recolor() {
    const cream = new THREE.Color(byId(CREAMS, this.design.cream).color)
    this.spongeMat.color.set(byId(SPONGES, this.design.sponge).color)
    this.creamMat.color.copy(cream)
    this.pipingMat.color.copy(cream).lerp(new THREE.Color('#ffffff'), 0.25)
    const glaze = byId(GLAZES, this.design.glaze).color
    if (glaze) this.glazeMat.color.set(glaze)
  }

  rebuild() {
    for (const child of [...this.body.children]) {
      this.body.remove(child)
      if (!child.geometry.userData.shared) child.geometry.dispose()
    }
    const kind = this.design.shape
    const add = (geometry, material) => {
      const mesh = new THREE.Mesh(geometry, material)
      this.body.add(mesh)
      return mesh
    }

    let y = 0
    for (let i = 0; i < 3; i++) {
      add(slab(kind, RADIUS, SPONGE_H, y, 0.05), this.spongeMat)
      y += SPONGE_H
      if (i < 2) {
        add(slab(kind, RADIUS + 0.015, CREAM_H, y, 0.035), this.creamMat)
        y += CREAM_H
      }
    }
    add(slab(kind, RADIUS + 0.03, TOP_H, y, 0.05), this.creamMat)
    y += TOP_H

    if (this.design.glaze !== 'none') {
      add(slab(kind, RADIUS + 0.05, GLAZE_H, y - 0.02, 0.022), this.glazeMat)
      // Drips hang from the rim with random lengths, like poured ganache.
      for (const p of ring(kind, RADIUS + 0.035, 0.17)) {
        if (Math.random() < 0.18) continue
        const len = 0.1 + Math.random() ** 1.6 * 0.42
        const drip = add(new THREE.CapsuleGeometry(0.042, len, 4, 10), this.glazeMat)
        drip.position.set(p.x, y + 0.01 - len / 2, p.z)
      }
    }

    const border = this.design.border
    if (border !== 'none') {
      const rosette = rosetteGeometry()
      const topY = this.topY
      for (const p of ring(kind, RADIUS - 0.13, 0.19)) {
        const m = add(rosette, this.pipingMat)
        m.position.set(p.x, topY - 0.01, p.z)
        m.rotation.y = Math.random() * Math.PI
        m.scale.set(1, 0.78, 1)
      }
      if (border === 'both') {
        for (const p of ring(kind, RADIUS + 0.07, 0.2)) {
          const m = add(rosette, this.pipingMat)
          m.position.set(p.x, 0, p.z)
          m.rotation.y = Math.random() * Math.PI
          m.scale.setScalar(1.05)
        }
      }
    }
  }

  bounce() {
    let t = 0
    this.effects.push((dt) => {
      t += dt
      const k = Math.min(1, t / 0.45)
      const s = 1 + Math.sin(k * Math.PI) * 0.05 * (1 - k)
      this.body.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s))
      return k < 1
    })
  }

  // Meshes the finger can land on: the cake itself and the decor already on it.
  targets() {
    return [...this.body.children, ...this.decor.children]
  }

  bodyTargets() {
    return this.body.children
  }

  get decorCount() {
    return this.history.reduce((n, o) => n + (o.isInstancedMesh ? o.count : 1), 0)
  }

  addDecor(object, appear) {
    if (this.decorCount >= MAX_DECOR) return false
    this.decor.add(object)
    this.history.push(object)
    let t = 0
    this.effects.push((dt) => {
      t += dt
      const k = Math.min(1, t / 0.32)
      const e = Math.max(0.001, 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2)
      appear(e)
      return k < 1
    })
    return true
  }

  undo() {
    const last = this.history.pop()
    if (!last) return false
    this.decor.remove(last)
    return true
  }

  clearDecor() {
    for (const o of this.history) this.decor.remove(o)
    this.history = []
  }

  // Candles need a clear spot in the middle: anything there shrinks away.
  clearCenter(radius) {
    for (const o of [...this.history]) {
      if (o.isInstancedMesh) continue
      if (Math.hypot(o.position.x, o.position.z) < radius && o.position.y > this.topY - 0.2) {
        const start = o.scale.x
        let t = 0
        this.effects.push((dt) => {
          t += dt
          const k = Math.min(1, t / 0.3)
          o.scale.setScalar(Math.max(0.001, start * (1 - k)))
          if (k >= 1) this.decor.remove(o)
          return k < 1
        })
      }
    }
  }

  update(dt) {
    this.effects = this.effects.filter((fx) => fx(dt))
  }
}
