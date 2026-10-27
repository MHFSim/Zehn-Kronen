// Zehn Kronen – Krieg zwischen den Spielern: Angriffe auf Burgen, Besatzungen, Vasallen, Ausscheiden,
// Thron und Heiligtümer, Spähen, Punkte und Spielende. Läuft auf dem Server und in der Testversion.
import { RES, cap, protectedPct, rate, troopCount, advanceTo } from './rules.js';
import { battle, guardOf, wallMult, holdGuard, sum, capacityOf, forceOf } from './combat.js';
import {
  DAY, PROTECT, FALL_PROTECT, VASSAL_TIME, TRIBUTE, THRONE_HOLD, SIEGE_TIME, SIEGE_OP_TIME, SANCT_BONUS, THRONE_GOLD, SPY_COST, stationCap,
  mapOf, byId, isProtected, allied, groupOf, groupLabel, groupMembers, allianceOf, removeMember, pushReport, note, chron,
  settleAway, settleHome, sendHome, addTroops, fmtDur, ensureState, GATHER_SEC, cellXY
} from './core.js';
import { territory, touchesObj, removeOutposts, auxOf, sumAux, attMultOf, settleAux, releaseAux } from './outpost.js';

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
    return { target: tp };
  }
  if (mode === 'occupy') {
    if (o.k === 'throne' || o.k === 'sanct') return (o.k === 'throne' ? 'Der Thron' : 'Ein Heiligtum') + ' wird nicht besetzt: Wer mit einem Außenposten am weißen Feld andockt, hält ihn' + (o.k === 'sanct' ? ' und bekommt den Bonus.' : '.');
    return 'Dieses Ziel gibt es nicht';
  }
  return 'Unbekannte Marschart';
}

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
  const gs = fieldGatherers(ctx, A.id, o.id, bt);
  if (gs.error) { pushReport(A.state, { kind: 'pvp', role: 'att', title: 'Heer kehrt um', win: false, target: info, text: 'Hier ist niemand mehr, den du angreifen kannst.' }, realT); return back(); }
  const startA = { ...m.troops }; let cur = { ...m.troops }, killed = 0, last = null, won = false;
  const defStart = {}, defLeft = {}, gathered = {};
  for (const g of gs.list) {
    if (!sum(cur)) break;
    const D = byId(players, g.owner); advanceTo(D.state, realT, match.speed);
    const frac = g.phase === 'gather' && g.tEnd > g.tStart ? Math.max(0, Math.min(1, (bt - g.tStart) / (g.tEnd - g.tStart))) : 0, got = g.phase === 'gather' ? Math.floor(g.amount * frac) : 0;
    const sd = { ...g.troops }, r = battle(cur, sd, forceOf(D.state), forceOf(A.state)), sa2 = settleAway(D.state, sd, r.defLeft);
    last = r; killed += sum(sd) - sum(r.defLeft); cur = r.attLeft;
    for (const u in sd) { defStart[u] = (defStart[u] || 0) + sd[u]; defLeft[u] = (defLeft[u] || 0) + (r.defLeft[u] || 0); }
    if (!sum(r.defLeft)) {
      g.dead = true; won = true;
      if (o.k !== 'post') { const n = w.nodes[o.id] || { left: 0, t: bt }; const rest = n.left - got; w.nodes[o.id] = { left: rest < 50 ? 0 : rest, t: bt }; }
      if (got > 0) gathered[g.res] = (gathered[g.res] || 0) + got;
    } else {
      g.troops = r.defLeft;
      if (g.phase === 'gather') { g.amount = Math.min(g.amount, Math.floor(capacityOf(g.troops, D.state))); g.tEnd = g.tStart + GATHER_SEC * g.amount; }
    }
    pushReport(D.state, { kind: 'pvp', role: 'def', title: (g.dead ? (o.k === 'post' ? 'Heer überfallen: ' : 'Sammler überfallen: ') : 'Überfall abgewehrt: ') + A.name, win: !g.dead, target: info,
      att: { start: startA, left: r.attLeft }, def: { start: sd, left: r.defLeft, groups: [{ label: 'Dein Heer auf dem Feld', start: sd, left: r.defLeft, wounded: sa2.wounded, dead: sa2.dead }] }, rounds: r.rounds,
      text: g.dead ? A.name + ' hat dein Heer auf dem Feld vernichtet.' : 'Dein Heer hat ' + A.name + ' zurückgeschlagen und sammelt weiter.' }, realT);
    note(ctx, D.id, 'battle', g.dead ? 'Heer vernichtet' : 'Überfall abgewehrt', A.name + (g.dead ? ' hat dein Heer auf dem Feld besiegt.' : ' wurde auf dem Feld zurückgeschlagen.'));
  }
  const sa = settleAway(A.state, startA, cur);
  m.troops = cur; A.state.stats.kills += killed; if (won) A.state.stats.wins++;
  let loot = {};
  if (sum(cur)) {
    const capa = capacityOf(cur, A.state), tot = Object.values(gathered).reduce((a, b) => a + b, 0), k = tot > capa ? capa / tot : 1;
    for (const r in gathered) { const v = Math.floor(gathered[r] * k); if (v > 0) loot[r] = v; }
    m.load = loot;
  }
  w.marches = w.marches.filter(x => x === m || !x.dead);
  pushReport(A.state, { kind: 'pvp', role: 'att', title: sum(cur) && won ? (o.k === 'post' ? 'Heer überfallen' : 'Sammler überfallen') : 'Überfall gescheitert', win: sum(cur) > 0 && won, target: info,
    att: { start: startA, left: cur, wounded: sa.wounded, dead: sa.dead }, def: { start: defStart, left: defLeft }, rounds: last ? last.rounds : [], loot,
    text: won ? 'Du hast ' + (sum(cur) ? 'die Sammler auf dem Feld besiegt.' : 'die Sammler besiegt, aber dein Heer wurde aufgerieben.') : 'Die Sammler haben dich zurückgeschlagen.' }, realT);
  note(ctx, A.id, 'battle', sum(cur) && won ? 'Überfall gelungen' : 'Überfall gescheitert', 'Dein Heer ' + (won ? 'hat die Sammler auf dem Feld besiegt.' : 'wurde auf dem Feld geschlagen.'));
  if (!sum(cur)) { m.dead = true; return; }
  return back();
}



