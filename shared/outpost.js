// Zehn Kronen – Revier und Außenposten (wie die Vierecke in Rise of Kingdoms).
// Jede Burg beansprucht ein Viereck, jeder Außenposten ebenfalls. Neue Außenposten müssen das Revier der eigenen
// Gruppe (allein oder Bündnis) berühren und dürfen kein fremdes Revier überlappen. Heiligtümer und der Thron
// können nur besetzt werden, wenn ein Viereck der Gruppe sie berührt. Gegner können Außenposten zerstören.
import { N } from './mapgen.js';
import { battle, sum, forceOf } from './combat.js';
import {
  mapOf, byId, groupOf, groupLabel, groupMembers, allied, isProtected, pushReport, note, chron, settleAway, sendHome, fmtDur, allianceOf
} from './core.js';
import { advanceTo, RES } from './rules.js';

/* ---------- Regeln ---------- */
export const OP_R = [0, 4, 6, 8];                         // Halbe Seitenlänge je Stufe: 9×9, 13×13, 17×17 Felder
export const OP_MAX_LV = 3;
export const OP_BUILD = [0, 2 * 3600, 6 * 3600, 12 * 3600];   // Bau- und Ausbauzeit in Spielsekunden
export const OP_MIN_TROOPS = 50;                           // so viele Truppen braucht ein Bautrupp
export const opCost = lv => [200, 500, 600, 100].map(c => c * lv);   // Nahrung, Holz, Stein, Erz
export const maxOutposts = S => 2 + Math.floor(S.lv.rathaus / 2);
export const cityR = rathaus => 3 + Math.ceil(rathaus / 3);
// Wachen eines Außenpostens, die auch ohne Besatzung dort stehen
export const opGuard = lv => ({ troops: { speer: 20 * lv, bogen: 15 * lv }, mult: 1 + 0.2 * lv });
export const OP_NAME = 'Außenposten';

export const opLv = (o, gt) => o.upg && gt >= o.upg.done ? o.upg.to : o.lv;
export const opReady = (o, gt) => gt >= o.done;

/* ---------- Vierecke ---------- */
// cities: [{ pid, x, y, rathaus, group }], ops: [{ id, owner, x, y, lv, done, upg, group }]. Rein rechnerisch, läuft auch im Browser.
export function rectsOf(cities, ops, gt) {
  const out = [];
  for (const c of cities) { const r = cityR(c.rathaus); out.push({ k: 'city', id: 'c' + c.pid, owner: c.pid, group: c.group, x: c.x, y: c.y, r, x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r, ready: true }); }
  for (const o of ops) { const lv = opLv(o, gt), r = OP_R[lv]; out.push({ k: 'op', id: o.id, owner: o.owner, group: o.group, x: o.x, y: o.y, r, lv, x0: o.x - r, y0: o.y - r, x1: o.x + r, y1: o.y + r, ready: opReady(o, gt) }); }
  return out;
}
const overlaps = (a, b, pad = 0) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;
// Berührt ein fertiges Viereck der Gruppe das Feld (tx, ty)? (auch schräg angrenzend)
export const touches = (rects, group, tx, ty) => rects.some(r => r.ready && r.group === group && tx >= r.x0 - 1 && tx <= r.x1 + 1 && ty >= r.y0 - 1 && ty <= r.y1 + 1);

// Städte und Außenposten einer laufenden Partie
export function territory(match, players, gt) {
  const w = match.world, cities = [], ops = [];
  for (const p of players) if (!p.state.out && p.state.slot >= 0) cities.push({ pid: p.id, x: p.state.pos[0], y: p.state.pos[1], rathaus: p.state.lv.rathaus, group: groupOf(w, p.id) });
  for (const id in (w.outposts || {})) { const o = w.outposts[id]; ops.push({ ...o, group: groupOf(w, o.owner) }); }
  return rectsOf(cities, ops, gt);
}

