// Zehn Kronen – Bildvorrat für die Weltkarte.
// Alle Bilder werden beim Start auf Zeichenflächen gemalt (kein Download) und zu einem Atlas gepackt.
// Maßstab: ein Feld ist 64 x 32 Pixel groß (isometrisch 2:1). Gemalt wird mit doppelter Auflösung.

export const TWH = 32, THH = 16;                        // halbe Feldbreite / -höhe
export const proj = (x, y, z = 0) => [(x - y) * TWH, (x + y) * THH - z];

const SC = 2;                                           // Auflösung der Zeichenflächen
const rgb = h => [h >> 16 & 255, h >> 8 & 255, h & 255];
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const mul = (c, f) => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function lcg(seed) { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

/* ---------- Grundformen ---------- */
function path(c, pts) { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); }
function fillPoly(c, pts, col, a = 1) { path(c, pts); c.fillStyle = css(col, a); c.fill(); }
function lerp2(q, u, v) { // q: [unten-links, unten-rechts, oben-rechts, oben-links]
  const bx = q[0][0] + (q[1][0] - q[0][0]) * u, by = q[0][1] + (q[1][1] - q[0][1]) * u;
  const tx = q[3][0] + (q[2][0] - q[3][0]) * u, ty = q[3][1] + (q[2][1] - q[3][1]) * u;
  return [bx + (tx - bx) * v, by + (ty - by) * v];
}
// Fläche aus einzelnen Steinen / Brettern / Schindeln – sorgt für Struktur statt Einheitsfarbe
function texQuad(c, q, base, o = {}) {
  const rows = o.rows || 6, cols = o.cols || 5, jit = o.jit ?? .12, rnd = o.rnd || lcg(7), off = o.off ?? .5, gap = o.gap ?? .06;
  fillPoly(c, q, mul(base, .62));
  for (let r = 0; r < rows; r++) {
    const v0 = r / rows, v1 = (r + 1) / rows - gap / rows * 2, sh = (r % 2) * off;
    for (let k = -1; k < cols; k++) {
      const u0 = Math.max(0, (k + sh) / cols), u1 = Math.min(1, (k + 1 + sh) / cols - gap / cols);
      if (u1 <= u0) continue;
      const f = 1 - jit + rnd() * jit * 2 + (v0 * .08);
      fillPoly(c, [lerp2(q, u0, v0), lerp2(q, u1, v0), lerp2(q, u1, v1), lerp2(q, u0, v1)], mul(base, f));
    }
  }
  // Verlauf: unten dunkler (Schatten am Boden), oben leicht heller
  const a = lerp2(q, .5, 0), b = lerp2(q, .5, 1);
  const g = c.createLinearGradient(a[0], a[1], b[0], b[1]);
  g.addColorStop(0, 'rgba(10,8,6,.34)'); g.addColorStop(.45, 'rgba(10,8,6,0)'); g.addColorStop(1, 'rgba(255,240,200,.10)');
  path(c, q); c.fillStyle = g; c.fill();
}
function wallBox(c, x, y, w, d, h, col, o = {}) {
  const rnd = o.rnd || lcg(Math.floor((x + 9) * 131 + (y + 9) * 17 + h));
  const Lf = [P(x, y + d, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x, y + d, h)];
  const Rf = [P(x + w, y + d, 0), P(x + w, y, 0), P(x + w, y, h), P(x + w, y + d, h)];
  const T = [P(x, y, h), P(x + w, y, h), P(x + w, y + d, h), P(x, y + d, h)];
  const rows = Math.max(2, Math.round(h / 5));
  texQuad(c, Lf, mul(col, .86), { rows, cols: Math.max(2, Math.round(w * 4)), rnd, jit: o.jit });
  texQuad(c, Rf, mul(col, .62), { rows, cols: Math.max(2, Math.round(d * 4)), rnd, jit: o.jit });
  fillPoly(c, T, mul(col, 1.05));
  c.strokeStyle = 'rgba(20,14,8,.35)'; c.lineWidth = .8; path(c, T); c.stroke();
  return { Lf, Rf, T };
}
const P = proj;
function shadow(c, rx, ry, a = .38, cx = 0, cy = 0) {
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, rx);
  g.addColorStop(0, `rgba(10,12,6,${a})`); g.addColorStop(.7, `rgba(10,12,6,${a * .55})`); g.addColorStop(1, 'rgba(10,12,6,0)');
  c.save(); c.translate(0, 0); c.scale(1, ry / rx); c.beginPath(); c.arc(cx, cy * rx / ry, rx, 0, 7); c.fillStyle = g; c.fill(); c.restore();
}
function grass(c, rx, ry, n, rnd, col = [70, 104, 48]) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()), x = Math.cos(a) * rx * r, y = Math.sin(a) * ry * r, h = 2 + rnd() * 3;
    c.strokeStyle = css(mul(col, .8 + rnd() * .5), .9); c.lineWidth = .9;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rnd() - .5) * 2, y - h); c.stroke();
  }
}
function cone(c, x, y, r, h, col, rnd, stripes = 9) { // Kegeldach mit Schindeln
  const g = c.createLinearGradient(x - r, 0, x + r, 0);
  g.addColorStop(0, css(mul(col, 1.1))); g.addColorStop(.55, css(mul(col, .9))); g.addColorStop(1, css(mul(col, .55)));
  c.beginPath(); c.moveTo(x - r, y); c.quadraticCurveTo(x, y + r * .62, x + r, y); c.lineTo(x, y - h); c.closePath(); c.fillStyle = g; c.fill();
  c.strokeStyle = css(mul(col, .45), .55); c.lineWidth = .6;
  for (let i = 1; i < stripes; i++) { const t = i / stripes, xx = x - r + 2 * r * t; c.beginPath(); c.moveTo(xx, y + Math.sin(t * 3.14) * r * .3); c.lineTo(x, y - h); c.stroke(); }
}
function hipRoof(c, x, y, w, d, base, rise, col) { // Walmdach über Rechteck (Feld-Einheiten), base = Höhe der Traufe
  const n = P(x, y, base), e = P(x + w, y, base), s = P(x + w, y + d, base), wv = P(x, y + d, base), ap = P((x + x + w) / 2, (y + y + d) / 2, base + rise);
  const rnd = lcg(33);
  texQuad(c, [wv, s, ap, ap], mul(col, 1.02), { rows: 4, cols: 8, rnd, off: .5 });
  texQuad(c, [s, e, ap, ap], mul(col, .72), { rows: 4, cols: 8, rnd });
  fillPoly(c, [n, e, ap], mul(col, .55)); fillPoly(c, [n, wv, ap], mul(col, .68));
  c.strokeStyle = 'rgba(20,10,5,.4)'; c.lineWidth = .8; path(c, [wv, s, e, ap]); c.stroke();
  return ap;
}
function crenels(c, x, y, w, d, h, col) { // Zinnen auf der Oberkante
  const n = Math.max(2, Math.round(w * 3));
  for (let i = 0; i < n; i += 2) wallBox(c, x + w / n * i, y + d - .08, w / n, .08, 3.2, mul(col, 1.05), { rnd: lcg(i + 3) , jit: .05 }), 0;
  void h;
}
function flagPole(c, p, hgt) { c.strokeStyle = '#2a211a'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0], p[1] - hgt); c.stroke(); }
function door(c, x, y, w, d, hh, side) { // Tor als dunkler Bogen auf der Vorderseite
  const a = side === 'L' ? P(x, y + d, 0) : P(x + w, y, 0), b = side === 'L' ? P(x + w, y + d, 0) : P(x + w, y + d, 0);
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, hw = Math.abs(b[0] - a[0]) / 2;
  c.beginPath(); c.moveTo(mx - hw, my + (b[1] - a[1]) * -.5); c.lineTo(mx - hw, my - hh * .6 + (b[1] - a[1]) * -.5);
  c.quadraticCurveTo(mx, my - hh * 1.5, mx + hw, my - hh * .6 + (b[1] - a[1]) * .5); c.lineTo(mx + hw, my + (b[1] - a[1]) * .5); c.closePath();
  c.fillStyle = '#1c130c'; c.fill(); c.strokeStyle = 'rgba(210,170,90,.5)'; c.lineWidth = .8; c.stroke();
}
function window2(c, x, y, z, side) { const p = side === 'L' ? P(x, y, z) : P(x, y, z); fillPoly(c, [[p[0] - 1.6, p[1]], [p[0] + 1.6, p[1] + (side === 'L' ? 1.6 : -1.6)], [p[0] + 1.6, p[1] + (side === 'L' ? -4 : -7.4)], [p[0] - 1.6, p[1] - 5.6]], [24, 22, 30]); }

