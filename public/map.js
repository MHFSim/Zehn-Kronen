// Zehn Kronen – Weltkarte in 3D (Three.js).
// Gelände: ein Höhengitter, in Blöcke geteilt (Sichtprüfung). Wasser: eigenes Netz mit Shader. Bäume, Felsen: Instanzen je Block.
// Burgen, Lager, Felder, Türme und Heere sind im Code modellierte Low-Poly-Körper (Vertexfarben, keine Bilddateien).
// Die Kamera schwebt schräg über dem Boden: ziehen = verschieben, zwei Finger = zoomen und drehen.
import { N, G, SUB, SEA, vnoise, fbm, smooth, generateMap, roadPaths, setMapRoads } from '/shared/mapgen.js';
import { PLAYER_COLORS, marchPos, cellXY } from '/shared/core.js';
import { rectsOf, roadEdgesOf } from '/shared/outpost.js';

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
  constructor() { this.p = []; this.n = []; this.c = []; }
  push(g, col, x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
    g = g.index ? g.toNonIndexed() : g;
    const m = new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
    g.applyMatrix4(m); g.computeVertexNormals();
    const p = g.attributes.position.array, nn = g.attributes.normal.array, k = 1 + (hash(Math.round(x * 31), Math.round(z * 17), Math.round(y * 13)) - .5) * .1;
    const r = LIN(Math.min(255, col[0] * k)), gg = LIN(Math.min(255, col[1] * k)), b = LIN(Math.min(255, col[2] * k));
    for (let i = 0; i < p.length; i++) { this.p.push(p[i]); this.n.push(nn[i]); }
    for (let i = 0; i < p.length / 3; i++) this.c.push(r, gg, b);
    g.dispose(); return this;
  }
  box(w, h, d, x, y, z, col, ry = 0) { return this.push(new T.BoxGeometry(w, h, d), col, x, y + h / 2, z, ry); }
  cyl(rt, rb, h, seg, x, y, z, col) { return this.push(new T.CylinderGeometry(rt, rb, h, seg), col, x, y + h / 2, z); }
  cone(r, h, seg, x, y, z, col) { return this.push(new T.ConeGeometry(r, h, seg), col, x, y + h / 2, z); }
  // Pyramidendach über einem Rechteck w × d
  pyr(w, d, h, x, y, z, col) { const g = new T.ConeGeometry(1, h, 4); g.rotateY(Math.PI / 4); return this.push(g, col, x, y + h / 2, z, 0, w / 1.4142, 1, d / 1.4142); }
  sph(r, x, y, z, col, seg = 8, sy = 1) { return this.push(new T.SphereGeometry(r, seg, Math.max(3, seg * .75 | 0)), col, x, y, z, 0, 1, sy, 1); }
  ico(r, x, y, z, col, sy = 1, sx = 1, ry = 0) { return this.push(new T.IcosahedronGeometry(r, 0), col, x, y, z, ry, sx, sy, sx); }
  build() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); return g;
  }
}

/* ---------- Modelle ---------- */
const STONE = [172, 164, 148], STONE_D = [128, 122, 110], WOOD = [118, 84, 52], PLASTER = [200, 190, 166], DIRT = [140, 112, 78], GRASS = [92, 130, 62];
const CASTLE_ROOFS = [[170, 62, 48], [60, 100, 170], [60, 140, 80], [140, 80, 160], [214, 128, 48], [48, 150, 148], [88, 88, 100], [208, 170, 60], [190, 86, 134], [120, 84, 54]];
const CASTLE_STONES = [[172, 164, 148], [178, 170, 150], [160, 160, 156], [184, 168, 142], [166, 166, 168], [176, 160, 140], [150, 150, 146], [182, 174, 158], [170, 158, 150], [164, 158, 136]];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// Zinnenreihe entlang einer Kante (x0,z0) → (x1,z1)
function crenels(b, x0, z0, x1, z1, y, col, step = .42) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.floor(len / step)), ry = Math.atan2(-(z1 - z0), x1 - x0);
  for (let i = 0; i <= n; i += 2) { const u = i / n; b.box(.2, .17, .13, x0 + (x1 - x0) * u, y, z0 + (z1 - z0) * u, col, ry); }
}
function tower(b, x, z, y0, r, h, roofH, roofCol, st, flag) {
  b.cyl(r * 1.12, r * 1.2, .35, 10, x, y0 - .35, z, mul(st, .75));
  b.cyl(r, r * 1.08, h, 10, x, y0, z, st);
  b.cyl(r * 1.18, r * 1.18, .16, 10, x, y0 + h - .05, z, mul(st, 1.05));
  b.box(.12, .26, .08, x + r * .98, y0 + h * .6, z, [34, 30, 36]); b.box(.08, .26, .12, x, y0 + h * .6, z + r * .98, [34, 30, 36]);
  b.cone(r * 1.35, roofH, 10, x, y0 + h + .1, z, roofCol);
  if (flag) { b.cyl(.025, .025, .8, 5, x, y0 + h + .1 + roofH, z, [60, 44, 30]); flag.push([x, y0 + h + .1 + roofH + .62, z]); }
}
function house(b, x, z, y0, w, d, h, roofCol, ry = 0) { b.box(w, h, d, x, y0, z, [186, 156, 118], ry); b.pyr(w * 1.2, d * 1.2, h * .8, x, y0 + h, z, roofCol); }

