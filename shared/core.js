// Zehn Kronen – Grundlagen der Welt: Zustand, Märsche, Berichte, Meldungen, Bündnis-Abfragen.
// Wird von world.js (Ablauf), social.js (Bündnisse) und war.js (Kriege) gemeinsam benutzt.
import { N, generateMap, findPath, pathTimes, NODE_MAX } from './mapgen.js';
import { lazarettCap, woundedCount, techMult, U } from './rules.js';
import { forestCostFor, armySpeed, capacityOf, sum } from './combat.js';

/* ---------- Regeln der Welt (alle Zeiten in Spielsekunden) ---------- */
export const DAY = 86400;
export const PLAYER_COLORS = ['#c8372d', '#2f6fd1', '#e2b02e', '#3f9d4c', '#8a4bc4', '#e0782b', '#27a7a1', '#d9609c', '#9aa5b1', '#b9d03a'];
export const NODE_REFILL = 6 * 3600;      // Ein Feld ist 6 Stunden nach dem letzten Kontakt (oder der Leerung) wieder voll
export const NODE_EMPTY = 50;             // darunter gilt ein Feld als leer
export const CAMP_RESPAWN = 6 * 3600;    // bis ein Lager wiederkommt
export const GATHER_SEC = 3;             // Sammeln: 20 Rohstoffe pro Minute, unabhängig von der Truppenzahl (die Traglast begrenzt nur die Menge)
export const VIEW_CITY = 11, VIEW_ARMY = 6;
export const PROTECT = 4 * DAY;          // Neulingsschutz
export const FALL_PROTECT = 12 * 3600;   // Schutz nach dem Fall der Burg
export const VASSAL_TIME = 7 * DAY;      // so lange bleibt ein Vasall Vasall
export const TRIBUTE = 0.2;              // Anteil der Erzeugung, den ein Vasall abgibt
export const LEAVE_LOCK = 24 * 3600;     // nach dem Austritt keine Angriffe auf die früheren Verbündeten
export const THRONE_HOLD = 7 * DAY;      // so lange muss der Thron gehalten werden
export const SANCT_BONUS = 0.15;         // Produktionsbonus je gehaltenem Heiligtum
export const THRONE_GOLD = 0.25;         // Goldbonus für den Halter des Throns
export const SPY_COST = 50;              // Gold je Spähbericht
export const MAX_REPORTS = 25, MAX_FEED = 40, MAX_CHAT = 80, MAX_CHRON = 80;
export const allianceCap = players => Math.floor(players / 2) + 1;   // Hälfte der Spieler plus eins
export const stationCap = S => 60 * S.lv.rathaus;                   // so viele fremde Truppen nimmt eine Burg auf

export const mapOf = match => generateMap(match.seed);
export const cellXY = c => { const x = c % N; return [x, (c - x) / N]; };