/* ---------- Bauplatz prüfen ---------- */
// Gibt '' zurück, wenn dort (x, y) ein Außenposten der Stufe lv stehen darf, sonst den Grund.
// own = true, wenn es um den Ausbau eines vorhandenen Außenpostens geht (self = dessen Kennung).
export function checkSite(match, players, me, x, y, lv, gt, self) {
  const map = mapOf(match), w = match.world;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 3 || y < 3 || x > N - 4 || y > N - 4) return 'Dort kann nicht gebaut werden.';
  if (!map.pass[y * N + x]) return 'Auf Wasser und Fels kann man nicht bauen.';
  if (map.objects.some(o => Math.abs(o.x - x) <= 1 && Math.abs(o.y - y) <= 1)) return 'Zu nah an einem anderen Ort. Such dir ein freies Feld.';
  const group = groupOf(w, me.id), nr = { x0: x - OP_R[lv], y0: y - OP_R[lv], x1: x + OP_R[lv], y1: y + OP_R[lv] };
  const rects = territory(match, players, gt).filter(r => r.id !== self);
  for (const r of rects) {
    if (r.group !== group && overlaps(nr, r)) return 'Das Viereck würde das Revier von ' + groupLabel(w, players, r.group) + ' überlappen.';
    if (r.k === 'op' && r.x === x && r.y === y) return 'Hier steht schon ein Außenposten.';
  }
  if (!rects.some(r => r.ready && r.group === group && overlaps(nr, r, 1))) return 'Ein Außenposten muss dein Revier oder das deines Bündnisses berühren.';
  return '';
}
export const ownOutposts = (w, pid) => Object.values(w.outposts || {}).filter(o => o.owner === pid);

/* ---------- Befehle des Besitzers ---------- */
export function checkBuild(match, players, me, x, y, troops, gt) {
  const S = me.state, w = match.world;
  if (sum(troops) < OP_MIN_TROOPS) return 'Für einen Außenposten brauchst du mindestens ' + OP_MIN_TROOPS + ' Truppen als Besatzung.';
  if (ownOutposts(w, me.id).length >= maxOutposts(S)) return 'Du kannst höchstens ' + maxOutposts(S) + ' Außenposten halten (wächst mit dem Rathaus).';
  const why = checkSite(match, players, me, x, y, 1, gt); if (why) return why;
  return '';
}
export function upgradeOutpost(ctx, me, id) {
  const { match, players } = ctx, w = match.world, S = me.state, o = (w.outposts || {})[id], gt = w.gt;
  if (!o || o.owner !== me.id) return 'Diesen Außenposten gibt es nicht.';
  if (!opReady(o, gt)) return 'Der Außenposten ist noch im Bau.';
  settle(w, gt);
  if (o.upg) return 'Er wird schon ausgebaut.';
  if (o.lv >= OP_MAX_LV) return 'Er hat schon die höchste Stufe.';
  const to = o.lv + 1, cost = opCost(to);
  const why = checkSite(match, players, me, o.x, o.y, to, gt, o.id); if (why) return why;
  if (RES.some((r, i) => S.res[r] < cost[i])) return 'Nicht genug Rohstoffe.';
  RES.forEach((r, i) => { S.res[r] -= cost[i]; });
  o.upg = { to, done: gt + OP_BUILD[to] };
  return '';
}
export function recallGarrison(ctx, me, id) {
  const w = ctx.match.world, o = (w.outposts || {})[id];
  if (!o || o.owner !== me.id) return 'Diesen Außenposten gibt es nicht.';
  if (!sum(o.garr)) return 'Dort steht keine Besatzung.';
  const t = o.garr; o.garr = {}; sendHome(ctx, me, t, [o.x, o.y], 'outpost', o.id); return '';
}
export function dismantle(ctx, me, id) {
  const w = ctx.match.world, o = (w.outposts || {})[id];
  if (!o || o.owner !== me.id) return 'Diesen Außenposten gibt es nicht.';
  const t = o.garr; delete w.outposts[id];
  if (sum(t)) sendHome(ctx, me, t, [o.x, o.y], 'outpost', o.id);
  chron(ctx, me.name + ' gibt einen Außenposten auf.');
  return '';
}
// Außenposten eines ausgeschiedenen oder entfernten Spielers verschwinden (die Besatzung ist dann schon weg)
export function removeOutposts(w, pid) { for (const id in (w.outposts || {})) if (w.outposts[id].owner === pid) delete w.outposts[id]; }