function buildCastle(tier, v) {
  const b = new MB(), flags = [], roofC = CASTLE_ROOFS[v % 10], ST = CASTLE_STONES[v % 10], STD = mul(ST, .82), L = v % 5, t = tier - 1;
  const R = [1.5, 2.0, 2.5][t] * (L === 3 ? 1.1 : 1), wd = .3, wallH = [.8, 1.05, 1.3][t] + (L === 4 ? .22 : 0), y0 = .3;
  // Sockel mit Fundament (reicht nach unten, damit nichts schwebt)
  b.box(2 * R + 1.0, 2.0, 2 * R + 1.0, 0, -1.7, 0, mul(ST, .7));
  b.box(2 * R + .9, .12, 2 * R + .9, 0, y0 - .12, 0, mul(ST, .9));
  b.box(2 * R - .2, .05, 2 * R - .2, 0, y0 - .03, 0, [126, 112, 82]);
  // Mauern
  const gw = L === 3 ? 1.0 : .8;
  b.box(2 * R, wallH, wd, 0, y0, -R, STD); b.box(wd, wallH, 2 * R, -R, y0, 0, STD); b.box(wd, wallH, 2 * R, R, y0, 0, ST);
  b.box(R - gw / 2, wallH, wd, -(R + gw / 2) / 2, y0, R, ST); b.box(R - gw / 2, wallH, wd, (R + gw / 2) / 2, y0, R, ST);
  crenels(b, -R, -R, R, -R, y0 + wallH, STD); crenels(b, -R, -R, -R, R, y0 + wallH, STD); crenels(b, R, -R, R, R, y0 + wallH, ST);
  crenels(b, -R, R, -gw / 2, R, y0 + wallH, ST); crenels(b, gw / 2, R, R, R, y0 + wallH, ST);
  // Torhaus
  b.box(gw + .6, wallH + .5, wd + .5, 0, y0, R, [190, 180, 160]);
  b.box(gw * .66, wallH * .85, wd + .56, 0, y0, R, [30, 24, 20]);
  b.pyr(gw + .85, wd + .75, .55, 0, y0 + wallH + .5, R, roofC);
  // Türme
  const tr = [.42, .5, .58][t], tH = wallH + [.7, 1.0, 1.35][t] + (L === 4 ? .5 : 0), rf = [.95, 1.15, 1.4][t];
  tower(b, -R, -R, y0, tr, tH + (L === 4 ? .6 : 0), rf, roofC, ST, flags);
  tower(b, R, -R, y0, tr, tH + (L === 1 ? -.3 : 0), rf, roofC, ST, null);
  tower(b, -R, R, y0, tr, tH, rf, roofC, ST, null);
  tower(b, R, R, y0, tr * 1.08, tH + .25, rf * 1.05, roofC, ST, flags);
  if (tier >= 2) { tower(b, 0, -R, y0, tr * .8, wallH + .55, rf * .8, roofC, ST, null); tower(b, -R, 0, y0, tr * .8, wallH + .55, rf * .8, roofC, ST, null); tower(b, R, 0, y0, tr * .8, wallH + .55, rf * .8, roofC, ST, null); }
  if (tier >= 3) { tower(b, -R * .5, R, y0, tr * .7, wallH + .45, rf * .7, roofC, ST, null); tower(b, R, R * .5, y0, tr * .7, wallH + .45, rf * .7, roofC, ST, null); }
  // Burgfried
  const ks = [1.15, 1.5, 1.9][t] * (L === 1 ? 1.15 : 1), kh = [1.5, 2.1, 2.8][t] + (L === 2 ? .4 : 0), ky = y0;
  b.box(ks, kh, ks, 0, ky, 0, PLASTER); b.box(ks + .1, .14, ks + .1, 0, ky + kh - .07, 0, mul(ST, 1.05));
  for (let i = 0; i < (tier === 1 ? 1 : 2); i++) { const o = -ks / 2 + ks * (.3 + i * .4); b.box(.16, .3, .06, o, ky + kh * .6, ks / 2 + .02, [34, 30, 36]); b.box(.06, .3, .16, ks / 2 + .02, ky + kh * .6, o, [34, 30, 36]); }
  b.box(.3, .5, .06, 0, ky, ks / 2 + .02, [64, 44, 28]);
  let top = ky + kh, rw = ks;
  if (tier >= 2) { const uw = ks * .72, uh = .55 + .2 * tier; b.box(uw, uh, uw, 0, top, 0, PLASTER); b.box(uw + .1, .12, uw + .1, 0, top + uh - .06, 0, mul(ST, 1.05)); top += uh; rw = uw; }
  if (L === 2) { b.cone(rw * .82, 1.2 + t * .35, 12, 0, top, 0, roofC); top += 1.2 + t * .35; }
  else if (L === 1) { crenels(b, -rw / 2, -rw / 2, rw / 2, -rw / 2, top, ST, .35); crenels(b, rw / 2, -rw / 2, rw / 2, rw / 2, top, ST, .35); crenels(b, -rw / 2, rw / 2, rw / 2, rw / 2, top, ST, .35); crenels(b, -rw / 2, -rw / 2, -rw / 2, rw / 2, top, ST, .35); b.pyr(rw * .6, rw * .6, .7, 0, top, 0, roofC); top += .7; }
  else { const rh = [.95, 1.2, 1.5][t] * (L === 3 ? 1.2 : 1); b.pyr(rw * 1.18, rw * 1.18, rh, 0, top, 0, roofC); top += rh; }
  b.cyl(.03, .03, .9, 5, 0, top - .05, 0, [60, 44, 30]); flags.push([0, top + .75, 0]);
  // Häuser im Hof
  if (tier >= 2 || L >= 3) house(b, -R + .75, .35, y0, .6, .75, .4, mul(roofC, .85));
  if (tier >= 3 || (L === 3 && tier >= 2)) house(b, R - .85, .55, y0, .65, .6, .38, mul(roofC, .75));
  if (L === 0 && tier === 1) house(b, -R + .7, -.1, y0, .55, .55, .35, roofC);
  return { geo: b.build(), flags, h: top + 1 };
}

