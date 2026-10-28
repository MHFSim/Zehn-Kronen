// Zehn Kronen – 3D-Stadtansicht: ummauerte Burgstadt mit Gebäuden auf Bauplätzen (Three.js, alle Modelle im Code).
import { KIT } from '/public/map.js';

const { MB, crenels, wallSeg, tower, house, well, crate, barrel, buildCastle, buildFarm, buildWood, buildStone, buildOre, buildUnit, treeGeo,
  SMOKE_VS, SMOKE_FS, hash, mul, LIN, hexRGB, STONE, STONE_D, WOOD, WOOD_D, PLASTER, DARK, LIGHT, GOLD, IRON } = KIT;
let T;
const SC = 1.3, W = 10.6, CUT = 3.2;                  // Rasterfeld in Welteinheiten, halbe Mauerlänge, Eckenabschnitt
const gw = g => (g - 6.5) * SC;                        // Rasterkoordinate → Welt
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const vnoise = (x, z, s = 0) => {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, s), b = hash(ix + 1, iz, s), c = hash(ix, iz + 1, s), d = hash(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const PAD = [150, 138, 114], PATH = [176, 164, 140], TIMBER = [118, 84, 52];

let B_LAYOUT = {};   // Gebäude-ID → Mittelpunkt im Raster (aus rules.js B übergeben)

/* ---------- Gebäudemodelle (Ursprung = Mitte des Bauplatzes, y = 0 Boden) ---------- */
function pad(b, s) { b.box(s, .06, s, 0, 0, 0, mul(PAD, .86)); b.box(s - .22, .05, s - .22, 0, .05, 0, PAD); }
function plotMark(b, s) {   // leerer Bauplatz: Steine und Pflöcke
  b.box(s, .05, s, 0, 0, 0, [124, 108, 82]); b.box(s - .3, .04, s - .3, 0, .05, 0, [146, 124, 90]);
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { b.cyl(.04, .05, .4, 5, x * s * .46, 0, z * s * .46, WOOD_D); b.box(.14, .1, .02, x * s * .46, .3, z * s * .46, [200, 60, 50]); }
  for (let i = 0; i < 6; i++) b.ico(.1 + hash(i, 3, 2) * .08, (hash(i, 1, 2) - .5) * s * .7, .08, (hash(i, 2, 2) - .5) * s * .7, [150, 146, 134], .6);
}
function scaffold(s, h) {   // Baugerüst + Kran
  const b = new MB(), r = s * .54, y1 = h;
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.cyl(.04, .04, y1, 5, x * r, 0, z * r, WOOD);
  for (let k = 1; k <= 3; k++) {
    const y = y1 * k / 3.4;
    b.box(r * 2, .05, .06, 0, y, -r, WOOD_D); b.box(r * 2, .05, .06, 0, y, r, WOOD_D); b.box(.06, .05, r * 2, -r, y, 0, WOOD_D); b.box(.06, .05, r * 2, r, y, 0, WOOD_D);
    b.box(r * .5, .04, r * .35, r * .6, y + .02, r * .6, [168, 134, 88]);
  }
  b.box(.05, y1, .05, 0, 0, 0, WOOD_D, 0, 0, 0); b.box(.06, y1 * .9, .05, r, 0, r, WOOD_D, .0, .0, .5);
  for (let i = 0; i < 3; i++) b.box(.4, .3, .4, -r * .8 + i * .3, 0, r * 1.3, [150, 118, 76]);
  b.cyl(.05, .05, y1 + .5, 5, -r * 1.25, 0, -r * 1.25, WOOD_D);
  return b.build();
}
function crane(h) { const b = new MB(); b.box(1.7, .06, .06, .55, 0, 0, WOOD_D); b.box(.5, .08, .08, -.55, -.04, 0, IRON); b.cyl(.01, .01, .6, 3, 1.1, -.6, 0, [90, 80, 70]); b.box(.2, .15, .2, 1.1, -.75, 0, [166, 130, 84]); return b.build(); }

const MODELS = {
  farm(lv, pc) { const m = buildFarm(lv); return { geo: m.geo, s: .66, h: 1.5, smoke: [], noPad: true, padS: 2.5 }; },
  saege(lv, pc) { const m = buildWood(lv); return { geo: m.geo, s: .9, h: 1.5, smoke: m.smoke.map(o => [o[0] * .9, o[1] * .9, o[2] * .9]), padS: 2.5 }; },
  stein(lv, pc) { const m = buildStone(lv); return { geo: m.geo, s: .78, h: 1.9, smoke: [], padS: 2.5 }; },
  mine(lv, pc) { const m = buildOre(lv); return { geo: m.geo, s: .88, h: 1.5, smoke: [], padS: 2.5 }; },
  lager(lv, pc) {
    const b = new MB(), n = 1 + (lv >= 8) + (lv >= 15);
    b.box(1.9, .85, 1.25, 0, .06, -.15, [152, 118, 80]); for (let i = 0; i < 12; i++) b.box(.02, .85, 1.27, -.88 + i * .16, .06, -.15, mul([152, 118, 80], .9 + (i % 2) * .16));
    b.box(1.95, .08, 1.3, 0, .55, -.15, WOOD_D); b.gable(2.25, 1.65, .85, 0, .91, -.15, [108, 74, 50], Math.PI);
    b.box(.78, .64, .05, 0, .06, .5, DARK); b.box(.84, .06, .07, 0, .7, .5, TIMBER); b.box(.06, .66, .07, -.4, .06, .5, TIMBER); b.box(.06, .66, .07, .4, .06, .5, TIMBER);
    b.box(.34, .52, .03, -.2, .07, .54, [138, 100, 62], .0); b.box(.34, .52, .03, .2, .07, .54, [138, 100, 62]);
    b.box(.2, .26, .03, .0, 1.2, .62, LIGHT);   // Dachluke
    b.box(.06, .5, .06, 1.1, .06, .1, WOOD_D); b.box(.5, .05, .05, .85, .55, .1, WOOD_D); b.cyl(.012, .012, .3, 3, .65, .26, .1, IRON);
    for (let i = 0; i < n + 1; i++) { crate(b, -.95 + (i % 2) * .26, .78 + (i > 1 ? .2 : 0) * 0, .06 + (i > 1 ? .2 : 0), .24, .2 * i); }
    crate(b, -.82, .78, .06, .22, .3); crate(b, -.56, .84, .06, .22, -.2); crate(b, -.7, .8, .28, .2, .1);
    barrel(b, .85, .82, .06); barrel(b, 1.05, .74, .06); barrel(b, .95, 1.0, .06);
    for (let i = 0; i < 3 + n; i++) b.sph(.15, .2 + i * .22, .15, .92, [214, 196, 150], 6, .8);
    return { geo: b.build(), s: 1, h: 1.8, smoke: [], padS: 2.5 };
  },
  kaserne(lv, pc, ctx) {
    const b = new MB(), roof = [pc[0] * .85, pc[1] * .85, pc[2] * .85];
    b.box(1.9, .5, .95, 0, .06, -.65, [160, 150, 134]); b.box(1.9, .55, .95, 0, .56, -.65, [196, 168, 128]);
    for (const x of [-.9, -.3, .3, .9]) b.box(.07, .55, .98, x, .56, -.65, WOOD_D);
    b.box(1.96, .06, 1.0, 0, .56, -.65, WOOD_D); b.gable(2.2, 1.25, .75, 0, 1.11, -.65, roof, Math.PI);
    b.box(.5, .46, .05, 0, .06, -.15, DARK); b.box(.56, .06, .07, 0, .52, -.15, WOOD_D);
    for (const x of [-.65, .65]) { b.box(.2, .26, .04, x, .72, -.16, DARK); b.box(.13, .2, .05, x, .74, -.15, LIGHT); }
    b.box(.34, .36, .12, 0, .06, -.1, [160, 150, 134]);
    for (let i = -4; i <= 4; i++) { b.cyl(.035, .04, .5, 5, i * .26, .06, 1.08, WOOD); b.cone(.04, .1, 5, i * .26, .56, 1.08, WOOD_D); }   // Palisade
    for (let i = -4; i <= 4; i += 8) { b.cyl(.035, .04, .5, 5, i * .26, .06, .5, WOOD); }
    b.box(.06, .06, 1.2, -1.04, .35, .5, WOOD_D); b.box(.06, .06, 1.2, 1.04, .35, .5, WOOD_D);
    for (let i = 0; i < 6; i++) { b.cyl(.035, .04, .5, 5, -1.04, .06, -.1 + i * .22, WOOD); b.cyl(.035, .04, .5, 5, 1.04, .06, -.1 + i * .22, WOOD); }
    b.cyl(.04, .05, .7, 5, -.75, .06, .5, WOOD_D); b.sph(.12, -.75, .82, .5, [190, 160, 110], 6); b.box(.5, .05, .06, -.75, .55, .5, WOOD_D);          // Übungspuppe
    b.box(.55, .05, .1, .62, .25, .4, WOOD_D); b.cyl(.012, .012, .8, 3, .45, .26, .42, WOOD); b.cyl(.012, .012, .8, 3, .6, .26, .42, WOOD); b.cyl(.012, .012, .8, 3, .75, .26, .42, WOOD);
    b.cyl(.025, .025, 1.5, 5, 1.0, .06, -.2, WOOD_D); ctx.flags.push([1.0, 1.4, -.2]);
    return { geo: b.build(), s: 1, h: 1.9, smoke: [], padS: 2.5, units: [['schwert', .55, 0, .55, .35, 0], ['schwert', -.45, 0, .62, .3, 2], ['schwert', .0, 0, .78, .4, 4]] };
  },
  schiess(lv, pc, ctx) {
    const b = new MB(), roof = [70, 108, 62];
    for (const [x, z] of [[-.9, -.9], [.9, -.9], [-.9, -.1], [.9, -.1]]) { b.cyl(.06, .07, .95, 6, x, .06, z, WOOD); }
    b.box(2.0, .06, .96, 0, 1.0, -.5, WOOD_D); b.gable(2.3, 1.4, .55, 0, 1.06, -.5, roof, Math.PI); b.box(1.9, .5, .06, 0, .06, -.92, [170, 130, 84]);
    b.box(.7, .16, .26, 0, .06, -.5, WOOD); b.box(.7, .06, .26, 0, .3, -.5, WOOD_D);
    for (let i = 0; i < 4; i++) b.cyl(.012, .012, .42, 3, -.7 + i * .05, .09, -.28, WOOD_D);
    for (const x of [-.8, 0, .8]) {
      b.cyl(.03, .035, .55, 5, x, .06, 1.5, WOOD_D); b.cyl(.03, .035, .55, 5, x + .22, .06, 1.5, WOOD_D);
      b.push(new T.CylinderGeometry(.3, .3, .07, 14), [226, 206, 150], x + .11, .75, 1.46, 0, 1, 1, 1, Math.PI / 2, 0);
      b.push(new T.CylinderGeometry(.21, .21, .08, 14), [196, 54, 48], x + .11, .75, 1.47, 0, 1, 1, 1, Math.PI / 2, 0);
      b.push(new T.CylinderGeometry(.09, .09, .09, 10), [246, 230, 120], x + .11, .75, 1.48, 0, 1, 1, 1, Math.PI / 2, 0);
      b.cyl(.008, .008, .18, 3, x + .11 + .1, .72, 1.4, WOOD_D);
    }
    b.cyl(.025, .025, 1.2, 5, 1.05, .06, .3, WOOD_D); ctx.flags.push([1.05, 1.1, .3]);
    return { geo: b.build(), s: 1, h: 1.7, smoke: [], padS: 2.5, units: [['bogen', .5, 0, .45, .3, 1], ['bogen', -.6, 0, .45, .3, 3]] };
  },
  stall(lv, pc, ctx) {
    const b = new MB(), roof = [128, 88, 62];
    b.box(2.2, .7, .9, 0, .06, -.75, [176, 136, 92]); for (let i = 0; i < 14; i++) b.box(.02, .7, .92, -1.0 + i * .16, .06, -.75, mul([176, 136, 92], .9 + (i % 2) * .16));
    b.gable(2.5, 1.2, .7, 0, .76, -.75, roof, Math.PI); b.box(2.24, .06, .94, 0, .74, -.75, WOOD_D);
    for (const x of [-.65, 0, .65]) { b.box(.5, .52, .05, x, .06, -.28, DARK); b.box(.56, .06, .07, x, .56, -.28, WOOD_D); b.box(.5, .22, .05, x, .06, -.25, WOOD, 0); }
    for (let i = 0; i < 3; i++) { b.box(.4, .2, .24, -.9 + i * .38, .06, .0, [212, 184, 80]); }
    b.box(.5, .24, .3, .9, .06, .0, [212, 184, 80]);
    for (let i = -4; i <= 4; i++) b.cyl(.025, .03, .4, 5, i * .27, .06, 1.3, WOOD);
    b.box(2.3, .04, .04, 0, .3, 1.3, WOOD_D); b.box(2.3, .04, .04, 0, .15, 1.3, WOOD_D);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) b.cyl(.025, .03, .4, 5, s * 1.1, .06, .05 + i * .31, WOOD);
    b.box(.04, .04, 1.4, -1.1, .3, .7, WOOD_D); b.box(.04, .04, 1.4, 1.1, .3, .7, WOOD_D);
    b.cyl(.025, .025, 1.3, 5, -1.15, .06, -.1, WOOD_D); ctx.flags.push([-1.15, 1.2, -.1]);
    return { geo: b.build(), s: 1, h: 1.7, smoke: [], padS: 2.5, units: [['schwer', -.4, 0, .75, .3, 0], ['schwer', .5, 0, .8, .3, 3]] };
  },
  lazarett(lv, pc) {
    const b = new MB();
    b.box(1.7, .75, 1.1, 0, .06, -.4, [230, 224, 206]); b.box(1.74, .07, 1.14, 0, .06, -.4, [150, 140, 120]); b.box(1.74, .06, 1.14, 0, .5, -.4, [188, 176, 150]);
    b.gable(2.0, 1.45, .75, 0, .81, -.4, [176, 74, 64], Math.PI); b.box(.4, .56, .05, 0, .06, .16, DARK); b.box(.46, .06, .07, 0, .6, .16, [188, 176, 150]);
    for (const x of [-.6, .6]) { b.box(.22, .3, .04, x, .36, .16, DARK); b.box(.14, .24, .05, x, .38, .17, LIGHT); }
    b.box(.34, .34, .05, 0, .98, .34, [236, 232, 220]); b.box(.28, .08, .06, 0, 1.11, .35, [200, 40, 40]); b.box(.08, .28, .06, 0, 1.01, .35, [200, 40, 40]);
    b.box(.5, .5, .06, 0, 1.46, -.12, [236, 232, 220], 0); b.box(.4, .1, .07, 0, 1.66, -.1, [200, 40, 40]); b.box(.1, .4, .07, 0, 1.51, -.1, [200, 40, 40]);
    b.cyl(.025, .025, .6, 4, 0, 1.2, -.12, WOOD_D);
    for (const [x, z] of [[-.95, .9], [-.35, 1.0]]) { b.cone(.42, .55, 4, x, .06, z, [236, 232, 216]); b.box(.3, .08, .46, x, .06, z + .08, [200, 190, 170]); }
    for (let i = 0; i < 4; i++) { b.box(.4, .08, .16, .75, .06, .5 + i * .22, [92, 66, 44]); for (let j = 0; j < 3; j++) b.ico(.06, .6 + j * .14, .2, .5 + i * .22, [88 + j * 16, 150, 70], 1); }
    return { geo: b.build(), s: 1, h: 1.8, smoke: [], padS: 2.5 };
  },
  akademie(lv, pc, ctx) {
    const b = new MB(), cap = [60, 98, 170];
    b.cyl(.95, 1.0, .12, 14, 0, .0, 0, [190, 182, 166]); b.cyl(.85, .9, .1, 14, 0, .12, 0, [210, 202, 186]);
    b.cyl(.62, .66, 1.4, 14, 0, .22, 0, [226, 218, 198]); b.cyl(.66, .66, .06, 14, 0, .7, 0, [188, 176, 150]);
    for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; b.cyl(.06, .06, 1.25, 6, Math.cos(a) * .86, .22, Math.sin(a) * .86, [238, 232, 216]); b.cyl(.09, .09, .05, 6, Math.cos(a) * .86, .22, Math.sin(a) * .86, [200, 192, 172]); b.cyl(.09, .09, .05, 6, Math.cos(a) * .86, 1.46, Math.sin(a) * .86, [200, 192, 172]); }
    b.cyl(1.02, 1.02, .08, 14, 0, 1.5, 0, [214, 206, 186]);
    b.push(new T.SphereGeometry(.78, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap, 0, 1.55, 0, 0, 1, 1.1, 1);
    b.cyl(.02, .02, .5, 4, 0, 2.35, 0, GOLD); b.sph(.07, 0, 2.88, 0, GOLD, 6);
    for (let i = 0; i < 4; i++) { const a = i * 1.5708 + .78; b.box(.16, .34, .05, Math.cos(a) * .64, .7, Math.sin(a) * .64, DARK, -a + Math.PI / 2); b.box(.1, .26, .05, Math.cos(a) * .66, .72, Math.sin(a) * .66, LIGHT, -a + Math.PI / 2); }
    b.box(.4, .5, .05, 0, .22, .64, DARK); b.box(.46, .06, .07, 0, .72, .64, [188, 176, 150]);
    for (let i = 0; i < 3; i++) b.box(.8 - i * .06, .05, .1, 0, .12 + i * .04, .98 - i * .08, [200, 192, 176]);
    b.cyl(.025, .025, 1.0, 5, 1.1, .06, .7, WOOD_D); ctx.flags.push([1.1, .9, .7]);
    b.box(.34, .06, .22, -1.0, .3, .7, WOOD); b.box(.3, .04, .18, -1.0, .36, .7, [200, 60, 50]); b.box(.04, .3, .04, -1.1, .06, .62, WOOD_D); b.box(.04, .3, .04, -.9, .06, .78, WOOD_D);
    return { geo: b.build(), s: 1, h: 2.3, smoke: [], padS: 2.5, noPad: true };
  },
};

