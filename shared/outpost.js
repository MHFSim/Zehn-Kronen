// Zehn Kronen – Revier, Außenposten, Bündnislager und Teleporter (wie die Vierecke in Rise of Kingdoms).
// Jede Burg beansprucht ein Viereck. Außenposten gehören immer dem Bündnis, in dem der Erbauer ist, und vergrößern
// das gemeinsame Revier. Ein neuer Außenposten muss das Revier des Bündnisses berühren und wird aus dem Bündnislager
// bezahlt. Bündnismitglieder bewachen ihn mit eigenen Truppen. Heiligtümer und Thron kann nur besetzen, wessen
// Gruppe sie mit einem Viereck berührt. Feindliche Außenposten kann nur angreifen, wer selbst einen berührenden hat.
import { N } from './mapgen.js';
import { battle, sum, forceOf } from './combat.js';
import {
  mapOf, byId, groupOf, groupLabel, allianceOf, pushReport, note, chron, settleAway, sendHome, fmtDur, planFrom, launch,
  reveal, flushBits, VIEW_CITY
} from './core.js';
import { RES, TELEPORT_COOLDOWN } from './rules.js';

/* ---------- Regeln ---------- */
export const OP_R = 6;                                    // halbe Seitenlänge: 13×13 Felder
export const OP_BUILD = 2 * 3600;                         // Bauzeit in Spielsekunden
export const OP_MIN_TROOPS = 50;                          // so viele Truppen braucht ein Bautrupp (er bleibt als Besatzung)
export const OP_COST = [400, 1000, 1200, 200];            // Nahrung, Holz, Stein, Erz – aus dem Bündnislager
export const CLAN_SHARE = 0.25;                           // Anteil, der beim Farmen im Bündnisgebiet zusätzlich ins Bündnislager geht
export const maxOutposts = al => 3 + 2 * (al ? al.members.length : 0);
export const cityR = rathaus => 3 + Math.ceil(rathaus / 3);
export const opGuard = () => ({ troops: { speer: 30, bogen: 20 }, mult: 1.3 });   // Wachen ohne Besatzung
export const storeOf = al => al ? (al.store = al.store || { food: 0, wood: 0, stone: 0, ore: 0 }) : { food: 0, wood: 0, stone: 0, ore: 0 };
export const canAfford = (al, c = OP_COST) => RES.every((r, i) => storeOf(al)[r] >= c[i]);
export const opReady = (o, gt) => gt >= o.done;

/* ---------- Vierecke ---------- */
// cities: [{ pid, x, y, rathaus, group }], ops: [{ id, owner (Anführer, für die Farbe), x, y, done, group }]. Rein rechnerisch, läuft auch im Browser.
export function rectsOf(cities, ops, gt) {
  const out = [];
  for (const c of cities) { const r = cityR(c.rathaus); out.push({ k: 'city', id: 'c' + c.pid, owner: c.pid, group: c.group, x: c.x, y: c.y, r, x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r, ready: true }); }
  for (const o of ops) out.push({ k: 'op', id: o.id, owner: o.owner, group: o.group, x: o.x, y: o.y, r: OP_R, x0: o.x - OP_R, y0: o.y - OP_R, x1: o.x + OP_R, y1: o.y + OP_R, ready: gt >= o.done });
  return out;
}
export const overlaps = (a, b, pad = 0) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;
// Berührt ein fertiges Viereck der Gruppe das Feld (tx, ty)? (auch schräg angrenzend)
export const touches = (rects, group, tx, ty) => rects.some(r => r.ready && r.group === group && tx >= r.x0 - 1 && tx <= r.x1 + 1 && ty >= r.y0 - 1 && ty <= r.y1 + 1);
// Liegt das Feld mitten in einem fertigen Viereck der Gruppe?
export const inside = (rects, group, tx, ty) => rects.some(r => r.ready && r.group === group && tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1);
// Darf die Gruppe den Außenposten angreifen? Nur wenn ein fertiger eigener Außenposten an ihn angrenzt.
export const raidable = (rects, group, target) => target.group !== group && rects.some(r => r.k === 'op' && r.ready && r.group === group && overlaps(r, target, 1));

