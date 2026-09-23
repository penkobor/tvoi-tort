import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

// Every decoration is modelled in code: tiny, shared geometry and materials,
// with the object's origin at the point where it touches the cake.

// Decor reads better a little larger than life on a phone screen.
export const DECOR_SCALE = 1.45

const mat = (color, roughness = 0.5, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra })

const M = {
  strawberry: mat('#e2445a', 0.32),
  seed: mat('#f3d27a', 0.4),
  leaf: mat('#5f9e4c', 0.6, { side: THREE.DoubleSide }),
  blueberry: mat('#4a5890', 0.7),
  crown: mat('#2b2f55', 0.8),
  raspberry: mat('#d6385f', 0.45),
  cherry: mat('#b0132d', 0.16),
  stem: mat('#6d8a3b', 0.6),
  filling: mat('#fff5ea', 0.6),
  petalWhite: mat('#fffaf6', 0.55),
  petalPink: mat('#f6bfcd', 0.55),
  petalLilac: mat('#d9ccf3', 0.55),
  flowerHeart: mat('#f2c24e', 0.5),
  meringue: mat('#fffaf4', 0.55),
  pearl: mat('#f2e2c2', 0.22, { metalness: 1 }),
  gold: mat('#e8c26a', 0.28, { metalness: 1 }),
  sprinkle: mat('#ffffff', 0.45),
}
const MACARONS = ['#f5b7c7', '#bfe2cf', '#cdc1ef', '#f5dea2', '#bcd7f1'].map((c) => mat(c, 0.6))
const SPRINKLE_COLORS = ['#f28aa6', '#ffd36e', '#8fd3b8', '#9bb8f2', '#c9a4ef', '#ffffff', '#ff9f7a'].map((c) => new THREE.Color(c))

function merge(parts) {
  const geometries = parts.map(({ geometry, matrix }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    if (matrix) g.applyMatrix4(matrix)
    g.deleteAttribute('uv')
    return g
  })
  return mergeGeometries(geometries)
}

const m4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  )

function starShape(points, outer, inner) {
  const shape = new THREE.Shape()
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return shape
}

// ---------- Geometries (built once) ----------
let rosette = null
// A piped cream swirl: a lathe with twisted ridges, used for the border and «Безе».
export function rosetteGeometry() {
  if (rosette) return rosette
  const profile = [
    [0, 0], [0.078, 0], [0.088, 0.02], [0.08, 0.05], [0.06, 0.09], [0.037, 0.13], [0.016, 0.165], [0.004, 0.19], [0, 0.2],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const g = new THREE.LatheGeometry(profile, 56)
  const pos = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const r = Math.hypot(v.x, v.z)
    const a = Math.atan2(v.z, v.x)
    const ridge = 1 + 0.13 * Math.cos(7 * (a + v.y * 10))
    pos.setXYZ(i, Math.cos(a) * r * ridge, v.y, Math.sin(a) * r * ridge)
  }
  g.computeVertexNormals()
  g.userData.shared = true
  rosette = g
  return g
}