/* ---------- Szene: Mauer, Tore, Wege, Landschaft ---------- */
function wallRing(pc, lvM, roofCol) {
  const b = new MB(), h = 1.7 + Math.min(lvM, 20) * .035, wd = .62, ST = [176, 168, 150], STD = mul(ST, .88), roof = roofCol || pc;
  const V = [[-(W - CUT), -W], [W - CUT, -W], [W, -(W - CUT)], [W, W - CUT], [W - CUT, W], [-(W - CUT), W], [-W, W - CUT], [-W, -(W - CUT)]];
  const flags = [], g = 1.25;                                                              // g = halbe Torbreite
  const seg = (a, c, col) => { wallSeg(b, a[0], a[1], c[0], c[1], 0, h, wd, col); crenels(b, a[0], a[1], c[0], c[1], h, col, .5); };
  for (let i = 0; i < 8; i++) {
    const a = V[i], c = V[(i + 1) % 8];
    if (i === 4) { seg(a, [g + .35, W], ST); seg([-(g + .35), W], c, ST); } else seg(a, c, i < 2 || i > 5 ? STD : ST);
  }
  for (let i = 0; i < 8; i++) {
    const [x, z] = V[i]; tower(b, x, z, .38, .85, h + .9 + (i % 2) * .3 + lvM * .01, 1.35, roof, ST, flags);
  }
  for (const x of [-(W - CUT) / 2, (W - CUT) / 2]) { tower(b, x, -W, .38, .6, h + .5, .9, roof, ST, null, false); }
  for (const z of [-(W - CUT) / 2, (W - CUT) / 2]) { tower(b, -W, z, .38, .6, h + .5, .9, roof, ST, null, false); tower(b, W, z, .38, .6, h + .5, .9, roof, ST, null, false); }
  // Torhaus
  const gz = W, gh = h + .75;
  for (const s of [-1, 1]) {
    b.box(.9, gh, 1.1, s * (g + .45), 0, gz, mul(ST, 1.05)); b.box(1.0, .07, 1.2, s * (g + .45), gh * .5, gz, mul(ST, 1.15)); crenels(b, s * (g + .1), gz - .45, s * (g + .8), gz - .45, gh, ST, .4); crenels(b, s * (g + .1), gz + .45, s * (g + .8), gz + .45, gh, ST, .4);
    b.cyl(.04, .05, .5, 5, s * (g + .45), gh, gz + .1, WOOD_D);
    b.box(.46, 1.3, .05, s * (g + .45), gh * .22, gz + .6, pc); b.box(.46, .07, .07, s * (g + .45), gh * .22 + 1.28, gz + .6, GOLD);
    b.box(.2, .26, .07, s * (g + .45), gh * .22 + .8, gz + .63, GOLD); b.box(.12, .18, .08, s * (g + .45), gh * .22 + .82, gz + .64, mul(pc, .55));
  }
  b.box(g * 2 + .2, 1.0, 1.1, 0, h + .05, gz, mul(ST, 1.1)); b.box(g * 2 + .3, .1, 1.2, 0, h + .05, gz, mul(ST, 1.2)); crenels(b, -g, gz + .5, g, gz + .5, h + 1.05, ST, .4);
  b.box(g * 2, h + .05, 1.0, 0, 0, gz, DARK);
  for (let i = -3; i <= 3; i++) b.box(.04, h * .92, .04, i * g * .3, .06, gz + .5, [64, 58, 54]); for (let k = 0; k < 4; k++) b.box(g * 2, .04, .04, 0, .3 + k * .35, gz + .5, [64, 58, 54]);
  for (let i = 0; i < 28; i++) b.box(g * 1.7, .06, .17, 0, .0, gz + .4 + i * .16, mul(PATH, .86 + hash(i, 2, 8) * .3), 0);
  b.box(.7, .5, .04, -g * .55, h + .15, gz + .55, mul(pc, .9)); b.box(.7, .5, .04, g * .55, h + .15, gz + .55, mul(pc, .9)); b.box(.2, .25, .05, 0, h + .6, gz + .56, GOLD);
  b.gable(g * 2 + .4, 1.1, .6, 0, h + 1.15, gz, mul(roof, .9), Math.PI);
  for (const s of [-1, 1]) { b.cyl(.03, .03, .7, 5, s * (g + .1), .0, gz + 1.0, WOOD_D); b.cone(.1, .2, 6, s * (g + .1), .7, gz + 1.0, LIGHT); }
  return { geo: b.build(), flags, wallH: h };
}
const SEGS = [[4, 4, 9, 4], [4, 9, 9, 9], [4, 4, 4, 9], [9, 4, 9, 9], [4, 4, 2, 2], [9, 4, 11, 2], [4, 9, 2, 11], [9, 9, 11, 11],
  [4, 5, 3, 5], [4, 8, 3, 8], [9, 5, 10, 5], [9, 8, 10, 8], [5, 4, 5, 3], [8, 4, 8, 3]];
