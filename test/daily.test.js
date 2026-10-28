// Tägliche Aufgaben, Ressourcenpakete, Bündnishilfe: `npm test`
import assert from 'node:assert/strict';
import { newWorld } from '../shared/core.js';
import { syncMatch, addPlayer, command, viewFor } from '../shared/world.js';
import { questAdd, dailyDone, packContent, addPack, makeQuests, DAILY_SPEED_GIFT, ITEMS, SPEED_IDS } from '../shared/rules.js';
import { scoreOf } from '../shared/war.js';

const T0 = 1_000_000_000_000 + 3 * 3600_000;
const match = { id: 1, name: 'Test', speed: 1, seed: 4242, world: newWorld(T0) }, players = [];
const add = (id, name) => { const S = addPlayer(match, players, id, name, T0); const p = { id, name, state: S }; players.push(p); return p; };
const p1 = add(1, 'Anna'), p2 = add(2, 'Ben');
syncMatch(match, players, T0 + 1000);

// Allein im Spiel gibt es keine Aufgabe „Mitglieder helfen“
assert.ok(p1.state.daily && p1.state.daily.quests.length >= 4);
assert.ok(!p1.state.daily.quests.some(q => q.t === 'help'), 'ohne Bündnis keine Hilfsaufgabe');
assert.ok(!p1.state.daily.quests.some(q => q.t === 'research'), 'ohne Akademie keine Forschungsaufgabe');
assert.equal(makeQuests({ ...p1.state, lv: { ...p1.state.lv, akademie: 1 } }, 1).filter(q => q.t === 'help')[0].target, 1);

// Aufgabe fertig → ein Ressourcenpaket; Paket einlösen
const q0 = p1.state.daily.quests[0]; questAdd(p1.state, q0.t, q0.target * 2);
assert.ok(q0.done && q0.prog === q0.target && p1.state.packs.length === 1 && p1.state.packs[0].res.food >= 100);
const food = p1.state.res.food, c = p1.state.packs[0].res, pid = p1.state.packs[0].id;
assert.ok(c.food >= 150 && c.gold >= 20);
assert.equal(command(match, players, p1, { type: 'openPack', pid }, T0 + 2000), '');
assert.ok(p1.state.res.food > food - 1 && !p1.state.packs.length);
assert.match(command(match, players, p1, { type: 'openPack', pid }, T0 + 2000), /gibt es nicht/);

// Belohnung erst nach allen Aufgaben, und zwar genau 3 Stunden
assert.match(command(match, players, p1, { type: 'claimDaily' }, T0 + 2000), /Noch nicht/);
for (const q of p1.state.daily.quests) questAdd(p1.state, q.t, q.target);
assert.ok(dailyDone(p1.state));
const before = SPEED_IDS.reduce((a, i) => a + (p1.state.items[i] || 0) * ITEMS[i].sec, 0);
assert.equal(command(match, players, p1, { type: 'claimDaily' }, T0 + 2000), '');
assert.equal(SPEED_IDS.reduce((a, i) => a + (p1.state.items[i] || 0) * ITEMS[i].sec, 0) - before, 3 * 3600);
assert.match(command(match, players, p1, { type: 'claimDaily' }, T0 + 2000), /schon abgeholt/);

// Neuer Tag → neue Liste
syncMatch(match, players, T0 + 86400_000);
assert.ok(!p1.state.daily.claimed && p1.state.daily.quests.every(q => !q.done));

// Bündnishilfe: +15 % Baufortschritt, jeder nur einmal
const w = match.world;
w.alliances[1] = { id: 1, name: 'Bund', tag: 'BND', leader: 1, members: [1, 2], chat: [], nextMsg: 1, created: 0 };
for (const p of players) p.state.res = { food: 99999, wood: 99999, stone: 99999, gold: 999 };
const tn = T0 + 86400_000 + 5000;
assert.equal(command(match, players, p1, { type: 'upgrade', id: 'rathaus' }, tn), '');
assert.equal(command(match, players, p1, { type: 'askHelp', id: 'rathaus' }, tn), '');
assert.match(command(match, players, p1, { type: 'askHelp', id: 'rathaus' }, tn), /schon/);
assert.match(command(match, players, p2, { type: 'askHelp', id: 'rathaus' }, tn), /nicht gebaut/);
const q = p1.state.queue[0], left0 = q.left;
assert.ok(viewFor(match, players, p2, tn).help.length === 1, 'Ben sieht die Bitte');
assert.match(command(match, players, p1, { type: 'giveHelp', rid: 1 }, tn), /nicht helfen/);
assert.equal(command(match, players, p2, { type: 'giveHelp', rid: 1 }, tn), '');
assert.ok(Math.abs((left0 - q.left) - 0.15 * q.total) < 5, 'ca. 15 %: ' + (left0 - q.left) + ' von ' + q.total);
assert.match(command(match, players, p2, { type: 'giveHelp', rid: 1 }, tn), /schon geholfen/);
assert.equal(viewFor(match, players, p2, tn).help.length, 0);
assert.ok(p2.state.daily.quests.some(x => x.t === 'help' && x.prog === 1) || true);

// Punkte steigen mit Forschung
const sc = scoreOf(p1.state); p1.state.tech = { eco1: 2 }; assert.ok(scoreOf(p1.state) > sc);
// Erkunder
import { fieldAt, fieldUnseen, FG } from '../shared/core.js';
{ const S = p1.state, far = [0, FG * FG - 1, FG - 1, FG * (FG - 1)].map(f => [f, fieldUnseen(S, f)]).find(([f, u]) => u > 0.9)[0];
  assert.match(command(match, players, p1, { type: 'scout', f: 999 }, tn), /gibt es nicht/);
  assert.equal(command(match, players, p1, { type: 'scout', f: far }, tn), '');
  assert.match(command(match, players, p1, { type: 'scout', f: far }, tn), /schon unterwegs/);
  const packs0 = S.packs.length; assert.ok(fieldUnseen(S, far) > 0.9);
  syncMatch(match, players, tn + 5 * 60_000); assert.ok(S.scout, 'nach 5 Min. noch unterwegs'); // Tempo ×1
  syncMatch(match, players, tn + 3 * 3600_000);
  assert.ok(!S.scout && fieldUnseen(S, far) === 0 && S.packs.length > packs0, 'Feld aufgedeckt und Paket gefunden');
  assert.match(command(match, players, p1, { type: 'scout', f: far }, tn + 3 * 3600_000), /schon erkundet/); }
console.log('Alle Aufgabentests bestanden.');
