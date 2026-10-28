// Zehn Kronen – Töne und Musik. Alles wird im Browser erzeugt (Web Audio), es sind keine Audiodateien nötig.
// Klänge sind aus Rauschen und Obertönen aufgebaut (Metall, Holz, Stimmen, Hörner, Trommeln) und laufen durch einen Hall.
// Im Kampf entsteht ein Schlachtlärm: Schwertschläge, Schilde, Kriegsschreie, Pfeilsalven, Hufe, Kriegstrommeln und Hörner –
// je größer die Heere, desto dichter und wilder.
import { CLIPS } from '/public/audiodata.js';
const KEY = 'zk.sound';
export const cfg = { sfx: true, music: true, vs: .8, vm: .5 };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ohne Speicher geht es auch */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* egal */ } };

let ctx = null, master = null, sfxG = null, musG = null, wet = null, noiseBuf = null, last = {}, mood = 'calm', timer = 0, nextT = 0, bars = 0;
let bed = null, bedLevel = 0;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    ctx = new C(); master = ctx.createGain(); master.gain.value = .9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; master.connect(comp); comp.connect(ctx.destination);
    sfxG = ctx.createGain(); sfxG.connect(master); musG = ctx.createGain(); musG.connect(master);
    sfxG.gain.value = cfg.vs; musG.gain.value = cfg.vm * .5;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Hall: eine abklingende Rauschfolge als Raumantwort
    const len = Math.floor(ctx.sampleRate * 1.9), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const a = ir.getChannelData(ch); for (let i = 0; i < len; i++) a[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    const cv = ctx.createConvolver(); cv.buffer = ir; wet = ctx.createGain(); wet.gain.value = .34; cv.connect(wet); wet.connect(master); ctx._cv = cv;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// Ausgang eines Klangs: trocken zum Mischer, ein Teil zum Hall
function out(dest, send = .3) {
  const g = ctx.createGain(); g.connect(dest || sfxG);
  if (send > 0) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(ctx._cv); }
  return g;
}

// Ton mit Hüllkurve; o: type, v (Lautstärke), a (Anschlag), to (Gleiten), lp/hp (Filter), det, vib (Vibrato Hz/Tiefe), send, dest, pan
function tone(f, t, dur, o = {}) {
  if (f > 14000) return;
  const c = ctx, os = c.createOscillator(), g = c.createGain(), a = o.a == null ? .004 : o.a, v = o.v == null ? .3 : o.v;
  os.type = o.type || 'sine'; os.frequency.setValueAtTime(f, t); if (o.to) os.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
  if (o.det) os.detune.value = o.det;
  if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1]; l.connect(lg); lg.connect(os.frequency); l.start(t); l.stop(t + dur + .1); }
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let n = os; if (o.lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; n.connect(fl); n = fl; }
  if (o.hp) { const fl = c.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = o.hp; n.connect(fl); n = fl; }
  n.connect(g); let e = g;
  if (o.pan != null && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = o.pan; g.connect(p); e = p; }
  e.connect(out(o.dest, o.send == null ? .25 : o.send)); os.start(t); os.stop(t + dur + .05);
}
function noise(t, dur, o = {}) {
  const c = ctx, s = c.createBufferSource(), g = c.createGain(), fl = c.createBiquadFilter(), v = o.v == null ? .3 : o.v;
  s.buffer = noiseBuf; s.loop = true; fl.type = o.type || 'bandpass'; fl.frequency.setValueAtTime(o.f || 1500, t); if (o.to) fl.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t + dur); fl.Q.value = o.q || 1;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + (o.a || .003)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); let e = g;
  if (o.pan != null && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = o.pan; g.connect(p); e = p; }
  e.connect(out(o.dest, o.send == null ? .2 : o.send)); s.start(t, rnd(0, 1.5)); s.stop(t + dur + .05);
}
const N = n => 440 * Math.pow(2, (n - 69) / 12);   // Midi-Nummer → Hz

