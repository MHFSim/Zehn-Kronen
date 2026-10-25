// Zehn Kronen – Weltkarte: Märsche, Sammeln, Kämpfe, Berichte.
// Läuft auf dem Server (maßgeblich) und in der Testversion im Browser. Die Spielzeit der Welt läuft
// in "Spielsekunden" (gt); echte Zeit * Tempo = Spielzeit. Alle Ereignisse werden in zeitlicher
// Reihenfolge abgearbeitet, egal wann ein Spieler das nächste Mal nachfragt.
import { N, generateMap, findPath, pathTimes, NODE_RES, NODE_MAX, NODE_KINDS, cellOf, startSpot, SLOTS } from './mapgen.js';
import { U, B, RES, freshState, advanceTo, applyCommand, armySlots, lazarettCap, woundedCount } from './rules.js';

export const PLAYER_COLORS = ['#c8372d', '#2f6fd1', '#e2b02e', '#3f9d4c', '#8a4bc4', '#e0782b', '#27a7a1', '#d9609c', '#9aa5b1', '#b9d03a'];
export const NODE_REGEN = 0.01;          // Anteil des Höchstvorrats pro Spielstunde
export const CAMP_RESPAWN = 6 * 3600;    // Spielsekunden bis ein Lager wiederkommt
export const GATHER_FULL = 2 * 3600;     // Spielsekunden, bis ein Heer seine volle Traglast gesammelt hat
export const VIEW_CITY = 11, VIEW_ARMY = 6;
const MAX_REPORTS = 25;

/* ---------- Zustand ---------- */
export function newWorld(now) { return { gt: 0, at: now, nodes: {}, camps: {}, ruins: {}, marches: [], nextId: 1 }; }
export function mapOf(match) { return generateMap(match.seed); }
export function ensureState(S) {
  S.away = S.away || {}; S.wounded = S.wounded || {}; S.reports = S.reports || []; S.nextRep = S.nextRep || 1;
  S.explored = S.explored || ''; if (S.slot == null) S.slot = -1; S.pos = S.pos || [0, 0];
  return S;
}
export const cellXY = c => { const x = c % N; return [x, (c - x) / N]; };

/* ---------- Nebel des Krieges: besucht-Bits ---------- */
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

/* ---------- Felder und Lager ---------- */
export function nodeLeft(w, o, gt) {
  const max = NODE_MAX(o.lv), n = w.nodes[o.id];
  if (!n) return max;
  return Math.min(max, n.left + max * NODE_REGEN * Math.max(0, gt - n.t) / 3600);
}
export const campAlive = (w, id, gt) => !(w.camps[id] && w.camps[id].dead > gt);
export function campTroops(lv) {
  const total = Math.round(8 + 3 * lv * lv);
  const mix = lv >= 7 ? { speer: .25, schwert: .25, bogen: .2, leicht: .15, schwer: .15 }
    : lv >= 4 ? { speer: .3, schwert: .3, bogen: .25, leicht: .15 } : { speer: .4, schwert: .35, bogen: .25 };
  const t = {}; for (const u in mix) t[u] = Math.max(1, Math.round(total * mix[u]));
  return t;
}
export const campMult = lv => 1 + 0.10 * (lv - 1);
export const campLoot = lv => ({ food: 300 * lv, wood: 300 * lv, stone: 200 * lv, ore: 150 * lv, gold: 20 * lv });

