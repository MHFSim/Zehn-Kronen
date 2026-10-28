// Zehn Kronen – Krieg zwischen den Spielern: Angriffe auf Burgen, Besatzungen, Vasallen, Ausscheiden,
// Thron und Heiligtümer, Spähen, Punkte und Spielende. Läuft auf dem Server und in der Testversion.
import { RES, cap, protectedPct, rate, troopCount, advanceTo } from './rules.js';
import { battle, roundStep, guardOf, wallMult, holdGuard, sum, capacityOf, forceOf, power, campTroops, campMult, campLoot } from './combat.js';
import {
  DAY, PROTECT, FALL_PROTECT, VASSAL_TIME, TRIBUTE, THRONE_HOLD, SIEGE_TIME, SIEGE_OP_TIME, FIGHT_TIME, SANCT_BONUS, THRONE_GOLD, SPY_COST, stationCap,
  mapOf, byId, isProtected, allied, groupOf, groupLabel, groupMembers, allianceOf, removeMember, pushReport, note, chron,
  CAMP_RESPAWN, settleAway, settleHome, sendHome, addTroops, fmtDur, ensureState, GATHER_SEC, cellXY, reversed, fightAt, joinDefenders, leaveDefenders, homeBack
} from './core.js';
import { HEROES, heroForce, keeperOf, heroXp, fightXp, raiderXp } from './heroes.js';
import { addPack, PACK_NAME } from './rules.js';
import { territory, touchesObj, removeOutposts, releaseAux, opGuard, checkRaid, OP_COST } from './outpost.js';

const FIELD_K = ['farm', 'wood', 'stone'];
export const SANCT_NAMES = ['Heiligtum der Felder', 'Heiligtum des Holzes', 'Heiligtum der Steine', 'Heiligtum des Goldes'];
export const SANCT_RES = ['food', 'wood', 'stone', 'gold'];
export const holdName = o => o.k === 'throne' ? 'Der Thron' : SANCT_NAMES[o.n] || 'Heiligtum';
const tAt = ctx => ctx.bt != null ? ctx.bt : ctx.match.world.gt;
const merge = (a, b) => { const r = { ...a }; for (const u in b) r[u] = (r[u] || 0) + b[u]; return r; };
const stationedTotal = S => Object.values(S.stationed || {}).reduce((a, t) => a + sum(t), 0);
const tag = (w, pid) => { const a = allianceOf(w, pid); return a ? ' [' + a.tag + ']' : ''; };

/* ---------- Start eines Marsches ---------- */
// Prüft ein Marschziel für Angriff, Stationieren oder Besetzen. Gibt eine Fehlermeldung oder { target } zurück.
export function checkLaunch(ctx, me, o, mode, troops) {
  const { players } = ctx, w = ctx.match.world, S = me.state, gt = w.gt;
  if (mode === 'attack' && (FIELD_K.includes(o.k) || o.k === 'post')) {          // Sammler auf einem Feld überfallen
    const gs = fieldGatherers(ctx, me.id, o.id, gt);
    if (gs.error) return gs.error;
    return { target: byId(players, gs.list[0].owner) };
  }
  if (mode === 'attack' || mode === 'station') {
    if (o.k !== 'start') return 'Dieses Ziel gibt es nicht';
    const tp = players.find(p => p.state.slot === o.slot);
    if (!tp) return 'Auf diesem Burgplatz wohnt noch niemand.';
    if (tp.id === me.id) return 'Das ist deine eigene Burg.';
    if (tp.state.out) return 'Dieser Spieler ist ausgeschieden.';
    if (mode === 'station') {
      if (!allied(w, me.id, tp.id)) return 'Truppen kannst du nur bei Verbündeten stationieren.';
      const onWay = w.marches.filter(m => m.mode === 'station' && m.tid === o.id).reduce((a, m) => a + sum(m.troops), 0);
      const room = stationCap(tp.state) - stationedTotal(tp.state) - onWay;
      if (sum(troops) > room) return room > 0 ? 'Diese Burg nimmt nur noch ' + room + ' fremde Truppen auf.' : 'Diese Burg kann keine weiteren fremden Truppen aufnehmen.';
      return { target: tp };
    }
    if (allied(w, me.id, tp.id)) return 'Verbündete kannst du nicht angreifen.';
    if ((S.exAllies[tp.id] || 0) > gt) return 'Dein früheres Bündnis mit diesem Spieler ist noch zu frisch. Angriffe sind für ' + fmtDur((S.exAllies[tp.id] - gt) / ctx.match.speed) + ' gesperrt.';
    if (tp.state.vassalOf === me.id) return 'Das ist dein Vasall.';
    if (tp.state.vassalOf && allied(w, me.id, tp.state.vassalOf)) return 'Dieser Vasall gehört einem Verbündeten.';
    if (isProtected(tp.state, gt)) return 'Dieser Spieler steht noch unter Schutz (noch ' + fmtDur((tp.state.protUntil - gt) / ctx.match.speed) + ').';
    if (castleSafe(ctx, tp, gt)) return SAFE_MSG;
    return { target: tp };
  }
  if (mode === 'occupy') {
    if (o.k === 'throne' || o.k === 'sanct') return (o.k === 'throne' ? 'Der Thron' : 'Ein Heiligtum') + ' wird nicht besetzt: Wer mit einem Außenposten am weißen Feld andockt, hält ihn' + (o.k === 'sanct' ? ' und bekommt den Bonus.' : '.');
    return 'Dieses Ziel gibt es nicht';
  }
  return 'Unbekannte Marschart';
}

// Eine Burg im aktiven Revier ihres eigenen Bündnisses ist unangreifbar; nur Burgen außerhalb (oder auf inaktivem Revier) kann man angreifen
export function castleSafe(ctx, D, gt) {
  const w = ctx.match.world, al = allianceOf(w, D.id); if (!al) return false;
  return territory(ctx.match, ctx.players, gt).some(r => r.k === 'op' && r.ready && r.group === 'a' + al.id && D.state.pos[0] >= r.x0 && D.state.pos[0] <= r.x1 && D.state.pos[1] >= r.y0 && D.state.pos[1] <= r.y1);
}
const SAFE_MSG = 'Diese Burg liegt im aktiven Revier ihres Bündnisses und ist nicht angreifbar. Nur Burgen auf inaktivem Revier oder ohne Revier kann man angreifen.';

// Feindliche Heere, die gerade auf einem Feld sammeln und angegriffen werden dürfen
function fieldGatherers(ctx, myId, fid, gt) {
  const { players } = ctx, w = ctx.match.world, all = w.marches.filter(g => !g.dead && (g.phase === 'gather' || g.phase === 'post') && g.tid === fid && g.owner !== myId);
  if (!all.length) return { error: fid.startsWith('post') ? 'Hier steht kein Heer mehr.' : 'Auf diesem Feld sammelt gerade niemand.' };
  const list = all.filter(g => { const D = byId(players, g.owner); return D && !D.state.out && !allied(w, myId, g.owner) && D.state.vassalOf !== myId && !isProtected(D.state, gt); }).sort((a, b) => a.id - b.id);
  if (!list.length) return { error: 'Die Truppen hier sind verbündet oder stehen unter Schutz.' };
  return { list };
}

// Nach dem Start: Schutz endet beim Angriff, Gegner und ihre Verbündeten werden gewarnt
export function afterLaunch(ctx, me, m, target, mode) {
  const w = ctx.match.world, S = me.state, speed = ctx.match.speed, eta = (m.t0 + m.arr[m.arr.length - 1] - w.gt) / speed;
  if (mode === 'attack' && m.tk !== 'start') {
    S.stats.attacks++;
    if (isProtected(S, w.gt)) S.protUntil = w.gt;
    for (const g of w.marches) if ((g.phase === 'gather' || g.phase === 'post') && g.tid === m.tid && g.owner !== me.id && !allied(w, me.id, g.owner)) note(ctx, g.owner, 'attack', 'Dein Heer wird angegriffen!', me.name + tag(w, me.id) + ' greift dein Heer auf dem Feld an. Ankunft in ' + fmtDur(eta) + '.');
  } else if (mode === 'attack') {
    S.stats.attacks++;
    if (isProtected(S, w.gt)) S.protUntil = w.gt;
    note(ctx, target.id, 'attack', 'Angriff auf deine Burg!', me.name + tag(w, me.id) + ' greift dich an. Ankunft in ' + fmtDur(eta) + '.');
    const al = allianceOf(w, target.id);
    if (al) for (const id of al.members) if (id !== target.id) note(ctx, id, 'attack', 'Verbündeter wird angegriffen', me.name + ' greift ' + target.name + ' an. Ankunft in ' + fmtDur(eta) + '.');
  } else if (mode === 'station') {
    note(ctx, target.id, 'station', 'Verstärkung unterwegs', me.name + ' schickt Truppen in deine Burg (Ankunft in ' + fmtDur(eta) + ').');
  }
}

