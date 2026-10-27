// Zehn Kronen – Weltkarte in 3D (Three.js).
// Gelände: ein Höhengitter, in Blöcke geteilt (Sichtprüfung). Wasser: eigenes Netz mit Shader. Bäume, Felsen: Instanzen je Block.
// Burgen, Lager, Felder, Türme und Heere sind im Code modellierte Low-Poly-Körper (Vertexfarben, keine Bilddateien).
// Die Kamera schwebt schräg über dem Boden: ziehen = verschieben, zwei Finger = zoomen und drehen.
import { N, G, SUB, SEA, vnoise, fbm, smooth, generateMap, roadPaths, setMapRoads } from '/shared/mapgen.js';
import { PLAYER_COLORS, marchPos, cellXY } from '/shared/core.js';
import { ROCKS } from '/public/rockdata.js';
import { VIKING } from '/public/vikingdata.js';
import { RIDER } from '/public/riderdata.js';
import { rectsOf, roadEdgesOf, dockPad, touches, towersOf } from '/shared/outpost.js';

const HS = 6;                 // Höhe in Feldern pro Höheneinheit über dem Meer
const CH = 20;                // Blockgröße (Felder)
const SHOW_NAMES = false;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hash = (x, y, s = 0) => { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const terrY = h => h > SEA ? (h - SEA) * HS : (h - SEA) * 2.4;
const LIN = c => Math.pow(c / 255, 2.2);
const hexRGB = h => [h >> 16 & 255, h >> 8 & 255, h & 255];

/* ---------- Mesh-Bauer: viele Körper zu einem Netz mit Vertexfarben ---------- */
let T;   // THREE
class MB {
  constructor() { this.p = []; this.n = []; this.c = []; this.tri = 0; }
  // Körper einfügen; jit = Helligkeitsschwankung je Dreieck (wirkt wie gemauerte Steine / Holzmaserung)
  push(g, col, x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0, jit = .1) {
    g = g.index ? g.toNonIndexed() : g;
    const m = new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz, 'YXZ')), new T.Vector3(sx, sy, sz));
    g.applyMatrix4(m); g.computeVertexNormals();
    const p = g.attributes.position.array, nn = g.attributes.normal.array, k0 = 1 + (hash(Math.round(x * 31), Math.round(z * 17), Math.round(y * 13)) - .5) * .08;
    for (let i = 0; i < p.length; i++) { this.p.push(p[i]); this.n.push(nn[i]); }
    for (let t = 0; t < p.length / 9; t++) {
      const k = k0 * (1 + (hash(this.tri++, 7, 3) - .5) * jit), r = LIN(Math.min(255, col[0] * k)), gg = LIN(Math.min(255, col[1] * k)), b = LIN(Math.min(255, col[2] * k));
      for (let v = 0; v < 3; v++) this.c.push(r, gg, b);
    }
    g.dispose(); return this;
  }
  box(w, h, d, x, y, z, col, ry = 0, rx = 0, rz = 0) { return this.push(new T.BoxGeometry(w, h, d), col, x, y + h / 2, z, ry, 1, 1, 1, rx, rz); }
  cyl(rt, rb, h, seg, x, y, z, col, jit) { return this.push(new T.CylinderGeometry(rt, rb, h, seg), col, x, y + h / 2, z, 0, 1, 1, 1, 0, 0, jit); }
  cone(r, h, seg, x, y, z, col, jit) { return this.push(new T.ConeGeometry(r, h, seg), col, x, y + h / 2, z, 0, 1, 1, 1, 0, 0, jit); }
  // Pyramidendach über einem Rechteck w × d
  pyr(w, d, h, x, y, z, col) { const g = new T.ConeGeometry(1, h, 4); g.rotateY(Math.PI / 4); return this.push(g, col, x, y + h / 2, z, 0, w / 1.4142, 1, d / 1.4142); }
  // Satteldach: Firstrichtung entlang x (ry dreht)
  gable(w, d, h, x, y, z, col, ry = 0) {
    const hw = w / 2, hd = d / 2, P = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [-hw, h, 0], [hw, h, 0]];
    const tri = [[0, 4, 1], [1, 4, 5], [3, 2, 5], [3, 5, 4], [0, 3, 4], [1, 5, 2]], pos = [];
    for (const t of tri) for (const i of t) pos.push(...P[i]);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); return this.push(g, col, x, y, z, ry);
  }
  sph(r, x, y, z, col, seg = 8, sy = 1) { return this.push(new T.SphereGeometry(r, seg, Math.max(3, seg * .75 | 0)), col, x, y, z, 0, 1, sy, 1); }
  ico(r, x, y, z, col, sy = 1, sx = 1, ry = 0, det = 0) { return this.push(new T.IcosahedronGeometry(r, det), col, x, y, z, ry, sx, sy, sx); }
  // Felsen aus public/rockdata.js (Dreiecke mit fester Farbe): sc = Maßstab, ry = Drehung um die Hochachse
  rock(r, sc, x, y, z, ry = 0, tint = 1) {
    const cs = Math.cos(ry), sn = Math.sin(ry), mid = [x, y + r.h * sc * .5, z];
    for (let t = 0; t < r.n; t++) {
      const v = [];
      for (let q = 0; q < 3; q++) { const i = (t * 3 + q) * 3, px = r.P[i] / 1000 * sc, py = r.P[i + 1] / 1000 * sc, pz = r.P[i + 2] / 1000 * sc; v.push([x + px * cs + pz * sn, y + py, z - px * sn + pz * cs]); }
      let a = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], b = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
      const cx = (v[0][0] + v[1][0] + v[2][0]) / 3 - mid[0], cy = (v[0][1] + v[1][1] + v[2][1]) / 3 - mid[1], cz = (v[0][2] + v[1][2] + v[2][2]) / 3 - mid[2];
      if (n[0] * cx + n[1] * cy + n[2] * cz < 0) { n = [-n[0], -n[1], -n[2]]; const w = v[1]; v[1] = v[2]; v[2] = w; }
      const k = (1 + (hash(this.tri++, 5, 3) - .5) * .06) * tint, cr = LIN(Math.min(255, r.C[t * 3] * k)), cg = LIN(Math.min(255, r.C[t * 3 + 1] * k)), cb = LIN(Math.min(255, r.C[t * 3 + 2] * k));
      for (const q of v) { this.p.push(q[0], q[1], q[2]); this.n.push(n[0], n[1], n[2]); this.c.push(cr, cg, cb); }
    }
    return this;
  }
  build() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); return g;
  }
}

/* ---------- Modelle ---------- */
const STONE = [172, 164, 148], STONE_D = [128, 122, 110], WOOD = [118, 84, 52], WOOD_D = [84, 58, 36], PLASTER = [206, 196, 172], DIRT = [140, 112, 78], GRASS = [92, 130, 62], DARK = [30, 24, 20], LIGHT = [255, 214, 130], GOLD = [226, 188, 84], IRON = [128, 132, 140];
const CASTLE_ROOFS = [[170, 62, 48], [60, 100, 170], [60, 140, 80], [140, 80, 160], [214, 128, 48], [48, 150, 148], [88, 88, 100], [208, 170, 60], [190, 86, 134], [120, 84, 54]];
const CASTLE_STONES = [[172, 164, 148], [178, 170, 150], [160, 160, 156], [184, 168, 142], [166, 166, 168], [176, 160, 140], [150, 150, 146], [182, 174, 158], [170, 158, 150], [164, 158, 136]];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// Zinnenreihe entlang einer Kante (x0,z0) → (x1,z1)
function crenels(b, x0, z0, x1, z1, y, col, step = .42) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.floor(len / step)), ry = Math.atan2(-(z1 - z0), x1 - x0);
  for (let i = 0; i <= n; i += 2) { const u = i / n; b.box(.2, .17, .13, x0 + (x1 - x0) * u, y, z0 + (z1 - z0) * u, col, ry); }
}
// Mauerstück mit Sockelstein, Gesims und Schießscharten (Kante von (x0,z0) nach (x1,z1), Dicke wd)
function wallSeg(b, x0, z0, x1, z1, y0, h, wd, col, slits = true) {
  const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ry = Math.atan2(-(z1 - z0), x1 - x0);
  b.box(len, h, wd, cx, y0, cz, col, ry);
  b.box(len + .02, .1, wd + .06, cx, y0, cz, mul(col, .78), ry);                 // Sockelstein
  b.box(len + .02, .07, wd + .08, cx, y0 + h * .55, cz, mul(col, 1.08), ry);     // Gesims
  b.box(len + .02, .06, wd + .1, cx, y0 + h - .05, cz, mul(col, 1.1), ry);       // Mauerkrone
  if (slits) { const n = Math.floor(len / 1.1); for (let i = 0; i < n; i++) { const u = (i + .5) / n - .5, px = cx + Math.cos(ry) * len * u, pz = cz - Math.sin(ry) * len * u, nx = Math.sin(ry) * (wd / 2 + .005), nz = Math.cos(ry) * (wd / 2 + .005); for (const sg of [1, -1]) b.box(.05, .22, .03, px + nx * sg, y0 + h * .32, pz + nz * sg, DARK, ry); } }
}
function tower(b, x, z, y0, r, h, roofH, roofCol, st, flag, windows = true) {
  b.cyl(r * 1.16, r * 1.26, .38, 10, x, y0 - .38, z, mul(st, .72));
  b.cyl(r * 1.08, r * 1.1, .22, 10, x, y0, z, mul(st, .84));
  b.cyl(r, r * 1.06, h, 10, x, y0 + .2, z, st);
  b.cyl(r * 1.07, r * 1.07, .06, 10, x, y0 + h * .5, z, mul(st, 1.1));
  if (windows) for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { b.box(.13, .3, .06, x + dx * r * .98, y0 + h * .68, z + dz * r * .98, DARK, dx ? Math.PI / 2 : 0); b.box(.09, .22, .05, x + dx * r * 1.0, y0 + h * .68, z + dz * r * 1.0, LIGHT, dx ? Math.PI / 2 : 0); }
  b.cyl(r * 1.28, r * 1.18, .28, 10, x, y0 + h, z, mul(st, 1.06));                       // Wehrgang-Auskragung
  b.cyl(r * 1.3, r * 1.3, .1, 10, x, y0 + h + .26, z, WOOD_D);
  const rf = roofH; b.cone(r * 1.55, rf * .42, 10, x, y0 + h + .3, z, mul(roofCol, .92)); b.cone(r * 1.32, rf * .85, 10, x, y0 + h + .32 + rf * .25, z, roofCol);
  b.sph(.06, x, y0 + h + .3 + rf * 1.1, z, GOLD, 6);
  if (flag) { b.cyl(.022, .022, .8, 5, x, y0 + h + .3 + rf * 1.05, z, WOOD_D); flag.push([x, y0 + h + .3 + rf * 1.05 + .62, z]); }
}
function house(b, x, z, y0, w, d, h, roofCol, ry = 0) {
  b.box(w, h, d, x, y0, z, [196, 168, 128], ry); b.box(w + .02, .05, d + .02, x, y0 + h * .55, z, WOOD_D, ry);
  for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(.05, h, .05, x + px * w / 2, y0, z + pz * d / 2, WOOD_D, ry);
  b.gable(w * 1.25, d * 1.2, h * .75, x, y0 + h, z, roofCol, ry); b.box(.1, .26, .1, x + w * .25, y0 + h, z - d * .1, STONE_D);
}
function well(b, x, z, y0) { b.cyl(.2, .22, .26, 8, x, y0, z, STONE); b.cyl(.14, .14, .02, 8, x, y0 + .25, z, [40, 70, 90]); b.box(.04, .45, .04, x - .17, y0, z, WOOD_D); b.box(.04, .45, .04, x + .17, y0, z, WOOD_D); b.gable(.5, .4, .16, x, y0 + .45, z, WOOD, Math.PI / 2); }
function crate(b, x, z, y0, s = .2, ry = 0) { b.box(s, s, s, x, y0, z, [150, 112, 70], ry); b.box(s * 1.02, .03, s * 1.02, x, y0 + s * .5, z, WOOD_D, ry); }
function barrel(b, x, z, y0) { b.cyl(.11, .11, .26, 8, x, y0, z, [124, 88, 54]); b.cyl(.115, .115, .03, 8, x, y0 + .06, z, IRON); b.cyl(.115, .115, .03, 8, x, y0 + .18, z, IRON); }

