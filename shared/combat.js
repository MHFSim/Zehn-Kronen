// Zehn Kronen – Kampfrechnung ohne Zustand: Einheiten, Konter, Rundenkampf, Lager und Wächter.
import { U } from './rules.js';

export const sum = t => Object.values(t).reduce((a, b) => a + b, 0);
export const capacityOf = troops => Object.keys(troops).reduce((s, u) => s + troops[u] * U[u].c, 0);
export const armySpeed = troops => Math.min(...Object.keys(troops).filter(u => troops[u] > 0).map(u => U[u].s));
export const forestCostFor = troops => (troops.leicht > 0 || troops.schwer > 0) ? 1.7 : 1.2;

/* ---------- Banditenlager ---------- */
export function campTroops(lv) {
  const total = Math.round(8 + 3 * lv * lv);
  const mix = lv >= 7 ? { speer: .25, schwert: .25, bogen: .2, leicht: .15, schwer: .15 }
    : lv >= 4 ? { speer: .3, schwert: .3, bogen: .25, leicht: .15 } : { speer: .4, schwert: .35, bogen: .25 };
  const t = {}; for (const u in mix) t[u] = Math.max(1, Math.round(total * mix[u]));
  return t;
}
export const campMult = lv => 1 + 0.10 * (lv - 1);
export const campLoot = lv => ({ food: 300 * lv, wood: 300 * lv, stone: 200 * lv, ore: 150 * lv, gold: 20 * lv });

/* ---------- Kampf ---------- */
const COUNTERS = { speer: ['leicht', 'schwer'], schwert: ['speer'], bogen: ['speer', 'schwert'], leicht: ['bogen'], schwer: ['schwert', 'bogen'] };
export const countersOf = (a, d) => COUNTERS[a].includes(d);
const KAMPF = 0.5, RUNDEN = 10;
const grp = (t, m) => Object.keys(t).filter(u => t[u] > 0).map(u => ({ u, n: t[u], a: U[u].a * m, v: U[u].v * m, l: U[u].l * m }));
const hp = G => G.reduce((s, g) => s + g.n * g.l, 0);
export function battle(attT, defT, defMult = 1) {
  const A = grp(attT, 1), D = grp(defT, defMult), rounds = [];
  const snap = G => { const o = {}; G.forEach(g => o[g.u] = Math.round(g.n)); return o; };
  for (let r = 0; r < RUNDEN; r++) {
    const hA = hp(A), hD = hp(D);
    if (hA < 0.5 || hD < 0.5) break;
    const toA = A.map(() => 0), toD = D.map(() => 0);
    for (const g of A) D.forEach((h, j) => { toD[j] += g.n * g.a * KAMPF * (countersOf(g.u, h.u) ? 1.5 : 1) * (h.n * h.l / hD) * (20 / (20 + h.v)); });
    for (const g of D) A.forEach((h, j) => { toA[j] += g.n * g.a * KAMPF * (countersOf(g.u, h.u) ? 1.5 : 1) * (h.n * h.l / hA) * (20 / (20 + h.v)); });
    A.forEach((h, j) => { h.n = Math.max(0, h.n - toA[j] / h.l); });
    D.forEach((h, j) => { h.n = Math.max(0, h.n - toD[j] / h.l); });
    rounds.push({ a: snap(A), d: snap(D) });
  }
  const left = G => { const o = {}; G.forEach(g => { const n = Math.round(g.n); if (n > 0) o[g.u] = n; }); return o; };
  const attLeft = left(A), defLeft = left(D);
  return { win: Object.keys(defLeft).length === 0 && Object.keys(attLeft).length > 0, attLeft, defLeft, rounds };
}
export const power = (t, m = 1) => grp(t, m).reduce((s, g) => s + g.n * (g.a + g.v * 0.5 + g.l * 0.3), 0);

/* ---------- Stadtwache und Wächter ---------- */
// Jede Burg hat eine kleine Stadtwache, damit sie nie ganz leer ist (wächst mit Rathaus und Mauer).
export const guardOf = S => ({ speer: Math.round(10 + 8 * S.lv.rathaus + 15 * S.lv.mauer) });
export const wallMult = S => 1 + 0.05 * S.lv.mauer;
// Neutrale Wächter von Thron und Heiligtümern, solange sie niemand hält
export const holdGuard = kind => kind === 'throne' ? { troops: campTroops(10), mult: 2.0 } : { troops: campTroops(6), mult: 1.5 };
