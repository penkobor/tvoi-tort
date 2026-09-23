import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CakeBuilder } from './cake.js'
import { Candles } from './candles.js'
import { Confetti } from './confetti.js'
import { TOOLS, tool, makeItem, makeSpray, orientTo, renderThumbnails, DECOR_SCALE } from './decor.js'
import { startMic } from './mic.js'
import * as audio from './audio.js'
import { TEXT, LETTER, NAME, AGE, APP_TITLE, SHAPES, SPONGES, CREAMS, GLAZES, BORDERS } from './config.js'

const $ = (id) => document.getElementById(id)
const body = document.body
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- Texts ----------
document.title = APP_TITLE
$('start-eyebrow').textContent = NAME ? `${TEXT.startEyebrow}, ${NAME}` : TEXT.startEyebrow
$('start-title').textContent = TEXT.startTitle
$('start-lead').textContent = TEXT.startLead
$('start-button').textContent = TEXT.startButton
$('finale-title').textContent = NAME ? `${TEXT.finaleTitle.replace('!', '')}, ${NAME}!` : TEXT.finaleTitle
$('finale-lead').textContent = TEXT.finaleLead
$('letter-button').textContent = TEXT.letterButton
$('save-button').textContent = TEXT.saveButton
$('again-button').textContent = TEXT.againButton
$('mic-label').textContent = TEXT.micButton
$('back').textContent = TEXT.back
$('shape-note').textContent = TEXT.shapeHint
$('decor-note').textContent = TEXT.decorHint
$('saved-hint').textContent = TEXT.saveHint
$('letter-eyebrow').textContent = `${AGE} · ${new Date().getFullYear()}`
$('letter-title').textContent = LETTER.title
$('letter-intro').textContent = LETTER.intro
for (const line of LETTER.lines) {
  const li = document.createElement('li')
  li.textContent = line
  $('letter-list').append(li)
}
$('letter-signature').textContent = LETTER.signature

// ---------- Renderer & scene ----------
const canvas = $('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0x000000, 0)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NeutralToneMapping

const scene = new THREE.Scene()
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.8

const sun = new THREE.DirectionalLight(0xfff4ea, 1.7)
sun.position.set(-4, 9, 7)
scene.add(sun)
const hemi = new THREE.HemisphereLight(0xfff1f5, 0xc9b8d8, 0.45)
scene.add(hemi)

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)

const cake = new CakeBuilder()
scene.add(cake.group)
const candles = new Candles(12)
candles.group.rotation.y = 0
cake.group.add(candles.group)
const confetti = new Confetti(12)
scene.add(confetti.mesh)

// ---------- Camera rig ----------
// The cake is framed inside the free band of the screen (between the header and
// the sheet or the buttons), so UI never covers it.
const rig = { target: new THREE.Vector3(0, 0.3, 0), elev: 0.5, radius: 2.3, top: 60, bottom: 700 }
const goal = { target: new THREE.Vector3(0, 0.3, 0), elev: 0.5, radius: 2.3, top: 60, bottom: 700 }
let userElev = 0.52

function band() {
  const h = window.innerHeight
  // The header already includes the notch inset, so its bottom is a safe top edge.
  const header = document.querySelector('.hud').getBoundingClientRect().bottom + 8
  if (state === 'build') return [header, h - $('sheet').offsetHeight]
  if (state === 'finale') return [header + Math.min(h * 0.2, 150), h - 150]
  if (state === 'intro') return [header, h * 0.62]
  return [header, h - 110]
}

function frame() {
  const topY = cake.topY
  if (state === 'intro') {
    goal.target.set(0, 0.25, 0)
    goal.radius = 2.4
    goal.elev = 0.42
  } else if (state === 'build') {
    goal.target.set(0, 0.4, 0)
    goal.radius = 2.45
    goal.elev = userElev
  } else if (state === 'finale') {
    goal.target.set(0, 0.6, 0)
    goal.radius = 2.35
    goal.elev = 0.36
  } else {
    goal.target.set(0, topY + 0.3, 0)
    goal.radius = 1.6
    goal.elev = 0.3
  }
  ;[goal.top, goal.bottom] = band()
}

