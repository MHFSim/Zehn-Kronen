// Zehn Kronen – Musik und Klänge. Es werden nur die Audiodateien aus public/audio verwendet (keine erzeugten Töne).
// Hintergrundmusik: zwei Stücke im Wechsel. Szenen mit weichem Übergang: Schlacht (geht vor) > Heldenmenü > normale Musik.
// Die Schlachtmusik startet mit dem Kampf, läuft höchstens einmal und nur so lange der Kampf dauert; die Heldenmusik läuft im Kreis, solange das Menü offen ist.
import { CLIPS } from '/public/audiodata.js';
const KEY = 'zk.sound';
export const cfg = { sfx: true, music: true, vs: .8, vm: .5 };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ohne Speicher geht es auch */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* egal */ } };

const TRACKS = ['/public/audio/wache.mp3', '/public/audio/eidgenossenschaft.mp3'];
const BATTLE = '/public/audio/schlacht.mp3', HEROMUS = '/public/audio/helden.mp3';
let player = null, trackI = -1, bplayer = null, hplayer = null, bon = false, hon = false;
const musVol = () => Math.min(1, cfg.vm * .8);

function fadeTo(a, to, sec, done) {
  if (!a) return; clearInterval(a._f); const from = a.volume, t0 = performance.now();
  a._f = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / (sec * 1000)); a.volume = Math.max(0, Math.min(1, from + (to - from) * k)); if (k >= 1) { clearInterval(a._f); if (done) done(); } }, 50);
}
function mk(src, loop, onEnd) {
  const a = new Audio(); a.preload = 'auto'; a.src = src; a.loop = loop; a.volume = 0;
  a.addEventListener('ended', onEnd || (() => {})); a.addEventListener('error', () => { a._bad = true; applyScene(); });
  return a;
}
function applyScene() {
  if (!cfg.music) return;
  const want = bon && bplayer && !bplayer._bad ? 'b' : hon && hplayer && !hplayer._bad ? 'h' : 'n', sec = want === 'n' ? 2.5 : 1.5;
  for (const [id, a] of [['b', bplayer], ['h', hplayer], ['n', player]]) {
    if (!a || a._bad) continue;
    if (id === want) { if (a.paused) { if (id !== 'n') a.currentTime = 0; a.volume = 0; a.play().catch(() => {}); } fadeTo(a, musVol(), sec); }
    else if (!a.paused) fadeTo(a, 0, sec, () => a.pause());
  }
}
function playlistOn() {
  if (!player) {
    if (trackI < 0) trackI = Math.floor(Math.random() * TRACKS.length);
    player = mk(TRACKS[trackI], false, () => { trackI = (trackI + 1) % TRACKS.length; player.src = TRACKS[trackI]; player.play().catch(() => {}); });
  }
  if (player.paused) { player.volume = 0; player.play().catch(() => {}); }
  applyScene();
}
function musicOff() { for (const a of [player, bplayer, hplayer]) if (a) { clearInterval(a._f); a.pause(); } }
function battleStart() { if (!cfg.music || bon) return; bon = true; if (!bplayer) bplayer = mk(BATTLE, false, () => { bon = false; applyScene(); }); applyScene(); }
function battleEnd() { if (!bon) return; bon = false; applyScene(); }
function heroScene(on) { if (on === hon) return; hon = on; if (on && !hplayer) hplayer = mk(HEROMUS, true); applyScene(); }

export const snd = {
  // Eigene Klangdatei (eingebettet aus public/audio) einmal abspielen, z. B. 'quests'
  clip(name, vol = 1) {
    if (!cfg.sfx || !CLIPS[name]) return;
    try { const a = new Audio(CLIPS[name]); a.volume = Math.min(1, vol * Math.max(.3, cfg.vs)); a.play().catch(() => {}); } catch { /* ein Ton darf nie das Spiel stören */ }
  },
  // Beim ersten Tippen darf der Browser Ton abspielen
  unlock() { if (cfg.music && (!player || (player.paused && !bon && !hon))) playlistOn(); },
  heroMenu(on) { heroScene(!!on); },
  mood(m) { if (m === 'battle') battleStart(); else battleEnd(); },
  setMusic(on) { cfg.music = !!on; save(); if (on) playlistOn(); else musicOff(); },
  setSfx(on) { cfg.sfx = !!on; save(); },
  setVol(k, v) { cfg[k] = Math.max(0, Math.min(1, v)); save(); for (const a of [player, bplayer, hplayer]) if (a && !a.paused && a.volume > 0) { clearInterval(a._f); a.volume = musVol(); } },
  cfg
};
