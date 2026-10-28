// Zehn Kronen – Ablauf der Partie: Spielzeit, Märsche, Sammeln, Kämpfe, Befehle und die Sicht jedes Spielers.
// Läuft auf dem Server (maßgeblich) und in der Testversion im Browser. Die Spielzeit der Welt läuft in
// "Spielsekunden" (gt); echte Zeit * Tempo = Spielzeit. Alle Ereignisse werden in zeitlicher Reihenfolge
// abgearbeitet, egal wann ein Spieler das nächste Mal nachfragt.
import { N, startSpot, SLOTS, NODE_RES, NODE_KINDS } from './mapgen.js';
import { U, freshState, advanceTo, applyCommand, armySlots } from './rules.js';
import { battle, campTroops, campMult, campLoot, sum, capacityOf, forceOf } from './combat.js';
import {
  DAY, GATHER_SEC, CAMP_RESPAWN, VIEW_CITY, VIEW_ARMY, allianceCap, mapOf, newWorld, ensureWorld, ensureState, nodeLeft, NODE_EMPTY, campAlive,
  reveal, flushBits, planMarch, marchPos, nextT, reversed, launch, addTroops, pushReport, note, chron, byId, allianceOf, groupLabel, groupOf,
  settleAway, fmtDur, cellXY, planFrom, allied, isProtected
} from './core.js';
import { siegeStrength, abortFight, fightStart, beginSiege, arriveAssist, checkAssist, afterLaunch, applyBonuses, arriveCity, arriveField, arriveHold, checkEnd, checkLaunch, dismissStation, holdRecall, protectNew, purge, rankingOf, recallStation, spy, vassalStep } from './war.js';
import { socialCommand } from './social.js';
import { releaseAux, opReady, refreshRoads, arriveBuild, arriveGarrison, arriveRaid, checkBuild, SITE_OK, checkRaid, checkGarrison, noteRaid, OP_COST, recallGarrison, moveGarrison, dismantle, settleTerritory, donate, teleport, refundStore, clanGather, clanIncome, clanFields, FIELD_INCOME, storeOf } from './outpost.js';
import { RES, gatherFinds, findsText } from './rules.js';

const mkCtx = (match, players, now) => ({ match, players, now, realT: now, bt: null });

