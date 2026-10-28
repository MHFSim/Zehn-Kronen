// Zehn Kronen – Ablauf der Partie: Spielzeit, Märsche, Sammeln, Kämpfe, Befehle und die Sicht jedes Spielers.
// Läuft auf dem Server (maßgeblich) und in der Testversion im Browser. Die Spielzeit der Welt läuft in
// "Spielsekunden" (gt); echte Zeit * Tempo = Spielzeit. Alle Ereignisse werden in zeitlicher Reihenfolge
// abgearbeitet, egal wann ein Spieler das nächste Mal nachfragt.
import { N, startSpot, SLOTS, NODE_RES, NODE_KINDS } from './mapgen.js';
import { U, freshState, advanceTo, applyCommand, armySlots } from './rules.js';
import { battle, campTroops, campMult, campLoot, sum, capacityOf, forceOf } from './combat.js';
import {
  DAY, GATHER_SEC, CAMP_RESPAWN, VIEW_CITY, VIEW_ARMY, allianceCap, mapOf, newWorld, ensureWorld, ensureState, nodeLeft, NODE_EMPTY, campAlive,
  reveal, flushBits, FIELD, FG, SCOUT_SEC, SCOUT_SPEED, fieldName, fieldCenter, fieldUnseen, revealField, planMarch, marchPos, nextT, reversed, launch, addTroops, pushReport, note, chron, byId, allianceOf, groupLabel, groupOf,
  settleAway, fmtDur, cellXY, planFrom, allied, isProtected, fightAt, joinDefenders, homeBack, standIdx
} from './core.js';
import { startCampFight, startRaiderFight, powerOf, mutStep, mutCost, attachTo, stepFight, fightView, fightMembers, withdraw, freeOrphans, arriveRaid, arriveAssist, checkAssist, afterLaunch, applyBonuses, arriveCity, arriveField, arriveHold, checkEnd, checkLaunch, dismissStation, holdRecall, protectNew, purge, rankingOf, recallStation, spy, vassalStep } from './war.js';
import { socialCommand } from './social.js';
import { HEROES, heroBusy, heroGather, heroXp, gathersXp } from './heroes.js';
import { releaseAux, opReady, refreshRoads, arriveBuild, arriveGarrison, checkBuild, SITE_OK, checkRaid, checkGarrison, noteRaid, OP_COST, recallGarrison, moveGarrison, dismantle, settleTerritory, donate, teleport, refundStore, clanGather, clanIncome, clanFields, FIELD_INCOME, storeOf } from './outpost.js';
import { RES, gatherFinds, findsText, addPack, PACK_NAME, ensureDaily, questAdd, speedUp, inQueue } from './rules.js';

const mkCtx = (match, players, now) => ({ match, players, now, realT: now, bt: null });