/* ---------- Ankunft vor einer Burg ---------- */
function lootFrom(S, capacity) {
  const c = cap(S), prot = c * protectedPct(S) / 100, want = {};
  for (const r of RES) want[r] = Math.max(0, S.res[r] - prot) * 0.4;
  want.gold = Math.max(0, S.res.gold) * 0.25;
  const tot = Object.values(want).reduce((a, b) => a + b, 0), k = tot > capacity ? capacity / tot : 1, loot = {};
  for (const r in want) { const v = Math.floor(want[r] * k); if (v > 0) { loot[r] = v; S.res[r] -= v; } }
  return loot;
}
const subTroops = (a, lost) => { const r = {}; for (const u in a) { const n = a[u] - (lost[u] || 0); if (n > 0) r[u] = n; } return r; };

/* ---------- Überfall auf Sammler ---------- */
export function arriveField(ctx, m, o, bt, realT, back) {
  const { match, players } = ctx, w = match.world, A = byId(players, m.owner);
  const info = { kind: o.k, id: o.id, lv: o.lv, x: o.x, y: o.y };
  const lead = fightAt(w, o.id); if (lead) { attach(ctx, lead, m, 'att'); return; }
  const gs = fieldGatherers(ctx, A.id, o.id, bt);
  if (gs.error) { pushReport(A.state, { kind: 'pvp', role: 'att', title: 'Heer kehrt um', win: false, target: info, text: 'Hier ist niemand mehr, den du angreifen kannst.' }, realT); return back(); }
  let def = {}, fn = 0, ff = 0;
  for (const g of gs.list) {
    const D = byId(players, g.owner); advanceTo(D.state, realT, match.speed);
    const frac = g.phase === 'gather' && g.tEnd > g.tStart ? Math.max(0, Math.min(1, (bt - g.tStart) / (g.tEnd - g.tStart))) : 0;
    g.pre = { phase: g.phase, tStart: g.tStart, tEnd: g.tEnd, amount: g.amount, res: g.res, got: g.phase === 'gather' ? Math.floor(g.amount * frac) : 0 };
    def = merge(def, g.troops); const k = sum(g.troops); fn += k; ff += k * forceOf(D.state) * heroForce(D.state, g.hero, g.troops, 'def', 'field');
  }
  startFight(ctx, m, def, fn ? ff / fn : 1, bt, 'field');
  for (const g of gs.list) {
    attach(ctx, m, g, 'def');
    note(ctx, g.owner, 'attack', 'Dein Heer wird angegriffen!', A.name + tag(w, A.id) + ' kämpft gegen dein Heer auf dem Feld. Schau dir den Lebensbalken an und zieh es notfalls ab.');
  }
}



/* ---------- Kampf in Echtzeit ----------
   Ein Angriff beginnt sofort bei der Ankunft. Der Kampf läuft in Runden (je nach Heergröße 1 bis 20 Minuten Spielzeit insgesamt).
   Der erste Angreifer ("Anführer") trägt den Kampfstand m.fight; weitere Angreifer und Helfer hängen als Marsch in der Phase 'fight' daran (m.lead, m.side).
   Beide Seiten können jederzeit Verstärkung schicken oder ihr Heer abziehen; die Lebensbalken folgen dem Stand der Truppen. */
const NT = 600, MAXT = 1000;   // Der Kampf läuft in sehr kleinen Zeitschritten (alle paar Sekunden), die Einheiten fallen also laufend
let CX = null;               // Kontext des laufenden Kampfbefehls (für den Heimweg)
// Belohnung für besiegte Räuber: Beschleuniger und Ressourcenpakete. Pro Tag gibt es für die ersten 12 Siege die volle Belohnung, danach die Hälfte (ohne Pakete).
export const RAID_DAILY = 12;
function raiderReward(S, lv, realT) {
  const day = Math.floor(realT / 86400000); if (!S.raidDay || S.raidDay.day !== day) S.raidDay = { day, n: 0 };
  S.raidDay.n++; S.items = S.items || {};
  const full = S.raidDay.n <= RAID_DAILY, got = {};
  const add = (id, n) => { n = full ? n : Math.floor(n / 2); if (n > 0) { S.items[id] = (S.items[id] || 0) + n; got[id] = (got[id] || 0) + n; } };
  if (lv < 10) { add('sp1', 2 + (lv >> 1)); add('sp5', 1); }
  else if (lv < 20) { add('sp5', 2); add('sp15', 1); }
  else if (lv < 30) { add('sp15', 2); add('sp5', 2); if (lv >= 25) add('sp60', 1); }
  else { add('sp60', 1); add('sp15', 2); }
  const packs = !full ? 0 : lv < 5 ? 0 : lv < 15 ? 1 : lv < 30 ? 2 : 3, names = [];
  for (let i = 0; i < packs; i++) { const th = ['', 'food', 'wood', 'stone'][(lv + i) % 4]; addPack(S, th); names.push(PACK_NAME[th] || 'Ressourcenpaket'); }
  return { got, names };
}
const SP_NAME = { sp1: '1 Min.', sp5: '5 Min.', sp15: '15 Min.', sp60: '1 Std.' };
const rewardText = rw => [...Object.keys(rw.got).map(id => rw.got[id] + '× Beschleuniger ' + SP_NAME[id]), ...rw.names].join(', ') || 'keine (Tageslimit erreicht)';
// Erfahrung für Helden, die im Kampf angeführt haben (Kämpfer-Helden; Sammler-Helden lernen nur beim Sammeln)
function awardHeroXp(ctx, lead, atts, f, win, startA, startD, kind, bt) {
  const map = mapOf(ctx.match); let base, tlv = 0;
  if (kind === 'camp') { const o = map.byId[lead.tid]; tlv = o ? o.lv : 1; base = 40 + 25 * tlv; }
  else if (kind === 'raider') { tlv = f.rlv; base = raiderXp(tlv); }
  else base = Math.min(1500, 40 + 1.2 * sum(startD));
  const totA = Math.max(1, sum(startA));
  for (const x of atts) {
    const P = byId(ctx.players, x.owner); if (!P || !x.hero || !HEROES[x.hero]) continue;
    const xp = fightXp(P.state, x.hero, base * Math.min(1, sum(cOf(lead, x)) / totA) * (win ? 1 : 0.2), kind + ':' + lead.tid, tlv, bt);
    if (heroXp(P.state, x.hero, xp)) note(ctx, P.id, 'hero', HEROES[x.hero].name + ' ist aufgestiegen', HEROES[x.hero].name + ' hat Stufe ' + P.state.heroes[x.hero].lv + ' erreicht.');
  }
}
const foeOf = kind => kind === 'camp' || kind === 'raider' ? 'camp' : 'player';
const multOf = (ctx, list, kind) => { let n = 0, f = 0; for (const x of list) { const P = byId(ctx.players, x.owner), k = sum(x.fc || x.troops); n += k; f += k * (P ? forceOf(P.state) * heroForce(P.state, x.hero, x.fc || x.troops, 'att', foeOf(kind)) : 1); } return n ? f / n : 1; };
const cOf = (lead, x) => x === lead ? lead.troops : (x.fc || x.troops);
const scaleT = (t, k) => { const l = {}; for (const u in t) { const n = Math.round(t[u] * (k[u] || 0)); if (n > 0) l[u] = n; } return l; };
const ratio = (P, P0) => { const k = {}; for (const u in P0) k[u] = P0[u] > 0 ? Math.max(0, Math.min(1, (P[u] || 0) / P0[u])) : 0; return k; };
const goBack = (x, bt) => { homeBack(CX, x, bt); delete x.lead; delete x.side; delete x.fc; delete x.fight; delete x.ft; delete x.pre; };
export const fightMembers = (w, lead, side) => w.marches.filter(x => !x.dead && x.phase === 'fight' && x.lead === lead.id && x.side === side);
// Wie viele Schritte braucht dieser Kampf noch? (Schätzung für Dauer und Restzeit)
function ticksLeft(A, D, am, dm, k, from = 0, cap = MAXT) {
  let a = { ...A }, d = { ...D }, n = from;
  while (n < cap && sum(a) >= 0.5 && sum(d) >= 0.5) { const r = roundStep(a, d, am, dm, k); a = r.A; d = r.D; n++; }
  return n - from;
}