const leaderOf = al => al ? al.leader : 0;
export const opView = (w, o) => ({ ...o, group: 'a' + o.al, owner: leaderOf(w.alliances[o.al]) });
// Städte und Außenposten einer laufenden Partie
export function territory(match, players, gt) {
  const w = match.world, cities = [], ops = [];
  for (const p of players) if (!p.state.out && p.state.slot >= 0 && allianceOf(w, p.id)) cities.push({ pid: p.id, x: p.state.pos[0], y: p.state.pos[1], rathaus: p.state.lv.rathaus, group: groupOf(w, p.id) });
  for (const id in (w.outposts || {})) { const o = w.outposts[id]; if (w.alliances[o.al]) ops.push(opView(w, o)); }
  return rectsOf(cities, ops, gt);
}
const BASE_OK = (map, x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 3 && y >= 3 && x <= N - 4 && y <= N - 4 && map.pass[y * N + x];

/* ---------- Bauplatz prüfen ---------- */
// Gibt '' zurück, wenn dort (x, y) ein Außenposten des Bündnisses von me stehen darf, sonst den Grund.
export function checkSite(match, players, me, x, y, gt) {
  const map = mapOf(match), w = match.world, al = allianceOf(w, me.id);
  if (!al) return 'Außenposten gehören dem Bündnis. Gründe eines oder tritt einem bei.';
  if (!BASE_OK(map, x, y)) return 'Auf Wasser, Fels oder außerhalb der Karte kann man nicht bauen.';
  if (map.objects.some(o => Math.abs(o.x - x) <= 1 && Math.abs(o.y - y) <= 1)) return 'Zu nah an einem anderen Ort. Such dir ein freies Feld.';
  const group = 'a' + al.id, nr = { x0: x - OP_R, y0: y - OP_R, x1: x + OP_R, y1: y + OP_R }, rects = territory(match, players, gt);
  for (const r of rects) {
    if (r.group !== group && overlaps(nr, r)) return 'Das Viereck würde das Revier von ' + groupLabel(w, players, r.group) + ' überlappen.';
    if (r.k === 'op' && Math.abs(r.x - x) <= 1 && Math.abs(r.y - y) <= 1) return 'Hier steht schon ein Außenposten.';
  }
  if (!rects.some(r => r.ready && r.group === group && overlaps(nr, r, 1))) return 'Ein Außenposten muss das Revier deines Bündnisses berühren.';
  if (Object.values(w.outposts || {}).filter(o => o.al === al.id).length >= maxOutposts(al)) return 'Euer Bündnis kann höchstens ' + maxOutposts(al) + ' Außenposten halten (wächst mit den Mitgliedern).';
  return '';
}
export function checkBuild(match, players, me, x, y, troops, gt) {
  const al = allianceOf(match.world, me.id);
  if (!al) return 'Außenposten gehören dem Bündnis. Gründe eines oder tritt einem bei.';
  if (sum(troops) < OP_MIN_TROOPS) return 'Für einen Außenposten brauchst du mindestens ' + OP_MIN_TROOPS + ' Truppen als Besatzung.';
  if (!canAfford(al)) return 'Im Bündnislager fehlen Rohstoffe. Zahle ein oder farme im Bündnisgebiet.';
  return checkSite(match, players, me, x, y, gt);
}
export const clanOutposts = (w, alId) => Object.values(w.outposts || {}).filter(o => o.al === alId);

/* ---------- Bündnislager ---------- */
export function donate(ctx, me, amounts) {
  const w = ctx.match.world, al = allianceOf(w, me.id), S = me.state;
  if (!al) return 'Du bist in keinem Bündnis.';
  const give = {}; let any = false;
  for (const r of RES) { const n = Math.floor(Number((amounts || {})[r] || 0)); if (n < 0 || !Number.isFinite(n)) return 'Ungültige Menge'; if (n > S.res[r]) return 'So viel hast du nicht'; if (n > 0) { give[r] = n; any = true; } }
  if (!any) return 'Gib an, wie viel du einzahlen möchtest.';
  const st = storeOf(al); for (const r in give) { S.res[r] -= give[r]; st[r] += give[r]; }
  note(ctx, al.leader, 'ally', 'Einzahlung ins Bündnislager', me.name + ' hat Rohstoffe ins Bündnislager gelegt.');
  return '';
}
// Beim Farmen im Bündnisgebiet kommt zusätzlich ein Anteil ins Bündnislager (der Spieler bekommt seine Beute ungekürzt)
export function clanGather(ctx, m, o, bt) {
  const { match, players } = ctx, w = match.world, al = allianceOf(w, m.owner); if (!al || !m.amount) return;
  if (!inside(territory(match, players, bt), 'a' + al.id, o.x, o.y)) return;
  storeOf(al)[m.res] += Math.floor(m.amount * CLAN_SHARE);
}
export function refundStore(w, alId, c = OP_COST) { const al = w.alliances[alId]; if (!al) return; const st = storeOf(al); RES.forEach((r, i) => { st[r] += c[i]; }); }

/* ---------- Befehle der Mitglieder ---------- */
const mine = (w, me, id) => { const o = (w.outposts || {})[id], al = allianceOf(w, me.id); return o && al && o.al === al.id ? o : null; };
export function recallGarrison(ctx, me, id) {
  const w = ctx.match.world, o = mine(w, me, id); if (!o) return 'Diesen Außenposten gibt es nicht.';
  const t = o.garr[me.id]; if (!t || !sum(t)) return 'Du hast dort keine Truppen.';
  delete o.garr[me.id]; sendHome(ctx, me, t, [o.x, o.y], 'outpost', o.id); return '';
}
// Eigene Besatzung zu einem anderen Außenposten des Bündnisses schicken
export function moveGarrison(ctx, me, fromId, toId) {
  const { match } = ctx, w = match.world, a = mine(w, me, fromId), b = mine(w, me, toId);
  if (!a || !b || a === b) return 'Dieses Ziel gibt es nicht.';
  const t = a.garr[me.id]; if (!t || !sum(t)) return 'Du hast dort keine Truppen.';
  const plan = planFrom(mapOf(match), [a.x, a.y], b.x, b.y, t, me.state); if (plan.error) return plan.error;
  delete a.garr[me.id];
  launch(ctx, me, t, plan, { tk: 'outpost', tid: b.id, mode: 'garrison' });
  return '';
}
export function dismantle(ctx, me, id) {
  const w = ctx.match.world, o = mine(w, me, id), al = allianceOf(w, me.id);
  if (!o) return 'Diesen Außenposten gibt es nicht.';
  if (al.leader !== me.id && o.by !== me.id) return 'Nur der Anführer oder der Erbauer kann ihn aufgeben.';
  releaseOutpost(ctx, o); delete w.outposts[id];
  chron(ctx, me.name + ' gibt einen Außenposten von „' + al.name + '“ auf.');
  return '';
}
function releaseOutpost(ctx, o) {
  for (const pid of Object.keys(o.garr)) { const P = byId(ctx.players, Number(pid)); if (P && sum(o.garr[pid])) sendHome(ctx, P, o.garr[pid], [o.x, o.y], 'outpost', o.id); }
  o.garr = {};
}

/* ---------- Ankunft: Bauen, Verstärken, Angreifen ---------- */
export function arriveBuild(ctx, m, bt, realT, back) {
  const { match, players } = ctx, w = match.world, A = byId(players, m.owner), S = A.state, { x, y } = m.site, al = allianceOf(w, A.id);
  const info = { kind: 'outpost', id: m.tid, x, y };
  let why = al ? checkSite(match, players, A, x, y, bt) : 'Du bist in keinem Bündnis mehr.';
  if (why) { if (al) refundStore(w, al.id); pushReport(S, { kind: 'outpost', title: 'Bau nicht möglich', win: false, target: info, text: why + ' Das Heer kehrt zurück' + (al ? ', die Rohstoffe liegen wieder im Bündnislager.' : '.') }, realT); return back(); }
  const id = 'op' + w.nextOp++, o = { id, al: al.id, by: A.id, x, y, done: bt + OP_BUILD, garr: { [A.id]: { ...m.troops } } };
  w.outposts[id] = o; m.dead = true;
  pushReport(S, { kind: 'outpost', title: 'Außenposten wird gebaut', win: true, target: { ...info, id }, text: 'Dein Bautrupp (' + sum(m.troops) + ' Truppen) bleibt als Besatzung dort. In ' + fmtDur(OP_BUILD / match.speed) + ' ist der Außenposten fertig und das Revier von „' + al.name + '“ wächst.' }, realT);
  for (const pid of al.members) if (pid !== A.id) note(ctx, pid, 'ally', 'Neuer Außenposten', A.name + ' baut einen Außenposten und vergrößert euer Revier.');
}
export function checkGarrison(ctx, me, o) { const al = allianceOf(ctx.match.world, me.id); return al && o.al === al.id ? '' : 'Nur Außenposten deines Bündnisses kannst du bewachen.'; }
export function arriveGarrison(ctx, m, bt, realT, back) {
  const w = ctx.match.world, A = byId(ctx.players, m.owner), o = (w.outposts || {})[m.tid];
  const info = { kind: 'outpost', id: m.tid };
  if (!o || checkGarrison(ctx, A, o)) { pushReport(A.state, { kind: 'outpost', title: 'Außenposten nicht erreichbar', win: false, target: info, text: 'Der Außenposten gibt es nicht mehr oder gehört nicht mehr deinem Bündnis. Das Heer kehrt um.' }, realT); return back(); }
  const g = o.garr[A.id] = o.garr[A.id] || {};
  for (const u in m.troops) g[u] = (g[u] || 0) + m.troops[u];
  m.dead = true;
  pushReport(A.state, { kind: 'outpost', title: 'Außenposten bewacht', win: true, target: { ...info, x: o.x, y: o.y }, text: 'Deine Truppen bewachen jetzt den Außenposten. Du kannst sie jederzeit abziehen oder woanders hinschicken.' }, realT);
}
// Angriff auf einen fremden Außenposten: nur mit einem eigenen, angrenzenden Außenposten
export function checkRaid(ctx, me, o) {
  const { match, players } = ctx, w = match.world, al = allianceOf(w, me.id), gt = w.gt;
  if (!al) return 'Nur Bündnisse kämpfen um Außenposten. Gründe eines oder tritt einem bei.';
  if (o.al === al.id) return 'Das ist ein Außenposten deines Bündnisses.';
  const rects = territory(match, players, gt), tr = rects.find(r => r.id === o.id);
  if (!tr || !raidable(rects, 'a' + al.id, tr)) return 'Du kannst nur Außenposten angreifen, an die ein eigener fertiger Außenposten angrenzt. Baue deinen Außenposten direkt neben den feindlichen.';
  return '';
}
export function arriveRaid(ctx, m, bt, realT, back) {
  const { match, players } = ctx, w = match.world, A = byId(players, m.owner), o = (w.outposts || {})[m.tid];
  const info = { kind: 'outpost', id: m.tid, x: o ? o.x : 0, y: o ? o.y : 0 };
  if (!o) { pushReport(A.state, { kind: 'outpost', role: 'att', title: 'Außenposten nicht mehr da', win: false, target: info, text: 'Hier steht nichts mehr. Das Heer kehrt um.' }, realT); return back(); }
  const why = checkRaid({ ...ctx, match: { ...match, world: { ...w, gt: bt } } }, A, o);
  if (why) { pushReport(A.state, { kind: 'outpost', role: 'att', title: 'Angriff abgebrochen', win: false, target: info, text: why + ' Das Heer kehrt um.' }, realT); return back(); }
  const alD = w.alliances[o.al], g = opGuard(), def = { ...g.troops }, mult = o.done > bt ? 1 : g.mult;
  for (const pid in o.garr) for (const u in o.garr[pid]) def[u] = (def[u] || 0) + o.garr[pid][u];
  const startA = { ...m.troops }, r = battle(m.troops, def, mult, forceOf(A.state)), sa = settleAway(A.state, startA, r.attLeft);
  m.troops = r.attLeft; A.state.stats.kills += sum(def) - sum(r.defLeft); if (r.win) A.state.stats.wins++;
  const lab = alD ? alD.name : 'Bündnis', members = alD ? alD.members : [];
  const frac = {}; for (const u in def) frac[u] = def[u] ? 1 - (r.defLeft[u] || 0) / def[u] : 0;
  const detail = { att: { start: startA, left: r.attLeft, wounded: sa.wounded, dead: sa.dead }, def: { start: def, left: r.defLeft }, defLabel: 'Außenposten', rounds: r.rounds };
  if (r.win) {
    let lost = 0;
    for (const pid of Object.keys(o.garr)) { const P = byId(players, Number(pid)); if (P) { const sd = settleAway(P.state, o.garr[pid], {}); lost += sum(o.garr[pid]); note(ctx, P.id, 'attack', 'Außenposten zerstört', A.name + ' hat einen Außenposten von „' + lab + '“ zerstört. Du hast ' + sum(o.garr[pid]) + ' Truppen verloren (' + sum(sd.wounded) + ' verwundet).'); } }
    delete w.outposts[o.id];
    const spoil = OP_COST.map(c => Math.floor(c * 0.3)), load = {}; RES.forEach((res, i) => { if (spoil[i] > 0) load[res] = spoil[i]; }); m.load = load;
    chron(ctx, A.name + ' hat einen Außenposten von „' + lab + '“ zerstört.');
    for (const pid of members) { const P = byId(players, pid); if (!P) continue; if (!lost || !o.garr[pid]) note(ctx, pid, 'attack', 'Außenposten zerstört', A.name + ' hat einen Außenposten eures Bündnisses zerstört. Euer Revier ist kleiner geworden.'); pushReport(P.state, { kind: 'outpost', role: 'def', title: 'Außenposten zerstört', win: false, target: info, ...detail, text: A.name + ' hat einen Außenposten eures Bündnisses zerstört.' }, realT); }
    pushReport(A.state, { kind: 'outpost', role: 'att', title: 'Sieg: Außenposten von „' + lab + '“ zerstört', win: true, target: info, loot: load, ...detail, text: 'Das Revier ist verschwunden. Du erbeutest einen Teil der Baukosten.' }, realT);
  } else {
    for (const pid of Object.keys(o.garr)) {
      const P = byId(players, Number(pid)), st = o.garr[pid], left = {};
      for (const u in st) { const n = st[u] - Math.round(st[u] * (frac[u] || 0)); if (n > 0) left[u] = n; }
      if (P) settleAway(P.state, st, left);
      if (sum(left)) o.garr[pid] = left; else delete o.garr[pid];
    }
    for (const pid of members) { const P = byId(players, pid); if (!P) continue; note(ctx, pid, 'battle', 'Außenposten verteidigt', A.name + ' hat einen Außenposten eures Bündnisses angegriffen und wurde zurückgeschlagen.'); pushReport(P.state, { kind: 'outpost', role: 'def', title: 'Außenposten verteidigt', win: true, target: info, ...detail }, realT); }
    pushReport(A.state, { kind: 'outpost', role: 'att', title: 'Niederlage vor dem Außenposten von „' + lab + '“', win: false, target: info, ...detail }, realT);
  }
  if (!sum(m.troops)) m.dead = true; else back();
}
export function noteRaid(ctx, me, o, m) {
  const w = ctx.match.world, al = w.alliances[o.al], eta = (m.t0 + m.arr[m.arr.length - 1] - w.gt) / ctx.match.speed;
  if (me.state.protUntil > w.gt) me.state.protUntil = w.gt;
  me.state.stats.attacks++;
  if (al) for (const pid of al.members) note(ctx, pid, 'attack', 'Angriff auf euren Außenposten!', me.name + ' greift einen Außenposten eures Bündnisses an. Ankunft in ' + fmtDur(eta) + '.');
}

/* ---------- Teleporter ---------- */
export function checkTeleport(match, players, me, x, y, gt) {
  const map = mapOf(match), w = match.world, al = allianceOf(w, me.id), S = me.state;
  if (!al) return 'Teleportieren geht nur im Gebiet deines Bündnisses. Tritt einem bei.';
  if (!BASE_OK(map, x, y)) return 'Dort kann deine Burg nicht stehen (Wasser, Fels oder Kartenrand).';
  if (map.objects.some(o => Math.abs(o.x - x) <= 2 && Math.abs(o.y - y) <= 2)) return 'Zu nah an einem anderen Ort.';
  const group = 'a' + al.id, rects = territory(match, players, gt);
  if (!inside(rects, group, x, y)) return 'Du kannst nur ins Gebiet deines Bündnisses teleportieren.';
  const r = cityR(S.lv.rathaus), nr = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
  for (const q of rects) if (q.group !== group && overlaps(nr, q)) return 'Das Viereck deiner Burg würde das Revier von ' + groupLabel(w, players, q.group) + ' überlappen.';
  for (const p of players) if (p.id !== me.id && !p.state.out && p.state.slot >= 0 && Math.abs(p.state.pos[0] - x) <= 4 && Math.abs(p.state.pos[1] - y) <= 4) return 'Zu nah an der Burg von ' + p.name + '.';
  for (const o of Object.values(w.outposts || {})) if (Math.abs(o.x - x) <= 2 && Math.abs(o.y - y) <= 2) return 'Zu nah an einem Außenposten.';
  return '';
}
export function teleport(ctx, me, x, y) {
  const { match, players } = ctx, w = match.world, S = me.state;
  if (!((S.items || {}).teleport > 0)) return 'Du hast keinen Teleporter. Im Shop (Mehr) bekommst du einen.';
  if (w.gt - S.tpAt < TELEPORT_COOLDOWN) return 'Der Teleporter lädt noch: ' + fmtDur((TELEPORT_COOLDOWN - (w.gt - S.tpAt)) / match.speed) + '.';
  const map = mapOf(match);
  if (w.marches.some(m => m.mode === 'attack' && m.phase === 'out' && map.byId[m.tid] && map.byId[m.tid].slot === S.slot)) return 'Feindliche Heere sind zu dir unterwegs. Jetzt kannst du nicht fliehen.';
  x = Math.floor(Number(x)); y = Math.floor(Number(y));
  const why = checkTeleport(match, players, me, x, y, w.gt); if (why) return why;
  S.items.teleport--; S.tpAt = w.gt; S.pos = [x, y];
  reveal(S, x + .5, y + .5, VIEW_CITY); flushBits(S);
  const al = allianceOf(w, me.id);
  for (const pid of al.members) if (pid !== me.id) note(ctx, pid, 'ally', 'Burg versetzt', me.name + ' hat die Burg per Teleporter an einen neuen Ort im Bündnisgebiet versetzt.');
  chron(ctx, me.name + ' versetzt die Burg mit einem Teleporter.');
  return '';
}

/* ---------- laufende Pflege ---------- */
// Außenposten ohne Bündnis lösen sich auf, Besatzungen ausgetretener Mitglieder gehen heim, Orte ohne Revier gehen verloren
export function settleTerritory(ctx) {
  const { match, players } = ctx, w = match.world, gt = w.gt, map = mapOf(match);
  for (const id of Object.keys(w.outposts || {})) {
    const o = w.outposts[id], al = w.alliances[o.al];
    if (!al) { releaseOutpost(ctx, o); delete w.outposts[id]; continue; }
    for (const pid of Object.keys(o.garr)) if (!al.members.includes(Number(pid))) { const P = byId(players, Number(pid)); if (P && sum(o.garr[pid])) sendHome(ctx, P, o.garr[pid], [o.x, o.y], 'outpost', o.id); delete o.garr[pid]; }
  }
  const rects = territory(match, players, gt);
  for (const oid of Object.keys(w.holds)) {
    const h = w.holds[oid], o = map.byId[oid];
    if (touches(rects, h.group, o.x, o.y)) continue;
    const name = o.k === 'throne' ? 'Der Thron' : 'Heiligtum';
    for (const pid of Object.keys(h.garr)) { const P = byId(players, Number(pid)); if (P) { sendHome(ctx, P, h.garr[pid], [o.x, o.y], o.k, o.id); note(ctx, P.id, 'hold', name + ' verloren', 'Euer Revier berührt den Ort nicht mehr. Die Besatzung kehrt heim.'); } }
    delete w.holds[oid];
    chron(ctx, groupLabel(w, players, h.group) + ' verliert ' + name + ', weil das Revier fehlt.');
  }
}
// Außenposten eines ausgeschiedenen Spielers: seine Besatzung ist weg, der Posten bleibt dem Bündnis
export function removeOutposts(w, pid) { for (const id in (w.outposts || {})) delete w.outposts[id].garr[pid]; }