/* ---------- Kampf ---------- */
const COUNTERS = { speer: ['leicht', 'schwer'], schwert: ['speer'], bogen: ['speer', 'schwert'], leicht: ['bogen'], schwer: ['schwert', 'bogen'] };
export const countersOf = (a, d) => COUNTERS[a].includes(d);
const KAMPF = 0.5, RUNDEN = 10;
const grp = (t, m) => Object.keys(t).filter(u => t[u] > 0).map(u => ({ u, n: t[u], a: U[u].a * m, v: U[u].v * m, l: U[u].l * m }));
const hp = G => G.reduce((s, g) => s + g.n * g.l, 0);
export function battle(attT, defT, defMult = 1) {
  const A = grp(attT, 1), D = grp(defT, defMult), rounds = [];
  const snap = G => { const o = {}; G.forEach(g => o[g.u] = Math.round(g.n)); return o; };
  for (let r = 0; r < RUNDEN; r++) {
    const hA = hp(A), hD = hp(D);
    if (hA < 0.5 || hD < 0.5) break;
    const toA = A.map(() => 0), toD = D.map(() => 0);
    for (const g of A) D.forEach((h, j) => { toD[j] += g.n * g.a * KAMPF * (countersOf(g.u, h.u) ? 1.5 : 1) * (h.n * h.l / hD) * (20 / (20 + h.v)); });
    for (const g of D) A.forEach((h, j) => { toA[j] += g.n * g.a * KAMPF * (countersOf(g.u, h.u) ? 1.5 : 1) * (h.n * h.l / hA) * (20 / (20 + h.v)); });
    A.forEach((h, j) => { h.n = Math.max(0, h.n - toA[j] / h.l); });
    D.forEach((h, j) => { h.n = Math.max(0, h.n - toD[j] / h.l); });
    rounds.push({ a: snap(A), d: snap(D) });
  }
  const left = G => { const o = {}; G.forEach(g => { const n = Math.round(g.n); if (n > 0) o[g.u] = n; }); return o; };
  const attLeft = left(A), defLeft = left(D);
  return { win: Object.keys(defLeft).length === 0 && Object.keys(attLeft).length > 0, attLeft, defLeft, rounds };
}
export const power = (t, m = 1) => grp(t, m).reduce((s, g) => s + g.n * (g.a + g.v * 0.5 + g.l * 0.3), 0);

/* ---------- Wege und Zeiten ---------- */
export const forestCostFor = troops => (troops.leicht > 0 || troops.schwer > 0) ? 1.7 : 1.2;
export const armySpeed = troops => Math.min(...Object.keys(troops).filter(u => troops[u] > 0).map(u => U[u].s));
export const capacityOf = troops => Object.keys(troops).reduce((s, u) => s + troops[u] * U[u].c, 0);
export const sum = t => Object.values(t).reduce((a, b) => a + b, 0);

export function planMarch(map, S, obj, troops) {
  const total = sum(troops);
  if (total < 1) return { error: 'Keine Truppen ausgewählt' };
  const fc = forestCostFor(troops), speed = armySpeed(troops);
  const path = findPath(map, S.pos[0], S.pos[1], obj.x, obj.y, fc);
  if (!path) return { error: 'Es gibt keinen Weg dorthin' };
  const arr = pathTimes(map, path, speed, fc);
  return { path, arr, speed, fc, duration: arr[arr.length - 1], capacity: capacityOf(troops) };
}

export function marchPos(m, gt) {
  const L = m.path.length - 1;
  if (m.phase === 'gather') { const [x, y] = cellXY(m.path[L]); return { x: x + .5, y: y + .5, i: L, frac: 0, still: true }; }
  const el = Math.max(0, Math.min(m.arr[L], gt - m.t0));
  let i = 0; while (i < L && m.arr[i + 1] <= el) i++;
  const [ax, ay] = cellXY(m.path[i]);
  if (i === L) return { x: ax + .5, y: ay + .5, i, frac: 0, still: false };
  const [bx, by] = cellXY(m.path[i + 1]), f = (el - m.arr[i]) / (m.arr[i + 1] - m.arr[i] || 1);
  return { x: ax + .5 + (bx - ax) * f, y: ay + .5 + (by - ay) * f, i, frac: f, still: false };
}
const nextT = m => m.phase === 'gather' ? m.tEnd : m.t0 + m.arr[m.arr.length - 1];
function reversed(m) {
  const L = m.arr.length - 1;
  m.path = m.path.slice().reverse();
  m.arr = m.arr.map((_, j) => m.arr[L] - m.arr[L - j]);
}

/* ---------- Berichte ---------- */
function pushReport(S, rep, realT) {
  rep.id = S.nextRep++; rep.t = Math.round(realT); rep.read = false;
  S.reports.unshift(rep);
  if (S.reports.length > MAX_REPORTS) S.reports.length = MAX_REPORTS;
}
function addTroops(S, t, sign) { for (const u in t) { S.troops[u] = (S.troops[u] || 0) + sign * t[u]; } }