const segWorld = () => SEGS.map(([a, b, c, d]) => [gw(a), gw(b), gw(c), gw(d)]).concat([[0, gw(9), 0, W + 4.6]]);
const distSeg = (px, pz, [ax, az, bx, bz]) => { const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1); return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
function cobble(b, ax, az, bx, bz, w, y = 0) {
  const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len, nx = -dz, nz = dx, ry = Math.atan2(-(bz - az), bx - ax), mx = (ax + bx) / 2, mz = (az + bz) / 2;
  b.box(len + .34, .03, w + .34, mx, y, mz, [92, 78, 58], ry);
  const rows = Math.max(2, Math.round(w / .2)), cols = Math.max(2, Math.round(len / .25));
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const k = i * 31 + j * 7 + Math.round(ax * 13 + bz * 5), u = ((i + .5) / cols - .5) * len + ((j & 1) ? .07 : 0), v = ((j + .5) / rows - .5) * w, edge = j === 0 || j === rows - 1;
    const c = edge ? mul([150, 142, 126], .84 + hash(k, 1, 5) * .24) : mul(hash(k, 2, 5) > .86 ? [160, 150, 128] : PATH, .8 + hash(k, 3, 5) * .3);
    b.box(len / cols * .88, edge ? .075 : .055, w / rows * .86, mx + dx * u + nx * v, y + .02, mz + dz * u + nz * v, c, ry + (hash(k, 4, 5) - .5) * .22, 0, 0);
  }
}
function pathGeo() {
  const b = new MB();
  for (const [ax, az, bx, bz] of segWorld()) cobble(b, ax, az, bx, bz, ax === bx && ax === 0 ? 1.5 : .95);
  // Kreisplatz mit Brunnen und Denkmal
  const pz = gw(10.6);
  b.cyl(1.9, 1.95, .05, 24, 0, 0, pz, [92, 78, 58]);
  for (let r = 0; r < 5; r++) { const rad = .95 + r * .2, n = Math.round(rad * 6.28 / .24); for (let i = 0; i < n; i++) { const a = i / n * 6.283 + r * .3; b.box(.2, .05, .17, Math.cos(a) * rad, .02, pz + Math.sin(a) * rad, mul(PATH, .8 + hash(i, r, 7) * .3), -a); } }
  b.cyl(.88, .94, .26, 18, 0, .04, pz, STONE); b.cyl(.76, .8, .16, 18, 0, .3, pz, mul(STONE, 1.08)); b.cyl(.68, .68, .03, 18, 0, .45, pz, [58, 124, 156]);
  b.cyl(.2, .26, .36, 10, 0, .3, pz, STONE_D); b.cyl(.12, .16, .5, 10, 0, .62, pz, mul(STONE, 1.1)); b.cyl(.3, .12, .1, 10, 0, 1.0, pz, mul(STONE, 1.12)); b.cyl(.26, .26, .03, 10, 0, 1.1, pz, [66, 130, 164]);
  b.box(.3, .26, .3, 0, 1.12, pz, [224, 218, 202]); b.box(.2, .8, .2, 0, 1.38, pz, [232, 226, 210]); b.cone(.15, .3, 4, 0, 2.18, pz, GOLD); b.sph(.07, 0, 2.52, pz, GOLD, 6);
  for (let i = 0; i < 4; i++) { const a = i * 1.5708 + .78; b.box(.1, .3, .1, Math.cos(a) * .6, .45, pz + Math.sin(a) * .6, [214, 208, 192]); b.sph(.06, Math.cos(a) * .6, .78, pz + Math.sin(a) * .6, LIGHT, 6); }
  // Marktstände neben dem Platz
  const stand = (x, z, ry, c1) => {
    b.box(.9, .06, .52, x, .3, z, WOOD, ry); b.box(.84, .3, .46, x, 0, z, WOOD_D, ry);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const ox = Math.cos(ry) * sx * .42 + Math.sin(ry) * sz * .24, oz = -Math.sin(ry) * sx * .42 + Math.cos(ry) * sz * .24; b.cyl(.02, .02, .9, 4, x + ox, 0, z + oz, WOOD_D); }
    for (let i = 0; i < 8; i++) { const u = (i / 8 - .44) * .98; b.box(.115, .035, .66, x + Math.cos(ry) * u, .92 + (i % 2 ? .0 : .0), z - Math.sin(ry) * u, i % 2 ? [236, 232, 220] : c1, ry, 0, .0); }
    for (let i = 0; i < 4; i++) b.sph(.07, x + Math.cos(ry) * (i - 1.5) * .2, .4, z - Math.sin(ry) * (i - 1.5) * .2, [[210, 70, 50], [230, 190, 70], [110, 160, 70], [200, 120, 60]][i], 6);
  };
  stand(-2.75, pz + .3, Math.PI / 2, [190, 60, 50]); stand(2.75, pz + .3, Math.PI / 2, [60, 100, 170]);
  // Laternen am Ring
  for (const [gx, gy] of [[4, 4], [9, 4], [4, 9], [9, 9]]) { const x = gw(gx) + .6, z = gw(gy) + .6; b.cyl(.025, .03, 1.1, 5, x, 0, z, [60, 54, 50]); b.box(.14, .18, .14, x, 1.05, z, LIGHT); b.cone(.12, .12, 4, x, 1.22, z, [60, 54, 50]); }
  return b.build();
}
function groundMesh(THREE) {
  // Inneres Gras mit Farbflecken
  const n = 72, S = W * 2 + .6, g = new T.PlaneGeometry(S, S, n, n); g.rotateX(-Math.PI / 2);
  const P = g.attributes.position, col = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i), a = vnoise(x * .4, z * .4, 3), b = vnoise(x * 1.7, z * 1.7, 5), k = .8 + a * .3 + b * .12;
    const c = mixc([86, 140, 58], [132, 170, 74], clamp(a * 1.4 - .2, 0, 1)); const d = clamp(b - .6, 0, 1) * .6;
    col[i * 3] = LIN(Math.min(255, (c[0] * (1 - d) + 214 * d * .5) * k)); col[i * 3 + 1] = LIN(Math.min(255, c[1] * k)); col[i * 3 + 2] = LIN(Math.min(255, c[2] * k));
    P.setY(i, .0);
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3)); g.computeVertexNormals();
  return g;
}
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dOct = (x, z) => Math.max(Math.max(Math.abs(x), Math.abs(z)) - W, (Math.abs(x) + Math.abs(z) - (2 * W - CUT)) / 1.4142);
const MOAT0 = 1.5, MOAT1 = 4.4;
const hOut = (x, z) => {
  const d = Math.max(dOct(x, z), 0), r = Math.hypot(x, z);
  if (d < 2.2) return -.05;
  const t = smooth(2.2, 44, d), n = vnoise(x * .06, z * .06, 11) * 5 + vnoise(x * .17, z * .17, 12) * 1.4;
  return t * (n * .9 + 2) - .05 + smooth(55, 120, r) * 14;
};
function outerGround() {
  const S = 300, n = 300, g = new T.PlaneGeometry(S, S, n, n); g.rotateX(-Math.PI / 2);
  const P = g.attributes.position, col = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i), y = hOut(x, z), d = Math.max(dOct(x, z), 0), a = vnoise(x * .09, z * .09, 4), b = vnoise(x * .5, z * .5, 6);
    let c = mixc([76, 128, 52], [116, 160, 66], a); c = mixc(c, [150, 126, 86], (1 - smooth(MOAT1, MOAT1 + 6, d)) * .5 * (.5 + b)); c = mixc(c, [128, 120, 106], smooth(8, 20, y)); c = mixc(c, [236, 240, 246], smooth(15, 22, y));
    const k = .86 + b * .22; col[i * 3] = LIN(c[0] * k); col[i * 3 + 1] = LIN(c[1] * k); col[i * 3 + 2] = LIN(c[2] * k); P.setY(i, y);
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}
// Material mit feiner Körnung (Stein, Holz) und Grashalmen auf grünen Flächen
function detailMat() {
  const m = new T.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 wq = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwq = instanceMatrix * wq;\n#endif\nvWP = (modelMatrix * wq).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWP;
float zh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float zn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(zh(i),zh(i+vec2(1.,0.)),f.x), mix(zh(i+vec2(0.,1.)),zh(i+vec2(1.,1.)),f.x), f.y); }`).replace('#include <color_fragment>', `#include <color_fragment>
{ vec3 q = vWP; float a = (zn(q.xz*3.1)+zn(q.xy*3.1+7.)+zn(q.zy*3.1+13.))/3.0; float b = (zn(q.xz*14.)+zn(q.xy*14.+3.)+zn(q.zy*14.+9.))/3.0;
  float g = clamp(diffuseColor.g*2.2 - diffuseColor.r*1.2 - diffuseColor.b*.6, 0.0, 1.0);
  float bl = zn(vec2(q.x*46.0, q.z*8.0)) * zn(vec2(q.x*6.0, q.z*50.0));
  diffuseColor.rgb *= .84 + a*.2 + b*.12 + g*(bl-.25)*.3; diffuseColor.rg += vec2(.012,.024)*g*a; }`);
  };
  return m;
}
const WATER_V = `varying vec3 vW;
#include <fog_pars_vertex>
void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix*wp; gl_Position = projectionMatrix*mvPosition;
#include <fog_vertex>
}`;
const WATER_F = `uniform float uTime; varying vec3 vW;
#include <fog_pars_fragment>
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x), mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x), f.y); }
void main(){
  vec2 p = vW.xz*.9; float t = uTime;
  float n = vn(p*1.3+vec2(t*.25,t*.12))*.55 + vn(p*3.1-vec2(t*.2,-t*.3))*.45;
  vec3 col = mix(vec3(.10,.40,.50), vec3(.05,.24,.38), n);
  float w = sin(vW.x*3.2+t*1.6+n*5.0)*sin(vW.z*2.8-t*1.2+n*4.0); col += vec3(.05,.08,.09)*w;
  float sp = pow(max(0.0, sin((vW.x*1.3+vW.z)*4.0+t*2.6+n*9.0)), 36.0)*vn(p*3.0+t*.5); col += vec3(.75,.85,.85)*sp;
  gl_FragColor = vec4(col, .9);
#include <fog_fragment>
}`;
function villager(tunic, hat) {
  const body = new MB(), la = new MB(), lb = new MB(), SK = [226, 190, 150];
  body.box(.14, .22, .1, 0, .2, 0, tunic); body.box(.15, .04, .105, 0, .2, 0, [90, 70, 50]); body.sph(.052, 0, .5, 0, SK, 7);
  body.cone(.075, .09, 7, 0, .52, 0, hat); body.box(.04, .15, .05, -.095, .26, 0, mul(tunic, .9)); body.box(.04, .15, .05, .095, .26, 0, mul(tunic, .9));
  la.box(.05, .18, .055, -.04, -.18, 0, [86, 68, 50]); lb.box(.05, .18, .055, .04, -.18, 0, [86, 68, 50]);
  return { body: body.build(), la: la.build(), lb: lb.build(), hip: .18 };
}
function shadowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 4, 32, 32, 31);
  g.addColorStop(0, 'rgba(0,0,0,.7)'); g.addColorStop(.6, 'rgba(0,0,0,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new T.CanvasTexture(c); return t;
}

export class CityView {
  constructor(THREE, host, opts) {
    T = THREE; KIT.use(THREE);
    this.host = host; this.opts = opts || {}; this.color = 0x3a6fd0; this.infos = {}; this.layout = {};
    const r = this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.outputEncoding = T.sRGBEncoding; r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    this.dom = r.domElement; this.dom.style.touchAction = 'none'; host.appendChild(this.dom);
    const sky = 0xb4d4ea; this.scene = new T.Scene(); this.scene.background = new T.Color(sky); this.scene.fog = new T.Fog(0xc4dcec, 70, 230);
    this.camera = new T.PerspectiveCamera(32, 1, 1, 600);
    r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.28;
    this.scene.add(new T.HemisphereLight(0xd6e8ff, 0x7e7648, .8));
    const fill = new T.DirectionalLight(0xa9c2ff, .35); fill.position.set(18, 10, -14); this.scene.add(fill);
    this.sun = new T.DirectionalLight(0xffe9c2, 1.55); this.sun.position.set(-16, 26, 14); this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -19; sc.right = 19; sc.top = 19; sc.bottom = -19; sc.near = 4; sc.far = 80; this.sun.shadow.bias = -.0006; this.sun.shadow.normalBias = .05;
    this.scene.add(this.sun, this.sun.target);
    this.matVC = detailMat();
    this.labelsEl = document.createElement('div'); this.labelsEl.className = 'clabels'; host.appendChild(this.labelsEl);
    this.cam = { x: 0, z: 1.5, yaw: .42, pitch: .86, dist: 34 }; this.tgt = { yaw: .42, dist: 34 };
    this.time = 0; this.units = []; this.flagMeshes = []; this.bld = {}; this.pick = []; this.smokeList = []; this.bump = {};
    this.build(); this.setupInput(); this.resize(); window.addEventListener('resize', () => this.resize());
    this.updateCamera();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight; this.W = w; this.H = h; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (!this.touched) this.cam.dist = this.fitDist(); this.cam.dist = clamp(this.cam.dist, this.minDist(), 75); this.updateCamera();
  }
  fitDist() { const a = this.W / this.H, t = Math.tan(this.camera.fov * Math.PI / 360); return clamp(14.5 / (t * Math.min(1.25, a)) * .92, 34, 62); }
  minDist() { return 14; }
  mesh(geo, extra) { const m = new T.Mesh(geo, this.matVC); m.castShadow = true; m.receiveShadow = true; if (extra) Object.assign(m.userData, extra); return m; }
  build() {
    const sc = this.scene;
    const og = new T.Mesh(outerGround(), this.matVC); og.receiveShadow = true; sc.add(og);
    const ig = new T.Mesh(groundMesh(), this.matVC); ig.position.y = .02; ig.receiveShadow = true; sc.add(ig);
    const pm = this.mesh(pathGeo()); pm.castShadow = false; sc.add(pm);
    // Berge im Hintergrund
    const mb = new MB();
    for (let i = 0; i < 26; i++) { const a = i / 26 * 6.283 + hash(i, 1, 9) * .2, r = 95 + hash(i, 2, 9) * 40, s = 14 + hash(i, 3, 9) * 22; mb.cone(s, s * (1.1 + hash(i, 4, 9) * .7), 7 + (i % 3), Math.cos(a) * r, -2, Math.sin(a) * r, i % 3 ? [118, 112, 104] : [100, 96, 96], .3); mb.cone(s * .42, s * .55, 7, Math.cos(a) * r, s * .62, Math.sin(a) * r, [240, 244, 248], .1); }
    const mm = new T.Mesh(mb.build(), this.matVC); sc.add(mm);
    this.wallGroup = new T.Group(); sc.add(this.wallGroup);
    this.trees();
    this.smokeN = 160; const sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.BufferAttribute(new Float32Array(this.smokeN * 3), 3)); sg.setAttribute('aA', new T.BufferAttribute(new Float32Array(this.smokeN), 1)); sg.setAttribute('aS', new T.BufferAttribute(new Float32Array(this.smokeN), 1));
    this.smokeMat = new T.ShaderMaterial({ vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } } });
    this.smoke = new T.Points(sg, this.smokeMat); this.smoke.frustumCulled = false; this.smoke.renderOrder = 5; sc.add(this.smoke);
    this.flagGeo = new T.PlaneGeometry(.55, .34, 6, 3); this.flagGeo.translate(.275, 0, 0);
    this.ray = new T.Raycaster(); this.ndc = new T.Vector2();
  }
  trees() {
    const mat = this.matVC, geos = { pine: treeGeo('pine'), oak: treeGeo('oak'), bush: treeGeo('bush'), rock: treeGeo('rock') };
    const GREEN = { pine: [[36, 84, 48], [44, 98, 56]], oak: [[84, 140, 52], [100, 152, 58]], bush: [[76, 120, 56], [92, 134, 60]], rock: [[146, 140, 128], [128, 122, 112]], blossom: [[240, 160, 184], [226, 130, 168]] };
    const lists = { pine: [], oak: [], bush: [], rock: [], blossom: [] };
    for (let i = 0; i < 9000 && lists.pine.length + lists.oak.length < 760; i++) {
      const x = (hash(i, 1, 21) - .5) * 150, z = (hash(i, 2, 21) - .5) * 150, d = Math.max(dOct(x, z), 0);
      if (d < 6 || Math.abs(x) > 74 || Math.abs(z) > 74) continue; const dens = vnoise(x * .05, z * .05, 22); if (dens < .36 && d < 26) continue;
      const k = hash(i, 3, 21); lists[k > .45 ? 'pine' : 'oak'].push([x, hOut(x, z), z, 1.5 + hash(i, 4, 21) * 1.2, hash(i, 5, 21) * 6.28, hash(i, 6, 21)]);
      if (k > .6) lists.bush.push([x + 1, hOut(x + 1, z), z, 1.6, 0, hash(i, 7, 21)]);
      if (k > .93) lists.blossom.push([x - 1.4, hOut(x - 1.4, z), z, 2.1, 0, hash(i, 8, 21)]);
    }
    for (let i = 0; i < 60; i++) { const x = (hash(i, 31, 21) - .5) * 100, z = (hash(i, 32, 21) - .5) * 100, d = Math.max(dOct(x, z), 0); if (d < 6) continue; lists.rock.push([x, hOut(x, z), z, 1.4 + hash(i, 5, 24) * 2, hash(i, 6, 24) * 6, hash(i, 7, 24)]); }
    // Kirschbäume und Büsche im Innenhof (Randstreifen)
    const inn = [[-9.0, -6.2], [-9.0, 6.6], [9.0, -6.2], [9.0, 6.6], [-6.0, -9.1], [6.0, -9.1], [-8.9, 0.2], [8.9, 0.2], [-3.2, 8.6], [3.4, 8.7], [-9.0, 3.6], [9.0, -2.8]];
    inn.forEach(([x, z], i) => lists[i % 3 === 0 ? 'blossom' : i % 3 === 1 ? 'oak' : 'bush'].push([x, .02, z, i % 3 === 2 ? 1.6 : 1.9, i, hash(i, 2, 33)]));
    for (let i = 0; i < 26; i++) { const t = i / 26 * 6.283, x = Math.cos(t) * 7.2 + (hash(i, 1, 40) - .5) * 2, z = Math.sin(t) * 7.2 + (hash(i, 2, 40) - .5); if (Math.abs(x) > 8.4 || Math.abs(z) > 8.4) lists.bush.push([clamp(x, -9.3, 9.3), .02, clamp(z, -9.3, 9.3), 1.2, i, hash(i, 3, 40)]); }
    const tmp = new T.Matrix4(), col = new T.Color(), q = new T.Quaternion(), e = new T.Euler();
    for (const k in lists) {
      const arr = lists[k]; if (!arr.length) continue; const geo = geos[k === 'blossom' ? 'oak' : k], im = new T.InstancedMesh(geo, mat, arr.length);
      arr.forEach(([x, y, z, s, rot, vr], i) => {
        q.setFromEuler(e.set(0, rot, 0)); tmp.compose(new T.Vector3(x, y - .02, z), q, new T.Vector3(s, s * (.9 + vr * .3), s)); im.setMatrixAt(i, tmp);
        const g = GREEN[k][Math.floor(vr * 1.999)]; col.setRGB(LIN(g[0]), LIN(g[1]), LIN(g[2])); im.setColorAt(i, col);
      });
      im.castShadow = k !== 'bush'; im.receiveShadow = false; im.frustumCulled = false; this.scene.add(im);
    }
  }


  decor() {
    const sc = this.scene, mat = this.matVC;
    // Gras, Blumen
    const segs = segWorld(), plots = Object.keys(this.layout || {});
    const tg = new MB(); for (let k = 0; k < 4; k++) tg.push(new T.ConeGeometry(.035, .3 + k % 2 * .08, 4), [255, 255, 255], Math.cos(k * 1.6) * .05, .15, Math.sin(k * 1.6) * .05, k, 1, 1, 1, Math.sin(k * 2.1) * .35, Math.cos(k * 1.3) * .35, 0);
    const tufts = [], flowers = [];
    const free = (x, z) => {
      if (dOct(x, z) > -1.2) return false;
      for (const sg of segs) if (distSeg(x, z, sg) < .78) return false;
      if (Math.hypot(x, z - gw(10.6)) < 2.3) return false;
      for (const id in B_LAYOUT) { const [lx, ly, lw] = B_LAYOUT[id], cx = gw(lx + lw / 2), cz = gw(ly + lw / 2), hh = id === 'rathaus' ? 2.5 : 1.45; if (Math.abs(x - cx) < hh && Math.abs(z - cz) < hh) return false; }
      return true;
    };
    for (let i = 0; i < 9000 && tufts.length < 2600; i++) { const x = (hash(i, 1, 51) - .5) * W * 2.1, z = (hash(i, 2, 51) - .5) * W * 2.1; if (free(x, z)) tufts.push([x, z, .5 + hash(i, 3, 51) * .6, hash(i, 4, 51) * 6.28, hash(i, 5, 51)]); }
    for (let i = 0; i < 4000 && flowers.length < 260; i++) { const x = (hash(i, 6, 52) - .5) * W * 2.1, z = (hash(i, 7, 52) - .5) * W * 2.1; if (free(x, z)) flowers.push([x, z, hash(i, 8, 52)]); }
    const fb = new MB(); fb.cyl(.01, .012, .17, 4, 0, 0, 0, [70, 130, 50]); fb.ico(.05, 0, .2, 0, [255, 255, 255], .7, 1, 0, 0); fb.ico(.03, 0, .22, 0, [255, 220, 120], 1, 1, 0, 0);
    const tm = new T.Matrix4(), tc = new T.Color(), tq = new T.Quaternion(), te = new T.Euler();
    const GR = [[88, 148, 54], [112, 164, 60], [70, 128, 48], [138, 172, 66]], FL = [[240, 120, 150], [250, 220, 90], [250, 250, 250], [170, 130, 230], [240, 150, 60]];
    const tim = new T.InstancedMesh(tg.build(), mat, tufts.length), fim = new T.InstancedMesh(fb.build(), mat, flowers.length);
    tufts.forEach(([x, z, k, r, v], i) => { tq.setFromEuler(te.set(0, r, 0)); tm.compose(new T.Vector3(x, .02, z), tq, new T.Vector3(k, k, k)); tim.setMatrixAt(i, tm); const g = GR[Math.floor(v * 3.99)]; tc.setRGB(LIN(g[0]), LIN(g[1]), LIN(g[2])); tim.setColorAt(i, tc); });
    flowers.forEach(([x, z, v], i) => { tq.setFromEuler(te.set(0, v * 6, 0)); tm.compose(new T.Vector3(x, .02, z), tq, new T.Vector3(1, 1, 1)); fim.setMatrixAt(i, tm); const g = FL[Math.floor(v * 4.99)]; tc.setRGB(LIN(g[0]), LIN(g[1]), LIN(g[2])); fim.setColorAt(i, tc); });
    tim.frustumCulled = false; fim.frustumCulled = false; sc.add(tim, fim);
    // Wiese rund um die Mauern: Gräser und Wildblumen
    const ot = [], of = [];
    for (let i = 0; i < 26000 && ot.length < 7000; i++) { const x = (hash(i, 1, 71) - .5) * 80, z = (hash(i, 2, 71) - .5) * 80, d = dOct(x, z); if (d < 1.2 || d > 36) continue; ot.push([x, z, .6 + hash(i, 3, 71) * .9, hash(i, 4, 71) * 6.28, hash(i, 5, 71)]); }
    for (let i = 0; i < 9000 && of.length < 1100; i++) { const x = (hash(i, 6, 72) - .5) * 80, z = (hash(i, 7, 72) - .5) * 80, d = dOct(x, z); if (d < 1.2 || d > 36 || vnoise(x * .15, z * .15, 5) < .45) continue; of.push([x, z, hash(i, 8, 72)]); }
    const oim = new T.InstancedMesh(tg.build(), mat, ot.length), ofm = new T.InstancedMesh(fb.build(), mat, of.length);
    ot.forEach(([x, z, k, r, v], i) => { tq.setFromEuler(te.set(0, r, 0)); tm.compose(new T.Vector3(x, hOut(x, z) - .02, z), tq, new T.Vector3(k, k, k)); oim.setMatrixAt(i, tm); const g = GR[Math.floor(v * 3.99)]; tc.setRGB(LIN(g[0]), LIN(g[1]), LIN(g[2])); oim.setColorAt(i, tc); });
    of.forEach(([x, z, v], i) => { tq.setFromEuler(te.set(0, v * 6, 0)); tm.compose(new T.Vector3(x, hOut(x, z) - .02, z), tq, new T.Vector3(1.2, 1.2, 1.2)); ofm.setMatrixAt(i, tm); const g = FL[Math.floor(v * 4.99)]; tc.setRGB(LIN(g[0]), LIN(g[1]), LIN(g[2])); ofm.setColorAt(i, tc); });
    oim.frustumCulled = false; ofm.frustumCulled = false; sc.add(oim, ofm);
    // Landschaft vor den Mauern: Felder, Häuser, Weg, Windmühle, Schafe
    const ob = new MB(), rows = (x0, z0, w, d, ry, k) => {
      for (let i = 0; i < 12; i++) { const u = (i + .5) / 12 - .5, cx = x0 + Math.cos(ry) * 0, cz = z0 + u * d; const y = hOut(x0, cz);
        ob.box(w, .1, d / 12 * .78, x0, y, cz, k === 0 ? mul([200, 164, 66], .8 + (i % 2) * .3) : k === 1 ? mul([110, 150, 60], .8 + (i % 2) * .3) : mul([116, 86, 56], .8 + (i % 2) * .26));
        if (k < 2) for (let j = 0; j < 5; j++) ob.cone(.04, .2, 4, x0 - w / 2 + (j + .5) * w / 5, y + .1, cz, k === 0 ? [226, 190, 80] : [90, 160, 70]); }
      ob.box(w + .3, .06, d + .3, x0, hOut(x0, z0) - .02, z0, [96, 78, 52]);
    };
    rows(-W - 8.5, -6, 4.6, 6.4, 0, 0); rows(-W - 8.5, 3, 4.6, 5.6, 0, 1); rows(W + 8.6, -8, 4.6, 6, 0, 2); rows(W + 9, 1, 4.6, 6.4, 0, 0); rows(W + 8.4, 9.5, 4.6, 5.4, 0, 1);
    const hs = [[11, W + 10.5, .3], [16.5, W + 8, -.2], [-12, W + 11, .1], [-17, W + 7.5, -.3], [7, W + 15.5, .2]];
    hs.forEach(([x, z, ry], i) => { const y = hOut(x, z); ob.box(1.6, 2.4, 1.6, x, y - 2.2, z, [120, 108, 84]); house(ob, x, z, y, .9 + hash(i, 1, 9) * .4, 1.0 + hash(i, 2, 9) * .3, .62 + hash(i, 3, 9) * .2, [[170, 62, 48], [60, 100, 170], [150, 100, 54], [60, 130, 80], [140, 70, 100]][i], ry); for (let k = 0; k < 5; k++) ob.cyl(.02, .025, .3, 4, x - .9 + k * .45, y, z + .9, WOOD); ob.box(1.9, .03, .03, x, y + .22, z + .9, WOOD_D); });
    // Landstraße
    const pts = [[0, W + 4.6], [1.8, W + 8], [5.2, W + 11], [10, W + 13.4], [17, W + 15], [25, W + 15.5]];
    for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az), ry = Math.atan2(-(bz - az), bx - ax), y = Math.max(hOut(ax, az), hOut(bx, bz)) + .03; ob.box(len + .5, .07, 1.7, (ax + bx) / 2, y, (az + bz) / 2, mul([156, 130, 90], .9 + hash(i, 1, 6) * .2), ry); for (let k = 0; k < 8; k++) ob.ico(.07, ax + (bx - ax) * k / 8 + (hash(k, i, 1) - .5), y + .05, az + (bz - az) * k / 8 + (hash(k, i, 2) - .5), [150, 144, 130], .5); }
    // Schafe
    for (let i = 0; i < 12; i++) { const x = -W - 6 - hash(i, 1, 31) * 7, z = W - 4 + hash(i, 2, 31) * 9 - 3, y = hOut(x, z); if (dOct(x, z) < 5) continue; ob.ico(.2, x, y + .25, z, [244, 240, 228], .8, 1.2, hash(i, 3, 31) * 3, 1); ob.sph(.09, x + .2, y + .3, z, [60, 54, 50], 6); for (const [ox, oz] of [[-.1, -.08], [.1, -.08], [-.1, .08], [.1, .08]]) ob.cyl(.018, .018, .14, 4, x + ox, y, z + oz, [60, 54, 50]); }
    const om = new T.Mesh(ob.build(), mat); om.castShadow = true; om.receiveShadow = true; sc.add(om);
    // Windmühle mit drehenden Flügeln
    const mx = -W - 15, mz = W - 3, my = hOut(mx, mz), mb = new MB();
    mb.cyl(1.7, 1.9, 1.6, 12, 0, -1.4, 0, [140, 134, 120]); mb.cyl(.95, 1.4, 3.6, 12, 0, .2, 0, [226, 216, 190]); mb.cyl(1.05, 1.05, .12, 12, 0, 1.8, 0, WOOD_D); mb.cone(1.3, 1.5, 12, 0, 3.8, 0, [138, 84, 58]); mb.sph(.1, 0, 5.4, 0, GOLD, 6);
    mb.box(.5, .8, .08, 0, .2, 1.38, WOOD_D); for (let k = 0; k < 3; k++) mb.box(.18, .3, .06, 0, 1.4 + k * .8, 1.2 - k * .08, DARK);
    const mill = this.mesh(mb.build()); mill.position.set(mx, my, mz); sc.add(mill);
    const sb = new MB(); for (let k = 0; k < 4; k++) { const a = k * 1.5708; sb.box(.09, 3.6, .08, 0, 0, 0, WOOD_D, 0, 0, a); sb.box(.55, 1.5, .03, Math.cos(a + 1.5708) * .0 - Math.sin(a) * 1.5, Math.cos(a) * 1.6, .04, [236, 230, 214], 0, 0, a); } sb.cyl(.14, .14, .3, 8, 0, -.15, 0, IRON);
    const sails = this.mesh(sb.build()), spin = new T.Group(); spin.add(sails); spin.position.set(mx, my + 3.3, mz + 1.55); sc.add(spin); this.sails = spin;
    // Dorfbewohner
    this.villagers = []; const vg = [], TUN = [[170, 80, 60], [70, 100, 160], [90, 140, 80], [180, 150, 70], [130, 90, 140], [200, 190, 170]], HAT = [[110, 80, 50], [150, 60, 50], [60, 90, 70], [190, 170, 100]];
    const loop = [[4, 4], [9, 4], [9, 9], [4, 9]].map(([a, b]) => [gw(a), gw(b)]); let perim = 0; const lens = loop.map((p, i) => { const q = loop[(i + 1) % 4], l = Math.hypot(q[0] - p[0], q[1] - p[1]); perim += l; return l; });
    this.loop = { pts: loop, lens, perim };
    for (let i = 0; i < 0; i++) {
      const ug = villager(TUN[i % 6], HAT[i % 4]), g = new T.Group(), body = new T.Mesh(ug.body, mat), la = new T.Mesh(ug.la, mat), lb = new T.Mesh(ug.lb, mat);
      la.position.y = ug.hip; lb.position.y = ug.hip; body.castShadow = true; g.add(body, la, lb); g.scale.setScalar(1.45); sc.add(g);
      this.villagers.push({ g, la, lb, t: hash(i, 1, 60) * perim, dir: i % 3 === 0 ? -1 : 1, spd: .5 + hash(i, 2, 60) * .35, off: (hash(i, 3, 60) - .5) * .5, ph: i * 1.7, gate: i >= 12 });
    }
    // weiche Standschatten
    this.shadowTex = shadowTex(); this.shadowMat = new T.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: .8 });
    this.shadowGeo = new T.PlaneGeometry(1, 1); this.shadowGeo.rotateX(-Math.PI / 2); this.shadows = [];
    const addSh = (x, z, size, op = 1) => { const m = new T.Mesh(this.shadowGeo, this.shadowMat); m.position.set(x, .06, z); m.scale.set(size, 1, size); m.renderOrder = 2; sc.add(m); return m; };
    this.addSh = addSh;
    const V = [[-(W - CUT), -W], [W - CUT, -W], [W, -(W - CUT)], [W, W - CUT], [W - CUT, W], [-(W - CUT), W], [-W, W - CUT], [-W, -(W - CUT)]];
    for (const [x, z] of V) addSh(x, z, 4.8);
  }

  /* ---------- Zustand vom Spiel ---------- */
  // cfg: { color, lv: {id: Stufe}, layout: {id: [rasterX, rasterY, w]}, rathausLv, slot }
  configure(cfg) {
    this.layout = cfg.layout; B_LAYOUT = cfg.layout; this.color = cfg.color; this.slot = cfg.slot || 0;
    this.pc = hexRGB(cfg.color);
    if (!this.decorDone) { this.decorDone = true; this.decor(); }
  }
  update(infos) {
    this.infos = infos;
    const pc = this.pc || [58, 111, 208];
    const lvM = (infos.mauer && infos.mauer.lv) || 0;
    if (this.wallKey !== lvM + ':' + this.color) {
      this.wallKey = lvM + ':' + this.color;
      for (const c of [...this.wallGroup.children]) { this.wallGroup.remove(c); c.geometry.dispose(); }
      this.flagMeshes = this.flagMeshes.filter(f => f.userData.grp !== 'wall');
      const w = wallRing(pc, lvM, [66, 98, 150]), m = this.mesh(w.geo, { bid: 'mauer' }); this.wallGroup.add(m);
      this.wallFlags = w.flags;
      for (const p of w.flags) this.addFlag(this.wallGroup, p, 'wall');
      this.pickables();
    }
    for (const id in this.layout) {
      const inf = infos[id]; if (!inf) continue;
      const lv = inf.lv, key = lv + ':' + (inf.build ? 1 : 0) + ':' + this.color;
      let h = this.bld[id];
      if (!h) { h = this.bld[id] = { id, grp: new T.Group(), key: '', el: this.makeLabel(id) }; this.scene.add(h.grp); }
      if (id === 'mauer') { h.cx = 0; h.cz = W + .5; h.top = 3.1 + lvM * .035; h.key = key; }
      else if (h.key !== key) { this.buildModel(h, id, lv, inf, pc); h.key = key; this.pickables(); }
      const el = h.el, top = h.top;
      const css = `cb ${inf.st}${inf.locked ? ' lock' : ''}`; if (el.className !== css) el.className = css;
      const sig = inf.st + '|' + inf.txt + '|' + lv + '|' + inf.name; if (h.sig !== sig) {
        h.sig = sig; const ic = { up: '⬆', build: '🔨', train: '⚔', research: '📜', new: '＋', lock: '🔒', none: '' }[inf.st] || '';
        el.innerHTML = `${ic ? `<div class="bub" data-b="${id}"><span>${ic}</span></div>` : ''}${inf.txt ? `<div class="tim">${inf.txt}</div>` : ''}<div class="lbl" data-b="${id}">${lv ? `<b>${lv}</b>` : ''}<span class="nm">${inf.name}</span></div>`;
      }
    }
  }
  makeLabel(id) { const el = document.createElement('div'); el.className = 'cb'; el.dataset.id = id; this.labelsEl.appendChild(el); return el; }
  addFlag(grp, p, tag) {
    const m = new T.Mesh(this.flagGeo.clone(), new T.MeshLambertMaterial({ color: new T.Color().setRGB(LIN(this.pc[0]), LIN(this.pc[1]), LIN(this.pc[2])), side: T.DoubleSide }));
    m.position.set(p[0], p[1], p[2]); m.userData.base = m.geometry.attributes.position.array.slice(); m.userData.grp = tag; grp.add(m); this.flagMeshes.push(m);
  }
  buildModel(h, id, lv, inf, pc) {
    const g = h.grp;
    for (const c of [...g.children]) { g.remove(c); if (c.geometry && !c.userData.shared) c.geometry.dispose(); }
    this.flagMeshes = this.flagMeshes.filter(f => f.userData.grp !== id); this.units = this.units.filter(u => u.id !== id);
    const [lx, ly, lw] = this.layout[id], cx = gw(lx + lw / 2), cz = gw(ly + lw / 2);
    g.position.set(cx, 0, cz); h.cx = cx; h.cz = cz; h.smoke = [];
    const own = new T.Group(); g.add(own); h.own = own;
    const padS = id === 'rathaus' ? 4.4 : 2.5;
    if (h.sh) this.scene.remove(h.sh); if (this.addSh) h.sh = this.addSh(cx, cz, padS * 1.5);
    if (lv <= 0) {
      const b = new MB(); plotMark(b, padS); own.add(this.mesh(b.geo || b.build(), { bid: id })); h.top = .6;
    } else if (id === 'rathaus') {
      const tier = lv >= 14 ? 3 : lv >= 7 ? 2 : 1, key = tier + ':' + this.slot, cm = this.castleCache || (this.castleCache = {});
      const cs = cm[key] || (cm[key] = buildCastle(tier, this.slot)), sc = [.92, .8, .7][tier - 1];
      const m = this.mesh(cs.geo, { bid: id, shared: true }); m.userData.shared = true; m.scale.setScalar(sc); own.add(m);
      h.top = cs.h * sc; for (const f of cs.flags) this.addFlag(own, [f[0] * sc, f[1] * sc, f[2] * sc], id);
      for (const s of cs.smoke) h.smoke.push([s[0] * sc, s[1] * sc, s[2] * sc]);
      const pb = new MB(); pb.cyl(2.4, 2.5, .06, 24, 0, 0, 0, mul(PAD, .86)); const pm = this.mesh(pb.build()); pm.castShadow = false; own.add(pm);
      for (const f of own.children) if (f.isMesh && f.userData.bid !== id && f !== pm) f.userData.bid = id;
    } else {
      const ctx = { flags: [] }, mdl = MODELS[id](lv, pc, ctx), b = new MB();
      if (!mdl.noPad) pad(b, mdl.padS || 2.5); else if (id === 'akademie' || id === 'farm') b.box(mdl.padS || 2.5, .05, mdl.padS || 2.5, 0, 0, 0, id === 'farm' ? [128, 102, 60] : mul(PAD, .86));
      const pm = this.mesh(b.build()); pm.castShadow = false; own.add(pm);
      const sc = (mdl.s || 1) * 1.08 * (.9 + Math.min(lv, 20) * .011), m = this.mesh(mdl.geo, { bid: id }); m.userData.shared = false; m.scale.setScalar(sc); own.add(m);
      h.top = (mdl.h || 1.6) * sc;
      for (const f of ctx.flags) this.addFlag(own, [f[0] * sc, f[1] * sc, f[2] * sc], id);
      for (const s of mdl.smoke || []) h.smoke.push([s[0], s[1], s[2]]);
      // Mehrstufen-Schmuck
      if (lv >= 6) { const eb = new MB(); for (const sx of [-1, 1]) { eb.cyl(.02, .02, .6, 4, sx * 1.15, 0, 1.15, WOOD_D); eb.cone(.07, .12, 6, sx * 1.15, .6, 1.15, LIGHT); } for (let i = 0; i < 5; i++) eb.ico(.07, -.9 + i * .22, .08, 1.18, [[230, 120, 140], [240, 210, 90], [200, 120, 200]][i % 3], 1); own.add(this.mesh(eb.build())); }
      if (lv >= 12) { const eb = new MB(); eb.cyl(.025, .025, 1.1, 4, -1.15, 0, -1.1, WOOD_D); eb.box(.46, .62, .03, -1.15, .45, -1.08, pc); eb.box(.2, .26, .035, -1.15, .65, -1.07, GOLD); own.add(this.mesh(eb.build())); h.top += .3; }
      if (mdl.units) for (const [type, x, , z, r, ph] of mdl.units) this.addUnit(h, type, sc * x, sc * z, r * sc, ph, id);
    }
    // Baustelle
    if (inf.build) {
      const s = lv <= 0 ? 2.1 : padS - .3, sh = lv <= 0 ? 1.4 : Math.max(1.4, h.top * .9);
      const sm = this.mesh(scaffold(s, sh), { bid: id }); sm.userData.shared = false; own.add(sm);
      const cm = this.mesh(crane(), {}); cm.position.set(-s * .6, sh + .15, -s * .6); cm.userData.crane = true; cm.castShadow = false; own.add(cm); h.crane = cm; h.top = Math.max(h.top, sh + .3);
    } else h.crane = null;
    h.top = h.top * .82 + .2;
  }
  addUnit(h, type, x, z, rad, ph, id) {
    const key = type + this.color, gc = this.unitCache || (this.unitCache = {});
    const ug = gc[key] || (gc[key] = buildUnit(type, hexRGB(this.color))), cav = ug.cav, g = new T.Group();
    const body = new T.Mesh(ug.body, this.matVC); body.castShadow = true; g.add(body);
    const mk = geo => { if (!geo) return null; const l = new T.Mesh(geo, this.matVC); l.position.y = ug.hip; l.castShadow = true; g.add(l); return l; };
    const u = { id, g, la: mk(ug.la), lb: mk(ug.lb), cav, cx: x, cz: z, rad, ph, base: h.own };
    g.scale.setScalar(cav ? 1.5 : 1.7); h.own.add(g); this.units.push(u);
  }
  pickables() {
    const list = []; this.scene.traverse(o => { if (o.isMesh && o.userData && o.userData.bid) list.push(o); }); this.pick = list;
  }

  /* ---------- Kamera und Eingabe ---------- */
  updateCamera() {
    const c = this.cam, cp = Math.cos(c.pitch), p = this.camera.position;
    p.set(c.x + c.dist * cp * Math.sin(c.yaw), c.dist * Math.sin(c.pitch), c.z + c.dist * cp * Math.cos(c.yaw));
    this.camera.lookAt(c.x, 0, c.z); this.camera.updateMatrixWorld();
  }
  groundAt(sx, sy) {
    this.ndc.set(sx / this.W * 2 - 1, -(sy / this.H) * 2 + 1); this.ray.setFromCamera(this.ndc, this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction; if (d.y >= -.001) return null; const t = -o.y / d.y; return { x: o.x + d.x * t, z: o.z + d.z * t };
  }
  setupInput() {
    const el = this.dom, ptr = new Map(); let drag = null, pinch = null, moved = 0, t0 = 0;
    const clampCam = () => { this.touched = true; const c = this.cam; c.x = clamp(c.x, -9, 9); c.z = clamp(c.z, -9, 11); c.dist = clamp(c.dist, this.minDist(), 75); c.pitch = clamp(c.pitch, .5, 1.3); };
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptr.size === 1) { moved = 0; t0 = performance.now(); drag = { g: this.groundAt(e.clientX, e.clientY), sx: e.clientX, sy: e.clientY }; }
      if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), dist: this.cam.dist, yaw: this.cam.yaw }; drag = null; moved = 99; }
    });
    el.addEventListener('pointermove', e => {
      if (!ptr.has(e.pointerId)) return; ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptr.size >= 2 && pinch) { const [a, b] = [...ptr.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x); this.cam.dist = pinch.dist * pinch.d / Math.max(30, d); clampCam(); this.updateCamera(); return; }
      if (drag) {
        moved = Math.max(moved, Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy));
        if (moved > 6 && drag.g) { const g = this.groundAt(e.clientX, e.clientY); if (g) { this.cam.x += drag.g.x - g.x; this.cam.z += drag.g.z - g.z; clampCam(); this.updateCamera(); } }
      }
    });
    const up = e => {
      const had = ptr.delete(e.pointerId); if (!had) return;
      if (ptr.size < 2) pinch = null;
      if (e.type === 'pointerup' && drag && moved <= 6 && performance.now() - t0 < 600) this.tap(e.clientX, e.clientY);
      if (ptr.size === 0) drag = null;
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.cam.dist *= Math.exp(e.deltaY * .0012);
      clampCam(); this.updateCamera();
    }, { passive: false });
  }
  tap(sx, sy) {
    this.ndc.set(sx / this.W * 2 - 1, -(sy / this.H) * 2 + 1); this.ray.setFromCamera(this.ndc, this.camera);
    const hits = this.ray.intersectObjects(this.pick, false);
    for (const h of hits) { const id = h.object.userData.bid; if (id) { this.bump[id] = this.time; if (this.opts.onPick) this.opts.onPick(id); return; } }
    if (this.opts.onPick) this.opts.onPick(null);
  }
  home() { this.touched = false; Object.assign(this.cam, { x: 0, z: 1.5, yaw: .42, pitch: .86, dist: this.fitDist() }); this.updateCamera(); }

  /* ---------- Bildaufbau ---------- */
  waveFlags(t) {
    for (const f of this.flagMeshes) {
      const a = f.geometry.attributes.position, b = f.userData.base;
      for (let i = 0; i < a.count; i++) { const x = b[i * 3]; a.array[i * 3 + 2] = Math.sin(t * 4 + x * 5 + f.position.x * 2) * .1 * x; a.array[i * 3 + 1] = b[i * 3 + 1] - x * .06; }
      a.needsUpdate = true;
    }
  }
  stepSmoke(t) {
    const g = this.smoke.geometry, P = g.attributes.position.array, A = g.attributes.aA.array, S = g.attributes.aS.array;
    this.smokeMat.uniforms.uScale.value = this.H / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    let n = 0;
    for (const id in this.bld) {
      const h = this.bld[id]; if (!h.smoke || !h.smoke.length || !h.cx) continue;
      for (const off of h.smoke) for (let i = 0; i < 4 && n < this.smokeN; i++, n++) {
        const age = (t * .22 + i * .25 + (h.cx * 7 % 5) * .13) % 1;
        P[n * 3] = h.cx + off[0] + age * 1.0 + Math.sin(t + i) * .08 * age; P[n * 3 + 1] = off[1] + age * 2.2; P[n * 3 + 2] = h.cz + off[2] + age * .4;
        A[n] = .5 * Math.sin(Math.min(1, age * 1.6) * Math.PI * .5) * (1 - age); S[n] = .22 + age * .75;
      }
    }
    for (let i = n; i < this.smokeN; i++) { A[i] = 0; S[i] = 0; }
    g.attributes.position.needsUpdate = true; g.attributes.aA.needsUpdate = true; g.attributes.aS.needsUpdate = true;
  }
  projectLabels() {
    const v = new T.Vector3(), cam = this.camera;
    for (const id in this.bld) {
      const h = this.bld[id]; if (!h.el || h.top == null) continue;
      v.set(h.cx, h.top, h.cz).project(cam);
      const vis = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      h.el.style.display = vis ? '' : 'none';
      if (vis) h.el.style.transform = `translate(${((v.x + 1) / 2 * this.W).toFixed(1)}px,${((1 - v.y) / 2 * this.H).toFixed(1)}px) translate(-50%,-100%)`;
    }
  }
  frame(dt) {
    this.time += dt; const t = this.time;
    this.waveFlags(t); this.stepSmoke(t);
    if (this.waterMat) this.waterMat.uniforms.uTime.value = t;
    if (this.sails) this.sails.rotation.z = -t * .5;
    this.labelsEl.classList.toggle('near', this.cam.dist < 30);
    if (this.villagers) for (const v of this.villagers) {
      const L = this.loop; let d = ((v.t + v.dir * v.spd * t) % L.perim + L.perim) % L.perim, k = 0;
      while (d > L.lens[k]) { d -= L.lens[k]; k++; }
      const a = L.pts[k], b = L.pts[(k + 1) % 4], f = d / L.lens[k], dx = (b[0] - a[0]) / L.lens[k], dz = (b[1] - a[1]) / L.lens[k];
      const x = a[0] + (b[0] - a[0]) * f - dz * v.off, z = a[1] + (b[1] - a[1]) * f + dx * v.off;
      v.g.position.set(x, .06 + Math.abs(Math.sin(t * 7 + v.ph)) * .02, z); v.g.rotation.y = Math.atan2(dx * v.dir, dz * v.dir);
      const sw = Math.sin(t * 7 + v.ph) * .6; v.la.rotation.x = sw; v.lb.rotation.x = -sw;
    }
    for (const u of this.units) {
      const a = t * (u.cav ? .55 : .7) + u.ph, px = u.cx + Math.cos(a) * u.rad, pz = u.cz + Math.sin(a * 1.2) * u.rad * .55;
      u.g.position.set(px, .06, pz); const vx = -Math.sin(a), vz = Math.cos(a * 1.2) * 1.2 * .55; u.g.rotation.y = Math.atan2(vx, vz);
      const sw = Math.sin(t * (u.cav ? 7 : 8) + u.ph) * (u.cav ? .5 : .6); if (u.la) u.la.rotation.x = sw; if (u.lb) u.lb.rotation.x = -sw;
      u.g.position.y = .06 + Math.abs(Math.sin(t * 8 + u.ph)) * (u.cav ? .04 : .03);
    }
    for (const id in this.bld) {
      const h = this.bld[id], b = this.bump[id], k = b != null ? Math.max(0, 1 - (t - b) / .35) : 0;
      if (h.own) { const s = 1 + Math.sin(k * Math.PI) * .045; h.own.scale.set(s, 1 + Math.sin(k * Math.PI) * .08, s); }
      if (h.crane) h.crane.rotation.y = Math.sin(t * .6 + h.cx) * .9;
    }
    this.projectLabels();
    this.renderer.render(this.scene, this.camera);
  }
}
