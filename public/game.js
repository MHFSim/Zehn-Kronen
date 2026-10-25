// Zehn Kronen – Spiel im Browser. Der Server ist maßgeblich; hier wird nur angezeigt
// und zwischen zwei Server-Antworten mit denselben Regeln flüssig weitergerechnet.
import {
  RES, RES_DE, B, U, MAX_TRAIN_ORDERS, costOf, timeOf, cap, capFor, protectedPct, prodAt, troopCount, queuedTroops,
  maxQueues, inQueue, afford, unitTime, rate, blocker, advanceTo
} from '/shared/rules.js';

/* ---------- Verbindung zum Server ---------- */
let S = null, speed = 1, offset = 0, me = null, match = null, live = false;
async function api(path, body) {
  const r = await fetch(path, body === undefined ? { credentials: 'same-origin' } : {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  let data = {}; try { data = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data };
}
function accept(v) {
  if (!v || !v.state) return;
  S = v.state; speed = v.match.speed; me = v.me; match = v.match;
  offset = v.now - Date.now();
  dirty = true;
}
const serverNow = () => Date.now() + offset;

/* ---------- Anmeldung und Beitritt ---------- */
const params = new URLSearchParams(location.search);
const invite = params.get('einladung') || '';
const $auth = document.getElementById('auth'), $form = document.getElementById('authForm'), $err = document.getElementById('authErr');
async function boot() {
  const r = await api('/api/me');
  if (r.ok) { accept(r.data); return startGame(); }
  $auth.hidden = false;
  if (invite) {
    const inv = await api('/api/invite?code=' + encodeURIComponent(invite));
    if (inv.ok) {
      document.getElementById('authLead').textContent = `Du bist eingeladen zur Partie „${inv.data.match}“ (${inv.data.players} von ${inv.data.max} Plätzen belegt). Wähle einen Namen und ein Passwort.`;
      document.getElementById('authBtn').textContent = 'Partie beitreten';
      document.getElementById('fPass').autocomplete = 'new-password';
      document.getElementById('authNote').innerHTML = 'Schon dabei? <button type="button" class="linkish" id="toLogin">Stattdessen anmelden</button>';
      document.getElementById('toLogin').onclick = () => { location.href = '/'; };
    } else {
      $err.textContent = inv.data.error || 'Einladung ungültig.';
    }
  }
  document.getElementById('fName').focus();
}
$form.addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('fName').value.trim(), password = document.getElementById('fPass').value;
  $err.textContent = '';
  const r = invite ? await api('/api/join', { invite, name, password }) : await api('/api/login', { name, password });
  if (!r.ok) { $err.textContent = r.data.error || 'Das hat nicht geklappt.'; return; }
  if (invite) history.replaceState(null, '', '/');
  accept(r.data); startGame();
});

/* ---------- Formatierung ---------- */
const fmtN = n => Math.floor(n).toLocaleString('de-DE');
function fmtT(s) {
  s = Math.max(0, Math.ceil(s));
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, p = n => String(n).padStart(2, '0');
  if (d) return d + ' T ' + h + ' h';
  if (h) return h + ':' + p(m) + ':' + p(x);
  return m + ':' + p(x);
}
const real = g => g / speed;
const costHTML = c => c.map((v, i) => v ? `<span class="cost ${S.res[RES[i]] >= v ? '' : 'short'}"><i class="r r-${RES[i]}"></i>${fmtN(v)}</span>` : '').join('');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'alert'); document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

/* ---------- Isometrische Welt (PixiJS) ---------- */
const TW = 96, TH = 48, N = 13, BRASS = 0xd2a94e;
const iso = (x, y) => ({ x: (x - y) * TW / 2, y: (x + y) * TH / 2 });
const up = (p, h) => ({ x: p.x, y: p.y - h });
const shade = (c, f) => { const r = Math.min(255, (c >> 16 & 255) * f), g = Math.min(255, (c >> 8 & 255) * f), b = Math.min(255, (c & 255) * f); return (r << 16) | (g << 8) | b; };
const hash = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000 / 1000;
let app, world, ground, selG, og, badges, dirty = true, sel = null;
const bounds = {}, badgeCache = {}, pick = {};

