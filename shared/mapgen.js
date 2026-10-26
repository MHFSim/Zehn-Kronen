// Zehn Kronen – Kartenerzeugung und Wegfindung.
// Läuft auf dem Server (maßgeblich) und im Browser (Darstellung, Marschvorschau).
// Wichtig: Nur +, -, *, /, sqrt, floor und Math.imul verwenden. Math.sin/cos/pow können je nach
// Browser minimal abweichen und würden Server und Client auseinanderlaufen lassen.

export const N = 200;           // Kartengröße in Feldern
export const SUB = 2;           // Höhenraster pro Feld
export const G = N * SUB + 1;   // Gitterpunkte je Seite
export const SEA = 0.30;        // Wasserstand
export const MOUNT = 0.70;      // ab hier unpassierbares Gebirge
export const SLOTS = 10;

/* ---------- Zufall und Rauschen ---------- */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
export function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  const u = fade(fx), v = fade(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, seed, oct) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f, seed + i * 101); norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ---------- feste Orte ---------- */
// Einheitsvektoren (18° + 36° * k) und Achsen, fest eingetragen, damit alle Rechner dasselbe sehen
const RING = [
  [0.9510565162951535, 0.3090169943749474], [0.5877852522924731, 0.8090169943749475], [0, 1],
  [-0.5877852522924731, 0.8090169943749475], [-0.9510565162951535, 0.3090169943749474],
  [-0.9510565162951535, -0.3090169943749474], [-0.5877852522924731, -0.8090169943749475], [0, -1],
  [0.5877852522924731, -0.8090169943749475], [0.9510565162951535, -0.3090169943749474]
];
const AXES = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const C = N / 2;
export const START_R = 72, SANCT_R = 38;
export const startSpot = i => [Math.floor(C + RING[i][0] * START_R), Math.floor(C + RING[i][1] * START_R)];
const sanctSpot = i => [Math.floor(C + AXES[i][0] * SANCT_R), Math.floor(C + AXES[i][1] * SANCT_R)];

export const NODE_KINDS = ['farm', 'wood', 'stone', 'ore'];
export const NODE_RES = { farm: 'food', wood: 'wood', stone: 'stone', ore: 'ore' };
export const NODE_MAX = lv => 3000 * lv;
export const cellOf = (x, y) => y * N + x;
export const distC = (x, y) => Math.sqrt((x + .5 - C) * (x + .5 - C) + (y + .5 - C) * (y + .5 - C));

/* ---------- Gelände ---------- */
function heightAt(x, y, seed, zones) {
  const dx = x - C, dy = y - C, r = Math.sqrt(dx * dx + dy * dy) / C;
  const base = fbm(x * 0.045 + 10, y * 0.045 + 10, seed, 5);
  const mmask = smooth(0.50, 0.68, fbm(x * 0.028 + 70, y * 0.028 + 70, seed + 7, 3));
  const ridge = 1 - Math.abs(2 * fbm(x * 0.05 + 130, y * 0.05 + 130, seed + 13, 4) - 1);
  let h = 0.43 + (base - 0.5) * 0.60 + mmask * (0.06 + ridge * ridge * 0.42);
  h -= smooth(0.84, 1.04, r) * 0.62;               // Meer am Kartenrand
  for (const z of zones) {                         // Bauland einebnen
    const d = Math.sqrt((x - z.x) * (x - z.x) + (y - z.y) * (y - z.y));
    const w = 1 - smooth(z.r * 0.65, z.r * 1.55, d);
    if (w > 0) h += (z.h - h) * w;
  }
  return h;
}
function forestAt(x, y, seed) {
  return fbm(x * 0.075 + 200, y * 0.075 + 200, seed + 31, 4);
}

function buildPass(H, F, zonesFlat) {
  const pass = new Uint8Array(N * N);
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
    const h = H[(ty * SUB + 1) * G + tx * SUB + 1];
    let p = 1;
    if (h < SEA + 0.005 || h > MOUNT) p = 0;
    else if (F[(ty * SUB + 1) * G + tx * SUB + 1] > 0.535 && h < 0.62 && !zonesFlat(tx + .5, ty + .5)) p = 2;
    pass[ty * N + tx] = p;
  }
  return pass;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function reachable(pass, sx, sy) {
  const seen = new Uint8Array(N * N), q = new Int32Array(N * N); let qh = 0, qt = 0;
  if (!pass[cellOf(sx, sy)]) return seen;
  q[qt++] = cellOf(sx, sy); seen[q[0]] = 1;
  while (qh < qt) {
    const c = q[qh++], cx = c % N, cy = (c - cx) / N;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const n = cellOf(nx, ny);
      if (seen[n] || !pass[n]) continue;
      if (dx && dy && (!pass[cellOf(cx + dx, cy)] || !pass[cellOf(cx, cy + dy)])) continue;
      seen[n] = 1; q[qt++] = n;
    }
  }
  return seen;
}