function buildCastle(tier, v) {
  const b = new MB(), flags = [], roofC = CASTLE_ROOFS[v % 10], ST = CASTLE_STONES[v % 10], STD = mul(ST, .84), L = v % 5, t = tier - 1;
  const R = [1.5, 2.0, 2.5][t] * (L === 3 ? 1.1 : 1), wd = .32, wallH = [.85, 1.1, 1.35][t] + (L === 4 ? .22 : 0), y0 = .3, smoke = [];
  // Sockel mit Fundament (reicht nach unten, damit nichts schwebt)
  b.box(2 * R + 1.1, 2.0, 2 * R + 1.1, 0, -1.7, 0, mul(ST, .66));
  b.box(2 * R + .95, .14, 2 * R + .95, 0, y0 - .14, 0, mul(ST, .88));
  b.box(2 * R - .2, .05, 2 * R - .2, 0, y0 - .03, 0, [122, 110, 80]);
  for (let i = 0; i < 9; i++) b.box(.5, .02, .4, -R + .4 + hash(i, 4, v) * (2 * R - .8), y0 + .02, -R + .5 + hash(i, 9, v) * (2 * R - .9), [150 + hash(i, 1, v) * 20, 134, 100], hash(i, 2, v) * 3);   // Pflaster
  // Mauern
  const gw = L === 3 ? 1.05 : .85;
  wallSeg(b, -R, -R, R, -R, y0, wallH, wd, STD); wallSeg(b, -R, -R, -R, R, y0, wallH, wd, STD); wallSeg(b, R, -R, R, R, y0, wallH, wd, ST);
  wallSeg(b, -R, R, -gw / 2, R, y0, wallH, wd, ST); wallSeg(b, gw / 2, R, R, R, y0, wallH, wd, ST);
  crenels(b, -R, -R, R, -R, y0 + wallH, STD); crenels(b, -R, -R, -R, R, y0 + wallH, STD); crenels(b, R, -R, R, R, y0 + wallH, ST);
  crenels(b, -R, R, -gw / 2, R, y0 + wallH, ST); crenels(b, gw / 2, R, R, R, y0 + wallH, ST);
  // Strebepfeiler an der Rückwand ab Stufe 2
  if (tier >= 2) for (const u of [-.5, .5]) { b.box(.22, wallH * .9, .26, u * R, y0, -R - .2, mul(STD, .92)); b.box(.22, wallH * .9, .26, -R - .2, y0, u * R, mul(STD, .92), Math.PI / 2); }
  // Torhaus mit Fallgitter, Zugbrücke, Fackeln
  b.box(gw + .7, wallH + .55, wd + .55, 0, y0, R, mul(ST, 1.06)); b.box(gw + .76, .07, wd + .6, 0, y0 + wallH * .55, R, mul(ST, 1.14));
  b.box(gw * .7, wallH * .86, wd + .6, 0, y0, R, DARK);
  for (let i = -2; i <= 2; i++) b.box(.03, wallH * .78, .03, i * gw * .14, y0 + wallH * .07, R + wd / 2 + .3, [70, 60, 56]);
  b.box(gw * .7, .03, .03, 0, y0 + wallH * .55, R + wd / 2 + .3, [70, 60, 56]);
  b.box(gw * .85, .06, 1.15, 0, y0 - .04, R + .85, WOOD, 0, -.12);
  b.cyl(.015, .015, .75, 4, -gw * .42, y0 + .14, R + .5, [70, 66, 60]); b.cyl(.015, .015, .75, 4, gw * .42, y0 + .14, R + .5, [70, 66, 60]);
  for (const sx of [-1, 1]) { b.cyl(.02, .02, .4, 5, sx * (gw / 2 + .45), y0 + .35, R + .3, WOOD_D); b.cone(.07, .14, 6, sx * (gw / 2 + .45), y0 + .75, R + .3, LIGHT); }
  b.gable(gw + .95, wd + .8, .6, 0, y0 + wallH + .55, R, roofC);
  b.box(.34, .42, .03, -gw / 2 - .85, y0 + wallH * .25, R + wd / 2 + .02, mul(roofC, 1.05)); b.box(.34, .42, .03, gw / 2 + .85, y0 + wallH * .25, R + wd / 2 + .02, mul(roofC, 1.05));   // Banner am Tor
  // Türme
  const tr = [.42, .5, .58][t], tH = wallH + [.7, 1.0, 1.35][t] + (L === 4 ? .5 : 0), rf = [.95, 1.15, 1.4][t];
  tower(b, -R, -R, y0, tr, tH + (L === 4 ? .6 : 0), rf, roofC, ST, flags);
  tower(b, R, -R, y0, tr, tH + (L === 1 ? -.3 : 0), rf, roofC, ST, null);
  tower(b, -R, R, y0, tr, tH, rf, roofC, ST, null);
  tower(b, R, R, y0, tr * 1.08, tH + .25, rf * 1.05, roofC, ST, flags);
  if (tier >= 2) { for (const [x, z] of [[0, -R], [-R, 0], [R, 0]]) tower(b, x, z, y0, tr * .8, wallH + .55, rf * .8, roofC, ST, null, false); }
  if (tier >= 3) { tower(b, -R * .5, R, y0, tr * .7, wallH + .45, rf * .7, roofC, ST, null, false); tower(b, R, R * .5, y0, tr * .7, wallH + .45, rf * .7, roofC, ST, null, false); }
  // Burgfried
  const ks = [1.15, 1.5, 1.9][t] * (L === 1 ? 1.15 : 1), kh = [1.5, 2.1, 2.8][t] + (L === 2 ? .4 : 0), ky = y0;
  b.box(ks + .12, .22, ks + .12, 0, ky, 0, mul(ST, .8)); b.box(ks, kh, ks, 0, ky + .22, 0, PLASTER); b.box(ks + .08, .07, ks + .08, 0, ky + kh * .5, 0, mul(ST, 1.1));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(.13, kh, .13, sx * ks / 2, ky + .22, sz * ks / 2, mul(ST, 1.02));   // Ecksteine
  for (let r = 0; r < (tier === 1 ? 1 : 2); r++) for (let i = 0; i < (tier === 1 ? 1 : 2); i++) {
    const o = -ks / 2 + ks * (.3 + i * .4), wy = ky + kh * (.62 - r * .3);
    b.box(.2, .36, .05, o, wy, ks / 2 + .02, mul(ST, 1.1)); b.box(.13, .3, .06, o, wy + .03, ks / 2 + .03, DARK); b.box(.09, .22, .06, o, wy + .05, ks / 2 + .035, LIGHT);
    b.box(.05, .36, .2, ks / 2 + .02, wy, o, mul(ST, 1.1)); b.box(.06, .3, .13, ks / 2 + .03, wy + .03, o, DARK); b.box(.06, .22, .09, ks / 2 + .035, wy + .05, o, LIGHT);
  }
  b.box(.34, .52, .06, 0, ky + .22, ks / 2 + .02, WOOD_D); b.box(.4, .08, .08, 0, ky + .74, ks / 2 + .03, mul(ST, 1.1));
  let top = ky + kh + .22, rw = ks;
  b.box(ks + .22, .16, ks + .22, 0, top - .08, 0, mul(ST, 1.08));                                  // Kranzgesims
  if (tier >= 2) { const uw = ks * .72, uh = .55 + .2 * tier; b.box(uw, uh, uw, 0, top, 0, PLASTER); b.box(.18, .3, .05, 0, top + uh * .35, uw / 2 + .02, DARK); b.box(.05, .3, .18, uw / 2 + .02, top + uh * .35, 0, DARK); b.box(uw + .12, .1, uw + .12, 0, top + uh - .04, 0, mul(ST, 1.08)); top += uh; rw = uw; }
  if (L === 2) { b.cone(rw * .95, .5, 12, 0, top, 0, mul(roofC, .9)); b.cone(rw * .8, 1.2 + t * .35, 12, 0, top + .1, 0, roofC); top += 1.3 + t * .35; }
  else if (L === 1) {
    crenels(b, -rw / 2, -rw / 2, rw / 2, -rw / 2, top, ST, .35); crenels(b, rw / 2, -rw / 2, rw / 2, rw / 2, top, ST, .35); crenels(b, -rw / 2, rw / 2, rw / 2, rw / 2, top, ST, .35); crenels(b, -rw / 2, -rw / 2, -rw / 2, rw / 2, top, ST, .35);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { b.cyl(.12, .13, .5, 8, sx * rw / 2, top, sz * rw / 2, ST); b.cone(.17, .3, 8, sx * rw / 2, top + .5, sz * rw / 2, roofC); }
    b.pyr(rw * .6, rw * .6, .7, 0, top, 0, roofC); top += .7;
  } else {
    const rh = [.95, 1.2, 1.5][t] * (L === 3 ? 1.2 : 1); b.pyr(rw * 1.2, rw * 1.2, rh, 0, top, 0, roofC); b.box(rw * 1.22, .08, rw * 1.22, 0, top - .04, 0, mul(roofC, .85)); top += rh;
    if (L === 4 || tier === 3) b.gable(rw * .5, rw * .4, .45, 0, top - rh * .65, rw * .5, mul(roofC, 1.08), Math.PI / 2);   // Dachgaube
  }
  b.cyl(.025, .025, .9, 5, 0, top - .05, 0, WOOD_D); b.sph(.06, 0, top + .85, 0, GOLD, 6); flags.push([0, top + .75, 0]);
  smoke.push([rw * .22, top - .5, rw * .15]); b.box(.14, .4, .14, rw * .22, top - .8, rw * .15, STONE_D);
  // Hof: Häuser, Brunnen, Stände, Übungspuppe, Fässer
  if (tier >= 2 || L >= 3) house(b, -R + .75, .45, y0, .62, .78, .42, mul(roofC, .85));
  if (tier >= 3 || (L === 3 && tier >= 2)) house(b, R - .9, .6, y0, .68, .62, .4, mul(roofC, .75), .1);
  if (L === 0 && tier === 1) house(b, -R + .7, -.1, y0, .55, .55, .36, roofC);
  well(b, R * .35, R * .55, y0);
  crate(b, -R * .25, R * .78, y0, .22, .3); crate(b, -R * .25 + .22, R * .78 + .04, y0, .18, -.2); barrel(b, -R * .25 + .1, R * .78 - .24, y0); barrel(b, R * .62, -R * .25, y0);
  if (tier >= 2) { b.cyl(.025, .025, .5, 5, -R * .4, y0, R * .25, WOOD_D); b.box(.3, .05, .05, -R * .4, y0 + .38, R * .25, WOOD_D); b.box(.12, .18, .1, -R * .4, y0 + .22, R * .25, [180, 150, 100]); }
  if (tier >= 3) { b.box(.8, .05, .45, R * .45, y0 + .36, -R * .55, mul(roofC, .95)); for (const [dx, dz] of [[-.36, -.2], [.36, -.2], [-.36, .2], [.36, .2]]) b.box(.03, .36, .03, R * .45 + dx, y0, -R * .55 + dz, WOOD_D); b.box(.5, .08, .25, R * .45, y0 + .28, -R * .55, WOOD); }
  return { geo: b.build(), flags, h: top + 1, smoke };
}