function startFight(ctx, m, def, dm, bt, kind) {
  const A = { ...m.troops }, D = { ...def }, n0 = sum(A) + sum(D), P = byId(ctx.players, m.owner), am = P ? forceOf(P.state) * heroForce(P.state, m.hero, m.troops, 'att', foeOf(kind)) : 1;
  // Spieler gegen Spieler: mindestens 10 Minuten, höchstens 2 Stunden. Banditenlager und Räuber: immer 20 Sekunden (echte Zeit, unabhängig vom Spieltempo).
  const dur = kind === 'camp' || kind === 'raider' ? 20 * (ctx.match.speed || 1) : Math.max(600, Math.min(7200, 600 + 6600 * Math.min(1, n0 / 3000)));
  const r0 = Math.max(1, ticksLeft(A, D, am, dm, .25, 0, 120) * .25), k = r0 / NT;   // so viele Kampfrunden-Einheiten verteilen sich auf die Kampfdauer
  m.phase = 'fight'; m.side = 'att'; m.tStart = bt; m.ft = bt + dur / NT;
  m.fight = { kind, dt: dur / NT, k, round: 0, A, A0: { ...A }, D, D0: { ...D }, dm, pkA: power(A), pkD: power(D, dm) };
}
function attach(ctx, lead, m, side) {   // Heer schließt sich einem laufenden Kampf an
  const f = lead.fight, P = side === 'att' ? f.A : f.D, P0 = side === 'att' ? f.A0 : f.D0;
  m.fc = { ...m.troops }; m.phase = 'fight'; m.lead = lead.id; m.side = side; m.tStart = lead.tStart;
  for (const u in m.troops) { P[u] = (P[u] || 0) + m.troops[u]; P0[u] = (P0[u] || 0) + m.troops[u]; }
}
export const attachTo = (ctx, lead, m) => attach(ctx, lead, m, 'att');
// Ein Heer verlässt den Kampf (Abzug): es nimmt seinen Anteil an den bisherigen Verlusten mit
function leave(ctx, lead, x, bt, realT) {
  CX = ctx;
  const f = lead.fight, P = x.side === 'att' ? f.A : f.D, P0 = x.side === 'att' ? f.A0 : f.D0, k = ratio(P, P0), c = x.fc;
  for (const u in c) { P[u] = Math.max(0, (P[u] || 0) - c[u] * (k[u] || 0)); P0[u] = Math.max(0, (P0[u] || 0) - c[u]); }
  const Pl = byId(ctx.players, x.owner), left = scaleT(c, k);
  if (Pl) { const sa = settleAway(Pl.state, c, left); pushReport(Pl.state, { kind: 'pvp', role: x.side, title: 'Rückzug aus dem Kampf', win: false, target: { kind: x.tk, id: x.tid }, att: { start: c, left, wounded: sa.wounded, dead: sa.dead }, text: 'Du hast dein Heer abgezogen und ' + (sum(c) - sum(left)) + ' Einheiten verloren.' }, realT); }
  x.troops = left; delete x.load; if (!sum(left)) { x.dead = true; return; } goBack(x, bt);
}
// Befehl "Abziehen" für ein Heer im Kampf. Gibt true zurück, wenn das Heer im Kampf war.
export function withdraw(ctx, player, m, bt, realT) {
  if (m.phase !== 'fight') return false;
  CX = ctx; const w = ctx.match.world;
  if (m.lead) { const lead = w.marches.find(x => x.id === m.lead && !x.dead); if (lead) leave(ctx, lead, m, bt, realT); else { m.troops = { ...m.fc }; goBack(m, bt); } return true; }
  resolveFight(ctx, m, bt, realT, false); return true;
}
// Verwaiste Helfer (Anführer ist weg): heimschicken
export function freeOrphans(ctx, bt) {
  CX = ctx; const w = ctx.match.world;
  for (const x of w.marches) if (!x.dead && x.phase === 'fight' && x.lead && !w.marches.some(l => l.id === x.lead && !l.dead && l.fight)) { x.troops = { ...(x.fc || x.troops) }; goBack(x, bt); }
}
export function stepFight(ctx, m, bt, realT) {
  CX = ctx;
  const w = ctx.match.world, f = m.fight, att = [m, ...fightMembers(w, m, 'att')], am = multOf(ctx, att, f.kind);
  if (f.wall != null) f.dm = f.fm * (1 + f.wb * f.wall);   // die Mauer hilft den Verteidigern nur, solange sie steht
  const before = power(f.D, 1), r = roundStep(f.A, f.D, am, f.dm, f.k); f.A = r.A; f.D = r.D; f.round++;
  if (f.wall != null) f.wall = Math.max(0, f.wall - 1.5 * Math.max(0, before - power(f.D, 1)) / Math.max(1, power(f.D0, 1)));   // Angreifer schlagen die Mauer nieder
  f.pkA = Math.max(f.pkA, power(f.A, am)); f.pkD = Math.max(f.pkD, power(f.D, f.dm));
  m.ft = bt + f.dt;
  const nA = sum(f.A), nD = sum(f.D);
  if (nA < 0.5 || nD < 0.5 || f.round >= MAXT) resolveFight(ctx, m, bt, realT, nD < 0.5 && nA >= 0.5);
}
// Anzeige: Lebensbalken beider Seiten (Stärke jetzt, höchste Stärke bisher) und geschätzte Restzeit (Spielsekunden)
export function fightView(ctx, m) {
  const w = ctx.match.world, f = m.fight; if (!f) return null;
  const am = multOf(ctx, [m, ...fightMembers(w, m, 'att')], f.kind), pa = power(f.A, am), pd = power(f.D, f.dm);
  return { kind: f.kind, pa: Math.round(pa), pd: Math.round(pd), pk: Math.round(Math.max(f.pkA, f.pkD, pa, pd)), fa: Math.min(1, pa / Math.max(1, power(f.A0, am))), fd: Math.min(1, pd / Math.max(1, power(f.D0, f.dm))), wall: f.wall == null ? null : f.wall, na: Math.round(sum(f.A)), nd: Math.round(sum(f.D)), na0: Math.round(sum(f.A0)), nd0: Math.round(sum(f.D0)), round: f.round,
    left: ticksLeft(f.A, f.D, am, f.dm, f.k, f.round) * f.dt, tot: Math.max(f.round, ticksLeft(f.A, f.D, am, f.dm, f.k, f.round) + f.round) * f.dt };
}
// Kampf gegen ein Banditenlager
export function startCampFight(ctx, m, o, bt) { startFight(ctx, m, campTroops(o.lv), campMult(o.lv), bt, 'camp'); }
export function startRaiderFight(ctx, m, r, bt) { startFight(ctx, m, campTroops(r.lv), campMult(r.lv), bt, 'raider'); m.fight.rlv = r.lv; }