/* ---------- Ereignisse ---------- */
function onArrive(ctx, m, bt, realT) {
  const { match, players } = ctx, w = match.world, map = mapOf(match), o = map.byId[m.tid];
  const p = byId(players, m.owner);
  if (!p) { m.dead = true; return; }
  const S = p.state;
  advanceTo(S, realT, match.speed);
  const back = () => { m.phase = 'back'; m.t0 = bt; reversed(m); };
  if (m.mode === 'post') { m.phase = 'post'; return; }
  if (m.mode === 'attack' && m.tk === 'post') { const [px, py] = cellXY(m.path[m.path.length - 1]); return arriveField(ctx, m, { k: 'post', id: m.tid, x: px, y: py }, bt, realT, back); }
  if (m.mode === 'build') return arriveBuild(ctx, m, bt, realT, back);
  if (m.mode === 'assist') return arriveAssist(ctx, m, bt, realT, back);
  if (!m.sieged && beginSiege(ctx, m, o, bt)) return;
  if (m.mode === 'garrison') return arriveGarrison(ctx, m, bt, realT, back);
  if (m.mode === 'raid') return arriveRaid(ctx, m, bt, realT, back);
  if (m.mode === 'attack' && NODE_KINDS.includes(o.k)) return arriveField(ctx, m, o, bt, realT, back);
  if (m.mode === 'attack' || m.mode === 'station') return arriveCity(ctx, m, o, bt, realT, back);
  if (m.mode === 'occupy') return arriveHold(ctx, m, o, bt, realT, back);
  const info = { kind: o.k, id: o.id, lv: o.lv, x: o.x, y: o.y };
  if (NODE_KINDS.includes(o.k)) {
    if (w.marches.some(g => g !== m && !g.dead && g.tid === o.id && g.phase === 'gather')) {
      pushReport(S, { kind: 'gather', title: 'Feld besetzt', win: false, target: info, text: 'Hier sammelt schon ein anderes Heer. Dein Heer kehrt ohne Beute zurück.' }, realT);
      return back();
    }
    const left = nodeLeft(w, o, bt), cap = capacityOf(m.troops, S), amount = Math.floor(Math.min(cap, left));
    if (amount < NODE_EMPTY) {
      pushReport(S, { kind: 'gather', title: 'Feld erschöpft', win: false, target: info, text: 'Das Feld ist fast leer. Das Heer kehrt ohne Beute zurück.' }, realT);
      return back();
    }
    w.nodes[o.id] = { left: left, t: bt };
    m.phase = 'gather'; m.tStart = bt; m.tEnd = bt + GATHER_SEC * amount; m.amount = amount; m.res = NODE_RES[o.k];
    return;
  }
  if (o.k === 'camp') {
    if (!campAlive(w, o.id, bt)) {
      pushReport(S, { kind: 'camp', title: 'Lager bereits zerstört', win: false, target: info, text: 'Hier war schon jemand schneller. Das Lager baut sich in einigen Stunden wieder auf.' }, realT);
      return back();
    }
    const def = campTroops(o.lv), start = { ...m.troops };
    const r = battle(m.troops, def, campMult(o.lv), forceOf(S));
    const sa = settleAway(S, start, r.attLeft);
    S.stats.kills += sum(def) - sum(r.defLeft); if (r.win) S.stats.wins++;
    const rep = { kind: 'camp', title: (r.win ? 'Sieg über Banditenlager Stufe ' : 'Niederlage vor Banditenlager Stufe ') + o.lv, win: r.win, target: info,
      att: { start, left: r.attLeft, wounded: sa.wounded, dead: sa.dead }, def: { start: def, left: r.defLeft }, rounds: r.rounds };
    m.troops = r.attLeft;
    if (r.win) { const loot = campLoot(o.lv); m.load = loot; rep.loot = loot; w.camps[o.id] = { dead: bt + CAMP_RESPAWN }; }
    pushReport(S, rep, realT);
    if (!Object.keys(m.troops).length) { m.dead = true; return; }
    return back();
  }
  if (o.k === 'ruin') {
    if (w.ruins[o.id]) { pushReport(S, { kind: 'ruin', title: 'Ruine bereits geplündert', win: false, target: info, text: 'Hier gibt es nichts mehr zu holen.' }, realT); return back(); }
    w.ruins[o.id] = 1;
    const loot = { food: 200 * o.lv, wood: 200 * o.lv, stone: 600 * o.lv, gold: 150 * o.lv };
    m.load = loot;
    pushReport(S, { kind: 'ruin', title: 'Ruine erkundet', win: true, target: info, loot, text: 'Zwischen den alten Mauern lagen noch Vorräte.' }, realT);
    return back();
  }
  back();
}
function onGatherEnd(ctx, m, bt, realT) {
  const { match, players } = ctx, w = match.world, o = mapOf(match).byId[m.tid], p = byId(players, m.owner);
  if (!p) { m.dead = true; return; }
  advanceTo(p.state, realT, match.speed);
  const n = w.nodes[o.id] || { left: nodeLeft(w, o, bt), t: bt };
  { const rest = n.left - m.amount; w.nodes[o.id] = { left: rest < NODE_EMPTY ? 0 : rest, t: bt }; }
  m.load = { [m.res]: m.amount };
  clanGather(ctx, m, o, bt);
  const found = gatherFinds(p.state, m.id, m.tEnd - m.tStart); if (Object.keys(found).length) note(ctx, p.id, 'gather', 'Beschleuniger gefunden', 'Beim Sammeln hat dein Heer ' + findsText(found) + ' gefunden.');
  m.phase = 'back'; m.t0 = bt; reversed(m);
}
function onHome(ctx, m, bt, realT) {
  const { match, players } = ctx, p = byId(players, m.owner); m.dead = true;
  if (!p) return;
  if (m.redir) {   // umgeleitetes Heer: vom Ausgangspunkt (Posten oder Außenposten) noch nach Hause laufen
    const here = m.path[m.path.length - 1], plan = planFrom(mapOf(match), cellXY(here), p.state.pos[0], p.state.pos[1], m.troops, p.state);
    if (!plan.error && plan.path.length > 1) { m.path = plan.path; m.arr = plan.arr; m.phase = 'back'; m.t0 = bt; m.mode = 'home'; m.tk = 'start'; delete m.redir; m.dead = false; return; }
  }
  const S = p.state; advanceTo(S, realT, match.speed);
  addTroops(S, m.troops, +1);
  for (const u in m.troops) { S.away[u] = (S.away[u] || 0) - m.troops[u]; if (S.away[u] <= 0) delete S.away[u]; }
  const load = { ...(m.carry || {}) }; for (const r in (m.load || {})) load[r] = (load[r] || 0) + m.load[r];
  for (const r of Object.keys(load)) S.res[r] = (S.res[r] || 0) + load[r];
  if (Object.keys(load).length) pushReport(S, { kind: 'return', title: 'Heer zurück mit Beute', win: true, loot: load, target: { kind: m.tk, id: m.tid } }, realT);
}

/* ---------- Welt auf neue Kartengröße bringen (alte Partien) ---------- */
function migrate(ctx) {
  const w = ctx.match.world;
  if (w.n === N) return;
  w.n = N; w.nodes = {}; w.camps = {}; w.ruins = {}; w.marches = []; w.holds = {}; w.nextId = 1;
  for (const p of ctx.players) {
    const S = p.state;
    if (S.slot >= 0) S.pos = startSpot(S.slot);
    S.explored = ''; for (const u in S.away) S.troops[u] = (S.troops[u] || 0) + S.away[u];
    S.away = {}; S.stationed = {};
  }
}