/* ---------- Ereignisse ---------- */
function onArrive(match, players, m, bt, realT) {
  const w = match.world, map = mapOf(match), o = map.byId[m.tid];
  const p = players.find(x => x.id === m.owner);
  if (!p) { m.dead = true; return; }
  const S = p.state;
  advanceTo(S, realT, match.speed);
  const info = { kind: o.k, id: o.id, lv: o.lv, x: o.x, y: o.y };
  const back = () => { m.phase = 'back'; m.t0 = bt; reversed(m); };
  if (NODE_KINDS.includes(o.k)) {
    const left = nodeLeft(w, o, bt), cap = capacityOf(m.troops), amount = Math.floor(Math.min(cap, left));
    if (amount < 50) {
      pushReport(S, { kind: 'gather', title: 'Feld erschöpft', win: false, target: info, text: 'Das Feld ist fast leer. Das Heer kehrt ohne Beute zurück.' }, realT);
      return back();
    }
    w.nodes[o.id] = { left: left, t: bt };
    m.phase = 'gather'; m.tStart = bt; m.tEnd = bt + GATHER_FULL * amount / cap; m.amount = amount; m.res = NODE_RES[o.k];
    return;
  }
  if (o.k === 'camp') {
    if (!campAlive(w, o.id, bt)) {
      pushReport(S, { kind: 'camp', title: 'Lager bereits zerstört', win: false, target: info, text: 'Hier war schon jemand schneller. Das Lager baut sich in einigen Stunden wieder auf.' }, realT);
      return back();
    }
    const def = campTroops(o.lv), start = { ...m.troops };
    const r = battle(m.troops, def, campMult(o.lv));
    const lost = {}, wounded = {}, dead = {};
    for (const u in start) {
      const l = start[u] - (r.attLeft[u] || 0); if (l <= 0) continue;
      lost[u] = l; const wd = Math.round(l * 0.3);
      const room = Math.max(0, lazarettCap(S) - woundedCount(S) - Object.values(wounded).reduce((a, b) => a + b, 0));
      const keep = Math.min(wd, room);
      if (keep > 0) wounded[u] = keep;
      dead[u] = l - keep;
      S.away[u] = (S.away[u] || 0) - l; if (S.away[u] <= 0) delete S.away[u];
    }
    for (const u in wounded) S.wounded[u] = (S.wounded[u] || 0) + wounded[u];
    const rep = { kind: 'camp', title: (r.win ? 'Sieg über Banditenlager Stufe ' : 'Niederlage vor Banditenlager Stufe ') + o.lv, win: r.win, target: info,
      att: { start, left: r.attLeft, wounded, dead }, def: { start: def, left: r.defLeft }, rounds: r.rounds };
    m.troops = r.attLeft;
    if (r.win) { const loot = campLoot(o.lv); m.load = loot; rep.loot = loot; w.camps[o.id] = { dead: bt + CAMP_RESPAWN }; }
    pushReport(S, rep, realT);
    if (!Object.keys(m.troops).length) { m.dead = true; return; }
    return back();
  }
  if (o.k === 'ruin') {
    if (w.ruins[o.id]) { pushReport(S, { kind: 'ruin', title: 'Ruine bereits geplündert', win: false, target: info, text: 'Hier gibt es nichts mehr zu holen.' }, realT); return back(); }
    w.ruins[o.id] = 1;
    const loot = { food: 200 * o.lv, wood: 200 * o.lv, stone: 300 * o.lv, ore: 300 * o.lv, gold: 150 * o.lv };
    m.load = loot;
    pushReport(S, { kind: 'ruin', title: 'Ruine erkundet', win: true, target: info, loot, text: 'Zwischen den alten Mauern lagen noch Vorräte.' }, realT);
    return back();
  }
  back();
}
function onGatherEnd(match, players, m, bt, realT) {
  const w = match.world, o = mapOf(match).byId[m.tid], p = players.find(x => x.id === m.owner);
  if (!p) { m.dead = true; return; }
  advanceTo(p.state, realT, match.speed);
  const n = w.nodes[o.id] || { left: nodeLeft(w, o, bt), t: bt };
  w.nodes[o.id] = { left: Math.max(0, n.left - m.amount), t: bt };
  m.load = { [m.res]: m.amount };
  m.phase = 'back'; m.t0 = bt; reversed(m);
}
function onHome(match, players, m, bt, realT) {
  const p = players.find(x => x.id === m.owner); m.dead = true;
  if (!p) return;
  const S = p.state; advanceTo(S, realT, match.speed);
  addTroops(S, m.troops, +1);
  for (const u in m.troops) { S.away[u] = (S.away[u] || 0) - m.troops[u]; if (S.away[u] <= 0) delete S.away[u]; }
  const load = m.load || {};
  for (const r of Object.keys(load)) S.res[r] = (S.res[r] || 0) + load[r];
  if (Object.keys(load).length) pushReport(S, { kind: 'return', title: 'Heer zurück mit Beute', win: true, loot: load, target: { kind: m.tk, id: m.tid } }, realT);
}