function resolveFight(ctx, lead, bt, realT, win) {
  CX = ctx;
  const { match, players } = ctx, w = match.world, f = lead.fight, map = mapOf(match), kind = f.kind;
  const kA = ratio(f.A, f.A0), kD = ratio(f.D, f.D0);
  if (win) for (const u in f.D0) kD[u] = 0;
  const atts = [lead, ...fightMembers(w, lead, 'att')], defs = fightMembers(w, lead, 'def');
  const A = byId(players, lead.owner);
  const nameOf = x => { const Pp = byId(players, x.owner); return Pp ? Pp.name : '?'; };
  const fx = { kind, dur: Math.max(0, Math.round(bt - (lead.tStart == null ? bt : lead.tStart))), rounds: f.round, na0: Math.round(sum(f.A0)), nd0: Math.round(sum(f.D0)), naL: win ? Math.round(sum(f.A)) : 0, ndL: win ? 0 : Math.round(sum(f.D)), killA: Math.round(sum(f.D0) - (win ? 0 : sum(f.D))), killD: Math.round(sum(f.A0) - (win ? sum(f.A) : 0)), wall0: f.wall == null ? null : (f.wall0 == null ? 1 : f.wall0), wall: f.wall == null ? null : (win ? 0 : f.wall), pkA: f.pkA, pkD: f.pkD, helpA: atts.slice(1).map(nameOf), helpD: defs.map(nameOf), att: A ? A.name : '', win: !!win };
  const PR = (Sx, rep, t) => pushReport(Sx, rep.att || rep.def ? { ...rep, fx } : rep, t);
  const startA = { ...f.A0 }, startD = { ...f.D0 }, leftD = {};
  for (const u in f.D) if (!win && Math.round(f.D[u]) > 0) leftD[u] = Math.round(f.D[u]);
  const lostOf = t => { const lost = {}; for (const u in t) { const l = win ? t[u] : Math.min(t[u], Math.round(t[u] * (1 - (kD[u] === undefined ? 1 : kD[u])))); if (l > 0) lost[u] = l; } return lost; };
  const tNode = kind === 'field' && !String(lead.tid).startsWith('post') ? map.byId[lead.tid] : null, gathered = {};
  // Helfer der Verteidiger (bei Feldkämpfen: die Heere auf dem Feld)
  const defHelp = [];
  for (const x of defs) {
    const c = x.fc, left = scaleT(c, kD), P = byId(players, x.owner);
    if (P) {
      const sa2 = settleAway(P.state, c, left); defHelp.push({ label: kind === 'field' ? 'Dein Heer auf dem Feld' : 'Helfer ' + P.name, start: c, left, wounded: sa2.wounded, dead: sa2.dead });
      if (kind === 'field') PR(P.state, { kind: 'pvp', role: 'def', title: (!sum(left) ? 'Heer überfallen: ' : 'Überfall abgewehrt: ') + A.name, win: !!sum(left), target: { kind: x.tk, id: x.tid }, att: { start: startA, left: {} }, def: { start: c, left, groups: [{ label: 'Dein Heer auf dem Feld', start: c, left, wounded: sa2.wounded, dead: sa2.dead }] },
        text: !sum(left) ? A.name + ' hat dein Heer auf dem Feld vernichtet.' : 'Dein Heer hat ' + A.name + ' zurückgeschlagen und sammelt weiter.' }, realT);
      else PR(P.state, { kind: 'pvp', role: 'ally', title: 'Deine Truppen haben verteidigt', win: !win, target: { kind: x.tk, id: x.tid }, text: 'Du hast ' + (sum(c) - sum(left)) + ' von ' + sum(c) + ' Truppen verloren. Die Überlebenden marschieren heim.' }, realT);
    }
    x.troops = left;
    if (x.pre) {   // Heer stand auf dem Feld: Überlebende machen dort weiter
      if (!sum(left)) { x.dead = true; if (x.pre.res && x.pre.got > 0) gathered[x.pre.res] = (gathered[x.pre.res] || 0) + x.pre.got; if (tNode) { const n = w.nodes[tNode.id] || { left: 0, t: bt }, rest = n.left - x.pre.got; w.nodes[tNode.id] = { left: rest < 50 ? 0 : rest, t: bt }; } }
      else { const pre = x.pre; delete x.lead; delete x.side; delete x.fc; delete x.pre; x.phase = pre.phase; if (pre.phase === 'gather') { const d = bt - lead.tStart; x.tStart = pre.tStart + d; x.amount = Math.min(pre.amount, Math.floor(capacityOf(left, P ? P.state : null))); x.tEnd = x.tStart + GATHER_SEC * x.amount; } }
    } else if (!sum(left)) x.dead = true; else goBack(x, bt);
  }
  // Angreifer: Verluste verbuchen, Überlebende heim
  let ownLeft = {}, sa = null;
  for (const x of atts) {
    const c = cOf(lead, x), left = scaleT(c, kA), P = byId(players, x.owner), s2 = P ? settleAway(P.state, c, left) : null;
    if (x === lead) { ownLeft = left; sa = s2; }
    else { if (P) PR(P.state, { kind: 'pvp', role: 'att', title: (win ? 'Sieg' : 'Niederlage') + ' im Kampf', win, target: { kind: x.tk, id: x.tid }, text: 'Du hast ' + (sum(c) - sum(left)) + ' von ' + sum(c) + ' Truppen verloren. Die Überlebenden marschieren heim.' }, realT); x.troops = left; if (!sum(left)) x.dead = true; else goBack(x, bt); }
  }
  awardHeroXp(ctx, lead, atts, f, win, startA, startD, kind, bt);
  lead.troops = ownLeft;
  A.state.stats.kills += sum(startD) - sum(leftD); if (win) A.state.stats.wins++;
  const fin = () => { delete lead.fight; delete lead.ft; delete lead.side; if (!sum(lead.troops)) lead.dead = true; else goBack(lead, bt); };
  const attInfo = { start: startA, left: ownLeft, wounded: sa ? sa.wounded : {}, dead: sa ? sa.dead : {} };
  if (kind === 'camp') {
    const o = map.byId[lead.tid], info = { kind: o.k, id: o.id, lv: o.lv, x: o.x, y: o.y };
    const rep = { kind: 'camp', title: (win ? 'Sieg über Banditenlager Stufe ' : 'Niederlage vor Banditenlager Stufe ') + o.lv, win, target: info, att: attInfo, def: { start: startD, left: leftD }, rounds: [] };
    if (win) { const loot = campLoot(o.lv); lead.load = loot; rep.loot = loot; w.camps[o.id] = { dead: bt + CAMP_RESPAWN }; }
    PR(A.state, rep, realT); return fin();
  }
  if (kind === 'raider') {
    const r = (w.raiders || []).find(x => x.id === lead.tid), lv = f.rlv, info = { kind: 'raider', id: lead.tid, lv, x: r ? r.x : 0, y: r ? r.y : 0 };
    const rep = { kind: 'camp', title: (win ? 'Sieg über Räuber Stufe ' : 'Niederlage gegen Räuber Stufe ') + lv, win, target: info, att: attInfo, def: { start: startD, left: leftD }, rounds: [] };
    if (win) {
      w.raiders = (w.raiders || []).filter(x => x.id !== lead.tid);
      const cl = campLoot(lv), loot = { food: Math.round(cl.food / 2), wood: Math.round(cl.wood / 2), stone: Math.round(cl.stone / 2), gold: Math.round(cl.gold / 2) };
      lead.load = loot; rep.loot = loot;
      const tot = Math.max(1, atts.reduce((a, x) => a + sum(cOf(lead, x)), 0)), per = {};
      for (const x of atts) per[x.owner] = (per[x.owner] || 0) + sum(cOf(lead, x));
      for (const pid in per) {
        if (per[pid] / tot < 0.2) continue;   // wer kaum mitgekämpft hat, bekommt keine Belohnung
        const P = byId(players, Number(pid)); if (!P) continue;
        const rw = raiderReward(P.state, lv, realT), txt = rewardText(rw);
        if (P.id === A.id) rep.reward = txt; else note(ctx, P.id, 'camp', 'Räuber besiegt', 'Belohnung: ' + txt);
      }
    }
    PR(A.state, rep, realT); return fin();
  }
  if (kind === 'field') {
    const o = map.byId[lead.tid] || { k: 'post', id: lead.tid }, info = { kind: o.k, id: o.id, lv: o.lv, x: o.x, y: o.y }, won = defs.length > 0 && defs.every(x => x.dead);
    let loot = {};
    if (sum(ownLeft)) { const capa = capacityOf(ownLeft, A.state), tot = Object.values(gathered).reduce((a, b) => a + b, 0), k = tot > capa ? capa / tot : 1; for (const r in gathered) { const v = Math.floor(gathered[r] * k); if (v > 0) loot[r] = v; } lead.load = loot; }
    PR(A.state, { kind: 'pvp', role: 'att', title: sum(ownLeft) && win ? (o.k === 'post' ? 'Heer überfallen' : 'Sammler überfallen') : 'Überfall gescheitert', win: sum(ownLeft) > 0 && win, target: info, att: attInfo, def: { start: startD, left: leftD }, rounds: [], loot,
      text: win ? 'Du hast die Sammler auf dem Feld besiegt.' : 'Die Sammler haben dich zurückgeschlagen.' }, realT);
    note(ctx, A.id, 'battle', win ? 'Überfall gelungen' : 'Überfall gescheitert', 'Dein Heer ' + (win ? 'hat die Sammler auf dem Feld besiegt.' : 'wurde auf dem Feld geschlagen.')); void won;
    return fin();
  }
  if (kind === 'hold') {
    const o = map.byId[lead.tid], hold = w.holds[o.id], group = groupOf(w, A.id), info = { kind: o.k, id: o.id, x: o.x, y: o.y, n: o.n }, defender = hold ? groupLabel(w, players, hold.group) : 'Wächter';
    if (win) {
      if (hold) for (const pid of Object.keys(hold.garr)) {
        const P = byId(players, Number(pid)); if (!P) continue;
        const sp = settleAway(P.state, hold.garr[pid], {});
        PR(P.state, { kind: 'hold', title: holdName(o) + ' verloren', win: false, target: info, text: A.name + ' hat die Besatzung geschlagen. Du hast ' + sum(hold.garr[pid]) + ' Truppen verloren (' + sum(sp.wounded) + ' verwundet).' }, realT);
        note(ctx, P.id, 'hold', holdName(o) + ' verloren', A.name + tag(w, A.id) + ' hat deine Besatzung geschlagen.');
      }
      w.holds[o.id] = { group, since: bt, garr: { [A.id]: { ...ownLeft } } }; lead.dead = true;
      chron(ctx, groupLabel(w, players, group) + ' hält jetzt ' + holdName(o) + '.');
      for (const p of groupMembers(w, players, group)) note(ctx, p.id, 'hold', holdName(o) + ' erobert', A.name + ' hat ' + holdName(o) + ' für ' + groupLabel(w, players, group) + ' eingenommen.');
      delete lead.fight; delete lead.ft; delete lead.side;
    } else {
      if (hold) {
        for (const pid of Object.keys(hold.garr)) {
          const P = byId(players, Number(pid)), st = hold.garr[pid], left = subTroops(st, lostOf(st));
          if (P) { settleAway(P.state, st, left); note(ctx, P.id, 'hold', holdName(o) + ' verteidigt', A.name + ' hat angegriffen und wurde zurückgeschlagen.'); }
          if (sum(left)) hold.garr[pid] = left; else delete hold.garr[pid];
        }
        if (!Object.keys(hold.garr).length) delete w.holds[o.id];
      }
      fin();
    }
    PR(A.state, { kind: 'hold', title: (win ? 'Sieg: ' : 'Niederlage: ') + holdName(o), win, target: info, att: attInfo, def: { start: startD, left: leftD }, rounds: [], defLabel: defender,
      text: win ? 'Deine Truppen halten jetzt ' + holdName(o) + '. Sie bleiben dort, bis du sie zurückrufst.' : '' }, realT);
    return;
  }
  if (kind === 'raid') {
    const o = (w.outposts || {})[lead.tid], alD = o ? w.alliances[o.al] : null, lab = alD ? alD.name : 'Bündnis', mem = alD ? alD.members : [];
    const info = { kind: 'outpost', id: lead.tid, x: o ? o.x : 0, y: o ? o.y : 0 };
    const detail = { att: attInfo, def: { start: startD, left: leftD }, defLabel: 'Außenposten', rounds: [] };
    if (!o) { PR(A.state, { kind: 'outpost', role: 'att', title: 'Außenposten nicht mehr da', win: false, target: info, text: 'Hier steht nichts mehr.' }, realT); return fin(); }
    if (win) {
      let lost = 0;
      for (const pid of Object.keys(o.garr)) { const P = byId(players, Number(pid)); if (P) { const sd = settleAway(P.state, o.garr[pid], {}); lost += sum(o.garr[pid]); note(ctx, P.id, 'attack', 'Außenposten zerstört', A.name + ' hat einen Außenposten von „' + lab + '“ zerstört. Du hast ' + sum(o.garr[pid]) + ' Truppen verloren (' + sum(sd.wounded) + ' verwundet).'); } }
      delete w.outposts[o.id];
      const spoil = OP_COST.map(c => Math.floor(c * 0.3)), load = {}; RES.forEach((res, i) => { if (spoil[i] > 0) load[res] = spoil[i]; }); lead.load = load;
      chron(ctx, A.name + ' hat einen Außenposten von „' + lab + '“ zerstört.');
      for (const pid of mem) { const P = byId(players, pid); if (!P) continue; if (!lost || !o.garr[pid]) note(ctx, pid, 'attack', 'Außenposten zerstört', A.name + ' hat einen Außenposten eures Bündnisses zerstört. Euer Revier ist kleiner geworden.'); PR(P.state, { kind: 'outpost', role: 'def', title: 'Außenposten zerstört', win: false, target: info, ...detail, text: A.name + ' hat einen Außenposten eures Bündnisses zerstört.' }, realT); }
      PR(A.state, { kind: 'outpost', role: 'att', title: 'Sieg: Außenposten von „' + lab + '“ zerstört', win: true, target: info, loot: load, ...detail, text: 'Das Revier ist verschwunden. Du erbeutest einen Teil der Baukosten.' }, realT);
    } else {
      for (const pid of Object.keys(o.garr)) {
        const P = byId(players, Number(pid)), st = o.garr[pid], lost = lostOf(st), left = subTroops(st, lost);
        if (P) settleAway(P.state, st, left);
        if (sum(left)) o.garr[pid] = left; else delete o.garr[pid];
      }
      for (const pid of mem) { const P = byId(players, pid); if (!P) continue; note(ctx, pid, 'battle', 'Außenposten verteidigt', A.name + ' hat einen Außenposten eures Bündnisses angegriffen und wurde zurückgeschlagen.'); PR(P.state, { kind: 'outpost', role: 'def', title: 'Außenposten verteidigt', win: true, target: info, ...detail }, realT); }
      PR(A.state, { kind: 'outpost', role: 'att', title: 'Niederlage vor dem Außenposten von „' + lab + '“', win: false, target: info, ...detail }, realT);
    }
    return fin();
  }
  const o = map.byId[lead.tid], D = players.find(p => p.state.slot === o.slot), SD = D.state, info = { kind: 'start', id: o.id, x: o.x, y: o.y, name: D.name };
  SD.wall = { v: win ? 0 : (f.wall == null ? 1 : f.wall), t: bt };
  const homeStart = {}; for (const u in SD.troops) if (SD.troops[u] > 0) homeStart[u] = SD.troops[u];
  const homeLost = lostOf(homeStart), hs = settleHome(SD, homeLost);
  const groups = [{ label: 'Deine Truppen', start: homeStart, left: subTroops(homeStart, homeLost), wounded: hs.wounded, dead: hs.dead }];
  for (const pid of Object.keys(SD.stationed)) {
    const P = byId(players, Number(pid)), st = SD.stationed[pid], lost = lostOf(st), left = subTroops(st, lost);
    if (P) {
      settleAway(P.state, st, left); groups.push({ label: 'Verbündeter ' + P.name, start: st, left });
      if (sum(lost)) PR(P.state, { kind: 'pvp', role: 'ally', title: 'Deine Truppen bei ' + D.name + ' haben gekämpft', win: !win, target: info, text: A.name + ' griff die Burg von ' + D.name + ' an. Du hast ' + sum(lost) + ' Truppen verloren.' }, realT);
    }
    if (sum(left)) SD.stationed[pid] = left; else delete SD.stationed[pid];
  }
  groups.push(...defHelp);
  const guard = guardOf(SD), guardLost = lostOf(guard); groups.push({ label: 'Stadtwache', start: guard, left: subTroops(guard, guardLost) });
  let fate = null, loot = {};
  if (win) { loot = lootFrom(SD, capacityOf(ownLeft, A.state)); lead.load = loot; fate = fall(ctx, A, D, bt); }
  const fateText = fate === 'out' ? ' Die Burg wurde erobert, ' + D.name + ' ist ausgeschieden.' : fate === 'vassal' ? ' Die Burg wurde erobert, ' + D.name + ' ist jetzt dein Vasall.' : '';
  const det = { att: attInfo, def: { start: startD, left: leftD, groups }, rounds: [], loot };
  PR(A.state, { kind: 'pvp', role: 'att', title: (win ? 'Sieg über die Burg von ' : 'Niederlage vor der Burg von ') + D.name, win, target: info, fate, ...det, text: fateText.trim() }, realT);
  PR(SD, { kind: 'pvp', role: 'def', title: (win ? 'Burg gefallen: ' : 'Angriff abgewehrt: ') + A.name, win: !win, target: info, fate, ...det,
    text: win ? (fate === 'out' ? 'Deine Burg ist gefallen. Du bist ausgeschieden.' : 'Deine Burg ist gefallen. Du bist jetzt Vasall von ' + A.name + '.') : 'Deine Verteidiger haben ' + A.name + ' zurückgeschlagen.' }, realT);
  note(ctx, D.id, 'battle', win ? (fate === 'out' ? 'Du bist ausgeschieden' : 'Deine Burg ist gefallen') : 'Angriff abgewehrt', A.name + (win ? ' hat deine Burg erobert.' : ' wurde zurückgeschlagen.'));
  note(ctx, A.id, 'battle', win ? 'Burg erobert' : 'Angriff gescheitert', 'Dein Heer ' + (win ? 'hat die Burg von ' + D.name + ' genommen.' : 'hat den Kampf vor der Burg von ' + D.name + ' verlassen oder verloren.'));
  if (win) { const al = allianceOf(w, D.id); if (al) for (const id of al.members) if (id !== D.id) note(ctx, id, 'battle', 'Verbündeter gefallen', D.name + ' wurde von ' + A.name + ' erobert.'); }
  fin();
}