function poly(g, pts, col, a = 1) { g.beginFill(col, a); g.drawPolygon(pts.flatMap(p => [p.x, p.y])); g.endFill(); }
const diamond = (x, y, w, d) => [iso(x, y), iso(x + w, y), iso(x + w, y + d), iso(x, y + d)];
function box(g, x, y, w, d, h, col) {
  const n = iso(x, y), e = iso(x + w, y), s = iso(x + w, y + d), wv = iso(x, y + d);
  poly(g, [wv, s, up(s, h), up(wv, h)], shade(col, .8));
  poly(g, [s, e, up(e, h), up(s, h)], shade(col, .63));
  poly(g, [up(n, h), up(e, h), up(s, h), up(wv, h)], col);
  g.lineStyle(1, shade(col, .45), .55); g.moveTo(s.x, s.y); g.lineTo(s.x, s.y - h); g.lineStyle(0);
  return { n: up(n, h), e: up(e, h), s: up(s, h), w: up(wv, h), cx: (n.x + s.x) / 2, cy: (n.y + s.y) / 2 - h };
}
function roof(g, c, rh, col) {
  const a = { x: c.cx, y: c.cy - rh };
  poly(g, [c.n, c.w, a], shade(col, .55)); poly(g, [c.n, c.e, a], shade(col, .5));
  poly(g, [c.w, c.s, a], shade(col, .92)); poly(g, [c.s, c.e, a], shade(col, .7));
  return a;
}
function face(g, side, x, y, w, d, u0, u1, v0, v1, col) {
  const P = (u, v) => side === 'L' ? up(iso(x + u * w, y + d), v) : up(iso(x + w, y + u * d), v);
  poly(g, [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], col);
}
function flag(g, p, col) {
  g.lineStyle(2, 0x3a3128, 1); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y - 20); g.lineStyle(0);
  poly(g, [{ x: p.x, y: p.y - 20 }, { x: p.x + 14, y: p.y - 16 }, { x: p.x, y: p.y - 12 }], col);
}
function tree(g, tx, ty, k) {
  const c = iso(tx + .5, ty + .5), s = .8 + k * .5;
  g.beginFill(0x4a3624); g.drawRect(c.x - 2, c.y - 10 * s, 4, 10 * s); g.endFill();
  poly(g, [{ x: c.x - 14 * s, y: c.y - 8 * s }, { x: c.x + 14 * s, y: c.y - 8 * s }, { x: c.x, y: c.y - 34 * s }], shade(0x355c2c, .9 + k * .2));
  poly(g, [{ x: c.x - 11 * s, y: c.y - 20 * s }, { x: c.x + 11 * s, y: c.y - 20 * s }, { x: c.x, y: c.y - 44 * s }], shade(0x41703a, .9 + k * .2));
}
function drawGround() {
  ground.clear();
  for (let x = -5; x < N + 5; x++) for (let y = -5; y < N + 5; y++) {
    const inside = x >= 0 && y >= 0 && x < N && y < N, k = hash(x + 20, y + 20);
    poly(ground, diamond(x, y, 1, 1), inside ? shade(0x5f7d3b, .9 + k * .18) : shade(0x445a2b, .85 + k * .2));
  }
  [[6, 8], [7, 8], [6, 9], [7, 9], [6, 10], [7, 10], [6, 13], [7, 13], [6, 14], [7, 14]]
    .forEach(([x, y]) => poly(ground, diamond(x + .05, y, .9, 1), shade(0x8b6c47, .92 + hash(x, y) * .12)));
  for (let x = -5; x < N + 5; x++) for (let y = -5; y < 0; y++) if (hash(x, y) > .55) tree(ground, x, y, hash(y, x));
  for (let y = 0; y < N + 5; y++) for (let x = -5; x < 0; x++) if (hash(x, y) > .55) tree(ground, x, y, hash(y, x));
}

