// Zehn Kronen – Töne und Musik. Alles wird im Browser erzeugt (Web Audio), es sind keine Audiodateien nötig.
// Töne: kurze Klänge für Tippen, Bauen, Ausbilden, Marschieren, Kampf, Meldungen. Musik: ruhige, sich langsam ändernde Melodie;
// bei einem Kampf wechselt sie auf eine schnellere mit Trommeln.
const KEY = 'zk.sound';
export const cfg = { sfx: true, music: true, vs: .8, vm: .5 };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ohne Speicher geht es auch */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* egal */ } };

let ctx = null, master = null, sfxG = null, musG = null, noiseBuf = null, last = {}, mood = 'calm', timer = 0, nextT = 0, beat = 0;

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    ctx = new C(); master = ctx.createGain(); master.gain.value = .9;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    sfxG = ctx.createGain(); sfxG.connect(master); musG = ctx.createGain(); musG.connect(master);
    sfxG.gain.value = cfg.vs; musG.gain.value = cfg.vm * .45;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ein Ton: Form, Tonhöhe (optional gleitend), Lautstärke mit Anschlag und Ausklang
function tone(f, t, dur, o = {}) {
  const c = ctx, os = c.createOscillator(), g = c.createGain(), a = o.a == null ? .005 : o.a, v = (o.v == null ? .3 : o.v);
  os.type = o.type || 'sine'; os.frequency.setValueAtTime(f, t); if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  if (o.det) os.detune.value = o.det;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out = os; if (o.lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; os.connect(fl); out = fl; }
  out.connect(g); g.connect(o.dest || sfxG); os.start(t); os.stop(t + dur + .05);
}
function noise(t, dur, o = {}) {
  const c = ctx, s = c.createBufferSource(), g = c.createGain(), fl = c.createBiquadFilter(), v = o.v == null ? .3 : o.v;
  s.buffer = noiseBuf; s.loop = true; fl.type = o.type || 'bandpass'; fl.frequency.setValueAtTime(o.f || 1500, t); if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t + dur); fl.Q.value = o.q || 1;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + (o.a || .003)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(o.dest || sfxG); s.start(t, Math.random() * .5); s.stop(t + dur + .05);
}
const N = n => 440 * Math.pow(2, (n - 69) / 12);   // Midi-Nummer → Hz

const SFX = {
  tap: t => tone(740, t, .05, { type: 'triangle', v: .12, to: 560 }),
  ok: t => { tone(523, t, .12, { type: 'triangle', v: .16 }); tone(784, t + .07, .18, { type: 'triangle', v: .16 }); },
  err: t => { tone(150, t, .16, { type: 'square', v: .12, lp: 600, to: 110 }); tone(120, t + .09, .18, { type: 'square', v: .1, lp: 500 }); },
  build: t => { for (let i = 0; i < 3; i++) { noise(t + i * .13, .06, { f: 2400, q: 2, v: .22 }); tone(180, t + i * .13, .09, { type: 'triangle', v: .25, to: 90 }); } },
  train: t => { tone(110, t, .18, { v: .4, to: 60 }); tone(110, t + .2, .18, { v: .35, to: 60 }); noise(t + .4, .12, { type: 'highpass', f: 3000, v: .12 }); },
  research: t => { [76, 83, 88, 95].forEach((n, i) => tone(N(n), t + i * .09, .5, { type: 'sine', v: .12 })); },
  done: t => { [60, 64, 67, 72].forEach((n, i) => { tone(N(n), t + i * .1, .35, { type: 'triangle', v: .17 }); tone(N(n + 12), t + i * .1, .3, { type: 'sine', v: .05 }); }); },
  coin: t => { tone(N(88), t, .25, { type: 'triangle', v: .14 }); tone(N(95), t + .07, .35, { type: 'triangle', v: .14 }); },
  march: t => { tone(N(55), t, .55, { type: 'sawtooth', v: .12, lp: 700, a: .06 }); tone(N(62), t + .22, .6, { type: 'sawtooth', v: .12, lp: 800, a: .06 }); noise(t, .3, { f: 300, v: .05 }); },
  war: t => { tone(N(50), t, .7, { type: 'sawtooth', v: .16, lp: 600, a: .05 }); tone(N(57), t + .25, .8, { type: 'sawtooth', v: .16, lp: 700, a: .05 }); tone(70, t, .25, { v: .45, to: 40 }); tone(70, t + .3, .25, { v: .4, to: 40 }); },
  home: t => { tone(N(67), t, .25, { type: 'triangle', v: .14 }); tone(N(60), t + .15, .4, { type: 'triangle', v: .14 }); },
  clash: t => { noise(t, .09, { f: 3500, q: 3, v: .2 }); tone(1900 + Math.random() * 700, t, .12, { type: 'square', v: .05, to: 1200 }); if (Math.random() < .4) { noise(t + .13, .07, { f: 2600, q: 2, v: .14 }); tone(220, t + .13, .1, { type: 'triangle', v: .18, to: 110 }); } },
  alert: t => { for (let i = 0; i < 3; i++) { tone(880, t + i * .28, .12, { type: 'square', v: .09, lp: 2500 }); tone(660, t + i * .28 + .13, .12, { type: 'square', v: .09, lp: 2500 }); } },
  bell: t => { tone(N(84), t, .9, { v: .14 }); tone(N(91), t, .7, { v: .06 }); tone(N(96), t, .5, { v: .03 }); },
  report: t => { tone(N(79), t, .4, { type: 'triangle', v: .13 }); tone(N(86), t + .12, .5, { type: 'triangle', v: .13 }); },
  pop: t => tone(600, t, .08, { type: 'sine', v: .16, to: 900 }),
  win: t => { [60, 64, 67, 72, 76, 79].forEach((n, i) => { tone(N(n), t + i * .12, .55, { type: 'sawtooth', v: .09, lp: 1800 }); tone(N(n - 12), t + i * .12, .55, { type: 'triangle', v: .12 }); }); noise(t + .7, .5, { type: 'highpass', f: 5000, v: .06 }); },
  lose: t => { [64, 62, 59, 55].forEach((n, i) => tone(N(n), t + i * .22, .6, { type: 'triangle', v: .15, lp: 900 })); },
  teleport: t => { tone(300, t, .6, { type: 'sine', v: .15, to: 1800 }); noise(t, .6, { f: 800, to: 5000, q: 2, v: .1 }); },
  open: t => tone(420, t, .07, { type: 'triangle', v: .09, to: 600 }),
  close: t => tone(560, t, .07, { type: 'triangle', v: .08, to: 380 }),
  gather: t => { noise(t, .12, { f: 700, q: 1, v: .12 }); tone(160, t, .1, { type: 'triangle', v: .15, to: 100 }); }
};