/* ---------- Abgleich der ganzen Partie ---------- */
export function syncMatch(match, players, now) {
  if (!match.world) match.world = newWorld(now);
  const w = match.world, speed = match.speed, target = w.gt + Math.max(0, now - w.at) / 1000 * speed;
  let events = 0;
  for (let guard = 0; guard < 5000; guard++) {
    let best = null, bt = Infinity;
    for (const m of w.marches) { if (m.dead) continue; const t = nextT(m); if (t < bt) { bt = t; best = m; } }
    if (!best || bt > target) break;
    const realT = w.at + (bt - w.gt) / speed * 1000;
    if (best.phase === 'out') onArrive(match, players, best, bt, realT);
    else if (best.phase === 'gather') onGatherEnd(match, players, best, bt, realT);
    else onHome(match, players, best, bt, realT);
    events++;
    if (best.dead) w.marches = w.marches.filter(m => m !== best);
  }
  w.gt = target; w.at = now;
  const map = mapOf(match);
  for (const p of players) {
    ensureState(p.state);
    advanceTo(p.state, now, speed);
    if (p.state.slot >= 0) reveal(p.state, p.state.pos[0] + .5, p.state.pos[1] + .5, VIEW_CITY);
  }
  for (const m of w.marches) {
    const p = players.find(x => x.id === m.owner); if (!p) continue;
    const pos = marchPos(m, w.gt);
    reveal(p.state, pos.x, pos.y, VIEW_ARMY);
  }
  for (const p of players) flushBits(p.state);
  return { events };
}

/* ---------- Spieler und Befehle ---------- */
export function addPlayer(match, players, id, name, now) {
  syncMatch(match, players, now);
  const used = new Set(players.map(p => p.state.slot));
  let slot = -1; for (let i = 0; i < SLOTS; i++) if (!used.has(i)) { slot = i; break; }
  if (slot < 0) return null;
  const S = ensureState(freshState(now)); S.slot = slot; S.pos = startSpot(slot);
  reveal(S, S.pos[0] + .5, S.pos[1] + .5, VIEW_CITY); flushBits(S);
  return S;
}
export function setSpeed(match, players, speed, now) { syncMatch(match, players, now); match.speed = speed; }

