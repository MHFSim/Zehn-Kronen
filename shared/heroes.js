// Zehn Kronen – Helden: Daten, Boni, Stufen. Jede Armee braucht einen Helden als Anführer.
import { U } from './rules.js';

export const HERO_MAX = 60;
// Stufe n -> n+1 braucht so viel Erfahrung (bis Stufe 60 zusammen etwa 180 000)
export const xpNeed = lv => Math.round(30 * Math.pow(lv, 1.35));
// Fähigkeiten (k): gather = Sammelgeschwindigkeit (res = nur diese Ressource), carry = Tragkraft, atkInf/atkCav/atkRng = Angriff dieser Truppenart,
// force = Truppenstärke (Angriff und Abwehr), garrison = Abwehr der Burg, camp = gegen Banditenlager und Räuber, assault = Angriff auf Spieler und Außenposten, speed = Marschtempo.
// max = Wert auf Stufe 60; auf Stufe 1 gilt ein Viertel davon.
export const SKILL_NAME = {
  gather: 'Sammeln', carry: 'Tragkraft', atkInf: 'Infanterie-Angriff', atkCav: 'Kavallerie-Angriff', atkRng: 'Fernkampf-Angriff',
  force: 'Truppenstärke', garrison: 'Burgwache', camp: 'Räuberjäger', assault: 'Sturmangriff', speed: 'Marschtempo'
};
export const SKILL_TEXT = {
  gather: 'Sammelt schneller', carry: 'Das Heer trägt mehr', atkInf: 'Infanterie kämpft stärker', atkCav: 'Kavallerie kämpft stärker', atkRng: 'Bogen- und Armbrustschützen kämpfen stärker',
  force: 'Alle Truppen im Heer kämpfen stärker', garrison: 'Stärkt die Verteidigung der Burg, solange er sie bewacht', camp: 'Stärker gegen Räuber', assault: 'Stärker beim Angriff auf Spieler und Außenposten', speed: 'Das Heer marschiert schneller'
};
const RES_NAME = { food: 'Nahrung', wood: 'Holz', stone: 'Stein' };
export const HEROES = {
  aldric:    { name: 'Gero', title: 'Eisenhelm', icon: '🛡️', pic: '🧔', col: '#6f8fb5', fx: 'shield', role: 'fight', skills: [{ k: 'atkInf', max: .18 }, { k: 'garrison', max: .08 }],
               story: 'Ein Ritter, der noch nie einen Schritt zurückgewichen ist. Sein Helm hat mehr Schläge gesehen als jede Mauer.' },
  brienne:   { name: 'Roland', title: 'Bannerreiter', icon: '🐎', pic: '👩‍🦰', col: '#c2543b', fx: 'wind', role: 'fight', skills: [{ k: 'atkCav', max: .18 }, { k: 'speed', max: .08 }],
               story: 'Sein Banner weht vor dem Heer – und seine Reiter sind schon da, bevor der Staub sich legt.' },
  lyra:      { name: 'Ilvana', title: 'Feuerbogen', icon: '🏹', pic: '🧝‍♀️', col: '#4f9a5a', fx: 'leaf', role: 'fight', skills: [{ k: 'atkRng', max: .18 }, { k: 'speed', max: .06 }],
               story: 'Ihre Pfeile brennen, bevor sie treffen. Wer ihr Licht sieht, ist schon verloren.' },
  gorm:      { name: 'Hilda', title: 'Winterjägerin', icon: '🌾', pic: '👨‍🌾', col: '#d9a93a', fx: 'snow', role: 'gather', skills: [{ k: 'gather', res: 'food', max: .30 }, { k: 'carry', max: .08 }],
               story: 'Im tiefsten Schnee findet sie, was andere übersehen – und trägt es nach Hause.' },
  thorin:    { name: 'Freya', title: 'Waldläuferin', icon: '🪓', pic: '🧙‍♂️', col: '#8a5a2b', fx: 'chips', role: 'gather', skills: [{ k: 'gather', res: 'wood', max: .30 }, { k: 'carry', max: .08 }],
               story: 'Der Wald gehorcht ihr: Wo sie hinkommt, fallen die Stämme wie von selbst.' },
  ilsa:      { name: 'Borin', title: 'Zwergenkrieger', icon: '⛏️', pic: '👩‍🔧', col: '#8b95a3', fx: 'sparks', role: 'gather', skills: [{ k: 'gather', res: 'stone', max: .30 }, { k: 'carry', max: .08 }],
               story: 'Der härteste Fels gibt nach, wenn Borin zuhört, wie er klingt.' },
  mira:      { name: 'Konrad', title: 'Ordensverwalter', icon: '🛒', pic: '👩‍🌾', col: '#b36fb0', fx: 'dust', role: 'gather', skills: [{ k: 'gather', max: .18 }, { k: 'carry', max: .16 }],
               story: 'Kein Karren fährt leer und keiner überladen – der Orden vergisst nichts.' },
  cedric:    { name: 'Mortimer', title: 'Torwächter', icon: '🏰', pic: '💂', col: '#7a8aa0', fx: 'ward', role: 'fight', skills: [{ k: 'garrison', max: .22 }, { k: 'force', max: .04 }], keeper: true,
               story: 'Er steht an der Schwelle, seit die Mauern stehen. Die beste Wahl für den Burgwächter.' },
  seraphine: { name: 'Elara', title: 'Schwurritterin', icon: '👑', pic: '👸', col: '#e0b45a', fx: 'glow', role: 'fight', skills: [{ k: 'force', max: .12 }, { k: 'speed', max: .04 }],
               story: 'Sie kniet vor der Schlacht, damit ihr Heer danach aufrecht steht.' },
  draven:    { name: 'Corvin', title: 'Rabenjäger', icon: '🗡️', pic: '🥷', col: '#5b4a8a', fx: 'shadow', role: 'fight', skills: [{ k: 'camp', max: .25 }, { k: 'force', max: .03 }],
               story: 'Seine Raben wissen, wo die Räuber streifen, noch bevor sie es selbst wissen.' },
  kael:      { name: 'Morgrim', title: 'Schattenreiter', icon: '⚔️', pic: '🤺', col: '#b8452a', fx: 'flame', role: 'fight', skills: [{ k: 'assault', max: .14 }, { k: 'atkCav', max: .06 }],
               story: 'Man hört ihn nicht kommen. Burgen fallen, wenn er nur auf sie zeigt.' },
  zephyr:    { name: 'Nyx', title: 'Frostschatten', icon: '🧭', pic: '🧑‍🚀', col: '#3fa7c4', fx: 'gust', role: 'fight', skills: [{ k: 'speed', max: .20 }, { k: 'atkRng', max: .06 }],
               story: 'Sie läuft durch den Schnee, ohne Spuren zu hinterlassen – und ist dort, bevor man sie vermisst.' }
};
export const HERO_IDS = Object.keys(HEROES);
export const DEFAULT_KEEPER = 'cedric', DEFAULT_DEPUTY = 'seraphine';
export const heroName = id => HEROES[id] ? HEROES[id].name + ' ' + HEROES[id].title : '';