/* ---------- Bäume, Felsen ---------- */
function oak(c, k) {
  const r = lcg(k * 97 + 5), s = .85 + r() * .35;
  shadow(c, 13 * s, 5 * s, .34, 3, 1);
  c.fillStyle = '#4a3624'; c.fillRect(-1.8 * s, -12 * s, 3.6 * s, 12 * s);
  c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, -12 * s, 1.8 * s, 12 * s);
  const hue = [[72, 118, 50], [84, 128, 52], [62, 108, 58]][k % 3];
  const blobs = [[0, -24, 11], [-7, -19, 8], [7, -19, 8.5], [-3, -29, 8], [4, -27, 7.5], [0, -17, 9]];
  for (const [bx, by, br] of blobs) {
    const g = c.createRadialGradient((bx - 3) * s, (by - 3) * s, 1, bx * s, by * s, br * s);
    g.addColorStop(0, css(mul(hue, 1.38))); g.addColorStop(.6, css(hue)); g.addColorStop(1, css(mul(hue, .52)));
    c.beginPath(); c.arc(bx * s, by * s, br * s, 0, 7); c.fillStyle = g; c.fill();
  }
  for (let i = 0; i < 22; i++) { c.fillStyle = css(mul(hue, 1.2 + r() * .5), .55); c.fillRect((r() - .5) * 22 * s, (-34 + r() * 22) * s, 1.8, 1.4); }
}
function pine(c, k, snow) {
  const r = lcg(k * 53 + 11), s = .85 + r() * .4, hue = [[44, 88, 56], [38, 78, 52], [52, 98, 60]][k % 3];
  shadow(c, 12 * s, 4.5 * s, .34, 3, 1);
  c.fillStyle = '#3f2e20'; c.fillRect(-1.6 * s, -9 * s, 3.2 * s, 9 * s);
  for (let i = 0; i < 4; i++) {
    const y0 = -6 * s - i * 9 * s, w = (14 - i * 3) * s, hgt = 15 * s;
    const g = c.createLinearGradient(-w, 0, w, 0);
    g.addColorStop(0, css(mul(hue, 1.3 - i * .04))); g.addColorStop(.5, css(mul(hue, 1 - i * .02))); g.addColorStop(1, css(mul(hue, .5)));
    c.beginPath(); c.moveTo(-w, y0); c.quadraticCurveTo(0, y0 + 4 * s, w, y0); c.lineTo(0, y0 - hgt); c.closePath(); c.fillStyle = g; c.fill();
    c.strokeStyle = 'rgba(8,24,12,.35)'; c.lineWidth = .8; c.stroke();
    if (snow) { c.beginPath(); c.moveTo(-w * .62, y0 - hgt * .42); c.lineTo(0, y0 - hgt); c.lineTo(w * .62, y0 - hgt * .42); c.quadraticCurveTo(0, y0 - hgt * .3, -w * .62, y0 - hgt * .42); c.fillStyle = 'rgba(244,248,252,.92)'; c.fill(); }
  }
}
function bush(c, k) {
  const r = lcg(k * 31 + 3), hue = k ? [96, 120, 56] : [66, 110, 52];
  shadow(c, 8, 3, .3, 1, 1);
  for (let i = 0; i < 4; i++) {
    const bx = (r() - .5) * 9, by = -4 - r() * 3, br = 4 + r() * 2.5;
    const g = c.createRadialGradient(bx - 1.5, by - 1.5, .5, bx, by, br);
    g.addColorStop(0, css(mul(hue, 1.4))); g.addColorStop(1, css(mul(hue, .55)));
    c.beginPath(); c.arc(bx, by, br, 0, 7); c.fillStyle = g; c.fill();
  }
  if (k) for (let i = 0; i < 6; i++) { c.fillStyle = ['#d8493c', '#e7c445', '#f0f0e8'][i % 3]; c.fillRect((r() - .5) * 11, -3 - r() * 7, 1.6, 1.6); }
}
function rock(c, k) {
  const r = lcg(k * 71 + 9), base = [[118, 114, 106], [104, 100, 96], [128, 120, 108]][k % 3];
  shadow(c, 14, 5, .38, 2, 1);
  const n = 7, pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * 6.283, rr = 9 + r() * 5; pts.push([Math.cos(a) * rr, -8 + Math.sin(a) * rr * .72]); }
  path(c, pts); const g = c.createLinearGradient(-10, -18, 12, 2); g.addColorStop(0, css(mul(base, 1.32))); g.addColorStop(.55, css(base)); g.addColorStop(1, css(mul(base, .55)));
  c.fillStyle = g; c.fill(); c.strokeStyle = 'rgba(20,18,16,.45)'; c.lineWidth = .9; c.stroke();
  c.strokeStyle = 'rgba(20,18,16,.3)'; c.beginPath(); c.moveTo(-3, -14); c.lineTo(1, -7); c.lineTo(-1, -2); c.stroke();
  c.fillStyle = 'rgba(70,98,50,.55)'; for (let i = 0; i < 5; i++) c.fillRect(-9 + r() * 14, -2 - r() * 2, 2 + r() * 3, 1.4);
}