const STYLE = {
  rathaus: [0xcfbd99, 0x8e3d2f], farm: [0x9a5a34, 0x6e4a2a], saege: [0x8b6a45, 0x5c4a36], stein: [0x9a978f, 0x66645f],
  mine: [0x5d5952, 0x47433d], lager: [0xb08a5a, 0x5b4632], kaserne: [0xa49a88, 0x4a5560], schiess: [0x9c8466, 0x4f6a3e],
  stall: [0x8f6b4a, 0x7a5530], lazarett: [0xd9d4c7, 0x5f7d8c], akademie: [0xbab3a4, 0x3d4f73], mauer: [0x9b968c, 0x55524d]
};
function plot(g, b, locked) {
  poly(g, diamond(b.x + .1, b.y + .1, b.w - .2, b.w - .2), locked ? 0x3f4a2e : 0x7b6243, locked ? .55 : 1);
  if (!locked) {
    g.lineStyle(2, 0x5a4530, 1);
    [[.18, .18], [b.w - .18, .18], [b.w - .18, b.w - .18], [.18, b.w - .18]].forEach(([u, v]) => { const p = iso(b.x + u, b.y + v); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y - 9); });
    g.lineStyle(0);
  }
  return iso(b.x + b.w / 2, b.y + b.w / 2).y - 6;
}
function drawBuilding(g, id) {
  const b = B[id], L = S.lv[id], q = inQueue(S, id), [wc, rc] = STYLE[id], x = b.x, y = b.y;
  let top;
  if (L === 0 && !q) return plot(g, b, S.lv.rathaus < b.unlock);
  const l = Math.max(L, 1);
  if (q && L === 0) poly(g, diamond(x + .1, y + .1, b.w - .2, b.w - .2), 0x7b6243);
  switch (id) {
    case 'rathaus': {
      const h = 32 + l * 2.4, c = box(g, x + .35, y + .35, 2.3, 2.3, h, wc);
      face(g, 'L', x + .35, y + .35, 2.3, 2.3, .42, .58, 0, h * .42, 0x3b2c20);
      face(g, 'R', x + .35, y + .35, 2.3, 2.3, .25, .38, h * .55, h * .78, 0x2d3440);
      face(g, 'R', x + .35, y + .35, 2.3, 2.3, .62, .75, h * .55, h * .78, 0x2d3440);
      roof(g, c, 26, rc);
      const t = box(g, x + .15, y + .15, .8, .8, h + 26 + l, shade(wc, .95)), a = roof(g, t, 26, rc);
      flag(g, a, BRASS); top = a.y - 22; break;
    }
    case 'farm': {
      poly(g, diamond(x + .1, y + .1, b.w - .2, b.w - .2), 0xc5a24a);
      g.lineStyle(2, 0x9f7f33, .9);
      for (let i = 1; i < 6; i++) { const p0 = iso(x + .1 + i * .3, y + .1), p1 = iso(x + .1 + i * .3, y + 1.9); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); }
      g.lineStyle(0);
      const c = box(g, x + .15, y + .15, .95, 1.05, 14 + l * 1.4, wc);
      face(g, 'L', x + .15, y + .15, .95, 1.05, .35, .65, 0, 9, 0x3b2c20);
      top = roof(g, c, 16, rc).y; break;
    }
    case 'saege': {
      const c = box(g, x + .2, y + .2, 1.5, 1.0, 15 + l * 1.4, wc);
      face(g, 'L', x + .2, y + .2, 1.5, 1.0, .4, .6, 0, 10, 0x2e241a);
      top = roof(g, c, 15, rc).y;
      for (let i = 0; i < 3; i++) box(g, x + .3 + i * .45, y + 1.45, .38, .35, 6 + (i === 1 ? 4 : 0), 0x7a5232);
      break;
    }
    case 'stein': {
      const c = box(g, x + .2, y + .2, .9, .9, 13 + l, wc);
      top = roof(g, c, 14, rc).y;
      box(g, x + 1.05, y + .95, .6, .5, 9, 0x8d8a82); box(g, x + 1.25, y + 1.4, .45, .4, 6, 0x7f7c75); box(g, x + .4, y + 1.35, .5, .45, 7, 0x96938b);
      break;
    }
    case 'mine': {
      const c = box(g, x + .2, y + .2, 1.6, 1.6, 8 + l, wc), a = roof(g, c, 26 + l, 0x6f6a5f);
      face(g, 'L', x + .2, y + .2, 1.6, 1.6, .4, .6, 0, 8 + l, 0x15130f);
      box(g, x + .55, y + 1.85, .9, .12, 2, 0x6b5136); top = a.y; break;
    }
    case 'lager': {
      const c = box(g, x + .15, y + .25, 1.7, 1.45, 16 + l * 1.5, wc);
      face(g, 'L', x + .15, y + .25, 1.7, 1.45, .3, .7, 0, 12, 0x3b2c20);
      top = roof(g, c, 18, rc).y; break;
    }
    case 'kaserne': {
      const h = 19 + l * 1.7, c = box(g, x + .2, y + .2, 1.6, 1.6, h, wc);
      face(g, 'L', x + .2, y + .2, 1.6, 1.6, .43, .57, 0, h * .45, 0x2e241a);
      const a = roof(g, c, 14, rc); flag(g, a, 0xa8322a); top = a.y - 20; break;
    }
    case 'schiess': {
      const c = box(g, x + .2, y + .2, 1.0, 1.6, 15 + l * 1.4, wc);
      top = roof(g, c, 13, rc).y;
      const p = iso(x + 1.55, y + 1.05);
      g.beginFill(0x2e2a24); g.drawRect(p.x - 1, p.y - 18, 2, 18); g.endFill();
      g.beginFill(0xe8e0cc); g.drawEllipse(p.x, p.y - 20, 9, 9); g.endFill();
      g.beginFill(0xa8322a); g.drawEllipse(p.x, p.y - 20, 5, 5); g.endFill();
      break;
    }
    case 'stall': {
      const c = box(g, x + .2, y + .2, 1.6, 1.0, 15 + l * 1.4, wc);
      face(g, 'L', x + .2, y + .2, 1.6, 1.0, .2, .35, 0, 9, 0x2e241a); face(g, 'L', x + .2, y + .2, 1.6, 1.0, .6, .75, 0, 9, 0x2e241a);
      top = roof(g, c, 14, rc).y;
      g.lineStyle(2, 0x6b5136, 1); const f0 = iso(x + .2, y + 1.85), f1 = iso(x + 1.8, y + 1.85), f2 = iso(x + 1.8, y + 1.3);
      g.moveTo(f0.x, f0.y - 6); g.lineTo(f1.x, f1.y - 6); g.lineTo(f2.x, f2.y - 6); g.lineStyle(0); break;
    }
    case 'lazarett': {
      const h = 17 + l * 1.5, c = box(g, x + .2, y + .2, 1.6, 1.6, h, wc);
      for (let i = 0; i < 3; i++) face(g, 'R', x + .2, y + .2, 1.6, 1.6, .15 + i * .28, .3 + i * .28, h * .45, h * .75, 0x3c4d57);
      face(g, 'L', x + .2, y + .2, 1.6, 1.6, .42, .58, 0, h * .45, 0x3b2c20);
      top = roof(g, c, 14, rc).y; break;
    }
    case 'akademie': {
      const h = 19 + l * 1.6, c = box(g, x + .25, y + .25, 1.5, 1.5, h, wc);
      roof(g, c, 10, rc);
      const t = box(g, x + .6, y + .6, .8, .8, h + 26, shade(wc, .97));
      face(g, 'R', x + .6, y + .6, .8, .8, .35, .65, h + 8, h + 18, 0x2d3440);
      top = roof(g, t, 26, rc).y; break;
    }
    case 'mauer': {
      const hw = L ? 16 + L * 2 : 11, col = L ? wc : 0x7a5a3a;
      const a1 = box(g, x + .05, y + .35, .65, .65, hw + 14, col);
      box(g, x + .7, y + .45, .6, .45, hw + 4, shade(col, .95));
      face(g, 'L', x + .7, y + .45, .6, .45, .15, .85, 0, hw - 2, 0x1f1a14);
      const a2 = box(g, x + 1.3, y + .35, .65, .65, hw + 14, col);
      if (L) { roof(g, a1, 14, rc); top = roof(g, a2, 14, rc).y; } else top = a2.n.y - 6;
      break;
    }
  }
  if (q) {
    const f = diamond(x + .12, y + .12, b.w - .24, b.w - .24);
    g.lineStyle(2, 0x6e5233, .95);
    [f[1], f[2], f[3]].forEach(p => { g.moveTo(p.x, p.y); g.lineTo(p.x, p.y - 30); });
    g.moveTo(f[3].x, f[3].y - 15); g.lineTo(f[2].x, f[2].y - 15); g.lineTo(f[1].x, f[1].y - 15);
    g.moveTo(f[3].x, f[3].y); g.lineTo(f[2].x, f[2].y - 30); g.lineStyle(0);
    const cx = iso(x + b.w / 2, y + b.w / 2).x, py = top - 34;
    g.beginFill(0x1b1f24, .85); g.drawRoundedRect(cx - 30, py, 60, 8, 4); g.endFill();
    g.beginFill(BRASS); g.drawRoundedRect(cx - 29, py + 1, 58 * Math.max(0, 1 - q.left / q.total), 6, 3); g.endFill();
    top = py;
  }
  return top;
}
function wallSegs() {
  const L = S.lv.mauer, h = L ? 13 + L * 2 : 9, col = L ? 0x9b968c : 0x7a5a3a, out = [];
  const seg = (x, y, w, d, hh) => out.push({ d: x + w / 2 + y + d / 2, fn: g => box(g, x, y, w, d, hh, col) });
  for (let i = 0; i < N; i++) {
    seg(i, 0, 1, .35, h); seg(0, i, .35, 1, h); seg(N - .35, i, .35, 1, h);
    if (i !== 6 && i !== 7) seg(i, N - .35, 1, .35, h);
  }
  [[0, 0], [N - .6, 0], [0, N - .6], [N - .6, N - .6]].forEach(([x, y]) => seg(x, y, .6, .6, h + 10));
  return out;
}
function placeBadge(id, x, y) {
  const L = S.lv[id], locked = S.lv.rathaus < B[id].unlock && L === 0;
  let bd = badgeCache[id];
  if (!bd) {
    bd = new PIXI.Container();
    const bg = new PIXI.Graphics(), tx = new PIXI.Text('', { fontFamily: 'Alegreya Sans, sans-serif', fontSize: 13, fontWeight: '700', fill: 0xebe5d6 });
    tx.anchor.set(.5); tx.resolution = 2; bd.addChild(bg, tx); bd.bg = bg; bd.tx = tx; badgeCache[id] = bd; badges.addChild(bd);
  }
  const label = L ? String(L) : (locked ? 'R' + B[id].unlock : '+');
  if (bd.label !== label || bd.isSel !== (sel === id)) {
    bd.label = label; bd.isSel = sel === id;
    bd.tx.text = label; bd.tx.style.fill = L ? 0xebe5d6 : (locked ? 0xa29b8b : 0x1b1f24);
    const w = Math.max(22, bd.tx.width + 12);
    bd.bg.clear(); bd.bg.lineStyle(1.5, bd.isSel ? 0xebe5d6 : BRASS, 1); bd.bg.beginFill(L || locked ? 0x232830 : BRASS, .95);
    bd.bg.drawRoundedRect(-w / 2, -11, w, 22, 11); bd.bg.endFill();
  }
  bd.position.set(x, y);
}
function redraw() {
  og.clear();
  const items = wallSegs();
  [[4, 10, .2], [3, 11, .7], [4, 7, .4], [8, 4, .9], [4, 4, .1], [3, 2, .6]].forEach(([tx, ty, k]) => items.push({ d: tx + ty + 1, fn: g => tree(g, tx, ty, k) }));
  for (const id in B) {
    const b = B[id];
    items.push({ d: b.x + b.y + b.w, fn: g => {
      const top = drawBuilding(g, id), c = iso(b.x + b.w / 2, b.y + b.w / 2);
      bounds[id] = { x0: iso(b.x, b.y + b.w).x, x1: iso(b.x + b.w, b.y).x, y0: top - 18, y1: iso(b.x + b.w, b.y + b.w).y, d: b.x + b.y + b.w };
      placeBadge(id, c.x, top - 12);
    } });
  }
  items.sort((a, b) => a.d - b.d).forEach(it => it.fn(og));
  selG.clear();
  if (sel) { const b = B[sel]; selG.lineStyle(3, BRASS, 1); selG.drawPolygon(diamond(b.x + .04, b.y + .04, b.w - .08, b.w - .08).flatMap(p => [p.x, p.y])); selG.lineStyle(0); }
}