/* ---------- Helfer im Kampf: Spieler (auch aus anderen Bündnissen) schicken Truppen auf Seite der Angreifer oder Verteidiger ---------- */
// Darf der Spieler in diesem Kampf auf der Seite helfen? Gibt den Kampf (Anführer-Marsch) zurück oder einen Fehlertext
// Wer auf einer Seite kämpft (oder mit jemandem von ihr verbündet ist), darf der Gegenseite nie helfen
function sideConflict(ctx, lead, pid, side) {
  const w = ctx.match.world, foes = side === 'def' ? [lead, ...fightMembers(w, lead, 'att')] : fightMembers(w, lead, 'def');
  return foes.some(x => x.owner === pid || allied(w, pid, x.owner));
}
export function checkAssist(ctx, me, tid, side, defGroupHas) {
  const w = ctx.match.world, sm = fightAt(w, tid);
  if (!sm) return 'Dort läuft gerade kein Kampf.';
  if (side !== 'att' && side !== 'def') return 'Wähle eine Seite: Angreifer oder Verteidiger.';
  const att = byId(ctx.players, sm.owner);
  if (side === 'att') {
    if (defGroupHas(me)) return 'Du gehörst zu den Verteidigern.';
    if (sideConflict(ctx, sm, me.id, 'att')) return 'Du kannst den Angreifern nicht helfen: Du oder dein Bündnis steht auf der Seite der Verteidiger.';
  } else if (sideConflict(ctx, sm, me.id, 'def')) return 'Du kannst nicht gegen deinen eigenen Verbündeten verteidigen. Angreifer und ihre Bündnisse helfen nie den Verteidigern.';
  if (!att) return 'Der Angreifer ist nicht mehr da.';
  return sm;
}
export function arriveAssist(ctx, m, bt, realT, back) {
  const { match, players } = ctx, w = match.world, P = byId(players, m.owner), lead = fightAt(w, m.tid);
  if (!lead) { pushReport(P.state, { kind: 'pvp', role: 'att', title: 'Zu spät', win: false, target: { kind: m.tk, id: m.tid }, text: 'Der Kampf ist schon vorbei. Dein Heer kehrt um.' }, realT); return back(); }
  if (sideConflict(ctx, lead, m.owner, m.side)) { pushReport(P.state, { kind: 'pvp', role: m.side, title: 'Hilfe abgewiesen', win: false, target: { kind: m.tk, id: m.tid }, text: 'Du oder dein Bündnis kämpft inzwischen auf der Gegenseite. Dein Heer kehrt um.' }, realT); return back(); }
  attach(ctx, lead, m, m.side);
  pushReport(P.state, { kind: 'pvp', role: m.side === 'att' ? 'att' : 'def', title: 'Truppen im Kampf eingetroffen', win: true, target: { kind: m.tk, id: m.tid }, text: 'Deine ' + sum(m.troops) + ' Truppen kämpfen auf Seite der ' + (m.side === 'att' ? 'Angreifer' : 'Verteidiger') + '. Du kannst sie jederzeit abziehen.' }, realT);
}