/* ---------- Bausteine ---------- */
// Metall: unharmonische Obertöne wie bei Glocken, Klingen und Rüstung
function metal(t, f, dur, v, o = {}) {
  for (const [k, a] of [[1, 1], [2.76, .6], [5.4, .4], [8.93, .25], [11.3, .15]]) tone(f * k, t, dur * (1.15 - k * .07), { type: 'sine', v: v * a, a: .001, send: o.send == null ? .35 : o.send, pan: o.pan, dest: o.dest });
  noise(t, .04, { type: 'highpass', f: 3500, v: v * .9, send: .15, pan: o.pan, dest: o.dest });
}
// Stimme (Schrei/Gesang): Sägezahn durch zwei Vokal-Filter
function voice(t, f, dur, v, o = {}) {
  const c = ctx, os = c.createOscillator(), g = c.createGain(), f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), vw = pick(o.vowels || [[700, 1100], [550, 1750], [400, 800], [800, 1300]]);
  os.type = 'sawtooth'; os.frequency.setValueAtTime(f, t); os.frequency.linearRampToValueAtTime(f * (o.glide || 1.18), t + dur * .35); os.frequency.linearRampToValueAtTime(f * (o.end || .85), t + dur);
  const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = rnd(5, 7); lg.gain.value = f * .02; l.connect(lg); lg.connect(os.frequency); l.start(t); l.stop(t + dur + .1);
  f1.type = 'bandpass'; f1.frequency.value = vw[0]; f1.Q.value = 5; f2.type = 'bandpass'; f2.frequency.value = vw[1]; f2.Q.value = 6;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + (o.a || .06)); g.gain.setValueAtTime(v, t + dur * .6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const mix = c.createGain(); os.connect(f1); os.connect(f2); f1.connect(mix); f2.connect(mix); mix.connect(g);
  let e = g; if (o.pan != null && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = o.pan; g.connect(p); e = p; }
  e.connect(out(o.dest, o.send == null ? .3 : o.send)); os.start(t); os.stop(t + dur + .05);
}
// Horn/Posaune: warmer Sägezahn, der aufblüht
function horn(t, f, dur, v, o = {}) {
  tone(f, t, dur, { type: 'sawtooth', v, a: o.a || .12, lp: o.lp || 900, vib: [5, f * .004], send: .35, dest: o.dest });
  tone(f * 1.003, t, dur, { type: 'sawtooth', v: v * .7, a: o.a || .14, lp: (o.lp || 900) * .9, send: .35, dest: o.dest });
  tone(f * .5, t, dur, { type: 'triangle', v: v * .8, a: o.a || .12, send: .2, dest: o.dest });
}
// Pauke / Kriegstrommel
function taiko(t, v = .6, o = {}) { tone(rnd(105, 125), t, .5, { v, to: 38, a: .002, send: .35, dest: o.dest, pan: o.pan }); noise(t, .09, { type: 'lowpass', f: 600, v: v * .5, send: .1, dest: o.dest }); noise(t, .02, { type: 'highpass', f: 2500, v: v * .25, send: .1, dest: o.dest }); }
function snare(t, v = .3, o = {}) { noise(t, .15, { f: 2400, q: .7, v, send: .2, dest: o.dest }); tone(210, t, .09, { v: v * .7, to: 140, send: .1, dest: o.dest }); }
// Schwertschlag: Aufprall, metallisches Klingen und – je nach Zufall – Schildklatschen
function clashHit(t, big, pan) {
  const f = rnd(620, 1500);
  metal(t, f, rnd(.25, .7), rnd(.1, .2) * big, { pan });
  noise(t, .05, { f: 4500, q: 1, v: .22 * big, pan });
  if (Math.random() < .55) { tone(rnd(110, 170), t, .12, { type: 'triangle', v: .3 * big, to: 55, pan }); noise(t, .08, { type: 'lowpass', f: 700, v: .28 * big, pan }); }
  if (Math.random() < .3) { noise(t + .04, .35, { type: 'highpass', f: rnd(3000, 5500), q: 6, v: .08 * big, pan }); }   // Schleifen der Klingen
}
function cry(t, big, pan) { const f = rnd(95, 210); voice(t, f, rnd(.45, 1.1), rnd(.05, .11) * big, { pan }); if (Math.random() < .5) voice(t + rnd(0, .12), f * 1.5, rnd(.4, .9), .04 * big, { pan: pan == null ? null : -pan }); }
function arrows(t, n, pan) { for (let i = 0; i < n; i++) { const tt = t + rnd(0, .35); noise(tt, rnd(.35, .6), { f: rnd(3500, 5000), to: rnd(700, 1100), q: 3, v: .09, pan }); noise(tt + rnd(.45, .8), .07, { type: 'lowpass', f: 500, v: .16, pan }); } }
function hooves(t, n, pan) { for (let i = 0; i < n; i++) { noise(t + i * .13, .07, { type: 'lowpass', f: rnd(350, 520), v: .22, pan }); tone(rnd(95, 130), t + i * .13, .08, { type: 'triangle', v: .12, to: 60, pan }); } }

