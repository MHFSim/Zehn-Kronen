// Prüfung von Revier und Außenposten: `npm test`
import assert from 'node:assert/strict';
import { syncMatch, addPlayer, command, viewFor } from '../shared/world.js';
import { newWorld, mapOf, DAY } from '../shared/core.js';
import { checkSite, territory, touches, cityR, OP_R, OP_BUILD } from '../shared/outpost.js';

const T0 = 1_000_000_000_000;
const match = { id: 1, name: 'T', speed: 100, seed: 4242, world: newWorld(T0) }, players = [];
for (let i = 1; i <= 3; i++) { const S = addPlayer(match, players, i, 'P' + i, T0); players.push({ id: i, name: 'P' + i, state: S }); }
const [a, b, c] = players; let clock = T0;
const adv = sec => { clock += sec / match.speed * 1000; syncMatch(match, players, clock); };
const run = (p, cmd) => command(match, players, p, cmd, clock);
const give = (p, t) => { for (const u in t) p.state.troops[u] = (p.state.troops[u] || 0) + t[u]; };
const rich = p => { for (const r of ['food', 'wood', 'stone', 'ore']) p.state.res[r] = 99999; };

// Revier der Burg und Prüfung eines Bauplatzes
const [cx, cy] = a.state.pos, R = cityR(a.state.lv.rathaus), map = mapOf(match);
assert.ok(touches(territory(match, players, 0), 'p1', cx + R + 1, cy), 'Burg-Viereck samt Rand');
const toward = (x, y, d) => { const dx = 100 - x, dy = 100 - y, l = Math.hypot(dx, dy); return [Math.round(x + dx / l * d), Math.round(y + dy / l * d)]; };
let site = null;
for (let d = R + OP_R[1]; d >= 2 && !site; d--) { for (let o = -3; o <= 3 && !site; o++) { const [x, y] = toward(cx, cy, d); if (!checkSite(match, players, a, x + o, y, 1, 0)) site = [x + o, y]; } }
assert.ok(site, 'es gibt einen Bauplatz nahe der Burg');
assert.match(checkSite(match, players, a, ...toward(cx, cy, 40), 1, 0), /berühren|Wasser|Zu nah/, 'zu weit weg');
assert.match(checkSite(match, players, a, cx, cy, 1, 0), /Zu nah/, 'nicht auf der Burg');

// Bauen: Heer losschicken, Besatzung bleibt, nach der Bauzeit zählt das Revier
give(a, { speer: 100 });
assert.match(run(a, { type: 'march', mode: 'build', x: site[0], y: site[1], troops: { speer: 20 } }), /mindestens/);
a.state.res.wood = 0; assert.match(run(a, { type: 'march', mode: 'build', x: site[0], y: site[1], troops: { speer: 60 } }), /Rohstoffe/);
rich(a);
assert.equal(run(a, { type: 'march', mode: 'build', x: site[0], y: site[1], troops: { speer: 60 } }), '');
adv(DAY);
const ops = Object.values(match.world.outposts); assert.equal(ops.length, 1);
const op = ops[0]; assert.equal(op.owner, a.id); assert.equal(op.garr.speer, 60);
adv(OP_BUILD[1]); assert.ok(territory(match, players, match.world.gt).some(r => r.id === op.id && r.ready));
assert.equal(viewFor(match, players, a, clock).world.outposts[0].garr.speer, 60);
assert.equal(viewFor(match, players, b, clock).world.outposts[0].garr, undefined, 'Besatzung ist geheim');

// Fremdes Revier darf nicht überlappt werden
assert.match(checkSite(match, players, b, op.x, op.y + 1, 1, match.world.gt), /überlappen|Zu nah|Hier steht/);

// Ausbau
assert.equal(run(a, { type: 'opUpgrade', id: op.id }), ''); assert.match(run(a, { type: 'opUpgrade', id: op.id }), /schon/);
adv(OP_BUILD[2] + 10); assert.equal(op.lv, 2);
assert.ok(territory(match, players, match.world.gt).find(r => r.id === op.id).r === OP_R[2]);

// Thron/Heiligtum: nur mit Revier
give(a, { schwert: 500 }); rich(a);
assert.match(run(a, { type: 'march', target: 'throne1', mode: 'occupy', troops: { schwert: 100 } }), /Revier/);

// Angriff zerstört den Außenposten, Besatzung geht verloren
adv(5 * DAY);   // Schutz vorbei
give(b, { schwert: 600, speer: 300 }); rich(b); b.state.res.gold = 999;
assert.equal(run(b, { type: 'march', target: op.id, mode: 'raid', troops: { schwert: 600, speer: 300 } }), '');
adv(DAY);
assert.equal(Object.keys(match.world.outposts).length, 0, 'zerstört');
assert.ok(a.state.reports.some(r => r.kind === 'outpost' && !r.win), 'Bericht für den Besitzer');
assert.ok(b.state.reports.some(r => r.kind === 'outpost' && r.win), 'Bericht für den Angreifer');
assert.match(run(b, { type: 'march', target: op.id, mode: 'raid', troops: { schwert: 5 } }), /gibt es nicht/);
console.log('Alle Außenposten-Tests bestanden.');