function buildSlot() {
  const b = new MB();
  b.cyl(1.0, 1.1, .16, 12, 0, 0, 0, [140, 132, 116]); b.cyl(.6, .65, .1, 10, 0, .16, 0, [118, 104, 78]);
  b.cyl(.04, .04, 1.1, 5, 0, .2, 0, WOOD); b.box(.5, .24, .05, 0, .8, 0, [150, 112, 70]);
  for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28; b.box(.1, .22 + hash(i, 2) * .2, .1, Math.cos(a) * .85, .12, Math.sin(a) * .85, [150, 144, 128], a); }
  return { geo: b.build(), flags: [], h: 1.3 };
}
function buildThrone() {
  const b = new MB(), S = [196, 188, 168], parts = [], RED = [150, 36, 40];
  b.cyl(3.1, 3.4, 1.4, 20, 0, -1.2, 0, mul(S, .7));
  b.cyl(2.9, 3.0, .28, 20, 0, .0, 0, S); b.cyl(2.3, 2.4, .28, 20, 0, .28, 0, mul(S, 1.06)); b.cyl(1.7, 1.8, .28, 20, 0, .56, 0, mul(S, 1.1));
  b.box(.9, .04, 3.0, 0, .86, 1.4, RED);                                                         // roter Teppich
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832; b.cyl(.2, .24, 2.3, 10, Math.cos(a) * 2.05, .84, Math.sin(a) * 2.05, [218, 212, 194]); b.cyl(.3, .26, .16, 10, Math.cos(a) * 2.05, 3.08, Math.sin(a) * 2.05, GOLD); b.cyl(.27, .27, .1, 10, Math.cos(a) * 2.05, .84, Math.sin(a) * 2.05, mul(S, .9)); }
  b.cyl(2.35, 2.35, .16, 20, 0, 3.24, 0, GOLD);
  for (let i = 0; i < 8; i++) { const a = (i + .5) / 8 * 6.2832; b.box(.7, .9, .08, Math.cos(a) * 2.05, 2.5, Math.sin(a) * 2.05, [140, 30, 36], -a + Math.PI / 2); }   // Behänge
  b.cone(1.9, .5, 20, 0, 3.4, 0, [196, 150, 52]); b.cone(1.4, 1.1, 20, 0, 3.7, 0, [214, 170, 62]);
  b.cyl(.55, .3, .34, 12, 0, 4.7, 0, IRON); b.cyl(.62, .55, .1, 12, 0, 5.0, 0, GOLD);                // Feuerschale oben
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.2832; b.box(.3, .12, .12, Math.cos(a) * .22, 5.1, Math.sin(a) * .22, WOOD_D, -a); }
  b.box(.9, .22, .9, 0, .84, 0, S); b.box(.75, .42, .75, 0, 1.06, 0, GOLD); b.box(.75, 1.1, .18, 0, 1.2, -.32, GOLD); b.box(.16, .55, .55, -.34, 1.06, 0, GOLD); b.box(.16, .55, .55, .34, 1.06, 0, GOLD); b.box(.5, .12, .5, 0, 1.48, .05, RED);
  for (const [x, z] of [[-1.4, 2.2], [1.4, 2.2]]) { b.cyl(.14, .18, .5, 8, x, .84, z, IRON); parts.push({ k: 'flame', pos: [x, 1.45 * 4, z], s: 1.1 }); }
  parts.push({ k: 'flame', pos: [0, 23.2, 0], s: 3.4 }, { k: 'flame', pos: [.2, 22.4, .1], s: 2.4 });   // großes Lagerfeuer auf der Spitze
  const geo = b.build(); geo.scale(1, 4, 1);                                                          // Thron 4× so hoch wie ursprünglich
  return { geo, flags: [], h: 25, parts, smoke: [[-1.4, 7.2, 2.2], [1.4, 7.2, 2.2], [0, 24.6, 0]] };
}
function buildTower() {
  const b = new MB(), S = [176, 170, 156], D = mul(S, .78), parts = [];
  b.cyl(3.0, 3.4, .9, 18, 0, -.3, 0, D); b.cyl(2.5, 2.9, .5, 18, 0, .6, 0, S);                         // Sockel
  b.cyl(1.7, 2.1, 6.5, 16, 0, 1.1, 0, S); b.cyl(1.5, 1.7, 6.5, 16, 0, 7.6, 0, mul(S, 1.04));        // zwei Schaftstücke
  for (const y of [4, 8, 12]) b.cyl(1.95 - y * .03, 1.95 - y * .03, .3, 16, 0, y, 0, D);              // Bänder
  for (const y of [3, 6, 9.5, 12]) for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + y; b.box(.14, .6, .1, Math.cos(a) * 1.6, y, Math.sin(a) * 1.6, [40, 36, 34], -a); }   // Schießscharten
  b.cyl(2.5, 1.5, 1.0, 16, 0, 14.1, 0, mul(S, .9)); b.cyl(2.7, 2.7, .3, 16, 0, 15.0, 0, GOLD);       // Plattform
  for (let i = 0; i < 10; i++) { const a = i / 10 * 6.2832; b.box(.7, .65, .45, Math.cos(a) * 2.45, 15.3, Math.sin(a) * 2.45, S, -a); }   // Zinnen
  b.cyl(.55, .3, .34, 12, 0, 15.3, 0, IRON); b.cyl(.62, .55, .1, 12, 0, 15.6, 0, GOLD);
  parts.push({ k: 'flame', pos: [0, 16.4, 0], s: 1.9 });
  return { geo: b.build(), flags: [], h: 17, parts, smoke: [[0, 17.4, 0]] };
}
function buildSanct() {
  const b = new MB(), parts = [];
  b.cyl(2.0, 2.3, 1.0, 16, 0, -.8, 0, [150, 146, 134]); b.cyl(1.9, 2.0, .2, 16, 0, 0, 0, [214, 210, 196]); b.cyl(1.4, 1.5, .2, 16, 0, .2, 0, [226, 222, 208]); b.cyl(.6, .75, .35, 12, 0, .4, 0, [200, 200, 190]);
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.2832, x = Math.cos(a) * 1.3, z = Math.sin(a) * 1.3; b.cyl(.16, .19, 1.6, 8, x, .4, z, [230, 226, 214]); b.box(.42, .12, .42, x, 2.0, z, [204, 200, 184], -a); b.box(.36, .1, .36, x, .4, z, [190, 186, 172], -a); b.box(.05, .5, .02, x + Math.cos(a) * .17, 1.1, z + Math.sin(a) * .17, [140, 200, 235], -a + Math.PI / 2); }
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.2832, a2 = (i + 1) / 6 * 6.2832; b.box(1.35, .1, .16, (Math.cos(a) + Math.cos(a2)) * .65, 2.08, (Math.sin(a) + Math.sin(a2)) * .65, [204, 200, 184], -(a + a2) / 2 - Math.PI / 2); }
  b.cone(1.7, .5, 12, 0, 2.15, 0, [120, 150, 190]);
  return { geo: b.build(), flags: [], h: 3, glow: true, parts };
}
function buildFarm(lv) {
  // Nur Feld: reifes Getreide in Reihen, Heuballen, Garben und eine Vogelscheuche, ohne Gebäude
  const b = new MB(), parts = [], SOIL = [96, 70, 44], GOLD2 = [[226, 190, 70], [214, 176, 58], [236, 202, 88], [200, 164, 52]];
  const field = (x, z, w, d, rows, ripe) => {
    b.box(w, .06, d, x, 0, z, SOIL);
    for (let r = 0; r < rows; r++) {
      const rz = z - d / 2 + d * (r + .5) / rows, n = Math.round(w / .26);
      b.box(w, .03, d / rows * .28, x, .06, rz, mul(SOIL, .78));          // Furche
      for (let t = 0; t < n; t++) {
        const tx = x - w / 2 + w * (t + .5) / n, hh = .42 + hash(t, r, 4) * .22, c = ripe ? GOLD2[(t + r) % 4] : [122, 164, 62], lean = (hash(t, r, 5) - .5) * .25;
        for (let k = -1; k <= 1; k++) { b.box(.025, hh, .025, tx + k * .045, .06, rz + (hash(t, k, r) - .5) * .06, ripe ? [188, 156, 70] : [96, 140, 54], 0, lean, lean * .6); b.cone(.04, ripe ? .17 : .1, 5, tx + k * .045 + lean * hh * .5, .06 + hh - .02, rz, c); }
      }
    }
  };
  field(-.9, -.8, 2.5, 1.6, 6, true); field(1.1, -.9, 1.5, 1.4, 5, false);
  // Heuballen: zwei unten, einer oben
  const bale = (x, y, z, ry) => { b.push(new T.CylinderGeometry(.3, .3, .55, 10), [214, 180, 84], x, y, z, ry, 1, 1, 1, 0, Math.PI / 2, .18); for (const o of [-.14, .14]) b.push(new T.CylinderGeometry(.31, .31, .04, 10), [150, 112, 56], x + Math.cos(ry) * o, y, z - Math.sin(ry) * o, ry, 1, 1, 1, 0, Math.PI / 2, .05); };
  bale(-.5, .3, 1.15, .15); bale(.2, .3, 1.3, -.2); bale(-.15, .85, 1.2, .1);
  // Garben
  for (const [x, z] of [[1.2, .8], [1.6, .55], [1.5, 1.2]]) { b.cone(.2, .62, 7, x, .0, z, [218, 182, 78]); b.cyl(.2, .2, .04, 7, x, .22, z, [140, 98, 52], .05); }
  // Vogelscheuche
  b.cyl(.025, .025, .85, 4, -1.9, 0, .5, WOOD_D); b.box(.55, .04, .04, -1.9, .6, .5, WOOD_D); b.sph(.09, -1.9, .92, .5, [200, 170, 100], 6); b.cone(.13, .16, 6, -1.9, .96, .5, [70, 54, 40]); b.box(.2, .3, .08, -1.9, .3, .5, [120, 84, 60]);
  return { geo: b.build(), flags: [], h: 1.0, parts, smoke: [] };
}
function buildWood(lv) {
  // Nur Holz: zwei geschichtete Stapel und ein paar einzelne Stämme, ohne Gebäude
  const b = new MB(), LOGC = [[140, 96, 56], [128, 88, 52], [150, 104, 62], [118, 82, 48]], PALE = [214, 180, 128];
  const log = (x, y, z, len, rad, ry, k) => {
    b.push(new T.CylinderGeometry(rad, rad, len, 8), LOGC[k % 4], x, y, z, ry, 1, 1, 1, 0, Math.PI / 2);
    const ex = Math.cos(ry) * len / 2, ez = -Math.sin(ry) * len / 2;
    for (const sg of [-1, 1]) b.push(new T.CylinderGeometry(rad * .94, rad * .94, .04, 8), PALE, x + sg * ex, y, z + sg * ez, ry, 1, 1, 1, 0, Math.PI / 2, .05);
  };
  const pile = (cx, cz, ry, rows, len, rad) => {
    let k = 0;
    for (let r = 0; r < rows; r++) {
      const n = rows - r;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * rad * 2.08, h = rad + r * rad * 1.78;
        log(cx + Math.sin(ry) * off, h, cz + Math.cos(ry) * off, len, rad, ry, k++);
      }
    }
  };
  pile(-.5, -.5, .2, 4, 1.7, .17);
  pile(.9, 1.0, 1.35, 3, 1.5, .16);
  log(-1.5, .15, .9, 1.2, .15, .6, 1); log(-1.1, .13, 1.5, 1.0, .13, -.4, 2); log(1.6, .14, -.7, 1.1, .14, 1.0, 3); log(-.1, .12, 1.7, .9, .12, .1, 0);
  return { geo: b.build(), flags: [], h: 1.0, smoke: [] };
}
// Felsen entpacken (einmal)
const ROCK = ROCKS.map(r => {
  const u8 = x => Uint8Array.from(atob(x), c => c.charCodeAt(0)), pb = u8(r.p);
  return { n: r.n, w: r.w, h: r.h, d: r.d, P: new Int16Array(pb.buffer, 0, pb.length / 2), C: u8(r.c) };
});
// Steinbruch: eine Gruppe aus Felsen (drei Varianten) und ein paar gehauene Blöcke
const STONE_V = [
  [[7, .62, 0, 0, .3], [3, 1, 1.5, .6, .8], [6, .8, -1.4, .9, 2]],
  [[4, .7, -.2, 0, 1.2], [0, .8, 1.4, .7, .1], [3, .9, .8, -1.3, 2.6]],
  [[5, .8, 0, 0, .6], [2, .7, -1.3, .8, 1.7], [1, .7, 1.2, .8, 3], [6, .6, .2, -1.4, 1]]
];
function buildStone(lv, variant = 0) {
  const b = new MB();
  for (const [ri, sc, x, z, ry] of STONE_V[variant % STONE_V.length]) b.rock(ROCK[ri], sc * 1.25, x * 1.2, -ROCK[ri].h * sc * 1.25 * .24, z * 1.2, ry);
  b.box(.5, .3, .4, -.9, 0, -1.3, [188, 182, 168], .3); b.box(.4, .24, .34, -.4, 0, -1.6, [176, 170, 156], -.2);
  return { geo: b.build(), flags: [], h: 2.2 };
}
function buildOre(lv) {
  const b = new MB();
  b.ico(1.3, -.1, .45, -.1, [104, 98, 90], .8, 1.1, .3); b.ico(.95, .9, .35, -.5, [118, 110, 100], .8, 1, .9); b.ico(.8, -.9, .3, .6, [92, 88, 82], .8, 1, 1.4); b.ico(.7, .5, .3, .7, [110, 104, 94], .75, 1, .2);
  b.box(.7, .8, .3, .0, 0, 1.02, [14, 12, 10]); b.box(.12, .86, .12, -.42, 0, 1.06, WOOD); b.box(.12, .86, .12, .42, 0, 1.06, WOOD); b.box(.98, .12, .14, 0, .84, 1.06, WOOD);
  for (let i = 0; i < 5; i++) b.ico(.09, -.5 + i * .4, .72 + (i % 2) * .26, .45 + i * .07, [[232, 190, 90], [120, 190, 230], [236, 210, 130]][i % 3], 1.3);
  b.box(.06, .03, 1.2, -.14, 0, 1.45, IRON); b.box(.06, .03, 1.2, .14, 0, 1.45, IRON); for (let i = 0; i < 5; i++) b.box(.4, .03, .05, 0, 0, 1.0 + i * .26, WOOD_D);
  b.box(.5, .26, .34, .0, .08, 1.9, [74, 58, 44]); b.cyl(.09, .09, .06, 8, -.15, 0, 1.75, [30, 30, 30], 0); b.cyl(.09, .09, .06, 8, .15, 0, 1.75, [30, 30, 30], 0);
  for (let i = 0; i < 4; i++) b.ico(.07, -.12 + i * .08, .42, 1.9, [232, 190, 90], 1);
  b.cyl(.01, .01, .3, 4, .55, .5, .95, IRON); b.box(.1, .12, .1, .55, .38, .95, LIGHT);
  return { geo: b.build(), flags: [], h: 1.5 };
}
function buildCamp(dead) {
  const b = new MB(), TC = [[150, 60, 48], [134, 98, 60], [100, 78, 60]], parts = [];
  if (!dead) {
    [[-.95, -.45, .0], [.9, -.6, .5], [.15, .9, 1.1]].forEach(([x, z, ry], i) => { b.push(new T.ConeGeometry(.78, 1.15, 4, 1), TC[i], x, .57, z, ry); b.push(new T.ConeGeometry(.79, .3, 4, 1), mul(TC[i], .65), x, .2, z, ry); b.box(.2, .5, .04, x + Math.sin(ry) * .45, 0, z + Math.cos(ry) * .45, [30, 24, 20], ry); });
    for (let i = 0; i < 24; i++) { const a = i / 24 * 6.2832, x = Math.cos(a) * 2.0, z = Math.sin(a) * 2.0; if (Math.abs(a - 1.2) < .25) continue; b.cone(.075, .62 + hash(i, 3) * .24, 5, x, 0, z, [112, 78, 46]); }
    b.box(.05, .6, .05, 1.35, 0, 1.2, WOOD_D); b.cyl(.025, .025, 1.7, 5, 1.35, 0, 1.2, WOOD_D); b.cyl(.06, .06, .14, 6, 1.35, 1.7, 1.2, [230, 226, 214]); b.sph(.1, 1.35, 1.85, 1.2, [230, 226, 214], 6);
    // Wachturm
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(.06, 1.4, .06, -1.55 + dx * .3, 0, -1.3 + dz * .3, WOOD_D); b.box(.8, .08, .8, -1.55, 1.4, -1.3, WOOD); b.gable(1.0, .95, .38, -1.55, 1.9, -1.3, [96, 74, 50], Math.PI / 2);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(.04, .5, .04, -1.55 + dx * .38, 1.42, -1.3 + dz * .38, WOOD_D);
    crate(b, .75, .35, 0, .26, .3); crate(b, 1.05, .5, 0, .2, -.2); barrel(b, .5, 1.0, 0); barrel(b, 1.0, 1.1, 0); b.box(.7, .06, .26, 0, .05, -.1, [70, 58, 44], .5);    // Kisten, Fässer, Holzscheite
    b.cyl(.28, .32, .08, 10, .0, 0, .15, [58, 54, 50]); for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; b.ico(.07, Math.cos(a) * .3, .06, .15 + Math.sin(a) * .3, [96, 92, 86], .8); }
    parts.push({ k: 'flame', pos: [0, .22, .15], s: 1 });
  } else {
    [[-.95, -.45], [.9, -.6], [.15, .9]].forEach(([x, z], i) => { b.cyl(.7, .75, .06, 7, x, 0, z, [48, 44, 40]); for (let k = 0; k < 3; k++) b.box(.05, .7 - k * .15, .05, x + (k - 1) * .3, 0, z, [54, 42, 34], 0, .1 * k, .2 * (k - 1)); });
    for (let i = 0; i < 8; i++) b.box(.4, .04, .06, -.3 + hash(i, 1) * 1.5, .02, -.5 + hash(i, 2) * 1.4, [40, 34, 30], hash(i, 3) * 3);
  }
  return { geo: b.build(), flags: [], h: 1.9, parts, smoke: dead ? [] : [[0, .6, .15]] };
}
function buildRuin(dead) {
  const b = new MB(), S = dead ? [118, 114, 100] : [152, 146, 128];
  for (const [x, z, w, d, h, ry] of [[-.9, -.3, 1.6, .3, 1.1, .1], [.6, -.9, .3, 1.5, .8, 0], [-.2, .8, 1.2, .3, .5, -.15], [1.2, .5, .5, .5, 1.3, 0]]) { b.box(w, h, d, x, 0, z, S, ry); b.box(w * .5, .22, d + .04, x - w * .1, h, z, S, ry); }
  b.cyl(.2, .22, 1.4, 8, -1.5, 0, .7, [170, 164, 146]); b.cyl(.2, .22, .6, 8, 1.4, 0, -.6, [160, 154, 138]); b.cyl(.28, .26, .1, 8, -1.5, 1.4, .7, [182, 176, 158]);
  b.push(new T.CylinderGeometry(.18, .2, 1.1, 8), [166, 160, 142], .2, .12, -1.5, 0, 1, 1, 1, 0, Math.PI / 2);
  for (let i = 0; i < 12; i++) b.ico(.12 + hash(i, 5) * .1, -1 + hash(i, 1) * 2.4, .08, -.9 + hash(i, 2) * 2.2, mul(S, .85), .7);
  b.sph(.5, .0, .2, .0, [80, 112, 60], 6, .5); b.sph(.32, -.9, .55, -.3, [74, 108, 56], 6, .6); b.sph(.3, 1.2, 1.1, .5, [70, 104, 54], 6, .5);
  if (!dead) { b.box(.5, .28, .34, .1, 0, .3, [120, 84, 52]); b.box(.52, .05, .36, .1, .28, .3, GOLD); }
  return { geo: b.build(), flags: [], h: 1.5 };
}
const NODE_K = ['farm', 'wood', 'stone'];
function buildDepleted() {
  const b = new MB(), D = [112, 92, 66];
  b.cyl(1.5, 1.7, .14, 14, 0, 0, 0, D, .2); b.cyl(1.0, 1.25, .1, 12, .1, .14, -.05, mul(D, .88), .25);
  for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28 + .3; b.box(.07, .03, .9 + hash(i, 4) * .5, Math.cos(a) * .6, .24, Math.sin(a) * .6, mul(D, .55), a + 1.57); }
  for (let i = 0; i < 6; i++) b.ico(.1 + hash(i, 6) * .08, -1.2 + hash(i, 1) * 2.4, .16, -1.1 + hash(i, 2) * 2.2, [124, 118, 104], .7);
  b.cyl(.14, .2, .32, 7, -.7, .1, .5, [96, 70, 44]); b.cyl(.1, .14, .22, 7, .8, .1, -.6, [90, 66, 42]);
  b.cone(.04, .22, 4, .3, .14, .9, [128, 118, 70]); b.cone(.04, .18, 4, -.2, .14, -.9, [124, 114, 68]); b.cone(.03, .16, 4, 1.1, .14, .4, [120, 112, 66]);
  return { geo: b.build(), flags: [], h: .5 };
}
function buildOutpost() {
  const b = new MB(), flags = [], S = [158, 150, 134];
  b.cyl(1.05, 1.2, 1.7, 12, 0, -1.4, 0, mul(S, .72)); b.cyl(.62, .8, 2.5, 12, 0, .3, 0, S); b.cyl(.66, .66, .06, 12, 0, 1.4, 0, mul(S, 1.1)); b.cyl(.88, .8, .28, 12, 0, 2.7, 0, mul(S, 1.06)); b.cyl(.9, .9, .1, 12, 0, 2.98, 0, WOOD_D);
  for (let i = 0; i < 9; i++) { const a = i / 9 * 6.2832; b.box(.22, .24, .16, Math.cos(a) * .82, 3.08, Math.sin(a) * .82, S, -(a + Math.PI / 2)); }
  b.box(.36, .62, .12, 0, .3, .78, WOOD_D); b.box(.12, .3, .2, .55, 1.6, 0, DARK); b.box(.12, .3, .2, -.55, 1.9, 0, DARK); b.box(.2, .3, .12, 0, 2.2, -.55, DARK);
  b.box(.8, .05, .7, 0, .02, 1.3, WOOD, 0, .0); for (let i = 0; i < 5; i++) { const a = (i - 2) / 4 * 2.2, x = Math.sin(a) * 1.5, z = Math.cos(a) * 1.5; b.cone(.07, .6, 5, x * 1.0, 0, z * .9 + .2, [112, 78, 46]); }
  b.cyl(.03, .03, 1.2, 5, 0, 3.08, 0, WOOD_D); b.sph(.05, 0, 4.3, 0, GOLD, 6); flags.push([0, 3.95, 0]);
  b.cyl(.02, .02, .4, 4, .98, 1.4, 0, WOOD_D); b.cone(.07, .12, 6, .98, 1.8, 0, LIGHT);
  return { geo: b.build(), flags, h: 4.4, smoke: [] };
}