/* ---------- Burgen nach Stufe ---------- */
const STONE = [172, 164, 148], STONE_D = [138, 130, 118], ROOF = [128, 52, 40], WOOD = [118, 84, 52];
function towerAt(c, x, y, s, h, roofH, roofCol) {
  wallBox(c, x - s / 2, y - s / 2, s, s, h, STONE, { rnd: lcg(Math.floor(x * 31 + y * 17 + 4)) });
  const p = P(x, y, h);
  // Fenster
  fillPoly(c, [[p[0] - 7.6, p[1] + 7], [p[0] - 5.2, p[1] + 8.2], [p[0] - 5.2, p[1] + 3.4], [p[0] - 7.6, p[1] + 2.4]], [26, 24, 30]);
  cone(c, p[0], p[1] + 2, s * 36, roofH, roofCol, lcg(5));
  return P(x, y, h + roofH * .9 + 2);
}
function castle(c, tier, withFlag) {
  const r = lcg(tier * 17 + 2);
  const R = tier === 1 ? 1.15 : tier === 2 ? 1.5 : 1.85;      // halbe Seitenlänge des Hofs
  shadow(c, 110 * R / 1.5, 40 * R / 1.5, .4, 4, 2);
  grass(c, 90 * R / 1.4, 38 * R / 1.4, 60, r);
  const wallH = tier === 1 ? 9 : tier === 2 ? 15 : 20, wd = .26;
  const cols = css(mul(STONE_D, 1));
  void cols;
  // Hintere Mauern (Nord und West) zuerst
  wallBox(c, -R, -R, 2 * R, wd, wallH, STONE_D);
  wallBox(c, -R, -R, wd, 2 * R, wallH, STONE_D);
  // Hinterer Turm
  if (tier >= 2) towerAt(c, -R, -R, .62, wallH + 8, 15, ROOF);
  // Burgfried im Zentrum
  const kh = tier === 1 ? 22 : tier === 2 ? 34 : 48, ks = tier === 1 ? 1.0 : tier === 2 ? 1.25 : 1.5;
  const k = wallBox(c, -ks / 2, -ks / 2, ks, ks, kh, [198, 188, 164]);
  void k;
  // Fenster und Tür am Burgfried
  for (let i = 0; i < (tier === 1 ? 1 : 2); i++) { window2(c, -ks / 2 + ks * (.28 + i * .4), ks / 2, kh * .62, 'L'); window2(c, ks / 2, -ks / 2 + ks * (.3 + i * .38), kh * .62, 'R'); }
  if (tier >= 2) { for (let i = 0; i < 2; i++) window2(c, -ks / 2 + ks * (.3 + i * .38), ks / 2, kh * .3, 'L'); }
  if (tier >= 3) { crenels(c, -ks / 2, -ks / 2, ks, ks, kh, STONE); }
  const apx = hipRoof(c, -ks / 2 - .08, -ks / 2 - .08, ks + .16, ks + .16, kh, tier === 1 ? 18 : tier === 2 ? 24 : 30, ROOF);
  // Flaggenmast des Burgfrieds
  flagPole(c, apx, 24 + tier * 4);
  // Vordere Mauern (Süd und Ost) und Tor
  wallBox(c, -R, R - wd, 2 * R, wd, wallH, STONE);
  wallBox(c, R - wd, -R, wd, 2 * R, wallH, STONE);
  // Torhaus an der vorderen linken Mauer
  wallBox(c, -.36, R - wd - .08, .72, wd + .16, wallH + 6, [182, 172, 154]);
  door(c, -.22, R - wd - .08, .44, wd + .16, wallH * .85, 'L');
  const gh = P(0, R + .08, wallH + 6); cone(c, gh[0], gh[1] + 1, 12, 13, ROOF, r, 5);
  // Eckturm vorn links, rechts, hinten rechts
  const tH = wallH + (tier === 1 ? 6 : 12), tS = tier === 1 ? .5 : .62;
  if (tier >= 2) { towerAt(c, -R, R, tS, tH, 15, ROOF); towerAt(c, R, -R, tS, tH, 15, ROOF); }
  const fr = towerAt(c, R, R, tier === 1 ? .56 : .7, tH + 4, tier === 1 ? 14 : 18, ROOF);
  flagPole(c, fr, 14);
  if (tier === 1) { towerAt(c, -R, R, .46, wallH + 4, 11, ROOF); }
  // Zinnen auf den vorderen Mauern
  crenels(c, -R, R - wd, 2 * R, wd, wallH, STONE);
  // Zusatzgebäude im Hof (ab Stufe 2)
  if (tier >= 2) { wallBox(c, -R + .4, -.1, .55, .7, 9, [180, 150, 112]); hipRoof(c, -R + .35, -.15, .65, .8, 9, 8, [110, 70, 44]); }
  if (tier >= 3) { wallBox(c, R - .95, .1, .6, .55, 8, [186, 156, 118]); hipRoof(c, R - 1.0, .05, .7, .65, 8, 8, [118, 66, 44]); }
  return { flag: [apx[0], apx[1] - (24 + tier * 4)], flag2: [fr[0], fr[1] - 14] };
}
function flagCloth(c, col) { // Fahne: weiß, wird mit der Spielerfarbe eingefärbt
  c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(5, -2, 9, 3, 15, 0); c.lineTo(15, 9); c.bezierCurveTo(9, 12, 5, 7, 0, 9); c.closePath();
  const g = c.createLinearGradient(0, 0, 15, 0); g.addColorStop(0, col || '#fff'); g.addColorStop(1, col ? '#7a1e1a' : '#bbb'); c.fillStyle = g; c.fill();
  c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, 4, 15, 1.4);
}