/* ---------- Kamera ---------- */
function clampCam() {
  const s = world.scale.x, W = app.screen.width, H = app.screen.height;
  world.x = Math.min(W * .85 + N * TW / 2 * s, Math.max(W * .15 - N * TW / 2 * s, world.x));
  world.y = Math.min(H * .85 + 40 * s, Math.max(H * .2 - (N * TH + 40) * s, world.y));
}
function zoomAt(p, ns) {
  const s = world.scale.x; ns = Math.min(1.8, Math.max(.32, ns));
  const wx = (p.x - world.x) / s, wy = (p.y - world.y) / s;
  world.scale.set(ns); world.x = p.x - wx * ns; world.y = p.y - wy * ns; clampCam();
}
function centerCam() {
  const s = Math.min(1, Math.max(.42, app.screen.width / 760)), c = iso(6.5, 6.5);
  world.scale.set(s); world.x = app.screen.width / 2 - c.x * s; world.y = app.screen.height * .56 - c.y * s; clampCam();
}
function setupInput() {
  const view = app.view, ptrs = new Map(); let moved = false, downAt = null, pinch = null, lastMid = null;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  view.addEventListener('pointerdown', e => {
    view.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { moved = false; downAt = { x: e.clientX, y: e.clientY }; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: dist(a, b), s: world.scale.x }; lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; moved = true; }
  });
  view.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY }; ptrs.set(e.pointerId, cur);
    if (ptrs.size === 1) { world.x += cur.x - prev.x; world.y += cur.y - prev.y; clampCam(); if (dist(cur, downAt) > 8) moved = true; }
    else if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      world.x += mid.x - lastMid.x; world.y += mid.y - lastMid.y; lastMid = mid;
      zoomAt(mid, pinch.s * dist(a, b) / pinch.d);
    }
  });
  const end = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0 && !moved && e.type === 'pointerup') tap(e.clientX, e.clientY);
    if (ptrs.size < 2) { pinch = null; lastMid = null; }
  };
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
  view.addEventListener('wheel', e => { e.preventDefault(); zoomAt({ x: e.clientX, y: e.clientY }, world.scale.x * (e.deltaY < 0 ? 1.12 : .89)); }, { passive: false });
  window.addEventListener('resize', () => setTimeout(clampCam, 50));
}
let hinted = false;
try { hinted = localStorage.getItem('zk-hint') === '1'; } catch {}
function tap(sx, sy) {
  const s = world.scale.x, wx = (sx - world.x) / s, wy = (sy - world.y) / s;
  let best = null;
  for (const id in bounds) { const r = bounds[id]; if (wx >= r.x0 && wx <= r.x1 && wy >= r.y0 && wy <= r.y1 && (!best || r.d > bounds[best].d)) best = id; }
  if (best) openSheet(best); else closeSheet();
  if (!hinted) { hinted = true; try { localStorage.setItem('zk-hint', '1'); } catch {} }
}