/* ---------- Ereignisse ---------- */
function onArrive(ctx, m, bt, realT) {
  const { match, players } = ctx, w = match.world, map = mapOf(match), o = map.byId[m.tid];
  const p = byId(players, m.owner);
  if (!p) { m.dead = true; return; }
  const S = p.state;
  advanceTo(S, realT, match.speed);
  const back = () => homeBack(ctx, m, bt);
  if (m.tk === 'raider') {   // Räuber-Armee
    const r = (w.raiders || []).find(x => x.id === m.tid);
    if (!r) { pushReport(S, { kind: 'camp', title: 'Räuber verschwunden', win: false, target: { kind: 'raider', id: m.tid }, text: 'Die Räuber sind schon weitergezogen oder jemand war schneller. Dein Heer kehrt um.' }, realT); return back(); }
    const lead = fightAt(w, r.id); if (lead) { attachTo(ctx, lead, m); return; }
    return startRaiderFight(ctx, m, r, bt);
  }
  if (m.mode === 'post') { m.phase = 'post'; return; }
  if (m.mode === 'attack' && m.tk === 'post') { const [px, py] = cellXY(m.path[m.path.length - 1]); return arriveField(ctx, m, { k: 'post', id: m.tid, x: px, y: py }, bt, realT, back); }
  if (m.mode === 'build') return arriveBuild(ctx, m, bt, realT, back);
  if (m.mode === 'assist') return arriveAssist(ctx, m, bt, realT, back);
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
    const left = nodeLeft(w, o, bt), cap = capacityOf(m.troops, S, m.hero), amount = Math.floor(Math.min(cap, left));
    if (amount < NODE_EMPTY) {
      pushReport(S, { kind: 'gather', title: 'Feld erschöpft', win: false, target: info, text: 'Das Feld ist fast leer. Das Heer kehrt ohne Beute zurück.' }, realT);
      return back();
    }
    w.nodes[o.id] = { left: left, t: bt };
    m.phase = 'gather'; m.tStart = bt; m.tEnd = bt + GATHER_SEC * amount / (m.hero ? heroGather(S, m.hero, NODE_RES[o.k]) : 1); m.amount = amount; m.res = NODE_RES[o.k];
    return;
  }
  if (o.k === 'camp') {
    if (!campAlive(w, o.id, bt)) {
      pushReport(S, { kind: 'camp', title: 'Lager bereits zerstört', win: false, target: info, text: 'Hier war schon jemand schneller. Das Lager baut sich in einigen Stunden wieder auf.' }, realT);
      return back();
    }
    const lead = fightAt(w, o.id); if (lead) { attachTo(ctx, lead, m); return; }
    startCampFight(ctx, m, o, bt);
    return;
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
  if (m.hero && gathersXp(m.hero)) { const up = heroXp(p.state, m.hero, m.amount / 4); if (up) note(ctx, p.id, 'hero', HEROES[m.hero].name + ' ist aufgestiegen', HEROES[m.hero].name + ' hat Stufe ' + p.state.heroes[m.hero].lv + ' erreicht.'); }
  clanGather(ctx, m, o, bt);
  const found = gatherFinds(p.state, m.id, m.tEnd - m.tStart); if (Object.keys(found).length) note(ctx, p.id, 'gather', 'Beschleuniger gefunden', 'Beim Sammeln hat dein Heer ' + findsText(found) + ' gefunden.');
  m.phase = 'back'; m.t0 = bt; reversed(m);
}
function onHome(ctx, m, bt, realT) {
  const { match, players } = ctx, p = byId(players, m.owner); m.dead = true;
  if (!p) return;
  if (m.redir) {   // umgeleitetes Heer: vom Ausgangspunkt (Posten oder Außenposten) noch nach Hause laufen
    const here = m.path[m.path.length - 1], plan = planFrom(mapOf(match), cellXY(here), p.state.pos[0], p.state.pos[1], m.troops, p.state, m.hero);
    if (!plan.error && plan.path.length > 1) { m.path = plan.path; m.arr = plan.arr; m.phase = 'back'; m.t0 = bt; m.mode = 'home'; m.tk = 'start'; delete m.redir; m.dead = false; return; }
  }
  const S = p.state; advanceTo(S, realT, match.speed);
  addTroops(S, m.troops, +1);
  for (const u in m.troops) { S.away[u] = (S.away[u] || 0) - m.troops[u]; if (S.away[u] <= 0) delete S.away[u]; }
  const load = { ...(m.carry || {}) }; for (const r in (m.load || {})) load[r] = (load[r] || 0) + m.load[r];
  { const home = mapOf(match).objects.find(x => x.k === 'start' && x.slot === S.slot); if (home) joinDefenders(match.world, home.id, m.troops); }
  for (const r of Object.keys(load)) { S.res[r] = (S.res[r] || 0) + load[r]; if (RES.includes(r)) questAdd(S, r, load[r]); }
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
/* ---------- Räuber: kleine KI-Armeen auf der Karte (Stufe 1 bis 30) ---------- */
const RAID_LIFE = 3 * 3600, RAID_EVERY = 60, RAID_WANT = 80, RAID_GRID = 10;   // 10 x 10 Abschnitte, in jedem höchstens ein Räuber
export const raidLevel = (mut, r) => Math.max(1, Math.min(30, Math.round(mut / 110 * (0.65 + r * 0.55))));   // Räuberstufe folgt der Stärke des nächsten Spielers
const rnd1 = s => { const x = Math.sin(s * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
function manageRaiders(ctx, players, depth = 0) {
  const w = ctx.match.world, map = mapOf(ctx.match), alive = players.filter(p => p.state.slot >= 0 && !p.state.out).length;
  w.raiders = (w.raiders || []).filter(r => r.until > w.gt || fightAt(w, r.id) || w.marches.some(m => !m.dead && m.tid === r.id && m.tk === 'raider' && m.phase === 'out'));
  const want = alive ? RAID_WANT : 0;
  if (w.raiders.length >= want || w.gt < (w.raidNext || 0)) return;
  const starts = map.objects.filter(o => o.k === 'start'), pl = players.filter(q => q.state.slot >= 0 && !q.state.out && q.state.pos);
  // Gerecht über die ganze Karte: ein Raster aus Abschnitten, in jedem höchstens ein Räuber. Neue kommen in einem leeren Abschnitt (zufällige Reihenfolge) auf.
  const SEC = Math.ceil(N / RAID_GRID), taken = new Set(w.raiders.map(r => Math.floor(r.x / SEC) + Math.floor(r.y / SEC) * RAID_GRID));
  const empty = []; for (let k = 0; k < RAID_GRID * RAID_GRID; k++) if (!taken.has(k)) empty.push(k);
  const sd0 = w.nextRaider * 977 + Math.floor(w.gt / 60);
  empty.sort((a, b) => rnd1(sd0 + a * 7.31) - rnd1(sd0 + b * 7.31));
  for (const k of empty) {
    const gx = k % RAID_GRID, gy = Math.floor(k / RAID_GRID);
    for (let i = 0; i < 12; i++) {
      const sd = sd0 + k * 131 + i * 17, x = Math.floor(gx * SEC + rnd1(sd + 1) * SEC), y = Math.floor(gy * SEC + rnd1(sd + 2) * SEC);
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (!map.pass[y * N + x] || !SITE_OK(map, x, y)) continue;
      if (starts.some(o => Math.hypot(o.x - x, o.y - y) < 9)) continue;   // nicht direkt an einer Burg
      if (map.objects.some(o => Math.hypot(o.x - x, o.y - y) < 4) || w.raiders.some(r => Math.hypot(r.x - x, r.y - y) < 5)) continue;
      let near = pl[0], nd = 1e9; for (const q of pl) { const d = Math.hypot(q.state.pos[0] - x, q.state.pos[1] - y); if (d < nd) { nd = d; near = q; } }
      const lv = raidLevel(near ? powerOf(near.state) : 0, rnd1(sd + 13));   // Stärke folgt dem nächsten Spieler
      w.raiders.push({ id: 'raider' + w.nextRaider++, lv, x, y, until: w.gt + RAID_LIFE });
      // Beim Spielstart oder nach langer Pause wird in einem Schwung aufgefüllt
      if (w.raiders.length < want && depth < 100) { w.raidNext = 0; return manageRaiders(ctx, players, depth + 1); }
      w.raidNext = w.gt + RAID_EVERY; return;
    }
  }
  w.raidNext = w.gt + 10;
}
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
    if (best.phase === 'out') onArrive(ctx, best, bt, realT);
    else if (best.phase === 'fight') stepFight(ctx, best, bt, realT);
    else if (best.phase === 'gather') onGatherEnd(ctx, best, bt, realT);
    else onHome(ctx, best, bt, realT);
    events++;
    if (w.marches.some(m => m.dead)) w.marches = w.marches.filter(m => !m.dead);
    if (best.dead || best.phase !== 'fight') freeOrphans(ctx, bt);
    if (checkEnd(ctx, bt)) { w.gt = bt; w.at = realT; ctx.bt = null; return { events }; }
  }
  ctx.bt = null; ctx.realT = now;
  const dt = Math.max(0, target - w.gt);
  w.gt = target; w.at = now;
  settleTerritory(ctx);
  clanIncome(ctx, dt);
  applyBonuses(ctx);
  for (const p of players) { advanceTo(p.state, now, speed); }
  for (const p of players) {   // Tägliche Aufgaben: neuer Tag, neue Liste
    if (p.state.slot < 0 || p.state.out) continue;
    const al = allianceOf(w, p.id); ensureDaily(p.state, now, al ? al.members.length - 1 : 0);
  }
  for (const p of players) {   // Erkunder fertig: Feld aufdecken, Ressourcenpaket finden
    const S = p.state, sc = S.scout; if (!sc || w.gt < sc.end) continue;
    revealField(S, sc.f); S.scout = null;
    const far = Math.hypot(fieldCenter(sc.f)[0] - S.pos[0], fieldCenter(sc.f)[1] - S.pos[1]) > 110, th = ['', 'food', 'wood', 'stone'][sc.f % 4], n = far ? 2 : 1, names = [];
    for (let i = 0; i < n; i++) { addPack(S, i ? '' : th); names.push(PACK_NAME[i ? '' : th] || 'Ressourcenpaket'); }
    note(ctx, p.id, 'scout', 'Feld ' + fieldName(sc.f) + ' erkundet', 'Dein Erkunder hat den Nebel gelichtet und gefunden: ' + names.join(', ') + '. Du findest es unter „Ressourcen“.');
  }
  for (const p of players) mutStep(p.state, w.gt);
  manageRaiders(ctx, players);
  w.help = (w.help || []).filter(h => { const hp = players.find(x => x.id === h.pid); return hp && inQueue(hp.state, h.bid) && (w.gt - h.t) < 86400 * 30; });
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
  if (m.phase === 'fight') return m.path[standIdx(m)];   // im Kampf steht das Heer vor dem Ziel, von dort geht es weiter
  if (m.phase === 'post' || m.phase === 'gather') return m.path[m.path.length - 1];
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
  if (cmd.type === 'scout') {   // Erkunder in ein Nebelfeld schicken
    const f = Math.floor(Number(cmd.f)); if (!(f >= 0 && f < FG * FG)) return 'Dieses Feld gibt es nicht.';
    if (S.out || S.slot < 0) return 'Du bist nicht im Spiel.';
    if (S.scout) return 'Dein Erkunder ist schon unterwegs.';
    if (fieldUnseen(S, f) < 0.08) return 'Dieses Feld ist schon erkundet.';
    const [cx, cy] = fieldCenter(f), go = Math.round(Math.hypot(cx - S.pos[0], cy - S.pos[1]) / SCOUT_SPEED);
    S.scout = { f, t0: w.gt, go, end: w.gt + go + SCOUT_SEC }; return '';
  }
  if (cmd.type === 'scoutCancel') { if (!S.scout) return 'Dein Erkunder ist nicht unterwegs.'; S.scout = null; return ''; }
  if (cmd.type === 'setKeeper') {   // Burgwächter und Stellvertreter wählen
    const a = String(cmd.hero || ''), b = String(cmd.deputy || '');
    if ((a && !HEROES[a]) || (b && !HEROES[b])) return 'Diesen Helden gibt es nicht.';
    if (a && a === b) return 'Wächter und Stellvertreter müssen verschieden sein.';
    S.defHero = a; S.defDeputy = b; return '';
  }
  if (cmd.type === 'askHelp') {   // Bündnis um Hilfe beim Bauen bitten
    const al = allianceOf(w, player.id), q = inQueue(S, cmd.id);
    if (!al || al.members.length < 2) return 'Du brauchst ein Bündnis mit mindestens einem weiteren Mitglied.';
    if (!q) return 'Dieses Gebäude wird nicht gebaut.';
    w.help = w.help || []; w.nextHelp = w.nextHelp || 1;
    if (w.help.some(h => h.pid === player.id && h.bid === cmd.id)) return 'Du hast schon um Hilfe gebeten.';
    w.help.push({ id: w.nextHelp++, pid: player.id, bid: cmd.id, t: w.gt, by: [] });
    return '';
  }
  if (cmd.type === 'giveHelp') {   // einem Bündnismitglied helfen: sein Bau kommt um 15 % voran
    const h = (w.help || []).find(x => x.id === cmd.rid); if (!h) return 'Die Bitte ist nicht mehr offen.';
    const al = allianceOf(w, player.id), op = players.find(x => x.id === h.pid), q = op && inQueue(op.state, h.bid);
    if (!al || !al.members.includes(h.pid) || h.pid === player.id) return 'Dem kannst du nicht helfen.';
    if (h.by.includes(player.id)) return 'Du hast schon geholfen.';
    if (!q) { w.help = w.help.filter(x => x !== h); return 'Der Bau ist schon fertig.'; }
    advanceTo(op.state, ctx.now, match.speed);
    h.by.push(player.id);
    const tot = q.total, before = q.left; speedUp(op.state, 'build', h.bid, 0.15 * tot);
    questAdd(S, 'help', 1);
    note(ctx, op.id, 'help', player.name + ' hilft dir', 'Dein Bau ging um ' + Math.round(Math.min(before, 0.15 * tot) / tot * 100) + ' % voran.');
    return '';
  }
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
    if (mode === 'normal' && String(cmd.target).startsWith('raider')) { const r = (w.raiders || []).find(x => x.id === String(cmd.target)); o = r ? { k: 'raider', id: r.id, x: r.x, y: r.y, lv: r.lv } : null; }
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
    if (mode === 'normal' && !(NODE_KINDS.includes(o.k) || o.k === 'camp' || o.k === 'ruin' || o.k === 'raider')) return 'Dieses Ziel gibt es nicht';
    let fromOp = null;
    if (cmd.fromOp != null) {
      const al0 = allianceOf(w, player.id); fromOp = (w.outposts || {})[String(cmd.fromOp)];
      if (!fromOp || !al0 || fromOp.al !== al0.id || !opReady(fromOp, w.gt)) return 'Dieser Außenposten steht nicht zur Verfügung';
      if (!fromOp.garr[player.id] || !sum(fromOp.garr[player.id])) return 'Du hast dort keine Truppen';
      if (mode === 'build') return 'Aus dem Außenposten kann man keinen neuen bauen';
      if (mode === 'garrison' && opx && opx.id === fromOp.id) return 'Die Truppen sind schon dort';
    }
    const src = cmd.from != null ? w.marches.find(x => x.id === Number(cmd.from) && x.owner === player.id && !x.dead && (['post', 'gather', 'back', 'fight'].includes(x.phase) || (x.phase === 'out' && x.mode !== 'build'))) : null;
    if (cmd.from != null && !src) return 'Dieses Heer kann gerade nicht umgeleitet werden';
    if (!src && w.marches.filter(m => m.owner === player.id).length >= armySlots(S)) return 'Alle Heere sind unterwegs (' + armySlots(S) + ')';
    if (src && (src.phase === 'post' || src.phase === 'gather') && o.id === src.tid) return 'Das Heer ist schon dort';
    const hid = (src && src.hero) || String(cmd.hero || '');
    if (!HEROES[hid]) return 'Wähle einen Helden als Anführer des Heeres.';
    if (!(src && src.hero) && heroBusy(w, player.id, hid)) return HEROES[hid].name + ' führt schon ein anderes Heer an.';
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
      assistSiege = checkAssist(ctx, player, o.id, side, inDef); if (typeof assistSiege === 'string') return assistSiege;
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
    const plan = src ? planFrom(map, cellXY(curCell(src, w.gt)), o.x, o.y, troops, S, hid) : fromOp ? planFrom(map, [fromOp.x, fromOp.y], o.x, o.y, troops, S, hid) : planMarch(map, S, o, troops, hid);
    if (plan.error) return plan.error;
    if (mode === 'normal' && o.k === 'raider' && !(src && src.tid === o.id)) {   // Mut kostet nur der Angriff auf Räuber
      mutStep(S, w.gt); const cost = mutCost(o.lv);
      if (S.mut < cost) return 'Zu wenig Mut (' + Math.floor(S.mut) + ' von ' + cost + '). Mut erholt sich stündlich.';
      S.mut -= cost;
    }
    let carry = null;
    if (src) {
      if (src.phase === 'fight') { withdraw(ctx, player, src, w.gt, now); if (src.dead) return ''; }
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
    const m = launch(ctx, player, troops, plan, mode === 'normal' ? { tk: o.k, tid: o.id } : mode === 'build' ? { tk: 'site', tid: o.id, mode, site: { x: o.x, y: o.y } } : mode === 'post' ? { tk: 'post', tid: o.id, mode, site: { x: o.x, y: o.y } } : mode === 'assist' ? { tk: o.k, tid: o.id, mode, side: assistSide } : { tk: o.k, tid: o.id, mode });
    m.hero = hid;
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
    if (m.phase === 'fight') { withdraw(ctx, player, m, w.gt, now); return ''; }
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
// Im Kampf sieht man nie, wie viele Einheiten der Gegner hat: nur die Lebensbalken und die eigene Seite
function hideFoe(pw, side) {
  if (!pw) return pw;
  const o = { ...pw }; delete o.pk;
  if (side !== 'att') { o.na = null; o.na0 = null; o.pa = null; }
  if (side !== 'def') { o.nd = null; o.nd0 = null; o.pd = null; }
  return o;
}
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
    const lead = m.phase === 'fight' && !m.lead;
    if (m.mode === 'attack' && (m.phase === 'out' || lead)) {
      const tp = players.find(x => map.byId[m.tid] && x.state.slot === map.byId[m.tid].slot);
      if (tp && friends.includes(tp.id)) incoming.push({ id: m.id, from: m.name, fromTag: (allianceOf(w, m.owner) || {}).tag || '', target: tp.name, targetId: tp.id, mine: tp.id === me.id, siege: lead, eta: m.t0 + m.arr[m.arr.length - 1] });
    } else if (m.mode === 'raid' && (m.phase === 'out' || lead)) {
      const op = (w.outposts || {})[m.tid];
      if (op && myAl && op.al === myAl.id) incoming.push({ id: m.id, from: m.name, fromTag: (allianceOf(w, m.owner) || {}).tag || '', target: 'einen Außenposten', targetId: 0, mine: false, op: true, siege: lead, eta: m.t0 + m.arr[m.arr.length - 1] });
    }
    if (lead && m.fight) {
      const bo = map.byId[m.tid], op = (w.outposts || {})[m.tid], dp = bo && bo.k === 'start' ? players.find(x => x.state.slot === bo.slot) : null, oal = op ? w.alliances[op.al] : null, kind = op ? 'op' : dp ? 'city' : 'other', rd = (w.raiders || []).find(x => x.id === m.tid);
      const involved = kind !== 'other' || m.owner === me.id || w.marches.some(x => x.lead === m.id && x.owner === me.id);
      const mineF = m.owner === me.id || friends.includes(m.owner) || (dp && friends.includes(dp.id)) || (op && myAl && op.al === myAl.id) || w.marches.some(x => x.lead === m.id && x.owner === me.id);
      if (involved) sieges.push({ mine: !!mineF, id: m.id, tid: m.tid, kind, tname: dp ? dp.name : oal ? 'Außenposten [' + oal.tag + ']' : bo && bo.k === 'camp' ? 'Banditenlager Stufe ' + bo.lv : rd ? 'Räuber Stufe ' + rd.lv : bo && bo.k === 'throne' ? 'den Thron' : bo && bo.k === 'sanct' ? 'ein Heiligtum' : 'ein Heer auf dem Feld', tpid: dp ? dp.id : 0, tal: op ? op.al : dp ? (allianceOf(w, dp.id) || {}).id || 0 : 0, from: m.name, fromTag: (allianceOf(w, m.owner) || {}).tag || '', tStart: m.tStart, pw: hideFoe(fightView(mkCtx(match, players, now), m), (m.owner === me.id || friends.includes(m.owner) || w.marches.some(x => x.lead === m.id && x.side === 'att' && (x.owner === me.id || friends.includes(x.owner)))) ? 'att' : ((dp && friends.includes(dp.id)) || (op && myAl && op.al === myAl.id) || w.marches.some(x => x.lead === m.id && x.side === 'def' && x.owner === me.id)) ? 'def' : ''), px: marchPos(m, gt).x, py: marchPos(m, gt).y });
    }
    if (!friend && !sees(p.x, p.y)) continue;
    marches.push({ id: m.id, owner: m.owner, name: m.name, slot: m.slot, own, friend, phase: m.phase, mode: m.mode, troops: friend ? m.troops : { n: sum(m.troops) },
      hero: m.hero, tk: m.tk, tid: m.tid, path: m.path, arr: m.arr, t0: m.t0, tStart: m.tStart, tEnd: m.tEnd, lead: m.lead, side: m.side, amount: m.amount, res: m.res, load: own ? m.load : undefined });
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
  const ally = myAl ? { id: myAl.id, name: myAl.name, tag: myAl.tag, color: myAl.color || '', leader: myAl.leader, members: myAl.members, store: { ...storeOf(myAl) }, fields: clanFields(match, players, myAl, w.gt), fieldIncome: FIELD_INCOME, chat: myAl.chat.slice(-60), ann: (myAl.ann || []).slice(-30),
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
    help: (w.help || []).filter(h => h.pid === me.id || (friends.includes(h.pid) && !h.by.includes(me.id))).map(h => { const hp = players.find(x => x.id === h.pid); return { id: h.id, pid: h.pid, name: hp ? hp.name : '?', bid: h.bid, mine: h.pid === me.id, n: h.by.length }; }),
    ally, invites: mineInv, requests: myReq, incoming, sieges, gchat: (w.chat || []).slice(-60), myStations,
    state: S,
    world: { gt, at: w.at, nodes, camps, ruins: w.ruins, marches, outposts, raiders: (w.raiders || []).map(r => ({ id: r.id, lv: r.lv, x: r.x, y: r.y, until: r.until })) }
  };
}
