// Kurze Prüfung der Spielregeln: `npm test`
import assert from 'node:assert/strict';
import { freshState, applyCommand, advanceTo, cap, costOf, timeOf, U, B } from '../shared/rules.js';
import { capacityOf, armySpeed } from '../shared/combat.js';

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
advanceTo(S, S.at + 2 * 240 * 1000 + 1000, 1);
assert.equal(S.troops.speer, 22, 'Zwei Speerträger ausgebildet (zu den 20 vom Start)'); assert.equal(S.troops.handkarren, 1, 'Start: 1 Handkarren');

// Lagergrenze wird nicht überschritten, auch nach langer Abwesenheit mit Tempo 100
advanceTo(S, S.at + 30 * 86400 * 1000, 100);
assert.ok(S.res.wood <= cap(S) + 1e-9, 'Holz bleibt unter der Lagergrenze');

// Einheiten laut Tabelle: Kosten ohne Nahrung, Traglast, Tempo, Transport im Lagerhaus
{
  assert.equal(Object.keys(U).length, 7);
  assert.deepEqual(U.speer.cost, [0, 20, 25]); assert.equal(U.speer.t, 240); assert.deepEqual(U.speer.at, [5, 7, 12]); assert.deepEqual(U.speer.df, [20, 31, 58]);
  assert.deepEqual(U.armbrust.df, [59, 91, 32]); assert.equal(Math.round(U.schwer.s), 38); assert.equal(U.handkarren.c, 500);
  assert.ok(B.lager.units.includes('handkarren'), 'Transport wird im Lagerhaus gebaut');
  assert.equal(capacityOf({ handkarren: 2, speer: 10 }), 1220, 'Karren erhöhen die Traglast');
  assert.ok(armySpeed({ speer: 10, handkarren: 1 }) < armySpeed({ speer: 10 }), 'Karren machen das Heer langsamer');
}
console.log('Alle Regeltests bestanden.');
{ // Karren im Heer dürfen die Kampfrechnung nicht verfälschen (früher: NaN, das ganze Heer war „tot“)
  const { battle, campTroops } = await import('../shared/combat.js');
  const a = battle({ speer: 60 }, campTroops(1), 1, 1), b = battle({ speer: 60, handkarren: 2 }, campTroops(1), 1, 1);
  assert.ok(a.win && b.win, 'Sieg auch mit Karren'); assert.equal(b.attLeft.handkarren, 2); assert.equal(b.attLeft.speer, a.attLeft.speer);
}
