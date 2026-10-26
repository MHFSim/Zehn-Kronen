// Prüfung der Forschung: `npm test`
import assert from 'node:assert/strict';
import { freshState, applyCommand, advanceTo, rate, techCost, techTime, techMult, T_MAX, T } from '../shared/rules.js';
import { battle, capacityOf, forceOf } from '../shared/combat.js';
const S = freshState(0); S.res = { food: 1e5, wood: 1e5, stone: 1e5, ore: 1e5, gold: 0 };
assert.match(applyCommand(S, { type: 'research', tech: 'ackerbau' }), /Akademie/);
S.lv.akademie = 1; S.lv.rathaus = 9;
assert.match(applyCommand(S, { type: 'research', tech: 'gibtsnicht' }), /Unbekannt/);
const r0 = rate(S, 'food'), before = { ...S.res };
assert.equal(applyCommand(S, { type: 'research', tech: 'ackerbau' }), '');
assert.ok(S.res.food < before.food && S.research.id === 'ackerbau');
assert.match(applyCommand(S, { type: 'research', tech: 'forst' }), /forscht schon/);
assert.equal(applyCommand(S, { type: 'cancelResearch' }), ''); assert.equal(S.res.wood, before.wood); assert.equal(S.research, null);
assert.equal(applyCommand(S, { type: 'research', tech: 'ackerbau' }), '');
advanceTo(S, techTime('ackerbau', 1) * 1000 + 1000, 1);
assert.equal(S.tech.ackerbau, 1); assert.equal(S.research, null);
assert.ok(Math.abs(rate(S, 'food') / r0 - 1.08) < .001, 'Nahrung +8 %');
assert.match(applyCommand(S, { type: 'research', tech: 'ackerbau' }), /Akademie Stufe 3/);
S.lv.akademie = 9; for (let i = 2; i <= T_MAX; i++) { assert.equal(applyCommand(S, { type: 'research', tech: 'ackerbau' }), ''); S.at = 0; advanceTo(S, 1e9 * 1000, 1); }
assert.equal(S.tech.ackerbau, 5); assert.match(applyCommand(S, { type: 'research', tech: 'ackerbau' }), /Höchststufe/);
assert.ok(techCost('ackerbau', 3)[0] > techCost('ackerbau', 1)[0]);
// Wirkung im Kampf, bei der Traglast
S.tech.kriegskunst = 5; S.tech.lasten = 3;
assert.equal(forceOf(S), 1.2); assert.equal(capacityOf({ speer: 100 }, S), 1950);
const att = { speer: 100 }, def = { speer: 100 };
assert.equal(battle(att, def, 1, 1).win, false);
assert.equal(battle(att, def, 1, 1.5).win, true);
assert.equal(Object.keys(T).length, 8);
console.log('Alle Forschungstests bestanden.');