/* ---------- Welt und Spielerzustand ---------- */
export function newWorld(now, o = {}) {
  const phase = o.phase || 'running', weeks = o.weeks || 10;
  return { ver: 2, n: N, gt: 0, at: now, nodes: {}, camps: {}, ruins: {}, marches: [], nextId: 1,
    phase, weeks, startGt: 0, endGt: phase === 'running' ? weeks * 7 * DAY : 0,
    alliances: {}, nextAl: 1, pending: [], nextPend: 1, holds: {}, outposts: {}, nextOp: 1, chron: [], result: null };
}
export function ensureWorld(w) {
  if (!w.phase) w.phase = 'running';
  if (!w.alliances) w.alliances = {}; if (!w.nextAl) w.nextAl = 1;
  if (!w.pending) w.pending = []; if (!w.nextPend) w.nextPend = 1;
  if (!w.holds) w.holds = {}; if (!w.chron) w.chron = []; if (!w.outposts) w.outposts = {}; if (!w.nextOp) w.nextOp = 1;
  if (w.weeks == null) w.weeks = 10; if (w.startGt == null) w.startGt = 0; if (w.endGt == null) w.endGt = 0;
  if (w.result === undefined) w.result = null;
  return w;
}
export function ensureState(S) {
  S.away = S.away || {}; S.wounded = S.wounded || {}; S.reports = S.reports || []; S.nextRep = S.nextRep || 1;
  S.explored = S.explored || ''; if (S.slot == null) S.slot = -1; S.pos = S.pos || [0, 0];
  S.tech = S.tech || {}; S.research = S.research || null; S.items = S.items || {}; if (S.tpAt == null) S.tpAt = -1e9; S.stationed = S.stationed || {}; S.protUntil = S.protUntil || 0; S.vassalOf = S.vassalOf || 0; S.vassalUntil = S.vassalUntil || 0;
  S.out = !!S.out; S.exAllies = S.exAllies || {}; S.feed = S.feed || []; S.nextFeed = S.nextFeed || 1; S.bonus = S.bonus || {};
  S.stats = S.stats || {}; for (const k of ['attacks', 'wins', 'conquests', 'kills', 'lost']) S.stats[k] = S.stats[k] || 0;
  return S;
}
export const isProtected = (S, gt) => S.protUntil > gt;
export const byId = (players, id) => players.find(p => p.id === id);
export const playerAtSlot = (players, slot) => players.find(p => p.state.slot === slot && !p.state.out) || null;
export const cityId = S => 'start' + (S.slot + 1);

/* ---------- Felder und Lager ---------- */
export function nodeLeft(w, o, gt) {
  const max = NODE_MAX(o.lv), n = w.nodes[o.id];
  if (!n || gt - n.t >= NODE_REFILL) return max;
  return n.left < NODE_EMPTY ? 0 : n.left;
}
export const campAlive = (w, id, gt) => !(w.camps[id] && w.camps[id].dead > gt);

/* ---------- Nebel des Krieges: besucht-Bits (die Karte zeigt ihn derzeit nicht an) ---------- */
function bits(S) {
  if (!S._bits) {
    const b = new Uint8Array(Math.ceil(N * N / 8));
    if (S.explored) { try { const raw = atob(S.explored); for (let i = 0; i < raw.length && i < b.length; i++) b[i] = raw.charCodeAt(i); } catch {} }
    Object.defineProperty(S, '_bits', { value: b, enumerable: false, writable: true });
    Object.defineProperty(S, '_dirty', { value: false, enumerable: false, writable: true });
  }
  return S._bits;
}
export const isExplored = (S, x, y) => (bits(S)[(y * N + x) >> 3] >> ((y * N + x) & 7)) & 1;
export function reveal(S, cx, cy, r) {
  const b = bits(S);
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(N - 1, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(N - 1, Math.ceil(cx + r)); x++) {
      if ((x + .5 - cx) * (x + .5 - cx) + (y + .5 - cy) * (y + .5 - cy) > r * r) continue;
      const i = y * N + x, bit = 1 << (i & 7);
      if (!(b[i >> 3] & bit)) { b[i >> 3] |= bit; S._dirty = true; }
    }
}
export function flushBits(S) {
  if (S._bits && S._dirty) { let s = ''; for (let i = 0; i < S._bits.length; i++) s += String.fromCharCode(S._bits[i]); S.explored = btoa(s); S._dirty = false; return true; }
  return false;
}

/* ---------- Wege und Märsche ---------- */
export function planFrom(map, from, tx, ty, troops, S) {
  const total = sum(troops);
  if (total < 1) return { error: 'Keine Truppen ausgewählt' };
  const fc = forestCostFor(troops), speed = armySpeed(troops) * (S ? techMult(S, 'speed') : 1);
  const path = findPath(map, from[0], from[1], tx, ty, fc);
  if (!path) return { error: 'Es gibt keinen Weg dorthin' };
  const arr = pathTimes(map, path, speed, fc);
  return { path, arr, speed, fc, duration: arr[arr.length - 1], capacity: capacityOf(troops, S) };
}
export const planMarch = (map, S, obj, troops) => planFrom(map, S.pos, obj.x, obj.y, troops, S);