function applyCamera() {
  const w = window.innerWidth
  const h = window.innerHeight
  camera.aspect = w / h
  const bandH = Math.max(120, rig.bottom - rig.top)
  const cy = (rig.top + rig.bottom) / 2
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const fit = Math.min((tanV * bandH) / h, tanV * camera.aspect)
  const dist = rig.radius / fit
  camera.position.set(0, Math.sin(rig.elev), Math.cos(rig.elev)).multiplyScalar(dist).add(rig.target)
  camera.lookAt(rig.target)
  camera.setViewOffset(w, h, 0, h / 2 - cy, w, h)
  camera.updateProjectionMatrix()
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false)
  frame()
  applyCamera()
}
window.addEventListener('resize', resize)
window.visualViewport?.addEventListener('resize', resize)

// iOS pinch and double-tap zoom would fight the one-finger controls.
document.addEventListener('gesturestart', (e) => e.preventDefault())
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false })

// ---------- UI ----------
let state = 'intro'
let step = 0
let selectedTool = 'strawberry'
let mic = null
let lastTouch = -10
let clock = 0

function setStage(next) {
  state = next
  body.dataset.stage = next
  frame()
}

function setMood(mood) {
  body.dataset.mood = mood
}

function showHint(text) {
  $('hint').textContent = text || ''
  $('hint').classList.toggle('is-visible', Boolean(text))
}

TEXT.steps.forEach((label) => {
  const li = document.createElement('li')
  li.textContent = label
  $('steps').append(li)
})

const ICONS = {
  round: '<svg viewBox="0 0 36 36"><ellipse cx="18" cy="12" rx="12" ry="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 12v11c0 2.8 5.4 5 12 5s12-2.2 12-5V12" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  square: '<svg viewBox="0 0 36 36"><path d="M18 5l12 5-12 5-12-5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6 10v12l12 5 12-5V10M18 15v12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  heart: '<svg viewBox="0 0 36 36"><path d="M18 29s-11-6.6-11-14.2A5.8 5.8 0 0 1 18 11a5.8 5.8 0 0 1 11 3.8C29 22.4 18 29 18 29z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
}

function radio(container, items, current, onPick, render) {
  container.innerHTML = ''
  items.forEach((item) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-label', item.label)
    b.setAttribute('aria-checked', String(item.id === current()))
    render(b, item)
    b.addEventListener('click', () => {
      onPick(item)
      container.querySelectorAll('[role=radio]').forEach((x) => x.setAttribute('aria-checked', String(x === b)))
      audio.playTick()
    })
    container.append(b)
  })
}

radio($('shape-chips'), SHAPES, () => cake.design.shape, (s) => cake.setDesign({ shape: s.id }), (b, s) => {
  b.className = 'chip'
  b.innerHTML = `${ICONS[s.id]}<span>${s.label}</span>`
})

function swatchRow(key, list, container) {
  const value = $(`${key}-value`)
  const show = () => (value.textContent = list.find((x) => x.id === cake.design[key]).label)
  radio(container, list, () => cake.design[key], (item) => {
    cake.setDesign({ [key]: item.id })
    show()
  }, (b, item) => {
    b.className = item.color ? 'swatch' : 'swatch swatch-none'
    if (item.color) b.style.setProperty('--c', item.color)
  })
  show()
}
swatchRow('sponge', SPONGES, $('sponge-swatches'))
swatchRow('cream', CREAMS, $('cream-swatches'))
swatchRow('glaze', GLAZES, $('glaze-swatches'))
radio($('border-chips'), BORDERS, () => cake.design.border, (item) => cake.setDesign({ border: item.id }), (b, item) => {
  b.className = 'chip'
  b.textContent = item.label.replace('Без бордюра', 'Без')
})

const thumbs = renderThumbnails()
radio($('tray'), TOOLS, () => selectedTool, (t) => (selectedTool = t.id), (b, t) => {
  b.className = 'tool'
  b.innerHTML = `<img src="${thumbs[t.id]}" alt=""><span>${t.label}</span>`
})

function updateUndo() {
  const empty = cake.history.length === 0
  $('undo').disabled = empty
  $('clear').disabled = empty
}