function buildSlot() {
  const b = new MB();
  b.cyl(1.0, 1.1, .16, 12, 0, 0, 0, [140, 132, 116]); b.cyl(.6, .65, .1, 10, 0, .16, 0, [118, 104, 78]);
  b.cyl(.04, .04, 1.1, 5, 0, .2, 0, WOOD); b.box(.5, .24, .05, 0, .8, 0, [150, 112, 70]);
  return { geo: b.build(), flags: [], h: 1.3 };
}
function buildThrone() {
  const b = new MB(), G0 = [226, 188, 84], S = [196, 188, 168];
  b.cyl(3.1, 3.4, 1.4, 16, 0, -1.2, 0, mul(S, .7));
  b.cyl(2.9, 3.0, .28, 16, 0, .0, 0, S); b.cyl(2.3, 2.4, .28, 16, 0, .28, 0, mul(S, 1.06)); b.cyl(1.7, 1.8, .28, 16, 0, .56, 0, mul(S, 1.1));
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832; b.cyl(.2, .22, 2.3, 8, Math.cos(a) * 2.05, .84, Math.sin(a) * 2.05, [214, 208, 190]); b.cyl(.3, .24, .16, 8, Math.cos(a) * 2.05, 3.08, Math.sin(a) * 2.05, G0); }
  b.cyl(2.35, 2.35, .16, 16, 0, 3.24, 0, G0); b.cone(1.9, 1.2, 16, 0, 3.4, 0, [196, 150, 52]);
  b.box(.9, .22, .9, 0, .84, 0, S); b.box(.7, .4, .7, 0, 1.06, 0, G0); b.box(.7, 1.0, .18, 0, 1.2, -.3, G0); b.box(.14, .5, .5, -.32, 1.06, .0, G0); b.box(.14, .5, .5, .32, 1.06, 0, G0);
  b.cyl(.04, .04, 1.2, 5, 0, 4.6, 0, [60, 44, 30]);
  return { geo: b.build(), flags: [[0, 5.5, 0]], h: 5.2 };
}
function buildSanct() {
  const b = new MB();
  b.cyl(2.0, 2.3, 1.0, 14, 0, -.8, 0, [150, 146, 134]); b.cyl(1.9, 2.0, .2, 14, 0, 0, 0, [214, 210, 196]); b.cyl(1.4, 1.5, .2, 14, 0, .2, 0, [226, 222, 208]);
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.2832; b.cyl(.14, .17, 1.6, 8, Math.cos(a) * 1.3, .4, Math.sin(a) * 1.3, [228, 224, 212]); b.box(.4, .12, .4, Math.cos(a) * 1.3, 2.0, Math.sin(a) * 1.3, [200, 196, 180]); }
  b.cone(1.7, .55, 6, 0, 2.12, 0, [120, 150, 190]);
  return { geo: b.build(), flags: [], h: 3, glow: true };
}
function buildFarm(lv) {
  const b = new MB(), cols = [[214, 178, 64], [196, 160, 56], [138, 160, 62]];
  [[-1.1, -.9, 1.7, 1.2], [.7, -1.1, 1.5, 1.1], [-.9, .6, 1.7, 1.1]].forEach(([x, z, w, d], k) => {
    b.box(w, .06, d, x, 0, z, mul(cols[k], .62));
    for (let i = 0; i < 7; i++) b.box(w * .09, .1, d * .86, x - w / 2 + w * (i + .5) / 7, .05, z, mul(cols[k], .95 + (i % 2) * .25));
  });
  b.box(1.05, .8, .85, 1.0, 0, .75, WOOD); b.pyr(1.3, 1.1, .6, 1.0, .8, .75, [150, 70, 50]); b.box(.3, .5, .05, 1.0, 0, 1.19, [60, 40, 24]);
  b.cyl(.2, .2, .26, 8, .0, 0, 1.4, [204, 170, 72]); b.cyl(.2, .2, .26, 8, -.5, 0, 1.5, [204, 170, 72]);
  return { geo: b.build(), flags: [], h: 1.6 };
}
function buildWood(lv) {
  const b = new MB(), LOG = [140, 96, 56];
  b.box(1.2, .75, 1.0, -.2, 0, -.7, [132, 94, 58]); b.pyr(1.5, 1.3, .6, -.2, .75, -.7, [92, 70, 44]); b.box(.3, .5, .05, -.2, 0, -.18, [50, 34, 22]);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) b.push(new T.CylinderGeometry(.13, .13, 1.1, 7), LOG, .7 + i * .26 + r * .13, .14 + r * .24, .9, 0, 1, 1, 1, 0, Math.PI / 2);
  for (const [x, z] of [[-1.2, .3], [-.8, 1.0], [-1.5, 1.0]]) { b.cyl(.16, .18, .22, 7, x, 0, z, [106, 74, 44]); b.cyl(.14, .14, .03, 7, x, .22, z, [216, 182, 130]); }
  return { geo: b.build(), flags: [], h: 1.5 };
}
function buildStone(lv) {
  const b = new MB();
  for (let i = 0; i < 4; i++) { const s = 2.2 - i * .5; b.box(s, .22, s * .9, -.2, i * .22, 0, mul([168, 162, 148], 1 - i * .08)); }
  for (const [x, z, w, d, h] of [[1.2, -.9, .6, .5, .5], [1.4, -.2, .5, .5, .4], [-1.6, .9, .6, .5, .5], [-1.2, 1.3, .5, .4, .35]]) b.box(w, h, d, x, 0, z, [192, 186, 172]);
  b.cyl(.06, .06, 1.7, 5, -.4, 0, 1.2, [90, 66, 40]); b.box(1.2, .07, .07, .1, 1.6, 1.2, [90, 66, 40]); b.box(.28, .22, .28, .6, 1.2, 1.2, [170, 164, 148]);
  return { geo: b.build(), flags: [], h: 1.8 };
}
function buildOre(lv) {
  const b = new MB();
  b.ico(1.3, -.1, .45, -.1, [104, 98, 90], .8, 1.1, .3); b.ico(.95, .9, .35, -.5, [118, 110, 100], .8, 1, .9); b.ico(.8, -.9, .3, .6, [92, 88, 82], .8, 1, 1.4); b.ico(.7, .5, .3, .7, [110, 104, 94], .75, 1, .2);
  b.box(.7, .8, .3, .0, 0, 1.02, [14, 12, 10]); b.box(.12, .86, .12, -.42, 0, 1.06, WOOD); b.box(.12, .86, .12, .42, 0, 1.06, WOOD); b.box(.98, .12, .14, 0, .84, 1.06, WOOD);
  for (let i = 0; i < 5; i++) b.ico(.09, -.5 + i * .4, .72 + (i % 2) * .26, .45 + i * .07, [[232, 190, 90], [120, 190, 230], [236, 210, 130]][i % 3], 1.3);
  b.box(.5, .26, .34, 1.4, .1, 1.0, [74, 58, 44]); b.cyl(.1, .1, .08, 8, 1.25, 0, 1.0, [30, 30, 30]);
  return { geo: b.build(), flags: [], h: 1.5 };
}
function buildCamp(dead) {
  const b = new MB(), TC = [[150, 60, 48], [134, 98, 60], [100, 78, 60]];
  if (!dead) {
    [[-.9, -.4, .0], [.8, -.6, .5], [.1, .8, 1.1]].forEach(([x, z, ry], i) => { b.push(new T.ConeGeometry(.75, 1.1, 4, 1), TC[i], x, .55, z, ry); });
    for (let i = 0; i < 22; i++) { const a = i / 22 * 6.2832; const x = Math.cos(a) * 1.9, z = Math.sin(a) * 1.9; b.cone(.07, .6 + hash(i, 3) * .22, 5, x, 0, z, [112, 78, 46]); }
    b.cyl(.03, .03, 1.5, 5, 1.3, 0, 1.1, [60, 44, 30]); b.sph(.1, 1.3, 1.5, 1.1, [230, 226, 214], 6);
    b.cyl(.22, .26, .08, 8, .0, 0, .0, [48, 44, 40]);
  } else {
    [[-.9, -.4], [.8, -.6], [.1, .8]].forEach(([x, z], i) => { b.cyl(.7, .75, .06, 7, x, 0, z, [48, 44, 40]); for (let k = 0; k < 3; k++) b.box(.05, .7 - k * .15, .05, x + (k - 1) * .3, 0, z, [54, 42, 34]); });
  }
  return { geo: b.build(), flags: [], h: 1.6 };
}
function buildRuin(dead) {
  const b = new MB(), S = dead ? [118, 114, 100] : [152, 146, 128];
  for (const [x, z, w, d, h, ry] of [[-.9, -.3, 1.6, .3, 1.1, .1], [.6, -.9, .3, 1.5, .8, 0], [-.2, .8, 1.2, .3, .5, -.15], [1.2, .5, .5, .5, 1.3, 0]]) b.box(w, h, d, x, 0, z, S, ry);
  b.cyl(.2, .22, 1.4, 7, -1.5, 0, .7, [170, 164, 146]); b.cyl(.2, .22, .6, 7, 1.4, 0, -.6, [160, 154, 138]);
  for (let i = 0; i < 9; i++) b.ico(.12 + hash(i, 5) * .1, -1 + hash(i, 1) * 2.2, .08, -.9 + hash(i, 2) * 2, mul(S, .85), .7);
  b.sph(.5, .0, .2, .0, [80, 112, 60], 6, .5);
  return { geo: b.build(), flags: [], h: 1.4 };
}
function buildOutpost() {
  const b = new MB(), flags = [], S = [158, 150, 134];
  b.cyl(1.0, 1.15, 1.6, 10, 0, -1.3, 0, mul(S, .75)); b.cyl(.62, .78, 2.5, 10, 0, .3, 0, S); b.cyl(.85, .85, .2, 10, 0, 2.7, 0, mul(S, 1.05));
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832; b.box(.2, .22, .16, Math.cos(a) * .8, 2.9, Math.sin(a) * .8, S, -(a + Math.PI / 2)); }
  b.box(.34, .6, .12, 0, .3, .77, [60, 40, 26]); b.box(.12, .3, .2, .55, 1.6, 0, [30, 26, 24]);
  b.cyl(.03, .03, 1.2, 5, 0, 2.9, 0, [60, 44, 30]); flags.push([0, 3.85, 0]);
  return { geo: b.build(), flags, h: 4.2 };
}
function buildSoldier(col) {
  const b = new MB();
  b.cyl(.09, .11, .34, 7, 0, .1, 0, col); b.sph(.075, 0, .53, 0, [226, 190, 150], 6); b.cone(.085, .1, 6, 0, .56, 0, [150, 150, 158]);
  b.cyl(.015, .015, .72, 4, .15, .05, 0, [90, 66, 40]); b.box(.05, .2, .2, -.13, .18, 0, mul(col, .8));
  return b.build();
}

