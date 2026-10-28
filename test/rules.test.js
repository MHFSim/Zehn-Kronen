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
assert.equal(applyCommand(S, { type: 'train', id: 'kaserne', unit: 'schwert', count: 2 }), '');
advanceTo(S, S.at + 2 * 360 * 1000 + 1000, 1);
assert.equal(S.troops.schwert, 22, 'Zwei Infanteristen ausgebildet (zu den 20 vom Start)'); assert.equal(S.troops.handkarren, 1, 'Start: 1 Handkarren');

// Lagergrenze wird nicht überschritten, auch nach langer Abwesenheit mit Tempo 100
advanceTo(S, S.at + 30 * 86400 * 1000, 100);
assert.ok(S.res.wood <= cap(S) + 1e-9, 'Holz bleibt unter der Lagergrenze');

// Einheiten laut Tabelle: Kosten ohne Nahrung, Traglast, Tempo, Transport im Lagerhaus
{
  assert.equal(Object.keys(U).length, 4, 'Infanterie, Fernkämpfer, Kavallerie, Handkarren');
  assert.deepEqual(U.schwert.cost, [0, 25, 45]); assert.equal(U.schwert.t, 360); assert.deepEqual(U.schwert.at, [10, 45, 50]); assert.deepEqual(U.schwert.df, [20, 35, 30]); assert.equal(U.schwert.name, 'Infanterie'); assert.equal(U.bogen.name, 'Fernkämpfer'); assert.equal(U.schwer.name, 'Kavallerie');
  assert.deepEqual(U.bogen.df, [14, 31, 10]); assert.equal(Math.round(U.schwer.s), 38); assert.equal(U.handkarren.c, 500);
  assert.ok(B.lager.units.includes('handkarren'), 'Transport wird im Lagerhaus gebaut');
  assert.equal(capacityOf({ handkarren: 2, schwert: 10 }), 1220, 'Karren erhöhen die Traglast');
  assert.ok(armySpeed({ schwert: 10, handkarren: 1 }) < armySpeed({ schwert: 10 }), 'Karren machen das Heer langsamer');
}
console.log('Alle Regeltests bestanden.');
{ // Karren im Heer dürfen die Kampfrechnung nicht verfälschen (früher: NaN, das ganze Heer war „tot“)
  const { battle, campTroops } = await import('../shared/combat.js');
  const a = battle({ schwert: 60 }, campTroops(1), 1, 1), b = battle({ schwert: 60, handkarren: 2 }, campTroops(1), 1, 1);
  assert.ok(a.win && b.win, 'Sieg auch mit Karren'); assert.equal(b.attLeft.handkarren, 2); assert.equal(b.attLeft.schwert, a.attLeft.schwert);
}

{ // Kampfdreieck: Infanterie schlägt Kavallerie, Kavallerie schlägt Fernkämpfer, Fernkämpfer schlagen Infanterie
  const { battle } = await import('../shared/combat.js');
  assert.ok(battle({ schwert: 100 }, { schwer: 100 }).win, 'Infanterie > Kavallerie');
  assert.ok(battle({ schwer: 100 }, { bogen: 100 }).win, 'Kavallerie > Fernkämpfer');
  assert.ok(battle({ bogen: 100 }, { schwert: 100 }).win, 'Fernkämpfer > Infanterie');
  assert.ok(!battle({ schwert: 100 }, { bogen: 100 }).win && !battle({ schwer: 100 }, { schwert: 100 }).win && !battle({ bogen: 100 }, { schwer: 100 }).win, 'und nicht umgekehrt');
  // Alte Spielstände: Speerträger, Armbrustschützen und Lanzenreiter werden zu Infanterie, Fernkämpfern und Kavallerie
  const { ensureState, ensureWorld } = await import('../shared/core.js');
  const O = { troops: { speer: 5, schwert: 3, leicht: 2 }, away: { armbrust: 4 }, train: { kaserne: [{ unit: 'speer', count: 2 }] }, lv: { rathaus: 1 } };
  ensureState(O); assert.deepEqual(O.troops, { schwert: 8, schwer: 2 }); assert.equal(O.away.bogen, 4); assert.equal(O.train.kaserne[0].unit, 'schwert');
  const W = { marches: [{ troops: { speer: 7 }, fight: { D0: { leicht: 3 } } }], outposts: { a: { garr: { 1: { armbrust: 2 } } } } };
  ensureWorld(W); assert.equal(W.marches[0].troops.schwert, 7); assert.equal(W.marches[0].fight.D0.schwer, 3); assert.equal(W.outposts.a.garr[1].bogen, 2);
}
