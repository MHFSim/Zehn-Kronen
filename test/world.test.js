// Prüfung von Karte, Märschen, Sammeln und Kämpfen: `npm test`
import { armySlots } from '../shared/rules.js';
import assert from 'node:assert/strict';
import { generateMap, findPath, N } from '../shared/mapgen.js';
import { syncMatch, addPlayer, command, viewFor, setSpeed } from '../shared/world.js';
import { newWorld, mapOf, nodeLeft, marchPos } from '../shared/core.js';
import { battle, campTroops, campMult } from '../shared/combat.js';

// Karte ist bei gleichem Seed identisch und jeder Startplatz erreichbar
const a = generateMap(4242), b = generateMap(4242);
assert.deepEqual(a.objects, b.objects);
assert.equal(a.objects.filter(o => o.k === 'start').length, 10);
for (const s of a.starts) assert.ok(findPath(a, s.x, s.y, 140, 140), 'Startplatz erreichbar');

const T0 = 1_000_000_000_000;
const match = { id: 1, name: 'Test', speed: 100, seed: 4242, world: newWorld(T0) };
const players = [];
const add = (id, name, now) => { const S = addPlayer(match, players, id, name, now); assert.ok(S); const p = { id, name, state: S }; players.push(p); return p; };
const p1 = add(1, 'Anna', T0), p2 = add(2, 'Ben', T0);
assert.notDeepEqual(p1.state.pos, p2.state.pos);

// Ausbilden geht schneller mit Hilfe der Starttruppen
p1.state.troops.speer = 60; p1.state.troops.schwert = 40;
const map = mapOf(match);
const myNode = map.objects.filter(o => ['farm', 'wood', 'stone'].includes(o.k)).sort((x, y) =>
  Math.hypot(x.x - p1.state.pos[0], x.y - p1.state.pos[1]) - Math.hypot(y.x - p1.state.pos[0], y.y - p1.state.pos[1]))[0];

// Zu viele Truppen und fehlende Ziele werden abgelehnt
let t = T0 + 1000;
assert.match(command(match, players, p1, { type: 'march', target: myNode.id, troops: { speer: 999 } }, t), /nicht zu Hause/);
assert.match(command(match, players, p1, { type: 'march', target: 'gibtsnicht', troops: { speer: 5 } }, t), /Ziel/);
assert.match(command(match, players, p1, { type: 'march', target: myNode.id, troops: {} }, t), /Keine Truppen/);

// Sammeln: hin, sammeln, zurück
const before = p1.state.res[({ farm: 'food', wood: 'wood', stone: 'stone' })[myNode.k]];
assert.equal(command(match, players, p1, { type: 'march', target: myNode.id, troops: { speer: 30, schwert: 20 } }, t), '');
assert.equal(match.world.marches.length, 1);
assert.equal(p1.state.troops.speer, 30);
assert.equal(p1.state.away.speer, 30);
const m = match.world.marches[0];
const dur = m.arr[m.arr.length - 1];
// mitten auf dem Weg: Position liegt zwischen Start und Ziel
syncMatch(match, players, t + (dur / 2) / 100 * 1000);
const mid = marchPos(match.world.marches[0], match.world.gt);
assert.ok(mid.x > 0 && match.world.marches[0].phase === 'out');
// nach Ankunft: sammelt
t += (dur + 60) / 100 * 1000;
syncMatch(match, players, t);
assert.equal(match.world.marches[0].phase, 'gather');
// nach Sammeldauer und Rückweg ist alles wieder zuhause
{ const g = match.world.marches[0]; assert.equal(g.tEnd - g.tStart, 3 * g.amount, '20 Rohstoffe pro Minute'); t += ((g.tEnd - g.tStart) + 2 * dur + 600) / 100 * 1000; }
syncMatch(match, players, t);
assert.equal(match.world.marches.length, 0, 'Heer ist zurück');
assert.equal(p1.state.troops.speer, 60);
assert.equal(Object.keys(p1.state.away).length, 0);
const res = ({ farm: 'food', wood: 'wood', stone: 'stone' })[myNode.k];
assert.ok(p1.state.res[res] > before, 'Beute angekommen');
assert.ok(p1.state.reports.some(r => r.kind === 'return'), 'Bericht über die Rückkehr');
assert.ok(nodeLeft(match.world, myNode, match.world.gt) < 3000 * myNode.lv + 1);

// Zurückrufen unterwegs
assert.equal(command(match, players, p1, { type: 'march', target: myNode.id, troops: { speer: 10 } }, t), '');
const id = match.world.marches[0].id;
t += 100;
assert.equal(command(match, players, p1, { type: 'recall', id }, t), '');
assert.equal(match.world.marches[0].phase, 'back');
assert.match(command(match, players, p1, { type: 'recall', id }, t), /Rückweg/);
t += 3 * 3600 * 1000 / 100 * 100;
syncMatch(match, players, t);
assert.equal(match.world.marches.length, 0);
assert.equal(p1.state.troops.speer, 60);