function goStep(n) {
  step = n
  $('sheet').dataset.step = String(n)
  ;[...$('steps').children].forEach((li, i) => {
    li.classList.toggle('is-active', i === n)
    li.classList.toggle('is-done', i < n)
  })
  $('back').hidden = n === 0
  $('next').textContent = n === 2 ? TEXT.done : TEXT.next
  updateUndo()
  // Layout of the sheet changes with the step, so re-fit the cake after it settles.
  requestAnimationFrame(frame)
}

$('next').addEventListener('click', () => {
  audio.playTick()
  if (step < 2) goStep(step + 1)
  else lightCandles()
})
$('back').addEventListener('click', () => {
  audio.playTick()
  if (step > 0) goStep(step - 1)
})
$('undo').addEventListener('click', () => {
  if (cake.undo()) audio.playUndo()
  updateUndo()
})
$('clear').addEventListener('click', () => {
  cake.clearDecor()
  audio.playUndo()
  updateUndo()
})

// ---------- Sound toggle ----------
body.dataset.muted = 'false'
$('sound').addEventListener('click', () => {
  const muted = !audio.isMuted()
  audio.setMuted(muted)
  body.dataset.muted = String(muted)
  $('sound').setAttribute('aria-label', muted ? 'Включить звук' : 'Выключить звук')
})

// ---------- Flow ----------
setStage('intro')
setMood('day')
resize()

$('start-button').addEventListener('click', async () => {
  audio.unlock()
  $('start').classList.add('is-leaving')
  await wait(450)
  $('start').hidden = true
  startBuilding()
})

function startBuilding() {
  candles.reset()
  confetti.reset()
  setMood('day')
  $('sheet').hidden = false
  $('sheet').classList.remove('is-leaving')
  setStage('build')
  goStep(0)
}

async function lightCandles() {
  $('sheet').classList.add('is-leaving')
  setStage('candles')
  await wait(450)
  $('sheet').hidden = true
  cake.clearCenter(0.75)
  candles.placeOn({ x: 0, z: 0, w: cake.topSize, d: cake.topSize }, cake.topY)
  await wait(500)
  candles.appear()
  await wait(900)
  setMood('night')
  await wait(900)
  candles.ignite()
  await wait(900)
  showHint(TEXT.wish)
  setStage('wish')
  await wait(2800)
  showHint(TEXT.blowHint)
  $('mic').hidden = false
  setStage('blow')
}

async function celebrate() {
  setStage('finale-wait')
  stopMic()
  showHint('')
  await wait(900)
  setMood('party')
  setStage('finale')
  await wait(400)
  audio.playPop()
  confetti.burst(new THREE.Vector3(0, cake.topY + 1.1, 0), 0.9)
  audio.playBirthdaySong()
  $('finale').hidden = false
  document.fonts?.load('600 90px "Cormorant Garamond"')
  document.fonts?.load('600 28px "Manrope"')
}

// ---------- Input ----------
const raycaster = new THREE.Raycaster()
const probe = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const UP = new THREE.Vector3(0, 1, 0)
const X = new THREE.Vector3(1, 0, 0)
let pointer = null
let spin = 0

canvas.addEventListener('pointerdown', (e) => {
  lastTouch = clock
  if (state === 'blow') blowAt(e.clientX, e.clientY)
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false }
  canvas.setPointerCapture?.(e.pointerId)
  spin = 0
})

canvas.addEventListener('pointermove', (e) => {
  if (state === 'blow' && (pointer || e.pointerType === 'touch')) blowAt(e.clientX, e.clientY)
  if (!pointer || pointer.id !== e.pointerId) return
  lastTouch = clock
  const dx = e.clientX - pointer.lx
  const dy = e.clientY - pointer.ly
  pointer.lx = e.clientX
  pointer.ly = e.clientY
  if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 9) pointer.moved = true
  if (!pointer.moved || !['intro', 'build', 'finale'].includes(state)) return
  spin = dx * 0.011
  cake.group.rotation.y += spin
  if (state === 'build') {
    userElev = THREE.MathUtils.clamp(userElev + dy * 0.004, 0.12, 1.15)
    goal.elev = userElev
  }
})

function endPointer(e) {
  if (!pointer || pointer.id !== e.pointerId) return
  const tap = !pointer.moved
  pointer = null
  if (tap && state === 'build' && step === 2) place(e.clientX, e.clientY)
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', (e) => {
  if (pointer && pointer.id === e.pointerId) pointer = null
})