/* ---------- Abgleich der ganzen Partie ---------- */
export function syncMatch(match, players, now) {
  if (!match.world) match.world = newWorld(now, { phase: 'running' });
  const w = ensureWorld(match.world), ctx = mkCtx(match, players, now);
  for (const p of players) ensureState(p.state);
  migrate(ctx); refreshRoads(match, players, w.gt);
  if (w.phase !== 'running') { w.at = now; for (const p of players) p.state.at = now; return { events: 0 }; }
  const speed = match.speed, target = w.gt + Math.max(0, now - w.at) / 1000 * speed;
  let events = 0;
  for (let guard = 0; guard < 5000; guard++) {
    let best = null, bt = Infinity;
    for (const m of w.marches) { if (m.dead) continue; const t = nextT(m); if (t < bt) { bt = t; best = m; } }
    if (!best || bt > target) break;
    const realT = w.at + (bt - w.gt) / speed * 1000;
    ctx.realT = realT; ctx.bt = bt;
    if (best.phase === 'out' || best.phase === 'siege') onArrive(ctx, best, bt, realT);
    else if (best.phase === 'gather') onGatherEnd(ctx, best, bt, realT);
    else onHome(ctx, best, bt, realT);
    events++;
    if (best.dead) w.marches = w.marches.filter(m => m !== best);
    if (checkEnd(ctx, bt)) { w.gt = bt; w.at = realT; ctx.bt = null; return { events }; }
  }
  ctx.bt = null; ctx.realT = now;
  const dt = Math.max(0, target - w.gt);
  w.gt = target; w.at = now;
  settleTerritory(ctx);
  clanIncome(ctx, dt);
  applyBonuses(ctx);
  for (const p of players) { advanceTo(p.state, now, speed); }
  vassalStep(ctx, dt, w.gt);
  for (const p of players) {   // Schutz läuft bald aus: einmal Bescheid geben
    const S = p.state;
    if (S.protKind === 'new' && !S.protWarn && S.protUntil > w.gt && S.protUntil - w.gt <= 12 * 3600 && S.slot >= 0 && !S.out) {
      S.protWarn = true; events++;
      note(ctx, p.id, 'protect', 'Dein Schutz endet bald', 'Noch ' + fmtDur((S.protUntil - w.gt) / speed) + ', dann können dich andere Spieler angreifen.');
    }
    if (S.slot >= 0 && !S.out) reveal(S, S.pos[0] + .5, S.pos[1] + .5, VIEW_CITY);
    const al0 = allianceOf(w, p.id);   // Bündnismitglieder sehen die Burgen der anderen samt deren Aufdeck-Radius
    if (al0) for (const id of al0.members) { if (id === p.id) continue; const q = byId(players, id); if (q && q.state.slot >= 0 && !q.state.out) reveal(S, q.state.pos[0] + .5, q.state.pos[1] + .5, VIEW_CITY); }
  }
  for (const m of w.marches) {
    const p = byId(players, m.owner); if (!p) continue;
    const pos = marchPos(m, w.gt);
    reveal(p.state, pos.x, pos.y, VIEW_ARMY);
  }
  for (const p of players) flushBits(p.state);
  if (checkEnd(ctx, w.gt)) events++;
  return { events };
}

/* ---------- Spieler und Partiesteuerung ---------- */
export function addPlayer(match, players, id, name, now) {
  syncMatch(match, players, now);
  const w = match.world;
  if (w.phase === 'ended') return null;
  const used = new Set(players.map(p => p.state.slot));
  let slot = -1; for (let i = 0; i < SLOTS; i++) if (!used.has(i)) { slot = i; break; }
  if (slot < 0) return null;
  const S = ensureState(freshState(now)); S.slot = slot; S.pos = startSpot(slot);
  if (w.phase !== 'lobby') protectNew(S, w.gt);
  reveal(S, S.pos[0] + .5, S.pos[1] + .5, VIEW_CITY); flushBits(S);
  chron(mkCtx(match, players, now), name + ' ist der Partie beigetreten.');
  return S;
}
export function setSpeed(match, players, speed, now) { syncMatch(match, players, now); match.speed = speed; }
export function setWeeks(match, players, weeks, now) {
  syncMatch(match, players, now); const w = match.world;
  w.weeks = Math.max(1, Math.min(52, Math.round(weeks) || 10));
}
export function startMatch(match, players, now) {
  syncMatch(match, players, now); const w = match.world, ctx = mkCtx(match, players, now);
  if (w.phase !== 'lobby') return 'Die Partie läuft schon.';
  w.phase = 'running'; w.startGt = w.gt; w.endGt = 0; w.at = now;
  for (const p of players) { p.state.at = now; protectNew(p.state, w.gt); }
  chron(ctx, 'Die Partie beginnt.');
  for (const p of players) note(ctx, p.id, 'start', 'Die Partie beginnt', 'Dein Schutz vor Angriffen dauert ' + fmtDur(4 * DAY / match.speed) + '.');
  return '';
}
export function pauseMatch(match, players, now) {
  syncMatch(match, players, now); const w = match.world;
  if (w.phase !== 'running') return 'Die Partie läuft nicht.';
  w.phase = 'paused'; return '';
}
export function resumeMatch(match, players, now) {
  const w = match.world; if (w.phase !== 'paused') return 'Die Partie ist nicht pausiert.';
  w.phase = 'running'; w.at = now; for (const p of players) p.state.at = now; return '';
}
export function endMatch(match, players, now) {
  syncMatch(match, players, now); const ctx = mkCtx(match, players, now);
  if (match.world.phase !== 'running' && match.world.phase !== 'paused') return 'Die Partie ist nicht aktiv.';
  match.world.phase = 'running'; checkEnd(ctx, match.world.gt, true); return '';
}
// Spieler (Admin) aus der Partie nehmen: Verbündete bekommen ihre Truppen zurück
export function removePlayer(match, players, pid, now) {
  syncMatch(match, players, now); purge(mkCtx(match, players, now), pid);
}

