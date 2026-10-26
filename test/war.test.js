// Prüfung von Schutz, Bündnissen, Angriffen, Vasallen, Ausscheiden, Stationieren, Thron und Spielende: `npm test`
import assert from 'node:assert/strict';
import { syncMatch, addPlayer, command, viewFor, startMatch, pauseMatch, resumeMatch, endMatch } from '../shared/world.js';
import { newWorld, mapOf, DAY, allianceCap, byId } from '../shared/core.js';

const T0 = 1_000_000_000_000;
const mk = (n, o = {}) => {
  const match = { id: 1, name: 'T', speed: 100, seed: 4242, world: newWorld(T0, o) }, players = [];
  for (let i = 1; i <= n; i++) { const S = addPlayer(match, players, i, 'P' + i, T0); players.push({ id: i, name: 'P' + i, state: S }); }
  return { match, players };
};
const give = (p, t) => { for (const u in t) p.state.troops[u] = (p.state.troops[u] || 0) + t[u]; };
// Spielzeit vorspulen (echte Millisekunden = Spielsekunden / Tempo)
let clock = T0;
const adv = (match, players, gameSec) => { clock += gameSec / match.speed * 1000; syncMatch(match, players, clock); };
const run = (match, players, c, p, cmd) => command(match, players, p, cmd, c);

// Bündnisgröße: Hälfte der Spieler plus eins
assert.equal(allianceCap(10), 6); assert.equal(allianceCap(4), 3);

// ---- Lobby: Zeit steht, Befehle gesperrt, Start gibt Schutz ----
{
  const { match, players } = mk(2, { phase: 'lobby' });
  const [a] = players, gt0 = match.world.gt;
  syncMatch(match, players, T0 + 5_000_000); assert.equal(match.world.gt, gt0);
  assert.match(command(match, players, a, { type: 'build', id: 'farm' }, T0 + 1), /noch nicht begonnen/);
  assert.equal(startMatch(match, players, T0 + 6_000_000), '');
  assert.equal(match.world.phase, 'running');
  assert.ok(a.state.protUntil > match.world.gt + 3.9 * DAY);
  assert.equal(pauseMatch(match, players, T0 + 6_000_100), ''); const g = match.world.gt;
  syncMatch(match, players, T0 + 9_000_000); assert.equal(match.world.gt, g);
  assert.equal(resumeMatch(match, players, T0 + 9_000_000), '');
}

// ---- Bündnisse ----
{
  const { match, players } = mk(4); const [a, b, c, d] = players;
  assert.equal(run(match, players, T0, a, { type: 'allyCreate', name: 'Rote Garde', tag: 'rot' }), '');
  assert.match(run(match, players, T0, b, { type: 'allyCreate', name: 'rote garde', tag: 'XY' }), /gibt es schon/);
  assert.equal(run(match, players, T0, a, { type: 'allyInvite', name: 'P2' }), '');
  const v = viewFor(match, players, b, T0); assert.equal(v.invites.length, 1);
  assert.equal(run(match, players, T0, b, { type: 'allyAnswer', id: v.invites[0].id, accept: true }), '');
  assert.equal(run(match, players, T0, c, { type: 'allyRequest', al: 1 }), '');
  const lead = viewFor(match, players, a, T0); assert.equal(lead.ally.requests.length, 1);
  assert.equal(run(match, players, T0, a, { type: 'allyAnswer', id: lead.ally.requests[0].id, accept: true }), '');
  assert.match(run(match, players, T0, a, { type: 'allyInvite', name: 'P4' }), /voll/);   // 4 Spieler: höchstens 3
  assert.equal(run(match, players, T0, a, { type: 'allyChat', text: 'Hallo' }), '');
  assert.equal(viewFor(match, players, b, T0).ally.chat.length, 1);
  assert.match(run(match, players, T0, d, { type: 'allyChat', text: 'x' }), /keinem Bündnis/);
  // Austritt: sperrt Angriffe kurz, darf allein ein neues Bündnis gründen
  assert.equal(run(match, players, T0, c, { type: 'allyLeave' }), '');
  assert.equal(run(match, players, T0, c, { type: 'allyCreate', name: 'Einsam', tag: 'EIN' }), '');
  assert.ok(c.state.exAllies[1] > 0);
  assert.equal(match.world.alliances[1].members.length, 2);
}

