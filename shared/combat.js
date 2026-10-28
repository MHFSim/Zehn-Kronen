// Zehn Kronen – Kampfrechnung ohne Zustand: Einheiten, Konter, Rundenkampf, Lager und Wächter.
import { U, techMult } from './rules.js';

export const sum = t => Object.values(t).reduce((a, b) => a + b, 0);
export const capacityOf = (troops, S) => Math.floor(Object.keys(troops).reduce((s, u) => s + troops[u] * U[u].c, 0) * (S ? techMult(S, 'carry') : 1));
// Kraft der Truppen eines Spielers (Kriegskunst) als Faktor für Angriff, Verteidigung und Leben
export const forceOf = S => S ? techMult(S, 'force') : 1;
export const armySpeed = troops => Math.min(...Object.keys(troops).filter(u => troops[u] > 0).map(u => U[u].s));
export const forestCostFor = troops => (troops.leicht > 0 || troops.schwer > 0 || troops.handkarren > 0) ? 1.7 : 1.2;

/* ---------- Banditenlager ---------- */
export function campTroops(lv) {
  const total = Math.round(4 + 2 * Math.pow(lv, 1.5));   // wächst langsamer als die Beute, damit sich der Angriff lohnt
  const mix = lv >= 7 ? { speer: .25, schwert: .25, bogen: .2, leicht: .15, schwer: .15 }
    : lv >= 4 ? { speer: .3, schwert: .3, bogen: .25, leicht: .15 } : { speer: .4, schwert: .35, bogen: .25 };
  const t = {}; for (const u in mix) t[u] = Math.max(1, Math.round(total * mix[u]));
  return t;
}
export const campMult = lv => 1 + 0.05 * (lv - 1);
export const campLoot = lv => ({ food: 300 * lv, wood: 300 * lv, stone: 350 * lv, gold: 20 * lv });

/* ---------- Kampf ---------- */
// Jede Einheit hat Angriff und Abwehr gegen Artillerie, Infanterie und Kavallerie. Je Runde fällt von einer Zielgruppe h
// (Anteil am Heer) so viel: Anzahl × Angriff gegen deren Gattung × KAMPF / Abwehr der Zielgruppe gegen die Gattung des Angreifers.
const TI = { art: 0, inf: 1, kav: 2 };
const KAMPF = 0.25, RUNDEN = 30, TRANS_DEF = 10;
const meanAt = u => (u.at[0] + u.at[1] + u.at[2]) / 3;
const atkVs = (g, th) => g.at ? (th === 'trans' ? meanAt(g) : g.at[TI[th]]) * g.m : 0;
const defVs = (h, tg) => h.df ? (tg === 'trans' ? (h.df[0] + h.df[1] + h.df[2]) / 3 : h.df[TI[tg]]) * h.m : TRANS_DEF * h.m;   // Karren greifen nicht an (Angriff 0), brauchen aber eine gültige Abwehr als Nenner
// Zählt der Angreifer a gegen die Einheit d? (für Anzeige)
export const countersOf = (a, d) => !!(U[a].strong || []).includes(d) || !!(U[a].good || []).includes(d);
const grp = (t, m) => Object.keys(t).filter(u => t[u] > 0).map(u => ({ u, n: t[u], g: U[u].g, at: U[u].at, df: U[u].df, m }));
const alive = G => G.reduce((s, g) => s + g.n, 0);
export function battle(attT, defT, defMult = 1, attMult = 1) {
  const A = grp(attT, attMult), D = grp(defT, defMult), rounds = [];
  const snap = G => { const o = {}; G.forEach(g => o[g.u] = Math.round(g.n)); return o; };
  for (let r = 0; r < RUNDEN; r++) {
    const nA = alive(A), nD = alive(D);
    if (nA < 0.5 || nD < 0.5) break;
    const toA = A.map(() => 0), toD = D.map(() => 0);
    for (const g of A) D.forEach((h, j) => { toD[j] += g.n * atkVs(g, h.g) * KAMPF * (h.n / nD) / defVs(h, g.g); });
    for (const g of D) A.forEach((h, j) => { toA[j] += g.n * atkVs(g, h.g) * KAMPF * (h.n / nA) / defVs(h, g.g); });
    A.forEach((h, j) => { h.n = Math.max(0, h.n - toA[j]); });
    D.forEach((h, j) => { h.n = Math.max(0, h.n - toD[j]); });
    rounds.push({ a: snap(A), d: snap(D) });
  }
  const left = G => { const o = {}; G.forEach(g => { const n = Math.round(g.n); if (n > 0) o[g.u] = n; }); return o; };
  const attLeft = left(A), defLeft = left(D);
  return { win: Object.keys(defLeft).length === 0 && Object.keys(attLeft).length > 0, attLeft, defLeft, rounds };
}
// Eine einzige Kampfrunde auf Zählständen (Kommazahlen erlaubt): für den Kampf in Echtzeit
export function roundStep(attT, defT, attMult = 1, defMult = 1, k = 1) {
  const A = grp(attT, attMult), D = grp(defT, defMult), nA = alive(A), nD = alive(D);
  if (nA < 0.5 || nD < 0.5) return { A: { ...attT }, D: { ...defT } };
  const toA = A.map(() => 0), toD = D.map(() => 0);
  for (const g of A) D.forEach((h, j) => { toD[j] += k * g.n * atkVs(g, h.g) * KAMPF * (h.n / nD) / defVs(h, g.g); });
  for (const g of D) A.forEach((h, j) => { toA[j] += k * g.n * atkVs(g, h.g) * KAMPF * (h.n / nA) / defVs(h, g.g); });
  const oA = {}, oD = {};
  A.forEach((h, j) => { oA[h.u] = Math.max(0, h.n - toA[j]); }); D.forEach((h, j) => { oD[h.u] = Math.max(0, h.n - toD[j]); });
  return { A: oA, D: oD };
}
// Grobe Gesamtstärke (Angriff + Abwehr) eines Heeres
export const power = (t, m = 1) => grp(t, m).reduce((s, g) => s + g.n * (U[g.u].a + U[g.u].v * 0.5) * m, 0);

/* ---------- Stadtwache und Wächter ---------- */
// Jede Burg hat eine kleine Stadtwache, damit sie nie ganz leer ist (wächst mit Rathaus und Mauer).
export const guardOf = S => ({ speer: Math.round(10 + 8 * S.lv.rathaus + 15 * S.lv.mauer) });
export const wallMult = S => 1 + 0.05 * S.lv.mauer;
// Neutrale Wächter von Thron und Heiligtümern, solange sie niemand hält
export const holdGuard = kind => kind === 'throne' ? { troops: campTroops(10), mult: 2.0 } : { troops: campTroops(6), mult: 1.5 };