/* ---------- Musik: D-dorisch, Akkordfolge i – VII – IV – v, Hintergrundteppich, Bass und Zupfmelodie ---------- */
const SCALE = [0, 2, 3, 5, 7, 9, 10], PROG = [0, 6, 3, 4];
const deg = (d, oct = 0) => 50 + SCALE[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);   // 50 = D3
function bar(t, bi, bpm) {
  const b = 60 / bpm, root = PROG[bi % 4], ch = [root, root + 2, root + 4], fight = mood === 'battle', len = 4 * b;
  for (const d of ch) for (const det of [-6, 6]) tone(N(deg(d)), t, len + .8, { type: 'triangle', v: fight ? .05 : .045, a: 1.1, lp: 900, det, dest: musG });
  tone(N(deg(root, -1)), t, b * 1.8, { type: 'sine', v: .22, a: .02, dest: musG }); tone(N(deg(root, -1)), t + b * 2, b * 1.6, { type: 'sine', v: .18, a: .02, dest: musG });
  const pat = fight ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 2, 3, 5, 6];
  let prev = ch[1];
  for (const st of pat) {
    const tt = t + st * b / 2; if (Math.random() < (fight ? .2 : .3)) continue;
    const pool = [...ch, ch[0] + 7, ch[1] + 7, prev + 1, prev - 1]; let d = pool[Math.floor(Math.random() * pool.length)]; if (Math.abs(d - prev) > 4) d = prev + (d > prev ? 2 : -2); prev = d;
    tone(N(deg(d, 1)), tt, fight ? .35 : .9, { type: fight ? 'sawtooth' : 'triangle', v: fight ? .05 : .09, a: .01, lp: fight ? 1600 : 2400, dest: musG });
  }
  if (fight) for (let i = 0; i < 4; i++) {
    const tt = t + i * b; if (i % 2 === 0) tone(95, tt, .28, { v: .5, to: 45, dest: musG }); else noise(tt, .14, { f: 1800, q: .8, v: .16, dest: musG });
    noise(tt + b / 2, .05, { type: 'highpass', f: 6000, v: .05, dest: musG });
  }
}
function schedule() {
  if (!ctx || !cfg.music) return;
  const bpm = mood === 'battle' ? 104 : 66;
  while (nextT < ctx.currentTime + 1.2) { if (nextT < ctx.currentTime) nextT = ctx.currentTime + .05; bar(nextT, beat++, bpm); nextT += 4 * 60 / bpm; }
}
function musicOn() { if (!ac()) return; if (!timer) { nextT = ctx.currentTime + .2; timer = setInterval(schedule, 250); } schedule(); }
function musicOff() { clearInterval(timer); timer = 0; }

export const snd = {
  // Beim ersten Tippen darf der Browser Ton abspielen
  unlock() { if (!ac()) return; if (cfg.music && !timer) musicOn(); },
  sfx(name, vol = 1) {
    if (!cfg.sfx || !SFX[name] || !ac()) return;
    const now = ctx.currentTime; if (last[name] && now - last[name] < (name === 'tap' ? .04 : .09)) return; last[name] = now;
    try { sfxG.gain.value = cfg.vs * vol; SFX[name](now + .005); sfxG.gain.value = cfg.vs; } catch { /* ein Ton darf nie das Spiel stören */ }
  },
  mood(m) { if (m !== mood) { mood = m; if (ctx && timer) { nextT = Math.max(nextT, ctx.currentTime + .1); } } },
  setMusic(on) { cfg.music = !!on; save(); if (on) musicOn(); else musicOff(); },
  setSfx(on) { cfg.sfx = !!on; save(); if (on) { ac(); this.sfx('ok'); } },
  setVol(k, v) { cfg[k] = Math.max(0, Math.min(1, v)); save(); if (ctx) { sfxG.gain.value = cfg.vs; musG.gain.value = cfg.vm * .45; } },
  cfg
};