const cache = new Map();
export function generateMap(seed) {
  if (cache.has(seed)) return cache.get(seed);
  const zones = [{ x: C, y: C, r: 8, h: 0.46 }];
  const starts = [];
  for (let i = 0; i < SLOTS; i++) { const [x, y] = startSpot(i); starts.push({ x, y }); zones.push({ x: x + .5, y: y + .5, r: 5.5, h: 0.46 }); }
  for (let i = 0; i < 4; i++) { const [x, y] = sanctSpot(i); zones.push({ x: x + .5, y: y + .5, r: 3.5, h: 0.5 }); }
  const inZone = (x, y) => zones.some(z => (x - z.x) * (x - z.x) + (y - z.y) * (y - z.y) < (z.r * 1.2) * (z.r * 1.2));

  const H = new Float32Array(G * G), F = new Float32Array(G * G);
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    const x = gx / SUB, y = gy / SUB;
    H[gy * G + gx] = heightAt(x, y, seed, zones);
    F[gy * G + gx] = forestAt(x, y, seed);
  }
  let pass = buildPass(H, F, inZone);

  // Alle Startplätze müssen vom Thron aus erreichbar sein; sonst einen Weg in das Gebirge oder Meer schlagen
  for (let round = 0; round < 12; round++) {
    const seen = reachable(pass, Math.floor(C), Math.floor(C));
    const lost = starts.filter(s => !seen[cellOf(s.x, s.y)]);
    if (!lost.length) break;
    for (const s of lost) {
      let x = s.x + .5, y = s.y + .5;
      for (let k = 0; k < 200; k++) {
        const dx = C - x, dy = C - y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1) break;
        x += dx / d * 0.5; y += dy / d * 0.5;
        const gx0 = Math.floor(x * SUB), gy0 = Math.floor(y * SUB);
        for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
          const gx = gx0 + ox, gy = gy0 + oy;
          if (gx < 0 || gy < 0 || gx >= G || gy >= G) continue;
          const f = 1 - Math.sqrt(ox * ox + oy * oy) / 4;
          if (f <= 0) continue;
          const i = gy * G + gx; H[i] += (0.45 - H[i]) * f * (H[i] < SEA + 0.03 || H[i] > 0.6 ? 1 : 0.2);
        }
      }
    }
    pass = buildPass(H, F, inZone);
  }
  const reach = reachable(pass, Math.floor(C), Math.floor(C));

  /* ---------- Objekte ---------- */
  const rand = rng(seed ^ 0x5bd1e995);
  const objects = [];
  const taken = [];       // belegte Felder für Mindestabstand
  const free = (x, y, d) => taken.every(t => (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y) >= d * d);
  const okCell = (x, y) => x > 2 && y > 2 && x < N - 3 && y < N - 3 && pass[cellOf(x, y)] === 1 && reach[cellOf(x, y)]
    && H[(y * SUB + 1) * G + x * SUB + 1] < 0.64;
  const add = (o, d) => { objects.push(o); taken.push({ x: o.x, y: o.y }); return o; };
  const nid = {}; const mk = (k, x, y, lv, extra) => { nid[k] = (nid[k] || 0) + 1; return { id: k + nid[k], k, x, y, lv, ...extra }; };

  starts.forEach((s, i) => add(mk('start', s.x, s.y, 0, { slot: i })));
  add(mk('throne', Math.floor(C), Math.floor(C), 0));
  for (let i = 0; i < 4; i++) { const [x, y] = sanctSpot(i); add(mk('sanct', x, y, 0, { n: i })); }

  const tryPlace = (kind, cx, cy, rmin, rmax, minD, lvf, tries) => {
    for (let t = 0; t < tries; t++) {
      // Richtung ohne sin/cos: zufälliger Punkt im Quadrat, auf Abstandsring zurückgezogen
      let vx = rand() * 2 - 1, vy = rand() * 2 - 1; const vl = Math.sqrt(vx * vx + vy * vy) || 1;
      const rr = rmin + rand() * (rmax - rmin);
      const x = Math.floor(cx + vx / vl * rr), y = Math.floor(cy + vy / vl * rr);
      if (!okCell(x, y) || !free(x, y, minD)) continue;
      return add(mk(kind, x, y, lvf(x, y)));
    }
    return null;
  };
  const nodeLv = (x, y) => Math.max(1, Math.min(6, 1 + Math.floor((0.80 - distC(x, y) / C) / 0.80 * 6.4 + rand() * 1.4 - 0.5)));
  const campLv = (x, y) => Math.max(1, Math.min(10, 1 + Math.floor((0.80 - distC(x, y) / C) / 0.80 * 10.5 + rand() * 1.6 - 0.6)));

  // Rund um jeden Startplatz: gleich viel Frühspiel
  starts.forEach(s => {
    NODE_KINDS.forEach(k => tryPlace(k, s.x, s.y, 6, 11, 3, () => 1 + Math.floor(rand() * 2), 60));
    tryPlace('camp', s.x, s.y, 9, 14, 3, () => 1, 60);
    tryPlace('camp', s.x, s.y, 13, 19, 3, () => 2, 60);
  });
  // Rest der Karte
  const scatter = (kind, count, minD, lvf) => { for (let i = 0; i < count; i++) tryPlace(kind, C, C, 6, C * 0.9, minD, lvf, 80); };
  scatter('farm', 62, 3.2, nodeLv); scatter('wood', 62, 3.2, nodeLv); scatter('stone', 48, 3.2, nodeLv); scatter('ore', 48, 3.2, nodeLv);
  scatter('camp', 62, 4.5, campLv);
  scatter('ruin', 35, 3.4, (x, y) => 1 + Math.floor(rand() * 3));

  const map = { seed, N, H, F, pass, reach, objects, starts, byId: Object.fromEntries(objects.map(o => [o.id, o])) };
  if (cache.size > 3) cache.clear();
  cache.set(seed, map);
  return map;
}