const SFX = {
  tap: t => { noise(t, .02, { f: 2200, q: 5, v: .12, send: .05 }); tone(880, t, .025, { v: .05, to: 640, send: .05 }); },
  open: t => { noise(t, .06, { f: 900, to: 1800, q: 2, v: .07, send: .08 }); },
  close: t => { noise(t, .06, { f: 1800, to: 800, q: 2, v: .06, send: .08 }); },
  ok: t => { tone(N(72), t, .22, { type: 'triangle', v: .12 }); tone(N(79), t + .08, .3, { type: 'triangle', v: .12 }); },
  err: t => { tone(120, t, .22, { type: 'sawtooth', v: .1, lp: 420, to: 85, send: .1 }); noise(t, .08, { type: 'lowpass', f: 400, v: .12, send: .05 }); },
  pop: t => tone(520, t, .09, { v: .13, to: 880, send: .1 }),
  // Hammer auf Holz, Säge, Nagelschlag
  build: t => { for (let i = 0; i < 4; i++) { const tt = t + i * rnd(.16, .22); noise(tt, .035, { f: 1100, q: 3, v: .3, send: .15 }); tone(150, tt, .1, { type: 'triangle', v: .3, to: 70, send: .15 }); tone(rnd(380, 460), tt, .22, { v: .08, send: .2 }); } noise(t + .9, .35, { f: 2600, q: 2, v: .08, a: .1, send: .1 }); },
  // Schmied: Hammer auf Amboss, danach Zischen
  train: t => { for (let i = 0; i < 3; i++) { const tt = t + i * .24; metal(tt, rnd(1150, 1300), .5, .13, { send: .3 }); tone(90, tt, .1, { v: .28, to: 50, send: .1 }); } noise(t + .8, .5, { type: 'highpass', f: 5000, v: .07, a: .1, send: .1 }); },
  research: t => { [84, 88, 91, 96, 100].forEach((n, i) => { tone(N(n), t + i * .1, 1.1, { v: .08, send: .6 }); tone(N(n) * 2.001, t + i * .1, .6, { v: .02, send: .6 }); }); },
  done: t => { horn(t, N(55), .5, .1); horn(t + .15, N(62), .5, .1); horn(t + .3, N(67), .9, .11); metal(t + .3, N(91), 1.2, .05); },
  coin: t => { for (let i = 0; i < 4; i++) metal(t + i * rnd(.04, .08), rnd(2400, 3600), .35, .05, { send: .25 }); },
  gather: t => { metal(t, rnd(1700, 2100), .25, .09); noise(t, .06, { f: 900, q: 2, v: .18 }); },
  bell: t => { for (const [k, a, d] of [[1, 1, 2.4], [2, .55, 1.8], [2.4, .35, 1.5], [3, .3, 1.2], [4.2, .2, .8], [5.4, .12, .6]]) tone(N(84) * k * .5, t, d, { v: .14 * a, a: .002, send: .5 }); noise(t, .03, { f: 3000, v: .1 }); },
  report: t => { tone(N(79), t, .5, { type: 'triangle', v: .1, send: .4 }); tone(N(86), t + .13, .7, { type: 'triangle', v: .1, send: .4 }); metal(t + .13, N(98), .6, .03); },
  alert: t => { for (let i = 0; i < 4; i++) { const tt = t + i * .42; for (const [k, a, d] of [[1, 1, .55], [2.4, .5, .4], [3.9, .3, .3]]) tone(N(78) * k, tt, d, { v: .13 * a, a: .002, send: .4 }); noise(tt, .02, { f: 2500, v: .1 }); } },
  march: t => { horn(t, N(46), 1.0, .12, { a: .15 }); taiko(t + .1, .45); taiko(t + .5, .5); for (let i = 0; i < 6; i++) noise(t + .2 + i * .17, .05, { type: 'lowpass', f: 500, v: .13, send: .05 }); },
  home: t => { horn(t, N(53), .5, .09); horn(t + .3, N(48), .8, .09); },
  war: t => { horn(t, N(41), 1.4, .17, { a: .25 }); horn(t + .7, N(48), 1.5, .16, { a: .2 }); taiko(t + .2, .7); taiko(t + .9, .7); taiko(t + 1.1, .55); cry(t + 1.0, 1.4, -.3); cry(t + 1.25, 1.4, .3); },
  win: t => { [[55, 0], [62, .22], [67, .44], [74, .66], [79, 1.0]].forEach(([n, d], i) => { horn(t + d, N(n), i === 4 ? 1.8 : .5, .12, { a: .05, lp: 1500 }); horn(t + d, N(n - 12), i === 4 ? 1.8 : .5, .08, { a: .05, lp: 1100 }); }); taiko(t, .6); taiko(t + 1.0, .7); noise(t + 1.0, 1.6, { type: 'highpass', f: 5500, v: .09, a: .02, send: .5 }); for (let i = 0; i < 4; i++) cry(t + 1.1 + i * .1, 1.3, rnd(-.6, .6)); },
  lose: t => { horn(t, N(45), 1.4, .13, { a: .3, lp: 500 }); horn(t + .9, N(41), 2.0, .12, { a: .3, lp: 420 }); taiko(t + .5, .5); taiko(t + 1.4, .45); },
  teleport: t => { tone(180, t, .9, { v: .1, to: 2400, send: .6 }); noise(t, .9, { f: 500, to: 6000, q: 1.5, v: .12, a: .2, send: .5 }); [90, 95, 99].forEach((n, i) => tone(N(n), t + .7 + i * .06, 1.2, { v: .05, send: .7 })); },
  clash: t => clashHit(t, 1, rnd(-.7, .7))
};

