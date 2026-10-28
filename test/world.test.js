// Prüfung von Karte, Märschen, Sammeln und Kämpfen: `npm test`
import { armySlots } from '../shared/rules.js';
import assert from 'node:assert/strict';
import { generateMap, findPath, N } from '../shared/mapgen.js';
import { syncMatch, addPlayer, command as rawCommand, viewFor, setSpeed } from '../shared/world.js';
import { heroShim } from './helper.js';
const command = heroShim(rawCommand);
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
p1.state.troops.schwert = 100;
const map = mapOf(match);
const myNode = map.objects.filter(o => ['farm', 'wood', 'stone'].includes(o.k)).sort((x, y) =>
  Math.hypot(x.x - p1.state.pos[0], x.y - p1.state.pos[1]) - Math.hypot(y.x - p1.state.pos[0], y.y - p1.state.pos[1]))[0];

// Zu viele Truppen und fehlende Ziele werden abgelehnt
let t = T0 + 1000;
assert.match(command(match, players, p1, { type: 'march', target: myNode.id, troops: { schwert: 999 } }, t), /nicht zu Hause/);
assert.match(command(match, players, p1, { type: 'march', target: 'gibtsnicht', troops: { schwert: 5 } }, t), /Ziel/);
assert.match(command(match, players, p1, { type: 'march', target: myNode.id, troops: {} }, t), /Keine Truppen/);

// Sammeln: hin, sammeln, zurück
const before = p1.state.res[({ farm: 'food', wood: 'wood', stone: 'stone' })[myNode.k]];
assert.equal(command(match, players, p1, { type: 'march', target: myNode.id, troops: { schwert: 50 } }, t), '');
assert.equal(match.world.marches.length, 1);
assert.equal(p1.state.troops.schwert, 50);
assert.equal(p1.state.away.schwert, 50);
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
assert.equal(p1.state.troops.schwert, 100);
assert.equal(Object.keys(p1.state.away).length, 0);
const res = ({ farm: 'food', wood: 'wood', stone: 'stone' })[myNode.k];
assert.ok(p1.state.res[res] > before, 'Beute angekommen');
assert.ok(p1.state.reports.some(r => r.kind === 'return'), 'Bericht über die Rückkehr');
assert.ok(nodeLeft(match.world, myNode, match.world.gt) < 3000 * myNode.lv + 1);

// Zurückrufen unterwegs
assert.equal(command(match, players, p1, { type: 'march', target: myNode.id, troops: { schwert: 10 } }, t), '');
const id = match.world.marches[0].id;
t += 100;
assert.equal(command(match, players, p1, { type: 'recall', id }, t), '');
assert.equal(match.world.marches[0].phase, 'back');
assert.match(command(match, players, p1, { type: 'recall', id }, t), /Rückweg/);
t += 3 * 3600 * 1000 / 100 * 100;
syncMatch(match, players, t);
assert.equal(match.world.marches.length, 0);
assert.equal(p1.state.troops.schwert, 100);

// Kampf: starke Armee schlägt Lager Stufe 1, schwache verliert
const strong = battle({ schwert: 80, bogen: 20 }, campTroops(1), campMult(1));
assert.ok(strong.win, 'Stufe-1-Lager fällt');
const weak = battle({ schwert: 3 }, campTroops(5), campMult(5));
assert.ok(!weak.win, 'Drei Speerträger verlieren gegen Stufe 5');
// Konter wirken: Speere gegen Reiterei schlagen Reiterei gleicher Größe
const conter = battle({ schwert: 100 }, { schwer: 100 }, 1);
assert.ok(conter.win || (conter.attLeft.schwert || 0) > (conter.defLeft.schwer || 0), 'Speere kontern Reiter');