export function command(match, players, player, cmd, now) {
  syncMatch(match, players, now);
  const S = player.state, w = match.world;
  if (!cmd || typeof cmd !== 'object') return 'Ungültiger Befehl';
  if (cmd.type === 'march') {
    const map = mapOf(match), o = map.byId[String(cmd.target)];
    if (!o || !(NODE_KINDS.includes(o.k) || o.k === 'camp' || o.k === 'ruin')) return 'Dieses Ziel gibt es nicht';
    if (w.marches.filter(m => m.owner === player.id).length >= armySlots(S)) return 'Alle Heere sind unterwegs (' + armySlots(S) + ')';
    const troops = {};
    for (const u of Object.keys(U)) {
      const n = Math.floor(Number((cmd.troops || {})[u] || 0));
      if (n < 0 || !Number.isFinite(n)) return 'Ungültige Truppenzahl';
      if (n > (S.troops[u] || 0)) return 'So viele ' + U[u].name + ' hast du nicht zu Hause';
      if (n > 0) troops[u] = n;
    }
    if (o.k === 'camp' && !campAlive(w, o.id, w.gt)) return 'Dieses Lager ist gerade zerstört';
    if (o.k === 'ruin' && w.ruins[o.id]) return 'Diese Ruine ist schon geplündert';
    if (NODE_KINDS.includes(o.k) && nodeLeft(w, o, w.gt) < 50) return 'Dieses Feld ist erschöpft';
    const plan = planMarch(map, S, o, troops);
    if (plan.error) return plan.error;
    for (const u in troops) { S.troops[u] -= troops[u]; S.away[u] = (S.away[u] || 0) + troops[u]; }
    w.marches.push({ id: w.nextId++, owner: player.id, name: player.name, slot: S.slot, troops, tk: o.k, tid: o.id, phase: 'out', path: plan.path, arr: plan.arr, t0: w.gt, load: {} });
    syncMatch(match, players, now);
    return '';
  }
  if (cmd.type === 'recall') {
    const m = w.marches.find(x => x.id === Number(cmd.id) && x.owner === player.id);
    if (!m) return 'Dieses Heer gibt es nicht';
    if (m.phase === 'back') return 'Das Heer ist schon auf dem Rückweg';
    if (m.phase === 'gather') {
      const o = mapOf(match).byId[m.tid], frac = Math.max(0, Math.min(1, (w.gt - m.tStart) / (m.tEnd - m.tStart || 1)));
      const amount = Math.floor(m.amount * frac), n = w.nodes[o.id] || { left: nodeLeft(w, o, w.gt), t: w.gt };
      w.nodes[o.id] = { left: Math.max(0, n.left - amount), t: w.gt };
      m.load = amount > 0 ? { [m.res]: amount } : {};
      m.phase = 'back'; m.t0 = w.gt; reversed(m);
    } else {
      const el = Math.max(0, w.gt - m.t0); let i = 0; while (i < m.path.length - 1 && m.arr[i + 1] <= el) i++;
      const a0 = m.arr[i]; m.path = m.path.slice(0, i + 1).reverse(); m.arr = m.arr.slice(0, i + 1).map((_, j, A) => a0 - m.arr[i - j]);
      m.phase = 'back'; m.t0 = w.gt; m.load = {};
      if (m.path.length < 2) { m.path = [m.path[0], m.path[0]]; m.arr = [0, 1]; }
    }
    return '';
  }
  if (cmd.type === 'readReports') { S.reports.forEach(r => { r.read = true; }); return ''; }
  return applyCommand(S, cmd);
}

/* ---------- Sicht für einen Spieler ---------- */
export function viewFor(match, players, me, now) {
  const w = match.world, S = me.state, gt = w.gt;
  const sees = (x, y) => {
    if ((x - S.pos[0] - .5) ** 2 + (y - S.pos[1] - .5) ** 2 <= VIEW_CITY * VIEW_CITY) return true;
    return w.marches.some(m => m.owner === me.id && (() => { const p = marchPos(m, gt); return (x - p.x) ** 2 + (y - p.y) ** 2 <= VIEW_ARMY * VIEW_ARMY; })());
  };
  const marches = [];
  for (const m of w.marches) {
    const own = m.owner === me.id, p = marchPos(m, gt);
    if (!own && !sees(p.x, p.y)) continue;
    marches.push({ id: m.id, owner: m.owner, name: m.name, slot: m.slot, own, phase: m.phase, troops: own ? m.troops : { n: sum(m.troops) },
      tk: m.tk, tid: m.tid, path: m.path, arr: m.arr, t0: m.t0, tStart: m.tStart, tEnd: m.tEnd, amount: m.amount, res: m.res, load: own ? m.load : undefined });
  }
  const nodes = {}, map = mapOf(match);
  for (const id in w.nodes) nodes[id] = Math.floor(nodeLeft(w, map.byId[id], gt));
  const camps = {}; for (const id in w.camps) if (w.camps[id].dead > gt) camps[id] = w.camps[id].dead;
  return {
    now, me: { id: me.id, name: me.name, slot: S.slot },
    match: { name: match.name, speed: match.speed, seed: match.seed, players: players.map(p => ({ id: p.id, name: p.name, slot: p.state.slot, pos: p.state.pos, rathaus: p.state.lv.rathaus })) },
    state: S,
    world: { gt, at: w.at, nodes, camps, ruins: w.ruins, marches }
  };
}