function place(x, y) {
  const t = tool(selectedTool)
  if (!t) return
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  const hit = raycaster.intersectObjects(cake.targets(), true).find((h) => h.face && !h.object.isInstancedMesh)
  if (!hit) return
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
  if (normal.dot(raycaster.ray.direction) > 0) normal.negate()
  const toLocal = cake.decor.matrixWorld.clone().invert()

  let placed = false
  if (t.kind === 'item') {
    const obj = makeItem(t)
    obj.position.copy(cake.decor.worldToLocal(hit.point.clone()))
    orientTo(normal.clone().transformDirection(toLocal), t.upright, Math.random() * Math.PI * 2, obj.quaternion)
    const s = (0.9 + Math.random() * 0.2) * DECOR_SCALE
    placed = cake.addDecor(obj, (k) => obj.scale.setScalar(s * k))
    if (placed) audio.playPlace()
  } else {
    // Scatter pieces around the tap and drop each one onto the real surface.
    const t1 = new THREE.Vector3().crossVectors(normal, Math.abs(normal.y) < 0.9 ? UP : X).normalize()
    const t2 = new THREE.Vector3().crossVectors(normal, t1)
    const samples = []
    for (let i = 0; i < t.count; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * t.radius
      const origin = hit.point.clone().addScaledVector(normal, 0.4).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r)
      probe.set(origin, normal.clone().negate())
      const h = probe.intersectObjects(cake.bodyTargets(), false)[0]
      if (!h || !h.face) continue
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld).transformDirection(toLocal)
      samples.push({ point: cake.decor.worldToLocal(h.point.clone()), normal: n })
    }
    if (!samples.length) return
    const mesh = makeSpray(t, samples)
    placed = cake.addDecor(mesh, (k) => mesh.userData.appear(k))
    if (placed) audio.playSprinkle()
  }
  updateUndo()
}

const tmp = new THREE.Vector3()
function blowAt(x, y) {
  candles.worldFlamePositions().forEach((pos, i) => {
    tmp.copy(pos).project(camera)
    const sx = ((tmp.x + 1) / 2) * window.innerWidth
    const sy = ((1 - tmp.y) / 2) * window.innerHeight
    // Generous radius: a swipe anywhere near the flame counts.
    if (Math.hypot(sx - x, sy - y) < 80) extinguish(i)
  })
}

function extinguish(i) {
  if (candles.extinguish(i)) {
    audio.playBlowOut()
    if (candles.litCount === 0) celebrate()
  }
}

$('mic').addEventListener('click', async () => {
  if (mic || state !== 'blow') return
  audio.unlock()
  $('mic-label').textContent = '…'
  mic = await startMic(audio.context())
  if (!mic) {
    $('mic').hidden = true
    return
  }
  $('mic').classList.add('is-listening')
  $('mic-label').textContent = TEXT.micListening
})

function stopMic() {
  if (mic) mic.stop()
  mic = null
  $('mic').classList.remove('is-listening')
  $('mic').hidden = true
  $('mic-label').textContent = TEXT.micButton
}

// ---------- Finale actions ----------
function openOverlay(id) {
  $(id).hidden = false
}
document.querySelectorAll('.overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) overlay.hidden = true
  })
})
$('letter-button').addEventListener('click', () => openOverlay('letter'))
$('again-button').addEventListener('click', () => {
  $('finale').hidden = true
  cake.clearDecor()
  startBuilding()
})
$('save-button').addEventListener('click', savePicture)