// Zelle, auf der ein stehendes oder laufendes Heer gerade ist
function curCell(m, gt) {
  if (m.phase === 'post' || m.phase === 'gather' || m.phase === 'siege') return m.path[m.path.length - 1];
  const p = marchPos(m, gt); return m.path[Math.min(m.path.length - 1, p.i + (p.frac >= .5 ? 1 : 0))];
}
// Heer von seinem jetzigen Ort nach Hause schicken (neu geplanter Weg)
function sendBack(ctx, player, m, gt) {
  const S = player.state, plan = planFrom(mapOf(ctx.match), cellXY(curCell(m, gt)), S.pos[0], S.pos[1], m.troops, S);
  if (plan.error) return plan.error;
  m.path = plan.path; m.arr = plan.arr; m.phase = 'back'; m.t0 = gt; m.mode = 'home'; m.tk = 'start'; delete m.redir;
  return '';
}

/* ---------- Befehle ---------- */
export function command(match, players, player, cmd, now) {
  syncMatch(match, players, now); refreshRoads(match, players, match.world.gt);
  const S = player.state, w = match.world, ctx = mkCtx(match, players, now);
  if (!cmd || typeof cmd !== 'object') return 'Ungültiger Befehl';
  if (cmd.type === 'readReports') { S.reports.forEach(r => { r.read = true; }); return ''; }
  if (cmd.type === 'readFeed') { S.feedSeen = S.nextFeed - 1; return ''; }
  if (cmd.type === 'globalChat') {   // Weltchat: alle Spieler der Partie
    if (S.out) return 'Du bist ausgeschieden.';
    const text = String(cmd.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return 'Leere Nachricht.';
    w.chat = w.chat || []; w.nextMsg = w.nextMsg || 1;
    const nowT = Math.round(ctx.realT || ctx.now || Date.now()), last = [...w.chat].reverse().find(m => m.pid === player.id);
    if (last && nowT - last.t < 1500) return 'Bitte etwas langsamer.';
    const al = allianceOf(w, player.id);
    w.chat.push({ id: w.nextMsg++, t: nowT, pid: player.id, name: player.name, tag: al ? al.tag : '', text });
    if (w.chat.length > 100) w.chat.splice(0, w.chat.length - 100);
    return '';
  }
  if (S.out) return 'Du bist ausgeschieden und kannst die Partie nur noch verfolgen.';
  if (w.phase === 'ended') return 'Die Partie ist beendet.';
  if (typeof cmd.type === 'string' && cmd.type.startsWith('ally')) return socialCommand(ctx, player, cmd);
  if (w.phase === 'lobby') return 'Die Partie hat noch nicht begonnen.';
  if (w.phase === 'paused') return 'Die Partie ist pausiert.';

  if (cmd.type === 'march') {
    const map = mapOf(match), mode = cmd.mode || 'normal';
    if (!['normal', 'attack', 'station', 'occupy', 'build', 'garrison', 'raid', 'post', 'assist'].includes(mode)) return 'Unbekannte Marschart';
    let o = map.byId[String(cmd.target)], opx = null;
    if (mode === 'build') { const x = Math.floor(Number(cmd.x)), y = Math.floor(Number(cmd.y)); o = { k: 'site', id: 'site' + x + '_' + y, x, y }; }
    else if (mode === 'post') { const x = Math.floor(Number(cmd.x)), y = Math.floor(Number(cmd.y)); o = { k: 'post', id: 'post' + x + '_' + y, x, y }; }
    else if (mode === 'attack' && String(cmd.target).startsWith('post')) { const pm = w.marches.find(g => !g.dead && g.phase === 'post' && g.tid === String(cmd.target)); o = pm ? { k: 'post', id: pm.tid, x: pm.site.x, y: pm.site.y } : null; }
    else if (mode === 'assist') {
      const t = String(cmd.target), bo = map.byId[t];
      if (bo && bo.k === 'start') { const Dp = players.find(p => p.state.slot === bo.slot); o = Dp ? { ...bo, x: Dp.state.pos[0], y: Dp.state.pos[1] } : null; }
      else { opx = (w.outposts || {})[t]; o = opx ? { k: 'outpost', id: opx.id, x: opx.x, y: opx.y } : null; }
    }
    else if (mode === 'garrison' || mode === 'raid') { opx = (w.outposts || {})[String(cmd.target)]; o = opx ? { k: 'outpost', id: opx.id, x: opx.x, y: opx.y } : null; }
    if (!o) return 'Dieses Ziel gibt es nicht';
    if (mode === 'normal' && !(NODE_KINDS.includes(o.k) || o.k === 'camp' || o.k === 'ruin')) return 'Dieses Ziel gibt es nicht';
    let fromOp = null;
    if (cmd.fromOp != null) {
      const al0 = allianceOf(w, player.id); fromOp = (w.outposts || {})[String(cmd.fromOp)];
      if (!fromOp || !al0 || fromOp.al !== al0.id || !opReady(fromOp, w.gt)) return 'Dieser Außenposten steht nicht zur Verfügung';
      if (!fromOp.garr[player.id] || !sum(fromOp.garr[player.id])) return 'Du hast dort keine Truppen';
      if (mode === 'build') return 'Aus dem Außenposten kann man keinen neuen bauen';
      if (mode === 'garrison' && opx && opx.id === fromOp.id) return 'Die Truppen sind schon dort';
    }
    const src = cmd.from != null ? w.marches.find(x => x.id === Number(cmd.from) && x.owner === player.id && !x.dead && (['post', 'gather', 'back', 'siege'].includes(x.phase) || (x.phase === 'out' && x.mode !== 'build'))) : null;
    if (cmd.from != null && !src) return 'Dieses Heer kann gerade nicht umgeleitet werden';
    if (!src && w.marches.filter(m => m.owner === player.id).length >= armySlots(S)) return 'Alle Heere sind unterwegs (' + armySlots(S) + ')';
    if (src && (src.phase === 'post' || src.phase === 'gather') && o.id === src.tid) return 'Das Heer ist schon dort';
    const troops = src ? { ...src.troops } : {};
    if (!src) for (const u of Object.keys(U)) {
      const n = Math.floor(Number((cmd.troops || {})[u] || 0));
      if (n < 0 || !Number.isFinite(n)) return 'Ungültige Truppenzahl';
      if (n > ((fromOp ? fromOp.garr[player.id] : S.troops)[u] || 0)) return 'So viele ' + U[u].name + (fromOp ? ' stehen dort nicht' : ' hast du nicht zu Hause');
      if (n > 0) troops[u] = n;
    }
    if (troops.handkarren && sum(troops) === troops.handkarren) return 'Handkarren können nicht allein losziehen – schicke andere Einheiten mit.';
    let target = null, assistSiege = null, assistSide = '';
    if (mode === 'build' || mode === 'garrison' || mode === 'raid') {
      if (!sum(troops)) return 'Keine Truppen ausgewählt';
      if (mode === 'build') {
        const why = checkBuild(match, players, player, o.x, o.y, troops, w.gt); if (why) return why;
      } else if (mode === 'garrison') { const why = checkGarrison(ctx, player, opx); if (why) return why; }
      else { const why = checkRaid(ctx, player, opx); if (why) return why; }
    } else if (mode === 'assist') {
      if (!sum(troops)) return 'Keine Truppen ausgewählt';
      const side = cmd.side === 'def' ? 'def' : 'att', Dp = o.k === 'start' ? players.find(p => p.state.slot === map.byId[o.id].slot) : null, alD = opx ? w.alliances[opx.al] : null;
      const inDef = pl => Dp ? (pl.id === Dp.id || allied(w, pl.id, Dp.id)) : !!(alD && alD.members.includes(pl.id));
      assistSiege = checkAssist(ctx, player, o.id, side, cmd.siege, inDef); if (typeof assistSiege === 'string') return assistSiege;
      assistSide = side;
    } else if (mode === 'post') {
      if (!sum(troops)) return 'Keine Truppen ausgewählt';
      if (!SITE_OK(map, o.x, o.y) || !map.pass[o.y * N + o.x]) return 'Hier kann man kein Heer aufstellen (Wasser, Fels oder außerhalb der Karte).';
    } else if (mode === 'normal') {
      if (o.k === 'camp' && !campAlive(w, o.id, w.gt)) return 'Dieses Lager ist gerade zerstört';
      if (o.k === 'ruin' && w.ruins[o.id]) return 'Diese Ruine ist schon geplündert';
      if (NODE_KINDS.includes(o.k) && nodeLeft(w, o, w.gt) < NODE_EMPTY) return 'Dieses Feld ist erschöpft';
      if (NODE_KINDS.includes(o.k) && w.marches.some(g => g !== src && !g.dead && g.tid === o.id && !g.mode && g.phase !== 'back')) return 'Auf diesem Feld sammelt schon ein Heer (oder ist unterwegs dorthin).';
    } else {
      if (!sum(troops)) return 'Keine Truppen ausgewählt';
      const c = checkLaunch(ctx, player, o, mode, troops); if (typeof c === 'string') return c;
      target = c.target || null;
    }
    if (target && o.k === 'start') o = { ...o, x: target.state.pos[0], y: target.state.pos[1] };
    const plan = src ? planFrom(map, cellXY(curCell(src, w.gt)), o.x, o.y, troops, S) : fromOp ? planFrom(map, [fromOp.x, fromOp.y], o.x, o.y, troops, S) : planMarch(map, S, o, troops);
    if (plan.error) return plan.error;
    if (assistSiege && w.gt + plan.arr[plan.arr.length - 1] >= fightStart(assistSiege)) return 'Zu spät: Die Belagerung ist vorbei, bevor deine Truppen ankommen.';
    let carry = null;
    if (src) {
      abortFight(ctx, player, src, w.gt); if (src.dead) { w.marches.splice(w.marches.indexOf(src), 1); syncMatch(match, players, now); return ''; }
      if (src.aux && src.aux.length) releaseAux(ctx, src);
      if (src.phase === 'gather') {   // bisher Gesammeltes nimmt das Heer mit
        const go = map.byId[src.tid], frac = Math.max(0, Math.min(1, (w.gt - src.tStart) / (src.tEnd - src.tStart || 1)));
        const amount = Math.floor(src.amount * frac), n = w.nodes[go.id] || { left: nodeLeft(w, go, w.gt), t: w.gt }, rest = n.left - amount;
        w.nodes[go.id] = { left: rest < NODE_EMPTY ? 0 : rest, t: w.gt };
        if (amount > 0) src.load = { [src.res]: amount };
        gatherFinds(S, src.id, (w.gt - src.tStart));
      }
      carry = {}; for (const l of [src.carry, src.load]) for (const r in (l || {})) carry[r] = (carry[r] || 0) + l[r];
      w.marches.splice(w.marches.indexOf(src), 1);
    }
    else if (fromOp) { const g = fromOp.garr[player.id]; for (const u in troops) { g[u] -= troops[u]; if (g[u] <= 0) delete g[u]; } if (!sum(g)) delete fromOp.garr[player.id]; }
    else for (const u in troops) { S.troops[u] -= troops[u]; S.away[u] = (S.away[u] || 0) + troops[u]; }
    if (mode === 'build') { const st = storeOf(allianceOf(w, player.id)); RES.forEach((r, i) => { st[r] -= OP_COST[i]; }); }
    const m = launch(ctx, player, troops, plan, mode === 'normal' ? { tk: o.k, tid: o.id } : mode === 'build' ? { tk: 'site', tid: o.id, mode, site: { x: o.x, y: o.y } } : mode === 'post' ? { tk: 'post', tid: o.id, mode, site: { x: o.x, y: o.y } } : mode === 'assist' ? { tk: o.k, tid: o.id, mode, side: assistSide, siegeId: assistSiege.id } : { tk: o.k, tid: o.id, mode });
    if (src || fromOp) m.redir = true;
    if (carry && Object.keys(carry).length) m.carry = carry;
    if (mode === 'assist' && assistSide === 'att') { if (isProtected(S, w.gt)) S.protUntil = w.gt; S.stats.attacks++; }
    if (mode === 'raid') noteRaid(ctx, player, opx, m);
    else if (mode !== 'normal' && mode !== 'build' && mode !== 'garrison' && mode !== 'post' && mode !== 'assist') afterLaunch(ctx, player, m, target, mode);
    syncMatch(match, players, now);
    return '';
  }
  if (cmd.type === 'recall') {
    const m = w.marches.find(x => x.id === Number(cmd.id) && x.owner === player.id);
    if (!m) return 'Dieses Heer gibt es nicht';
    if (m.phase === 'back') return 'Das Heer ist schon auf dem Rückweg';
    abortFight(ctx, player, m, w.gt); if (m.dead) { w.marches = w.marches.filter(x => x !== m); return ''; }
    if (m.aux && m.aux.length) releaseAux(ctx, m);
    if (m.phase === 'post') { m.load = {}; return sendBack(ctx, player, m, w.gt); }
    if (m.phase === 'gather') {
      const o = mapOf(match).byId[m.tid], frac = Math.max(0, Math.min(1, (w.gt - m.tStart) / (m.tEnd - m.tStart || 1)));
      const amount = Math.floor(m.amount * frac), n = w.nodes[o.id] || { left: nodeLeft(w, o, w.gt), t: w.gt };
      { const rest = n.left - amount; w.nodes[o.id] = { left: rest < NODE_EMPTY ? 0 : rest, t: w.gt }; }
      m.load = amount > 0 ? { [m.res]: amount } : {};
      gatherFinds(player.state, m.id, (w.gt - m.tStart));
      m.phase = 'back'; m.t0 = w.gt; reversed(m);
    } else if (m.redir) { m.load = {}; return sendBack(ctx, player, m, w.gt);
    } else {
      const el = Math.max(0, w.gt - m.t0); let i = 0; while (i < m.path.length - 1 && m.arr[i + 1] <= el) i++;
      const a0 = m.arr[i]; m.path = m.path.slice(0, i + 1).reverse(); m.arr = m.arr.slice(0, i + 1).map((_, j) => a0 - m.arr[i - j]);
      m.phase = 'back'; m.t0 = w.gt; m.load = {};
      if (m.mode === 'build') { const al = allianceOf(w, player.id); if (al) refundStore(w, al.id); }
      if (m.path.length < 2) { m.path = [m.path[0], m.path[0]]; m.arr = [0, 1]; }
    }
    return '';
  }
  if (cmd.type === 'halt') {
    const m = w.marches.find(x => x.id === Number(cmd.id) && x.owner === player.id && !x.dead);
    if (!m) return 'Dieses Heer gibt es nicht';
    if (m.phase !== 'out' || m.mode === 'build') return 'Dieses Heer kann gerade nicht anhalten';
    const c = curCell(m, w.gt), [hx, hy] = cellXY(c);
    m.path = [c, c]; m.arr = [0, 1]; m.phase = 'post'; m.mode = 'post'; m.tk = 'post'; m.tid = 'post' + hx + '_' + hy; m.site = { x: hx, y: hy }; m.load = {}; m.redir = true;
    return '';
  }
  if (cmd.type === 'spy') return spy(ctx, player, Number(cmd.target));
  if (cmd.type === 'stationRecall') return recallStation(ctx, player, Number(cmd.host));
  if (cmd.type === 'stationDismiss') return dismissStation(ctx, player, Number(cmd.owner));
  if (cmd.type === 'holdRecall') return holdRecall(ctx, player, String(cmd.id));
  if (cmd.type === 'opMove') return moveGarrison(ctx, player, String(cmd.from), String(cmd.to));
  if (cmd.type === 'donate') return donate(ctx, player, cmd.amounts);
  if (cmd.type === 'teleport') return teleport(ctx, player, cmd.x, cmd.y);
  if (cmd.type === 'opRecall') return recallGarrison(ctx, player, String(cmd.id));
  if (cmd.type === 'opDismantle') return dismantle(ctx, player, String(cmd.id));
  return applyCommand(S, cmd);
}

/* ---------- Sicht für einen Spieler ---------- */
export function viewFor(match, players, me, now) {
  const w = match.world, S = me.state, gt = w.gt, map = mapOf(match), myAl = allianceOf(w, me.id);
  const friends = myAl ? myAl.members : [me.id];
  const sees = (x, y) => {
    if ((x - S.pos[0] - .5) ** 2 + (y - S.pos[1] - .5) ** 2 <= VIEW_CITY * VIEW_CITY) return true;
    return w.marches.some(m => m.owner === me.id && (() => { const p = marchPos(m, gt); return (x - p.x) ** 2 + (y - p.y) ** 2 <= VIEW_ARMY * VIEW_ARMY; })());
  };
  const marches = [], incoming = [], sieges = [];
  for (const m of w.marches) {
    const own = m.owner === me.id, friend = friends.includes(m.owner), p = marchPos(m, gt);
    if (m.mode === 'attack' && (m.phase === 'out' || m.phase === 'siege')) {
      const tp = players.find(x => map.byId[m.tid] && x.state.slot === map.byId[m.tid].slot);
      if (tp && friends.includes(tp.id)) incoming.push({ id: m.id, from: m.name, fromTag: (allianceOf(w, m.owner) || {}).tag || '', target: tp.name, targetId: tp.id, mine: tp.id === me.id, siege: m.phase === 'siege', eta: m.phase === 'siege' ? m.tSiege : m.t0 + m.arr[m.arr.length - 1] });
    } else if (m.mode === 'raid' && (m.phase === 'out' || m.phase === 'siege')) {
      const op = (w.outposts || {})[m.tid];
      if (op && myAl && op.al === myAl.id) incoming.push({ id: m.id, from: m.name, fromTag: (allianceOf(w, m.owner) || {}).tag || '', target: 'einen Außenposten', targetId: 0, mine: false, op: true, siege: m.phase === 'siege', eta: m.phase === 'siege' ? m.tSiege : m.t0 + m.arr[m.arr.length - 1] });
    }
    if (m.phase === 'siege' && (m.mode === 'attack' || m.mode === 'raid')) { const bo = map.byId[m.tid], op = (w.outposts || {})[m.tid], dp = bo && bo.k === 'start' ? players.find(x => x.state.slot === bo.slot) : null, oal = op ? w.alliances[op.al] : null;
      sieges.push({ id: m.id, tid: m.tid, kind: op ? 'op' : 'city', tname: dp ? dp.name : oal ? 'Außenposten [' + oal.tag + ']' : '?', tpid: dp ? dp.id : 0, tal: op ? op.al : dp ? (allianceOf(w, dp.id) || {}).id || 0 : 0, from: m.name, fromTag: (allianceOf(w, m.owner) || {}).tag || '', tStart: m.tStart, tSiege: m.tSiege, n: sum(m.troops), pw: siegeStrength(mkCtx(match, players, now), m, gt) }); }
    if (!friend && !sees(p.x, p.y)) continue;
    marches.push({ id: m.id, owner: m.owner, name: m.name, slot: m.slot, own, friend, phase: m.phase, mode: m.mode, troops: friend ? m.troops : { n: sum(m.troops) },
      tk: m.tk, tid: m.tid, path: m.path, arr: m.arr, t0: m.t0, tStart: m.tStart, tEnd: m.tEnd, tSiege: m.tSiege, amount: m.amount, res: m.res, load: own ? m.load : undefined });
  }
  const nodes = {};
  for (const id in w.nodes) nodes[id] = Math.floor(nodeLeft(w, map.byId[id], gt));
  const camps = {}; for (const id in w.camps) if (w.camps[id].dead > gt) camps[id] = w.camps[id].dead;
  const outposts = Object.values(w.outposts || {}).filter(o => w.alliances[o.al]).map(o => {
    const al = w.alliances[o.al], mineO = !!myAl && myAl.id === o.al;
    return { id: o.id, al: o.al, by: o.by, owner: al.leader, x: o.x, y: o.y, done: o.done, group: 'a' + o.al, mine: mineO, garr: mineO ? o.garr : undefined, total: mineO ? Object.values(o.garr).reduce((a, t) => a + sum(t), 0) : undefined };
  });
  const nameOf = id => (byId(players, id) || {}).name || '';
  const holds = Object.keys(w.holds).map(oid => {
    const h = w.holds[oid], mine = myAl ? h.group === 'a' + myAl.id : h.group === 'p' + me.id;
    return { id: oid, group: h.group, label: groupLabel(w, players, h.group), since: h.since, mine, garr: mine ? h.garr : undefined, total: Object.values(h.garr).reduce((a, t) => a + sum(t), 0) };
  });
  const ally = myAl ? { id: myAl.id, name: myAl.name, tag: myAl.tag, color: myAl.color || '', leader: myAl.leader, members: myAl.members, store: { ...storeOf(myAl) }, fields: clanFields(match, players, myAl, w.gt), fieldIncome: FIELD_INCOME, chat: myAl.chat.slice(-60),
    requests: w.pending.filter(x => x.al === myAl.id && x.kind === 'request').map(x => ({ id: x.id, pid: x.pid, name: nameOf(x.pid) })),
    invites: w.pending.filter(x => x.al === myAl.id && x.kind === 'invite').map(x => ({ id: x.id, pid: x.pid, name: nameOf(x.pid) })) } : null;
  const myStations = players.filter(p => p.id !== me.id && p.state.stationed && p.state.stationed[me.id]).map(p => ({ host: p.id, name: p.name, troops: p.state.stationed[me.id] }));
  const mineInv = w.pending.filter(x => x.pid === me.id && x.kind === 'invite' && w.alliances[x.al]).map(x => ({ id: x.id, al: x.al, name: w.alliances[x.al].name, tag: w.alliances[x.al].tag, by: nameOf(x.by) }));
  const myReq = w.pending.filter(x => x.pid === me.id && x.kind === 'request').map(x => ({ id: x.id, al: x.al }));
  return {
    now, me: { id: me.id, name: me.name, slot: S.slot },
    match: {
      name: match.name, speed: match.speed, seed: match.seed, phase: w.phase, startGt: w.startGt, endGt: w.endGt, weeks: w.weeks, cap: allianceCap(players.length),
      players: players.map(p => ({ id: p.id, name: p.name, slot: p.state.slot, pos: p.state.pos, rathaus: p.state.lv.rathaus, out: !!p.state.out, vassalOf: p.state.vassalOf || 0,
        protUntil: p.state.protUntil || 0, ally: (allianceOf(w, p.id) || {}).id || 0 })),
      alliances: Object.values(w.alliances).map(a => ({ id: a.id, name: a.name, tag: a.tag, leader: a.leader, members: a.members, color: a.color || '' })),
      holds, chron: w.chron.slice(0, 40), result: w.result, ranking: rankingOf(match, players)
    },
    ally, invites: mineInv, requests: myReq, incoming, sieges, gchat: (w.chat || []).slice(-60), myStations,
    state: S,
    world: { gt, at: w.at, nodes, camps, ruins: w.ruins, marches, outposts }
  };
}