// Burg: Ankunft eines Angriffs oder einer Verstärkung. Ein Angriff beginnt sofort.
export function arriveCity(ctx, m, o, bt, realT, back) {
  const { match, players } = ctx, w = match.world, speed = match.speed;
  const A = byId(players, m.owner), D = players.find(p => p.state.slot === o.slot);
  const info = { kind: 'start', id: o.id, x: o.x, y: o.y, name: D ? D.name : '' };
  const turnBack = text => { pushReport(A.state, { kind: 'pvp', role: 'att', title: 'Heer kehrt um', win: false, target: info, text }, realT); return back(); };
  if (!D || D.state.out) return turnBack('Der Spieler, den du erreichen wolltest, ist nicht mehr da.');
  advanceTo(D.state, realT, speed);
  if (m.mode === 'station') {
    if (!allied(w, A.id, D.id)) return turnBack('Ihr seid nicht mehr verbündet. Das Heer kehrt um.');
    if (sum(m.troops) + stationedTotal(D.state) > stationCap(D.state)) return turnBack('Die Burg von ' + D.name + ' ist voll. Das Heer kehrt um.');
    D.state.stationed[A.id] = merge(D.state.stationed[A.id] || {}, m.troops);
    joinDefenders(w, o.id, m.troops);
    m.dead = true;
    pushReport(A.state, { kind: 'pvp', role: 'att', title: 'Truppen bei ' + D.name + ' stationiert', win: true, target: info, text: 'Deine Truppen verteidigen jetzt die Burg von ' + D.name + '. Du kannst sie jederzeit zurückrufen.' }, realT);
    pushReport(D.state, { kind: 'pvp', role: 'def', title: 'Verstärkung von ' + A.name, win: true, target: info, text: A.name + ' hat ' + sum(m.troops) + ' Truppen in deine Burg gelegt. Sie helfen bei der Verteidigung.' }, realT);
    note(ctx, D.id, 'station', 'Verstärkung eingetroffen', A.name + ' hat ' + sum(m.troops) + ' Truppen in deine Burg gelegt.');
    return;
  }
  if (allied(w, A.id, D.id)) return turnBack('Ihr seid inzwischen verbündet. Das Heer kehrt um.');
  const lead = fightAt(w, o.id);
  if (lead) { attach(ctx, lead, m, 'att'); note(ctx, D.id, 'attack', 'Weitere Angreifer!', A.name + tag(w, A.id) + ' schickt ' + sum(m.troops) + ' weitere Truppen in den Kampf um deine Burg.'); return; }
  if (isProtected(D.state, bt)) return turnBack(D.name + ' steht inzwischen unter Schutz. Das Heer kehrt um.');
  if (castleSafe(ctx, D, bt)) return turnBack('Die Burg von ' + D.name + ' liegt im aktiven Revier ihres Bündnisses. Das Heer kehrt um.');
  const SD = D.state; let def = merge({ ...SD.troops }, guardOf(SD));
  for (const pid in SD.stationed) def = merge(def, SD.stationed[pid]);
  for (const u in def) if (!(def[u] > 0)) delete def[u];
  const wv = Math.min(1, ((SD.wall || {}).v == null ? 1 : SD.wall.v) + (bt - ((SD.wall || {}).t || bt)) / 21600);   // Mauer wächst in 6 Stunden Spielzeit wieder zu
  const kp = keeperOf(SD, w, D.id), hf = heroForce(SD, kp, def, 'def', 'home');
  startFight(ctx, m, def, wallMult(SD) * forceOf(SD) * hf, bt, 'city');
  Object.assign(m.fight, { wall: wv, wall0: wv, wb: wallMult(SD) - 1, fm: forceOf(SD) * hf, keeper: kp });
  if (kp) note(ctx, D.id, 'hero', HEROES[kp].name + ' verteidigt die Burg', HEROES[kp].name + ' ' + HEROES[kp].title + ' führt die Verteidigung an.');
  const who = [D.id]; const al = allianceOf(w, D.id); if (al) for (const id of al.members) if (id !== D.id) who.push(id);
  note(ctx, D.id, 'attack', 'Kampf um deine Burg!', A.name + tag(w, A.id) + ' kämpft mit ' + sum(m.troops) + ' Truppen vor deiner Burg. Schick Verstärkung und beobachte den Lebensbalken!');
  for (const id of who) if (id !== D.id) note(ctx, id, 'attack', 'Kampf um die Burg eines Verbündeten', A.name + ' kämpft vor der Burg von ' + D.name + '. Schick Verstärkung!');
}
// Außenposten: Ankunft eines Angriffs
export function arriveRaid(ctx, m, bt, realT, back) {
  const { match, players } = ctx, w = match.world, A = byId(players, m.owner), o = (w.outposts || {})[m.tid];
  const info = { kind: 'outpost', id: m.tid, x: o ? o.x : 0, y: o ? o.y : 0 };
  if (!o) { pushReport(A.state, { kind: 'outpost', role: 'att', title: 'Außenposten nicht mehr da', win: false, target: info, text: 'Hier steht nichts mehr. Das Heer kehrt um.' }, realT); return back(); }
  const lead = fightAt(w, o.id);
  if (lead) { attach(ctx, lead, m, 'att'); return; }
  const why = checkRaid({ ...ctx, match: { ...match, world: { ...w, gt: bt } } }, A, o);
  if (why) { pushReport(A.state, { kind: 'outpost', role: 'att', title: 'Angriff abgebrochen', win: false, target: info, text: why + ' Das Heer kehrt um.' }, realT); return back(); }
  const g = opGuard(), def = { ...g.troops };
  for (const pid in o.garr) for (const u in o.garr[pid]) def[u] = (def[u] || 0) + o.garr[pid][u];
  startFight(ctx, m, def, o.done > bt ? 1 : g.mult, bt, 'raid');
  const al = w.alliances[o.al];
  if (al) for (const pid of al.members) note(ctx, pid, 'attack', 'Kampf um euren Außenposten!', A.name + tag(w, A.id) + ' kämpft mit ' + sum(m.troops) + ' Truppen um einen Außenposten eures Bündnisses. Schickt Besatzung hin!');
}