const G = {}
function geometries() {
  if (G.ready) return G
  const berryProfile = [
    [0, 0], [0.05, 0.004], [0.085, 0.03], [0.098, 0.07], [0.09, 0.12], [0.065, 0.17], [0.03, 0.205], [0, 0.215],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  G.strawberry = new THREE.LatheGeometry(berryProfile, 22)
  // Seeds sit on the lathe surface at golden-angle spacing.
  const seedParts = []
  const seed = new THREE.SphereGeometry(0.0065, 5, 4)
  for (let i = 0; i < 26; i++) {
    const t = 0.12 + (i / 26) * 0.72
    const a = i * 2.39996
    const y = t * 0.215
    const r = sampleProfile(berryProfile, y) + 0.001
    seedParts.push({ geometry: seed, matrix: m4(Math.cos(a) * r, y, Math.sin(a) * r) })
  }
  G.seeds = merge(seedParts)
  const leafShape = starShape(6, 0.08, 0.03)
  const leaf = new THREE.ShapeGeometry(leafShape)
  leaf.rotateX(-Math.PI / 2)
  const pos = leaf.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, 0.012 - Math.hypot(x, z) * 0.18)
  }
  leaf.computeVertexNormals()
  G.leaf = leaf

  const blue = new THREE.SphereGeometry(0.052, 16, 12)
  const crown = new THREE.TorusGeometry(0.013, 0.005, 5, 10)
  const triangle = [0, 1, 2].map((i) => [Math.cos((i / 3) * Math.PI * 2) * 0.058, Math.sin((i / 3) * Math.PI * 2) * 0.058])
  G.blueberries = merge(triangle.map(([x, z]) => ({ geometry: blue, matrix: m4(x, 0.05, z) })))
  G.crowns = merge(triangle.map(([x, z]) => ({ geometry: crown, matrix: m4(x, 0.1, z, Math.PI / 2) })))

  const drupe = new THREE.SphereGeometry(0.027, 8, 6)
  const drupes = []
  for (let i = 0; i < 30; i++) {
    const y = 1 - (i / 29) * 1.7
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const a = i * 2.39996
    drupes.push({ geometry: drupe, matrix: m4(Math.cos(a) * r * 0.07, 0.085 + y * 0.075, Math.sin(a) * r * 0.07) })
  }
  G.raspberry = merge(drupes)

  G.cherry = new THREE.SphereGeometry(0.078, 20, 14)
  G.cherry.scale(1, 0.92, 1)
  G.cherry.translate(0, 0.072, 0)
  G.stem = new THREE.TubeGeometry(
    new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.13, 0), new THREE.Vector3(0, 0.26, 0), new THREE.Vector3(0.07, 0.31, 0)),
    12, 0.008, 5,
  )

  const shellProfile = [[0, 0], [0.074, 0], [0.086, 0.012], [0.082, 0.026], [0.056, 0.038], [0, 0.041]].map(([r, y]) => new THREE.Vector2(r, y))
  const shell = new THREE.LatheGeometry(shellProfile, 28)
  // Standing on its edge: the macaron's axis lies along X.
  G.macaronShells = merge([
    { geometry: shell, matrix: m4(0.016, 0.086, 0, 0, 0, -Math.PI / 2) },
    { geometry: shell, matrix: m4(-0.016, 0.086, 0, 0, 0, Math.PI / 2) },
  ])
  G.macaronFill = new THREE.CylinderGeometry(0.07, 0.07, 0.034, 24)
  G.macaronFill.rotateZ(Math.PI / 2)
  G.macaronFill.translate(0, 0.086, 0)

  const petal = new THREE.SphereGeometry(0.05, 14, 8)
  G.petals = merge(
    [0, 1, 2, 3, 4].map((i) => {
      const a = (i / 5) * Math.PI * 2
      return { geometry: petal, matrix: m4(Math.cos(a) * 0.05, 0.02, Math.sin(a) * 0.05, 0, -a, 0.25, 1, 0.3, 0.62) }
    }),
  )
  G.flowerHeart = new THREE.SphereGeometry(0.026, 12, 8)
  G.flowerHeart.scale(1, 0.6, 1)
  G.flowerHeart.translate(0, 0.035, 0)

  G.sprinkle = new THREE.CapsuleGeometry(0.012, 0.048, 3, 6)
  G.pearl = new THREE.SphereGeometry(0.022, 14, 10)
  const star = new THREE.ExtrudeGeometry(starShape(5, 0.05, 0.022), { depth: 0.01, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2 })
  star.rotateX(-Math.PI / 2)
  G.star = star
  G.ready = true
  return G
}

function sampleProfile(profile, y) {
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]
    const b = profile[i]
    if (y <= b.y) return a.x + ((b.x - a.x) * (y - a.y)) / Math.max(1e-6, b.y - a.y)
  }
  return 0
}

const pick = (list) => list[Math.floor(Math.random() * list.length)]

function group(...meshes) {
  const g = new THREE.Group()
  g.add(...meshes)
  return g
}