/* ---------- Schlachtlärm: läuft, solange ein Kampf stattfindet (Stärke 0 bis 1) ---------- */
function bedStart() {
  if (bed) return; const c = ctx;
  const mk = (f, q, v) => { const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(); s.buffer = noiseBuf; s.loop = true; fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q; g.gain.value = v; s.connect(fl); fl.connect(g); s.start(); return { s, fl, g }; };
  const master2 = c.createGain(); master2.gain.value = 0; master2.connect(sfxG); const dry = master2;
  const s2 = c.createGain(); s2.gain.value = .3; master2.connect(s2); s2.connect(ctx._cv);
  const layers = [mk(260, .7, .5), mk(900, .8, .35), mk(2400, 1.2, .1)];
  for (const L of layers) L.g.connect(dry);
  // das Brausen der Menge schwillt unregelmäßig an und ab
  const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = .37; lg.gain.value = .25; lfo.connect(lg); lg.connect(layers[1].g.gain); lfo.start();
  const lfo2 = c.createOscillator(), lg2 = c.createGain(); lfo2.frequency.value = .83; lg2.gain.value = 120; lfo2.connect(lg2); lg2.connect(layers[0].fl.frequency); lfo2.start();
  bed = { master: master2, layers };
}
let battleT = 0;
function battleTick(level) {
  const now = ctx.currentTime; bedStart(); bed.master.gain.cancelScheduledValues(now); bed.master.gain.linearRampToValueAtTime(level > 0 ? .16 + level * .5 : 0, now + .6);
  if (level <= 0) return;
  const dens = 1 + level * 4;   // Schläge je Tick
  for (let i = 0; i < dens; i++) if (Math.random() < .55 + level * .4) clashHit(now + rnd(0, .26), .6 + level * .8, rnd(-.9, .9));
  if (Math.random() < .35 + level * .3) cry(now + rnd(0, .2), .7 + level, rnd(-.8, .8));
  if (Math.random() < .08 + level * .1) arrows(now + rnd(0, .1), 3 + Math.floor(level * 5), rnd(-.8, .8));
  if (level > .35 && Math.random() < .08 + level * .08) hooves(now, 5 + Math.floor(level * 6), rnd(-.8, .8));
  if (Math.random() < .035 + level * .03) horn(now + rnd(0, .1), N(pick([41, 43, 46, 48])), rnd(1, 1.8), .13, { a: .2, lp: 800 });
}