/* ---------- Oberfläche ---------- */
const $ = id => document.getElementById(id);
let sheetSig = '', busy = false;
function renderTop() {
  const c = cap(S);
  $('res').innerHTML = [...RES, 'gold'].map(r => {
    const v = S.res[r], rt = rate(S, r), pct = r === 'gold' ? 0 : Math.min(100, v / c * 100);
    return `<div class="res-cell" title="${RES_DE[r]}"><div class="res-top"><i class="r r-${r}"></i>${fmtN(v)}</div>
      <div class="res-rate ${rt < 0 ? 'neg' : ''}">${rt >= 0 ? '+' : ''}${fmtN(rt)}/h</div>
      <div class="res-bar">${r === 'gold' ? '' : `<i class="${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></i>`}</div></div>`;
  }).join('');
  $('speed').className = 'speed' + (live ? '' : ' off');
  $('speed').innerHTML = live ? `Tempo <b>×${speed}</b>` : 'Verbindung weg';
}
function renderHud() {
  const parts = S.queue.map(q => `<div class="chip">${B[q.id].name} → ${q.target}<span class="mini"><i style="width:${Math.max(0, 1 - q.left / q.total) * 100}%"></i></span>${fmtT(real(q.left))}</div>`);
  if (!S.queue.length) parts.push(`<div class="chip hint">Bauschleife frei (${maxQueues(S)})</div>`);
  const tq = queuedTroops(S);
  parts.push(`<div class="chip">Truppen ${fmtN(troopCount(S))}${tq ? ' · ' + fmtN(tq) + ' in Ausbildung' : ''}</div>`);
  if (!hinted) parts.push('<div class="chip hint">Tippe ein Gebäude an</div>');
  $('hud').innerHTML = parts.join('');
}
function statsHTML(id) {
  const L = S.lv[id], b = B[id], n = L + 1, rows = [];
  const nx = (a, bb) => a + (L < 20 ? ` <span class="up">→ ${bb}</span>` : '');
  if (b.prod) rows.push(['Produktion', nx(fmtN(prodAt(id, L)) + '/h', fmtN(prodAt(id, n)) + '/h')]);
  if (id === 'rathaus') rows.push(['Gebäude bis Stufe', nx(L, n)], ['Bauschleifen', maxQueues(S)], ['Steuergold', fmtN(rate(S, 'gold')) + '/h'], ['Truppenunterhalt', fmtN(troopCount(S)) + ' Nahrung/h']);
  if (id === 'lager') rows.push(['Lagerplatz', nx(fmtN(cap(S)), fmtN(capFor(n)))], ['Plünderschutz', protectedPct(S) + ' %']);
  if (id === 'mauer') rows.push(['Haltbarkeit', nx(fmtN(1000 * L), fmtN(1000 * n))], ['Verteidigung', nx('+' + 5 * L + ' %', '+' + 5 * n + ' %')]);
  if (id === 'lazarett') rows.push(['Plätze', nx(fmtN(200 * L), fmtN(200 * n))]);
  if (b.units && L) rows.push(['Ausbildungszeit', '−' + Math.round((1 - Math.pow(.95, L - 1)) * 100) + ' %']);
  return rows.length ? `<dl class="stats">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : '';
}
function upgradeHTML(id) {
  const L = S.lv[id], t = L + 1, q = inQueue(S, id);
  if (q) return `<div class="block"><h3>${L ? 'Ausbau auf Stufe ' + q.target : 'Wird gebaut'}</h3>
    <div class="row"><div class="prog"><i id="upProg" style="width:${Math.max(0, 1 - q.left / q.total) * 100}%"></i></div><span class="time" id="upTime">${fmtT(real(q.left))}</span></div>
    <div class="row"><button class="btn ghost" data-act="cancel" type="button">Abbrechen (volle Erstattung)</button></div></div>`;
  if (id === 'rathaus' && L >= 20) return '<div class="block"><h3>Ausbau</h3><p class="note">Höchststufe erreicht.</p></div>';
  const c = costOf(id, t), why = blocker(S, id), tm = timeOf(id, t);
  return `<div class="block"><h3>${L ? 'Ausbau auf Stufe ' + t : 'Bauen'}</h3>
    <div class="costs">${costHTML(c)}</div>
    <div class="time">Bauzeit ${fmtT(real(tm))}${speed > 1 ? ' · ohne Testtempo ' + fmtT(tm) : ''}</div>
    <div class="row"><button class="btn" data-act="upgrade" type="button" ${why ? 'disabled' : ''}>${L ? 'Ausbauen' : 'Bauen'}</button>${why ? `<span class="why">${why}</span>` : ''}</div></div>`;
}
function unitsHTML(id) {
  const b = B[id], L = S.lv[id];
  if (!b.units || !L) return '';
  const rows = b.units.map(u => {
    const d = U[u], ok = L >= d.req, n = pick[u] || 10, total = d.cost.map(c => c * n);
    return `<div class="unit">
      <div><div class="unit-name">${d.name}</div><div class="unit-stats">Angriff ${d.a} · Verteidigung ${d.v} · Leben ${d.l} · Tempo ${d.s} · ${fmtT(real(unitTime(S, u, id)))} je Einheit</div></div>
      ${ok ? `<div class="stepper"><button type="button" data-act="minus" data-u="${u}" aria-label="Weniger">−</button><output>${n}</output><button type="button" data-act="plus" data-u="${u}" aria-label="Mehr">+</button></div>` : `<span class="note">ab ${b.name} Stufe ${d.req}</span>`}
      ${ok ? `<div class="row" style="grid-column:1"><span class="costs">${costHTML(total)}</span><button class="btn" type="button" data-act="train" data-u="${u}" ${afford(S, total) && (S.train[id] || []).length < MAX_TRAIN_ORDERS ? '' : 'disabled'}>Ausbilden</button></div>` : ''}
    </div>`;
  }).join('');
  const list = (S.train[id] || []).map((o, i) => `<div class="train-row"><span>${o.count}× ${U[o.unit].name}</span>${i === 0
    ? `<div class="prog"><i id="trProg" style="width:${(1 - o.left / o.per) * 100}%"></i></div><span class="time" id="trTime">${fmtT(real(o.left + (o.count - 1) * o.per))}</span>`
    : '<span class="time">wartet</span>'}</div>`).join('');
  return `<div class="block"><h3>Ausbildung</h3>${rows}${list ? `<div class="block" style="padding:10px">${list}</div>` : ''}</div>`;
}
function troopsHTML() {
  const t = Object.keys(U).filter(u => S.troops[u]);
  return `<div class="block"><h3>Deine Truppen</h3>${t.length ? `<div class="troops">${t.map(u => `<span><b>${fmtN(S.troops[u])}</b> ${U[u].name}</span>`).join('')}</div>` : '<p class="note">Noch keine Truppen. Baue die Kaserne (ab Rathaus 2).</p>'}</div>`;
}
function matchHTML() {
  return `<div class="block"><h3>Partie „${esc(match.name)}“</h3>
    <p class="note">Angemeldet als <b>${esc(me.name)}</b>. Mitspieler: ${match.players.map(esc).join(', ')}.</p>
    <div class="row"><button class="btn ghost" type="button" data-act="logout">Abmelden</button></div></div>`;
}
function signature() {
  if (!sel) return '';
  return JSON.stringify([sel, S.lv, !!inQueue(S, sel), blocker(S, sel), S.queue.length, (S.train[sel] || []).map(o => o.count + o.unit), S.troops, pick, speed, RES.map(r => Math.floor(S.res[r] / 5)), busy]);
}
function renderSheet() {
  if (!sel) return;
  const id = sel, b = B[id], L = S.lv[id];
  $('sheetInner').innerHTML = `<div class="sh-head"><h2>${b.name}</h2><span class="lvl">${L ? 'Stufe ' + L : 'nicht gebaut'}</span><button class="close" type="button" data-act="close">Schließen</button></div>
    <p class="desc">${b.desc}</p>${statsHTML(id)}${upgradeHTML(id)}${unitsHTML(id)}${id === 'rathaus' || (b.units && L) ? troopsHTML() : ''}${id === 'rathaus' ? matchHTML() : ''}`;
  sheetSig = signature();
}
function updateSheet() {
  if (!sel) return;
  if (signature() !== sheetSig) return renderSheet();
  const q = inQueue(S, sel);
  if (q) { const p = $('upProg'), t = $('upTime'); if (p) p.style.width = Math.max(0, 1 - q.left / q.total) * 100 + '%'; if (t) t.textContent = fmtT(real(q.left)); }
  const o = (S.train[sel] || [])[0];
  if (o) { const p = $('trProg'), t = $('trTime'); if (p) p.style.width = (1 - o.left / o.per) * 100 + '%'; if (t) t.textContent = fmtT(real(o.left + (o.count - 1) * o.per)); }
}
function openSheet(id) {
  const b = B[id], s = world.scale.x, c = iso(b.x + b.w / 2, b.y + b.w / 2);
  world.x = app.screen.width / 2 - c.x * s; world.y = app.screen.height * .26 - c.y * s; clampCam();
  sel = id; document.body.classList.add('sheet-open'); renderSheet(); dirty = true;
}
function closeSheet() { sel = null; document.body.classList.remove('sheet-open'); dirty = true; }

async function command(cmd) {
  if (busy) return; busy = true;
  const r = await api('/api/cmd', cmd).catch(() => ({ ok: false, data: { error: 'Keine Verbindung zum Server.' } }));
  busy = false;
  if (r.data && r.data.state) accept(r.data);
  if (!r.ok) toast(r.data.error || 'Das hat nicht geklappt.');
  renderSheet(); renderTop(); renderHud();
}
function setupSheet() {
  $('sheetInner').addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, u = el.dataset.u, id = sel;
    if (act === 'close') return closeSheet();
    if (act === 'upgrade') return command({ type: 'upgrade', id });
    if (act === 'cancel') return command({ type: 'cancel', id });
    if (act === 'train') return command({ type: 'train', id, unit: u, count: pick[u] || 10 });
    if (act === 'plus' || act === 'minus') {
      const n = pick[u] || 10, step = n >= 100 ? 50 : n >= 20 ? 10 : 5;
      pick[u] = Math.max(5, Math.min(1000, act === 'plus' ? n + step : n - step)); renderSheet();
    }
    if (act === 'logout') { await api('/api/logout', {}); location.href = '/'; }
  });
}

/* ---------- Live-Verbindung und Abgleich ---------- */
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', e => { try { accept(JSON.parse(e.data)); } catch {} });
  es.onopen = () => { live = true; };
  es.onerror = () => { live = false; };
}
async function resync() {
  const r = await api('/api/me').catch(() => null);
  if (r && r.ok) { accept(r.data); live = true; }
  else if (r && r.status === 401) location.href = '/';
  else live = false;
}

/* ---------- Start ---------- */
function startGame() {
  $auth.hidden = true; $('game').hidden = false; document.body.classList.add('playing');
  $('matchName').textContent = match.name;
  app = new PIXI.Application({ resizeTo: window, backgroundColor: 0x1b1f24, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
  $('stage').appendChild(app.view);
  world = new PIXI.Container(); app.stage.addChild(world);
  ground = new PIXI.Graphics(); selG = new PIXI.Graphics(); og = new PIXI.Graphics(); badges = new PIXI.Container();
  world.addChild(ground, selG, og, badges);
  setupInput(); setupSheet(); drawGround(); centerCam(); live = true; redraw(); renderTop(); renderHud();
  connect();
  setInterval(resync, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });
  let acc = 0;
  app.ticker.add(() => {
    advanceTo(S, serverNow(), speed); // dieselben Regeln wie auf dem Server, nur zur Anzeige
    acc += app.ticker.deltaMS / 1000;
    if (acc >= .25) { acc = 0; redraw(); renderTop(); renderHud(); updateSheet(); dirty = false; }
    else if (dirty) { redraw(); dirty = false; }
  });
}
boot();