/* ---------- Ressourcenorte ---------- */
function farm(c) {
  const r = lcg(41);
  shadow(c, 96, 40, .3, 2, 2); grass(c, 80, 32, 40, r);
  // Felder
  const patches = [[-1.4, -.2, 1.5, 1.1, [206, 170, 62]], [-.1, -1.5, 1.5, 1.1, [190, 156, 54]], [.1, .35, 1.4, 1.0, [128, 150, 56]]];
  for (const [x, y, w, d, col] of patches) {
    fillPoly(c, [P(x, y), P(x + w, y), P(x + w, y + d), P(x, y + d)], mul(col, .7));
    for (let i = 0; i < 9; i++) { const u = i / 9; const a = P(x + w * u, y + .04), b = P(x + w * u, y + d - .04); c.strokeStyle = css(mul(col, .95 + (i % 2) * .22), .95); c.lineWidth = 2.6; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
    for (let i = 0; i < 40; i++) { const p = P(x + w * r(), y + d * r()); c.fillStyle = css(mul(col, 1.3), .7); c.fillRect(p[0], p[1] - 2, 1, 2.4); }
  }
  // Scheune
  wallBox(c, .5, -.9, 1.0, .8, 12, WOOD); hipRoof(c, .42, -.98, 1.16, .96, 12, 12, [158, 118, 58]);
  window2(c, .7, -.1, 6, 'L'); door(c, .75, -.12, .4, .1, 8, 'L');
  // Heuballen
  for (const [x, y] of [[-.2, 1.1], [.1, 1.2]]) { const p = P(x, y); c.fillStyle = '#c9a647'; c.beginPath(); c.ellipse(p[0], p[1] - 4, 5, 4, 0, 0, 7); c.fill(); c.strokeStyle = '#8a6a22'; c.lineWidth = .8; c.stroke(); }
}
function wood(c) {
  const r = lcg(57);
  shadow(c, 96, 40, .3, 2, 2); grass(c, 80, 32, 36, r);
  // Baumstümpfe und Stämme
  for (const [x, y] of [[-1.3, -.2], [-.9, .6], [-1.6, .5]]) { const p = P(x, y); c.fillStyle = '#6a4a2c'; c.fillRect(p[0] - 4, p[1] - 6, 8, 6); c.fillStyle = '#d8b484'; c.beginPath(); c.ellipse(p[0], p[1] - 6, 4, 2, 0, 0, 7); c.fill(); c.strokeStyle = '#8a6844'; c.lineWidth = .7; c.beginPath(); c.ellipse(p[0], p[1] - 6, 2, 1, 0, 0, 7); c.stroke(); }
  // Holzstapel
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) {
    const p = P(.3 + i * .12 + row * .06, 1.0 - i * .02, row * 5); c.fillStyle = css(mul([150, 100, 56], .85 + r() * .3)); c.beginPath(); c.ellipse(p[0], p[1] - 3, 3.6, 3.1, 0, 0, 7); c.fill();
    c.fillStyle = '#d9b27c'; c.beginPath(); c.ellipse(p[0] + 1, p[1] - 3, 2, 1.8, 0, 0, 7); c.fill();
  }
  // Holzfällerhütte
  wallBox(c, -.35, -1.0, 1.2, .9, 11, [132, 94, 58], { jit: .2 });
  hipRoof(c, -.45, -1.1, 1.4, 1.1, 11, 12, [92, 70, 44]);
  door(c, -.1, -.12, .4, .1, 8, 'L');
  // Säge mit Bock
  const a = P(1.1, .4); c.strokeStyle = '#4a3624'; c.lineWidth = 2; c.beginPath(); c.moveTo(a[0] - 7, a[1]); c.lineTo(a[0] - 3, a[1] - 8); c.moveTo(a[0] + 7, a[1]); c.lineTo(a[0] + 3, a[1] - 8); c.stroke();
  c.fillStyle = '#7b5a36'; c.fillRect(a[0] - 8, a[1] - 11, 16, 3.5);
}
function stone(c) {
  const r = lcg(73);
  shadow(c, 96, 40, .3, 2, 2);
  // Steinbruch: abgetreppte Grube
  for (let i = 0; i < 4; i++) {
    const s = 1.7 - i * .36, z = -i * 3.5;
    fillPoly(c, [P(-s, -s, z), P(s, -s, z), P(s, s, z), P(-s, s, z)], mul([170, 164, 150], 1 - i * .12));
    c.strokeStyle = 'rgba(30,26,20,.4)'; c.lineWidth = 1; path(c, [P(-s, -s, z), P(s, -s, z), P(s, s, z), P(-s, s, z)]); c.stroke();
  }
  fillPoly(c, [P(-.5, -.5, -14), P(.5, -.5, -14), P(.5, .5, -14), P(-.5, .5, -14)], [74, 70, 64]);
  // Gehauene Blöcke
  for (const [x, y, w, d, h] of [[.9, -1.5, .6, .45, 8], [1.2, -.9, .5, .5, 6], [-1.9, .8, .6, .5, 7], [-1.5, 1.2, .45, .4, 5]]) wallBox(c, x, y, w, d, h, [190, 184, 170], { jit: .08 });
  // Kran
  const b = P(-.2, 1.5); c.strokeStyle = '#5a422a'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(b[0], b[1] - 34); c.lineTo(b[0] + 22, b[1] - 26); c.moveTo(b[0], b[1] - 34); c.lineTo(b[0] - 6, b[1] - 24); c.stroke();
  c.lineWidth = .9; c.beginPath(); c.moveTo(b[0] + 18, b[1] - 27); c.lineTo(b[0] + 18, b[1] - 12); c.stroke(); c.fillStyle = '#aaa395'; c.fillRect(b[0] + 15, b[1] - 12, 6, 5);
  grass(c, 70, 28, 20, r, [90, 110, 60]);
}
function ore(c) {
  const r = lcg(97);
  shadow(c, 100, 42, .32, 2, 2);
  // Felshügel mit Stolleneingang
  const hill = [[-2.0, 0.6], [-1.6, -1.2], [-.6, -2.0], [.8, -1.8], [1.8, -.8], [1.9, .4], [1.0, 1.1], [-.8, 1.3]];
  const pts = hill.map(([x, y], i) => P(x, y, i % 2 ? 22 : 30 - (i % 3) * 4));
  const g = c.createLinearGradient(-60, -50, 60, 20); g.addColorStop(0, '#8a8478'); g.addColorStop(.5, '#615c53'); g.addColorStop(1, '#3a3732');
  const base = hill.map(([x, y]) => P(x, y, 0));
  c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); for (let i = base.length - 1; i >= 0; i--) c.lineTo(base[i][0], base[i][1]); c.closePath(); c.fillStyle = g; c.fill();
  c.strokeStyle = 'rgba(15,14,12,.5)'; c.lineWidth = 1; c.stroke();
  for (let i = 0; i < 26; i++) { const p = P(-1.6 + r() * 3.2, -1.3 + r() * 2.2, 8 + r() * 18); c.fillStyle = r() > .5 ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.22)'; c.fillRect(p[0], p[1], 3 + r() * 5, 1.6); }
  for (let i = 0; i < 7; i++) { const p = P(-1.2 + r() * 2.4, -.9 + r() * 1.6, 6 + r() * 12); c.fillStyle = ['#d8a64a', '#e9c47c', '#7ab4d8'][i % 3]; c.fillRect(p[0], p[1], 2.2, 2.2); }
  // Stollen mit Balken
  const d = P(.2, 1.15, 0);
  c.beginPath(); c.moveTo(d[0] - 13, d[1] + 5); c.lineTo(d[0] - 13, d[1] - 14); c.quadraticCurveTo(d[0], d[1] - 24, d[0] + 13, d[1] - 14); c.lineTo(d[0] + 13, d[1] + 5); c.closePath(); c.fillStyle = '#100d0a'; c.fill();
  c.strokeStyle = '#7b5a36'; c.lineWidth = 3; c.beginPath(); c.moveTo(d[0] - 13, d[1] + 5); c.lineTo(d[0] - 13, d[1] - 14); c.moveTo(d[0] + 13, d[1] + 5); c.lineTo(d[0] + 13, d[1] - 14); c.moveTo(d[0] - 15, d[1] - 14); c.lineTo(d[0] + 15, d[1] - 14); c.stroke();
  // Lore mit Erz
  const cp = P(1.6, 1.4); c.fillStyle = '#4a3b2c'; c.fillRect(cp[0] - 8, cp[1] - 9, 16, 8); c.fillStyle = '#d6a843'; for (let i = 0; i < 5; i++) c.fillRect(cp[0] - 7 + i * 3, cp[1] - 12 - (i % 2), 3, 3);
  c.fillStyle = '#222'; c.beginPath(); c.arc(cp[0] - 5, cp[1] - 1, 2.4, 0, 7); c.arc(cp[0] + 5, cp[1] - 1, 2.4, 0, 7); c.fill();
  c.strokeStyle = '#3a2a1c'; c.lineWidth = 1.6; c.beginPath(); const a = P(.6, 1.5), b = P(2.1, 1.3); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
}