export function marchPos(m, gt) {
  const L = m.path.length - 1;
  if (m.phase === 'gather' || m.phase === 'post') { const [x, y] = cellXY(m.path[L]); return { x: x + .5, y: y + .5, i: L, frac: 0, still: true }; }
  const el = Math.max(0, Math.min(m.arr[L], gt - m.t0));
  let i = 0; while (i < L && m.arr[i + 1] <= el) i++;
  const [ax, ay] = cellXY(m.path[i]);
  if (i === L) return { x: ax + .5, y: ay + .5, i, frac: 0, still: false };
  const [bx, by] = cellXY(m.path[i + 1]), f = (el - m.arr[i]) / (m.arr[i + 1] - m.arr[i] || 1);
  return { x: ax + .5 + (bx - ax) * f, y: ay + .5 + (by - ay) * f, i, frac: f, still: false };
}
export const nextT = m => m.phase === 'post' ? Infinity : m.phase === 'gather' ? m.tEnd : m.t0 + m.arr[m.arr.length - 1];
export function reversed(m) {
  const L = m.arr.length - 1;
  m.path = m.path.slice().reverse();
  m.arr = m.arr.map((_, j) => m.arr[L] - m.arr[L - j]);
}
const tNow = ctx => ctx.bt != null ? ctx.bt : ctx.match.world.gt;
export function addTroops(S, t, sign) { for (const u in t) { S.troops[u] = (S.troops[u] || 0) + sign * t[u]; } }

// Neues Heer losschicken (die Truppen müssen schon aus S.troops nach S.away verbucht sein)
export function launch(ctx, owner, troops, plan, extra) {
  const w = ctx.match.world, S = owner.state;
  const m = { id: w.nextId++, owner: owner.id, name: owner.name, slot: S.slot, troops, phase: 'out', path: plan.path, arr: plan.arr, t0: tNow(ctx), load: {}, ...extra };
  w.marches.push(m); return m;
}
// Truppen, die schon "unterwegs" verbucht sind, vom Ort `from` nach Hause schicken
export function sendHome(ctx, owner, troops, from, tk, tid) {
  const w = ctx.match.world, S = owner.state;
  if (!sum(troops)) return null;
  const plan = planFrom(mapOf(ctx.match), from, S.pos[0], S.pos[1], troops, S);
  if (plan.error) { addTroops(S, troops, +1); for (const u in troops) { S.away[u] = (S.away[u] || 0) - troops[u]; if (S.away[u] <= 0) delete S.away[u]; } return null; }
  const m = { id: w.nextId++, owner: owner.id, name: owner.name, slot: S.slot, troops: { ...troops }, tk: tk || 'start', tid: tid || cityId(S), phase: 'back', mode: 'home', path: plan.path, arr: plan.arr, t0: tNow(ctx), load: {} };
  w.marches.push(m); return m;
}

/* ---------- Berichte, Meldungen, Chronik ---------- */
export function pushReport(S, rep, realT) {
  rep.id = S.nextRep++; rep.t = Math.round(realT); rep.read = false;
  S.reports.unshift(rep);
  if (S.reports.length > MAX_REPORTS) S.reports.length = MAX_REPORTS;
}
// Kurze Meldung an einen Spieler: erscheint in seiner Meldungsliste und wird vom Server als Push verschickt
export function note(ctx, pid, kind, title, body = '') {
  const p = byId(ctx.players, pid); if (!p) return;
  const S = ensureState(p.state);
  S.feed.unshift({ id: S.nextFeed++, t: Math.round(ctx.realT || ctx.now || Date.now()), kind, title, body });
  if (S.feed.length > MAX_FEED) S.feed.length = MAX_FEED;
  const m = ctx.match;
  if (!m._notes) Object.defineProperty(m, '_notes', { value: [], enumerable: false, writable: true });
  m._notes.push({ pid, kind, title, body });
}
export function takeNotes(match) {
  const n = match._notes || [];
  if (n.length) Object.defineProperty(match, '_notes', { value: [], enumerable: false, writable: true });
  return n;
}
export function chron(ctx, text) {
  const w = ctx.match.world;
  w.chron.unshift({ gt: Math.round(tNow(ctx)), text });
  if (w.chron.length > MAX_CHRON) w.chron.length = MAX_CHRON;
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  if (d) return d + ' T ' + h + ' Std.';
  if (h) return h + ' Std. ' + m + ' Min.';
  return Math.max(1, m) + ' Min.';
}