/* ---------- Zustand ---------- */
export function heroEnsure(S) {
  S.heroes = S.heroes || {};
  for (const id of HERO_IDS) { const h = S.heroes[id] = S.heroes[id] || { lv: 1, xp: 0 }; if (!(h.lv >= 1)) h.lv = 1; if (!(h.xp >= 0)) h.xp = 0; }
  if (S.defHero === undefined) S.defHero = DEFAULT_KEEPER;
  if (S.defDeputy === undefined) S.defDeputy = DEFAULT_DEPUTY;
  S.heroLog = S.heroLog || {};
  return S;
}
export const heroLv = (S, id) => ((S.heroes || {})[id] || { lv: 1 }).lv;
export const valueOf = (sk, lv) => sk.max * (0.25 + 0.75 * (Math.max(1, Math.min(HERO_MAX, lv)) - 1) / (HERO_MAX - 1));
// Summe der Werte einer Fähigkeit (bei res nur die passende Ressource, "gather" ohne res gilt für alle)
export function skillOf(S, id, k, res) {
  const H = HEROES[id]; if (!H) return 0; const lv = heroLv(S, id);
  return H.skills.reduce((a, sk) => a + (sk.k === k && (!sk.res || sk.res === res) ? valueOf(sk, lv) : 0), 0);
}
export const skillList = (S, id) => { const H = HEROES[id]; return H ? H.skills.map(sk => ({ ...sk, name: SKILL_NAME[sk.k] + (sk.res ? ' ' + RES_NAME[sk.res] : ''), text: SKILL_TEXT[sk.k], val: valueOf(sk, heroLv(S, id)), top: valueOf(sk, HERO_MAX) })) : []; };