// ---------- Tools ----------
// kind 'item': one object at the tap. kind 'spray': a scatter of tiny pieces around it.
export const TOOLS = [
  {
    id: 'strawberry', label: 'Клубника', kind: 'item', upright: 0.6,
    build: () => group(new THREE.Mesh(G.strawberry, M.strawberry), new THREE.Mesh(G.seeds, M.seed), new THREE.Mesh(G.leaf, M.leaf)),
  },
  {
    id: 'raspberry', label: 'Малина', kind: 'item', upright: 0.6,
    build: () => group(new THREE.Mesh(G.raspberry, M.raspberry)),
  },
  {
    id: 'blueberry', label: 'Черника', kind: 'item', upright: 0.3,
    build: () => group(new THREE.Mesh(G.blueberries, M.blueberry), new THREE.Mesh(G.crowns, M.crown)),
  },
  {
    id: 'cherry', label: 'Вишенка', kind: 'item', upright: 0.8,
    build: () => group(new THREE.Mesh(G.cherry, M.cherry), new THREE.Mesh(G.stem, M.stem)),
  },
  {
    id: 'macaron', label: 'Макарон', kind: 'item', upright: 0.7,
    build: () => group(new THREE.Mesh(G.macaronShells, pick(MACARONS)), new THREE.Mesh(G.macaronFill, M.filling)),
  },
  {
    id: 'flower', label: 'Цветок', kind: 'item', upright: 0.2,
    build: () => group(new THREE.Mesh(G.petals, pick([M.petalWhite, M.petalPink, M.petalLilac])), new THREE.Mesh(G.flowerHeart, M.flowerHeart)),
  },
  {
    id: 'meringue', label: 'Безе', kind: 'item', upright: 0.7,
    build: () => group(new THREE.Mesh(rosetteGeometry(), M.meringue)),
  },
  { id: 'sprinkles', label: 'Посыпка', kind: 'spray', count: 16, radius: 0.24, lift: 0.012, lie: true, geometry: () => G.sprinkle, material: M.sprinkle, colors: true },
  { id: 'pearls', label: 'Жемчуг', kind: 'spray', count: 7, radius: 0.2, lift: 0.02, geometry: () => G.pearl, material: M.pearl },
  { id: 'stars', label: 'Звёзды', kind: 'spray', count: 4, radius: 0.22, lift: 0.008, geometry: () => G.star, material: M.gold },
]

export function tool(id) {
  return TOOLS.find((t) => t.id === id)
}

const UP = new THREE.Vector3(0, 1, 0)
const tmpQ = new THREE.Quaternion()

export function orientTo(normal, upright, spin, target = new THREE.Quaternion()) {
  const n = normal.clone().lerp(UP, upright).normalize()
  target.setFromUnitVectors(UP, n)
  tmpQ.setFromAxisAngle(UP, spin)
  return target.multiply(tmpQ)
}

export function makeItem(t) {
  geometries()
  return t.build()
}

// A scatter: `samples` are {point, normal} in the parent's local space.
export function makeSpray(t, samples) {
  geometries()
  const mesh = new THREE.InstancedMesh(t.geometry(), t.material, samples.length)
  mesh.frustumCulled = false
  const base = samples.map(({ point, normal }) => {
    const q = orientTo(normal, 0, Math.random() * Math.PI * 2)
    if (t.lie) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))
    const s = (0.75 + Math.random() * 0.5) * DECOR_SCALE
    return { p: point.clone().addScaledVector(normal, t.lift * s), q, s }
  })
  base.forEach((_, i) => t.colors && mesh.setColorAt(i, pick(SPRINKLE_COLORS)))
  const m = new THREE.Matrix4()
  const sv = new THREE.Vector3()
  mesh.userData.appear = (k) => {
    base.forEach(({ p, q, s }, i) => {
      mesh.setMatrixAt(i, m.compose(p, q, sv.setScalar(s * k)))
    })
    mesh.instanceMatrix.needsUpdate = true
  }
  mesh.userData.appear(0.001)
  return mesh
}

// Renders each tool once into a small picture for the tray.
export function renderThumbnails(size = 144) {
  geometries()
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(size, size, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.8
  const sun = new THREE.DirectionalLight(0xffffff, 1.8)
  sun.position.set(-2, 4, 3)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10)

  const pictures = {}
  for (const t of TOOLS) {
    let object
    if (t.kind === 'item') {
      object = t.build()
    } else {
      const samples = []
      const n = Math.min(t.count, 9)
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996
        const r = Math.sqrt(i / n) * t.radius * 0.55
        samples.push({ point: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), normal: UP.clone() })
      }
      object = makeSpray(t, samples)
      object.userData.appear(1)
      object.computeBoundingSphere()
    }
    scene.add(object)
    const box = new THREE.Box3().setFromObject(object)
    const center = box.getCenter(new THREE.Vector3())
    const radius = box.getSize(new THREE.Vector3()).length() / 2
    const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.05
    camera.position.copy(center).add(new THREE.Vector3(0.55, 0.62, 1).normalize().multiplyScalar(dist))
    camera.lookAt(center)
    renderer.render(scene, camera)
    pictures[t.id] = canvas.toDataURL('image/png')
    scene.remove(object)
  }
  pmrem.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
  return pictures
}