/* ---------- Bündnisse: Abfragen ---------- */
export function allianceOf(w, pid) {
  for (const id in w.alliances) if (w.alliances[id].members.includes(pid)) return w.alliances[id];
  return null;
}
export const groupOf = (w, pid) => { const a = allianceOf(w, pid); return a ? 'a' + a.id : 'p' + pid; };
export const allied = (w, a, b) => a !== b && !!allianceOf(w, a) && allianceOf(w, a) === allianceOf(w, b);
export function groupLabel(w, players, group) {
  if (group[0] === 'a') { const a = w.alliances[group.slice(1)]; return a ? a.name : 'Bündnis'; }
  const p = byId(players, Number(group.slice(1))); return p ? p.name : 'Spieler';
}
export function groupMembers(w, players, group) {
  if (group[0] === 'a') { const a = w.alliances[group.slice(1)]; return a ? players.filter(p => a.members.includes(p.id)) : []; }
  const p = byId(players, Number(group.slice(1))); return p ? [p] : [];
}

/* ---------- Verluste verbuchen ---------- */
// Verluste eines ausgesendeten Heeres: 30 % der Gefallenen kommen verwundet ins Lazarett, solange Platz ist
export function settleAway(S, start, left) {
  const lost = {}, wounded = {}, dead = {};
  for (const u in start) {
    const l = start[u] - (left[u] || 0); if (l <= 0) continue;
    lost[u] = l; const wd = U[u] && U[u].g === 'trans' ? 0 : Math.round(l * 0.3);   // Karren werden nicht verwundet
    const room = Math.max(0, lazarettCap(S) - woundedCount(S) - sum(wounded));
    const keep = Math.min(wd, room);
    if (keep > 0) wounded[u] = keep;
    dead[u] = l - keep;
    S.away[u] = (S.away[u] || 0) - l; if (S.away[u] <= 0) delete S.away[u];
  }
  for (const u in wounded) S.wounded[u] = (S.wounded[u] || 0) + wounded[u];
  S.stats.lost += sum(lost);
  return { lost, wounded, dead };
}
// Verluste der Truppen, die zu Hause stehen
export function settleHome(S, lost) {
  const wounded = {}, dead = {};
  for (const u in lost) {
    const l = Math.min(lost[u], S.troops[u] || 0); if (l <= 0) continue;
    S.troops[u] -= l;
    const room = Math.max(0, lazarettCap(S) - woundedCount(S) - sum(wounded));
    const keep = Math.min(Math.round(l * 0.3), room);
    if (keep > 0) wounded[u] = keep;
    dead[u] = l - keep;
  }
  for (const u in wounded) S.wounded[u] = (S.wounded[u] || 0) + wounded[u];
  S.stats.lost += sum(lost);
  return { wounded, dead };
}

// Spieler aus seinem Bündnis nehmen (Führung wechselt, leere Bündnisse verschwinden)
export function removeMember(ctx, pid) {
  const w = ctx.match.world, a = allianceOf(w, pid); if (!a) return null;
  a.members = a.members.filter(x => x !== pid);
  w.pending = w.pending.filter(p => !(p.al === a.id && p.pid === pid));
  if (!a.members.length) { delete w.alliances[a.id]; w.pending = w.pending.filter(p => p.al !== a.id); chron(ctx, 'Das Bündnis „' + a.name + '“ hat sich aufgelöst.'); }
  else if (a.leader === pid) a.leader = a.members[0];
  return a;
}
// Gehaltene Orte wechseln die Gruppe mit, wenn ihr Halter ein Bündnis gründet oder beitritt
export function regroup(w, from, to) { for (const id in w.holds) if (w.holds[id].group === from) w.holds[id].group = to; }