/* ---------- Helfer in der Belagerung: Spieler (auch aus anderen Bündnissen) schicken Truppen auf Seite der Angreifer oder Verteidiger ---------- */
// Darf der Spieler dieser Belagerung auf der Seite helfen? Gibt die Belagerung zurück oder einen Fehlertext
export function checkAssist(ctx, me, tid, side, siegeId, defGroupHas) {
  const w = ctx.match.world;
  const sm = w.marches.find(g => !g.dead && g.phase === 'siege' && g.tid === String(tid) && (siegeId == null || g.id === Number(siegeId)));
  if (!sm) return 'Dort läuft gerade keine Belagerung.';
  if (side !== 'att' && side !== 'def') return 'Wähle eine Seite: Angreifer oder Verteidiger.';
  const att = byId(ctx.players, sm.owner);
  if (side === 'att') {
    if (defGroupHas(me)) return 'Du gehörst zu den Verteidigern.';
  } else {
    if (me.id === sm.owner || allied(w, me.id, sm.owner)) return 'Du kannst nicht gegen deinen eigenen Verbündeten verteidigen.';
  }
  if (!att) return 'Der Angreifer ist nicht mehr da.';
  return sm;
}
export function arriveAssist(ctx, m, bt, realT, back) {
  const { match, players } = ctx, w = match.world, P = byId(players, m.owner);
  const sm = w.marches.find(g => g.id === m.siegeId && !g.dead && g.phase === 'siege' && g.tSiege > bt);
  if (!sm) { pushReport(P.state, { kind: 'pvp', role: 'att', title: 'Zu spät', win: false, target: { kind: m.tk, id: m.tid }, text: 'Die Belagerung ist schon vorbei. Dein Heer kehrt um.' }, realT); return back(); }
  sm.aux = sm.aux || []; sm.aux.push({ pid: m.owner, side: m.side, troops: { ...m.troops } });
  m.dead = true;
  pushReport(P.state, { kind: 'pvp', role: m.side === 'att' ? 'att' : 'def', title: 'Truppen bei der Belagerung eingetroffen', win: true, target: { kind: m.tk, id: m.tid },
    text: 'Deine ' + sum(m.troops) + ' Truppen kämpfen auf Seite der ' + (m.side === 'att' ? 'Angreifer' : 'Verteidiger') + ', sobald die Belagerung endet.' }, realT);
}