/* ---------- Einheiten ---------- */
// liefert Körper (starr) sowie zwei Beinpaare (schwingen); col = Spielerfarbe
// Wikinger entpacken (einmal): Dreiecke je Teil (0 Körper, 1/2 Beine) und Farbklasse
const VIK = (() => {
  const u8 = x => Uint8Array.from(atob(x), c => c.charCodeAt(0)), pb = u8(VIKING.p);
  return { n: VIKING.n, hip: VIKING.hip / 1000, P: new Int16Array(pb.buffer, 0, pb.length / 2), C: u8(VIKING.c) };
})();
const VIK_FOOT = ['speer', 'schwert', 'bogen', 'armbrust'];
function vikingParts(body, la, lb, tab) {
  const COLS = [[226, 190, 150], [150, 156, 166], [100, 74, 52], tab, [170, 120, 60], [204, 186, 150], [110, 90, 70], [70, 52, 40]], parts = [body, la, lb];
  for (let t = 0; t < VIK.n; t++) {
    const k = VIK.C[t], b = parts[k >> 4], col = COLS[k & 15], v = [];
    for (let q = 0; q < 3; q++) { const i = (t * 3 + q) * 3; v.push([VIK.P[i] / 1000, VIK.P[i + 1] / 1000, VIK.P[i + 2] / 1000]); }
    let a = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], c = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    let n = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
    const f = (1 + (hash(b.tri++, 7, 3) - .5) * .1), cr = LIN(Math.min(255, col[0] * f)), cg = LIN(Math.min(255, col[1] * f)), cb = LIN(Math.min(255, col[2] * f));
    for (const q of v) { b.p.push(q[0], q[1], q[2]); b.n.push(n[0], n[1], n[2]); b.c.push(cr, cg, cb); }
  }
}
// Reiter entpacken (einmal)
const RID = (() => { const u8 = x => Uint8Array.from(atob(x), c => c.charCodeAt(0)), pb = u8(RIDER.p); return { n: RIDER.n, P: new Int16Array(pb.buffer, 0, pb.length / 2), C: u8(RIDER.c) }; })();
function riderTorso(body, type, tab, y0) {
  const COLS = type === 'schwer' ? [[176, 182, 194], [196, 202, 214], tab] : [[128, 116, 100], [150, 156, 166], tab];
  for (let t = 0; t < RID.n; t++) {
    const col = COLS[RID.C[t]], v = [];
    for (let q = 0; q < 3; q++) { const i = (t * 3 + q) * 3; v.push([RID.P[i] / 1000, RID.P[i + 1] / 1000 + y0, RID.P[i + 2] / 1000]); }
    const a = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], c = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    let n = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
    const f = 1 + (hash(body.tri++, 9, 3) - .5) * .1, cr = LIN(Math.min(255, col[0] * f)), cg = LIN(Math.min(255, col[1] * f)), cb = LIN(Math.min(255, col[2] * f));
    for (const q of v) { body.p.push(q[0], q[1], q[2]); body.n.push(n[0], n[1], n[2]); body.c.push(cr, cg, cb); }
  }
}
// Pferd mit vier einzeln schwingenden Beinen; Rücken bei y = .6, Blick nach +z
function horseModel(body, legs, type, tab) {
  const heavy = type === 'schwer', coat = heavy ? [64, 58, 56] : [128, 90, 60], dark = mul(coat, .5), light = mul(coat, 1.12), hoof = [40, 34, 30], steel = [176, 182, 194];
  const S = (col, x, y, z, rx, ry, rz, ax = 0, az = 0, jit) => body.push(new T.SphereGeometry(1, 10, 7), col, x, y, z, az, rx, ry, rz, ax, 0, jit);
  S(coat, 0, .5, 0, .14, .15, .3); S(coat, 0, .52, .21, .145, .17, .15); S(coat, 0, .53, -.2, .15, .16, .16);   // Rumpf, Brust, Kruppe
  S(coat, 0, .72, .36, .068, .19, .085, .62); S(light, 0, .9, .5, .06, .1, .065, 2.2); S(mul(coat, .8), 0, .8, .6, .042, .045, .048);   // Hals, Kopf, Maul
  body.cone(.02, .07, 5, .04, .95, .46, coat); body.cone(.02, .07, 5, -.04, .95, .46, coat);   // Ohren
  for (let k = 0; k < 7; k++) body.box(.03, .07, .035, 0, .86 - k * .035 + .05, .27 + k * .028 - .02, dark, 0, .62 + .1 * k);   // Mähne
  body.push(new T.ConeGeometry(.05, .46, 6), dark, 0, .33, -.43, 0, 1, 1, 1, -.28, 0);   // Schweif
  if (!heavy) { body.box(.03, .05, .12, 0, .84, .53, [236, 230, 216], 0, -.1); }   // Blesse
  // Sattel und Decke
  body.box(.34, .03, .36, 0, .6, 0, tab); body.box(.2, .05, .22, 0, .63, -.02, [96, 66, 42]); body.box(.2, .02, .03, 0, .62, .22, [70, 46, 30]);
  body.box(.012, .22, .012, .17, .4, .02, [80, 56, 36]); body.box(.012, .22, .012, -.17, .4, .02, [80, 56, 36]);   // Steigbügelriemen
  body.box(.012, .012, .3, 0, .93, .35, [70, 46, 30], 0, -.4);   // Zügel
  if (heavy) {   // Rossharnisch: Decke in Spielerfarbe, Brust- und Stirnplatte aus Stahl
    S(tab, 0, .5, -.02, .153, .162, .21); S(steel, 0, .56, .26, .15, .13, .08); S(steel, 0, .93, .5, .066, .08, .07, 2.2);
    body.box(.05, .02, .16, 0, 1.0, .46, steel, 0, -.4); for (let k = 0; k < 4; k++) body.box(.15, .03, .05, 0, .5 + k * .05, .3 + k * .02, steel);
  }
  // Beine: Gelenk am Rumpf (y = .42), Schwingen um die Achse quer zum Pferd
  const leg = (front, sg, x, z) => {
    const b = new MB(), lc = front ? coat : mul(coat, .95), sock = !heavy && ((x > 0) === (z > 0));
    b.push(new T.CylinderGeometry(.055, .035, .22, 6), lc, 0, -.1, front ? .01 : -.01, 0, 1, 1, 1, front ? 0 : .25, 0);
    b.push(new T.CylinderGeometry(.03, .026, .2, 6), sock ? [236, 230, 216] : mul(lc, .85), 0, -.3, front ? .0 : -.05, 0, 1, 1, 1, front ? 0 : -.2, 0);
    b.box(.065, .05, .08, 0, -.4, front ? .01 : -.05, hoof); if (heavy) b.box(.075, .06, .075, 0, -.31, front ? .0 : -.04, steel);
    legs.push({ g: b.build(), x, y: .42, z, s: sg });
  };
  leg(true, 1, .085, .22); leg(true, -1, -.085, .22); leg(false, -1, .085, -.22); leg(false, 1, -.085, -.22);
}
function buildUnit(type, col, full) {
  const legs = [], body = new MB(), la = new MB(), lb = new MB(), SK = [226, 190, 150], tab = col, dk = mul(col, .65);
  const rider = (b, y, scale = 1, plate = false, lance = true) => {
    const m = plate ? [170, 176, 188] : [120, 110, 100];
    b.box(.18 * scale, .2 * scale, .12 * scale, 0, y, 0, plate ? m : tab); b.sph(.065 * scale, 0, y + .26 * scale, 0, SK, 6); b.sph(.075 * scale, 0, y + .29 * scale, 0, plate ? [180, 186, 198] : [150, 150, 158], 6, .8);
    if (plate) b.box(.02, .1, .02, 0, y + .36 * scale, 0, tab);
    if (lance) { b.cyl(.012, .012, 1.05, 4, .14, y - .25, .05, WOOD_D); b.cone(.025, .08, 4, .14, y + .8, .05, IRON); b.box(.14, .08, .01, .21, y + .6, .05, tab); }
    b.sph(.09 * scale, -.14, y + .02, 0, tab, 6, 1.1); // Schild
  };
  const horse = (coat, barding) => {
    body.box(.2, .22, .56, 0, .34, 0, coat); body.box(.12, .3, .12, 0, .44, .3, coat, 0, -.5); body.box(.1, .12, .2, 0, .66, .4, coat, 0, .3); body.box(.02, .1, .1, 0, .72, .26, mul(coat, .7));
    body.box(.05, .05, .2, 0, .3, -.33, mul(coat, .7), 0, .6);
    if (barding) { body.box(.24, .08, .5, 0, .46, 0, barding); body.box(.22, .2, .08, 0, .32, .26, barding); }
    for (const [x, z, g] of [[-.07, .2, la], [.07, -.2, la], [.07, .2, lb], [-.07, -.2, lb]]) { g.box(.05, .26, .05, x, -.24, z, mul(coat, .85)); g.box(.06, .04, .06, x, -.27, z, [40, 34, 30]); }
  };
  if (VIK_FOOT.includes(type)) {
    vikingParts(body, la, lb, tab);
    if (type === 'speer') { body.cyl(.012, .012, 1.25, 5, -.17, .02, .06, WOOD_D); body.cone(.026, .1, 5, -.17, 1.27, .06, IRON); body.push(new T.CylinderGeometry(.15, .15, .025, 10), dk, .2, .4, .02, 0, 1, 1, 1, 0, Math.PI / 2); }
    else if (type === 'schwert') { body.box(.02, .42, .05, -.19, .06, .04, [210, 214, 220]); body.box(.02, .05, .12, -.19, .22, .04, GOLD); body.push(new T.CylinderGeometry(.17, .17, .03, 10), tab, .21, .38, .03, 0, 1, 1, 1, 0, Math.PI / 2); body.push(new T.CylinderGeometry(.04, .04, .045, 6), IRON, .22, .38, .03, 0, 1, 1, 1, 0, Math.PI / 2); }
    else { body.push(new T.TorusGeometry(.26, .012, 4, 10, Math.PI), WOOD, -.2, .42, .06, 0, 1, 1, 1, 0, Math.PI / 2 + Math.PI / 2); body.box(.012, .5, .012, -.2, .17, .06, [220, 214, 200]); body.box(.05, .26, .06, .08, .45, -.12, [110, 78, 48], 0, .3); for (let i = 0; i < 3; i++) body.box(.01, .08, .01, .08 + i * .015, .68, -.14, tab); }
  } else if (type === 'handkarren') {   // Handkarren nach cart.glb: zwei große Speichenräder, offener Kasten in Spielerfarbe, Stahlrahmen, lange Deichsel nach vorn (+z)
    const k = .21, STEEL = [84, 90, 100], WOODC = [150, 106, 62];
    const bx = (w, h, d, x, y, z, c, rx = 0) => body.box(w * k, h * k, d * k, x * k, y * k, z * k, c, 0, rx);
    bx(2.04, .08, 2.6, 0, .46, .04, WOODC);                                                  // Boden
    bx(.08, .85, 2.6, -1.0, .5, .04, tab, -.04); bx(.08, .85, 2.6, 1.0, .5, .04, tab, -.04);  // Seitenwände
    bx(2.04, .95, .08, 0, .5, -1.27, tab); bx(2.04, .5, .08, 0, .5, 1.3, tab);                // Rück- und Vorderwand
    for (const x of [-1.04, 1.04]) { bx(.1, .08, 2.7, x, 1.3, .04, STEEL); bx(.1, .08, 2.7, x, .42, .04, STEEL); }   // Rahmenrohre
    bx(2.2, .1, .1, 0, .56, 0, STEEL);                                                        // Achse
    for (const x of [-.9, .9]) { bx(.08, 1.4, .08, x, 1.35, 1.3, STEEL); bx(.08, .08, 1.6, x, 1.45, 2.1, STEEL, .0); }   // Deichsel
    bx(2.0, .08, .08, 0, 1.45, 2.9, STEEL);                                                   // Griff
    for (const x of [-.9, .9]) body.push(new T.CylinderGeometry(.03 * 1, .03, .55 * k * 1.9, 5), STEEL, x * k, .2 * k + .06, -1.25 * k, 0, 1, 1, 1, .35, 0);   // Standbeine hinten
    {   // Bauer zieht den Karren: steht zwischen den Deichseln und hält den Griff
      const fz = .8, tun = [150, 112, 72], hat = [214, 184, 96];
      body.box(.2, .27, .13, 0, .54, fz, tun); body.box(.21, .04, .14, 0, .42, fz, [70, 52, 40]); body.box(.22, .1, .14, 0, .66, fz, tab);   // Kittel, Gürtel, Schulterpartie in Teamfarbe
      body.sph(.07, 0, .78, fz, SK, 6); body.push(new T.CylinderGeometry(.13, .13, .02, 9), hat, 0, .84, fz, 0, 1, 1, 1, 0, 0); body.push(new T.CylinderGeometry(.06, .08, .07, 8), hat, 0, .88, fz, 0, 1, 1, 1, 0, 0);
      for (const sx of [-1, 1]) {
        body.box(.055, .34, .055, sx * .13, .46, fz - .09, tun, 0, .55); body.sph(.035, sx * .12, .31, fz - .17, SK, 5);   // Arm nach hinten zum Griff
        const l = new MB(); l.box(.075, .38, .09, 0, -.19, 0, [92, 76, 60]); l.box(.085, .07, .12, 0, -.38, .015, [60, 44, 32]);
        legs.push({ g: l.build(), x: sx * .055, y: .4, z: fz, s: sx });
      }
    }
    if (full) {   // beladen: Getreide im Kasten
      const G1 = [226, 186, 74], G2 = [208, 164, 56], G3 = [236, 202, 96];
      body.push(new T.SphereGeometry(1, 9, 6), G1, 0, .86 * k, .02 * k, 0, .92 * k, .5 * k, 1.12 * k, 0, 0, .2);
      body.push(new T.SphereGeometry(1, 8, 5), G3, -.35 * k, 1.1 * k, .5 * k, 0, .5 * k, .3 * k, .55 * k, 0, 0, .2);
      body.push(new T.SphereGeometry(1, 8, 5), G2, .4 * k, 1.05 * k, -.4 * k, 0, .55 * k, .28 * k, .6 * k, 0, 0, .2);
    }
    for (const sx of [-1, 1]) {   // Räder: drehen sich beim Marsch
      const w = new MB(), R = .6 * k;
      w.push(new T.TorusGeometry(R, .06 * k, 5, 14), [40, 40, 40], 0, 0, 0, Math.PI / 2, 1, 1, 1, 0, 0);
      w.push(new T.CylinderGeometry(.14 * k, .14 * k, .22 * k, 6), WOODC, 0, 0, 0, 0, 1, 1, 1, 0, Math.PI / 2);
      for (let a = 0; a < 4; a++) w.box(.05 * k, 1.1 * k, .05 * k, 0, -.55 * k, 0, WOODC, 0, a * Math.PI / 4);
      legs.push({ g: w.build(), x: sx * 1.2 * k, y: .61 * k, z: .04 * k, s: 0, spin: true });
    }
  } else if (type === 'leicht' || type === 'schwer') {
    const heavy = type === 'schwer', steel = [176, 182, 194], boot = heavy ? steel : [70, 52, 40], pant = heavy ? [150, 156, 168] : [110, 90, 70];
    horseModel(body, legs, type, tab); riderTorso(body, type, tab, .64);
    body.push(new T.CylinderGeometry(1, 1.1, .12, 10), tab, 0, .64, -.01, 0, .17, 1, .13);   // Waffenrock
    for (const sx of [-1, 1]) { body.box(.075, .13, .11, sx * .13, .5, .02, pant, 0, -.2, sx * .1); body.box(.07, .2, .09, sx * .16, .32, .06, boot, 0, .15, sx * .05); body.box(.07, .04, .12, sx * .16, .3, .1, boot); }
    if (type === 'leicht') {   // Lanzenreiter: lange Lanze mit Wimpel
      const th = 1.15, d = [0, Math.cos(th), Math.sin(th)], hx = -.2, hy = .74, hz = .12;
      body.push(new T.CylinderGeometry(.012, .016, 1.4, 5), WOOD_D, hx + d[0] * .25, hy + d[1] * .25, hz + d[2] * .25, 0, 1, 1, 1, th, 0);
      body.push(new T.ConeGeometry(.03, .14, 5), IRON, hx + d[0] * .99, hy + d[1] * .99, hz + d[2] * .99, 0, 1, 1, 1, th, 0);
      body.push(new T.BoxGeometry(.01, .1, .2), tab, hx + d[0] * .85, hy + d[1] * .85 - .04, hz + d[2] * .85 - .1, 0, 1, 1, 1, th, 0);
    } else {   // Panzerreiter: Kurzschwert und Schild
      body.box(.02, .4, .05, -.22, .56, .1, [210, 214, 220], 0, .3); body.box(.02, .05, .12, -.22, .7, .09, GOLD);
      body.push(new T.ConeGeometry(.13, .3, 3), tab, .24, .72, .08, 0, 1, 1, .35, Math.PI, 0); body.box(.02, .1, .1, .24, .78, .1, steel);
    }
  }
  const fin = b => { const g = b.build(); return g; };
  return { legs, body: fin(body), la: la.p.length ? fin(la) : null, lb: lb.p.length ? fin(lb) : null, hip: VIK_FOOT.includes(type) ? VIK.hip : type === 'leicht' || type === 'schwer' ? .3 : .12, cav: type === 'leicht' || type === 'schwer' };
}

/* ---------- Bäume (Instanzen) ---------- */
function treeGeo(kind) {
  const b = new MB(), W = [255, 255, 255];
  if (kind === 'pine' || kind === 'snow') {
    const c = kind === 'pine' ? [[255, 255, 255], [238, 238, 238], [220, 220, 220], [206, 206, 206]] : [[226, 238, 238], [214, 230, 232], [234, 244, 246], [244, 248, 250]];
    b.cyl(.05, .075, .32, 8, 0, 0, 0, [90, 62, 38]);
    b.cone(.42, .5, 14, 0, .2, 0, c[0]); b.cone(.35, .46, 14, 0, .44, 0, c[1]); b.cone(.27, .42, 14, 0, .68, 0, c[2]); b.cone(.17, .38, 12, 0, .9, 0, c[3]);
  } else if (kind === 'oak') {
    b.cyl(.06, .095, .46, 8, 0, 0, 0, [98, 70, 44]); b.cyl(.025, .04, .3, 6, .1, .3, 0, [98, 70, 44]);
    b.ico(.34, 0, .68, 0, W, .88, 1, 0, 2); b.ico(.23, .2, .84, .08, [238, 238, 238], .88, 1, 0, 2); b.ico(.21, -.18, .78, -.1, [222, 226, 222], .88, 1, 0, 2); b.ico(.17, .02, .98, -.06, [246, 246, 246], .9, 1, 0, 1);
  } else if (kind === 'bush') { b.ico(.2, 0, .13, 0, W, .8, 1, 0, 2); b.ico(.14, .16, .1, .06, [225, 225, 225], .8, 1, 0, 1); b.ico(.11, -.14, .09, .07, [236, 236, 236], .8, 1, 0, 1); }
  else { b.ico(.24, 0, .1, 0, W, .65, 1, 0, 1); b.ico(.14, .2, .06, .08, [220, 220, 220], .7, 1, 0, 1); }
  return b.build();
}

const SMOKE_VS = `
attribute float aA; attribute float aS; uniform float uScale; varying float vA;
void main(){ vA=aA; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=aS*uScale/max(1.0,-mv.z); }`;
const SMOKE_FS = `
varying float vA;
void main(){ vec2 c=gl_PointCoord-.5; float d=length(c)*2.0; if(d>1.0) discard; gl_FragColor=vec4(.86,.86,.86,vA*(1.0-d*d)); }`;
const WATER_VS = `
attribute float aDepth; varying float vDepth; varying vec3 vW;
#include <fog_pars_vertex>
void main(){ vDepth=aDepth; vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; vec4 mvPosition=viewMatrix*wp; gl_Position=projectionMatrix*mvPosition;
#include <fog_vertex>
}`;
const WATER_FS = `
uniform float uTime; varying float vDepth; varying vec3 vW;
#include <fog_pars_fragment>
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x), mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x), f.y); }
void main(){
  float d=clamp(vDepth,0.0,1.0); float t=uTime; vec2 p=vW.xz*.55;
  vec3 shallow=vec3(.30,.70,.72), deep=vec3(.035,.20,.36);
  vec3 col=mix(shallow,deep,pow(d,.6));
  float n=vn(p+vec2(t*.2,t*.12))*.55+vn(p*2.1-vec2(t*.15,-t*.2))*.45;
  col+=(n-.5)*.16*(1.0-d*.5);
  float w=sin(vW.x*2.4+t*1.3+n*5.0)*sin(vW.z*2.2-t*1.0+n*4.0); col+=vec3(.05,.07,.08)*w*(1.0-d*.5);
  float sp=pow(max(0.0,sin((vW.x+vW.z)*3.2+t*2.4+n*9.0)),40.0)*vn(p*3.0+t*.4); col+=vec3(.7,.78,.78)*sp*(1.0-d*.6);
  float foam=smoothstep(.07,.0,vDepth)*(.55+.45*sin(t*1.4+n*8.0+vW.x*1.5)); col=mix(col,vec3(.95,.98,.96),foam*.8);
  float a=clamp(.55+d*.4,0.0,.96)*smoothstep(-.06,.02,vDepth);
  gl_FragColor=vec4(col,a);
#include <fog_fragment>
}`;

const SKIRT = { farm: [[132, 108, 66], 2.2], wood: [[104, 84, 54], 1.9], stone: [[140, 134, 120], 2.0], camp: [[112, 94, 68], 2.1], ruin: [[112, 106, 90], 1.9] };
const KIND_R = { start: 2.8, tower: 2.4, throne: 3.4, sanct: 2.3, farm: 1.7, wood: 1.6, stone: 1.6, camp: 1.9, ruin: 1.7 };