/* ---------- Wirkung ---------- */
const CLS = { inf: 'atkInf', kav: 'atkCav', art: 'atkRng' };
// Anteil der Truppen je Gattung
function shares(t) { const tot = Object.values(t).reduce((a, b) => a + b, 0) || 1, s = { inf: 0, kav: 0, art: 0 }; for (const u in t) { const g = U[u] && U[u].g; if (g in s) s[g] += t[u] / tot; } return s; }
// Kampfstärke-Faktor (≥ 1) des Helden für ein Heer. ctx: 'att' | 'def' (Burg/Heer verteidigt), foe: 'camp' (Lager, Räuber) | 'player'
export function heroForce(S, id, troops, side, foe) {
  if (!id || !HEROES[id]) return 1;
  let b = skillOf(S, id, 'force'); const sh = shares(troops || {});
  for (const g in CLS) b += skillOf(S, id, CLS[g]) * sh[g];
  if (side === 'att' && foe === 'camp') b += skillOf(S, id, 'camp');
  if (side === 'att' && foe === 'player') b += skillOf(S, id, 'assault');
  if (side === 'def' && foe === 'home') b += skillOf(S, id, 'garrison');
  return 1 + b;
}
export const heroSpeed = (S, id) => 1 + skillOf(S, id, 'speed');
export const heroGather = (S, id, res) => 1 + skillOf(S, id, 'gather', res);
export const heroCarry = (S, id) => 1 + skillOf(S, id, 'carry');
// Welche Truppen der Held bevorzugt (für die Auswahl beim Losschicken): Liste von Gattungen/Einheiten in dieser Reihenfolge
export function heroPrefers(id) {
  const H = HEROES[id]; if (!H) return [];
  const m = { atkInf: 'inf', atkCav: 'kav', atkRng: 'art' }, c = H.skills.filter(sk => m[sk.k]).sort((a, b) => b.max - a.max)[0];
  if (c) return [m[c.k]];
  return H.role === 'gather' ? ['trans'] : [];
}
// Held, der gerade eine Armee anführt?
export const heroBusy = (w, pid, id) => (w.marches || []).some(m => !m.dead && m.owner === pid && m.hero === id);
// Welcher Held bewacht die Burg gerade? Erst der Wächter, sonst der Stellvertreter – nur wenn er nicht unterwegs ist.
export function keeperOf(S, w, pid) {
  for (const id of [S.defHero, S.defDeputy]) if (id && HEROES[id] && !heroBusy(w, pid, id)) return id;
  return '';
}

/* ---------- Erfahrung ---------- */
export function heroXp(S, id, xp) {
  const h = S.heroes && S.heroes[id]; if (!h || !(xp > 0) || h.lv >= HERO_MAX) return 0;
  h.xp += Math.round(xp); let up = 0;
  while (h.lv < HERO_MAX && h.xp >= xpNeed(h.lv)) { h.xp -= xpNeed(h.lv); h.lv++; up++; }
  if (h.lv >= HERO_MAX) h.xp = 0;
  return up;
}
// Sammler-Helden lernen beim Sammeln (1 Erfahrung je 4 Rohstoffe), Kämpfer im Kampf
export const gathersXp = id => !!HEROES[id] && HEROES[id].role === 'gather';
// Gegen dasselbe Ziel gibt es innerhalb von 30 Minuten Spielzeit nur ein Viertel, Räuber/Lager weit unter der Heldenstufe geben fast nichts
export function fightXp(S, id, base, key, targetLv, gt) {
  if (!HEROES[id] || HEROES[id].role === 'gather') return 0;
  let xp = base;
  if (targetLv && heroLv(S, id) >= 2 * targetLv + 8) xp *= 0.2;
  S.heroLog = S.heroLog || {};
  if (key) { const last = S.heroLog[key]; if (last != null && gt - last < 1800) xp *= 0.25; S.heroLog[key] = gt; }
  for (const k of Object.keys(S.heroLog)) if (gt - S.heroLog[k] > 7200) delete S.heroLog[k];
  return xp;
}