/* ---------- Bäume (Instanzen) ---------- */
function treeGeo(kind) {
  const b = new MB();
  if (kind === 'pine') { b.cyl(.05, .07, .3, 5, 0, 0, 0, [90, 62, 38]); b.cone(.4, .55, 7, 0, .22, 0, [255, 255, 255]); b.cone(.32, .5, 7, 0, .5, 0, [235, 235, 235]); b.cone(.22, .45, 7, 0, .78, 0, [215, 215, 215]); }
  else if (kind === 'snow') { b.cyl(.05, .07, .3, 5, 0, 0, 0, [90, 62, 38]); b.cone(.38, .55, 7, 0, .22, 0, [226, 238, 238]); b.cone(.3, .5, 7, 0, .5, 0, [214, 230, 232]); b.cone(.2, .45, 7, 0, .78, 0, [244, 248, 250]); }
  else if (kind === 'oak') { b.cyl(.07, .09, .42, 5, 0, 0, 0, [98, 70, 44]); b.ico(.34, 0, .66, 0, [255, 255, 255], .9); b.ico(.22, .18, .84, .08, [235, 235, 235], .9); b.ico(.2, -.16, .78, -.1, [220, 225, 220], .9); }
  else if (kind === 'bush') { b.ico(.2, 0, .13, 0, [255, 255, 255], .8); b.ico(.14, .16, .1, .06, [225, 225, 225], .8); }
  else { b.ico(.24, 0, .1, 0, [255, 255, 255], .65); b.ico(.14, .2, .06, .08, [220, 220, 220], .7); }
  return b.build();
}

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