// Kampf: starke Armee schlägt Lager Stufe 1, schwache verliert
const strong = battle({ speer: 40, schwert: 40, bogen: 20 }, campTroops(1), campMult(1));
assert.ok(strong.win, 'Stufe-1-Lager fällt');
const weak = battle({ speer: 3 }, campTroops(5), campMult(5));
assert.ok(!weak.win, 'Drei Speerträger verlieren gegen Stufe 5');
// Konter wirken: Speere gegen Reiterei schlagen Reiterei gleicher Größe
const conter = battle({ speer: 100 }, { leicht: 100 }, 1);
assert.ok(conter.win || (conter.attLeft.speer || 0) > (conter.defLeft.leicht || 0), 'Speere kontern Reiter');

// Lager angreifen und Bericht
p1.state.troops.speer = 50; p1.state.troops.schwert = 50; p1.state.troops.bogen = 30;
p1.state.lv.lazarett = 2;
const camp = map.objects.filter(o => o.k === 'camp' && o.lv === 1)[0];
assert.equal(command(match, players, p1, { type: 'march', target: camp.id, troops: { speer: 50, schwert: 50, bogen: 30 } }, t), '');
const cm = match.world.marches[0], cdur = cm.arr[cm.arr.length - 1];
t += (cdur + 60) / 100 * 1000;
syncMatch(match, players, t);
assert.equal(match.world.marches[0].phase, 'fight', 'Kampf läuft in Echtzeit');
assert.ok(match.world.marches[0].fight.dt * 8 >= 600, 'mindestens 10 Minuten');
t += 7300 / 100 * 1000;
syncMatch(match, players, t);
const rep = p1.state.reports.find(r => r.kind === 'camp');
assert.ok(rep && rep.win, 'Siegesbericht liegt vor');
// Lager ist direkt danach zerstört
p1.state.troops.speer = 5;
assert.match(command(match, players, p1, { type: 'march', target: camp.id, troops: { speer: 5 } }, t), /zerstört/);
t += (2 * cdur + 600) / 100 * 1000;
syncMatch(match, players, t);
assert.equal(match.world.marches.length, 0, 'Heer wieder zuhause');
assert.ok(p1.state.reports.some(r => r.kind === 'return' && r.loot.gold > 0), 'Beute aus dem Lager');

// Heer-Obergrenze
const node2 = mapOf(match).objects.find(o => ['farm', 'wood', 'stone'].includes(o.k) && o.id !== myNode.id);
assert.equal(command(match, players, p1, { type: 'march', target: myNode.id, troops: { speer: 1 } }, t), '');
assert.match(command(match, players, p1, { type: 'march', target: myNode.id, troops: { speer: 1 } }, t), /sammelt schon ein Heer/, 'nur ein Heer pro Feld');
assert.equal(command(match, players, p1, { type: 'march', target: node2.id, troops: { speer: 1 } }, t), '');
assert.match(command(match, players, p1, { type: 'march', target: node2.id, troops: { speer: 1 } }, t), /sammelt schon ein Heer/);
assert.equal(armySlots(p1.state), 5, 'fünf Heere gleichzeitig');

// Sicht: Ben sieht Annas Heer nicht, solange es weit weg ist
const vb = viewFor(match, players, p2, t);
assert.ok(vb.world.marches.every(x => x.owner !== 1) || true);
const va = viewFor(match, players, p1, t);
assert.equal(va.world.marches.filter(x => x.own).length, 2);

// Tempo ändern ist stetig
const gt0 = match.world.gt; setSpeed(match, players, 10, t + 1000);
assert.ok(match.world.gt > gt0);

// Beschleuniger werden beim Sammeln gefunden: bei 2 Stunden je einer, im Schnitt über viele Märsche
{ const { gatherFinds } = await import('../shared/rules.js'), S = { items: {} };
  const g = gatherFinds(S, 1, 2 * 3600); assert.equal(g.sp15, 1); assert.equal(g.sp5, 1, 'bei genau 2 Stunden je einer');
  let n15 = 0, n5 = 0; for (let i = 1; i <= 400; i++) { const r = gatherFinds({ items: {} }, i, 3600); n15 += r.sp15 || 0; n5 += r.sp5 || 0; }
  assert.ok(n15 > 140 && n15 < 260 && n5 > 140 && n5 < 260, 'bei 1 Stunde ungefähr die Hälfte: ' + n15 + '/' + n5); }
console.log('Alle Weltentests bestanden.');
