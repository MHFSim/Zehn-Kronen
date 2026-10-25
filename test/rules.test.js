// Kurze Prüfung der Spielregeln: `npm test`
import assert from 'node:assert/strict';
import { freshState, applyCommand, advanceTo, cap, costOf, timeOf } from '../shared/rules.js';

const t0 = 1_000_000;
let S = freshState(t0);

assert.equal(applyCommand(S, { type: 'upgrade', id: 'kaserne' }), 'Freigeschaltet ab Rathaus Stufe 2');
assert.equal(applyCommand(S, { type: 'upgrade', id: 'farm' }), 'Erst das Rathaus auf Stufe 2 ausbauen');
assert.equal(applyCommand(S, { type: 'upgrade', id: 'rathaus' }), '');
assert.equal(S.res.food, 600 - costOf('rathaus', 2)[0]);
assert.equal(applyCommand(S, { type: 'upgrade', id: 'saege' }), 'Erst das Rathaus auf Stufe 2 ausbauen');

advanceTo(S, t0 + timeOf('rathaus', 2) * 1000 + 1000, 1);
assert.equal(S.lv.rathaus, 2, 'Rathaus fertig');
assert.equal(S.queue.length, 0);

assert.equal(applyCommand(S, { type: 'upgrade', id: 'kaserne' }), '');
advanceTo(S, S.at + 3600 * 1000, 1);
assert.equal(S.lv.kaserne, 1, 'Kaserne fertig');

assert.equal(applyCommand(S, { type: 'train', id: 'kaserne', unit: 'bogen', count: 5 }), 'Diese Einheit wird hier nicht ausgebildet');
assert.equal(applyCommand(S, { type: 'train', id: 'kaserne', unit: 'speer', count: 2 }), '');
advanceTo(S, S.at + 2 * 30 * 1000 + 1000, 1);
assert.equal(S.troops.speer, 2, 'Zwei Speerträger ausgebildet');

// Lagergrenze wird nicht überschritten, auch nach langer Abwesenheit mit Tempo 100
advanceTo(S, S.at + 30 * 86400 * 1000, 100);
assert.ok(S.res.wood <= cap(S) + 1e-9, 'Holz bleibt unter der Lagergrenze');

console.log('Alle Regeltests bestanden.');