/* ---------- Fall einer Burg: Vasall oder ausgeschieden ---------- */
function fall(ctx, A, D, bt) {
  const { players } = ctx, SA = A.state, SD = D.state;
  for (const p of players) if (p.state.vassalOf === D.id) { p.state.vassalOf = 0; p.state.vassalUntil = 0; note(ctx, p.id, 'free', 'Du bist frei', D.name + ' ist gefallen, du bist kein Vasall mehr.'); }
  if (SA.vassalOf === D.id) { SA.vassalOf = 0; SA.vassalUntil = 0; }
  if (SD.vassalOf) { eliminate(ctx, D, A, bt); return 'out'; }
  SD.vassalOf = A.id; SD.vassalUntil = bt + VASSAL_TIME; SD.protUntil = bt + FALL_PROTECT; SD.protKind = 'fall';
  SA.stats.conquests++;
  chron(ctx, D.name + ' ist vor ' + A.name + ' gefallen und dient ihm nun als Vasall.');
  return 'vassal';
}
export function eliminate(ctx, V, by, bt) {
  const { players } = ctx, w = ctx.match.world, S = V.state;
  for (const m of w.marches) if (m.owner === V.id && m.aux) releaseAux(ctx, m);
  w.marches = w.marches.filter(m => m.owner !== V.id);
  for (const p of players) if (p.state.stationed[V.id]) delete p.state.stationed[V.id];
  for (const oid in w.holds) { const h = w.holds[oid]; if (h.garr[V.id]) { delete h.garr[V.id]; if (!Object.keys(h.garr).length) delete w.holds[oid]; } }
  removeMember(ctx, V.id);
  for (const p of players) if (p.state.vassalOf === V.id) { p.state.vassalOf = 0; p.state.vassalUntil = 0; }
  removeOutposts(w, V.id); S.out = true; S.outAt = bt; S.troops = {}; S.away = {}; S.wounded = {}; S.train = {}; S.queue = []; S.stationed = {}; S.vassalOf = 0; S.vassalUntil = 0; S.protUntil = 0; S.bonus = {};
  if (by) by.state.stats.conquests++;
  chron(ctx, V.name + ' ist ausgeschieden' + (by ? ' (erobert von ' + by.name + ')' : '') + '.');
  note(ctx, V.id, 'out', 'Du bist ausgeschieden', 'Du kannst die Partie weiter verfolgen.');
}

/* ---------- Stationierte Truppen und Besatzungen lösen ---------- */
// Alle Truppen, die wegen eines Bündnisses an fremden Orten stehen, nach Hause schicken
export function releaseAll(ctx, pid) {
  const { players } = ctx, w = ctx.match.world, map = mapOf(ctx.match), me = byId(players, pid); if (!me) return;
  for (const P of players) {
    if (P.id !== pid && P.state.stationed[pid]) { const t = P.state.stationed[pid]; delete P.state.stationed[pid]; sendHome(ctx, me, t, P.state.pos); }
  }
  for (const owner of Object.keys(me.state.stationed)) {
    const O = byId(players, Number(owner)), t = me.state.stationed[owner]; delete me.state.stationed[owner];
    if (O) sendHome(ctx, O, t, me.state.pos);
  }
  for (const oid of Object.keys(w.holds)) {
    const h = w.holds[oid]; if (!h.garr[pid]) continue;
    const o = map.byId[oid], t = h.garr[pid]; delete h.garr[pid];
    if (!Object.keys(h.garr).length) delete w.holds[oid];
    sendHome(ctx, me, t, [o.x, o.y], o.k, o.id);
  }
}
// Spieler ganz aus der Partie nehmen (Admin): Verbündete bekommen ihre Truppen zurück
export function purge(ctx, pid) {
  const { players } = ctx, w = ctx.match.world;
  releaseAll(ctx, pid); removeOutposts(w, pid);
  for (const m of w.marches) if (m.owner === pid && m.aux) releaseAux(ctx, m);
  w.marches = w.marches.filter(m => m.owner !== pid);
  removeMember(ctx, pid);
  w.pending = w.pending.filter(p => p.pid !== pid);
  for (const p of players) if (p.state.vassalOf === pid) { p.state.vassalOf = 0; p.state.vassalUntil = 0; }
}
// Eigene Truppen aus der Burg eines Verbündeten zurückholen (von = Besitzer der Burg) oder fremde Truppen wegschicken
const castleId = (ctx, P) => { const o = mapOf(ctx.match).objects.find(x => x.k === 'start' && x.slot === P.state.slot); return o ? o.id : ''; };
export function recallStation(ctx, me, hostId) {
  const H = byId(ctx.players, hostId); if (!H || !H.state.stationed[me.id]) return 'Du hast dort keine Truppen.';
  const t = H.state.stationed[me.id]; leaveDefenders(ctx.match.world, castleId(ctx, H), t); delete H.state.stationed[me.id];
  sendHome(ctx, me, t, H.state.pos); return '';
}
export function dismissStation(ctx, me, ownerId) {
  const O = byId(ctx.players, ownerId); if (!O || !me.state.stationed[ownerId]) return 'Von diesem Spieler stehen keine Truppen bei dir.';
  const t = me.state.stationed[ownerId]; leaveDefenders(ctx.match.world, castleId(ctx, me), t); delete me.state.stationed[ownerId];
  sendHome(ctx, O, t, me.state.pos); note(ctx, O.id, 'station', 'Truppen zurückgeschickt', me.name + ' hat deine Truppen aus seiner Burg zurückgeschickt.'); return '';
}

/* ---------- Thron und Heiligtümer ---------- */
const sumGarr = h => { let t = {}; for (const pid in h.garr) t = merge(t, h.garr[pid]); return t; };
export function arriveHold(ctx, m, o, bt, realT, back) {
  const { players } = ctx, w = ctx.match.world, A = byId(players, m.owner), group = groupOf(w, A.id), hold = w.holds[o.id];
  const info = { kind: o.k, id: o.id, x: o.x, y: o.y, n: o.n };
  if (!touchesObj(territory(ctx.match, players, bt), group, o)) {
    pushReport(A.state, { kind: 'hold', title: holdName(o) + ': kein Revier', win: false, target: info, text: 'Dein Revier berührt den Ort nicht mehr. Das Heer kehrt um.' }, realT);
    return back();
  }
  if (hold && hold.group === group) {
    hold.garr[A.id] = merge(hold.garr[A.id] || {}, m.troops); joinDefenders(w, o.id, m.troops); m.dead = true;
    pushReport(A.state, { kind: 'hold', title: holdName(o) + ': Truppen angekommen', win: true, target: info, text: 'Deine Truppen verstärken die Besatzung.' }, realT);
    return;
  }
  const lead = fightAt(w, o.id); if (lead) { attach(ctx, lead, m, 'att'); return; }
  const guard = holdGuard(o.k), def = hold ? sumGarr(hold) : guard.troops, mult = hold ? 1 : guard.mult;
  startFight(ctx, m, def, mult, bt, 'hold');
}
export function holdRecall(ctx, me, oid) {
  const w = ctx.match.world, o = mapOf(ctx.match).byId[oid], h = w.holds[oid];
  if (!o || !h || !h.garr[me.id]) return 'Du hast dort keine Truppen.';
  const t = h.garr[me.id]; delete h.garr[me.id];
  if (!Object.keys(h.garr).length) { delete w.holds[oid]; chron(ctx, holdName(o) + ' ist wieder frei.'); }
  sendHome(ctx, me, t, [o.x, o.y], o.k, o.id); return '';
}
// Boni der gehaltenen Orte an alle Mitglieder der haltenden Gruppe verteilen
export function applyBonuses(ctx) {
  const { players } = ctx, w = ctx.match.world, map = mapOf(ctx.match), b = {};
  for (const oid in w.holds) {
    const o = map.byId[oid]; if (!o) continue;
    for (const p of groupMembers(w, players, w.holds[oid].group)) {
      if (p.state.out) continue;
      const x = b[p.id] = b[p.id] || {};
      if (o.k === 'sanct') x[SANCT_RES[o.n]] = (x[SANCT_RES[o.n]] || 0) + SANCT_BONUS;
      else x.gold = (x.gold || 0) + THRONE_GOLD;
    }
  }
  for (const p of players) p.state.bonus = b[p.id] || {};
}