/* ---------- Musik: ruhig mit Harfe, Flöte und Streicherteppich; im Kampf Kriegstrommeln, Hörner und tremolierende Streicher ---------- */
const SCALE = [0, 2, 3, 5, 7, 9, 10], PROG = [0, 6, 3, 4, 0, 5, 3, 4];
const deg = (d, oct = 0) => 50 + SCALE[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);   // 50 = D3
// gezupfte Saite (Harfe/Laute): Grundton und Obertöne, hohe klingen schneller ab
function pluck(f, t, dur, v, dest) { [[1, 1, 1], [2, .45, .6], [3, .25, .4], [4.01, .12, .25]].forEach(([k, a, d]) => tone(f * k, t, dur * d, { v: v * a, a: .003, send: .45, dest })); noise(t, .02, { f: f * 3, q: 3, v: v * .4, send: .1, dest }); }
function flute(f, t, dur, v, dest) { tone(f, t, dur, { v, a: .12, vib: [5.2, f * .006], send: .5, dest }); noise(t, dur, { f: f * 2, q: 4, v: v * .35, a: .15, send: .4, dest }); }
function strings(f, t, dur, v, dest, lp = 800) { for (const det of [-9, 0, 9]) tone(f, t, dur, { type: 'sawtooth', v, a: dur * .35, lp, det, send: .5, dest }); }
function bar(t, bi, bpm) {
  const b = 60 / bpm, root = PROG[bi % 8], ch = [root, root + 2, root + 4], fight = mood === 'battle', len = 4 * b;
  if (fight) {
    for (const d of [root, root + 4]) strings(N(deg(d, -1)), t, len + .5, .035, musG, 600);
    horn(t, N(deg(root, -2)), b * 1.6, .1, { a: .05, lp: 700, dest: musG }); horn(t + b * 2, N(deg(root, -2)), b * 1.2, .09, { a: .05, lp: 700, dest: musG });
    for (let i = 0; i < 8; i++) { const tt = t + i * b / 2; if (i % 4 === 0) taiko(tt, .55, { dest: musG }); else if (i % 4 === 2) taiko(tt, .32, { dest: musG }); if (i % 2 === 1) snare(tt, .08, { dest: musG }); }
    for (let i = 0; i < 16; i++) { const d = pick(ch); tone(N(deg(d, 1)), t + i * b / 4, .13, { type: 'sawtooth', v: .028, a: .005, lp: 1400, dest: musG, send: .2 }); }
    return;
  }
  strings(N(deg(root)), t, len + 1.2, .016, musG); strings(N(deg(root + 4)), t, len + 1.2, .012, musG);
  pluck(N(deg(root, -1)), t, b * 3, .18, musG); pluck(N(deg(root, -1)), t + b * 2, b * 2.5, .13, musG);
  let prev = ch[1];
  for (let st = 0; st < 8; st++) {   // Harfenlauf
    if (Math.random() < .25) continue; const tt = t + st * b / 2, d = ch[st % 3] + (st > 3 ? 7 : 0); pluck(N(deg(d, 1)), tt, 1.6, .075, musG);
  }
  if (bi % 2 === 0 && Math.random() < .7) {   // Flötenmelodie
    let tt = t + (Math.random() < .5 ? 0 : b), n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { let d = prev + pick([-2, -1, 1, 2, 2]); d = Math.max(root + 1, Math.min(root + 9, d)); prev = d; const dur = pick([.5, .5, 1, 1.5]) * b; flute(N(deg(d, 1)), tt, dur * 1.1, .06, musG); tt += dur; if (tt > t + len - .3) break; }
  }
  if (bi % 4 === 3) { tone(130, t + 3 * b, .4, { v: .2, to: 90, dest: musG, send: .3 }); noise(t + 3 * b, .06, { f: 700, v: .1, dest: musG }); }   // leise Handtrommel zum Schluss
}
function schedule() {
  if (!ctx || !cfg.music) return;
  const bpm = mood === 'battle' ? 112 : 62;
  while (nextT < ctx.currentTime + 1.4) { if (nextT < ctx.currentTime) nextT = ctx.currentTime + .05; bar(nextT, bars++, bpm); nextT += 4 * 60 / bpm; }
}
function musicOn() { if (!ac()) return; if (!timer) { nextT = ctx.currentTime + .2; timer = setInterval(schedule, 250); } schedule(); }
function musicOff() { clearInterval(timer); timer = 0; }