/* ---------- Ankunft: Bauen, Verstärken, Angreifen ---------- */
export function arriveBuild(ctx, m, bt, realT, back) {
  const { match, players } = ctx, w = match.world, A = byId(players, m.owner), S = A.state, { x, y } = m.site;
  const info = { kind: 'outpost', id: m.tid, x, y };
  const refund = () => { const c = opCost(1); RES.forEach((r, i) => { S.res[r] += c[i]; }); };
  let why = checkSite(match, players, A, x, y, 1, bt);
  if (!why && ownOutposts(w, A.id).length >= maxOutposts(S)) why = 'Du hast schon so viele Außenposten, wie dein Rathaus erlaubt.';
  if (why) { refund(); pushReport(S, { kind: 'outpost', title: 'Bau nicht möglich', win: false, target: info, text: why + ' Das Heer kehrt zurück, die Rohstoffe sind erstattet.' }, realT); return back(); }
  const id = 'op' + (w.nextOp = (w.nextOp || 1)), o = { id, owner: A.id, x, y, lv: 1, done: bt + OP_BUILD[1], upg: null, garr: { ...m.troops } };
  w.nextOp++; w.outposts[id] = o; m.dead = true;
  pushReport(S, { kind: 'outpost', title: 'Außenposten wird gebaut', win: true, target: { ...info, id }, text: 'Dein Bautrupp (' + sum(m.troops) + ' Truppen) bleibt als Besatzung dort. In ' + fmtDur(OP_BUILD[1] / match.speed) + ' ist der Außenposten fertig und sein Revier gehört dir.' }, realT);
  const al = allianceOf(w, A.id);
  if (al) for (const pid of al.members) if (pid !== A.id) note(ctx, pid, 'ally', 'Neuer Außenposten', A.name + ' baut einen Außenposten und vergrößert euer Revier.');
}
export function arriveGarrison(ctx, m, bt, realT, back) {
  const w = ctx.match.world, A = byId(ctx.players, m.owner), o = (w.outposts || {})[m.tid];
  if (!o || o.owner !== A.id) { pushReport(A.state, { kind: 'outpost', title: 'Außenposten nicht mehr da', win: false, target: { kind: 'outpost', id: m.tid }, text: 'Das Heer kehrt um.' }, realT); return back(); }
  for (const u in m.troops) o.garr[u] = (o.garr[u] || 0) + m.troops[u];
  m.dead = true;
  pushReport(A.state, { kind: 'outpost', title: 'Besatzung verstärkt', win: true, target: { kind: 'outpost', id: o.id, x: o.x, y: o.y }, text: 'Deine Truppen verstärken den Außenposten.' }, realT);
}
// Angriff auf einen fremden Außenposten
export function checkRaid(ctx, me, o) {
  const { players } = ctx, w = ctx.match.world;
  if (o.owner === me.id) return 'Das ist dein eigener Außenposten.';
  if (allied(w, me.id, o.owner)) return 'Verbündete kannst du nicht angreifen.';
  const D = byId(players, o.owner); if (!D || D.state.out) return 'Dieser Außenposten hat keinen Besitzer mehr.';
  if (isProtected(D.state, w.gt)) return 'Dieser Spieler steht noch unter Schutz.';
  if ((me.state.exAllies[o.owner] || 0) > w.gt) return 'Dein früheres Bündnis mit diesem Spieler ist noch zu frisch.';
  return '';
}
export function arriveRaid(ctx, m, bt, realT, back) {
  const { match, players } = ctx, w = match.world, A = byId(players, m.owner), o = (w.outposts || {})[m.tid];
  const info = { kind: 'outpost', id: m.tid, x: o ? o.x : 0, y: o ? o.y : 0 };
  if (!o) { pushReport(A.state, { kind: 'outpost', role: 'att', title: 'Außenposten nicht mehr da', win: false, target: info, text: 'Hier steht nichts mehr. Das Heer kehrt um.' }, realT); return back(); }
  const D = byId(players, o.owner);
  if (!D || D.state.out || allied(w, A.id, D.id) || isProtected(D.state, bt)) { pushReport(A.state, { kind: 'outpost', role: 'att', title: 'Angriff abgebrochen', win: false, target: info, text: 'Der Außenposten kann nicht mehr angegriffen werden. Das Heer kehrt um.' }, realT); return back(); }
  advanceTo(D.state, realT, match.speed);
  settle(w, bt);
  const lv = opLv(o, bt), g = opGuard(lv), ready = opReady(o, bt), def = { ...g.troops };
  for (const u in o.garr) def[u] = (def[u] || 0) + o.garr[u];
  const mult = (ready ? g.mult : 1) * forceOf(D.state), startA = { ...m.troops };
  const r = battle(m.troops, def, mult, forceOf(A.state)), sa = settleAway(A.state, startA, r.attLeft);
  m.troops = r.attLeft; A.state.stats.kills += sum(def) - sum(r.defLeft); if (r.win) A.state.stats.wins++;
  const place = 'Außenposten von ' + D.name;
  if (r.win) {
    const sd = settleAway(D.state, o.garr, {}); delete w.outposts[o.id];
    const spoil = opCost(lv).map(c => Math.floor(c * 0.3)), load = {}; RES.forEach((res, i) => { if (spoil[i] > 0) load[res] = spoil[i]; }); m.load = load;
    chron(ctx, A.name + ' hat einen Außenposten von ' + D.name + ' zerstört.');
    note(ctx, D.id, 'attack', 'Außenposten zerstört', A.name + ' hat deinen Außenposten zerstört. Du hast ' + sum(o.garr) + ' Truppen verloren (' + sum(sd.wounded) + ' verwundet).');
    for (const p of groupMembers(w, players, groupOf(w, D.id))) if (p.id !== D.id) note(ctx, p.id, 'attack', 'Außenposten eures Bündnisses zerstört', A.name + ' hat einen Außenposten von ' + D.name + ' zerstört. Euer Revier ist kleiner geworden.');
    pushReport(D.state, { kind: 'outpost', role: 'def', title: 'Außenposten zerstört', win: false, target: info, att: { start: startA, left: r.attLeft }, def: { start: def, left: r.defLeft }, defLabel: 'Außenposten', rounds: r.rounds, text: A.name + ' hat deinen Außenposten zerstört.' }, realT);
    pushReport(A.state, { kind: 'outpost', role: 'att', title: 'Sieg: ' + place + ' zerstört', win: true, target: info, loot: load, att: { start: startA, left: r.attLeft, wounded: sa.wounded, dead: sa.dead }, def: { start: def, left: r.defLeft }, defLabel: 'Außenposten', rounds: r.rounds, text: 'Das Revier ist verschwunden.' }, realT);
  } else {
    const frac = {}; for (const u in def) frac[u] = def[u] ? 1 - (r.defLeft[u] || 0) / def[u] : 0;
    const left = {}; for (const u in o.garr) { const n = o.garr[u] - Math.round(o.garr[u] * (frac[u] || 0)); if (n > 0) left[u] = n; }
    settleAway(D.state, o.garr, left); o.garr = left;
    note(ctx, D.id, 'battle', 'Außenposten verteidigt', A.name + ' hat deinen Außenposten angegriffen und wurde zurückgeschlagen.');
    pushReport(D.state, { kind: 'outpost', role: 'def', title: 'Außenposten verteidigt', win: true, target: info, att: { start: startA, left: r.attLeft }, def: { start: def, left: r.defLeft }, defLabel: 'Außenposten', rounds: r.rounds }, realT);
    pushReport(A.state, { kind: 'outpost', role: 'att', title: 'Niederlage vor dem ' + place, win: false, target: info, att: { start: startA, left: r.attLeft, wounded: sa.wounded, dead: sa.dead }, def: { start: def, left: r.defLeft }, defLabel: 'Außenposten', rounds: r.rounds }, realT);
  }
  if (!sum(m.troops)) m.dead = true; else back();
}
export function noteRaid(ctx, me, o, m) {
  const w = ctx.match.world, eta = (m.t0 + m.arr[m.arr.length - 1] - w.gt) / ctx.match.speed;
  if (isProtected(me.state, w.gt)) me.state.protUntil = w.gt;
  me.state.stats.attacks++;
  note(ctx, o.owner, 'attack', 'Angriff auf deinen Außenposten!', me.name + ' greift einen Außenposten an. Ankunft in ' + fmtDur(eta) + '.');
}