/* ---------- Lager, Ruinen, Heiligtümer, Thron ---------- */
function camp(c) {
  const r = lcg(131);
  shadow(c, 96, 40, .38, 2, 2); grass(c, 74, 30, 14, r, [92, 88, 56]);
  // Palisade im Halbkreis
  for (let i = 0; i < 17; i++) {
    const a = 3.5 + i * .19; const p = P(Math.cos(a) * 1.9 + .2, Math.sin(a) * 1.5 - .5); const h = 15 + (i % 3) * 4;
    c.fillStyle = css(mul([108, 76, 46], .8 + (i % 4) * .08)); c.fillRect(p[0] - 2.4, p[1] - h, 4.8, h);
    c.beginPath(); c.moveTo(p[0] - 2.4, p[1] - h); c.lineTo(p[0], p[1] - h - 5); c.lineTo(p[0] + 2.4, p[1] - h); c.fill();
  }
  // Zelte
  const tent = (x, y, col) => {
    const b = P(x, y); const hw = 17, h = 24;
    c.beginPath(); c.moveTo(b[0] - hw, b[1]); c.lineTo(b[0], b[1] - h); c.lineTo(b[0], b[1] + 6); c.closePath(); c.fillStyle = css(mul(col, .95)); c.fill();
    c.beginPath(); c.moveTo(b[0] + hw, b[1]); c.lineTo(b[0], b[1] - h); c.lineTo(b[0], b[1] + 6); c.closePath(); c.fillStyle = css(mul(col, .6)); c.fill();
    c.beginPath(); c.moveTo(b[0] - 5, b[1] + 4); c.lineTo(b[0], b[1] - 8); c.lineTo(b[0] + 4, b[1] + 6); c.closePath(); c.fillStyle = '#17110c'; c.fill();
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = .9; c.beginPath(); c.moveTo(b[0] - hw, b[1]); c.lineTo(b[0], b[1] - h); c.lineTo(b[0] + hw, b[1]); c.stroke();
  };
  tent(-.6, -.2, [128, 74, 60]); tent(.7, -.7, [104, 94, 76]); tent(.9, .5, [120, 86, 56]);
  // Totempfahl mit Schädel und Banner
  const t = P(-1.0, .9); c.strokeStyle = '#3a2a1c'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(t[0], t[1]); c.lineTo(t[0], t[1] - 36); c.stroke();
  c.fillStyle = '#e8e2d0'; c.beginPath(); c.arc(t[0], t[1] - 38, 4.2, 0, 7); c.fill(); c.fillStyle = '#17110c'; c.fillRect(t[0] - 2.4, t[1] - 39, 1.8, 1.8); c.fillRect(t[0] + .6, t[1] - 39, 1.8, 1.8);
  fillPoly(c, [[t[0] + 1, t[1] - 33], [t[0] + 14, t[1] - 30], [t[0] + 1, t[1] - 24]], [150, 34, 28]);
  // Beutefass und Kisten
  const bx = P(.1, 1.15); c.fillStyle = '#6d4c2c'; c.fillRect(bx[0] - 5, bx[1] - 10, 10, 10); c.fillStyle = '#3a2a1c'; c.fillRect(bx[0] - 5, bx[1] - 7, 10, 1.2); c.fillRect(bx[0] - 5, bx[1] - 3, 10, 1.2);
}
function fireFrame(c, k) {
  const r = lcg(k + 1);
  const g = c.createRadialGradient(0, -6, 1, 0, -6, 22); g.addColorStop(0, 'rgba(255,190,80,.55)'); g.addColorStop(1, 'rgba(255,120,30,0)'); c.fillStyle = g; c.fillRect(-22, -28, 44, 44);
  for (let i = 0; i < 3; i++) {
    const w = 5 - i * 1.3, h = 13 - i * 3 + r() * 4, ox = (r() - .5) * 2;
    c.beginPath(); c.moveTo(ox - w, 0); c.quadraticCurveTo(ox - w, -h * .6, ox + (r() - .5) * 3, -h); c.quadraticCurveTo(ox + w, -h * .6, ox + w, 0); c.closePath();
    c.fillStyle = ['#e0501c', '#f59a2a', '#ffe08a'][i]; c.fill();
  }
}
function campDead(c) {
  const r = lcg(151);
  shadow(c, 90, 38, .3, 2, 2);
  for (let i = 0; i < 14; i++) { const p = P(-1.4 + r() * 2.8, -1 + r() * 2); const h = 4 + r() * 12; c.strokeStyle = css(mul([50, 40, 34], .8 + r() * .5)); c.lineWidth = 2 + r() * 1.5; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] + (r() - .5) * 6, p[1] - h); c.stroke(); }
  for (let i = 0; i < 24; i++) { const p = P(-1.5 + r() * 3, -1 + r() * 2); c.fillStyle = `rgba(${30 + r() * 40},${28 + r() * 30},${26},.55)`; c.beginPath(); c.ellipse(p[0], p[1], 4 + r() * 6, 2 + r() * 3, 0, 0, 7); c.fill(); }
  const p = P(0, 0); for (let i = 0; i < 3; i++) { c.fillStyle = 'rgba(210,60,20,.55)'; c.beginPath(); c.arc(p[0] + (i - 1) * 6, p[1] - 2, 1.6, 0, 7); c.fill(); }
}
function ruin(c) {
  const r = lcg(171);
  shadow(c, 96, 40, .32, 2, 2); grass(c, 80, 32, 36, r);
  wallBox(c, -1.0, -1.0, 1.1, .5, 18, [150, 142, 128], { jit: .2 });
  wallBox(c, -1.0, -1.0, .5, 1.5, 26, [156, 148, 132], { jit: .2 });
  wallBox(c, .3, -.9, .55, .55, 36, [162, 154, 138], { jit: .2 });
  // Bogen
  const a = P(-.3, .1, 0); c.strokeStyle = '#7e7666'; c.lineWidth = 5; c.beginPath(); c.arc(a[0], a[1] - 14, 11, Math.PI, 0); c.stroke();
  wallBox(c, -.5, .0, .22, .22, 15, [150, 142, 128]); wallBox(c, .05, .0, .22, .22, 15, [150, 142, 128]);
  for (const [x, y, w, d, h] of [[.4, .5, .5, .4, 5], [-1.3, .8, .45, .35, 4], [1.0, .1, .4, .4, 6]]) wallBox(c, x, y, w, d, h, [142, 134, 120], { jit: .22 });
  // Efeu
  c.strokeStyle = 'rgba(66,108,48,.9)'; c.lineWidth = 2; for (let i = 0; i < 5; i++) { const p = P(-.9 + i * .22, -.5, 4 + r() * 14); c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] + (r() - .5) * 6, p[1] + 8 + r() * 8); c.stroke(); }
  c.fillStyle = 'rgba(78,128,56,.8)'; for (let i = 0; i < 30; i++) { const p = P(-1.0 + r() * 2.2, -.9 + r() * 1.4, r() * 24); c.fillRect(p[0], p[1], 2.2, 2); }
  // Glühen
  const g = c.createRadialGradient(0, -16, 2, 0, -16, 34); g.addColorStop(0, 'rgba(255,230,150,.2)'); g.addColorStop(1, 'rgba(255,230,150,0)'); c.fillStyle = g; c.fillRect(-40, -52, 80, 80);
}
function sanct(c) {
  const r = lcg(191);
  shadow(c, 110, 46, .34, 2, 2); grass(c, 84, 34, 30, r, [80, 120, 70]);
  // Stufen
  for (let i = 0; i < 3; i++) { const s = 1.65 - i * .17; wallBox(c, -s, -s, 2 * s, 2 * s, 3 + 0, [226 - i * 8, 220 - i * 8, 208 - i * 8], { jit: .04 }); void i; }
  // Säulen
  const cols = [[-1.2, -1.2], [1.0, -1.2], [-1.2, 1.0], [1.0, 1.0], [-1.2, -.1], [1.0, -.1], [-.1, 1.0], [-.1, -1.2]];
  cols.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
  for (const [x, y] of cols) {
    const b = P(x + .1, y + .1, 3), h = 36, gx = c.createLinearGradient(b[0] - 3.5, 0, b[0] + 3.5, 0);
    gx.addColorStop(0, '#f5f0e2'); gx.addColorStop(.6, '#cfc8b4'); gx.addColorStop(1, '#8c8672');
    c.fillStyle = gx; c.fillRect(b[0] - 3.5, b[1] - h, 7, h); c.fillStyle = '#e8e2d0'; c.fillRect(b[0] - 5, b[1] - h - 3, 10, 3.5); c.fillRect(b[0] - 5, b[1] - 3, 10, 3);
  }
  // Dach (Architrav + Pyramide)
  wallBox(c, -1.3, -1.3, 2.6, 2.6, 4, [232, 226, 212], { jit: .03 });
  c.save(); c.translate(0, -39); wallBox(c, -1.3, -1.3, 2.6, 2.6, 4, [232, 226, 212], { jit: .03 }); c.restore();
  const ap = hipRoof(c, -1.45, -1.45, 2.9, 2.9, 43, 22, [88, 128, 150]);
  // Himmelsglühen
  const g = c.createRadialGradient(ap[0], ap[1] - 6, 1, ap[0], ap[1] - 6, 38); g.addColorStop(0, 'rgba(140,210,255,.55)'); g.addColorStop(1, 'rgba(140,210,255,0)'); c.fillStyle = g; c.fillRect(ap[0] - 40, ap[1] - 46, 80, 80);
  c.fillStyle = '#bfeaff'; c.beginPath(); c.arc(ap[0], ap[1] - 4, 3, 0, 7); c.fill();
}
function throne(c) {
  const r = lcg(211);
  shadow(c, 150, 62, .42, 2, 2); grass(c, 120, 48, 50, r, [86, 116, 62]);
  const stepCols = [[188, 178, 150], [200, 190, 162], [212, 202, 174], [224, 214, 186]];
  for (let i = 0; i < 4; i++) { const s = 2.3 - i * .38, z0 = i * 8; c.save(); c.translate(0, -z0); wallBox(c, -s, -s, 2 * s, 2 * s, 8, stepCols[i], { jit: .06 }); c.restore(); }
  // Obelisken
  for (const [x, y] of [[-1.9, -1.9], [1.7, -1.9], [-1.9, 1.7], [1.7, 1.7]]) { wallBox(c, x, y, .24, .24, 30, [214, 204, 178], { jit: .04 }); const t = P(x + .12, y + .12, 30); fillPoly(c, [[t[0] - 4, t[1] + 1], [t[0], t[1] - 9], [t[0] + 4, t[1] + 1]], [226, 192, 94]); }
  // Thron
  const b = P(0, 0, 32);
  c.fillStyle = '#7a1e22'; c.fillRect(b[0] - 12, b[1] - 12, 24, 14);
  const gg = c.createLinearGradient(b[0] - 14, 0, b[0] + 14, 0); gg.addColorStop(0, '#f6dc7a'); gg.addColorStop(.5, '#d9a93a'); gg.addColorStop(1, '#8c6416');
  c.fillStyle = gg; c.fillRect(b[0] - 15, b[1] - 36, 6, 40); c.fillRect(b[0] + 9, b[1] - 36, 6, 40); c.fillRect(b[0] - 12, b[1] - 40, 24, 8);
  // Krone darüber
  const k = [b[0], b[1] - 56];
  const kg = c.createRadialGradient(k[0], k[1], 2, k[0], k[1], 50); kg.addColorStop(0, 'rgba(255,230,140,.7)'); kg.addColorStop(1, 'rgba(255,230,140,0)'); c.fillStyle = kg; c.fillRect(k[0] - 54, k[1] - 54, 108, 108);
  c.fillStyle = '#f0c24a'; c.beginPath(); c.moveTo(k[0] - 11, k[1] + 7); c.lineTo(k[0] - 12, k[1] - 6); c.lineTo(k[0] - 6, k[1]); c.lineTo(k[0], k[1] - 9); c.lineTo(k[0] + 6, k[1]); c.lineTo(k[0] + 12, k[1] - 6); c.lineTo(k[0] + 11, k[1] + 7); c.closePath(); c.fill();
  c.strokeStyle = '#8c6416'; c.lineWidth = 1; c.stroke(); c.fillStyle = '#d6322e'; c.beginPath(); c.arc(k[0], k[1] + 2, 2, 0, 7); c.fill();
}
function slot(c) {
  const r = lcg(223);
  shadow(c, 60, 24, .28, 0, 2); grass(c, 50, 20, 20, r);
  for (const [x, y] of [[-.9, -.5], [.8, -.5], [-.9, .6], [.8, .6]]) { const p = P(x, y); c.strokeStyle = '#6a4a2c'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0], p[1] - 22); c.stroke(); c.fillStyle = '#b8a888'; c.fillRect(p[0], p[1] - 22, 8, 6); }
  const p = P(0, 0); c.strokeStyle = 'rgba(220,200,150,.55)'; c.setLineDash([3, 3]); c.lineWidth = 1.2; path(c, [P(-.9, -.5), P(.8, -.5), P(.8, .6), P(-.9, .6)]); c.stroke(); c.setLineDash([]); void p;
}

