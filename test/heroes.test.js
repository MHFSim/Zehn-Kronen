// Helden, Räuber, Burgwächter: `npm test`
import assert from 'node:assert/strict';
import { newWorld, mapOf } from '../shared/core.js';
import { syncMatch, addPlayer, command as rawCommand, viewFor } from '../shared/world.js';
import { HEROES, HERO_IDS, HERO_MAX, xpNeed, skillOf, heroForce, heroXp, heroPrefers, keeperOf, heroBusy, fightXp } from '../shared/heroes.js';
import { NODE_KINDS } from '../shared/mapgen.js';

assert.equal(HERO_IDS.length, 12);
assert.equal(HERO_IDS.filter(i => HEROES[i].role === 'gather').length, 4);
const T0 = 1_000_000_000_000;
const match = { id: 1, name: 'Test', speed: 100, seed: 4242, world: newWorld(T0) }, players = [];
const add = (id, name) => { const S = addPlayer(match, players, id, name, T0); const p = { id, name, state: S }; players.push(p); return p; };
const p1 = add(1, 'Anna'), p2 = add(2, 'Ben');
const w = match.world, S = p1.state;
// alle Helden zu Beginn auf Stufe 1
assert.ok(HERO_IDS.every(i => S.heroes[i].lv === 1 && S.heroes[i].xp === 0));
// Fähigkeiten wachsen mit der Stufe, auf Stufe 60 sind sie am größten
assert.ok(skillOf(S, 'brienne', 'atkCav') > 0.04 && skillOf(S, 'brienne', 'atkCav') < 0.05);
S.heroes.brienne.lv = HERO_MAX; assert.ok(Math.abs(skillOf(S, 'brienne', 'atkCav') - .18) < 1e-9); S.heroes.brienne.lv = 1;
// Gattungsbonus wirkt nur im Verhältnis der passenden Truppen
const fcav = heroForce(S, 'brienne', { leicht: 50, speer: 50 }, 'att', 'player'), fall = heroForce(S, 'brienne', { leicht: 100 }, 'att', 'player'), fnone = heroForce(S, 'brienne', { speer: 100 }, 'att', 'player');
assert.ok(fnone === 1 && fcav > 1 && fall > fcav);
assert.ok(heroForce(S, 'cedric', { speer: 10 }, 'def', 'home') > heroForce(S, 'cedric', { speer: 10 }, 'att', 'player'), 'Burgwache nur beim Verteidigen');
assert.ok(heroForce(S, 'draven', { speer: 10 }, 'att', 'camp') > heroForce(S, 'draven', { speer: 10 }, 'att', 'player'), 'Räuberjäger nur gegen Lager und Räuber');
assert.deepEqual(heroPrefers('brienne'), ['kav']); assert.deepEqual(heroPrefers('gorm'), ['trans']); assert.deepEqual(heroPrefers('seraphine'), []);
// Erfahrung und Stufen
{ const T = { heroes: { x: { lv: 1, xp: 0 } } }; const up = heroXp(T, 'x', xpNeed(1) + xpNeed(2) + 5); assert.equal(up, 2); assert.equal(T.heroes.x.lv, 3); assert.equal(T.heroes.x.xp, 5);
  T.heroes.x.lv = HERO_MAX - 1; heroXp(T, 'x', 1e9); assert.equal(T.heroes.x.lv, HERO_MAX); assert.equal(heroXp(T, 'x', 100), 0); }
// Sammler-Helden bekommen im Kampf nichts, zu schwache Ziele und Wiederholungen geben weniger
assert.equal(fightXp(S, 'gorm', 100, 'a', 1, 0), 0);
assert.equal(fightXp(S, 'aldric', 100, 'k1', 1, 0), 100); assert.equal(fightXp(S, 'aldric', 100, 'k1', 1, 100), 25);
S.heroes.aldric.lv = 30; assert.equal(fightXp(S, 'aldric', 100, 'k2', 3, 0), 20); S.heroes.aldric.lv = 1;

