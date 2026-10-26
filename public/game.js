// Zehn Kronen – Spiel im Browser. Der Server ist maßgeblich; hier wird nur angezeigt
// und zwischen zwei Server-Antworten mit denselben Regeln flüssig weitergerechnet.
import {
  RES, RES_DE, B, U, MAX_TRAIN_ORDERS, costOf, timeOf, cap, capFor, protectedPct, prodAt, troopCount, queuedTroops,
  maxQueues, inQueue, afford, unitTime, rate, blocker, advanceTo, homeTroops, awayTroops, woundedCount, lazarettCap, armySlots
} from '/shared/rules.js';
import { PLAYER_COLORS, GATHER_FULL, planMarch, marchPos, battle, campTroops, campMult, campLoot, capacityOf, sum } from '/shared/world.js';
import { NODE_MAX } from '/shared/mapgen.js';
import { WorldMap } from '/public/map.js';
import { buildingImage } from '/public/art.js';

/* ---------- Verbindung zum Server ---------- */
let S = null, speed = 1, offset = 0, me = null, match = null, live = false, view = null;
let mode = 'city', wm = null, mapReady = false, msel = null, send = {}, planCache = {};
async function api(path, body) {
  const r = await fetch(path, body === undefined ? { credentials: 'same-origin' } : {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  let data = {}; try { data = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data };
}
function accept(v) {
  if (!v || !v.state) return;
  S = v.state; speed = v.match.speed; me = v.me; match = v.match; view = v;
  offset = v.now - Date.now();
  if (wm && mapReady) wm.sync(v, me.id, offset);
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

let app, sel = null;
const pick = {};

/* ---------- Kamera der Karte ---------- */
const cam = () => wm.root;
function clampCam() {
  const c = cam(), s = c.scale.x, W = app.screen.width, H = app.screen.height;
  c.x = Math.min(W / 2 + 3072 * s, Math.max(W / 2 - 3072 * s, c.x));
  c.y = Math.min(H * .7, Math.max(H * .3 - 3300 * s, c.y));
}
function zoomAt(p, ns) {
  const c = cam(), s = c.scale.x; ns = Math.min(1.7, Math.max(.14, ns));
  const wx = (p.x - c.x) / s, wy = (p.y - c.y) / s;
  c.scale.set(ns); c.x = p.x - wx * ns; c.y = p.y - wy * ns; clampCam();
}
function focusMap(tx, ty, zoom) {
  const c = wm.root, s = zoom || c.scale.x, p = wm.worldPos(tx, ty);
  c.scale.set(s); c.x = app.screen.width / 2 - p.x * s; c.y = app.screen.height * (document.body.classList.contains('sheet-open') ? .26 : .46) - p.y * s; clampCam();
}
function setupInput() {
  const view = app.view, ptrs = new Map(); let moved = false, downAt = null, pinch = null, lastMid = null;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  view.addEventListener('pointerdown', e => {
    view.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { moved = false; downAt = { x: e.clientX, y: e.clientY }; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: dist(a, b), s: cam().scale.x }; lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; moved = true; }
  });
  view.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY }; ptrs.set(e.pointerId, cur);
    if (ptrs.size === 1) { cam().x += cur.x - prev.x; cam().y += cur.y - prev.y; clampCam(); if (dist(cur, downAt) > 8) moved = true; }
    else if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      cam().x += mid.x - lastMid.x; cam().y += mid.y - lastMid.y; lastMid = mid;
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
  view.addEventListener('wheel', e => { e.preventDefault(); zoomAt({ x: e.clientX, y: e.clientY }, cam().scale.x * (e.deltaY < 0 ? 1.12 : .89)); }, { passive: false });
  window.addEventListener('resize', () => setTimeout(clampCam, 50));
}
function tap(sx, sy) { mapTap(sx, sy); }

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
  for (const m of ownMarches()) parts.push(`<button class="chip go" type="button" data-march="${m.id}">${marchLine(m)}</button>`);
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
    <p class="note">Angemeldet als <b>${esc(me.name)}</b>. Mitspieler: ${match.players.map(p => esc(p.name)).join(', ')}.</p>
    <div class="row"><button class="btn ghost" type="button" data-act="logout">Abmelden</button></div></div>`;
}
function signature() {
  if (msel) return mapSignature();
  if (!sel) return '';
  return JSON.stringify([sel, S.lv, !!inQueue(S, sel), blocker(S, sel), S.queue.length, (S.train[sel] || []).map(o => o.count + o.unit), S.troops, pick, speed, RES.map(r => Math.floor(S.res[r] / 5)), busy]);
}
function renderSheet() {
  if (msel) return renderMapSheet();
  if (!sel) return;
  const id = sel, b = B[id], L = S.lv[id];
  $('sheetInner').innerHTML = `<img class="sh-img" alt="" src="${imgOf(id)}"><div class="sh-head"><h2>${b.name}</h2><span class="lvl">${L ? 'Stufe ' + L : 'nicht gebaut'}</span><button class="close" type="button" data-act="close">Schließen</button></div>
    <p class="desc">${b.desc}</p>${statsHTML(id)}${upgradeHTML(id)}${unitsHTML(id)}${id === 'rathaus' || (b.units && L) ? troopsHTML() : ''}${id === 'lazarett' && L ? healHTML() : ''}${id === 'rathaus' ? matchHTML() : ''}`;
  sheetSig = signature();
}
function updateSheet() {
  if (msel) return updateMapSheet();
  if (!sel) return;
  if (signature() !== sheetSig) return renderSheet();
  const q = inQueue(S, sel);
  if (q) { const p = $('upProg'), t = $('upTime'); if (p) p.style.width = Math.max(0, 1 - q.left / q.total) * 100 + '%'; if (t) t.textContent = fmtT(real(q.left)); }
  const o = (S.train[sel] || [])[0];
  if (o) { const p = $('trProg'), t = $('trTime'); if (p) p.style.width = (1 - o.left / o.per) * 100 + '%'; if (t) t.textContent = fmtT(real(o.left + (o.count - 1) * o.per)); }
}
function openSheet(id) { msel = null; sel = id; document.body.classList.add('sheet-open'); renderSheet(); }
function closeSheet() { sel = null; msel = null; if (wm) wm.select(null); document.body.classList.remove('sheet-open'); }

async function command(cmd) {
  if (busy) return false; busy = true;
  const r = await api('/api/cmd', cmd).catch(() => ({ ok: false, data: { error: 'Keine Verbindung zum Server.' } }));
  busy = false;
  if (r.data && r.data.state) accept(r.data);
  if (!r.ok) toast(r.data.error || 'Das hat nicht geklappt.');
  renderSheet(); renderTop(); renderHud(); renderNav(); renderCity(true);
  return r.ok;
}
function setupSheet() {
  $('sheetInner').addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, u = el.dataset.u, id = sel;
    if (act === 'close') return closeSheet();
    if (mapAct(act, el)) return;
    if (act === 'upgrade') return command({ type: 'upgrade', id });
    if (act === 'cancel') return command({ type: 'cancel', id });
    if (act === 'train') return command({ type: 'train', id, unit: u, count: pick[u] || 10 });
    if (act === 'plus' || act === 'minus') {
      const n = pick[u] || 10, step = n >= 100 ? 50 : n >= 20 ? 10 : 5;
      pick[u] = Math.max(5, Math.min(1000, act === 'plus' ? n + step : n - step)); renderSheet();
    }
    if (act === 'heal') return command({ type: 'heal', unit: u, count: Math.min(S.wounded[u] || 0, Number(el.dataset.n) || 1e9) });
    if (act === 'logout') { await api('/api/logout', {}); location.href = '/'; }
  });
}

/* ---------- Stadt als Menü (wie bei Lords & Knights) ---------- */
const BGROUPS = [['Wirtschaft', ['farm', 'saege', 'stein', 'mine', 'lager']], ['Militär', ['kaserne', 'schiess', 'stall', 'lazarett']], ['Verwaltung', ['akademie', 'mauer']]];
const imgCache = {};
const tierOf = L => L >= 14 ? 3 : L >= 7 ? 2 : 1;
function imgOf(id) {
  const t = id === 'rathaus' ? tierOf(S.lv.rathaus) : 1, key = id + t;
  if (!imgCache[key]) imgCache[key] = buildingImage(id, t).toDataURL('image/jpeg', .86);
  return imgCache[key];
}
function cityMeta(id) {
  const L = S.lv[id], b = B[id];
  if (!L) return S.lv.rathaus < b.unlock ? 'Noch gesperrt' : 'Noch nicht gebaut';
  if (b.prod) return `<b>+${fmtN(prodAt(id, L))}</b>/h ${RES_DE[b.prod]}`;
  if (id === 'lager') return `Lager <b>${fmtN(cap(S))}</b> · Schutz ${protectedPct(S)} %`;
  if (id === 'mauer') return `Verteidigung <b>+${5 * L} %</b>`;
  if (id === 'lazarett') return `Verwundete <b>${fmtN(woundedCount(S))}</b> / ${fmtN(lazarettCap(S))}`;
  if (b.units) return `Ausbildung <b>−${Math.round((1 - Math.pow(.95, L - 1)) * 100)} %</b> Zeit`;
  if (id === 'akademie') return 'Forschung folgt';
  return b.desc;
}
function buildingCard(id) {
  const b = B[id], L = S.lv[id], q = inQueue(S, id), locked = L === 0 && S.lv.rathaus < b.unlock, why = locked ? '' : blocker(S, id);
  const t = (S.train[id] || [])[0];
  let foot;
  if (q) foot = `<div class="bprog"><div class="prog"><i data-qprog="${id}" style="width:${Math.max(0, 1 - q.left / q.total) * 100}%"></i></div><span class="time" data-qtime="${id}">${fmtT(real(q.left))}</span></div>`;
  else if (locked) foot = `<div class="bfoot"><span class="why">Rathaus Stufe ${b.unlock} nötig</span></div>`;
  else if (id === 'rathaus' && L >= 20) foot = '<div class="bfoot"><span class="note">Höchststufe</span></div>';
  else foot = `<div class="bfoot"><span class="costs sm">${costHTML(costOf(id, L + 1))}</span><button class="btn small" type="button" data-up="${id}" ${why ? 'disabled' : ''}>${L ? 'Ausbauen' : 'Bauen'}</button></div>${why ? `<div class="why one">${why}</div>` : ''}`;
  const extra = t ? `<div class="bmeta"><span data-tinfo="${id}">${t.count}× ${U[t.unit].name}${t.heal ? ' (Heilung)' : ''} · ${fmtT(real(t.left + (t.count - 1) * t.per))}</span></div>` : '';
  return `<article class="bcard ${locked ? 'locked' : L ? '' : 'empty'}" data-b="${id}"><div class="bimg"><img alt="" src="${imgOf(id)}"><span class="blv">${L || '–'}</span>${q ? '<span class="btag">Im Bau</span>' : ''}</div>
    <div class="bname">${b.name}</div><div class="bmeta">${cityMeta(id)}</div>${extra}${foot}</article>`;
}
function citySig() {
  return JSON.stringify([S.lv, S.queue.map(q => q.id + q.target), Object.keys(S.train).map(k => k + S.train[k].map(o => o.count + o.unit).join()), S.troops, S.away, S.wounded,
    Object.keys(B).map(id => (S.lv[id] === 0 && S.lv.rathaus < B[id].unlock) ? 'L' : blocker(S, id)), ownMarches().map(m => m.id + m.phase), unread(), me.name, match.name]);
}
let citySigV = '';
function renderCity(force) {
  if (!S || !$('city')) return;
  const sig = citySig(); if (!force && sig === citySigV) return; citySigV = sig;
  const L = S.lv.rathaus, q = S.queue, marches = ownMarches();
  const tr = []; for (const k in S.train) for (const [i, o] of S.train[k].entries()) tr.push({ k, o, first: i === 0 });
  const queueRows = q.map(x => `<div class="qrow"><img alt="" src="${imgOf(x.id)}"><div class="qmain"><b>${B[x.id].name}</b> → Stufe ${x.target}<div class="prog"><i data-qprog="${x.id}" style="width:${Math.max(0, 1 - x.left / x.total) * 100}%"></i></div></div><span class="time" data-qtime="${x.id}">${fmtT(real(x.left))}</span></div>`).join('')
    + (q.length < maxQueues(S) ? `<div class="qrow free"><div class="qmain">Bauschleife frei – wähle unten ein Gebäude zum Ausbau.</div></div>` : '');
  const trainRows = tr.map(({ k, o, first }) => `<div class="qrow"><img alt="" src="${imgOf(k)}"><div class="qmain"><b>${B[k].name}</b>: ${o.count}× ${U[o.unit].name}${o.heal ? ' heilen' : ''}${first ? `<div class="prog"><i data-tprog="${k}" style="width:${(1 - o.left / o.per) * 100}%"></i></div>` : ''}</div><span class="time" ${first ? `data-ttime="${k}"` : ''}>${first ? fmtT(real(o.left + (o.count - 1) * o.per)) : 'wartet'}</span></div>`).join('');
  const marchRows = marches.map(m => `<button class="qrow go" type="button" data-march="${m.id}"><div class="qmain"><b>Heer</b> · ${KIND_SHORT[m.tk] || ''}</div><span class="time" data-mtime="${m.id}">${marchLine(m)}</span></button>`).join('');
  const home = homeTroops(S), away = awayTroops(S), wd = woundedCount(S);
  $('city').innerHTML = `<div class="city-in">
    <article class="hero" data-b="rathaus"><img alt="" src="${imgOf('rathaus')}"><div class="hero-t"><div><div class="hero-name">Burg von ${esc(me.name)}</div><div class="hero-sub">Rathaus Stufe ${L} · Partie „${esc(match.name)}“</div></div><span class="hero-lv">${L}</span></div>
    </article>
    <div class="stats-row"><div><b>${fmtN(home)}</b><span>Truppen daheim</span></div><div><b>${fmtN(away)}</b><span>unterwegs</span></div><div><b>${fmtN(wd)}</b><span>verwundet</span></div><div><b>${fmtN(rate(S, 'gold'))}</b><span>Gold/h</span></div></div>
    <section><h3 class="sec">Aufträge</h3>${queueRows}${trainRows}${marchRows}</section>
    ${BGROUPS.map(([title, ids]) => `<section><h3 class="sec">${title}</h3><div class="bgrid">${ids.map(buildingCard).join('')}</div></section>`).join('')}
  </div>`;
}
function updateCity() {
  renderCity(false);
  for (const x of S.queue) {
    const p = document.querySelectorAll(`[data-qprog="${x.id}"]`), t = document.querySelectorAll(`[data-qtime="${x.id}"]`);
    p.forEach(e => { e.style.width = Math.max(0, 1 - x.left / x.total) * 100 + '%'; }); t.forEach(e => { e.textContent = fmtT(real(x.left)); });
  }
  for (const k in S.train) { const o = S.train[k][0]; if (!o) continue;
    document.querySelectorAll(`[data-tprog="${k}"]`).forEach(e => { e.style.width = (1 - o.left / o.per) * 100 + '%'; });
    document.querySelectorAll(`[data-ttime="${k}"]`).forEach(e => { e.textContent = fmtT(real(o.left + (o.count - 1) * o.per)); });
    document.querySelectorAll(`[data-tinfo="${k}"]`).forEach(e => { e.textContent = `${o.count}× ${U[o.unit].name}${o.heal ? ' (Heilung)' : ''} · ${fmtT(real(o.left + (o.count - 1) * o.per))}`; }); }
  for (const m of ownMarches()) document.querySelectorAll(`[data-mtime="${m.id}"]`).forEach(e => { e.textContent = marchLine(m); });
}
function setupCity() {
  $('city').addEventListener('click', async e => {
    const up = e.target.closest('[data-up]');
    if (up) { e.stopPropagation(); return void command({ type: 'upgrade', id: up.dataset.up }); }
    const mb = e.target.closest('[data-march]');
    if (mb) { await setMode('map'); if (mode === 'map') selectMap({ type: 'march', id: Number(mb.dataset.march) }, true); return; }
    const c = e.target.closest('[data-b]'); if (c) openSheet(c.dataset.b);
  });
}

/* ---------- Karte: Bedienung ---------- */
const OBJ_NAME = { farm: 'Kornfeld', wood: 'Holzfällerlager', stone: 'Steinbruch', ore: 'Erzmine', camp: 'Banditenlager', ruin: 'Alte Ruine', sanct: 'Heiligtum', throne: 'Der Thron', start: 'Burg' };
const KIND_SHORT = { farm: 'Feld', wood: 'Wald', stone: 'Bruch', ore: 'Mine', camp: 'Lager', ruin: 'Ruine', sanct: 'Heiligtum', throne: 'Thron' };
const gtNow = () => { const w = view.world; return w.gt + (Date.now() + offset - w.at) / 1000 * speed; };
const ownMarches = () => view ? view.world.marches.filter(m => m.own) : [];
function marchRemain(m) { const L = m.arr[m.arr.length - 1], g = gtNow(); return m.phase === 'gather' ? m.tEnd - g : m.t0 + L - g; }
function marchLine(m) {
  const ph = m.phase === 'out' ? 'Marsch' : m.phase === 'gather' ? 'Sammelt' : 'Rückweg';
  return `${ph} · ${KIND_SHORT[m.tk] || ''} · ${fmtT(real(Math.max(0, marchRemain(m))))}`;
}
const lootHTML = l => Object.keys(l).filter(r => l[r] > 0).map(r => `<span class="cost"><i class="r r-${r}"></i>${fmtN(l[r])}</span>`).join('');
const troopsLine = t => Object.keys(t).filter(u => t[u] > 0 && U[u]).map(u => `${fmtN(t[u])} ${U[u].name}`).join(', ') || '—';
function healHTML() {
  const ws = Object.keys(S.wounded || {}).filter(u => S.wounded[u] > 0);
  const queue = (S.train.lazarett || []).map((o, i) => `<div class="train-row"><span>${o.count}× ${U[o.unit].name} werden geheilt</span>${i === 0 ? `<div class="prog"><i id="trProg" style="width:${(1 - o.left / o.per) * 100}%"></i></div><span class="time" id="trTime">${fmtT(real(o.left + (o.count - 1) * o.per))}</span>` : '<span class="time">wartet</span>'}</div>`).join('');
  const rows = ws.map(u => {
    const n = S.wounded[u], all = U[u].cost.map(c => Math.ceil(c * n * .3)), ten = Math.min(n, 10);
    return `<div class="unit"><div><div class="unit-name">${fmtN(n)}× ${U[u].name} verwundet</div><div class="unit-stats">Heilen kostet 30 % der Ausbildung · ${fmtT(real(U[u].t * .25))} je Einheit</div></div>
      <div class="row" style="grid-column:1/-1"><span class="costs">${costHTML(all)}</span>${n > 10 ? `<button class="btn ghost" type="button" data-act="heal" data-u="${u}" data-n="10">10 heilen</button>` : ''}<button class="btn" type="button" data-act="heal" data-u="${u}" data-n="${n}" ${afford(S, all) && (S.train.lazarett || []).length < MAX_TRAIN_ORDERS ? '' : 'disabled'}>${n > 10 ? 'Alle' : 'Heilen'}</button></div></div>`;
  }).join('');
  return `<div class="block"><h3>Verwundete (${fmtN(woundedCount(S))} von ${fmtN(lazarettCap(S))} Plätzen)</h3>${rows || '<p class="note">Niemand verwundet. Nach Kämpfen überleben bis zu 30 % der Verluste hier, wenn Platz ist.</p>'}${queue ? `<div class="block" style="padding:10px">${queue}</div>` : ''}</div>`;
}

function mapTap(sx, sy) {
  if (!wm || !mapReady) return;
  const c = wm.root, s = c.scale.x, hit = wm.pickAt((sx - c.x) / s, (sy - c.y) / s);
  if (!hit) { closeSheet(); return; }
  selectMap(hit, false);
}
function selectMap(hit, keepSend) {
  sel = null; msel = hit; wm.select(hit);
  if (!keepSend) { send = {}; for (const u in S.troops) if (S.troops[u] > 0) send[u] = S.troops[u]; }
  document.body.classList.add('sheet-open');
  if (hit.type === 'obj') { const o = wm.map.byId[hit.id]; focusMap(o.x + .5, o.y + .5); }
  else { const m = view.world.marches.find(x => x.id === hit.id); if (m) { const p = marchPos(m, gtNow()); focusMap(p.x, p.y); } }
  renderSheet();
}
function mapSignature() {
  const w = view.world, id = msel.id;
  return JSON.stringify([msel, send, S.troops, S.lv.rathaus, ownMarches().map(m => m.id + m.phase), w.camps[id] || 0, w.nodes[id], w.ruins[id], RES.map(r => Math.floor(S.res[r] / 50)), busy, (view.match.players || []).length]);
}
function sendList() { const t = {}; for (const u in send) if (send[u] > 0) t[u] = send[u]; return t; }
function planFor(o) {
  const t = sendList(), key = o.id + JSON.stringify(t) + S.pos;
  if (!sum(t)) return null;
  if (planCache.key !== key) planCache = { key, plan: planMarch(wm.map, S, o, t) };
  return planCache.plan;
}
function pickerHTML() {
  const us = Object.keys(U).filter(u => S.troops[u] > 0);
  if (!us.length) return '<p class="note">Du hast keine Truppen zu Hause. Bilde sie in der Kaserne aus (Stadt).</p>';
  return `<div class="block picker"><h3>Heer <span class="quick"><button class="btn ghost small" type="button" data-act="sall">Alle</button><button class="btn ghost small" type="button" data-act="snone">Keine</button></span></h3>${us.map(u => `<div class="unit"><div><div class="unit-name">${U[u].name}</div><div class="unit-stats">daheim ${fmtN(S.troops[u])} · trägt ${U[u].c}</div></div>
    <div class="stepper"><button type="button" data-act="sminus" data-u="${u}" aria-label="Weniger">−</button><output>${fmtN(send[u] || 0)}</output><button type="button" data-act="splus" data-u="${u}" aria-label="Mehr">+</button></div></div>`).join('')}</div>`;
}
function renderMapSheet() {
  const w = view.world; let h = '';
  if (msel.type === 'march') {
    const m = w.marches.find(x => x.id === msel.id);
    if (!m) { closeSheet(); return; }
    const tgt = wm.map.byId[m.tid], ph = m.phase === 'out' ? 'auf dem Weg zum Ziel' : m.phase === 'gather' ? 'sammelt' : 'auf dem Rückweg';
    h = `<div class="sh-head"><h2>${m.own ? 'Dein Heer' : 'Heer von ' + esc(m.name)}</h2><span class="lvl">${ph}</span><button class="close" type="button" data-act="close">Schließen</button></div>
      <dl class="stats"><dt>Ziel</dt><dd>${tgt ? OBJ_NAME[tgt.k] + (tgt.lv ? ' ' + tgt.lv : '') : '—'}</dd><dt>Noch</dt><dd id="mTime">${fmtT(real(Math.max(0, marchRemain(m))))}</dd>
      <dt>Truppen</dt><dd>${m.own ? troopsLine(m.troops) : fmtN(m.troops.n || 0) + ' Einheiten'}</dd>${m.own && m.load && Object.keys(m.load).length ? `<dt>Beute</dt><dd class="costs">${lootHTML(m.load)}</dd>` : ''}
      ${m.phase === 'gather' && m.own ? `<dt>Sammelt</dt><dd class="costs">${lootHTML({ [m.res]: Math.floor(m.amount * Math.max(0, Math.min(1, (gtNow() - m.tStart) / (m.tEnd - m.tStart || 1)))) })} <span class="note">von ${fmtN(m.amount)}</span></dd>` : ''}</dl>
      ${m.own && m.phase !== 'back' ? `<div class="row"><button class="btn ghost" type="button" data-act="recall">${m.phase === 'gather' ? 'Heimrufen (Beute bis jetzt)' : 'Zurückrufen'}</button></div>` : ''}`;
  } else {
    const o = wm.map.byId[msel.id], k = o.k, id = o.id, free = ownMarches().length < armySlots(S);
    const title = k === 'start' ? ((view.match.players.find(p => p.slot === o.slot) || {}).name ? 'Burg von ' + esc(view.match.players.find(p => p.slot === o.slot).name) : 'Freier Burgplatz') : OBJ_NAME[k];
    const lv = o.lv ? `<span class="lvl">Stufe ${o.lv}</span>` : '';
    let body = '';
    if (['farm', 'wood', 'stone', 'ore'].includes(k)) {
      const max = NODE_MAX(o.lv), left = w.nodes[id] == null ? max : w.nodes[id], res = { farm: 'food', wood: 'wood', stone: 'stone', ore: 'ore' }[k], plan = planFor(o);
      body = `<dl class="stats"><dt>Vorrat</dt><dd>${fmtN(left)} von ${fmtN(max)} ${RES_DE[res]}</dd></dl>${pickerHTML()}`;
      if (plan && !plan.error) {
        const amount = Math.floor(Math.min(plan.capacity, left)), gather = amount ? GATHER_FULL * amount / plan.capacity : 0;
        body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan.duration))}</dd><dt>Traglast</dt><dd>${fmtN(plan.capacity)}</dd><dt>Ertrag</dt><dd class="costs">${lootHTML({ [res]: amount })}</dd><dt>Sammeln</dt><dd>${fmtT(real(gather))}</dd><dt>Gesamt</dt><dd>${fmtT(real(2 * plan.duration + gather))}</dd></dl>`;
      }
      body += actionRow('Sammeln', plan, left < 50 ? 'Das Feld ist erschöpft.' : '', free);
    } else if (k === 'camp') {
      const dead = (w.camps[id] || 0) > gtNow(), def = campTroops(o.lv), mult = campMult(o.lv), plan = planFor(o), sel_ = sendList();
      body = `<dl class="stats"><dt>Verteidiger</dt><dd>${troopsLine(def)}</dd><dt>Stärke</dt><dd>+${Math.round((mult - 1) * 100)} %</dd><dt>Beute</dt><dd class="costs">${lootHTML(campLoot(o.lv))}</dd></dl>`;
      if (dead) body += '<p class="why">Dieses Lager ist gerade zerstört.</p>';
      else {
        body += pickerHTML();
        if (plan && !plan.error) {
          const r = battle(sel_, def, mult), lost = sum(sel_) - sum(r.attLeft);
          body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan.duration))}</dd><dt>Prognose</dt><dd class="${r.win ? '' : 'why'}">${r.win ? `Sieg · du verlierst ${fmtN(lost)} von ${fmtN(sum(sel_))}` : 'Niederlage · dein Heer wird aufgerieben'}</dd></dl>`;
        }
        body += actionRow('Angreifen', plan, '', free);
      }
    } else if (k === 'ruin') {
      const done = !!w.ruins[id], plan = planFor(o), loot = { food: 200 * o.lv, wood: 200 * o.lv, stone: 300 * o.lv, ore: 300 * o.lv, gold: 150 * o.lv };
      body = `<dl class="stats"><dt>Beute (einmalig)</dt><dd class="costs">${lootHTML(loot)}</dd></dl>`;
      if (done) body += '<p class="why">Diese Ruine ist schon geplündert.</p>';
      else { body += pickerHTML(); if (plan && !plan.error) body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan.duration))}</dd></dl>`; body += actionRow('Plündern', plan, '', free); }
    } else if (k === 'start') {
      const p = view.match.players.find(x => x.slot === o.slot);
      body = p ? `<p class="desc">Rathaus Stufe ${p.rathaus}. ${p.id === me.id ? 'Das ist deine Burg.' : 'Angriffe auf andere Spieler kommen in einem späteren Schritt.'}</p>${p.id === me.id ? '<div class="row"><button class="btn" type="button" data-act="toCity">Zur Stadt</button></div>' : ''}`
        : '<p class="desc">Hier ist noch niemand eingezogen. Mit dem Einladungslink kann ein Mitspieler diesen Platz besetzen.</p>';
    } else if (k === 'sanct') body = '<p class="desc">Ein altes Heiligtum an den vier Wegen zum Thron. Wer es hält, soll später Vorteile bekommen – das kommt in einem späteren Schritt.</p>';
    else body = '<p class="desc">In der Mitte der Welt wartet der Thron. Wer ihn am Ende hält, trägt die Zehn Kronen. Der Kampf darum kommt in einem späteren Schritt.</p>';
    h = `<div class="sh-head"><h2>${title}</h2>${lv}<button class="close" type="button" data-act="close">Schließen</button></div>${body}`;
  }
  $('sheetInner').innerHTML = h; sheetSig = mapSignature();
}
function actionRow(label, plan, why, free) {
  const bad = why || (!sum(sendList()) ? 'Wähle Truppen aus.' : !free ? 'Alle Heere sind unterwegs.' : plan && plan.error ? plan.error : '');
  return `<div class="row"><button class="btn" type="button" data-act="march" ${bad ? 'disabled' : ''}>${label}</button>${bad ? `<span class="why">${bad}</span>` : ''}</div>`;
}
function updateMapSheet() {
  if (!msel) return;
  if (mapSignature() !== sheetSig) return renderSheet();
  if (msel.type === 'march') { const m = view.world.marches.find(x => x.id === msel.id), t = $('mTime'); if (m && t) t.textContent = fmtT(real(Math.max(0, marchRemain(m)))); }
}
function mapAct(act, el) {
  if (!['sminus', 'splus', 'sall', 'snone', 'march', 'recall', 'toCity'].includes(act)) return false;
  const u = el.dataset.u;
  if (act === 'splus' || act === 'sminus') {
    const home = S.troops[u] || 0, n = send[u] || 0, step = n >= 100 ? 50 : n >= 20 ? 10 : 5;
    send[u] = Math.max(0, Math.min(home, act === 'splus' ? n + step : n - step)); renderSheet();
  } else if (act === 'sall') { send = {}; for (const k in S.troops) if (S.troops[k] > 0) send[k] = S.troops[k]; renderSheet(); }
  else if (act === 'snone') { send = {}; renderSheet(); }
  else if (act === 'toCity') setMode('city');
  else if (act === 'march') command({ type: 'march', target: msel.id, troops: sendList() }).then(ok => { if (ok) { toast('Dein Heer ist unterwegs.'); closeSheet(); } });
  else if (act === 'recall') command({ type: 'recall', id: msel.id });
  return true;
}

