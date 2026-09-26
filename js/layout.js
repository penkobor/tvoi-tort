import { fbm, smoothstep } from './noise.js';

export const LANE_W = 2.1;
export const HERD_X = -10.5;
export const GAP_DIST = 950;
export const GAP_WIDTH = 46;
export const CAKE_AFTER_GAP = 44;
export const WISH_FIRST = 110;
export const WISH_STEP = 112;
export const APPROACH_AT = 800;

export const gap = { near: -1e7, far: -1e7 - GAP_WIDTH, center: -1e7 - GAP_WIDTH / 2, half: GAP_WIDTH / 2 };
export const cake = { x: 0, z: -1e7 };

export function setGap(near) {
  gap.near = near;
  gap.far = near - GAP_WIDTH;
  gap.center = near - GAP_WIDTH / 2;
  cake.z = gap.far - CAKE_AFTER_GAP;
}

export const inGap = (z, pad = 0) => z < gap.near + pad && z > gap.far - pad;

export function terrainHeight(x, z) {
  const ax = Math.abs(x);
  const side = smoothstep(6.5, 34, ax);
  if (side <= 0) return 0;
  let h = Math.pow(fbm(x * 0.016 + 11.3, z * 0.016 - 4.7, 4), 1.6) * 26 * side;
  h += smoothstep(70, 170, ax) * fbm(x * 0.005 - 3.1, z * 0.005 + 9.2, 3) * 34;
  const c = (x - HERD_X) / 7;
  h *= 1 - 0.85 * Math.exp(-c * c);
  h *= smoothstep(gap.half + 6, gap.half + 90, Math.abs(z - gap.center));
  return h;
}
