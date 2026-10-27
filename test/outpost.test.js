// Prüfung von Revier, Außenposten, Bündnislager, Teleporter und Shop: `npm test`
import assert from 'node:assert/strict';
import { syncMatch, addPlayer, command, viewFor } from '../shared/world.js';
import { newWorld, mapOf, DAY } from '../shared/core.js';
import { NODE_KINDS } from '../shared/mapgen.js';
import { checkSite, checkTeleport, territory, touches, inside, cityR, OP_R, OP_BUILD, OP_COST, storeOf } from '../shared/outpost.js';

const T0 = 1_000_000_000_000;
const match = { id: 1, name: 'T', speed: 100, seed: 4242, world: newWorld(T0) }, players = [];
for (let i = 1; i <= 4; i++) { const S = addPlayer(match, players, i, 'P' + i, T0); players.push({ id: i, name: 'P' + i, state: S }); }
const [a, b, c, d] = players; let clock = T0;
const adv = sec => { clock += sec / match.speed * 1000; syncMatch(match, players, clock); };
const run = (p, cmd) => command(match, players, p, cmd, clock);
const give = (p, t) => { for (const u in t) p.state.troops[u] = (p.state.troops[u] || 0) + t[u]; };
const rich = p => { for (const r of ['food', 'wood', 'stone', 'ore']) p.state.res[r] = 99999; p.state.res.gold = 99999; };
const map = mapOf(match), w = match.world;
const gt = () => w.gt;

// Ohne Bündnis kein Außenposten
const [cx, cy] = a.state.pos, R = cityR(a.state.lv.rathaus);
const toward = (x, y, dd) => { const dx = 100 - x, dy = 100 - y, l = Math.hypot(dx, dy); return [Math.round(x + dx / l * dd), Math.round(y + dy / l * dd)]; };
const findSite = (p, from, ds) => { for (const dd of ds) for (let o = -4; o <= 4; o++) { const [x, y] = toward(from[0], from[1], dd); if (!checkSite(match, players, p, x + o, y, gt())) return [x + o, y]; } return null; };
assert.match(checkSite(match, players, a, cx + 9, cy, 0), /Bündnis/);

assert.equal(territory(match, players, 0).length, 0, 'ohne Bündnis gibt es kein Revier');
// Bündnis a+b, Rivale c
assert.equal(run(a, { type: 'allyCreate', name: 'Rote', tag: 'ROT' }), '');
assert.equal(run(a, { type: 'allyInvite', name: 'P2' }), ''); assert.equal(run(b, { type: 'allyAnswer', id: viewFor(match, players, b, clock).invites[0].id, accept: true }), '');
assert.equal(run(c, { type: 'allyCreate', name: 'Blaue', tag: 'BLA' }), '');
const al = w.alliances[1];
assert.ok(touches(territory(match, players, 0), 'a1', cx + R + 1, cy), 'Burg-Viereck samt Rand');
const site = findSite(a, [cx, cy], [R + OP_R, R + OP_R - 2, R + 2]); assert.ok(site, 'Bauplatz nahe der Burg');
assert.match(checkSite(match, players, a, ...toward(cx, cy, 45), gt()), /berühren|Wasser|Zu nah/);

assert.match(checkSite(match, players, b, site[0], site[1], gt()), /Gründer/, 'den ersten baut der Gründer');
assert.equal(territory(match, players, 0).filter(r => r.k === 'city' && r.group === 'a1').length, 1, 'nur die Burg des Gründers');
assert.equal(run(b, { type: 'allyColor', color: '#112233' }), 'Nur der Anführer kann die Farbe wählen.');
assert.equal(run(a, { type: 'allyColor', color: '#112233' }), ''); assert.equal(al.color, '#112233');
// Bündnislager: ohne Rohstoffe geht nichts, Einzahlen füllt es
give(a, { speer: 200 }); give(b, { speer: 200, schwert: 100 }); rich(a); rich(b);
assert.match(run(a, { type: 'march', mode: 'build', x: site[0], y: site[1], troops: { speer: 60 } }), /Bündnislager/);
assert.match(run(a, { type: 'donate', amounts: { food: 1e9 } }), /nicht/);
assert.equal(run(a, { type: 'donate', amounts: { food: 1000, wood: 2000, stone: 2000, ore: 500 } }), '');
assert.equal(storeOf(al).wood, 2000); assert.equal(a.state.res.wood, 99999 - 2000);
assert.equal(viewFor(match, players, b, clock).ally.store.food, 1000, 'alle Mitglieder sehen das Lager');
assert.match(run(a, { type: 'march', mode: 'build', x: site[0], y: site[1], troops: { speer: 20 } }), /mindestens/);

