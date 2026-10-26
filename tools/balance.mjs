// Balance-Hilfe: Marschzeiten auf der Karte und ein Beispielkampf. Aufruf: node tools/balance.mjs [seed]
import { generateMap, findPath, pathTimes, N } from '../shared/mapgen.js';
import { U } from '../shared/rules.js';
import { forestCostFor } from '../shared/combat.js';
import { battle, campTroops, guardOf, power } from '../shared/combat.js';
const seed = Number(process.argv[2]) || 4242, map = generateMap(seed);
const fmt = s => s >= 86400 ? (s / 86400).toFixed(1) + ' Tage' : s >= 3600 ? (s / 3600).toFixed(1) + ' Std.' : Math.round(s / 60) + ' Min.';
const units = { speer: { speer: 1 }, schwert: { schwert: 1 }, bogen: { bogen: 1 }, leicht: { leicht: 1 }, schwer: { schwer: 1 } };
const dur = (a, b, t) => { const p = findPath(map, a.x, a.y, b.x, b.y, forestCostFor(t)); if (!p) return null; const arr = pathTimes(map, p, Math.min(...Object.keys(t).map(u => U[u].s)), forestCostFor(t)); return arr[arr.length - 1]; };
console.log(`Karte ${N}x${N}, Seed ${seed}. Marschzeit (Tempo ×1, einfach)\n`);
const starts = map.starts, th = map.objects.find(o => o.k === 'throne');
for (const [name, t] of Object.entries(units)) {
  const near = [], far = [];
  for (let i = 0; i < starts.length; i++) {
    const n = dur(starts[i], starts[(i + 1) % starts.length], t), f = dur(starts[i], starts[(i + 5) % starts.length], t), tt = dur(starts[i], th, t);
    if (n) near.push(n); if (f) far.push(f); if (tt) (far.thr = far.thr || []).push(tt);
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  console.log(name.padEnd(8), 'Nachbar', fmt(avg(near)).padEnd(10), 'gegenüber', fmt(avg(far)).padEnd(10), 'Thron', fmt(avg(far.thr || [])));
}
console.log('\nBeispielkampf: Angreifer gegen Stadtwache + Truppen (Mauer 5, Rathaus 10)');
const S = { lv: { rathaus: 10, mauer: 5 } };
for (const n of [200, 500, 1000, 2000]) {
  const att = { speer: n * .3, schwert: n * .3, bogen: n * .25, leicht: n * .15 }; for (const u in att) att[u] = Math.round(att[u]);
  const def = { ...guardOf(S), speer: guardOf(S).speer + 400, schwert: 300, bogen: 200 };
  const r = battle(att, def, 1 + .05 * S.lv.mauer);
  console.log(`${String(n).padStart(5)} Angreifer vs ${Object.values(def).reduce((a, b) => a + b, 0)} Verteidiger:`, r.win ? 'Sieg' : 'Niederlage', 'Verluste', Object.values(att).reduce((a, b) => a + b, 0) - Object.values(r.attLeft).reduce((a, b) => a + b, 0));
}