const KIND_R = { start: 2.8, throne: 3.4, sanct: 2.3, farm: 1.7, wood: 1.6, stone: 1.6, ore: 1.7, camp: 1.9, ruin: 1.7 };

export class WorldMap {
  constructor(THREE, host) {
    T = THREE; this.host = host;
    const r = this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding;
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    this.dom = r.domElement; host.appendChild(this.dom);
    this.scene = new T.Scene(); const sky = 0x9cc3de; this.scene.background = new T.Color(sky); this.scene.fog = new T.Fog(sky, 70, 260);
    this.camera = new T.PerspectiveCamera(34, 1, 2, 700);
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
    this.buildTerrain(map); this.buildWater(); this.buildTrees(map); this.buildObjects(map);
    this.territory = new T.Group(); this.scene.add(this.territory); this.preview = null; this.terrAt = 0; this.terrDirty = true;
    this.ringMesh = new T.Mesh(new T.RingGeometry(.9, 1.0, 40), new T.MeshBasicMaterial({ color: 0xf0d98a, transparent: true, opacity: .95, side: T.DoubleSide, depthTest: false }));
    this.ringMesh.rotation.x = -Math.PI / 2; this.ringMesh.renderOrder = 20; this.ringMesh.visible = false; this.scene.add(this.ringMesh);
    this.routeGeo = new T.BufferGeometry(); this.routeGeo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(3 * 1200), 3)); this.routeGeo.setDrawRange(0, 0);
    this.routeCol = new T.Color(1, 1, 1);
    this.routePts = new T.Points(this.routeGeo, new T.PointsMaterial({ size: 5, sizeAttenuation: false, color: 0xffffff, depthTest: false, transparent: true, opacity: .95 })); this.routePts.renderOrder = 15; this.routePts.frustumCulled = false; this.scene.add(this.routePts);
    this.cam.x = this.cam.z = N / 2; this.updateCamera();
  }
  buildTerrain(map) {
    const H = map.H, F = map.F, seed = map.seed, n = G * G;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const at = (x, y) => H[clamp(y, 0, G - 1) * G + clamp(x, 0, G - 1)];
    const C = { sand: [220, 202, 148], g1: [104, 152, 64], g2: [78, 126, 52], olive: [136, 142, 72], rock: [132, 122, 106], rock2: [98, 92, 86], snow: [240, 244, 250], forest: [44, 86, 44], dirt: [156, 128, 90], dsand: [150, 150, 120], dwater: [38, 90, 112] };
    const pads = { start: [[118, 104, 78], 2.3, .6], camp: [[112, 94, 68], 2.2, .7], ruin: [[112, 106, 90], 1.9, .55], sanct: [[205, 200, 184], 2.4, .8], throne: [[190, 180, 150], 3.4, .8],
      farm: [[150, 126, 70], 1.9, .5], wood: [[98, 82, 52], 1.7, .55], stone: [[150, 144, 130], 1.9, .6], ore: [[100, 92, 82], 2.1, .6] };
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
      const m = new T.Mesh(g, this.matVC); m.receiveShadow = true; this.scene.add(m); this.chunks.push(m);
    }
    this.hilite = this.matVC;
  }
  // Farbe eines Gitterpunkts: Boden, darüber Weg und Plätze
  paintVertex(i, rw) {
    const { pre, nz3, ao, col, C, pads, map } = this.tv, x = (i % G) / SUB, y = Math.floor(i / G) / SUB, n3 = nz3[i];
    let c = [pre[i * 3], pre[i * 3 + 1], pre[i * 3 + 2]];
    if (rw > 0) c = mixc(c, mixc(C.dirt, [132, 104, 70], n3), rw * .78);
    for (const o of map.objects) {
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
      const r = o.k === 'throne' ? 4 : o.k === 'start' ? 5.5 : o.k === 'sanct' ? 3 : 1.9;
      for (let y = Math.floor(o.y - r); y <= o.y + r; y++) for (let x = Math.floor(o.x - r); x <= o.x + r; x++) { if (x < 0 || y < 0 || x >= N || y >= N) continue; if (Math.hypot(x - o.x, y - o.y) <= r) blocked[y * N + x] = 1; }
    }
    const lists = {};   // "kind|chunk" -> [[x,y,s,rot,cell,variant]]
    const addT = (kind, x, y, s, cell, vr) => { const k = kind + '|' + Math.floor(x / CH) + ',' + Math.floor(y / CH); (lists[k] = lists[k] || []).push([x, y, s, hash(Math.floor(x * 9), Math.floor(y * 9), seed + 31) * 6.28, cell, vr]); };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = y * N + x; if (blocked[c]) continue;
      const h = this.hAt(x + .5, y + .5); if (h < SEA + .03) continue;
      const pass = map.pass[c], f = map.F[(y * SUB + 1) * G + x * SUB + 1], r = hash(x, y, seed), vr = hash(x, y, seed + 40);
      if (pass === 2 && h < .64) {
        const cnt = 2 + (r > .55 ? 1 : 0) + (r > .9 ? 1 : 0);
        for (let i = 0; i < cnt; i++) {
          const a = hash(x * 7 + i, y * 3, seed + 5), b = hash(x * 5, y * 11 + i, seed + 6), kind = hash(x + i, y - i, seed + 8), sc = (.9 + hash(x, y + i, seed + 12) * .5) * 1.25;
          addT(h > .5 || kind > .55 ? 'pine' : 'oak', x + .1 + a * .8, y + .1 + b * .8, sc, c, hash(x + i, y, seed + 44));
        }
      } else if (pass === 1 && h < .6) {
        if (r < (f > .45 ? .22 : .055)) addT(hash(x, y, seed + 3) > .5 ? 'oak' : 'pine', x + .2 + hash(x, y, seed + 5) * .6, y + .2 + hash(x, y, seed + 6) * .6, (.85 + hash(x, y, seed + 7) * .4) * 1.2, c, vr);
        else if (r > .975) addT('bush', x + .5, y + .5, 1.3, c, vr);
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
    M.slot = buildSlot(); M.throne = buildThrone(); M.sanct = buildSanct(); M.outpost = buildOutpost(); M.campAlive = buildCamp(false); M.campDead = buildCamp(true); M.ruin = buildRuin(false); M.ruinDone = buildRuin(true);
    for (const k of ['farm', 'wood', 'stone', 'ore']) M[k] = { farm: buildFarm, wood: buildWood, stone: buildStone, ore: buildOre }[k]();
    this.soldierGeos = {}; this.castleCache = {};
    this.flagGeo = new T.PlaneGeometry(.7, .42, 6, 2); this.flagGeo.translate(.35, 0, 0);
    this.fireGeo = new T.ConeGeometry(.2, .55, 6); this.fireMat = new T.MeshBasicMaterial({ color: 0xffb040 });
    this.glowMat = new T.MeshBasicMaterial({ color: 0x9fe2ff, transparent: true, opacity: .85 });
    const mesh = (model, mat) => { const m = new T.Mesh(model.geo, mat || this.matVC); m.castShadow = true; m.receiveShadow = true; return m; };
    this.mesh = mesh;
    for (const o of map.objects) {
      const hd = { o, grp: new T.Group(), flags: [], vis: true }; this.obj[o.id] = hd;
      const g = hd.grp, y = this.baseY(o.x + .5, o.y + .5, o.k === 'throne' ? 2.5 : o.k === 'start' ? 2 : 1.2);
      g.position.set(o.x + .5, y, o.y + .5); g.rotation.y = ['start', 'throne', 'sanct'].includes(o.k) ? 0 : hash(o.x, o.y, 3) * .5 - .25;
      if (o.k === 'start') { hd.slot = mesh(M.slot); g.add(hd.slot); hd.castle = null; }
      else if (o.k === 'camp') { hd.alive = mesh(M.campAlive); hd.deadM = mesh(M.campDead); hd.deadM.visible = false; g.add(hd.alive, hd.deadM); hd.fire = new T.Mesh(this.fireGeo, this.fireMat); hd.fire.position.set(0, .35, 0); g.add(hd.fire); }
      else if (o.k === 'ruin') { hd.alive = mesh(M.ruin); hd.deadM = mesh(M.ruinDone); hd.deadM.visible = false; g.add(hd.alive, hd.deadM); }
      else {
        const mdl = M[o.k]; hd.main = mesh(mdl); g.add(hd.main);
        if (['farm', 'wood', 'stone', 'ore'].includes(o.k)) { const k = .95 + .05 * o.lv; g.scale.setScalar(k); }
        if (o.k === 'sanct') { hd.glow = new T.Mesh(new T.OctahedronGeometry(.42), this.glowMat); hd.glow.position.set(0, 2.9, 0); g.add(hd.glow); }
        if (o.k === 'throne') { this.addFlags(hd, M.throne.flags, 0xe9c860); }
      }
      this.scene.add(g);
    }
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
        if (p) { const mdl = this.castleModel(tier, p.slot % 10); h.castle = this.mesh(mdl); h.grp.add(h.castle); this.addFlags(h, mdl.flags, 0xffffff); h.h = mdl.h; }
      }
      if (p) this.setFlagColor(h, parseInt(PLAYER_COLORS[p.slot % 10].slice(1), 16));
    }
    const gt = this.gtNow();
    for (const id in this.obj) {
      const h = this.obj[id], o = h.o;
      if (o.k === 'camp') { const dead = (view.world.camps[id] || 0) > gt; h.isDead = dead; h.alive.visible = !dead; h.deadM.visible = dead; h.fire.visible = !dead; }
      if (o.k === 'ruin') { const done = !!view.world.ruins[id]; h.isDead = done; h.alive.visible = !done; h.deadM.visible = done; }
      if (['farm', 'wood', 'stone', 'ore'].includes(o.k)) { const max = 3000 * o.lv, left = view.world.nodes[id] == null ? max : view.world.nodes[id]; h.frac = left / max; const k = (.95 + .05 * o.lv) * (.62 + .38 * Math.min(1, h.frac * 2)); h.grp.scale.set(k, k, k); }
    }
    this.rebuildLabels(view);
    this.syncOutposts(view);
    const eg = this.roadEdges(view), sg = JSON.stringify(eg); if (sg !== this.roadSig) { this.roadSig = sg; this.setRoads(eg); }
    this.syncMarches(view);
    this.dirtyLabels = true;
  }
  // Burg an einen neuen Ort setzen (Teleporter)
  moveStart(h, x, y) {
    const o = h.o; o.x = x; o.y = y; h.grp.position.set(x + .5, this.baseY(x + .5, y + .5, 2), y + .5); this.clearTrees(x + .5, y + .5, 4.6);
    if (h.lab) { h.lab.el.style.display = 'none'; }
    this.terrDirty = true; this.dirtyLabels = true;
  }
  roadEdges(view) { return roadEdgesOf(view.match.alliances || [], id => { const p = view.match.players.find(x => x.id === id); return p && p.pos; }, view.world.outposts || [], this.gtNow()); }
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
    const RES_COL = { farm: 0xb58a22, wood: 0x7b5630, stone: 0x6b6f75, ore: 0x3f6b94 };
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
      else if (['farm', 'wood', 'stone', 'ore'].includes(o.k)) { txt = String(o.lv); col = RES_COL[o.k]; up = 2.0; }
      else if (o.k === 'camp') { txt = h.isDead ? null : String(o.lv); col = 0x8a2b24; up = 2.4; }
      else if (o.k === 'ruin') { txt = h.isDead ? 'Ruine (geplündert)' : 'Ruine ' + o.lv; col = 0x5a4a6e; up = 2.2; }
      else if (o.k === 'sanct' || o.k === 'throne') {
        const hd = (view.match.holds || []).find(x => x.id === id);
        txt = (o.k === 'sanct' ? 'Heiligtum' : 'Der Thron') + (hd ? ' · ' + hd.label : '');
        col = hd ? (hd.mine ? 0x2f7f3a : 0x8a2b24) : o.k === 'sanct' ? 0x2f6f8f : 0x9c7420; up = o.k === 'sanct' ? 3.6 : 6.2;
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
      const o = h.o, show = dist < 78 || o.k === 'start' || o.k === 'throne';
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
  syncMarches(view) {
    const keep = new Set();
    for (const m of view.world.marches) {
      keep.add(m.id); let s = this.marchObjs[m.id];
      if (!s) {
        const grp = new T.Group(), mat = this.matVC, sol = [];
        for (const [x, z] of [[-.2, .1], [.2, .1], [0, -.2], [-.4, -.15], [.4, -.15]]) { const sm = new T.Mesh(this.soldierGeos.tmp || (this.soldierGeos.tmp = buildSoldier([200, 200, 200])), mat); sm.position.set(x, 0, z); sm.castShadow = true; grp.add(sm); sol.push(sm); }
        const pole = new T.Mesh(new T.CylinderGeometry(.02, .02, 1.1, 5), new T.MeshLambertMaterial({ color: 0x4a3624 })); pole.position.set(0, .55, -.05); grp.add(pole);
        const flag = new T.Mesh(this.flagGeo.clone(), new T.MeshLambertMaterial({ color: 0xffffff, side: T.DoubleSide })); flag.position.set(0, 1.05, -.05); flag.scale.setScalar(.65); flag.userData.base = flag.geometry.attributes.position.array.slice(); grp.add(flag);
        this.scene.add(grp); s = this.marchObjs[m.id] = { grp, mat, flag, sol, lab: this.mkBadge('', 0x2a2f38) }; s.lab.el.classList.add('march');
      }
      s.m = m; const col = parseInt(PLAYER_COLORS[(m.slot < 0 ? 0 : m.slot) % 10].slice(1), 16);
      s.col = col; s.flag.material.color.setRGB(LIN(col >> 16 & 255), LIN(col >> 8 & 255), LIN(col & 255));
      const geo = this.soldierGeos[col] || (this.soldierGeos[col] = buildSoldier(hexRGB(col)));
      s.sol.forEach(sm => { sm.geometry = geo; });
      const n = m.troops.n != null ? m.troops.n : Object.values(m.troops).reduce((a, b) => a + b, 0);
      const txt = (m.own ? '' : m.name + ' · ') + (m.mode === 'attack' ? '⚔ ' : m.mode === 'station' ? '🛡 ' : '') + n;
      this.setBadge(s.lab, txt, 0x2a2f38); s.lab.el.style.borderColor = '#' + col.toString(16).padStart(6, '0');
    }
    for (const id in this.marchObjs) if (!keep.has(Number(id))) { const s = this.marchObjs[id]; this.scene.remove(s.grp); s.lab.el.remove(); delete this.marchObjs[id]; }
  }

  /* ---------- Revier und Außenposten ---------- */
  rectList() {
    const v = this.view, gt = this.gtNow(), grp = p => p.ally ? 'a' + p.ally : 'p' + p.id;
    const al = (v.match.alliances || []).find(a => a.leader === this.myId), ops = v.world.outposts || [];
    const show = al && !ops.some(o => o.al === al.id && gt >= o.done);
    const cities = show ? v.match.players.filter(p => p.id === this.myId && !p.out && p.slot >= 0).map(p => ({ pid: p.id, x: p.pos[0], y: p.pos[1], rathaus: p.rathaus, group: grp(p) })) : [];
    return rectsOf(cities, ops, gt);
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
    const line = new T.Mesh(lg, new T.MeshBasicMaterial({ color: rgb, transparent: true, opacity: lineA, depthWrite: false, depthTest: false, side: T.DoubleSide })); line.renderOrder = 30; grp.add(line);
    return grp;
  }
  drawTerritory() {
    for (const g of this.terrObjs) { this.territory.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    this.terrObjs = []; if (!this.view) return;
    const mine = this.view.match.players.find(p => p.id === this.myId), myG = mine ? (mine.ally ? 'a' + mine.ally : 'p' + mine.id) : '';
    for (const r of this.rectList()) {
      const col = r.group[0] === 'a' ? this.allyColor(Number(r.group.slice(1)), r.owner) : this.ownerColor(r.owner), me = r.group === myG;
      const g = this.rectMesh(r.x0, r.y0, r.x1, r.y1, col, r.ready ? (me ? .2 : .14) : .07, r.ready ? .95 : .5, me ? .32 : .24); this.territory.add(g); this.terrObjs.push(g);
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
    const c = this.cam; c.x = clamp(c.x, 3, N - 3); c.z = clamp(c.z, 3, N - 3); c.dist = clamp(c.dist, 12, 150);
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
  dragStart(sx, sy) { this.anchor = this.groundAt(sx, sy); }
  dragMove(sx, sy) {
    if (!this.anchor) return;
    for (let i = 0; i < 2; i++) { const g = this.groundAt(sx, sy); if (!g) return; this.cam.x += this.anchor.x - g.x; this.cam.z += this.anchor.z - g.z; this.updateCamera(); }
  }
  zoomAt(sx, sy, factor) {
    const a = this.groundAt(sx, sy); this.cam.dist /= factor; this.updateCamera();
    const b = a && this.groundAt(sx, sy); if (a && b) { this.cam.x += a.x - b.x; this.cam.z += a.z - b.z; this.updateCamera(); }
  }
  rotateBy(da) { this.cam.yaw += da; this.updateCamera(); }
  // Feld so verschieben, dass es bei (fx, fy) des Bildschirms liegt
  focus(tx, ty, dist, fy = .46) {
    if (dist) this.cam.dist = dist; this.cam.x = tx; this.cam.z = ty; this.updateCamera();
    for (let i = 0; i < 3; i++) { const g = this.groundAt(this.W / 2, this.H * fy); if (!g) break; this.cam.x += tx - g.x; this.cam.z += ty - g.z; this.updateCamera(); }
  }

  /* ---------- Bild für Bild ---------- */
  frame(dt) {
    this.ema = (this.ema || .016) * .97 + Math.min(dt, .2) * .03;
    if (this.time > 3 && !this.perf1 && this.ema > .045) { this.perf1 = 1; this.sun.castShadow = false; this.renderer.shadowMap.enabled = false; this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
    if (this.time > 6 && this.perf1 === 1 && this.ema > .055) { this.perf1 = 2; this.renderer.setPixelRatio(1); this.renderer.setSize(this.W, this.H); }
    dt = Math.min(dt, .1); this.time += dt; const t = this.time; this.waterMat.uniforms.uTime.value = t;
    this.stepFx(dt); this.updateCamera();
    const frustum = this.frustum || (this.frustum = new T.Frustum()), pm = new T.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    const sph = new T.Sphere();
    for (const im of this.treeChunks) { const u = im.userData; sph.set(new T.Vector3(u.cx, u.cy, u.cz), CH * .8 + 4); im.visible = frustum.intersectsSphere(sph); }
    for (const id in this.obj) {
      const h = this.obj[id];
      if (h.fire && h.fire.visible) { h.fire.scale.set(1 + Math.sin(t * 13 + h.o.x) * .15, .85 + Math.sin(t * 17 + h.o.y) * .25, 1); h.fire.rotation.y = t * 2; }
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
      if (!p.still) { const dx = ax + .5 - p.x, dz = ay + .5 - p.y; if (Math.hypot(dx, dz) > .01) s.grp.rotation.y = Math.atan2(dx, dz); }
      s.sol.forEach((sm, k) => { sm.position.y = p.still ? 0 : Math.abs(Math.sin(t * 9 + k * 1.7 + Number(id))) * .06; });
      this.waveFlags([s.flag], t);
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
    this.projectLabels();
    this.renderer.render(this.scene, this.camera);
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
      const h = this.obj[id], o = h.o, k = KIND_R[o.k] || 1.7, hh = o.k === 'start' ? (h.h || 2) * .45 : o.k === 'throne' ? 2 : 1;
      test('obj', id, o.x + .5, h.grp.position.y + hh, o.y + .5, k);
    }
    return best;
  }
  select(sel) { this.sel = sel; }
}