export class WorldMap {
  constructor(THREE, host) {
    T = THREE; this.host = host;
    const r = this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding;
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    this.dom = r.domElement; host.appendChild(this.dom);
    this.scene = new T.Scene(); const sky = 0x9cc3de; this.scene.background = new T.Color(sky); this.scene.fog = new T.Fog(sky, 70, 260);
    this.camera = new T.PerspectiveCamera(34, 1, 2, 1800);
    this.hemi = new T.HemisphereLight(0xcfe3ff, 0x7d7448, .95); this.scene.add(this.hemi);
    this.sun = new T.DirectionalLight(0xfff1d6, 1.15); this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 220; this.sun.shadow.bias = -.0006; this.sun.shadow.normalBias = .05;
    this.scene.add(this.sun, this.sun.target);
    this.labelsEl = document.createElement('div'); this.labelsEl.className = 'maplabels'; host.appendChild(this.labelsEl);
    this.time = 0; this.obj = {}; this.sel = null; this.cam = { x: 100, z: 100, yaw: Math.PI / 4, pitch: .93, dist: 44 };
    this.fx = []; this.marchObjs = {}; this.opObjs = {}; this.terrObjs = []; this.mats = {};
    this.resize(); window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight; this.W = w; this.H = h;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /* ---------- Höhe ---------- */
  hAt(tx, ty) {
    const H = this.map.H, gx = clamp(tx * SUB, 0, G - 1.001), gy = clamp(ty * SUB, 0, G - 1.001), x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    const a = H[y0 * G + x0], b = H[y0 * G + x0 + 1], c = H[(y0 + 1) * G + x0], d = H[(y0 + 1) * G + x0 + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  yAt(tx, ty) { return terrY(this.hAt(tx, ty)); }
  baseY(tx, ty, r = 1) { let m = this.yAt(tx, ty); for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) m = Math.max(m, this.yAt(tx + dx, ty + dy)); return Math.max(m, 0); }
  gtNow() { const w = this.view.world; return w.gt + (Date.now() + this.offset - w.at) / 1000 * this.speed; }
  exploredBit() { return 1; }   // kein Nebel: die ganze Karte ist sichtbar

  /* ---------- Laden ---------- */
  load(data) {
    const map = generateMap(data.seed); this.map = map; this.seed = data.seed;
    this.roads = new Float32Array(G * G); this.roadCells = new Uint8Array(N * N); this.roadSig = '';
    this.matVC = new T.MeshLambertMaterial({ vertexColors: true });
    this.matTerr = new T.MeshLambertMaterial({ vertexColors: true });
    this.matTerr.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWP;
float zh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float zn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(zh(i),zh(i+vec2(1.,0.)),f.x), mix(zh(i+vec2(0.,1.)),zh(i+vec2(1.,1.)),f.x), f.y); }`).replace('#include <color_fragment>', `#include <color_fragment>
{ vec2 p = vWP.xz; float a = zn(p*2.3)*.5 + zn(p*6.1)*.3 + zn(p*17.0)*.2; float bl = zn(vec2(p.x*38.0, p.y*7.0)) * zn(vec2(p.x*5.0, p.y*41.0));
  float g = clamp(diffuseColor.g*2.2 - diffuseColor.r*1.2 - diffuseColor.b*.6, 0.0, 1.0);
  diffuseColor.rgb *= .84 + a*.3 + g*(bl-.25)*.22; diffuseColor.rg += vec2(.012,.02)*g*a; }`);
    };
    this.buildTerrain(map); this.buildWater(); this.buildTrees(map); this.buildObjects(map);
    this.territory = new T.Group(); this.scene.add(this.territory); this.preview = null; this.terrAt = 0; this.terrDirty = true;
    this.ringMesh = new T.Mesh(new T.RingGeometry(.9, 1.0, 40), new T.MeshBasicMaterial({ color: 0xf0d98a, transparent: true, opacity: .95, side: T.DoubleSide, depthTest: false }));
    this.ringMesh.rotation.x = -Math.PI / 2; this.ringMesh.renderOrder = 20; this.ringMesh.visible = false; this.scene.add(this.ringMesh);
    this.routeGeo = new T.BufferGeometry(); this.routeGeo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(3 * 1200), 3)); this.routeGeo.setDrawRange(0, 0);
    this.routeCol = new T.Color(1, 1, 1);
    this.routePts = new T.Points(this.routeGeo, new T.PointsMaterial({ size: 5, sizeAttenuation: false, color: 0xffffff, depthTest: false, transparent: true, opacity: .95 })); this.routePts.renderOrder = 15; this.routePts.frustumCulled = false; this.scene.add(this.routePts);
    const NS = 320; this.smokeN = NS; const sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.BufferAttribute(new Float32Array(NS * 3), 3)); sg.setAttribute('aA', new T.BufferAttribute(new Float32Array(NS), 1)); sg.setAttribute('aS', new T.BufferAttribute(new Float32Array(NS), 1));
    this.smokeMat = new T.ShaderMaterial({ vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } } });
    this.smoke = new T.Points(sg, this.smokeMat); this.smoke.frustumCulled = false; this.smoke.renderOrder = 5; this.scene.add(this.smoke);
    this.cam.x = this.cam.z = N / 2; this.updateCamera();
  }
  buildTerrain(map) {
    const H = map.H, F = map.F, seed = map.seed, n = G * G;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const at = (x, y) => H[clamp(y, 0, G - 1) * G + clamp(x, 0, G - 1)];
    const C = { sand: [220, 202, 148], g1: [104, 152, 64], g2: [78, 126, 52], olive: [136, 142, 72], rock: [132, 122, 106], rock2: [98, 92, 86], snow: [240, 244, 250], forest: [44, 86, 44], dirt: [156, 128, 90], dsand: [150, 150, 120], dwater: [38, 90, 112] };
    const pads = { start: [[118, 104, 78], 2.3, .6], camp: [[112, 94, 68], 2.2, .7], ruin: [[112, 106, 90], 1.9, .55], sanct: [[205, 200, 184], 2.4, .8], throne: [[190, 180, 150], 3.4, .8], tower: [[170, 164, 148], 3.0, .8] };
    const pre = new Float32Array(n * 3), nz3 = new Float32Array(n), ao = new Float32Array(n);
    this.tv = { pre, nz3, ao, col, C, pads, map };
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      const i = gy * G + gx, x = gx / SUB, y = gy / SUB, h = H[i];
      pos[i * 3] = x; pos[i * 3 + 1] = terrY(h); pos[i * 3 + 2] = y;
      const hx = at(gx + 1, gy) - at(gx - 1, gy), hy = at(gx, gy + 1) - at(gx, gy - 1), slope = Math.hypot(hx, hy);
      const avg = (at(gx - 2, gy) + at(gx + 2, gy) + at(gx, gy - 2) + at(gx, gy + 2)) / 4;
      ao[i] = 1 - clamp((avg - h) * 5, 0, .2);
      const n1 = fbm(x * .33, y * .33, seed + 7, 3), n2 = vnoise(x * 1.7, y * 1.7, seed + 9), n3 = vnoise(x * 5, y * 5, seed + 21), t = h - SEA;
      let c = mixc(C.g1, C.g2, n1);
      c = mixc(c, C.olive, smooth(.38, .75, n2) * .38);
      c = mixc(c, C.sand, 1 - smooth(0, .05 + n2 * .018, t));
      const rockW = Math.max(smooth(.5, .66, h + (n2 - .5) * .06), smooth(.38, 1.0, slope) * .85);
      c = mixc(c, mixc(C.rock, C.rock2, n3), rockW);
      const snowW = smooth(.8, .9, h + (n2 - .5) * .07) * (1 - smooth(.9, 1.5, slope) * .55);
      c = mixc(c, C.snow, snowW);
      const fw = smooth(.5, .6, F[i]) * (h < .62 ? 1 : 0) * (1 - smooth(.4, .9, slope) * .4);
      c = mixc(c, mixc(C.forest, [58, 100, 48], n2), fw * .86);
      if (h < SEA) c = mixc(C.sand, C.dwater, smooth(0, .22, SEA - h));
      pre[i * 3] = c[0]; pre[i * 3 + 1] = c[1]; pre[i * 3 + 2] = c[2]; nz3[i] = n3;
      this.paintVertex(i, 0);
    }
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      const i = gy * G + gx, yl = pos[(gy * G + Math.max(0, gx - 1)) * 3 + 1], yr = pos[(gy * G + Math.min(G - 1, gx + 1)) * 3 + 1], yu = pos[(Math.max(0, gy - 1) * G + gx) * 3 + 1], yd = pos[(Math.min(G - 1, gy + 1) * G + gx) * 3 + 1];
      const dx = (yr - yl) / (2 / SUB), dz = (yd - yu) / (2 / SUB), l = Math.hypot(dx, 1, dz);
      nor[i * 3] = -dx / l; nor[i * 3 + 1] = 1 / l; nor[i * 3 + 2] = -dz / l;
    }
    this.posAttr = new T.BufferAttribute(pos, 3); this.colAttr = new T.BufferAttribute(col, 3); this.norAttr = new T.BufferAttribute(nor, 3);
    this.chunks = [];
    const nc = N / CH;
    for (let cy = 0; cy < nc; cy++) for (let cx = 0; cx < nc; cx++) {
      const x0 = cx * CH * SUB, y0 = cy * CH * SUB, x1 = Math.min(G - 1, (cx + 1) * CH * SUB), y1 = Math.min(G - 1, (cy + 1) * CH * SUB), idx = [];
      for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) {
        const a = gy * G + gx, b = a + 1, c = a + G, d = c + 1;
        if ((gx + gy) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', this.posAttr); g.setAttribute('color', this.colAttr); g.setAttribute('normal', this.norAttr); g.setIndex(idx);
      let ymax = 0; for (let gy = y0; gy <= y1; gy += 4) for (let gx = x0; gx <= x1; gx += 4) ymax = Math.max(ymax, pos[(gy * G + gx) * 3 + 1]);
      g.boundingSphere = new T.Sphere(new T.Vector3((cx + .5) * CH, ymax / 2, (cy + .5) * CH), CH * .72 + ymax / 2);
      const m = new T.Mesh(g, this.matTerr); m.receiveShadow = true; this.scene.add(m); this.chunks.push(m);
    }
    this.hilite = this.matVC;
  }
  // Farbe eines Gitterpunkts: Boden, darüber Weg und Plätze
  paintVertex(i, rw) {
    const { pre, nz3, ao, col, C, pads, map } = this.tv, x = (i % G) / SUB, y = Math.floor(i / G) / SUB, n3 = nz3[i];
    let c = [pre[i * 3], pre[i * 3 + 1], pre[i * 3 + 2]];
    if (rw > 0) c = mixc(c, mixc(C.dirt, [132, 104, 70], n3), rw * .78);
    const bk = this.tv.bk || (this.tv.bk = (() => { const m = new Map(); for (const o of map.objects) { if (!pads[o.k]) continue; const key = (o.x >> 3) * 1000 + (o.y >> 3); (m.get(key) || m.set(key, []).get(key)).push(o); } return m; })());
    const near = [], bx = Math.floor(x / 8), by = Math.floor(y / 8);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const l = bk.get((bx + dx) * 1000 + by + dy); if (l) for (const o of l) near.push(o); }
    for (const o of near) {
      const pd = pads[o.k]; if (!pd) continue;
      const d = Math.hypot(x - o.x - .5, y - o.y - .5); if (d > pd[1]) continue;
      c = mixc(c, mixc(pd[0], [pd[0][0] * .9, pd[0][1] * .9, pd[0][2] * .9], n3), (1 - smooth(pd[1] * .5, pd[1], d)) * pd[2]);
    }
    const s = ao[i];
    col[i * 3] = LIN(c[0] * s * (.94 + .12 * n3)); col[i * 3 + 1] = LIN(c[1] * s * (.94 + .12 * n3)); col[i * 3 + 2] = LIN(c[2] * s * (.94 + .12 * n3));
  }
  buildWater() {
    const H = this.map.H, n = G * G, wp = new Float32Array(n * 3), dp = new Float32Array(n), idx = [];
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) { const i = gy * G + gx; wp[i * 3] = gx / SUB; wp[i * 3 + 1] = 0; wp[i * 3 + 2] = gy / SUB; dp[i] = (SEA - H[i]) / .22; }
    for (let gy = 0; gy < G - 1; gy++) for (let gx = 0; gx < G - 1; gx++) {
      const a = gy * G + gx, b = a + 1, c = a + G, d = c + 1;
      if (dp[a] < -.12 && dp[b] < -.12 && dp[c] < -.12 && dp[d] < -.12) continue;
      idx.push(a, c, b, b, c, d);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(wp, 3)); g.setAttribute('aDepth', new T.BufferAttribute(dp, 1)); g.setIndex(idx); g.boundingSphere = new T.Sphere(new T.Vector3(N / 2, 0, N / 2), N);
    this.waterMat = new T.ShaderMaterial({ vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true, depthWrite: false, fog: true, uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { uTime: { value: 0 } }]) });
    const m = new T.Mesh(g, this.waterMat); m.position.y = -.01; m.renderOrder = 1; this.scene.add(m);
    const sea = new T.Mesh(new T.PlaneGeometry(2400, 2400), new T.MeshBasicMaterial({ color: new T.Color().setRGB(LIN(14), LIN(66), LIN(98)), fog: true }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(N / 2, -.4, N / 2); this.scene.add(sea);
  }
  buildTrees(map) {
    const seed = map.seed, blocked = new Uint8Array(N * N);
    for (const o of map.objects) {
      const r = o.k === 'throne' ? 4 : o.k === 'tower' ? 4 : o.k === 'start' ? 5.5 : o.k === 'sanct' ? 3 : 1.9;
      for (let y = Math.floor(o.y - r); y <= o.y + r; y++) for (let x = Math.floor(o.x - r); x <= o.x + r; x++) { if (x < 0 || y < 0 || x >= N || y >= N) continue; if (Math.hypot(x - o.x, y - o.y) <= r) blocked[y * N + x] = 1; }
    }
    const lists = {};   // "kind|chunk" -> [[x,y,s,rot,cell,variant]]
    const addT = (kind, x, y, s, cell, vr) => { const k = kind + '|' + Math.floor(x / CH) + ',' + Math.floor(y / CH); (lists[k] = lists[k] || []).push([x, y, s, hash(Math.floor(x * 9), Math.floor(y * 9), seed + 31) * 6.28, cell, vr]); };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = y * N + x; if (blocked[c]) continue;
      const h = this.hAt(x + .5, y + .5); if (h < SEA + .03) continue;
      const pass = map.pass[c], f = map.F[(y * SUB + 1) * G + x * SUB + 1], r = hash(x, y, seed), vr = hash(x, y, seed + 40);
      if (pass === 2 && h < .64) {
        const cnt = r > .3 ? 1 + (r > .8 ? 1 : 0) : 0;
        for (let i = 0; i < cnt; i++) {
          const a = hash(x * 7 + i, y * 3, seed + 5), b = hash(x * 5, y * 11 + i, seed + 6), kind = hash(x + i, y - i, seed + 8), sc = (.9 + hash(x, y + i, seed + 12) * .5) * 1.25;
          addT(h > .5 || kind > .55 ? 'pine' : 'oak', x + .1 + a * .8, y + .1 + b * .8, sc, c, hash(x + i, y, seed + 44));
        }
      } else if (pass === 1 && h < .6) {
        if (r < (f > .45 ? .08 : .02)) addT(hash(x, y, seed + 3) > .5 ? 'oak' : 'pine', x + .2 + hash(x, y, seed + 5) * .6, y + .2 + hash(x, y, seed + 6) * .6, (.85 + hash(x, y, seed + 7) * .4) * 1.2, c, vr);
        else if (r > .965) addT('bush', x + .5, y + .5, 1.3, c, vr);
        else if (r > .955) addT('rock', x + .5, y + .5, 1.2, c, vr);
      } else if (pass === 0 && h > .56) {
        if (r < .4) addT(h > .64 ? 'snow' : 'pine', x + .2 + hash(x, y, seed + 5) * .6, y + .2 + hash(x, y, seed + 6) * .6, 1.2, c, vr);
        else if (r < .62) addT('rock', x + .3 + hash(x, y, seed + 5) * .4, y + .3 + hash(x, y, seed + 6) * .4, h > .74 ? 2.4 : 1.7, c, vr);
      }
    }
    const geos = { pine: treeGeo('pine'), snow: treeGeo('snow'), oak: treeGeo('oak'), bush: treeGeo('bush'), rock: treeGeo('rock') };
    const mat = new T.MeshLambertMaterial({ vertexColors: true }), tmp = new T.Matrix4(), col = new T.Color(), q = new T.Quaternion(), e = new T.Euler();
    const GREENS = { pine: [[36, 84, 48], [44, 98, 56], [30, 74, 50]], oak: [[84, 140, 52], [100, 152, 58], [70, 124, 50]], bush: [[76, 120, 56], [92, 134, 60], [66, 108, 52]], snow: [[255, 255, 255], [236, 244, 246], [248, 250, 252]], rock: [[146, 140, 128], [120, 114, 106], [162, 156, 142]] };
    this.treeChunks = []; this.nTrees = 0;
    for (const key in lists) {
      const [kind, cc] = key.split('|'), arr = lists[key], im = new T.InstancedMesh(geos[kind], mat, arr.length);
      let cx = 0, cz = 0, mx = 0;
      arr.forEach((a, i) => {
        const [x, y, s, rot, , vr] = a, yy = this.yAt(x, y); q.setFromEuler(e.set(0, rot, 0));
        tmp.compose(new T.Vector3(x, yy - .02, y), q, new T.Vector3(s, s * (.9 + vr * .3), s)); im.setMatrixAt(i, tmp);
        const g = GREENS[kind][Math.floor(vr * 2.999)]; col.setRGB(LIN(g[0]), LIN(g[1]), LIN(g[2])); im.setColorAt(i, col); cx += x; cz += y; mx = Math.max(mx, yy);
      });
      im.castShadow = kind !== 'bush'; im.frustumCulled = false; im.userData = { cx: cx / arr.length, cz: cz / arr.length, cy: mx / 2, list: arr, kind };
      this.scene.add(im); this.treeChunks.push(im); this.nTrees += arr.length;
    }
    this.treeTmp = { tmp, q, e };
  }
  // Bäume rund um eine neue Burg entfernen
  clearTrees(x, y, r) {
    const z = new T.Matrix4().makeScale(0, 0, 0);
    for (const im of this.treeChunks) {
      const u = im.userData; if (Math.hypot(u.cx - x, u.cz - y) > CH * 1.2) continue; let ch = false;
      u.list.forEach((a, i) => { if (!a.gone && Math.hypot(a[0] - x, a[1] - y) < r) { im.setMatrixAt(i, z); a.gone = true; ch = true; } });
      if (ch) im.instanceMatrix.needsUpdate = true;
    }
  }
  // Bäume auf Wegen entfernen
  hideTreesOnRoads() {
    const z = new T.Matrix4().makeScale(0, 0, 0), m = new T.Matrix4(), { q, e } = this.treeTmp;
    for (const im of this.treeChunks) {
      const arr = im.userData.list; let ch = false;
      arr.forEach((a, i) => {
        const gone = this.roadCells[a[4]] === 1;
        if (gone && !a.gone) { im.setMatrixAt(i, z); a.gone = true; ch = true; }
      });
      if (ch) im.instanceMatrix.needsUpdate = true;
    }
    void m; void q; void e;
  }

  /* ---------- Objekte ---------- */
  buildObjects(map) {
    this.models = {}; const M = this.models;
    M.slot = buildSlot(); M.throne = buildThrone(); M.tower = buildTower(); M.sanct = buildSanct(); M.outpost = buildOutpost(); M.campAlive = buildCamp(false); M.campDead = buildCamp(true); M.ruin = buildRuin(false); M.ruinDone = buildRuin(true); M.depleted = buildDepleted();
    for (const k of ['farm', 'wood', 'stone']) M[k] = { farm: buildFarm, wood: buildWood, stone: buildStone }[k]();
    M.stoneV = [buildStone(1, 0), buildStone(1, 1), buildStone(1, 2)];
    this.unitGeos = {}; this.castleCache = {}; this.smokeList = [];
    this.flagGeo = new T.PlaneGeometry(.7, .42, 6, 2); this.flagGeo.translate(.35, 0, 0);
    this.fireGeo = new T.ConeGeometry(.2, .55, 6); this.fireMat = new T.MeshBasicMaterial({ color: 0xffb040 });
    this.glowMat = new T.MeshBasicMaterial({ color: 0x9fe2ff, transparent: true, opacity: .85 });
    const mesh = (model, mat) => { const m = new T.Mesh(model.geo, mat || this.matVC); m.castShadow = true; m.receiveShadow = true; return m; };
    this.mesh = mesh;
    for (const o of map.objects) {
      const hd = { o, grp: new T.Group(), flags: [], vis: true }; this.obj[o.id] = hd;
      const g = hd.grp, y = this.baseY(o.x + .5, o.y + .5, o.k === 'throne' || o.k === 'tower' ? 2.5 : o.k === 'start' ? 2 : 1.0);
      g.position.set(o.x + .5, y, o.y + .5); g.rotation.y = ['start', 'throne', 'sanct', 'tower'].includes(o.k) ? 0 : hash(o.x, o.y, 3) * .5 - .25;
      if (o.k === 'start') { hd.slot = mesh(M.slot); g.add(hd.slot); hd.castle = null; }
      else if (o.k === 'camp') { hd.alive = mesh(M.campAlive); hd.deadM = mesh(M.campDead); hd.deadM.visible = false; g.add(hd.alive, hd.deadM); this.attachParts(hd, M.campAlive); hd.smokeOffs = M.campAlive.smoke; }
      else if (o.k === 'ruin') { hd.alive = mesh(M.ruin); hd.deadM = mesh(M.ruinDone); hd.deadM.visible = false; g.add(hd.alive, hd.deadM); }
      else {
        const mdl = o.k === 'stone' ? M.stoneV[Math.floor(hash(o.x, o.y, 9) * M.stoneV.length)] : M[o.k]; hd.main = mesh(mdl); g.add(hd.main);
        if (NODE_K.includes(o.k)) { hd.emptyM = mesh(M.depleted); hd.emptyM.visible = false; g.add(hd.emptyM); }
        if (['farm', 'wood', 'stone'].includes(o.k)) { const k = .95 + .05 * o.lv; g.scale.setScalar(k); }
        if (o.k === 'sanct') { hd.glow = new T.Mesh(new T.OctahedronGeometry(.42), this.glowMat); hd.glow.position.set(0, 2.9, 0); g.add(hd.glow); }
        if (o.k === 'tower') { this.attachParts(hd, M.tower); hd.smokeOffs = M.tower.smoke; }
        if (o.k === 'throne') { this.addFlags(hd, M.throne.flags, 0xe9c860); this.attachParts(hd, M.throne); hd.smokeOffs = M.throne.smoke; }
        if (o.k === 'wood') hd.smokeOffs = M.wood.smoke;
      }
      if (SKIRT[o.k]) { const [sc, r] = SKIRT[o.k], sb = new MB(); sb.cyl(r * .96, r * 1.22, 3.2, 14, 0, -3.1, 0, sc, .06); sb.cyl(r * .99, r * .99, .08, 14, 0, -.06, 0, mul(sc, 1.06), .04); const sm = new T.Mesh(sb.build(), this.matVC); sm.receiveShadow = true; g.add(sm); }
      this.scene.add(g);
    }
  }
  attachParts(hd, mdl) {
    hd.flames = hd.flames || [];
    for (const p of mdl.parts || []) if (p.k === 'flame') { const f = new T.Mesh(this.fireGeo, this.fireMat); f.position.set(...p.pos); f.scale.setScalar(p.s || 1); f.userData.s = p.s || 1; hd.grp.add(f); hd.flames.push(f); }
  }
  addFlags(hd, pts, color) {
    for (const p of pts) {
      const m = new T.Mesh(this.flagGeo.clone(), new T.MeshLambertMaterial({ color, side: T.DoubleSide })); m.position.set(p[0], p[1], p[2]); m.userData.base = m.geometry.attributes.position.array.slice();
      hd.grp.add(m); hd.flags.push(m);
    }
  }
  setFlagColor(hd, col) { for (const f of hd.flags) f.material.color.setRGB(LIN(col >> 16 & 255), LIN(col >> 8 & 255), LIN(col & 255)); }
  castleModel(tier, v) { const k = tier + ':' + v; return this.castleCache[k] || (this.castleCache[k] = buildCastle(tier, v)); }
  waveFlags(list, t) {
    for (const f of list) {
      if (!f.visible) continue;
      const a = f.geometry.attributes.position, b = f.userData.base;
      for (let i = 0; i < a.count; i++) { const x = b[i * 3]; a.array[i * 3 + 2] = Math.sin(t * 4 + x * 5 + f.position.x) * .1 * x; a.array[i * 3 + 1] = b[i * 3 + 1] - x * .06; }
      a.needsUpdate = true;
    }
  }

  /* ---------- Zustand vom Server ---------- */
  sync(view, myId, offset) {
    this.view = view; this.myId = myId; this.offset = offset || 0; this.speed = view.match.speed;
    const bySlot = {}; for (const p of view.match.players) bySlot[p.slot] = p;
    for (const id in this.obj) {
      const h = this.obj[id], o = h.o;
      if (o.k !== 'start') continue;
      const p = bySlot[o.slot], tier = p ? (p.rathaus >= 14 ? 3 : p.rathaus >= 7 ? 2 : 1) : 0;
      if (p && p.pos && (p.pos[0] !== o.x || p.pos[1] !== o.y)) this.moveStart(h, p.pos[0], p.pos[1]);
      h.player = p || null; h.tier = tier;
      const nm = p ? tier + ':' + (p.slot % 10) : 'slot';
      if (h.nm !== nm) {
        h.nm = nm;
        if (h.castle) { h.grp.remove(h.castle); h.castle = null; }
        for (const f of h.flags) h.grp.remove(f); h.flags = [];
        h.slot.visible = !p;
        if (p) { const mdl = this.castleModel(tier, p.slot % 10); h.castle = this.mesh(mdl); h.grp.add(h.castle); this.addFlags(h, mdl.flags, 0xffffff); h.h = mdl.h; h.smokeOffs = mdl.smoke; h.smokeOn = true; } else { h.smokeOffs = null; }
      }
      if (p) this.setFlagColor(h, parseInt(PLAYER_COLORS[p.slot % 10].slice(1), 16));
    }
    const gt = this.gtNow();
    for (const id in this.obj) {
      const h = this.obj[id], o = h.o;
      if (o.k === 'camp') { const dead = (view.world.camps[id] || 0) > gt; h.isDead = dead; h.alive.visible = !dead; h.deadM.visible = dead; for (const f of h.flames) f.visible = !dead; h.smokeOn = !dead; }
      if (o.k === 'ruin') { const done = !!view.world.ruins[id]; h.isDead = done; h.alive.visible = !done; h.deadM.visible = done; }
      if (NODE_K.includes(o.k)) { const max = 3000 * o.lv, left = view.world.nodes[id] == null ? max : view.world.nodes[id], empty = left < 50; h.frac = left / max; h.empty = empty; h.main.visible = !empty; h.emptyM.visible = empty; if (o.k === 'wood') h.smokeOn = !empty; const k = (.95 + .05 * o.lv) * (empty ? 1 : (.62 + .38 * Math.min(1, h.frac * 2))); h.grp.scale.set(k, k, k); }
    }
    this.rebuildLabels(view);
    this.syncOutposts(view);
    const eg = this.roadEdges(view), sg = JSON.stringify(eg); if (sg !== this.roadSig) { this.roadSig = sg; this.setRoads(eg); }
    this.syncMarches(view);
    this.smokeList = []; for (const id in this.obj) { const h = this.obj[id]; if (h.smokeOffs && h.smokeOn !== false) for (const off of h.smokeOffs) this.smokeList.push({ h, off }); }
    this.dirtyLabels = true;
  }
  // Burg an einen neuen Ort setzen (Teleporter)
  moveStart(h, x, y) {
    const o = h.o; o.x = x; o.y = y; this.tv.bk = null; h.grp.position.set(x + .5, this.baseY(x + .5, y + .5, 2), y + .5); this.clearTrees(x + .5, y + .5, 4.6);
    if (h.lab) { h.lab.el.style.display = 'none'; }
    this.terrDirty = true; this.dirtyLabels = true;
  }
  roadEdges(view) { return roadEdgesOf(view.match.alliances || [], towersOf(this.map), view.world.outposts || [], this.gtNow()); }
  setRoads(edges) {
    const map = this.map, mask = new Float32Array(G * G), paths = roadPaths(map, edges);
    const splat = (x, y) => {
      const gx = x * SUB, gy = y * SUB, r = 1.5;
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
        const ix = Math.round(gx) + ox, iy = Math.round(gy) + oy; if (ix < 0 || iy < 0 || ix >= G || iy >= G) continue;
        const d = Math.hypot(ix - gx, iy - gy) / r, w = 1 - smooth(.35, 1, d);
        if (w > mask[iy * G + ix]) mask[iy * G + ix] = w;
      }
    };
    for (const p of paths) {
      let px = null, py = null;
      for (const c of p) {
        const [x, y] = cellXY(c), cx = x + .5, cy = y + .5;
        if (px !== null) for (let k = 0; k < 4; k++) splat(px + (cx - px) * k / 4, py + (cy - py) * k / 4);
        splat(cx, cy); px = cx; py = cy;
      }
    }
    setMapRoads(map, paths);
    const old = this.roads; this.roads = mask;
    for (let i = 0; i < mask.length; i++) if (mask[i] !== old[i]) this.paintVertex(i, mask[i]);
    const cells = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (mask[(y * SUB + 1) * G + x * SUB + 1] > .5) cells[y * N + x] = 1;
    this.roadCells = cells; this.colAttr.needsUpdate = true; this.hideTreesOnRoads();
  }

  /* ---------- Beschriftungen (HTML über der Karte) ---------- */
  labelEl(key, make) { let l = this.labels && this.labels[key]; if (!l) { (this.labels = this.labels || {})[key] = l = make(); } return l; }
  mkBadge(text, color) {
    const el = document.createElement('div'); el.className = 'mapbadge'; el.textContent = text; el.style.background = '#' + color.toString(16).padStart(6, '0'); this.labelsEl.appendChild(el);
    return { el, text, color, x: 0, y: 0, z: 0, sx: 1 };
  }
  setBadge(l, text, color, bar) {
    if (l.text !== text) { l.text = text; l.el.textContent = text; }
    if (l.color !== color) { l.color = color; l.el.style.background = '#' + color.toString(16).padStart(6, '0'); }
    void bar;
  }
  rebuildLabels(view) {
    const RES_COL = { farm: 0xb58a22, wood: 0x7b5630, stone: 0x6b6f75 };
    for (const id in this.obj) {
      const h = this.obj[id], o = h.o; let txt = null, col = 0x333333, up = 1.6;
      if (o.k === 'start' && h.player) {
        const pl = h.player, al = pl.ally && (view.match.alliances || []).find(a => a.id === pl.ally), gt = this.gtNow();
        txt = (al ? '[' + al.tag + '] ' : '') + pl.name; col = parseInt(PLAYER_COLORS[pl.slot % 10].slice(1), 16); up = (h.h || 4) + .5;
        if (pl.id === this.myId) txt = '★ ' + txt;
        if (pl.out) { txt = '✖ ' + txt; col = 0x4a4036; }
        else if (pl.vassalOf) txt += ' (Vasall)';
        else if (pl.protUntil > gt) txt = '🛡 ' + txt;
        if (h.castle) h.castle.visible = true;
      }
      else if (['farm', 'wood', 'stone'].includes(o.k)) { txt = h.empty ? 'leer' : String(o.lv); col = h.empty ? 0x7a6a55 : RES_COL[o.k]; up = h.empty ? 1.2 : 2.0; }
      else if (o.k === 'camp') { txt = h.isDead ? null : String(o.lv); col = 0x8a2b24; up = 2.4; }
      else if (o.k === 'ruin') { txt = h.isDead ? 'Ruine (geplündert)' : 'Ruine ' + o.lv; col = 0x5a4a6e; up = 2.2; }
      else if (o.k === 'tower') { txt = 'Turm'; col = 0x5a6070; up = 19; }
      else if (o.k === 'sanct' || o.k === 'throne') {
        const hd = (view.match.holds || []).find(x => x.id === id);
        txt = (o.k === 'sanct' ? 'Heiligtum' : 'Der Thron') + (hd ? ' · ' + hd.label : '');
        col = hd ? (hd.mine ? 0x2f7f3a : 0x8a2b24) : o.k === 'sanct' ? 0x2f6f8f : 0x9c7420; up = o.k === 'sanct' ? 3.6 : 27;
      }
      if (txt !== null && !SHOW_NAMES && !/^\d+$/.test(txt) && o.k !== 'start') txt = null;
      if (txt === null) { if (h.lab) h.lab.el.style.display = 'none'; h.labOn = false; continue; }
      if (!h.lab) h.lab = this.mkBadge(txt, col); this.setBadge(h.lab, txt, col);
      h.lab.up = up; h.labOn = true;
    }
  }
  projectLabels() {
    const v = new T.Vector3(), W = this.W, H = this.H, cam = this.camera;
    const place = (l, x, y, z, scaleBase) => {
      v.set(x, y, z).project(cam);
      const on = v.z < 1 && v.x > -1.15 && v.x < 1.15 && v.y > -1.15 && v.y < 1.15;
      if (!on) { if (l.vis !== false) { l.el.style.display = 'none'; l.vis = false; } return false; }
      if (l.vis !== true) { l.el.style.display = 'block'; l.vis = true; }
      const sx = (v.x * .5 + .5) * W, sy = (-v.y * .5 + .5) * H, k = clamp(scaleBase, .6, 1.25);
      l.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-100%) scale(${k.toFixed(2)})`; return true;
    };
    const dist = this.cam.dist, sb = clamp(70 / dist, .55, 1.2);
    for (const id in this.obj) {
      const h = this.obj[id]; if (!h.lab || !h.labOn) continue;
      const o = h.o, show = dist < 78 || o.k === 'start' || o.k === 'throne' || o.k === 'tower';
      if (!show) { h.lab.el.style.display = 'none'; h.lab.vis = false; continue; }
      place(h.lab, o.x + .5, h.grp.position.y + h.lab.up * h.grp.scale.y, o.y + .5, sb);
    }
    for (const id in this.marchObjs) {
      const s = this.marchObjs[id]; if (!s.lab) continue;
      if (!s.grp.visible) { s.lab.el.style.display = 'none'; s.lab.vis = false; continue; }
      place(s.lab, s.grp.position.x, s.grp.position.y + 1.5, s.grp.position.z, sb * .9);
    }
  }

  /* ---------- Heere ---------- */
  unitGeo(type, col, full) { const k = type + col + (full ? 'F' : ''); return this.unitGeos[k] || (this.unitGeos[k] = buildUnit(type, hexRGB(col), full)); }
  // Beschriftung über dem Heer: Zahl der Einheiten und – wie in Rise of Kingdoms – die Restzeit bzw. der Sammelfortschritt
  badgeTxt(s, gt) {
    const m = s.m, sp = this.view.match.speed || 1; let x = '';
    const f = sec => { sec = Math.max(0, Math.ceil(sec)); const h = Math.floor(sec / 3600), mi = Math.floor(sec % 3600 / 60), se = sec % 60; return h ? h + ':' + String(mi).padStart(2, '0') + ':' + String(se).padStart(2, '0') : mi + ':' + String(se).padStart(2, '0'); };
    if (m.phase === 'out' || m.phase === 'back') x = ' · ' + f((m.t0 + m.arr[m.arr.length - 1] - gt) / sp);
    else if (m.phase === 'gather' && m.tEnd > m.tStart) x = ' · ' + Math.round(Math.max(0, Math.min(1, (gt - m.tStart) / (m.tEnd - m.tStart))) * 100) + ' %';
    return s.pre + x;
  }
  syncMarches(view) {
    const keep = new Set();
    for (const m of view.world.marches) {
      keep.add(m.id); let s = this.marchObjs[m.id];
      const col = parseInt(PLAYER_COLORS[(m.slot < 0 ? 0 : m.slot) % 10].slice(1), 16);
      const tr = m.troops || {}; let n = 0;
      const ORDER = ['leicht', 'schwer', 'speer', 'schwert', 'bogen', 'armbrust', 'handkarren'], kinds = [];
      for (const u of ORDER) if (tr[u] > 0) { n += tr[u]; kinds.push([u, u === 'handkarren' ? tr[u] * .05 : tr[u]]); }
      if (tr.n != null) { n = tr.n; kinds.length = 0; kinds.push(['speer', n]); }
      if (!kinds.length) kinds.push(['speer', 1]);
      if (!n) n = Object.values(tr).reduce((a, c) => a + c, 0);
      const total = clamp(Math.ceil(n / 25), kinds.length, 8), W = kinds.reduce((a, k) => a + k[1], 0), cntOf = kinds.map(() => 1);
      for (let r = total - kinds.length; r > 0; r--) { let bi = 0, bv = -1; kinds.forEach((k, ki) => { const v = k[1] / W * total - cntOf[ki]; if (v > bv) { bv = v; bi = ki; } }); cntOf[bi]++; }
      const figs = []; kinds.forEach((k, ki) => { for (let c = 0; c < cntOf[ki]; c++) figs.push(k[0]); });
      const loaded = !!(m.own && m.load && Object.values(m.load).some(v => v > 0)), sig = figs.join(',') + col + (loaded ? 'F' : '');
      if (!s) {
        const grp = new T.Group(); this.scene.add(grp);
        s = this.marchObjs[m.id] = { grp, units: [], lab: this.mkBadge('', 0x2a2f38) }; s.lab.el.classList.add('march');
      }
      s.m = m; s.col = col;
      if (s.sig !== sig) {
        s.sig = sig; s.dOk = false; for (const u of s.units) s.grp.remove(u.g); s.units = [];
        const rows = []; for (let k = 0; k < figs.length; k += 3) rows.push(figs.slice(k, k + 3));
        rows.forEach((row, r) => row.forEach((type, c) => {
          const cav = type === 'leicht' || type === 'schwer', ug = this.unitGeo(type, col, type === 'handkarren' && loaded), g = new T.Group(), body = new T.Mesh(ug.body, this.matVC); body.castShadow = true; g.add(body);
          const mk = geo => { if (!geo) return null; const l = new T.Mesh(geo, this.matVC); l.position.y = ug.hip; l.castShadow = true; g.add(l); return l; };
          const sp = cav ? .62 : .5, x = (c - (row.length - 1) / 2) * sp, z = .35 - r * (cav ? .75 : .55);
          g.position.set(x, 0, z); g.scale.setScalar(type === 'leicht' || type === 'schwer' ? 1.1 : type === 'handkarren' ? 1.35 : cav ? 1.5 : VIK_FOOT.includes(type) ? 1.3 : 1.7); s.grp.add(g);
          const rr = (type === 'handkarren' ? .42 : cav ? .4 : .3) / g.scale.x, ring = new T.Mesh(new T.RingGeometry(rr * .86, rr, 28), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); ring.rotation.x = -Math.PI / 2; ring.position.y = .04 / g.scale.x; ring.renderOrder = 2; g.add(ring);
          s.units.push({ g, ring, rx: x, rz: z, k: s.units.length, sz: type === 'handkarren' ? 1.5 : cav ? .95 : .6, la: mk(ug.la), lb: mk(ug.lb), cav, legs: (ug.legs || []).map(L => { const m2 = new T.Mesh(L.g, this.matVC); m2.position.set(L.x, L.y, L.z); m2.castShadow = true; g.add(m2); return { m: m2, s: L.s, spin: L.spin }; }) });
        }));
      }
      for (const u of s.units) u.ring.material.color.setRGB(LIN(col >> 16 & 255), LIN(col >> 8 & 255), LIN(col & 255));
      s.pre = (m.own ? '' : m.name + ' · ') + (m.mode === 'attack' ? '⚔ ' : m.mode === 'station' ? '🛡 ' : m.phase === 'post' ? '⚑ ' : m.phase === 'back' ? '↩ ' : '') + n; s.lt = 0;
      this.setBadge(s.lab, this.badgeTxt(s, this.gtNow()), 0x2a2f38); s.lab.el.style.borderColor = '#' + col.toString(16).padStart(6, '0');
    }
    for (const id in this.marchObjs) if (!keep.has(Number(id))) { const s = this.marchObjs[id]; this.scene.remove(s.grp); s.lab.el.remove(); delete this.marchObjs[id]; }
  }


  /* ---------- Revier und Außenposten ---------- */
  rectList() {
    const v = this.view, gt = this.gtNow(), ops = v.world.outposts || [];
    return rectsOf(towersOf(this.map), ops, gt);
  }
  allyColor(alId, owner) { const a = (this.view.match.alliances || []).find(x => x.id === alId); return a && a.color ? parseInt(a.color.slice(1), 16) : this.ownerColor(owner); }
  ownerColor(pid) { const p = this.view.match.players.find(x => x.id === pid); return parseInt(PLAYER_COLORS[((p && p.slot) || 0) % 10].slice(1), 16); }
  // Fläche und Rand eines Rechtecks, dem Gelände folgend
  rectMesh(x0, y0, x1, y1, color, fillA, lineA, w) {
    const a = clamp(x0, 0, N), b = clamp(y0, 0, N), c = clamp(x1 + 1, 0, N), d = clamp(y1 + 1, 0, N), grp = new T.Group();
    const cols = Math.max(1, Math.round((c - a) * SUB)), rows = Math.max(1, Math.round((d - b) * SUB)), pos = [], idx = [], yo = .13;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { const x = a + (c - a) * i / cols, z = b + (d - b) * j / rows; pos.push(x, Math.max(0, this.yAt(x, z)) + yo, z); }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const p = j * (cols + 1) + i; idx.push(p, p + cols + 1, p + 1, p + 1, p + cols + 1, p + cols + 2); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const rgb = new T.Color().setRGB(LIN(color >> 16 & 255), LIN(color >> 8 & 255), LIN(color & 255));
    const fill = new T.Mesh(g, new T.MeshBasicMaterial({ color: rgb, transparent: true, opacity: fillA, depthWrite: false, side: T.DoubleSide })); fill.renderOrder = 2; grp.add(fill);
    const pts = []; const step = 1 / SUB;
    for (let x = a; x < c; x += step) pts.push([x, b]); for (let y = b; y < d; y += step) pts.push([c, y]); for (let x = c; x > a; x -= step) pts.push([x, d]); for (let y = d; y > b; y -= step) pts.push([a, y]);
    const rp = [], ri = [];
    pts.forEach((p, k) => { const q = pts[(k + 1) % pts.length], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * w / 2, nz = dx / l * w / 2;
      const y1 = Math.max(0, this.yAt(p[0], p[1])) + yo + .03, y2 = Math.max(0, this.yAt(q[0], q[1])) + yo + .03;
      const base = rp.length / 3; rp.push(p[0] - nx, y1, p[1] - nz, p[0] + nx, y1, p[1] + nz, q[0] - nx, y2, q[1] - nz, q[0] + nx, y2, q[1] + nz); ri.push(base, base + 1, base + 2, base + 1, base + 3, base + 2); });
    const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(rp, 3)); lg.setIndex(ri);
    const line = new T.Mesh(lg, new T.MeshBasicMaterial({ color: rgb, transparent: true, opacity: lineA, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: T.DoubleSide })); line.renderOrder = 3; grp.add(line);
    return grp;
  }
  unionMesh(rs, color, fillA, lineA, w) {   // Vereinigung mehrerer Vierecke derselben Gruppe: eine Fläche, nur der Außenrand
    const grp = new T.Group(), cov = new Uint8Array(N * N), yo = .13;
    for (const r of rs) for (let y = clamp(r.y0, 0, N - 1); y <= clamp(r.y1, 0, N - 1); y++) for (let x = clamp(r.x0, 0, N - 1); x <= clamp(r.x1, 0, N - 1); x++) cov[y * N + x] = 1;
    const has = (x, y) => x >= 0 && y >= 0 && x < N && y < N && cov[y * N + x] === 1, st = 1 / SUB, pos = [], idx = [], rp = [], ri = [];
    const H = (x, z) => Math.max(0, this.yAt(x, z)) + yo;
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
      if (!cov[cy * N + cx]) continue;
      for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) {
        const x0 = cx + i * st, z0 = cy + j * st, b = pos.length / 3;
        pos.push(x0, H(x0, z0), z0, x0 + st, H(x0 + st, z0), z0, x0, H(x0, z0 + st), z0 + st, x0 + st, H(x0 + st, z0 + st), z0 + st); idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
      const edge = (ax, az, bx, bz) => {
        const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz), nx = -dz / l * w / 2, nz = dx / l * w / 2;
        for (let k = 0; k < SUB; k++) {
          const px = ax + dx * k / SUB, pz = az + dz * k / SUB, qx = ax + dx * (k + 1) / SUB, qz = az + dz * (k + 1) / SUB, y1 = H(px, pz) + .03, y2 = H(qx, qz) + .03, b = rp.length / 3;
          rp.push(px - nx, y1, pz - nz, px + nx, y1, pz + nz, qx - nx, y2, qz - nz, qx + nx, y2, qz + nz); ri.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      };
      if (!has(cx, cy - 1)) edge(cx, cy, cx + 1, cy); if (!has(cx + 1, cy)) edge(cx + 1, cy, cx + 1, cy + 1);
      if (!has(cx, cy + 1)) edge(cx + 1, cy + 1, cx, cy + 1); if (!has(cx - 1, cy)) edge(cx, cy + 1, cx, cy);
    }
    const rgb = new T.Color().setRGB(LIN(color >> 16 & 255), LIN(color >> 8 & 255), LIN(color & 255));
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const fill = new T.Mesh(g, new T.MeshBasicMaterial({ color: rgb, transparent: true, opacity: fillA, depthWrite: false, side: T.DoubleSide })); fill.renderOrder = 2; grp.add(fill);
    const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(rp, 3)); lg.setIndex(ri);
    const line = new T.Mesh(lg, new T.MeshBasicMaterial({ color: rgb, transparent: true, opacity: lineA, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: T.DoubleSide })); line.renderOrder = 3; grp.add(line);
    return grp;
  }
  drawTerritory() {
    for (const g of this.terrObjs) { this.territory.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    this.terrObjs = []; if (!this.view) return;
    const mine = this.view.match.players.find(p => p.id === this.myId), myG = mine ? (mine.ally ? 'a' + mine.ally : 'p' + mine.id) : '';
    const buckets = new Map(), rl = this.rectList();
    const put = (r, rect) => { const on = !!(r.ready || r.off), key = r.group + '|' + (r.off ? 'o' : on ? 'r' : 'b'); let bk = buckets.get(key); if (!bk) buckets.set(key, bk = { r, on, rs: [] }); bk.rs.push(rect); };
    for (const r of rl) put(r, r);
    // Andock-Vierecke an Thron und Türmen: verbunden mit einem Bündnisrevier werden sie mit diesem zu einer Fläche (ohne Überlappung), sonst weiß
    const free = [];
    for (const th of this.map.objects.filter(o => o.k === 'throne' || o.k === 'tower' || o.k === 'sanct')) {
      const pad = dockPad(th), hit = rl.find(r => r.ready && r.group[0] === 'a' && touches([r], r.group, th.x, th.y, pad)), rect = { x0: th.x - pad, y0: th.y - pad, x1: th.x + pad, y1: th.y + pad };
      if (hit) put(hit, rect); else free.push(rect);
    }
    if (free.length) put({ group: 'free', ready: true, off: true }, free[0]), free.slice(1).forEach(f => put({ group: 'free', ready: true, off: true }, f));
    for (const { r, on, rs } of buckets.values()) {
      const col = r.off ? 0xffffff : r.group[0] === 'a' ? this.allyColor(Number(r.group.slice(1)), r.owner) : this.ownerColor(r.owner), me = r.group === myG;
      const g = this.unionMesh(rs, col, on ? (me ? .12 : .08) : .04, on ? .55 : .35, me ? .2 : .15); this.territory.add(g); this.terrObjs.push(g);
    }
    if (this.preview && !this.preview.ghost) {
      const p = this.preview, col = p.ok ? 0x6fe07a : 0xe0594a, g = this.rectMesh(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r, col, .24, .95, .36); this.territory.add(g); this.terrObjs.push(g);
    }
  }
  setPreview(p) {
    this.preview = p; this.terrDirty = true;
    if (this.ghost) this.ghost.visible = false;
    if (!p || !p.ghost) return;
    const h = Object.values(this.obj).find(q => q.o.k === 'start' && q.player && q.player.id === this.myId); if (!h || !h.castle) return;
    if (!this.ghost) { this.ghost = new T.Mesh(h.castle.geometry, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .62 })); this.scene.add(this.ghost); }
    const g = this.ghost; g.geometry = h.castle.geometry; g.position.set(p.x + .5, this.baseY(p.x + .5, p.y + .5, 2), p.y + .5); g.material.color.set(p.ok ? 0xb8ffc0 : 0xffa090); g.visible = true;
  }
  syncOutposts(view) {
    const ops = view.world.outposts || [], keep = new Set(), gt = this.gtNow();
    for (const o of ops) {
      keep.add(o.id); let s = this.opObjs[o.id];
      if (!s) {
        const grp = new T.Group(), mat = new T.MeshLambertMaterial({ vertexColors: true, transparent: true }), m = new T.Mesh(this.models.outpost.geo, mat); m.castShadow = true; grp.add(m);
        const hd = { grp, flags: [], mat }; this.addFlags(hd, this.models.outpost.flags, 0xffffff); this.scene.add(grp); s = this.opObjs[o.id] = hd;
      }
      s.o = o; s.grp.position.set(o.x + .5, this.baseY(o.x + .5, o.y + .5, .9), o.y + .5);
      this.setFlagColor(s, this.allyColor(o.al, o.owner)); s.mat.opacity = gt >= o.done ? 1 : .55; s.mat.needsUpdate = false;
    }
    for (const id in this.opObjs) if (!keep.has(id)) { this.scene.remove(this.opObjs[id].grp); delete this.opObjs[id]; }
    const sig = JSON.stringify([ops, view.match.players.map(p => p.id + ':' + p.rathaus + p.out + p.ally)]); if (sig !== this.terrSig) { this.terrSig = sig; this.terrDirty = true; }
  }

  /* ---------- Lichteffekt beim Teleportieren ---------- */
  teleportFx(from, to) {
    const mk = (x, z, colA, delay, rev) => {
      const y = this.baseY(x + .5, z + .5, 1), grp = new T.Group(); grp.position.set(x + .5, y, z + .5);
      const mat = new T.MeshBasicMaterial({ color: colA, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
      const beam = new T.Mesh(new T.CylinderGeometry(.9, 1.3, 1, 18, 1, true), mat); beam.position.y = 0; grp.add(beam);
      const core = new T.Mesh(new T.CylinderGeometry(.35, .5, 1, 12, 1, true), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })); grp.add(core);
      this.scene.add(grp); this.fx.push({ k: 'beam', grp, beam, core, t: -delay, rev });
      for (let i = 0; i < 4; i++) {
        const ring = new T.Mesh(new T.RingGeometry(.9, 1.0, 36), new T.MeshBasicMaterial({ color: colA, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.copy(grp.position); ring.position.y += .2; this.scene.add(ring); this.fx.push({ k: 'ring', ring, t: -delay - i * .17, big: rev ? 5.5 : 4.5 });
      }
    };
    mk(from[0], from[1], 0x8fd6ff, 0, false); mk(to[0], to[1], 0xffe08a, .55, true);
    const n = 70, pg = new T.BufferGeometry(), pp = new Float32Array(n * 3), vel = [], by = this.baseY(to[0] + .5, to[1] + .5, 1);
    for (let i = 0; i < n; i++) { pp[i * 3] = to[0] + .5; pp[i * 3 + 1] = by + .5; pp[i * 3 + 2] = to[1] + .5; const a = Math.random() * 6.283, sp = 1 + Math.random() * 3.5; vel.push([Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp]); }
    pg.setAttribute('position', new T.BufferAttribute(pp, 3));
    const pts = new T.Points(pg, new T.PointsMaterial({ color: 0xffe9a0, size: 7, sizeAttenuation: false, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false })); pts.frustumCulled = false; this.scene.add(pts);
    this.fx.push({ k: 'spark', pts, pg, vel, t: -.6 });
    if (this.onFlash) this.onFlash();
  }
  stepFx(dt) {
    if (!this.fx.length) return;
    for (const f of this.fx) {
      f.t += dt; const vis = f.t >= 0;
      if (f.k === 'beam') {
        f.grp.visible = vis; if (!vis) continue; const u = f.t / 1.3, h = 16 * Math.sin(Math.min(1, u) * Math.PI);
        f.beam.scale.set(1, Math.max(.01, h), 1); f.beam.position.y = h / 2; f.core.scale.set(1, Math.max(.01, h), 1); f.core.position.y = h / 2;
        f.beam.material.opacity = u < 1 ? .5 * (1 - u * .4) : 0; f.core.material.opacity = u < 1 ? .7 : 0; f.done = u >= 1;
      } else if (f.k === 'ring') {
        f.ring.visible = vis; if (!vis) continue; const u = f.t / .9; f.ring.scale.setScalar(.5 + f.big * u); f.ring.material.opacity = Math.max(0, 1 - u) * .9; f.done = u >= 1;
      } else if (f.k === 'spark') {
        if (!vis) { f.pts.visible = false; continue; } f.pts.visible = true; const p = f.pg.attributes.position.array;
        for (let i = 0; i < f.vel.length; i++) { const v = f.vel[i]; p[i * 3] += v[0] * dt; p[i * 3 + 1] += v[1] * dt; p[i * 3 + 2] += v[2] * dt; v[1] -= 9 * dt; }
        f.pg.attributes.position.needsUpdate = true; f.pts.material.opacity = Math.max(0, 1 - f.t / 1.1); f.done = f.t >= 1.1;
      }
    }
    for (const f of this.fx) if (f.done) { for (const k of ['grp', 'ring', 'pts']) if (f[k]) { this.scene.remove(f[k]); f[k].traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); } }
    this.fx = this.fx.filter(f => !f.done);
  }

  /* ---------- Kamera ---------- */
  updateCamera() {
    const c = this.cam; c.x = clamp(c.x, 3, N - 3); c.z = clamp(c.z, 3, N - 3); c.dist = clamp(c.dist, 12, 340); if (this.scene.fog) { this.scene.fog.near = Math.max(70, c.dist * 1.1); this.scene.fog.far = Math.max(260, c.dist * 3.4); }
    const ty = Math.max(0, this.yAt(c.x, c.z)), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    this.camera.position.set(c.x + Math.sin(c.yaw) * cp * c.dist, ty + sp * c.dist, c.z + Math.cos(c.yaw) * cp * c.dist);
    this.camera.lookAt(c.x, ty, c.z); this.camera.updateMatrixWorld();
    this.sun.position.set(c.x - 30, ty + 60, c.z - 20); this.sun.target.position.set(c.x, ty, c.z); this.sun.target.updateMatrixWorld();
    const sc = this.sun.shadow.camera, ext = clamp(c.dist * .75, 26, 56); if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix(); }
    this.scene.fog.near = c.dist * 1.2 + 20; this.scene.fog.far = c.dist * 3.6 + 140;
  }
  // Bodenpunkt unter einem Bildschirmpunkt
  groundAt(sx, sy) {
    const ndc = new T.Vector2(sx / this.W * 2 - 1, -(sy / this.H) * 2 + 1), rc = this.rc || (this.rc = new T.Raycaster());
    rc.setFromCamera(ndc, this.camera); const o = rc.ray.origin, d = rc.ray.direction;
    if (d.y > -1e-4) return null;
    let t0 = (7 - o.y) / d.y; if (t0 < 0) t0 = 0;
    let t = t0, prev = t0, hit = false;
    for (let i = 0; i < 400; i++) {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      if (o.y + d.y * t <= Math.max(0, this.yAt(clamp(x, 0, N), clamp(z, 0, N)))) { hit = true; break; }
      prev = t; t += .5;
    }
    if (!hit) { const tt = -o.y / d.y; return { x: o.x + d.x * tt, z: o.z + d.z * tt }; }
    for (let i = 0; i < 8; i++) { const m = (prev + t) / 2, x = o.x + d.x * m, z = o.z + d.z * m; if (o.y + d.y * m <= Math.max(0, this.yAt(clamp(x, 0, N), clamp(z, 0, N)))) t = m; else prev = m; }
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }
  tileAtScreen(sx, sy) { const g = this.groundAt(sx, sy); if (!g) return { x: Math.floor(this.cam.x), y: Math.floor(this.cam.z) }; return { x: clamp(Math.floor(g.x), 0, N - 1), y: clamp(Math.floor(g.z), 0, N - 1) }; }
  // Kamera weich zu einem Feld gleiten lassen (fy = gewünschte Bildschirmhöhe)
  panTo(tx, ty, fy = .3) { const c = this.cam, sx = c.x, sz = c.z; this.focus(tx, ty, null, fy); const ex = c.x, ez = c.z; c.x = sx; c.z = sz; this.updateCamera(); this.anim = { sx, sz, ex, ez, t: 0 }; }
  dragStart(sx, sy) { this.anim = null; this.anchor = this.groundAt(sx, sy); }
  dragMove(sx, sy) {
    if (!this.anchor) return;
    for (let i = 0; i < 2; i++) { const g = this.groundAt(sx, sy); if (!g) return; this.cam.x += this.anchor.x - g.x; this.cam.z += this.anchor.z - g.z; this.updateCamera(); }
  }
  zoomAt(sx, sy, factor) {
    this.anim = null;
    const a = this.groundAt(sx, sy); this.cam.dist /= factor; this.updateCamera();
    const b = a && this.groundAt(sx, sy); if (a && b) { this.cam.x += a.x - b.x; this.cam.z += a.z - b.z; this.updateCamera(); }
  }
  rotateBy() {}   // Karte ist nicht drehbar
  // Feld so verschieben, dass es bei (fx, fy) des Bildschirms liegt
  focus(tx, ty, dist, fy = .46) {
    if (dist) this.cam.dist = dist; this.cam.x = tx; this.cam.z = ty; this.updateCamera();
    for (let i = 0; i < 3; i++) { const g = this.groundAt(this.W / 2, this.H * fy); if (!g) break; this.cam.x += tx - g.x; this.cam.z += ty - g.z; this.updateCamera(); }
  }

  /* ---------- Bild für Bild ---------- */
  frame(dt) {
    this.ema = (this.ema || .016) * .97 + Math.min(dt, .2) * .03;
    if (this.time > 3 && !this.perf1 && this.ema > .045) { this.perf1 = 1; this.sun.castShadow = false; this.renderer.shadowMap.enabled = false; this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
    if (this.time > 6 && this.perf1 === 1 && this.ema > .055) { this.perf1 = 2; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); this.renderer.setSize(this.W, this.H); }
    dt = Math.min(dt, .1); this.time += dt; const t = this.time; this.waterMat.uniforms.uTime.value = t;
    if (this.anim) { const a = this.anim; a.t = Math.min(1, a.t + dt / .38); const u = 1 - Math.pow(1 - a.t, 3); this.cam.x = a.sx + (a.ex - a.sx) * u; this.cam.z = a.sz + (a.ez - a.sz) * u; if (a.t >= 1) this.anim = null; }
    this.stepFx(dt); this.updateCamera();
    const frustum = this.frustum || (this.frustum = new T.Frustum()), pm = new T.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    const sph = new T.Sphere();
    for (const im of this.treeChunks) { const u = im.userData; sph.set(new T.Vector3(u.cx, u.cy, u.cz), CH * .8 + 4); im.visible = frustum.intersectsSphere(sph); }
    for (const id in this.obj) {
      const h = this.obj[id];
      if (h.flames) for (const f of h.flames) if (f.visible) { const k = f.userData.s; f.scale.set(k * (1 + Math.sin(t * 13 + h.o.x) * .15), k * (.85 + Math.sin(t * 17 + h.o.y) * .25), k); f.rotation.y = t * 2; }
      if (h.glow) { h.glow.rotation.y = t; h.glow.position.y = 2.9 + Math.sin(t * 2) * .12; }
      if (h.flags.length) this.waveFlags(h.flags, t);
    }
    for (const id in this.opObjs) this.waveFlags(this.opObjs[id].flags, t);
    if (this.terrDirty || t - this.terrAt > 1) { this.terrAt = t; this.terrDirty = false; this.drawTerritory(); }
    // Heere
    const gt = this.gtNow(), step = Math.floor(t * 4) % 2; let routes = [];
    for (const id in this.marchObjs) {
      const s = this.marchObjs[id], m = s.m, p = marchPos({ ...m, t0: m.t0 }, gt), y = this.yAt(p.x, p.y);
      s.grp.position.set(p.x, Math.max(0, y), p.y); s.grp.visible = true;
      const ahead = m.path[Math.min(m.path.length - 1, p.i + 1)], [ax, ay] = cellXY(ahead);
      const L = m.path.length - 1, dtc = L > 0 ? m.arr[L] / L : 1;
      if (!p.still) { const dx = ax + .5 - p.x, dz = ay + .5 - p.y; if (Math.hypot(dx, dz) > .01) s.hd = Math.atan2(dx, dz); }
      if (!s.dOk) { let d = 0; s.units.forEach((u, k) => { if (k) d += (s.units[k - 1].sz + u.sz) / 2; u.dist = d; }); s.dOk = true; }
      const colm = !p.still && s.units.length > 1;
      s.grp.rotation.y = colm ? 0 : (s.hd || 0);
      const y0 = Math.max(0, y);
      s.units.forEach((u, k) => {
        const ph = t * (u.cav ? 10 : 8) + k * 1.3 + Number(id), sw = p.still ? 0 : Math.sin(ph) * (u.cav ? .5 : .65);
        if (u.la) u.la.rotation.x = sw; if (u.lb) u.lb.rotation.x = -sw; for (const l of u.legs) l.m.rotation.x = l.spin ? (p.still ? 0 : t * 6) : l.s * sw * 1.1;
        let bob = p.still ? 0 : Math.abs(Math.sin(ph)) * (u.cav ? .05 : .035);
        if (colm) {   // Marschkolonne: jede Figur folgt dem Weg im Abstand hinter dem Vordermann
          const q = marchPos(m, gt - u.dist * dtc), qa = m.path[Math.min(L, q.i + 1)], [bx, by] = cellXY(qa), ddx = bx + .5 - q.x, ddz = by + .5 - q.y;
          u.g.position.set(q.x - p.x, Math.max(0, this.yAt(q.x, q.y)) - y0 + bob, q.y - p.y);
          u.g.rotation.y = Math.hypot(ddx, ddz) > .01 ? Math.atan2(ddx, ddz) : (u.hd || 0); u.hd = u.g.rotation.y;
        } else { u.g.position.set(u.rx, bob, u.rz); u.g.rotation.y = 0; }
      });
      if (t - (s.lt || 0) > .5) { s.lt = t; const bt = this.badgeTxt(s, gt); if (bt !== s.bt) { s.bt = bt; this.setBadge(s.lab, bt, 0x2a2f38); } }
      if (m.own || (this.sel && this.sel.type === 'march' && this.sel.id === m.id)) {
        const pts = [[p.x, p.y]]; for (let i = p.i + 1; i < m.path.length; i++) { const [x, yy] = cellXY(m.path[i]); pts.push([x + .5, yy + .5]); }
        routes.push({ pts, col: s.col });
      }
      void step;
    }
    this.updateRoutes(routes, t);
    // Auswahlring
    let ring = null;
    if (this.sel && this.sel.type === 'obj') { const h = this.obj[this.sel.id]; if (h) ring = { x: h.o.x + .5, z: h.o.y + .5, r: (KIND_R[h.o.k] || 1.7) * 1.15 + Math.sin(t * 3) * .05 }; }
    else if (this.sel && this.sel.type === 'op') { const q = this.opObjs[this.sel.id]; if (q) ring = { x: q.o.x + .5, z: q.o.y + .5, r: 1.5 + Math.sin(t * 3) * .05 }; }
    else if (this.sel && this.sel.type === 'site') ring = { x: this.sel.x + .5, z: this.sel.y + .5, r: .9 + Math.sin(t * 4) * .07 };
    else if (this.sel && this.sel.type === 'march') { const s = this.marchObjs[this.sel.id]; if (s) ring = { x: s.grp.position.x, z: s.grp.position.z, r: 1 }; }
    if (ring) { this.ringMesh.visible = true; this.ringMesh.position.set(ring.x, Math.max(0, this.yAt(ring.x, ring.z)) + .15, ring.z); this.ringMesh.scale.setScalar(ring.r); } else this.ringMesh.visible = false;
    this.stepSmoke(t);
    this.projectLabels();
    this.renderer.render(this.scene, this.camera);
  }
  stepSmoke(t) {
    const g = this.smoke.geometry, P = g.attributes.position.array, A = g.attributes.aA.array, S = g.attributes.aS.array, list = this.smokeList, cx = this.cam.x, cz = this.cam.z;
    this.smokeMat.uniforms.uScale.value = this.H / (2 * Math.tan(this.camera.fov * Math.PI / 360)) * this.renderer.getPixelRatio() / this.renderer.getPixelRatio();
    let n = 0;
    for (const sm of list) {
      const gp = sm.h.grp.position, dx = gp.x - cx, dz = gp.z - cz; if (dx * dx + dz * dz > 5500 || !sm.h.grp.visible) continue;
      const k = sm.h.grp.scale.x;
      for (let i = 0; i < 4 && n < this.smokeN; i++, n++) {
        const age = (t * .22 + i * .25 + (sm.h.o.x * 7 % 5) * .13) % 1;
        P[n * 3] = gp.x + sm.off[0] * k + age * 1.1 + Math.sin(t + i) * .08 * age; P[n * 3 + 1] = gp.y + sm.off[1] * k + age * 2.4; P[n * 3 + 2] = gp.z + sm.off[2] * k + age * .5;
        A[n] = .5 * Math.sin(Math.min(1, age * 1.6) * Math.PI * .5) * (1 - age); S[n] = .22 + age * .75;
      }
    }
    for (let i = n; i < this.smokeN; i++) { A[i] = 0; S[i] = 0; }
    g.attributes.position.needsUpdate = true; g.attributes.aA.needsUpdate = true; g.attributes.aS.needsUpdate = true;
  }
  updateRoutes(routes, t) {
    const a = this.routeGeo.attributes.position.array; let n = 0; const off = (t * 1.2) % .7;
    for (const r of routes) {
      let carry = off;
      for (let i = 1; i < r.pts.length && n < 395; i++) {
        const [x0, z0] = r.pts[i - 1], [x1, z1] = r.pts[i], len = Math.hypot(x1 - x0, z1 - z0); if (!len) continue;
        for (let d = carry; d < len && n < 395; d += .7) { const u = d / len, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u; a[n * 3] = x; a[n * 3 + 1] = Math.max(0, this.yAt(x, z)) + .25; a[n * 3 + 2] = z; n++; carry = d + .7 - len; }
        carry = Math.max(0, carry);
      }
    }
    this.routeGeo.attributes.position.needsUpdate = true; this.routeGeo.setDrawRange(0, n);
    if (routes.length) this.routePts.material.color.setRGB(LIN(routes[0].col >> 16 & 255) * 1.6 + .1, LIN(routes[0].col >> 8 & 255) * 1.6 + .1, LIN(routes[0].col & 255) * 1.6 + .1);
  }

  /* ---------- Antippen ---------- */
  screenOf(x, y, z) { const v = new T.Vector3(x, y, z).project(this.camera); return { x: (v.x * .5 + .5) * this.W, y: (-v.y * .5 + .5) * this.H, z: v.z }; }
  pxPerUnit(x, y, z) { const d = this.camera.position.distanceTo(new T.Vector3(x, y, z)); return this.H / (2 * Math.tan(this.camera.fov * Math.PI / 360) * d); }
  pickAt(sx, sy) {
    let best = null, bd = 1e9;
    const test = (type, id, x, y, z, rad, extra) => {
      const p = this.screenOf(x, y, z); if (p.z > 1) return; const r = rad * this.pxPerUnit(x, y, z) + 10, d = Math.hypot(sx - p.x, sy - p.y) / r;
      if (d < 1 && d < bd) { bd = d; best = { type, id, ...extra }; }
    };
    for (const id in this.marchObjs) { const s = this.marchObjs[id]; if (s.grp.visible) test('march', Number(id), s.grp.position.x, s.grp.position.y + .5, s.grp.position.z, .9); }
    if (best) return best;
    for (const id in this.opObjs) { const q = this.opObjs[id]; test('op', id, q.o.x + .5, q.grp.position.y + 1.8, q.o.y + .5, 1.6); }
    if (best) return best;
    for (const id in this.obj) {
      const h = this.obj[id], o = h.o, k = KIND_R[o.k] || 1.7, hh = o.k === 'start' ? (h.h || 2) * .45 : o.k === 'throne' ? 8 : o.k === 'tower' ? 6 : 1;
      test('obj', id, o.x + .5, h.grp.position.y + hh, o.y + .5, k);
    }
    return best;
  }
  select(sel) { this.sel = sel; }
}

/* ---------- Baukasten für die 3D-Stadtansicht (city3d.js) ---------- */
export const KIT = { use: t => { T = t; }, MB, crenels, wallSeg, tower, house, well, crate, barrel, buildCastle, buildFarm, buildWood, buildStone, buildOre, buildUnit, treeGeo, SMOKE_VS, SMOKE_FS, hash, mul, mixc, LIN, hexRGB, STONE, STONE_D, WOOD, WOOD_D, PLASTER, DARK, LIGHT, GOLD, IRON, CASTLE_ROOFS };