// Bauen aus dem Lager
assert.equal(run(a, { type: 'march', mode: 'build', x: site[0], y: site[1], troops: { speer: 60 } }), '');
assert.equal(storeOf(al).wood, 2000 - OP_COST[1]);
assert.equal(territory(match, players, gt()).filter(r => r.k === 'city' && r.group === 'a1').length, 1, 'Burg-Viereck bleibt, bis der Posten fertig ist');
adv(DAY);
const op = Object.values(w.outposts)[0]; assert.ok(op); assert.equal(op.al, 1); assert.equal(op.garr[a.id].speer, 60);
adv(OP_BUILD); assert.ok(territory(match, players, gt()).some(r => r.id === op.id && r.ready));
assert.equal(viewFor(match, players, c, clock).world.outposts[0].garr, undefined, 'Besatzung ist geheim');
assert.equal(viewFor(match, players, b, clock).world.outposts[0].garr[a.id].speer, 60);

assert.equal(territory(match, players, gt()).filter(r => r.k === 'city' && r.group === 'a1').length, 0, 'danach entfällt das Burg-Viereck');
// Auf Wegen läuft man 30 % schneller
{ const { planFrom } = await import('../shared/core.js'), { ROAD_SPEED } = await import('../shared/mapgen.js');
  const from = [a.state.pos[0], a.state.pos[1]], saved = map.roads;
  assert.ok(map.roads && map.roads.some(Boolean), 'Weg zum Außenposten existiert');
  const withRoad = planFrom(map, from, op.x, op.y, { speer: 10 }, a.state); map.roads = null;
  const without = planFrom(map, from, op.x, op.y, { speer: 10 }, a.state); map.roads = saved;
  assert.ok(withRoad.duration < without.duration * 0.9, 'Weg macht schneller: ' + withRoad.duration + ' < ' + without.duration);
  assert.ok(ROAD_SPEED === 1.3); }
// Fremde dürfen nicht überlappen; weiterbauen nur am eigenen Revier
assert.match(checkSite(match, players, c, op.x, op.y + 3, gt()), /überlappen|Zu nah|Hier steht/);
const site2 = findSite(a, [op.x, op.y], [2 * OP_R + 1, 2 * OP_R, 2 * OP_R - 2]); assert.ok(site2, 'zweiter Bauplatz am ersten Außenposten');

// Mitglieder bewachen: b schickt Truppen, zieht sie ab; Verschieben zu einem anderen Außenposten
assert.equal(run(b, { type: 'march', mode: 'garrison', target: op.id, troops: { speer: 80 } }), '');
give(c, { speer: 5 }); assert.match(run(c, { type: 'march', mode: 'garrison', target: op.id, troops: { speer: 1 } }), /Keine Truppen|Bündnis/);
adv(DAY); assert.equal(op.garr[b.id].speer, 80);
storeOf(al).food = storeOf(al).wood = storeOf(al).stone = storeOf(al).ore = 99999;
assert.equal(run(b, { type: 'march', mode: 'build', x: site2[0], y: site2[1], troops: { speer: 50 } }), '');
adv(DAY + OP_BUILD);
assert.equal(Object.keys(w.outposts).length, 2);
const op2 = Object.values(w.outposts).find(o => o.id !== op.id);
assert.equal(run(b, { type: 'opMove', from: op.id, to: op2.id }), '');
assert.equal(op.garr[b.id], undefined, 'Truppen sind unterwegs');
adv(DAY); assert.equal(op2.garr[b.id].speer, 130);
assert.equal(run(b, { type: 'opRecall', id: op2.id }), ''); assert.equal(op2.garr[b.id], undefined);
adv(DAY); assert.ok(b.state.troops.speer >= 200 - 50 - 80 + 80 + 50, 'Truppen sind daheim');