/* ---------- laufende Pflege: Ausbau abschließen, Orte ohne Revier verlieren ---------- */
export function settle(w, gt) {
  for (const id in (w.outposts || {})) { const o = w.outposts[id]; if (o.upg && gt >= o.upg.done) { o.lv = o.upg.to; o.upg = null; } }
}
export function settleTerritory(ctx) {
  const { match, players } = ctx, w = match.world, gt = w.gt, map = mapOf(match);
  settle(w, gt);
  const rects = territory(match, players, gt);
  for (const oid of Object.keys(w.holds)) {
    const h = w.holds[oid], o = map.byId[oid];
    if (touches(rects, h.group, o.x, o.y)) continue;
    const name = o.k === 'throne' ? 'Der Thron' : 'Heiligtum';
    for (const pid of Object.keys(h.garr)) { const P = byId(players, Number(pid)); if (P) { sendHome(ctx, P, h.garr[pid], [o.x, o.y], o.k, o.id); note(ctx, P.id, 'hold', name + ' verloren', 'Dein Revier berührt den Ort nicht mehr. Die Besatzung kehrt heim.'); } }
    delete w.holds[oid];
    chron(ctx, groupLabel(w, players, h.group) + ' verliert ' + name + ', weil das Revier fehlt.');
  }
}