// ---- Schutz, Angriff, Vasall, Ausscheiden ----
{
  const { match, players } = mk(3); const [a, b, c] = players;
  const map = mapOf(match), cityOf = p => map.objects.find(o => o.k === 'start' && o.slot === p.state.slot);
  // Neulinge sind 4 Tage geschützt
  give(a, { schwert: 400, bogen: 200, speer: 200 }); a.state.train = {};
  assert.match(run(match, players, clock, a, { type: 'march', target: cityOf(b).id, mode: 'attack', troops: { schwert: 100 } }), /Schutz/);
  assert.match(run(match, players, clock, a, { type: 'march', target: cityOf(a).id, mode: 'attack', troops: { schwert: 100 } }), /eigene/);
  adv(match, players, 4.1 * DAY);
  for (const p of players) { p.state.res.food = p.state.res.wood = p.state.res.stone = p.state.res.ore = 3000; }
  b.state.troops = {}; // verteidigt nur die Stadtwache
  const before = { ...a.state.res };
  assert.equal(run(match, players, clock, a, { type: 'march', target: cityOf(b).id, mode: 'attack', troops: { schwert: 300, bogen: 150, speer: 150 } }), '');
  assert.equal(a.state.protUntil <= match.world.gt, true);
  assert.equal(viewFor(match, players, b, clock).incoming.length, 1);
  adv(match, players, 2 * DAY);
  assert.equal(b.state.vassalOf, a.id, 'erster Fall: Vasall');
  assert.ok(b.state.protUntil > match.world.gt || b.state.protKind === 'fall');
  assert.ok(a.state.reports.some(r => r.kind === 'pvp' && r.win), 'Bericht Angreifer');
  assert.ok(b.state.reports.some(r => r.kind === 'pvp' && r.role === 'def'), 'Bericht Verteidiger');
  // Vasall liefert Tribut
  const bf = b.state.res.food; adv(match, players, 3600);
  assert.ok(a.state.res.food > 0);
  // Der Herr kann seinen Vasallen nicht angreifen, ein Dritter schon: zweiter Fall = ausgeschieden
  adv(match, players, 13 * 3600);
  assert.match(run(match, players, clock, a, { type: 'march', target: cityOf(b).id, mode: 'attack', troops: { schwert: 10 } }), /Vasall/);
  give(c, { schwert: 400, bogen: 200, speer: 200 }); c.state.res.food = 3000;
  assert.equal(run(match, players, clock, c, { type: 'march', target: cityOf(b).id, mode: 'attack', troops: { schwert: 300, bogen: 150, speer: 150 } }), '');
  adv(match, players, 2 * DAY);
  assert.equal(b.state.out, true, 'zweiter Fall: ausgeschieden');
  assert.equal(b.state.vassalOf, 0);
  assert.match(run(match, players, clock, b, { type: 'build', id: 'farm' }), /ausgeschieden/);
  assert.equal(run(match, players, clock, b, { type: 'readReports' }), '');
}

// ---- Stationieren bei Verbündeten, Thron, Ende ----
{
  const { match, players } = mk(2); const [a, b] = players;
  assert.equal(run(match, players, T0, a, { type: 'allyCreate', name: 'Duo', tag: 'DUO' }), '');
  const map = mapOf(match), cityB = map.objects.find(o => o.k === 'start' && o.slot === b.state.slot);
  give(a, { speer: 50 });
  assert.match(run(match, players, T0, a, { type: 'march', target: cityB.id, mode: 'station', troops: { speer: 20 } }), /Verbündeten/);
  assert.equal(run(match, players, T0, a, { type: 'allyInvite', name: 'P2' }), '');
  const inv = viewFor(match, players, b, T0).invites[0];
  assert.equal(run(match, players, T0, b, { type: 'allyAnswer', id: inv.id, accept: true }), '');
  assert.equal(run(match, players, T0, a, { type: 'march', target: cityB.id, mode: 'station', troops: { speer: 20 } }), '');
  adv(match, players, DAY);
  assert.equal(b.state.stationed[a.id].speer, 20);
  assert.equal(run(match, players, clock, b, { type: 'stationDismiss', owner: a.id }), '');
  assert.equal(b.state.stationed[a.id], undefined);
  assert.match(run(match, players, clock, a, { type: 'march', target: cityB.id, mode: 'attack', troops: { speer: 10 } }), /Verbündete/);
  // Thron besetzen (braucht Revier: ohne Außenposten geht es nicht)
  give(a, { schwert: 3000, bogen: 2000, speer: 2000, schwer: 1500 });
  assert.match(run(match, players, clock, a, { type: 'march', target: 'throne1', mode: 'occupy', troops: { schwert: 10 } }), /Revier/);
  match.world.outposts.opT = { id: 'opT', al: Object.values(match.world.alliances)[0].id, by: a.id, x: 97, y: 97, done: 0, garr: {} };
  assert.equal(run(match, players, clock, a, { type: 'march', target: 'throne1', mode: 'occupy', troops: { schwert: 3000, bogen: 2000, speer: 2000, schwer: 1500 } }), '');
  adv(match, players, 3 * DAY);
  assert.ok(match.world.holds.throne1, 'Thron gehalten');
  assert.ok(a.state.bonus.gold > 0 && b.state.bonus.gold > 0, 'Goldbonus für das ganze Bündnis');
  adv(match, players, 8 * DAY);
  assert.equal(match.world.phase, 'ended');
  assert.equal(match.world.result.kind, 'throne');
  assert.equal(match.world.result.winners.length, 2);
  assert.match(run(match, players, clock, a, { type: 'build', id: 'farm' }), /beendet/);
}

// ---- Spielende nach Zeit und durch den Admin ----
{
  const { match, players } = mk(2, { weeks: 1 });
  clock = T0; adv(match, players, 8 * DAY);
  assert.equal(match.world.phase, 'ended'); assert.equal(match.world.result.kind, 'time');
  const m2 = mk(2); assert.equal(endMatch(m2.match, m2.players, T0 + 10), ''); assert.equal(m2.match.world.result.kind, 'admin');
}
console.log('Alle Kriegstests bestanden.');