/* ---------- Vasallen: Tribut und Freilassung ---------- */
export function vassalStep(ctx, dt, gt) {
  const { players } = ctx;
  for (const p of players) {
    const S = p.state; if (!S.vassalOf) continue;
    const O = byId(players, S.vassalOf);
    if (!O || O.state.out) { S.vassalOf = 0; S.vassalUntil = 0; continue; }
    if (gt >= S.vassalUntil) {
      S.vassalOf = 0; S.vassalUntil = 0;
      note(ctx, p.id, 'free', 'Du bist frei', 'Deine Zeit als Vasall von ' + O.name + ' ist vorbei.');
      note(ctx, O.id, 'free', 'Vasall entlassen', p.name + ' ist nicht mehr dein Vasall.');
      chron(ctx, p.name + ' ist kein Vasall von ' + O.name + ' mehr.'); continue;
    }
    for (const r of [...RES, 'gold']) {
      const take = Math.min(S.res[r], Math.max(0, rate(S, r)) * dt / 3600 * TRIBUTE);
      if (take <= 0) continue;
      S.res[r] -= take; O.state.res[r] = r === 'gold' ? O.state.res[r] + take : Math.min(cap(O.state), O.state.res[r] + take);
    }
  }
}

/* ---------- Späher ---------- */
export function spy(ctx, me, targetId) {
  const T = byId(ctx.players, targetId), S = me.state;
  if (!T || T.id === me.id) return 'Dieser Spieler ist nicht da.';
  if (T.state.out) return 'Dieser Spieler ist ausgeschieden.';
  if (S.res.gold < SPY_COST) return 'Für Späher brauchst du ' + SPY_COST + ' Gold.';
  S.res.gold -= SPY_COST;
  const ts = T.state, w = ctx.match.world, round = n => Math.round(n / 50) * 50;
  pushReport(S, { kind: 'spy', title: 'Späherbericht: ' + T.name, win: true, target: { kind: 'start', name: T.name },
    spy: { rathaus: ts.lv.rathaus, mauer: ts.lv.mauer, home: Object.fromEntries(Object.entries(ts.troops).filter(([, n]) => n > 0)),
      stationed: stationedTotal(ts), away: troopCount(ts) - Object.values(ts.troops).reduce((a, b) => a + b, 0), guard: guardOf(ts),
      res: Object.fromEntries([...RES, 'gold'].map(r => [r, round(ts.res[r])])), protectedFor: ts.protUntil > w.gt ? ts.protUntil - w.gt : 0,
      vassalOf: ts.vassalOf ? (byId(ctx.players, ts.vassalOf) || {}).name || '' : '' } }, ctx.realT || ctx.now || Date.now());
  return '';
}

/* ---------- Punkte, Rangliste, Spielende ---------- */
export const scoreOf = S => S.out ? 0 : Math.round(Object.keys(S.lv).reduce((a, k) => a + S.lv[k], 0) * 10 + troopCount(S) * 2 + S.stats.conquests * 200 + S.stats.kills * 0.5 + Object.values(S.tech || {}).reduce((a, b) => a + b, 0) * 15);
// Mut: Leiste (0–100). Jeder Angriff auf Räuber und Banditenlager kostet Mut, stündlich kehrt etwas zurück. Bremst zu schnelles Wachsen durch Dauerangriffe.
export const MUT_MAX = 100, MUT_REGEN = 8, MUT_HOUR = 3600;
export const MUT_COST = 6;                  // Mut je Angriff auf Räuber
export const mutCost = () => MUT_COST;
export function mutStep(S, gt) {
  if (S.mut == null) { S.mut = MUT_MAX; S.mutAt = gt; }
  if (S.mut >= MUT_MAX) { S.mut = MUT_MAX; S.mutAt = gt; return; }
  while (gt - S.mutAt >= MUT_HOUR && S.mut < MUT_MAX) { S.mut = Math.min(MUT_MAX, S.mut + MUT_REGEN); S.mutAt += MUT_HOUR; }
  if (S.mut >= MUT_MAX) S.mutAt = gt;
}
// Stärke eines Spielers (Truppen, Heldenstufen, Rathaus): Räuber in seiner Nähe richten sich danach.
export const powerOf = S => S.out ? 0 : Math.round(troopCount(S) * 2 + Object.values(S.heroes || {}).reduce((a, h) => a + (h.lv - 1), 0) * 25 + (S.lv.rathaus || 1) * 10);
export function rankingOf(match, players) {
  const w = match.world, rows = players.map(p => {
    const S = p.state, a = allianceOf(w, p.id);
    return { id: p.id, name: p.name, slot: S.slot, score: scoreOf(S), rathaus: S.lv.rathaus, ally: a ? a.id : 0, tag: a ? a.tag : '', out: !!S.out, vassalOf: S.vassalOf || 0,
      conquests: S.stats.conquests, kills: S.stats.kills };
  }).sort((x, y) => y.score - x.score || x.id - y.id);
  const groups = {};
  for (const r of rows) { const g = r.ally ? 'a' + r.ally : 'p' + r.id; (groups[g] = groups[g] || { group: g, label: groupLabel(w, players, g), score: 0, members: [] }); groups[g].score += r.score; groups[g].members.push(r.id); }
  return { players: rows, groups: Object.values(groups).sort((x, y) => y.score - x.score) };
}
function finish(ctx, kind, winners, label, t) {
  const w = ctx.match.world, { players } = ctx;
  w.phase = 'ended';
  w.result = { kind, t: Math.round(t), label, winners: winners.map(p => ({ id: p.id, name: p.name })), ranking: rankingOf(ctx.match, players) };
  const why = kind === 'throne' ? 'Der Thron wurde gehalten.' : kind === 'last' ? 'Alle anderen sind ausgeschieden.' : kind === 'time' ? 'Die Zeit ist abgelaufen.' : 'Der Admin hat die Partie beendet.';
  chron(ctx, 'Die Partie ist beendet. Sieger: ' + label + '. ' + why);
  for (const p of players) note(ctx, p.id, 'end', 'Die Partie ist beendet', 'Sieger: ' + label + '. ' + why);
}
export function checkEnd(ctx, t, force) {
  const w = ctx.match.world, { players } = ctx;
  if (w.phase !== 'running') return false;
  const alive = players.filter(p => !p.state.out);
  const best = () => { const g = rankingOf(ctx.match, players).groups.filter(x => x.members.some(id => !byId(players, id).state.out))[0]; return g; };
  if (!force && players.length < 2) return false;
  if (!force && alive.length && players.some(p => p.state.out)) {
    const groups = new Set(alive.map(p => groupOf(w, p.id)));
    if (groups.size === 1) { const g = [...groups][0]; finish(ctx, 'last', alive, groupLabel(w, players, g), t); return true; }
  }
  const th = w.holds.throne1;
  if (!force && th && t - th.since >= THRONE_HOLD) {
    const win = groupMembers(w, players, th.group).filter(p => !p.state.out);
    if (win.length) { finish(ctx, 'throne', win, groupLabel(w, players, th.group), t); return true; }
  }
  if (force) {
    const g = best(); if (!g) return false;
    finish(ctx, force ? 'admin' : 'time', g.members.map(id => byId(players, id)).filter(p => !p.state.out), g.label, t); return true;
  }
  return false;
}
export function protectNew(S, gt) { S.protUntil = gt + PROTECT; S.protKind = 'new'; S.protWarn = false; }
