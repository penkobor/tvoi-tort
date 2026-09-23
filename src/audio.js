// Every sound is synthesized, so the game ships without audio files.
// iOS only lets the context start inside a tap, so unlock() runs on the start button.

let ctx = null
let master = null
let muted = false

const PENTATONIC = [0, 2, 4, 7, 9]

function freq(semitonesFromA4) {
  return 440 * 2 ** (semitonesFromA4 / 12)
}

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.55
    master.connect(ctx.destination)
  }
  if (ctx.state !== 'running') ctx.resume()
  // A silent buffer played inside the gesture keeps older iOS versions unlocked.
  const buffer = ctx.createBuffer(1, 1, 22050)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(master)
  src.start(0)
}

export function context() {
  return ctx
}

export function setMuted(value) {
  muted = value
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.05)
}

export function isMuted() {
  return muted
}

// A music-box tone: sine fundamental plus a quickly fading bell overtone.
function bell(f, when, { dur = 1.2, gain = 0.22, bright = 0.35 } = {}) {
  if (!ctx) return
  const t = ctx.currentTime + when
  const out = ctx.createGain()
  out.gain.setValueAtTime(0.0001, t)
  out.gain.exponentialRampToValueAtTime(gain, t + 0.006)
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  out.connect(master)

  const partials = [
    [1, 1],
    [2.0, bright],
    [3.01, bright * 0.35],
  ]
  for (const [ratio, amp] of partials) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = f * ratio
    g.gain.setValueAtTime(amp, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur / ratio)
    osc.connect(g).connect(out)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }
}

function noise(when, { dur = 0.4, gain = 0.2, from = 1800, to = 400, q = 0.8 } = {}) {
  if (!ctx) return
  const t = ctx.currentTime + when
  const length = Math.ceil(ctx.sampleRate * dur)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = q
  filter.frequency.setValueAtTime(from, t)
  filter.frequency.exponentialRampToValueAtTime(to, t + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(g).connect(master)
  src.start(t)
}

// Placing decor walks up a pentatonic scale, so a busy minute sounds like a tune.
let step = 0
export function playPlace() {
  const octave = Math.floor(step / PENTATONIC.length) % 2
  const semis = 3 + PENTATONIC[step % PENTATONIC.length] + 12 * octave
  step = (step + 1) % (PENTATONIC.length * 2)
  bell(freq(semis), 0, { dur: 0.9, gain: 0.14, bright: 0.45 })
  noise(0, { dur: 0.08, gain: 0.05, from: 1400, to: 500, q: 1.4 })
}

export function playSprinkle() {
  ;[0, 1, 2, 3].forEach((i) => bell(freq(15 + PENTATONIC[(i * 2) % 5] + 12), i * 0.035, { dur: 0.5, gain: 0.05, bright: 0.8 }))
}

export function playTick() {
  bell(freq(19), 0, { dur: 0.25, gain: 0.05, bright: 0.2 })
}

export function playUndo() {
  bell(freq(-2), 0, { dur: 0.35, gain: 0.07, bright: 0.2 })
}

export function playBlowOut() {
  noise(0, { dur: 0.45, gain: 0.12, from: 1200, to: 250, q: 0.6 })
}

export function playSparkle() {
  ;[12, 16, 19, 24, 28].forEach((s, i) => bell(freq(s), i * 0.05, { dur: 1.4, gain: 0.08, bright: 0.8 }))
}

export function playPop() {
  noise(0, { dur: 0.25, gain: 0.25, from: 3000, to: 200, q: 0.5 })
}

// "Happy Birthday to You" (public domain), as a music box in C major, 3/4.
const MELODY = [
  ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 2],
  ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['D5', 1], ['C5', 2],
  ['G4', 0.75], ['G4', 0.25], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 2],
  ['F5', 0.75], ['F5', 0.25], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 3],
]

// One root note per bar; the bass waits out the one-beat pickup.
const BASS = [
  ['C3', 3], ['G2', 3], ['G2', 3], ['C3', 3], ['C3', 3], ['F2', 3], ['F2', 1], ['C3', 1.5], ['G2', 1.5], ['C3', 3],
]

const NOTE_INDEX = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }

function noteFreq(name) {
  const letter = name[0]
  const octave = Number(name.slice(1))
  return freq(NOTE_INDEX[letter] + (octave - 4) * 12)
}

export function playBirthdaySong() {
  if (!ctx) return 0
  const beat = 0.5
  let t = 0.1
  for (const [note, beats] of MELODY) {
    bell(noteFreq(note), t, { dur: Math.max(1.2, beats * beat * 1.6), gain: 0.2, bright: 0.4 })
    t += beats * beat
  }
  let tb = 0.1 + beat
  for (const [note, beats] of BASS) {
    bell(noteFreq(note), tb, { dur: beats * beat * 1.2, gain: 0.1, bright: 0.15 })
    tb += beats * beat
  }
  return t
}