/* ---------- Berichte ---------- */
const unread = () => S.reports.filter(r => !r.read).length;
function ago(t) { const s = Math.max(0, (Date.now() + offset - t) / 1000); return s < 90 ? 'gerade eben' : s < 5400 ? Math.round(s / 60) + ' Min.' : s < 129600 ? Math.round(s / 3600) + ' Std.' : Math.round(s / 86400) + ' Tage'; }
function reportHTML(r) {
  let d = '';
  if (r.att) {
    const rows = Object.keys(r.att.start).map(u => `<tr><td>${U[u].name}</td><td>${fmtN(r.att.start[u])}</td><td>${fmtN(r.att.left[u] || 0)}</td><td>${fmtN((r.att.wounded || {})[u] || 0)}</td><td>${fmtN((r.att.dead || {})[u] || 0)}</td></tr>`).join('');
    const drows = Object.keys(r.def.start).map(u => `<tr><td>${U[u].name}</td><td>${fmtN(r.def.start[u])}</td><td>${fmtN(r.def.left[u] || 0)}</td></tr>`).join('');
    d += `<table class="rep"><thead><tr><th>Dein Heer</th><th>Vor</th><th>Übrig</th><th>Verw.</th><th>Gef.</th></tr></thead><tbody>${rows}</tbody></table>
      <table class="rep"><thead><tr><th>Banditen</th><th>Vor</th><th>Übrig</th></tr></thead><tbody>${drows}</tbody></table>
      <p class="note">${r.rounds ? r.rounds.length + ' Kampfrunden.' : ''}</p>`;
  }
  if (r.text) d += `<p class="desc">${esc(r.text)}</p>`;
  if (r.loot && Object.keys(r.loot).length) d += `<div class="costs">${lootHTML(r.loot)}</div>`;
  return `<details class="report ${r.read ? '' : 'new'} ${r.win ? 'win' : 'loss'}"><summary><b>${esc(r.title)}</b><span class="time">${ago(r.t)}</span></summary>${d}</details>`;
}
function renderReports() {
  const list = S.reports.map(reportHTML).join('') || '<p class="note">Noch keine Berichte. Schicke ein Heer zu einem Feld oder Banditenlager.</p>';
  $('reportsInner').innerHTML = `<div class="sh-head"><h2>Berichte</h2><button class="close" type="button" data-act="rclose">Schließen</button></div>${list}`;
}
function openReports() {
  closeSheet(); renderReports(); $('reports').hidden = false; document.body.classList.add('reports-open'); setNav('reports');
  if (unread()) api('/api/cmd', { type: 'readReports' }).then(r => { if (r.data && r.data.state) { S.reports.forEach(x => { x.read = true; }); renderNav(); } });
}
function closeReports() { $('reports').hidden = true; document.body.classList.remove('reports-open'); setNav(mode); }
function renderNav() { const n = S ? unread() : 0, b = $('navBadge'); if (b) { b.textContent = n; b.hidden = !n; } }
function setNav(m) { document.querySelectorAll('.nav button[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === m)); }

/* ---------- Umschalten Stadt / Karte ---------- */
async function buildMap() {
  if (mapReady) return true;
  const el = $('loading'); el.hidden = false; await new Promise(r => setTimeout(r, 40));
  try {
    const r = await api('/api/map'); if (!r.ok) throw new Error(r.data.error || 'Karte nicht verfügbar');
    document.body.classList.add('mode-map');   // damit die Zeichenfläche eine Größe hat
    app = new PIXI.Application({ resizeTo: window, backgroundColor: 0x05182d, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    $('stage').appendChild(app.view);
    wm = new WorldMap(PIXI, app); wm.load(r.data); app.stage.addChild(wm.root); mapReady = true; wm.sync(view, me.id, offset);
    const own = wm.map.starts[S.slot] || { x: 48, y: 48 };
    wm.root.scale.set(Math.min(.8, Math.max(.45, app.screen.width / 640)));
    focusMap(own.x + .5, own.y + .5);
    setupInput();
    app.ticker.add(() => { if (mode !== 'map') return; const c = wm.root, s = c.scale.x, H = app.screen.height; wm.frame(app.ticker.deltaMS / 1000, s, { y0: -c.y / s, y1: (H - c.y) / s }); });
    document.body.classList.remove('mode-map');
  } catch (e) { document.body.classList.remove('mode-map'); toast(String(e.message || e)); el.hidden = true; return false; }
  el.hidden = true; return true;
}
async function setMode(m) {
  if (!$('reports').hidden) closeReports();
  if (m === mode && (m === 'city' || mapReady)) return;
  if (m === 'map' && !(await buildMap())) return;
  closeSheet(); mode = m;
  document.body.classList.toggle('mode-map', m === 'map'); setNav(m);
  if (app) { if (m === 'map') app.ticker.start(); else app.ticker.stop(); }
  $('city').hidden = m === 'map'; renderHud(); if (m === 'city') renderCity(true);
}
function setupNav() {
  $('nav').addEventListener('click', e => {
    const b = e.target.closest('button[data-nav]'); if (!b) return;
    if (b.dataset.nav === 'reports') return openReports();
    setMode(b.dataset.nav);
  });
  $('reportsInner').addEventListener('click', e => { if (e.target.closest('[data-act=rclose]')) closeReports(); });
  $('hud').addEventListener('click', async e => {
    const c = e.target.closest('[data-march]'); if (!c) return;
    await setMode('map'); if (mode === 'map') selectMap({ type: 'march', id: Number(c.dataset.march) }, true);
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
  setupSheet(); setupNav(); setupCity(); live = true; renderNav(); renderTop(); renderHud(); renderCity(true);
  connect();
  setInterval(resync, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });
  setInterval(() => {
    advanceTo(S, serverNow(), speed); // dieselben Regeln wie auf dem Server, nur zur Anzeige
    renderTop(); renderHud(); updateSheet(); if (mode === 'city') updateCity();
  }, 250);
}
window.__zk = { get wm() { return wm; }, get cam() { return wm && wm.root; }, get sel() { return msel; } };   // nur für Tests
boot();
