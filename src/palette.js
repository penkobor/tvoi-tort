import { Color } from 'three'

// OKLCH → linear sRGB, so the hue sweep stays perceptually even.
function oklchToLinear(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (v) => Math.min(1, Math.max(0, v))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

// A soft pastel sweep around the hue wheel, used for candles and confetti.
const SWEEP = { lightness: 0.87, chroma: 0.075, hueStart: 355, hueSpan: 300 }

export function layerColor(index, total) {
  const { lightness, chroma, hueStart, hueSpan } = SWEEP
  const t = total > 1 ? index / (total - 1) : 0
  const [r, g, b] = oklchToLinear(lightness, chroma, hueStart + t * hueSpan)
  return new Color().setRGB(r, g, b)
}