// Belagerung: Greift ein Heer eine Burg oder einen Außenposten an, steht es nach der Ankunft SIEGE_TIME davor. Erst danach wird gekämpft.
// So bleibt dem Gegner Zeit zum Schutz, zum Verstärken und um Verbündete zu rufen. Gibt true zurück, wenn die Belagerung beginnt.
export function beginSiege(ctx, m, o, bt) {
  const { match, players } = ctx, w = match.world, A = byId(players, m.owner); if (!A) return false;
  const dur = fmtDur((m.mode === 'raid' ? SIEGE_OP_TIME : SIEGE_TIME) / match.speed);
  let title, text, who = [];
  if (m.mode === 'attack' && o && o.k === 'start') {
    const D = players.find(p => p.state.slot === o.slot);
    if (!D || D.state.out || allied(w, A.id, D.id) || isProtected(D.state, bt)) return false;
    who = [D.id]; const al = allianceOf(w, D.id); if (al) for (const id of al.members) if (id !== D.id) who.push(id);
    title = 'Belagerung deiner Burg!'; text = A.name + tag(w, A.id) + ' steht mit ' + sum(m.troops) + ' Truppen vor der Burg von ' + D.name + '. Der Angriff beginnt in ' + dur + '. Jetzt Truppen heimholen, Verbündete um Verstärkung bitten und die Burg ausbauen.';
    for (const id of who) if (id !== D.id) note(ctx, id, 'attack', 'Belagerung eines Verbündeten', A.name + ' steht vor der Burg von ' + D.name + ', der Angriff beginnt in ' + dur + '. Schick Verstärkung!');
    note(ctx, D.id, 'attack', title, text);
  } else if (m.mode === 'raid') {
    const op = (w.outposts || {})[m.tid], al = op && w.alliances[op.al]; if (!op || !al || allied(w, A.id, al.leader)) return false;
    if (al.members.includes(A.id)) return false;
    for (const id of al.members) note(ctx, id, 'attack', 'Belagerung eures Außenpostens!', A.name + tag(w, A.id) + ' steht mit ' + sum(m.troops) + ' Truppen vor einem Außenposten eures Bündnisses. Der Angriff beginnt in ' + dur + '. Schickt Besatzung hin!');
  } else return false;
  m.phase = 'siege'; m.sieged = true; m.tStart = bt; m.tSiege = bt + (m.mode === 'raid' ? SIEGE_OP_TIME : SIEGE_TIME);
  return true;
}
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
    m.dead = true;
    pushReport(A.state, { kind: 'pvp', role: 'att', title: 'Truppen bei ' + D.name + ' stationiert', win: true, target: info, text: 'Deine Truppen verteidigen jetzt die Burg von ' + D.name + '. Du kannst sie jederzeit zurückrufen.' }, realT);
    pushReport(D.state, { kind: 'pvp', role: 'def', title: 'Verstärkung von ' + A.name, win: true, target: info, text: A.name + ' hat ' + sum(m.troops) + ' Truppen in deine Burg gelegt. Sie helfen bei der Verteidigung.' }, realT);
    note(ctx, D.id, 'station', 'Verstärkung eingetroffen', A.name + ' hat ' + sum(m.troops) + ' Truppen in deine Burg gelegt.');
    return;
  }
  if (allied(w, A.id, D.id)) return turnBack('Ihr seid inzwischen verbündet. Das Heer kehrt um.');
  if (isProtected(D.state, bt)) return turnBack(D.name + ' steht inzwischen unter Schutz. Das Heer kehrt um.');

  // Verteidiger: Truppen zu Hause, stationierte Verbündete und die Stadtwache
  const SD = D.state, guard = guardOf(SD), homeStart = { ...SD.troops };
  for (const u in homeStart) if (!(homeStart[u] > 0)) delete homeStart[u];
  const total = merge(merge(homeStart, guard), {});
  for (const pid in SD.stationed) Object.assign(total, merge(total, SD.stationed[pid]));
  const auxA = auxOf(m, 'att'), auxD = auxOf(m, 'def'), attAll = merge({ ...m.troops }, sumAux(auxA));
  Object.assign(total, merge(total, sumAux(auxD)));
  const startA = { ...m.troops };
  const r = battle(attAll, total, wallMult(SD) * forceOf(SD), attMultOf(ctx, m, auxA));
  const fa = {}; for (const u in attAll) fa[u] = attAll[u] ? 1 - (r.attLeft[u] || 0) / attAll[u] : 0;
  const attScale = t => { const left = {}; for (const u in t) { const n = t[u] - Math.round(t[u] * (fa[u] || 0)); if (n > 0) left[u] = n; } return left; };
  const ownLeft = attScale(m.troops);
  const frac = {}; for (const u in total) frac[u] = total[u] ? 1 - (r.defLeft[u] || 0) / total[u] : 0;
  const scale = t => { const lost = {}; for (const u in t) { const l = r.win ? t[u] : Math.min(t[u], Math.round(t[u] * (frac[u] || 0))); if (l > 0) lost[u] = l; } return lost; };
  const homeLost = scale(homeStart), hs = settleHome(SD, homeLost);
  const groups = [{ label: 'Deine Truppen', start: homeStart, left: subTroops(homeStart, homeLost), wounded: hs.wounded, dead: hs.dead }];
  const allyGroups = [];
  for (const pid of Object.keys(SD.stationed)) {
    const P = byId(players, Number(pid)), st = SD.stationed[pid], lost = scale(st), left = subTroops(st, lost);
    if (P) {
      const sp = settleAway(P.state, st, left);
      allyGroups.push({ label: 'Verbündeter ' + P.name, start: st, left });
      if (sum(lost)) pushReport(P.state, { kind: 'pvp', role: 'ally', title: 'Deine Truppen bei ' + D.name + ' haben gekämpft', win: !r.win, target: info,
        text: A.name + ' griff die Burg von ' + D.name + ' an. Du hast ' + sum(lost) + ' Truppen verloren (' + sum(sp.wounded) + ' verwundet).' }, realT);
    }
    if (sum(left)) SD.stationed[pid] = left; else delete SD.stationed[pid];
  }
  for (const a of auxD) {   // Helfer der Verteidiger
    const P = byId(players, a.pid), lost = scale(a.troops), left = subTroops(a.troops, lost); allyGroups.push({ label: 'Helfer ' + (P ? P.name : ''), start: a.troops, left });
    if (P) { settleAux(ctx, a, left, [o.x, o.y], 'start', o.id); pushReport(P.state, { kind: 'pvp', role: 'ally', title: 'Deine Truppen bei ' + D.name + ' haben gekämpft', win: !r.win, target: info, text: 'Du hast ' + sum(lost) + ' Truppen verloren. Die Überlebenden marschieren heim.' }, realT); }
  }
  for (const a of auxA) {   // Helfer der Angreifer
    const P = byId(players, a.pid), left = attScale(a.troops);
    if (P) { settleAux(ctx, a, left, [o.x, o.y], 'start', o.id); pushReport(P.state, { kind: 'pvp', role: 'att', title: (r.win ? 'Sieg' : 'Niederlage') + ' bei der Belagerung von ' + D.name, win: r.win, target: info, text: 'Du hast ' + (sum(a.troops) - sum(left)) + ' von ' + sum(a.troops) + ' Truppen verloren. Die Überlebenden marschieren heim.' }, realT); }
  }
  const guardLost = scale(guard);
  groups.push(...allyGroups, { label: 'Stadtwache', start: guard, left: subTroops(guard, guardLost) });
  const sa = settleAway(A.state, startA, ownLeft);
  m.troops = ownLeft; m.aux = [];
  const killed = sum(homeLost) + sum(guardLost) + allyGroups.reduce((a, g) => a + sum(g.start) - sum(g.left), 0);
  A.state.stats.kills += killed; if (r.win) A.state.stats.wins++;

  let fate = null, loot = {};
  if (r.win) {
    loot = lootFrom(SD, capacityOf(ownLeft, A.state)); m.load = loot;
    fate = fall(ctx, A, D, bt);
  }
  const fateText = fate === 'out' ? ' Die Burg wurde erobert, ' + D.name + ' ist ausgeschieden.' : fate === 'vassal' ? ' Die Burg wurde erobert, ' + D.name + ' ist jetzt dein Vasall.' : '';
  pushReport(A.state, { kind: 'pvp', role: 'att', title: (r.win ? 'Sieg über die Burg von ' : 'Niederlage vor der Burg von ') + D.name, win: r.win, target: info, fate,
    att: { start: startA, left: ownLeft, wounded: sa.wounded, dead: sa.dead }, def: { start: total, left: r.defLeft, groups }, rounds: r.rounds, loot, text: fateText.trim() }, realT);
  pushReport(SD, { kind: 'pvp', role: 'def', title: (r.win ? 'Burg gefallen: ' : 'Angriff abgewehrt: ') + A.name, win: !r.win, target: info, fate,
    att: { start: startA, left: ownLeft }, def: { start: total, left: r.defLeft, groups }, rounds: r.rounds, loot,
    text: r.win ? (fate === 'out' ? 'Deine Burg ist gefallen. Du bist ausgeschieden.' : 'Deine Burg ist gefallen. Du bist jetzt Vasall von ' + A.name + '.') : 'Deine Verteidiger haben ' + A.name + ' zurückgeschlagen.' }, realT);
  note(ctx, D.id, 'battle', r.win ? (fate === 'out' ? 'Du bist ausgeschieden' : 'Deine Burg ist gefallen') : 'Angriff abgewehrt', A.name + (r.win ? ' hat deine Burg erobert.' : ' wurde zurückgeschlagen.'));
  note(ctx, A.id, 'battle', r.win ? 'Burg erobert' : 'Angriff gescheitert', 'Dein Heer ' + (r.win ? 'hat die Burg von ' + D.name + ' genommen.' : 'wurde vor der Burg von ' + D.name + ' geschlagen.'));
  if (r.win) { const al = allianceOf(w, D.id); if (al) for (const id of al.members) if (id !== D.id) note(ctx, id, 'battle', 'Verbündeter gefallen', D.name + ' wurde von ' + A.name + ' erobert.'); }
  if (!sum(m.troops)) { m.dead = true; return; }
  back();
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
export function recallStation(ctx, me, hostId) {
  const H = byId(ctx.players, hostId); if (!H || !H.state.stationed[me.id]) return 'Du hast dort keine Truppen.';
  const t = H.state.stationed[me.id]; delete H.state.stationed[me.id];
  sendHome(ctx, me, t, H.state.pos); return '';
}
export function dismissStation(ctx, me, ownerId) {
  const O = byId(ctx.players, ownerId); if (!O || !me.state.stationed[ownerId]) return 'Von diesem Spieler stehen keine Truppen bei dir.';
  const t = me.state.stationed[ownerId]; delete me.state.stationed[ownerId];
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
    hold.garr[A.id] = merge(hold.garr[A.id] || {}, m.troops); m.dead = true;
    pushReport(A.state, { kind: 'hold', title: holdName(o) + ': Truppen angekommen', win: true, target: info, text: 'Deine Truppen verstärken die Besatzung.' }, realT);
    return;
  }
  const guard = holdGuard(o.k), def = hold ? sumGarr(hold) : guard.troops, mult = hold ? 1 : guard.mult, startA = { ...m.troops };
  const r = battle(m.troops, def, mult, forceOf(A.state)), sa = settleAway(A.state, startA, r.attLeft);
  m.troops = r.attLeft; A.state.stats.kills += sum(def) - sum(r.defLeft); if (r.win) A.state.stats.wins++;
  const defender = hold ? groupLabel(w, players, hold.group) : 'Wächter';
  if (r.win) {
    if (hold) for (const pid of Object.keys(hold.garr)) {
      const P = byId(players, Number(pid)); if (!P) continue;
      const sp = settleAway(P.state, hold.garr[pid], {});
      pushReport(P.state, { kind: 'hold', title: holdName(o) + ' verloren', win: false, target: info, text: A.name + ' hat die Besatzung geschlagen. Du hast ' + sum(hold.garr[pid]) + ' Truppen verloren (' + sum(sp.wounded) + ' verwundet).' }, realT);
      note(ctx, P.id, 'hold', holdName(o) + ' verloren', A.name + tag(w, A.id) + ' hat deine Besatzung geschlagen.');
    }
    w.holds[o.id] = { group, since: bt, garr: { [A.id]: { ...r.attLeft } } }; m.dead = true;
    chron(ctx, groupLabel(w, players, group) + ' hält jetzt ' + holdName(o) + '.');
    for (const p of groupMembers(w, players, group)) note(ctx, p.id, 'hold', holdName(o) + ' erobert', A.name + ' hat ' + holdName(o) + ' für ' + groupLabel(w, players, group) + ' eingenommen.');
  } else if (hold) {
    const frac = {}; for (const u in def) frac[u] = def[u] ? 1 - (r.defLeft[u] || 0) / def[u] : 0;
    for (const pid of Object.keys(hold.garr)) {
      const P = byId(players, Number(pid)), st = hold.garr[pid], left = {};
      for (const u in st) { const n = st[u] - Math.round(st[u] * (frac[u] || 0)); if (n > 0) left[u] = n; }
      if (P) settleAway(P.state, st, left);
      if (sum(left)) hold.garr[pid] = left; else delete hold.garr[pid];
      if (P) note(ctx, P.id, 'hold', holdName(o) + ' verteidigt', A.name + ' hat angegriffen und wurde zurückgeschlagen.');
    }
    if (!Object.keys(hold.garr).length) delete w.holds[o.id];
  }
  pushReport(A.state, { kind: 'hold', title: (r.win ? 'Sieg: ' : 'Niederlage: ') + holdName(o), win: r.win, target: info,
    att: { start: startA, left: r.attLeft, wounded: sa.wounded, dead: sa.dead }, def: { start: def, left: r.defLeft }, rounds: r.rounds, defLabel: defender,
    text: r.win ? 'Deine Truppen halten jetzt ' + holdName(o) + '. Sie bleiben dort, bis du sie zurückrufst.' : '' }, realT);
  if (!r.win) { if (!sum(m.troops)) m.dead = true; else back(); }
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
export const scoreOf = S => S.out ? 0 : Math.round(Object.keys(S.lv).reduce((a, k) => a + S.lv[k], 0) * 10 + troopCount(S) * 2 + S.stats.conquests * 200 + S.stats.kills * 0.5);
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
