// Optional: blowing into the microphone. Every failure path returns null,
// and the game keeps the finger swipe as the way to put the candles out.
export async function startMic(ctx) {
  if (!ctx || !navigator.mediaDevices?.getUserMedia) return null
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  } catch {
    return null
  }
  if (ctx.state !== 'running') await ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const data = new Float32Array(analyser.fftSize)

  let baseline = 0.02
  const started = performance.now()

  return {
    // 0 = quiet, 1 = a proper blow. Calibrates to the room for the first half second.
    level() {
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / data.length)
      if (performance.now() - started < 500) {
        baseline = Math.max(baseline, rms)
        return 0
      }
      const threshold = Math.max(0.06, baseline * 3)
      return Math.max(0, Math.min(1, (rms - threshold) / (threshold * 2)))
    },
    stop() {
      source.disconnect()
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}