// A 4:5 picture of the cake on the party background, made synchronously so the
// iOS share sheet still counts as a response to the tap.
function savePicture() {
  const W = 1080
  const H = 1350
  const ratio = renderer.getPixelRatio()
  // Face the numerals to the camera for the picture, then put the turntable back.
  const spinAngle = cake.group.rotation.y
  cake.group.rotation.y = 0
  renderer.setPixelRatio(1)
  renderer.setSize(W, H, false)
  camera.aspect = W / H
  camera.clearViewOffset()
  const dist = 2.25 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / 0.8
  camera.position.set(0, Math.sin(0.36), Math.cos(0.36)).multiplyScalar(dist).add(new THREE.Vector3(0, 0.35, 0))
  camera.lookAt(0, 0.35, 0)
  camera.setViewOffset(W, H, 0, H * 0.07, W, H)
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)

  const poster = document.createElement('canvas')
  poster.width = W
  poster.height = H
  const g = poster.getContext('2d')
  const bg = g.createRadialGradient(W / 2, H * 0.1, 0, W / 2, H * 0.1, H * 1.05)
  bg.addColorStop(0, '#fff3e6')
  bg.addColorStop(0.48, '#fcdbe6')
  bg.addColorStop(1, '#e2dcff')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
  g.drawImage(renderer.domElement, 0, 0, W, H)
  g.fillStyle = '#3b2a3d'
  g.textAlign = 'center'
  g.font = '500 96px "Cormorant Garamond", serif'
  g.fillText(TEXT.finaleTitle.replace('!', ''), W / 2, H - 150)
  g.fillStyle = 'rgba(59,42,61,0.6)'
  g.font = '600 26px "Manrope", sans-serif'
  g.fillText(`${AGE}  ·  ${new Date().toLocaleDateString('ru-RU')}`, W / 2, H - 96)

  cake.group.rotation.y = spinAngle
  renderer.setPixelRatio(ratio)
  resize()
  renderer.render(scene, camera)

  const dataUrl = poster.toDataURL('image/jpeg', 0.92)
  const bytes = atob(dataUrl.split(',')[1])
  const buffer = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i)
  const file = new File([buffer], 'tort.jpg', { type: 'image/jpeg' })
  const showImage = () => {
    $('saved-image').src = dataUrl
    openOverlay('saved')
  }
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file] }).catch((err) => err.name !== 'AbortError' && showImage())
  } else {
    showImage()
  }
}

// ---------- Loop ----------
let last = performance.now()

function tick(now = performance.now()) {
  const dt = Math.min((now - last) / 1000, 1 / 20)
  last = now
  clock += dt

  if (mic && state === 'blow') {
    const level = mic.level()
    candles.wind = THREE.MathUtils.lerp(candles.wind, level * 0.9, 0.2)
    if (level > 0.35 && Math.random() < level * dt * 3.5) {
      const lit = candles.flames.findIndex((f) => f.lit)
      if (lit >= 0) extinguish(lit)
    }
  } else {
    candles.wind *= 0.9
  }

  // Turntable: inertia after a swipe, a slow idle spin where it helps, and back
  // to the front when the candles need to face her.
  const r = cake.group.rotation
  if (!pointer) {
    r.y += spin
    spin *= Math.pow(0.04, dt)
  }
  const idle = clock - lastTouch > 2.5
  const autoSpin = state === 'intro' || state === 'finale' || (state === 'build' && step < 2)
  if (!pointer && idle && autoSpin) r.y += dt * 0.22
  if (['candles', 'wish', 'blow', 'finale-wait'].includes(state)) {
    const wrapped = THREE.MathUtils.euclideanModulo(r.y + Math.PI, Math.PI * 2) - Math.PI
    r.y = wrapped + (0 - wrapped) * Math.min(1, dt * 2.5)
  }

  cake.update(dt)
  candles.update(dt, clock)
  confetti.update(dt)

  const night = body.dataset.mood === 'night'
  const ease = Math.min(1, dt * 1.5)
  scene.environmentIntensity += ((night ? 0.1 : 0.8) - scene.environmentIntensity) * ease
  sun.intensity += ((night ? 0.1 : 1.7) - sun.intensity) * ease
  hemi.intensity += ((night ? 0.06 : 0.45) - hemi.intensity) * ease

  if (state === 'build') [goal.top, goal.bottom] = band()
  const k = Math.min(1, dt * 3)
  rig.target.lerp(goal.target, k)
  rig.elev += (goal.elev - rig.elev) * k
  rig.radius += (goal.radius - rig.radius) * k
  rig.top += (goal.top - rig.top) * k
  rig.bottom += (goal.bottom - rig.bottom) * k
  applyCamera()

  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

if (import.meta.env.DEV) {
  window.__cake = {
    cake,
    candles,
    get state() {
      return state
    },
    place,
    select: (id) => (selectedTool = id),
    blowAll: () => candles.flames.forEach((_, i) => extinguish(i)),
    goStep,
    lightCandles,
  }
}