/* ---------- Soldaten ---------- */
function soldier(c, x, y, f, tintLayer) { // f: Schrittphase 0/1
  const leg = f ? 1.5 : -1.5;
  if (!tintLayer) {
    shadow(c, 6, 2.4, .3, x, y);
    c.strokeStyle = '#2c2822'; c.lineWidth = 1.8; c.beginPath(); c.moveTo(x - 1.2, y - 6); c.lineTo(x - 1.2 + leg, y); c.moveTo(x + 1.2, y - 6); c.lineTo(x + 1.2 - leg, y); c.stroke();
    c.fillStyle = '#8c929a'; c.fillRect(x - 3, y - 14, 6, 8); c.fillStyle = '#e0b890'; c.beginPath(); c.arc(x, y - 17, 2.6, 0, 7); c.fill();
    c.fillStyle = '#6a7078'; c.beginPath(); c.arc(x, y - 18, 2.9, Math.PI, 0); c.fill();
    c.strokeStyle = '#6b4c2c'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(x + 5, y); c.lineTo(x + 5, y - 28); c.stroke();
    c.fillStyle = '#d4d6d8'; c.beginPath(); c.moveTo(x + 4, y - 28); c.lineTo(x + 5, y - 33); c.lineTo(x + 6, y - 28); c.fill();
  } else {
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(x - 6, y - 12); c.lineTo(x - 2.2, y - 13); c.lineTo(x - 2.2, y - 5); c.lineTo(x - 6, y - 6); c.closePath(); c.fill(); // Schild
    c.fillRect(x - 3, y - 8.6, 6, 2.2); // Gürtel
  }
}
function troops(c, f, tintLayer) {
  const pos = [[-9, 3], [8, 4], [-1, -4]];
  pos.sort((a, b) => a[1] - b[1]).forEach(([x, y], i) => soldier(c, x, y, (f + i) % 2, tintLayer));
}

/* ---------- Atlas ---------- */
export function buildAtlas(PIXI) {
  const defs = [];
  const add = (name, w, h, ax, ay, fn) => defs.push({ name, w, h, ax, ay, fn });
  for (let k = 0; k < 3; k++) { add('oak' + k, 52, 66, 26, 60, c => oak(c, k)); add('pine' + k, 48, 80, 24, 74, c => pine(c, k, false)); add('pineS' + k, 48, 80, 24, 74, c => pine(c, k, true)); add('rock' + k, 48, 36, 24, 30, c => rock(c, k)); }
  for (let k = 0; k < 2; k++) add('bush' + k, 36, 28, 18, 24, c => bush(c, k));
  for (let t = 1; t <= 3; t++) {
    const W = [190, 250, 310][t - 1], Hh = [190, 250, 310][t - 1], AY = [130, 175, 215][t - 1];
    add('castle' + t, W, Hh, W / 2, AY, c => castle(c, t));
  }
  add('flag', 18, 14, 1, 2, c => flagCloth(c));
  add('farm', 220, 190, 110, 122, farm); add('wood', 220, 180, 110, 114, wood); add('stone', 220, 190, 110, 120, stone); add('ore', 230, 190, 115, 118, ore);
  add('camp', 220, 180, 110, 112, camp); add('campDead', 200, 100, 100, 70, campDead);
  add('ruin', 220, 190, 110, 118, ruin); add('sanct', 250, 240, 125, 150, sanct); add('throne', 330, 290, 165, 190, throne); add('slot', 130, 80, 65, 50, slot);
  for (let k = 0; k < 3; k++) add('fire' + k, 48, 48, 24, 40, c => fireFrame(c, k));
  for (let f = 0; f < 2; f++) { add('sold' + f, 46, 56, 23, 48, c => troops(c, f, false)); add('soldT' + f, 46, 56, 23, 48, c => troops(c, f, true)); }
  // Ausrichten (Regalpackung)
  const AW = 2048; let x = 0, y = 0, rowH = 0; const pad = 2;
  for (const d of defs) {
    const w = d.w * SC + pad * 2, h = d.h * SC + pad * 2;
    if (x + w > AW) { x = 0; y += rowH; rowH = 0; }
    d.px = x; d.py = y; x += w; rowH = Math.max(rowH, h);
  }
  const AH = y + rowH, cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
  const ctx = cv.getContext('2d');
  for (const d of defs) {
    ctx.save();
    ctx.beginPath(); ctx.rect(d.px, d.py, d.w * SC + pad * 2, d.h * SC + pad * 2); ctx.clip();
    ctx.translate(d.px + pad + d.ax * SC, d.py + pad + d.ay * SC); ctx.scale(SC, SC);
    d.meta = d.fn(ctx);
    ctx.restore();
  }
  const base = PIXI.BaseTexture.from(cv, { scaleMode: PIXI.SCALE_MODES.LINEAR, mipmap: PIXI.MIPMAP_MODES.OFF });
  const tex = {}, anchor = {}, meta = {};
  for (const d of defs) {
    tex[d.name] = new PIXI.Texture(base, new PIXI.Rectangle(d.px + pad, d.py + pad, d.w * SC, d.h * SC));
    anchor[d.name] = [d.ax / d.w, d.ay / d.h]; if (d.meta) meta[d.name] = d.meta;
  }
  return { tex, anchor, meta, SC, canvas: cv };
}