// Marsch braucht einen freien Helden
S.troops = { speer: 40, schwert: 20, handkarren: 5 }; S.res = { food: 99999, wood: 99999, stone: 99999, gold: 99999 };
const map = mapOf(match), node = map.objects.filter(o => ['farm', 'wood', 'stone'].includes(o.k)).sort((a, b) => Math.hypot(a.x - S.pos[0], a.y - S.pos[1]) - Math.hypot(b.x - S.pos[0], b.y - S.pos[1]))[0];
let t = T0 + 1000;
assert.match(rawCommand(match, players, p1, { type: 'march', target: node.id, troops: { speer: 10 } }, t), /Helden/);
assert.match(rawCommand(match, players, p1, { type: 'march', target: node.id, troops: { speer: 10 }, hero: 'gibtsnicht' }, t), /Helden/);
const hero = { farm: 'gorm', wood: 'thorin', stone: 'ilsa' }[node.k];
assert.equal(rawCommand(match, players, p1, { type: 'march', target: node.id, troops: { speer: 10, handkarren: 5 }, hero }, t), '');
assert.ok(heroBusy(w, 1, hero)); assert.equal(w.marches[0].hero, hero);
const node2 = map.objects.filter(o => ['farm', 'wood', 'stone'].includes(o.k) && o.id !== node.id).sort((a, b) => Math.hypot(a.x - S.pos[0], a.y - S.pos[1]) - Math.hypot(b.x - S.pos[0], b.y - S.pos[1]))[0];
assert.match(rawCommand(match, players, p1, { type: 'march', target: node2.id, troops: { speer: 10 }, hero }, t), /führt schon ein anderes Heer/);
assert.equal(viewFor(match, players, p1, t).world.marches[0].hero, hero);
// Burgwächter: Wächter, sonst Stellvertreter, sonst niemand
assert.equal(keeperOf(S, w, 1), 'cedric');
assert.equal(rawCommand(match, players, p1, { type: 'setKeeper', hero, deputy: 'aldric' }, t), '');
assert.equal(keeperOf(S, w, 1), 'aldric', 'Wächter ist unterwegs');
assert.match(rawCommand(match, players, p1, { type: 'setKeeper', hero: 'aldric', deputy: 'aldric' }, t), /verschieden/);
// Sammler-Held lernt beim Sammeln
syncMatch(match, players, t + 2 * 3600_000);
assert.ok(S.heroes[hero].lv > 1 || S.heroes[hero].xp > 0, 'Sammel-Erfahrung');
assert.equal(S.heroes.aldric.xp, 0);

// Räuber erscheinen, bleiben begrenzt und verschwinden wieder
syncMatch(match, players, t + 30 * 3600_000);
assert.ok(w.raiders.length >= 20 && w.raiders.length <= 40, 'Räuber: ' + w.raiders.length);
assert.ok(w.raiders.every(r => r.lv >= 1 && r.lv <= 30));
assert.ok(viewFor(match, players, p1, t + 30 * 3600_000).world.raiders.length === w.raiders.length);

// Räuber besiegen: Belohnung, Held-Erfahrung
const t2 = t + 31 * 3600_000; syncMatch(match, players, t2);
const r = { id: 'raiderTest', lv: 2, x: Math.min(270, S.pos[0] + 6), y: S.pos[1], until: w.gt + 99999 };
const spot = [[6, 0], [-6, 0], [0, 6], [0, -6], [8, 3], [-8, 3]].map(([dx, dy]) => [S.pos[0] + dx, S.pos[1] + dy]).find(([x, y]) => map.pass[y * 280 + x]);
r.x = spot[0]; r.y = spot[1]; w.raiders.push(r);
S.troops = { speer: 80, schwert: 60, leicht: 40 }; S.items = {}; S.packs = [];
assert.equal(rawCommand(match, players, p1, { type: 'march', target: 'raiderTest', troops: { speer: 80, schwert: 60, leicht: 40 }, hero: 'draven' }, t2), '');
{ // Kampf gegen Räuber dauert immer 20 Sekunden echte Zeit (Spieltempo match.speed)
  let seen = 0, t0 = 0, t1 = 0;
  for (let i = 1; i <= 40 && w.raiders.some(x => x.id === 'raiderTest'); i++) {
    syncMatch(match, players, t2 + i * 1000);
    const fm = w.marches.find(x => !x.dead && x.fight && x.fight.kind === 'raider');
    if (fm && !t0) t0 = i; if (!fm && t0 && !t1) t1 = i;
  }
  assert.ok(t0 && t1 && t1 - t0 <= 22, 'Räuberkampf kurz: ' + (t1 - t0) + ' s'); }
for (let i = 1; i <= 40 && w.raiders.some(x => x.id === 'raiderTest'); i++) syncMatch(match, players, t2 + 100_000 + i * 60_000);
assert.ok(!w.raiders.some(x => x.id === 'raiderTest'), 'Räuber besiegt');
assert.ok(Object.keys(S.items).some(k => k.startsWith('sp')), 'Beschleuniger als Belohnung');
assert.ok(S.heroes.draven.xp > 0 || S.heroes.draven.lv > 1, 'Held lernt');
assert.match(rawCommand(match, players, p1, { type: 'march', target: 'raiderTest', troops: { speer: 5 }, hero: 'kael' }, t2 + 3600_000), /gibt es nicht/);
console.log('Alle Heldentests bestanden.');
// Mut: Angriffe auf Räuber kosten Mut, stündlich kehrt etwas zurück
{ const { mutCost, mutStep, MUT_MAX, MUT_REGEN } = await import('../shared/war.js');
  assert.ok(mutCost(30) > mutCost(1));
  const M = {}; mutStep(M, 0); assert.equal(M.mut, MUT_MAX);
  M.mut = 50; M.mutAt = 0; mutStep(M, 3599); assert.equal(M.mut, 50); mutStep(M, 3600 * 2 + 5); assert.equal(M.mut, 50 + 2 * MUT_REGEN);
  mutStep(M, 3600 * 100); assert.equal(M.mut, MUT_MAX); }
console.log('Mut-Tests bestanden.');
