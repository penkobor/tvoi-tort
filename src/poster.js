import * as THREE from 'three'
import { AGE, TEXT, WISH } from './config.js'
import { wrap, HAND } from './wishes.js'

const W = 1080
const CAKE_H = 1080

// Draws the picture she can keep: her cake, the greeting and, if she wrote
// them, her wishes for the year. Synchronous on purpose (see savePicture).
export function renderPoster({ renderer, scene, camera, cake, wishes }) {
  const measure = document.createElement('canvas').getContext('2d')
  measure.font = `500 52px ${HAND}`
  const wishLines = wishes.map((w) => wrap(measure, w, W - 330))
  const listH = wishLines.reduce((h, lines) => h + lines.length * 62 + 16, 0)
  const cardTop = CAKE_H + 210
  const H = wishes.length ? cardTop + 150 + listH + 110 : CAKE_H + 290

  // Render the cake alone, facing front, into the canvas at poster size.
  const ratio = renderer.getPixelRatio()
  const spin = cake.group.rotation.y
  cake.group.rotation.y = 0
  renderer.setPixelRatio(1)
  renderer.setSize(W, CAKE_H, false)
  camera.aspect = 1
  camera.clearViewOffset()
  const dist = 2.35 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const target = new THREE.Vector3(0, 0.68, 0)
  camera.position.set(0, Math.sin(0.36), Math.cos(0.36)).multiplyScalar(dist).add(target)
  camera.lookAt(target)
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)

  const poster = document.createElement('canvas')
  poster.width = W
  poster.height = H
  const g = poster.getContext('2d')
  const bg = g.createRadialGradient(W / 2, H * 0.08, 0, W / 2, H * 0.08, H * 1.05)
  bg.addColorStop(0, '#fff3e6')
  bg.addColorStop(0.48, '#fcdbe6')
  bg.addColorStop(1, '#e2dcff')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
  g.drawImage(renderer.domElement, 0, 0, W, CAKE_H)

  cake.group.rotation.y = spin
  renderer.setPixelRatio(ratio)

  g.textAlign = 'center'
  g.fillStyle = '#3b2a3d'
  g.font = '500 96px "Cormorant Garamond", serif'
  g.fillText(TEXT.finaleTitle.replace('!', ''), W / 2, CAKE_H + 40)
  g.fillStyle = 'rgba(59, 42, 61, 0.6)'
  g.font = '600 26px "Manrope", sans-serif'
  g.fillText(`${AGE}  ·  ${new Date().toLocaleDateString('ru-RU')}`, W / 2, CAKE_H + 96)

  if (wishes.length) {
    const x = 90
    const w = W - 180
    const h = H - cardTop - 80
    g.save()
    g.shadowColor = 'rgba(92, 46, 84, 0.18)'
    g.shadowBlur = 50
    g.shadowOffsetY = 18
    g.fillStyle = 'rgba(255, 250, 246, 0.92)'
    g.beginPath()
    if (g.roundRect) g.roundRect(x, cardTop, w, h, 28)
    else g.rect(x, cardTop, w, h)
    g.fill()
    g.restore()

    g.fillStyle = 'rgba(59, 42, 61, 0.55)'
    g.font = '600 24px "Manrope", sans-serif'
    g.fillText(WISH.posterTitle.toUpperCase().split('').join(' '), W / 2, cardTop + 78)

    g.textAlign = 'left'
    let y = cardTop + 158
    wishLines.forEach((lines) => {
      g.fillStyle = '#b0487a'
      g.font = '500 30px "Manrope", sans-serif'
      g.fillText('✦', x + 62, y - 8)
      g.fillStyle = '#3b2a3d'
      g.font = `500 52px ${HAND}`
      lines.forEach((line) => {
        g.fillText(line, x + 112, y)
        y += 62
      })
      y += 16
    })
  }

  return poster.toDataURL('image/jpeg', 0.92)
}