/* ---------- Bilder für das Stadtmenü ---------- */
function backdrop(c, W, H) {
  const sky = c.createLinearGradient(0, 0, 0, H * .66); sky.addColorStop(0, '#6fa6d2'); sky.addColorStop(1, '#e3ecdf');
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  const sun = c.createRadialGradient(W * .8, H * .2, 2, W * .8, H * .2, H * .5); sun.addColorStop(0, 'rgba(255,244,200,.85)'); sun.addColorStop(1, 'rgba(255,244,200,0)'); c.fillStyle = sun; c.fillRect(0, 0, W, H);
  const r = lcg(5);
  for (let i = 0; i < 4; i++) { const x = r() * W, y = H * (.08 + r() * .25); c.fillStyle = 'rgba(255,255,255,.55)'; for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(x + k * 14, y + (k % 2) * 3, 22 - k * 3, 8, 0, 0, 7); c.fill(); } }
  for (const [y0, col, amp] of [[.52, 'rgba(96,128,150,.8)', 22], [.58, 'rgba(78,112,92,.95)', 16]]) {
    c.beginPath(); c.moveTo(0, H); c.lineTo(0, H * y0);
    for (let x = 0; x <= W; x += 8) c.lineTo(x, H * y0 - Math.sin(x * .021 + y0 * 9) * amp * .6 - Math.sin(x * .053) * amp * .4);
    c.lineTo(W, H); c.closePath(); c.fillStyle = col; c.fill();
  }
  const g = c.createLinearGradient(0, H * .58, 0, H); g.addColorStop(0, '#6f9a49'); g.addColorStop(1, '#4e7a38');
  c.beginPath(); c.moveTo(0, H * .66); c.quadraticCurveTo(W * .5, H * .58, W, H * .66); c.lineTo(W, H); c.lineTo(0, H); c.closePath(); c.fillStyle = g; c.fill();
  for (let i = 0; i < 150; i++) { c.fillStyle = r() > .5 ? 'rgba(130,170,80,.35)' : 'rgba(40,80,40,.3)'; c.fillRect(r() * W, H * (.66 + r() * .34), 2, 3); }
  // Baumreihe hinten
  for (let i = 0; i < 9; i++) { c.save(); c.translate(W * (.04 + i * .12) + r() * 10, H * .66 + r() * 6); c.scale(.55, .55); (i % 3 ? pine : oak)(c, i, false); c.restore(); }
}
function warehouse(c) {
  const r = lcg(301); shadow(c, 110, 42, .36, 2, 2); grass(c, 90, 34, 24, r);
  wallBox(c, -1.2, -.9, 2.4, 1.6, 17, [152, 112, 70], { jit: .18 });
  hipRoof(c, -1.3, -1.0, 2.6, 1.8, 17, 17, [118, 62, 44]);
  door(c, -.45, .6, .9, .1, 14, 'L'); c.strokeStyle = '#4a3624'; c.lineWidth = 1.2; const a = P(0, .7, 0); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[0], a[1] - 14); c.stroke();
  for (const [x, y, z] of [[.9, .9, 0], [1.25, .85, 0], [1.05, .85, 9]]) wallBox(c, x, y, .32, .32, 9, [172, 132, 80], { jit: .1 });
  for (const [x, y] of [[-1.5, .8], [-1.3, 1.05]]) { const p = P(x, y); c.fillStyle = '#7b5632'; c.fillRect(p[0] - 5, p[1] - 11, 10, 11); c.fillStyle = '#3a2a1c'; c.fillRect(p[0] - 5, p[1] - 8, 10, 1.3); c.fillRect(p[0] - 5, p[1] - 3, 10, 1.3); }
}
function barracks(c) {
  const r = lcg(311); shadow(c, 120, 46, .36, 2, 2); grass(c, 100, 36, 20, r);
  wallBox(c, -1.5, -.8, 3.0, 1.5, 20, [172, 162, 142]);
  for (let i = 0; i < 4; i++) window2(c, -1.2 + i * .55, .7, 12, 'L');
  door(c, -.15, .6, .6, .1, 14, 'L');
  const ap = hipRoof(c, -1.6, -.9, 3.2, 1.7, 20, 16, [96, 112, 132]);
  flagPole(c, ap, 28); c.save(); c.translate(ap[0], ap[1] - 28); flagCloth(c, '#b8322a'); c.restore();
  // Waffenständer und Übungspuppe
  for (let i = 0; i < 5; i++) { const p = P(1.2 + i * .06, 1.2 - i * .05); c.strokeStyle = '#5a4128'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(p[0] - 6 + i * 3, p[1]); c.lineTo(p[0] - 3 + i * 3, p[1] - 26); c.stroke(); c.fillStyle = '#cfd2d6'; c.fillRect(p[0] - 4 + i * 3, p[1] - 29, 2, 4); }
  const d = P(-1.5, 1.3); c.strokeStyle = '#6b4c2c'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(d[0], d[1]); c.lineTo(d[0], d[1] - 24); c.moveTo(d[0] - 7, d[1] - 18); c.lineTo(d[0] + 7, d[1] - 18); c.stroke(); c.fillStyle = '#c9a647'; c.beginPath(); c.arc(d[0], d[1] - 26, 4, 0, 7); c.fill();
}
function archery(c) {
  const r = lcg(321); shadow(c, 120, 46, .34, 2, 2); grass(c, 100, 36, 24, r);
  wallBox(c, -1.5, -1.0, 1.2, 1.0, 14, [140, 102, 64], { jit: .2 }); hipRoof(c, -1.6, -1.1, 1.4, 1.2, 14, 13, [102, 78, 48]);
  door(c, -1.2, -.1, .4, .1, 10, 'L');
  const target = (x, y, sc) => { const p = P(x, y); c.strokeStyle = '#4a3624'; c.lineWidth = 2; c.beginPath(); c.moveTo(p[0] - 6 * sc, p[1]); c.lineTo(p[0], p[1] - 22 * sc); c.lineTo(p[0] + 6 * sc, p[1]); c.stroke();
    const cx = p[0], cy = p[1] - 26 * sc; ['#f4efe0', '#c33a2e', '#f4efe0', '#c33a2e', '#e8c24a'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(cx, cy, (11 - i * 2.2) * sc, 0, 7); c.fill(); });
    c.strokeStyle = '#6b4c2c'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(cx + 1, cy - 1); c.lineTo(cx + 13 * sc, cy - 7 * sc); c.stroke(); };
  target(.2, -.9, .8); target(.9, -.4, .9); target(1.5, .1, 1.0);
  const b = P(-.5, .9); c.strokeStyle = '#6b4c2c'; c.lineWidth = 1.6; c.beginPath(); c.arc(b[0], b[1] - 10, 9, -1.2, 1.2); c.stroke(); c.strokeStyle = '#ddd'; c.lineWidth = .8; c.beginPath(); c.moveTo(b[0] + 3, b[1] - 18); c.lineTo(b[0] + 3, b[1] - 2); c.stroke();
}
function stable(c) {
  const r = lcg(331); shadow(c, 120, 46, .34, 2, 2); grass(c, 100, 36, 26, r);
  wallBox(c, -1.5, -1.0, 2.2, 1.3, 15, [146, 104, 66], { jit: .2 }); hipRoof(c, -1.6, -1.1, 2.4, 1.5, 15, 15, [186, 150, 70]);
  door(c, -.8, .2, .5, .1, 11, 'L'); door(c, -.1, .2, .5, .1, 11, 'L');
  // Koppel mit Zaun
  c.strokeStyle = '#6b4c2c'; c.lineWidth = 2;
  const f = [P(-.4, 1.1), P(1.6, 1.1), P(1.6, -.3)]; c.beginPath(); f.forEach((p, i) => i ? c.lineTo(p[0], p[1] - 9) : c.moveTo(p[0], p[1] - 9)); c.stroke();
  c.beginPath(); f.forEach((p, i) => i ? c.lineTo(p[0], p[1] - 4) : c.moveTo(p[0], p[1] - 4)); c.stroke();
  for (let i = 0; i <= 8; i++) { const p = P(-.4 + i * .25, 1.1); c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0], p[1] - 12); c.stroke(); }
  // Pferd
  const h = P(.7, .6); c.fillStyle = '#7a4a2a'; c.beginPath(); c.ellipse(h[0], h[1] - 15, 12, 6, 0, 0, 7); c.fill();
  c.beginPath(); c.moveTo(h[0] + 8, h[1] - 18); c.lineTo(h[0] + 14, h[1] - 28); c.lineTo(h[0] + 19, h[1] - 26); c.lineTo(h[0] + 15, h[1] - 15); c.fill();
  c.strokeStyle = '#5a3418'; c.lineWidth = 2; for (const dx of [-8, -4, 5, 9]) { c.beginPath(); c.moveTo(h[0] + dx, h[1] - 11); c.lineTo(h[0] + dx, h[1]); c.stroke(); }
  c.fillStyle = '#2c1d12'; c.fillRect(h[0] - 14, h[1] - 19, 5, 3);
  for (const [x, y] of [[1.0, 1.5], [1.4, 1.35]]) { const p = P(x, y); c.fillStyle = '#c9a647'; c.beginPath(); c.ellipse(p[0], p[1] - 4, 6, 4.5, 0, 0, 7); c.fill(); }
}
function infirmary(c) {
  const r = lcg(341); shadow(c, 120, 46, .34, 2, 2); grass(c, 100, 36, 24, r);
  wallBox(c, -1.3, -.9, 2.4, 1.6, 17, [236, 230, 218], { jit: .05 });
  hipRoof(c, -1.4, -1.0, 2.6, 1.8, 17, 16, [96, 124, 142]);
  for (let i = 0; i < 3; i++) window2(c, -1.0 + i * .8, .7, 10, 'L');
  const p = P(0, .7, 22); c.fillStyle = '#c0322c'; c.fillRect(p[0] - 2.4, p[1] - 8, 4.8, 16); c.fillRect(p[0] - 8, p[1] - 2.4, 16, 4.8);
  door(c, .55, .6, .5, .1, 12, 'L');
  for (const [x, y, col] of [[1.4, .5, '#4f8a3c'], [1.6, .9, '#6aa04a'], [1.3, 1.2, '#79b04f']]) { const q = P(x, y); c.fillStyle = col; c.beginPath(); c.arc(q[0], q[1] - 5, 6, 0, 7); c.fill(); }
}
function academy(c) {
  const r = lcg(351); shadow(c, 120, 46, .36, 2, 2); grass(c, 100, 36, 22, r);
  wallBox(c, -1.3, -.8, 2.4, 1.6, 17, [200, 192, 172]);
  hipRoof(c, -1.4, -.9, 2.6, 1.8, 17, 15, [62, 84, 124]);
  for (let i = 0; i < 3; i++) window2(c, -1.0 + i * .7, .8, 9, 'L');
  wallBox(c, .25, -.55, .9, .9, 54, [212, 204, 184]);
  const t = P(.7, -.1, 54); cone(c, t[0], t[1] + 2, 22, 28, [58, 78, 122], lcg(9), 7);
  for (let k = 0; k < 2; k++) { const w = P(.7, .35, 40 - k * 14); c.fillStyle = '#f2d77a'; c.fillRect(w[0] - 2.5, w[1] - 6, 5, 8); }
  const g = c.createRadialGradient(t[0], t[1] - 32, 1, t[0], t[1] - 32, 20); g.addColorStop(0, 'rgba(255,230,140,.8)'); g.addColorStop(1, 'rgba(255,230,140,0)'); c.fillStyle = g; c.fillRect(t[0] - 24, t[1] - 56, 48, 48);
  c.fillStyle = '#f0c24a'; c.beginPath(); c.arc(t[0], t[1] - 32, 3.4, 0, 7); c.fill();
}
function gatehouse(c) {
  const r = lcg(361); shadow(c, 130, 46, .36, 2, 2); grass(c, 110, 36, 24, r);
  wallBox(c, -1.9, -.3, 3.8, .6, 20, [160, 152, 138]);
  crenels(c, -1.9, -.3, 3.8, .6, 20, [160, 152, 138]);
  for (const x of [-1.9, 1.1]) { wallBox(c, x, -.5, .8, .9, 34, [170, 162, 146]); const t = P(x + .4, -.05, 34); cone(c, t[0], t[1] + 2, 17, 20, [124, 52, 40], lcg(x + 7), 7); window2(c, x + .15, .4, 20, 'L'); }
  door(c, -.55, .25, 1.1, .1, 20, 'L');
  c.strokeStyle = '#3a2a1c'; c.lineWidth = 1.2; const a = P(0, .35, 0); for (let i = -4; i <= 4; i++) { c.beginPath(); c.moveTo(a[0] + i * 4.4, a[1] - 3 + Math.abs(i) * .4); c.lineTo(a[0] + i * 4.4, a[1] - 20); c.stroke(); }
}
const SCALE = { rathaus: [1.4, 1.08, .85], farm: 1.0, saege: 1.1, stein: 1.0, mine: .95, lager: 1.1, kaserne: 1.0, schiess: 1.1, stall: 1.05, lazarett: 1.05, akademie: 1.05, mauer: 1.05 };
export function buildingImage(id, tier = 1, W = 320, H = 220) {
  const cv = document.createElement('canvas'); cv.width = W * 2; cv.height = H * 2;
  const c = cv.getContext('2d'); c.scale(2, 2); backdrop(c, W, H);
  c.save(); c.translate(W / 2, H * .73);
  const sc = id === 'rathaus' ? SCALE.rathaus[tier - 1] : SCALE[id] || 1; c.scale(sc, sc);
  switch (id) {
    case 'rathaus': { const m = castle(c, tier); for (const k of ['flag', 'flag2']) { c.save(); c.translate(m[k][0], m[k][1]); flagCloth(c, '#c8372d'); c.restore(); } break; }
    case 'farm': farm(c); break; case 'saege': wood(c); break; case 'stein': stone(c); break; case 'mine': ore(c); break;
    case 'lager': warehouse(c); break; case 'kaserne': barracks(c); break; case 'schiess': archery(c); break; case 'stall': stable(c); break;
    case 'lazarett': infirmary(c); break; case 'akademie': academy(c); break; case 'mauer': gatehouse(c); break;
  }
  c.restore();
  const v = c.createRadialGradient(W / 2, H / 2, H * .45, W / 2, H / 2, H * .95); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,8,4,.38)'); c.fillStyle = v; c.fillRect(0, 0, W, H);
  return cv;
}