// Farmen im Bündnisgebiet: zusätzlich ins Bündnislager, Spieler bekommt volle Beute
const node = map.objects.find(o => NODE_KINDS.includes(o.k) && inside(territory(match, players, gt()), 'a1', o.x, o.y));
if (node) {
  const before = { ...storeOf(al) }, res = node.k === 'farm' ? 'food' : node.k, rb = b.state.res[res];
  assert.equal(run(b, { type: 'march', target: node.id, troops: { speer: 100 } }), '');
  adv(3 * DAY);
  assert.ok(storeOf(al)[res] > before[res], 'Bündnislager bekommt einen Anteil');
}

// Teleporter und Shop
assert.match(run(a, { type: 'teleport', x: cx + 2, y: cy }), /Teleporter/);
assert.equal(run(a, { type: 'buy', item: 'teleport', n: 1 }), ''); assert.equal(a.state.items.teleport, 1);
assert.match(run(a, { type: 'teleport', x: 5, y: 5 }), /Gebiet|Rand|Wasser/);
let spot = null;
for (let x = op.x - OP_R; x <= op.x + OP_R && !spot; x += 2) for (let y = op.y - OP_R; y <= op.y + OP_R && !spot; y += 2) if (!checkTeleport(match, players, a, x, y, gt())) spot = [x, y];
assert.ok(spot, 'ein Teleportziel im Bündnisgebiet');
assert.equal(run(a, { type: 'teleport', x: spot[0], y: spot[1] }), '');
assert.deepEqual(a.state.pos, spot); assert.equal(a.state.items.teleport, 0);
assert.equal(run(a, { type: 'buy', item: 'teleport', n: 1 }), ''); assert.match(run(a, { type: 'teleport', x: spot[0], y: spot[1] + 1 }), /lädt/);

// Speedups
a.state.res.food = a.state.res.wood = a.state.res.stone = a.state.res.ore = 9999;
assert.equal(run(a, { type: 'upgrade', id: 'rathaus' }), '');
const left0 = a.state.queue[0].left;
assert.match(run(a, { type: 'useSpeed', item: 'sp5', kind: 'build', ref: 'rathaus' }), /keinen/);
assert.equal(run(a, { type: 'buy', item: 'sp5', n: 2 }), '');
assert.equal(run(a, { type: 'useSpeed', item: 'sp5', kind: 'build', ref: 'rathaus' }), ''); assert.ok(a.state.queue.length === 0 || a.state.queue[0].left < left0);
assert.equal(a.state.items.sp5, 1);

// Angriff auf Außenposten: nur mit angrenzendem eigenen Posten
const cAl = allianceOfId(c); function allianceOfId(p) { return Object.values(w.alliances).find(x => x.members.includes(p.id)); }
const target = op;
give(c, { schwert: 800, speer: 400 }); rich(c); give(d, { schwert: 400 }); rich(d);
adv(5 * DAY);
assert.match(run(c, { type: 'march', target: target.id, mode: 'raid', troops: { schwert: 100 } }), /angrenzt/);
const sideX = target.x + 2 * OP_R + 1;
{ // Kette von der Burg des Bündnisleiters bis neben das Ziel (inaktive, getrennte Außenposten könnten nicht angreifen)
  const lead = players.find(p => p.id === cAl.leader), sp = lead.state.pos, n = Math.ceil(Math.hypot(sideX - sp[0], target.y - sp[1]) / 9);
  for (let i = 1; i <= n; i++) { const id = i === n ? 'opC' : 'opC' + i; w.outposts[id] = { id, al: cAl.id, by: c.id, x: Math.round(sp[0] + (sideX - sp[0]) * i / n), y: Math.round(sp[1] + (target.y - sp[1]) * i / n), done: 0, garr: {} }; } }
assert.equal(run(d, { type: 'march', target: target.id, mode: 'raid', troops: { schwert: 100 } }), 'Nur Bündnisse kämpfen um Außenposten. Gründe eines oder tritt einem bei.');
assert.equal(run(c, { type: 'march', target: target.id, mode: 'raid', troops: { schwert: 800, speer: 400 } }), '');
adv(2 * DAY);
assert.ok(!w.outposts[target.id], 'zerstört');
assert.ok(a.state.reports.some(r => r.kind === 'outpost' && !r.win), 'Bericht für Mitglied');
assert.ok(c.state.reports.some(r => r.kind === 'outpost' && r.win));
console.log('Alle Außenposten-Tests bestanden.');
