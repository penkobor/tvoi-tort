// Music (own mp3 or the YouTube player) and small synthesized effects.

export class AudioManager {
  constructor(cfg) {
    this.cfg = cfg;
    this.ctx = null;
    this.muted = false;
    this.mode = 'none';
    this.ytReady = false;
    this.ytState = -1;
    this.wantMusic = false;
  }

  async init() {
    for (const file of this.cfg.files || []) {
      try {
        const r = await fetch(file, { method: 'HEAD', cache: 'no-store' });
        const type = r.headers.get('content-type') || '';
        if (r.ok && !type.includes('html')) {
          this.mode = 'file';
          this.el = new Audio(file);
          this.el.loop = true;
          this.el.preload = 'auto';
          this.el.setAttribute('playsinline', '');
          const start = this.cfg.start || 0;
          if (start) this.el.addEventListener('loadedmetadata', () => { if (this.el.currentTime < start) this.el.currentTime = start; }, { once: true });
          return;
        }
      } catch {}
    }
    if (this.cfg.youtubeId) {
      this.mode = 'youtube';
      this.loadYouTube();
    }
  }

  loadYouTube() {
    window.onYouTubeIframeAPIReady = () => {
      this.player = new window.YT.Player('yt-player', {
        width: 240,
        height: 135,
        videoId: this.cfg.youtubeId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1, start: this.cfg.start || 0 },
        events: {
          onReady: () => {
            this.ytReady = true;
            document.body.classList.add('yt-ready');
          },
          onStateChange: (e) => {
            this.ytState = e.data;
            document.body.classList.toggle('music-playing', e.data === 1);
          },
          onError: () => document.body.classList.add('yt-error'),
        },
      });
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => document.body.classList.add('yt-error');
    document.head.appendChild(s);
  }

  // Must run inside a user gesture (iOS).
  unlock() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {}
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      // Soft echo for the chimes.
      this.delay = this.ctx.createDelay(1);
      this.delay.delayTime.value = 0.23;
      this.fb = this.ctx.createGain();
      this.fb.gain.value = 0.28;
      this.delay.connect(this.fb).connect(this.delay);
      this.delay.connect(this.master);
      this.master.connect(this.ctx.destination);
      const b = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.connect(this.ctx.destination);
      src.start(0);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  startMusic() {
    if (this.wantMusic && this.isMusicPlaying()) return;
    this.wantMusic = true;
    if (this.mode === 'file') {
      this.el.muted = this.muted;
      this.el.play().catch(() => document.body.classList.add('music-blocked'));
    } else if (this.mode === 'youtube' && this.player && this.ytReady) {
      try {
        this.player.unMute();
        this.player.setVolume(90);
        this.player.playVideo();
      } catch {}
    }
  }

  isMusicPlaying() {
    if (this.mode === 'file') return !this.el.paused;
    if (this.mode === 'youtube') return this.ytState === 1;
    return false;
  }

  pauseMusic() {
    if (this.mode === 'file') this.el.pause();
    else if (this.player && this.ytReady) try { this.player.pauseVideo(); } catch {}
  }

  resumeMusic() {
    if (this.wantMusic) this.startMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
    if (this.mode === 'file') this.el.muted = m;
    else if (this.player && this.ytReady) try { m ? this.player.mute() : this.player.unMute(); } catch {}
  }

  // ---- effects ----

  tone(freq, t0, dur, { type = 'sine', gain = 0.2, echo = true, slide = 0 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    if (echo) g.connect(this.delay);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noiseBurst(t0, dur, { f0 = 800, f1 = 3000, q = 1, gain = 0.25, type = 'bandpass' } = {}) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.08, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0, Math.random());
    s.stop(t0 + dur + 0.05);
  }

  ok() {
    return this.ctx && this.ctx.state === 'running';
  }

  chime() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    [880, 1108.7, 1318.5, 1760, 2217.5].forEach((f, i) => {
      this.tone(f, t + i * 0.06, 1.1, { gain: 0.12 });
      this.tone(f * 2, t + i * 0.06, 0.5, { type: 'triangle', gain: 0.03 });
    });
  }

  sparkle() {
    if (!this.ok()) return;
    const scale = [1568, 1760, 2093, 2349.3, 2637];
    const f = scale[Math.floor(Math.random() * scale.length)];
    this.tone(f, this.ctx.currentTime, 0.28, { gain: 0.05 });
  }

  jump() {
    if (!this.ok()) return;
    this.noiseBurst(this.ctx.currentTime, 0.35, { f0: 400, f1: 1800, gain: 0.08 });
  }

  thud() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.tone(140, t, 0.3, { gain: 0.3, slide: 0.35, echo: false });
    this.noiseBurst(t, 0.2, { f0: 300, f1: 120, type: 'lowpass', gain: 0.2 });
  }

  whoosh(dur = 1.2) {
    if (!this.ok()) return;
    this.noiseBurst(this.ctx.currentTime, dur, { f0: 300, f1: 2400, q: 0.7, gain: 0.18 });
  }

  blowSound() {
    if (!this.ok()) return;
    this.noiseBurst(this.ctx.currentTime, 0.5, { f0: 1200, f1: 500, q: 0.5, gain: 0.16 });
  }

  boom() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime + 0.05;
    this.noiseBurst(t, 1.3, { f0: 500, f1: 60, type: 'lowpass', gain: 0.22 });
    for (let i = 0; i < 6; i++) this.noiseBurst(t + 0.25 + Math.random() * 0.6, 0.05, { f0: 4000, f1: 6000, gain: 0.03 });
  }

  fanfare() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, t + i * 0.11, 1.4, { type: 'triangle', gain: 0.1 }));
  }
}