/* ---------- Wegfindung (A*) ---------- */
const SQ2 = 1.4142135623730951;
export function findPath(map, sx, sy, gx, gy, forestCost = 1.2) {
  const pass = map.pass;
  if (!pass[cellOf(sx, sy)] || !pass[cellOf(gx, gy)]) return null;
  const g = new Float64Array(N * N).fill(Infinity), came = new Int32Array(N * N).fill(-1), closed = new Uint8Array(N * N);
  const heap = []; // Einträge [f, g, cell]
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] < b[2])));
  const push = e => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  const hf = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return (dx + dy) + (SQ2 - 2) * Math.min(dx, dy); };
  const s = cellOf(sx, sy), goal = cellOf(gx, gy);
  g[s] = 0; push([hf(sx, sy), 0, s]);
  while (heap.length) {
    const [, gc, c] = pop();
    if (closed[c]) continue; closed[c] = 1;
    if (c === goal) break;
    const cx = c % N, cy = (c - cx) / N;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const n = cellOf(nx, ny), pn = pass[n];
      if (!pn || closed[n]) continue;
      if (dx && dy && (!pass[cellOf(cx + dx, cy)] || !pass[cellOf(cx, cy + dy)])) continue;
      const ng = gc + (dx && dy ? SQ2 : 1) * (pn === 2 ? forestCost : 1);
      if (ng < g[n]) { g[n] = ng; came[n] = c; push([ng + hf(nx, ny), ng, n]); }
    }
  }
  if (!closed[goal]) return null;
  const path = []; for (let c = goal; c !== -1; c = came[c]) path.push(c);
  return path.reverse();
}

// Zeit in Spielsekunden bis zu jedem Wegpunkt. speed = Felder pro Stunde.
export function pathTimes(map, path, speed, forestCost) {
  const arr = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], ax = a % N, ay = (a - ax) / N, bx = b % N, by = (b - bx) / N;
    const step = (ax !== bx && ay !== by ? SQ2 : 1) * (map.pass[b] === 2 ? forestCost : 1);
    arr.push(arr[i - 1] + step / speed * 3600);
  }
  return arr;
}
