const $ = (s) => document.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class UI {
  constructor(config) {
    this.cfg = config;
    this.toastQueue = [];
    this.toastBusy = false;
    this.buildSlots();
    this.confetti = new Confetti($('#confetti'));
    $('#music-title').textContent = config.music.title;
  }

  setLoading(p) {
    $('#loader-bar').style.transform = `scaleX(${Math.max(0.04, p)})`;
  }

  hideLoader() {
    $('#loader').classList.add('gone');
  }

  showTitle() {
    document.body.classList.add('state-title');
  }

  hideTitle() {
    document.body.classList.remove('state-title');
    document.body.classList.add('state-run');
  }

  buildSlots() {
    const box = $('#wish-slots');
    box.innerHTML = '';
    this.slots = this.cfg.wishes.map((w) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.style.setProperty('--c', w.color);
      el.innerHTML = `<span>${w.emoji}</span>`;
      box.appendChild(el);
      return el;
    });
  }

  showHUD(on = true) {
    $('#hud').classList.toggle('show', on);
  }

  setSparkles(n) {
    const el = $('#sparkle-count');
    el.querySelector('b').textContent = n;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  // Emoji flies from the 3D position to its HUD slot.
  flyToSlot(i, x, y) {
    const slot = this.slots[i];
    const r = slot.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'flyer';
    f.textContent = this.cfg.wishes[i].emoji;
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
    document.body.appendChild(f);
    requestAnimationFrame(() => {
      f.style.transform = `translate(${r.left + r.width / 2 - x}px, ${r.top + r.height / 2 - y}px) scale(0.6)`;
      f.style.opacity = '0.2';
    });
    setTimeout(() => {
      f.remove();
      slot.classList.add('filled');
    }, 700);
    setTimeout(() => slot.classList.add('filled'), 900);
  }

  toast(wish, note) {
    this.toastQueue.push({ wish, note });
    if (!this.toastBusy) this.nextToast();
  }

  async nextToast() {
    const item = this.toastQueue.shift();
    if (!item) { this.toastBusy = false; return; }
    this.toastBusy = true;
    const el = $('#toast');
    el.style.setProperty('--c', item.wish.color);
    el.innerHTML = `<div class="t-emoji">${item.wish.emoji}</div><div><div class="t-title">${item.wish.title}</div><div class="t-text">${item.wish.text}</div>${item.note ? `<div class="t-note">${item.note}</div>` : ''}</div>`;
    el.classList.add('show');
    await wait(2600);
    el.classList.remove('show');
    await wait(450);
    this.nextToast();
  }

  hint(html, ms = 3000) {
    const el = $('#hint');
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(this.hintTimer);
    if (ms) this.hintTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  hideHint() {
    $('#hint').classList.remove('show');
  }

  async caption(text, ms = 2600) {
    const el = $('#caption');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.capTimer);
    this.capTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  letterbox(on) {
    document.body.classList.toggle('cinema', on);
  }

  cakeUI(on, micAvailable) {
    $('#cake-ui').classList.toggle('show', on);
    $('#mic-btn').style.display = micAvailable ? '' : 'none';
  }

  micLevel(v) {
    $('#mic-meter').style.transform = `scaleX(${v})`;
  }

  flash() {
    const el = $('#flash');
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  async showMessage() {
    const c = this.cfg;
    const box = $('#message');
    $('#msg-title').textContent = c.title;
    $('#msg-love').textContent = c.love;
    const body = $('#msg-body');
    const card = box.querySelector('.msg-card');
    body.innerHTML = '';
    box.classList.add('show');
    this.messageToken = Symbol();
    const token = this.messageToken;
    await wait(900);
    for (const para of c.letter) {
      const p = document.createElement('p');
      body.appendChild(p);
      for (const ch of para) {
        if (token !== this.messageToken) return;
        p.textContent += ch;
        card.scrollTop = card.scrollHeight;
        await wait(ch === ',' || ch === '—' ? 120 : ch === '.' ? 260 : 28);
      }
      await wait(240);
    }
    if (token !== this.messageToken) return;
    box.classList.add('love');
    setTimeout(() => card.scrollTo({ top: card.scrollHeight, behavior: 'smooth' }), 300);
    setTimeout(() => card.scrollTo({ top: card.scrollHeight, behavior: 'smooth' }), 1900);
  }

  hideMessage() {
    this.messageToken = null;
    $('#message').classList.remove('show', 'love');
  }
}

class Confetti {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.parts = [];
    this.running = false;
    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener('resize', resize);
  }

  burst(n = 160) {
    const cols = ['#ff5d8f', '#ffd166', '#c9a2ff', '#7be0ff', '#ffffff', '#ff9f43'];
    for (let i = 0; i < n; i++) {
      this.parts.push({
        x: Math.random() * innerWidth,
        y: -20 - Math.random() * innerHeight * 0.6,
        vx: (Math.random() - 0.5) * 60,
        vy: 60 + Math.random() * 120,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 8,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 10,
        c: cols[i % cols.length],
        ph: Math.random() * 10,
        heart: Math.random() < 0.15,
      });
    }
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      this.loop();
    }
  }

  loop() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.fallback);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const g = this.g;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of this.parts) {
      p.ph += dt * 3;
      p.x += (p.vx + Math.sin(p.ph) * 40) * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = p.c;
      if (p.heart) {
        g.font = '16px sans-serif';
        g.fillText('❤', -6, 6);
      } else {
        g.scale(1, Math.cos(p.ph * 1.7));
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      g.restore();
    }
    this.parts = this.parts.filter((p) => p.y < innerHeight + 30);
    if (this.parts.length) {
      this.raf = requestAnimationFrame(() => this.loop());
      this.fallback = setTimeout(() => this.loop(), 120);
    } else {
      this.running = false;
      g.clearRect(0, 0, innerWidth, innerHeight);
    }
  }
}
