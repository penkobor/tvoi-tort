import * as THREE from 'three'
import { layerColor } from './palette.js'

const COUNT = 260

export class Confetti {
  constructor(total) {
    const geometry = new THREE.PlaneGeometry(0.11, 0.06)
    const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })
    this.mesh = new THREE.InstancedMesh(geometry, material, COUNT)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    this.parts = Array.from({ length: COUNT }, (_, i) => {
      const color = layerColor(Math.floor(Math.random() * total), total)
      // Deepen a few pieces so the burst does not read as flat pastel.
      if (i % 4 === 0) color.offsetHSL(0, 0.25, -0.12)
      this.mesh.setColorAt(i, color)
      return {
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        alive: false,
        t: 0,
      }
    })
    this.m = new THREE.Matrix4()
    this.q = new THREE.Quaternion()
    this.s = new THREE.Vector3(1, 1, 1)
  }

  burst(origin, spread = 1) {
    this.mesh.visible = true
    this.parts.forEach((p, i) => {
      const angle = Math.random() * Math.PI * 2
      const speed = (3 + Math.random() * 5) * spread
      p.pos.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.4, (Math.random() - 0.5) * 0.6))
      p.vel.set(Math.cos(angle) * speed * 0.55, 5 + Math.random() * 6, Math.sin(angle) * speed * 0.55)
      p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
      p.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14)
      p.t = -Math.random() * 0.15 - (i % 3) * 0.05
      p.alive = true
    })
  }

  update(dt) {
    if (!this.mesh.visible) return
    let any = false
    this.parts.forEach((p, i) => {
      if (p.alive) {
        p.t += dt
        if (p.t > 0) {
          p.vel.y -= 7.5 * dt
          // Paper drag: fast pieces slow down and then flutter down.
          p.vel.multiplyScalar(1 - Math.min(0.9, dt * 1.6))
          p.vel.y = Math.max(p.vel.y, -1.6)
          p.pos.addScaledVector(p.vel, dt)
          p.pos.x += Math.sin(p.t * 5 + i) * dt * 0.4
          p.rot.x += p.spin.x * dt
          p.rot.y += p.spin.y * dt
          p.rot.z += p.spin.z * dt
          if (p.t > 7) p.alive = false
        }
        any = any || p.alive
      }
      this.q.setFromEuler(p.rot)
      this.s.setScalar(p.alive && p.t > 0 ? 1 : 0)
      this.m.compose(p.pos, this.q, this.s)
      this.mesh.setMatrixAt(i, this.m)
    })
    this.mesh.instanceMatrix.needsUpdate = true
    if (!any) this.mesh.visible = false
  }

  reset() {
    this.parts.forEach((p) => (p.alive = false))
    this.mesh.visible = false
  }
}
