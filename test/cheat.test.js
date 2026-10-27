// Prüfung der Admin-Cheats: `npm test`
import assert from 'node:assert/strict';
import { addPlayer, command } from '../shared/world.js';
import { newWorld, DAY } from '../shared/core.js';
import { cheat } from '../shared/cheat.js';

const T0 = 1_000_000_000_000;
const match = { id: 1, name: 'T', speed: 100, seed: 4242, world: newWorld(T0) }, players = [];
for (let i = 1; i <= 2; i++) { const S = addPlayer(match, players, i, 'P' + i, T0); players.push({ id: i, name: 'P' + i, state: S }); }
const [a, b] = players;
assert.equal(cheat(match, players, { kind: 'resources', player: a.id, food: 500, gold: 70 }, T0), '');
assert.equal(a.state.res.food, 1100); assert.equal(a.state.res.gold, 170); assert.equal(b.state.res.food, 600);
assert.equal(cheat(match, players, { kind: 'troops', player: 'all', count: 50, unit: 'speer' }, T0), ''); assert.equal(b.state.troops.speer, 50);
assert.equal(cheat(match, players, { kind: 'levels', player: a.id, level: 6 }, T0), ''); assert.equal(a.state.lv.rathaus, 6); assert.equal(a.state.lv.farm, 6);
a.state.res.food = a.state.res.wood = a.state.res.stone = a.state.res.ore = 9999;
assert.equal(command(match, players, a, { type: 'upgrade', id: 'rathaus' }, T0), ''); assert.equal(a.state.queue.length, 1);
assert.equal(cheat(match, players, { kind: 'finish', player: a.id }, T0), ''); assert.equal(a.state.queue.length, 0); assert.equal(a.state.lv.rathaus, 7);
assert.equal(cheat(match, players, { kind: 'items', player: a.id, teleport: 2, sp15: 3 }, T0), ''); assert.equal(a.state.items.teleport, 2);
assert.equal(cheat(match, players, { kind: 'protection', player: 'all', on: false }, T0), ''); assert.equal(a.state.protUntil, 0);
const gt0 = match.world.gt; assert.equal(cheat(match, players, { kind: 'time', hours: 10 }, T0), ''); assert.ok(match.world.gt - gt0 > 9.9 * 3600, 'Zeit vorgespult: ' + (match.world.gt - gt0));
assert.match(cheat(match, players, { kind: 'nix' }, T0), /Unbekannt/);
assert.match(cheat(match, players, { kind: 'troops', player: 99 }, T0), /nicht gefunden/);
console.log('Alle Cheat-Tests bestanden.');