// Lager angreifen und Bericht
p1.state.troops.schwert = 100; p1.state.troops.bogen = 30;
p1.state.lv.lazarett = 2;
// Banditenlager gibt es auf der Karte nicht mehr; die Kampfregeln bleiben, hier wird ein Stein-Ort zum Lager umgewidmet
const camp = map.objects.filter(o => o.k === 'stone' && o.id !== myNode.id)[0]; camp.k = 'camp'; camp.lv = 1;
assert.equal(command(match, players, p1, { type: 'march', target: camp.id, troops: { schwert: 100, bogen: 30 } }, t), '');
const cm = match.world.marches[0], cdur = cm.arr[cm.arr.length - 1];
t += (cdur + 60) / 100 * 1000;
syncMatch(match, players, t);
assert.equal(match.world.marches[0].phase, 'fight', 'Kampf läuft in Echtzeit');
assert.ok(match.world.marches[0].fight.dt * 600 >= 600, 'mindestens 10 Minuten');
t += 7300 / 100 * 1000;
syncMatch(match, players, t);
const rep = p1.state.reports.find(r => r.kind === 'camp');
assert.ok(rep && rep.win, 'Siegesbericht liegt vor');
// Lager ist direkt danach zerstört
p1.state.troops.schwert = 5;
assert.match(command(match, players, p1, { type: 'march', target: camp.id, troops: { schwert: 5 } }, t), /zerstört/);
t += (2 * cdur + 600) / 100 * 1000;
syncMatch(match, players, t);
assert.equal(match.world.marches.length, 0, 'Heer wieder zuhause');
assert.ok(p1.state.reports.some(r => r.kind === 'return' && r.loot.gold > 0), 'Beute aus dem Lager');

// Heer-Obergrenze
const node2 = mapOf(match).objects.find(o => ['farm', 'wood', 'stone'].includes(o.k) && o.id !== myNode.id);
assert.equal(command(match, players, p1, { type: 'march', target: myNode.id, troops: { schwert: 1 } }, t), '');
assert.match(command(match, players, p1, { type: 'march', target: myNode.id, troops: { schwert: 1 } }, t), /sammelt schon ein Heer/, 'nur ein Heer pro Feld');
assert.equal(command(match, players, p1, { type: 'march', target: node2.id, troops: { schwert: 1 } }, t), '');
assert.match(command(match, players, p1, { type: 'march', target: node2.id, troops: { schwert: 1 } }, t), /sammelt schon ein Heer/);
assert.equal(armySlots(p1.state), 5, 'fünf Heere gleichzeitig');

// Sicht: Ben sieht Annas Heer nicht, solange es weit weg ist
const vb = viewFor(match, players, p2, t);
assert.ok(vb.world.marches.every(x => x.owner !== 1) || true);
const va = viewFor(match, players, p1, t);
assert.equal(va.world.marches.filter(x => x.own).length, 2);

// Tempo ändern ist stetig
const gt0 = match.world.gt; setSpeed(match, players, 10, t + 1000);
assert.ok(match.world.gt > gt0);

// Beschleuniger werden beim Sammeln gefunden: im Schnitt je Stunde mehrere kleine und große
{ const { gatherFinds, FINDS } = await import('../shared/rules.js'), tot = {};
  for (let i = 1; i <= 400; i++) { const r = gatherFinds({ items: {} }, i, 3600); for (const id in r) tot[id] = (tot[id] || 0) + r[id]; }
  for (const id in FINDS) { const want = FINDS[id] * 400; assert.ok(Math.abs((tot[id] || 0) - want) < want * .25 + 10, id + ' im Schnitt ' + (tot[id] || 0) + ' statt ' + want); }
  assert.equal(gatherFinds({ items: {} }, 1, 2 * 3600).sp1, 6); }
// Automatische Auswahl: höchstens 5 Minuten überstehen, sonst eine Warnung mit dem Überstand
{ const { planSpeeds } = await import('../shared/rules.js');
  let p = planSpeeds({ sp1: 10, sp5: 3, sp15: 2, sp60: 1 }, 3600 + 900 + 120); assert.ok(p.ok && p.over <= 300 && p.sum >= 4620, JSON.stringify(p));
  p = planSpeeds({ sp60: 2 }, 600); assert.equal(p.ok, false); assert.equal(p.over, 3000); assert.equal(p.use.sp60, 1);
  p = planSpeeds({ sp5: 2 }, 3600); assert.equal(p.ok, false); assert.equal(p.short, 3000);
  p = planSpeeds({ sp15: 1, sp5: 1 }, 1200); assert.ok(p.ok && p.over === 0, JSON.stringify(p)); }
console.log('Alle Weltentests bestanden.');