const clipBuf = {};
async function clipPlay(name, vol) {
  if (!cfg.sfx || !CLIPS[name] || !ac()) return;
  try {
    if (!clipBuf[name]) { const b64 = CLIPS[name].split(',')[1], bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); clipBuf[name] = ctx.decodeAudioData(u.buffer); }
    const buf = await clipBuf[name], src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; g.gain.value = vol * Math.max(.3, cfg.vs); src.connect(g); g.connect(master); src.start();
  } catch { /* ein Ton darf nie das Spiel stören */ }
}
export const snd = {
  // Eigene Klangdatei (public/audio) abspielen
  clip(name, vol = 1) { clipPlay(name, vol); },
  // Beim ersten Tippen darf der Browser Ton abspielen
  unlock() { if (!ac()) return; if (cfg.music && !timer) musicOn(); },
  sfx(name, vol = 1) {
    if (!cfg.sfx || !SFX[name] || !ac()) return;
    const now = ctx.currentTime; if (last[name] && now - last[name] < (name === 'tap' ? .04 : .09)) return; last[name] = now;
    try { sfxG.gain.value = cfg.vs * vol; SFX[name](now + .005); sfxG.gain.setTargetAtTime(cfg.vs, now + .05, .05); } catch { /* ein Ton darf nie das Spiel stören */ }
  },
  // Schlachtlärm in der Stärke 0..1 (0 = aus); alle 300 ms aufrufen
  battle(level) {
    if (!cfg.sfx || !ac()) return;
    if (level <= 0 && !bed) return;
    try { if (level <= 0) { bed.master.gain.setTargetAtTime(0, ctx.currentTime, .4); return; } const now = ctx.currentTime; if (now - battleT < .28) return; battleT = now; battleTick(Math.min(1, level)); } catch { /* egal */ }
  },
  mood(m) { if (m !== mood) { mood = m; if (ctx && timer) nextT = Math.max(nextT, ctx.currentTime + .1); } },
  setMusic(on) { cfg.music = !!on; save(); if (on) musicOn(); else musicOff(); },
  setSfx(on) { cfg.sfx = !!on; save(); if (on) { ac(); this.sfx('ok'); } else if (bed) bed.master.gain.value = 0; },
  setVol(k, v) { cfg[k] = Math.max(0, Math.min(1, v)); save(); if (ctx) { sfxG.gain.value = cfg.vs; musG.gain.value = cfg.vm * .5; } },
  cfg
};
