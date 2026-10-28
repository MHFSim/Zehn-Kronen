// Zehn Kronen – Spiel im Browser. Der Server ist maßgeblich; hier wird nur angezeigt
// und zwischen zwei Server-Antworten mit denselben Regeln flüssig weitergerechnet.
import {
  RES, RES_DE, B, U, GATT, MAX_TRAIN_ORDERS, MAX_TRAIN_COUNT, costOf, timeOf, buildTime, techTimeFor, cap, capFor, protectedPct, prodAt, troopCount, queuedTroops,
  maxQueues, inQueue, afford, unitTime, rate, blocker, advanceTo, homeTroops, awayTroops, woundedCount, lazarettCap, armySlots,
  T, T_MAX, T_PRE_LV, SPEED_IDS, SPEED_SLACK, FINDS, planSpeeds, techLv, techMult, techBonus, techReq, techCost, techTime, techBlocker, bonusOf, ITEMS, TELEPORT_COOLDOWN, QUEST_INFO, dailyDone, secUntilNextDay, PACK_NAME, DAILY_SPEED_GIFT
} from '/shared/rules.js';
import { FIELD, FG, SCOUT_SEC, SCOUT_SPEED, SPY_SEC, fieldName, fieldAt, fieldCenter, PLAYER_COLORS, SIEGE_TIME, FIGHT_TIME, GATHER_SEC, planMarch, planFrom, marchPos, cellXY } from '/shared/core.js';
import { castleSafe, scoreOf, MUT_MAX, MUT_COST } from '/shared/war.js';
import { HEROES, HERO_IDS, HERO_MAX, xpNeed, skillList, heroPrefers, heroForce, heroLv, raiderXp } from '/shared/heroes.js';
import { cityR, checkSite, checkRaid, checkTeleport, touchesObj, OP_COST, OP_MIN_TROOPS, OP_BUILD, OP_BUILD_FAST, OP_HELP_MAX, opBuildTime, OP_R, maxOutposts, opGuard, opReady, CLAN_SHARE } from '/shared/outpost.js';
import { battle, campTroops, campMult, campLoot, capacityOf, sum, holdGuard, forceOf } from '/shared/combat.js';
import { NODE_MAX, N, MARCH_BOOST } from '/shared/mapgen.js';
import { WorldMap } from '/public/map.js';
import { HERO_PIC } from '/public/heropics.js';
import { HERO_ART, HERO_POS } from '/public/heroart.js';
import { snd } from '/public/sound.js';
import { CityView } from '/public/city3d.js';
import { buildingImage } from '/public/art.js';
import { installIcons, banner, icon } from '/public/icons.js';

/* ---------- Verbindung zum Server ---------- */
let S = null, speed = 1, offset = 0, me = null, match = null, live = false, view = null;
let armyBtnSwipe = 0, lastMapTap = { id: 0, t: 0 }, sendGroup = [], lastArmyTap = { id: 0, t: 0 }, sendHero = '', heroSel = '', sendFromOp = '', sendFrom = 0, mode = 'city', wm = null, mapReady = false, msel = null, send = {}, planCache = {};
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
  if (typeof $ === 'function' && !$('game').hidden) afterAccept();
}
function afterAccept() {
  soundTick();
  try { renderChat(); checkFeed(); renderBanner(); renderNav(); renderPanel(false); if (match.result) showEnd(); } catch (e) { console.error(e); }
}
const serverNow = () => Date.now() + offset;

/* ---------- Töne und Musik ---------- */
document.addEventListener('pointerdown', () => snd.unlock(), true);
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('[data-snd]');
  if (el) { const k = el.dataset.snd, on = k === 'sfx' ? !snd.cfg.sfx : !snd.cfg.music; if (k === 'sfx') snd.setSfx(on); else snd.setMusic(on); el.textContent = (k === 'sfx' ? '🔊 Töne: ' : '🎵 Musik: ') + (on ? 'an' : 'aus'); el.classList.toggle('ghost', !on); return; }
}, true);
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button,.chip,[data-act],[data-goto],.ptab,summary,a.btn,label.tgl,[data-nav],[data-sub]')) snd.click(); }, true);
document.addEventListener('scroll', e => { if (e.target && e.target.id === 'hdock') dockX = e.target.scrollLeft; }, true);
document.addEventListener('input', e => { const k = e.target && e.target.dataset && e.target.dataset.sndv; if (k) snd.setVol(k, Number(e.target.value)); });
setInterval(() => { snd.heroMenu(panelName === 'heroes'); }, 300);
let dailyWas = null;   // null = noch nicht gesehen: beim Laden kein Ton
function soundTick() {
  try {
    const ids = new Set((view.sieges || []).filter(x => x.mine).map(x => x.id));
    snd.mood(ids.size ? 'battle' : 'calm');
    { const dd = !!(S.daily && dailyDone(S)); if (dd && dailyWas === false) snd.clip('quests'); dailyWas = dd; }
  } catch (e) { console.error(e); }
}

/* ---------- Chat auf der Karte: Global oder Bündnis ---------- */
let chatOpen = false, chatTab = 'global', chatSeen = { global: 0, ally: 0 };
const chatList = t => t === 'ally' ? ((view && view.ally && view.ally.chat) || []) : ((view && view.gchat) || []);
function chatUnread() { return ['global', 'ally'].reduce((n, t) => n + chatList(t).filter(m => m.id > chatSeen[t] && m.pid !== (me && me.id)).length, 0); }
function renderChat() {
  const btn = $('chatBtn'), pop = $('chatPop'); if (!btn || !pop || !view) return;
  const alOk = !!(view.ally);
  if (chatTab === 'ally' && !alOk) chatTab = 'global';
  const list = chatList(chatTab);
  if (chatOpen) { const l = list.length ? list[list.length - 1].id : 0; if (l > chatSeen[chatTab]) chatSeen[chatTab] = l; }
  const un = chatOpen ? 0 : chatUnread(), bd = $('chatBadge'); if (bd) { bd.textContent = un; bd.hidden = !un; }
  pop.hidden = !chatOpen; if (!chatOpen) return;
  const msgs = list.map(c => `<div class="msg ${c.pid === me.id || c.name === me.name ? 'mine' : ''}"><b>${c.tag ? '[' + esc(c.tag) + '] ' : ''}${esc(c.name)}</b><small>${ago(c.t)}</small><br>${esc(c.text)}</div>`).join('') || '<p class="note">Noch keine Nachrichten. Schreib die erste!</p>';
  let box = $('chatMsgs');
  if (!box || pop.dataset.tab !== chatTab) {
    pop.dataset.tab = chatTab;
    const keep = $('chatIn') ? $('chatIn').value : '';
    pop.innerHTML = `<div class="ctabs"><button type="button" data-ct="global" class="${chatTab === 'global' ? 'on' : ''}">Global</button><button type="button" data-ct="ally" class="${chatTab === 'ally' ? 'on' : ''}" ${alOk ? '' : 'disabled'}>Bündnis</button><button type="button" class="x" data-ct="close" aria-label="Schließen">✕</button></div><div class="msgs" id="chatMsgs"></div><div class="chatform"><input id="chatIn" maxlength="${chatTab === 'ally' ? 300 : 200}" placeholder="${chatTab === 'ally' ? 'Nachricht an das Bündnis' : 'Nachricht an alle'}" autocomplete="off"><button class="btn small" type="button" data-ct="send">Senden</button></div>`;
    $('chatIn').value = keep; box = $('chatMsgs'); box.innerHTML = msgs; box.scrollTop = box.scrollHeight; return;
  }
  if (box.dataset.sig !== msgs) { const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 8; box.innerHTML = msgs; box.dataset.sig = msgs; if (atEnd) box.scrollTop = box.scrollHeight; }
}
function setupChat() {
  $('chatBtn').addEventListener('click', () => { chatOpen = !chatOpen; renderChat(); if (chatOpen) { const b = $('chatMsgs'); if (b) b.scrollTop = b.scrollHeight; } });
  const send = async () => { const i = $('chatIn'), t = i.value.trim(); if (!t) return; const ok = await command({ type: chatTab === 'ally' ? 'allyChat' : 'globalChat', text: t }); if (ok) { i.value = ''; renderChat(); const b = $('chatMsgs'); if (b) b.scrollTop = b.scrollHeight; } };
  $('chatPop').addEventListener('click', e => { const b = e.target.closest('[data-ct]'); if (!b) return; const k = b.dataset.ct; if (k === 'close') { chatOpen = false; return renderChat(); } if (k === 'send') return void send(); chatTab = k; renderChat(); });
  $('chatPop').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'chatIn') { e.preventDefault(); send(); } });
}

/* ---------- Anmeldung und Beitritt ---------- */
const params = new URLSearchParams(location.search);
const invite = params.get('einladung') || '';
const $auth = document.getElementById('auth'), $form = document.getElementById('authForm'), $err = document.getElementById('authErr');
let joinInfo = null, joinMode = false;
function setAuthMode(join) {
  joinMode = join && !!joinInfo;
  const lead = document.getElementById('authLead'), btn = document.getElementById('authBtn'), note = document.getElementById('authNote'), pw = document.getElementById('fPass');
  $err.textContent = '';
  if (joinMode) {
    lead.textContent = `Du bist eingeladen zur Partie „${joinInfo.match}“ (${joinInfo.players} von ${joinInfo.max} Plätzen belegt). Wähle einen Namen und ein Passwort.`;
    btn.textContent = 'Registrieren und beitreten'; pw.autocomplete = 'new-password';
    note.innerHTML = 'Schon dabei? <button type="button" class="linkish" id="authSwitch">Stattdessen anmelden</button>';
  } else {
    lead.textContent = 'Melde dich an, um deine Stadt zu regieren.';
    btn.textContent = 'Anmelden'; pw.autocomplete = 'current-password';
    note.innerHTML = joinInfo ? 'Neu hier? <button type="button" class="linkish" id="authSwitch">Registrieren und beitreten</button>' : 'Neu hier? Du brauchst einen Einladungslink vom Admin deiner Partie.';
  }
  const sw = document.getElementById('authSwitch'); if (sw) sw.onclick = () => setAuthMode(!joinMode);
}
async function boot() {
  const r = await api('/api/me');
  if (r.ok) { accept(r.data); return startGame(); }
  $auth.hidden = false;
  if (invite) {
    const inv = await api('/api/invite?code=' + encodeURIComponent(invite));
    if (inv.ok) { joinInfo = inv.data; setAuthMode(true); }
    else $err.textContent = inv.data.error || 'Einladung ungültig.';
  }
  document.getElementById('fName').focus();
}
$form.addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('fName').value.trim(), password = document.getElementById('fPass').value;
  $err.textContent = '';
  const r = joinMode ? await api('/api/join', { invite, name, password }) : await api('/api/login', { name, password });
  if (!r.ok) { $err.textContent = r.data.error || 'Das hat nicht geklappt.'; return; }
  if (joinMode) history.replaceState(null, '', '/');
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
const costHTML = (c, have = S.res) => c.map((v, i) => v ? `<span class="cost ${have[RES[i]] >= v ? '' : 'short'}"><i class="r r-${RES[i]}"></i>${RES_DE[RES[i]]} ${fmtN(v)}</span>` : '').join('');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer;
function toast(msg, kind) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'alert'); document.body.appendChild(el); }
  el.className = 'toast ' + (kind || ''); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

let sel = null, mapLoop = 0;
const pick = {};

/* ---------- Kamera der Karte ---------- */
// Beim Antippen bleibt die Karte stehen; nur wenn das Ziel unter dem Popup oder am Rand läge, gleitet sie sanft hoch
function revealMap(tx, ty) {
  const p = wm.screenOf(tx, wm.baseY(tx, ty, 1) + 1, ty), W = window.innerWidth, H = window.innerHeight;
  if (p.y > H * .5 || p.y < H * .16 || p.x < 36 || p.x > W - 36) wm.panTo(tx, ty, .3);
}
function focusMap(tx, ty, dist) { wm.focus(tx, ty, dist, document.body.classList.contains('sheet-open') ? .26 : .46); }
function setupInput() {
  const view = wm.dom, ptrs = new Map(); let moved = false, downAt = null, pinch = null, lpT = 0, lpDone = false, dragArmy = 0, dragGrp = null;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y), ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  view.style.touchAction = 'none';
  view.addEventListener('pointerdown', e => {
    view.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      moved = false; lpDone = false; downAt = { x: e.clientX, y: e.clientY }; dragArmy = 0;
      const h0 = mapReady && !placing && !sendGroup.length ? wm.pickAt(e.clientX, e.clientY) : null, m0 = h0 && h0.type === 'march' ? ownMarches().find(x => x.id === h0.id) : null;
      if (m0 && redirectable(m0)) { dragArmy = m0.id; dragGrp = lastMapTap.id === m0.id && Date.now() - lastMapTap.t < 450 ? nearIds(m0) : null; if (dragGrp && dragGrp.length < 2) dragGrp = null; } else wm.dragStart(e.clientX, e.clientY);
      clearTimeout(lpT); miniClose();
    }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: dist(a, b), a: ang(a, b) }; moved = true; }
  });
  view.addEventListener('pointermove', e => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY }; ptrs.set(e.pointerId, cur);
    if (ptrs.size === 1) { if (dist(cur, downAt) > (dragArmy ? 14 : 8)) { moved = true; clearTimeout(lpT); } if (moved) { if (dragArmy) { armyDragLine(downAt, cur); armyDragHover(cur.x, cur.y, dragArmy); } else wm.dragMove(cur.x, cur.y); } }
    else if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d = dist(a, b), an = ang(a, b);
      let da = an - pinch.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      wm.zoomAt(mid.x, mid.y, d / pinch.d); pinch = { d, a: an };
    }
  });
  const end = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId); clearTimeout(lpT);
    if (dragArmy && ptrs.size === 0) { const id = dragArmy; dragArmy = 0; armyDragLine(null); if (!msel) wm.select(null); hoverKey = ''; if (moved && e.type === 'pointerup') { if (dragGrp) { const ids = dragGrp; dragGrp = null; lastMapTap = { id: 0, t: 0 }; groupSend(wm.pickAt(e.clientX, e.clientY), e.clientX, e.clientY, ids); } else armyDragSend(id, e.clientX, e.clientY); return; } dragGrp = null; }
    if (ptrs.size === 0 && !moved && !lpDone && e.type === 'pointerup') tap(e.clientX, e.clientY);
    if (ptrs.size === 1) { const [r] = [...ptrs.values()]; wm.dragStart(r.x, r.y); downAt = { x: r.x, y: r.y }; }
    if (ptrs.size < 2) pinch = null;
  };
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
  view.addEventListener('wheel', e => { e.preventDefault(); wm.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : .89); }, { passive: false });
}
function tap(sx, sy) { mapTap(sx, sy); }
// Heer mit dem Finger ziehen: auf der Karte antippen, halten und zum Ziel wischen – beim Loslassen zieht es dorthin
function armyDragLine(a, b) {
  let el = $('dragLine');
  if (!a) { if (el) el.hidden = true; return; }
  if (!el) { el = document.createElement('div'); el.id = 'dragLine'; document.body.appendChild(el); }
  const dx = b.x - a.x, dy = b.y - a.y; el.hidden = false;
  el.style.left = a.x + 'px'; el.style.top = a.y + 'px'; el.style.width = Math.hypot(dx, dy) + 'px'; el.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
}
// Nach einem Befehl an ein Heer: alle Menüs und Pop-ups schließen
function dismissAll() { closeSheet(); miniClose(); if (scoutEl) scoutEl.hidden = true; if (panelName) closePanel(); wm.select(null); wm.setPreview(null); hoverKey = ''; }
// Beim Wischen: Kreis um das Ziel unter dem Finger (Gebäude, Feld, Räuber)
let hoverKey = '';
function armyDragHover(sx, sy, id) {
  const h = wm.pickAt(sx, sy), ok = h && (h.type === 'obj' || h.type === 'op' || h.type === 'raider'), key = ok ? h.type + h.id : '';
  if (key === hoverKey) return; hoverKey = key; wm.select(ok ? h : null);
}
async function armyDragSend(id, sx, sy) {
  const hit = wm.pickAt(sx, sy); if (hit && hit.type === 'march' && hit.id === id) return;
  const cmd = orderCmd(hit, sx, sy, true);
  if (!cmd) { if (hit && hit.type !== 'march') { miniClose(); sendFromOp = ''; sendFrom = id; syncMoveBar(); selectMap(hit, false); } return; }   // Gebäude: Menü mit dem gewählten Heer öffnen
  sendFrom = id; const ok = await command(cmdFor(cmd, id)); sendFrom = 0; syncMoveBar(); renderArmyBtns();
  if (ok) { dismissAll(); toast('Das Heer zieht dorthin.', 'info'); }
}
const cmdFor = (cmd, id) => cmd.type === 'recall' ? { type: 'recall', id } : { ...cmd };
// Befehl für ein Ziel auf der Karte: Gelände, Rohstofffeld oder Räuber
function orderCmd(hit, sx, sy, quiet) {
  const o = hit && hit.type === 'obj' ? wm.map.byId[hit.id] : null;
  if (!hit) { const t = wm.tileAtScreen(sx, sy); return t ? { type: 'march', mode: 'post', x: t.x, y: t.y, troops: {} } : null; }
  if (hit.type === 'raider' || (o && ['farm', 'wood', 'stone'].includes(o.k))) return { type: 'march', target: hit.id, troops: {} };
  if (o && o.k === 'start') { const pl = view.match.players.find(x => x.slot === o.slot); if (!pl) return null; return pl.id === me.id ? { type: 'recall' } : { type: 'march', target: hit.id, mode: isAlly(pl.id) ? 'station' : 'attack', troops: {} }; }   // eigene Burg: heimkehren, Verbündete: verstärken, Feind: angreifen
  if (o && (o.k === 'sanct' || o.k === 'throne')) return { type: 'march', target: hit.id, mode: 'occupy', troops: {} };
  if (!quiet) toast('Für mehrere Heere zugleich: Gelände, Rohstofffelder oder Räuber antippen.'); return null;
}

/* ---------- Oberfläche ---------- */
const $ = id => document.getElementById(id);
// Mengenwahl: Regler plus Zahlenfeld (und − / +). kind: 'pick' (Ausbildung) oder 'send' (Heer), mdn/pl = Aktionen der Knöpfe
const maxTrain = u => Math.max(1, Math.min(MAX_TRAIN_COUNT, ...U[u].cost.map((c, i) => c > 0 ? Math.floor(S.res[RES[i]] / c) : MAX_TRAIN_COUNT)));
function qtyHTML(kind, u, val, min, max, mdn, pl) {
  max = Math.max(min, max); val = Math.max(min, Math.min(max, val));
  return `<div class="qty"><div class="stepper"><button type="button" data-act="${mdn}" data-u="${u}" aria-label="Weniger">−</button><input class="qn" type="number" inputmode="numeric" min="${min}" max="${max}" value="${val}" data-q="${kind}" data-u="${u}" aria-label="Anzahl"><button type="button" data-act="${pl}" data-u="${u}" aria-label="Mehr">+</button><button type="button" class="qmax" data-act="max" data-u="${u}" aria-label="Maximum">Max</button></div><input class="qr" type="range" min="${min}" max="${max}" value="${val}" data-q="${kind}" data-u="${u}" aria-label="Regler"></div>`;
}
let sheetSig = '', busy = false;
const fmtK = n => { n = Math.floor(n); const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: a >= 1e7 ? 0 : 1 }) + ' Mio';
  if (a >= 1e5) return Math.round(n / 1e3).toLocaleString('de-DE') + 'k';
  return fmtN(n); };
document.addEventListener('input', e => {            // beim Ziehen des Reglers nur die Zahl nachführen
  const t = e.target; if (!t.dataset || !t.dataset.q || t.type !== 'range') return;
  const n = t.parentNode.querySelector('.qn'); if (n) n.value = t.value;
});
document.addEventListener('change', e => {           // beim Loslassen / Bestätigen übernehmen
  const t = e.target; if (!t.dataset || !t.dataset.q) return;
  const u = t.dataset.u, lo = Number(t.min), hi = Number(t.max), v = Math.max(lo, Math.min(hi, Math.floor(Number(t.value) || 0)));
  if (t.dataset.q === 'send') { send[u] = v; renderSheet(); }
  else { pick[u] = v; if (t.closest('#sidePanelInner')) renderPanel(true); else renderSheet(); }
});
function renderTop() {
  const c = cap(S);
  $('res').innerHTML = [...RES, 'gold'].map(r => {
    const v = S.res[r], rt = rate(S, r), bn = (S.bonus && S.bonus[r]) || 0, pct = r === 'gold' ? 0 : Math.min(100, v / c * 100);
    return `<div class="res-cell" title="${RES_DE[r]}: ${fmtN(v)}"><span class="rico rc-${r}">${icon({ food: 'food', wood: 'wood', stone: 'stone', ore: 'ore', gold: 'coin' }[r])}</span><div class="rtx"><div class="res-name">${RES_DE[r]}</div><div class="res-top">${fmtK(v)}</div>
      <div class="res-rate ${rt < 0 ? 'neg' : ''}">${rt >= 0 ? '+' : ''}${fmtK(rt)}/h</div>
      ${bn ? `<div class="res-bonus" title="Bonus durch ein gehaltenes ${r === 'gold' ? 'Thron- oder Heiligtum' : 'Heiligtum'}">✦ +${Math.round(bn * 100)} % Bonus</div>` : ''}
      </div><div class="res-bar">${r === 'gold' ? '' : `<i class="${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></i>`}</div></div>`;
  }).join('');
  $('speed').className = 'speed' + (live ? '' : ' off');
  $('speed').innerHTML = live ? `Tempo <b>×${speed}</b>` : 'Verbindung weg';
}
function renderHud() {
  const parts = S.queue.map(q => `<div class="chip">${B[q.id].name} → ${q.target}<span class="mini"><i style="width:${Math.max(0, 1 - q.left / q.total) * 100}%"></i></span>${fmtT(real(q.left))}</div>`);
  if (!S.queue.length) parts.push(`<div class="chip hint">Bauschleife frei (${maxQueues(S)})</div>`);
  if (S.scout) parts.push(`<div class="chip">🧭 Erkunder · Feld ${fieldName(S.scout.f)} · ${gtNow() < S.scout.t0 + S.scout.go ? 'unterwegs' : 'erkundet'} ${fmtT(real(Math.max(0, S.scout.end - gtNow())))}</div>`);
  const tq = queuedTroops(S);
  parts.push(`<div class="chip">Truppen ${fmtN(troopCount(S))}${tq ? ' · ' + fmtN(tq) + ' in Ausbildung' : ''}</div>`);
  for (const m of ownMarches()) { const st = marchState(m); parts.push(`<button class="chip go" type="button" data-march="${m.id}">${marchLine(m)}${st.moving ? `<span class="mini"><i style="width:${Math.round(st.pct * 100)}%"></i></span>` : ''}</button>`); }
  if (ownMarches().filter(m => m.phase !== 'back').length >= 2) parts.push('<button class="chip go" type="button" data-recallall="1">⌂ Alle heimrufen</button>');
  $('hud').innerHTML = parts.join('');
  renderPts(); renderHelpPop(); renderArmyBtns(); if (view && S) placeStep();
}
// Runde Heer-Knöpfe rechts auf der Karte: das Symbol zeigt den Anführer; antippen wählt das Heer, der nächste Tipp auf die Karte schickt es dorthin
function renderArmyBtns() {
  let el = $('armyBtns');
  if (!el) {
    el = document.createElement('div'); el.id = 'armyBtns'; el.className = 'armybtns'; document.body.appendChild(el);
    let ad = null;   // Wischen vom Heldensymbol zum Ziel (nach Doppeltipp: alle Heere)
    el.addEventListener('pointerdown', e => { const b = e.target.closest('[data-army]'); if (!b) return; const id = Number(b.dataset.army), r = b.getBoundingClientRect(); ad = { id, x: e.clientX, y: e.clientY, ox: r.left + r.width / 2, oy: r.top + r.height / 2, moved: false, dbl: lastArmyTap.id === id && Date.now() - lastArmyTap.t < 500 }; });
    el.addEventListener('pointermove', e => { if (!ad) return; if (!ad.moved && Math.hypot(e.clientX - ad.x, e.clientY - ad.y) > 14) { ad.moved = true; try { el.setPointerCapture(e.pointerId); } catch {} } if (ad.moved) { armyDragLine({ x: ad.ox, y: ad.oy }, { x: e.clientX, y: e.clientY }); armyDragHover(e.clientX, e.clientY, ad.id); } });
    const adEnd = e => { if (!ad) return; const a = ad; ad = null; if (!a.moved) return; armyDragLine(null); hoverKey = ''; if (!msel) wm.select(null); armyBtnSwipe = Date.now();
      if (e.type !== 'pointerup') return; const hit = wm.pickAt(e.clientX, e.clientY);
      const grp = sendGroup.length > 1 ? sendGroup.slice() : a.dbl ? ownMarches().filter(redirectable).map(x => x.id) : null;
      if (grp && grp.length > 1) { lastArmyTap = { id: 0, t: 0 }; groupSend(hit, e.clientX, e.clientY, grp); } else armyDragSend(a.id, e.clientX, e.clientY); };
    el.addEventListener('pointerup', adEnd); el.addEventListener('pointercancel', adEnd);
    el.addEventListener('click', e => {
      if (Date.now() - armyBtnSwipe < 400) return;
      const b = e.target.closest('[data-army]'); if (!b) return; const id = Number(b.dataset.army), m = ownMarches().find(x => x.id === id); if (!m) return;
      const nowT = Date.now(), dbl = lastArmyTap.id === id && nowT - lastArmyTap.t < 500; lastArmyTap = { id, t: nowT };
      if (dbl && ownMarches().length >= 2) {   // Doppelklick auf ein Helden-Symbol: alle Heere wählen
        lastArmyTap = { id: 0, t: 0 }; sendFromOp = ''; sendFrom = 0; closeSheet();
        sendGroup = ownMarches().filter(x => ['post', 'gather', 'back', 'fight'].includes(x.phase) || (x.phase === 'out' && x.mode !== 'build')).map(x => x.id);
        if (sendGroup.length < 2) { sendGroup = []; return toast('Gerade können keine zwei Heere umgeleitet werden.'); }
        syncMoveBar(); return renderArmyBtns();
      }
      if (sendGroup.length) { sendGroup = []; syncMoveBar(); }
      if (sendFrom === id) { sendFrom = 0; closeSheet(); syncMoveBar(); return renderArmyBtns(); }
      if (!(['post', 'gather', 'back', 'fight'].includes(m.phase) || (m.phase === 'out' && m.mode !== 'build'))) return toast('Dieses Heer kann gerade nicht umgeleitet werden.');
      sendFromOp = ''; closeSheet(); sendFrom = id; syncMoveBar(); renderArmyBtns();
    });
  }
  const show = mode === 'map' && !!S && !!view && !msel; el.hidden = !show; if (!show && !sendFrom) { /* bleibt versteckt */ }
  const ST = { out: '🚶', back: '↩', gather: '⛏', fight: '⚔', post: '⚑' };
  const html = ownMarches().slice(0, 5).map(m => { const H = HEROES[m.hero]; return `<button type="button" class="armybtn${sendFrom === m.id || sendGroup.includes(m.id) ? ' on' : ''}" data-army="${m.id}" style="--hc:${H ? H.col : '#7a7a7a'}" aria-label="${H ? esc(H.name) : 'Heer'}"><span class="aname">${H ? esc(H.name) : 'Heer'}</span><span class="apic">${H ? hpic(m.hero, H) : '🛡️'}</span><i>${ST[m.phase] || ''}</i></button>`; }).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
}
function renderPts() {
  let el = $('ptsChip'); if (!el) { el = document.createElement('div'); el.id = 'ptsChip'; el.className = 'ptschip'; document.body.appendChild(el); }
  const tb = document.querySelector('.topbar');
  el.hidden = mode !== 'map' || !S; { const m0 = $('mutChip'); if (m0) m0.hidden = el.hidden; } if (el.hidden) return;
  { const bn = $('banner'); el.style.top = ((bn && bn.classList.contains('onlymini') && bn.offsetHeight ? bn.getBoundingClientRect().top : (tb ? tb.offsetHeight : 60) + 6)) + 'px'; }   // Punkte links, Neulingsschutz rechts auf einer Zeile
  const t = `🏅 <b>${fmtN(scoreOf(S))}</b> Punkte`; if (el.innerHTML !== t) el.innerHTML = t;
  let mu = $('mutChip'); if (!mu) { mu = document.createElement('div'); mu.id = 'mutChip'; mu.className = 'ptschip'; document.body.appendChild(mu); }
  mu.hidden = false; mu.style.top = (parseFloat(el.style.top) + el.offsetHeight + 6) + 'px';
  const mb = mu.offsetTop + mu.offsetHeight + 8; let nx = mb;   // Knöpfe links untereinander direkt unter den Chips, Heere rechts oben
  for (const id of ['placeBtn', 'tpBtn']) { const b = $(id); if (!b || b.hidden || getComputedStyle(b).display === 'none') continue; b.style.top = nx + 'px'; b.style.bottom = 'auto'; nx += b.offsetHeight + 8; }
  const ab = $('armyBtns'); if (ab) ab.style.top = ((tb ? tb.offsetHeight : 60) + 8) + 'px';
  const t2 = `💪 <b>${Math.floor(S.mut == null ? MUT_MAX : S.mut)}</b>`; if (mu.innerHTML !== t2) { mu.innerHTML = t2; mu.title = 'Mut (max. ' + MUT_MAX + ')'; mu.classList.add('small'); }
}
// Bündnishilfe: kleine Popups mit Hilfe-Symbol
function renderHelpPop() {
  let el = $('helpPop'); if (!el) { el = document.createElement('div'); el.id = 'helpPop'; el.className = 'helppop'; document.body.appendChild(el);
    el.addEventListener('click', async e => { const b = e.target.closest('[data-help]'); if (!b) return; b.disabled = true; const ok = await command({ type: 'giveHelp', rid: Number(b.dataset.help) }); if (ok) toast('Du hast geholfen: +15 % Baufortschritt.', 'info'); }); }
  const list = ((view && view.help) || []).filter(h => !h.mine);
  const t = list.slice(0, 3).map(h => `<button type="button" class="hp" data-help="${h.id}"><span class="hpi">🤝</span><span><b>${esc(h.name)}</b><small>${esc((B[h.bid] || {}).name || '')} · Hilfe geben</small></span></button>`).join('');
  if (el.innerHTML !== t) el.innerHTML = t;
  el.hidden = !t || !S;
}
function statsHTML(id) {
  const L = S.lv[id], b = B[id], n = L + 1, rows = [];
  const nx = (a, bb) => a + (L < 30 ? ` <span class="up">→ ${bb}</span>` : '');
  if (b.prod) rows.push(['Produktion', nx(fmtN(prodAt(id, L)) + '/h', fmtN(prodAt(id, n)) + '/h')]);
  if (id === 'rathaus') rows.push(['Gebäude bis Stufe', nx(L, n)], ['Bauschleifen', maxQueues(S) + (S.lv.rathaus < 5 ? ' <span class="up">· 2 ab Rathaus Stufe 5</span>' : '')], ['Steuergold', fmtN(rate(S, 'gold')) + '/h']);
  if (id === 'akademie' && L) rows.push(['Forschungsschleifen', (L >= 15 ? 2 : 1) + (L < 15 ? ' <span class="up">· 2 ab Akademie Stufe 15</span>' : '')]);
  if (id === 'lager') rows.push(['Lagerplatz', nx(fmtN(cap(S)), fmtN(capFor(n)))], ['Plünderschutz', protectedPct(S) + ' %']);
  if (id === 'mauer') rows.push(['Haltbarkeit', nx(fmtN(1000 * L), fmtN(1000 * n))], ['Verteidigung', nx('+' + 5 * L + ' %', '+' + 5 * n + ' %')]);
  if (id === 'lazarett') rows.push(['Plätze', nx(fmtN(200 * L), fmtN(200 * n))]);
  if (b.units && L) rows.push(['Ausbildungszeit', '−' + Math.round((1 - Math.pow(.95, L - 1)) * 100) + ' %']);
  return rows.length ? `<dl class="stats">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : '';
}
function helpRowHTML(id) {
  const al = view.ally; if (!al || (al.members || []).length < 2) return '';
  const h = (view.help || []).find(x => x.mine && x.bid === id);
  return `<div class="row">${h ? `<span class="note">🤝 Hilfe erbeten · ${h.n} ${h.n === 1 ? 'Mitglied hat' : 'Mitglieder haben'} geholfen (je +15 %)</span>` : '<button class="btn ghost" data-act="askHelp" type="button">🤝 Hilfe erbitten</button>'}</div>`;
}
function upgradeHTML(id) {
  const L = S.lv[id], t = L + 1, q = inQueue(S, id);
  if (q) return `<div class="block"><h3>${L ? 'Ausbau auf Stufe ' + q.target : 'Wird gebaut'}</h3>
    <div class="row"><div class="prog"><i id="upProg" style="width:${Math.max(0, 1 - q.left / q.total) * 100}%"></i></div><span class="time" id="upTime">${fmtT(real(q.left))}</span></div>
    <div class="row"><button class="btn" data-speed="build:${id}" type="button">⚡ Beschleunigen</button><button class="btn ghost" data-act="cancel" type="button">Abbrechen (volle Erstattung)</button></div>${helpRowHTML(id)}</div>`;
  if (id === 'rathaus' && L >= 30) return '<div class="block"><h3>Ausbau</h3><p class="note">Höchststufe erreicht.</p></div>';
  const c = costOf(id, t), why = blocker(S, id), tm = buildTime(S, id, t);
  return `<div class="block"><h3>${L ? 'Ausbau auf Stufe ' + t : 'Bauen'}</h3>
    <div class="costs">${costHTML(c)}</div>
    <div class="time">Bauzeit ${fmtT(real(tm))}${speed > 1 ? ' · ohne Testtempo ' + fmtT(tm) : ''}</div>
    <div class="row"><button class="btn" data-act="upgrade" type="button" ${why ? 'disabled' : ''}>${L ? 'Ausbauen' : 'Bauen'}</button><button class="btn ghost" data-act="upgradeSp" type="button" ${why ? 'disabled' : ''}>⚡ + Speedups</button>${why ? `<span class="why">${why}</span>` : ''}</div></div>`;
}
function unitsHTML(id) {
  const b = B[id], L = S.lv[id];
  if (!b.units || !L) return '';
  const rows = b.units.map(u => {
    const d = U[u], ok = L >= d.req, n = pick[u] || 10, total = d.cost.map(c => c * n);
    return `<div class="unit">
      <div><div class="unit-name">${d.name}</div><div class="unit-stats ustats">${unitStatsHTML(u)}<span>⏱ ${fmtT(real(unitTime(S, u, id)))} je Einheit</span></div></div>
      ${ok ? `${qtyHTML('pick', u, n, 1, MAX_TRAIN_COUNT, 'minus', 'plus')}` : `<span class="note">ab ${b.name} Stufe ${d.req}</span>`}
      ${ok ? `<div class="row" style="grid-column:1"><span class="costs">${costHTML(total)}</span><button class="btn" type="button" data-act="train" data-u="${u}" ${afford(S, total) && (S.train[id] || []).length < MAX_TRAIN_ORDERS ? '' : 'disabled'}>Ausbilden</button></div>` : ''}
    </div>`;
  }).join('');
  const list = (S.train[id] || []).map((o, i) => `<div class="train-row"><span>${o.count}× ${U[o.unit].name}</span>${i === 0
    ? `<div class="prog"><i id="trProg" style="width:${(1 - o.left / o.per) * 100}%"></i></div><span class="time" id="trTime">${fmtT(real(o.left + (o.count - 1) * o.per))}</span><button class="spd" type="button" data-speed="train:${id}" aria-label="Beschleunigen">⚡</button>`
    : '<span class="time">wartet</span>'}</div>`).join('');
  return `<div class="block"><h3>Ausbildung</h3>${rows}${list ? `<div class="block" style="padding:10px">${list}</div>` : ''}</div>`;
}
function researchHTML() {
  const r = S.research;
  return `<div class="block"><h3>Forschung</h3>${r ? `<div class="row"><b>${T[r.id].name}</b> → Stufe ${r.target}<div class="prog"><i id="rsProg" style="width:${Math.max(0, 1 - r.left / r.total) * 100}%"></i></div><span class="time">${fmtT(real(r.left))}</span></div><div class="row"><button class="btn" type="button" data-speed="research:1">⚡ Beschleunigen</button><button class="btn ghost" type="button" data-act="cancelResearch">Abbrechen (volle Erstattung)</button></div>` : '<p class="note">Im Moment wird nichts erforscht.</p>'}
    <div class="row"><button class="btn" type="button" data-act="toTech" ${S.lv.akademie ? '' : 'disabled'}>Zur Akademie</button></div></div>`;
}
function troopsHTML() {
  const t = Object.keys(U).filter(u => S.troops[u]);
  return `<div class="block"><h3>Deine Truppen</h3>${t.length ? `<div class="troops">${t.map(u => `<span><b>${fmtN(S.troops[u])}</b> ${U[u].name}</span>`).join('')}</div>` : '<p class="note">Noch keine Truppen. Baue die Kaserne (ab Rathaus 2).</p>'}</div>`;
}
function signature() {
  if (msel) return mapSignature();
  if (!sel) return '';
  return JSON.stringify([sel, S.lv, !!inQueue(S, sel), blocker(S, sel), S.queue.length, (S.train[sel] || []).map(o => o.count + o.unit), S.troops, pick, speed, RES.map(r => Math.floor(S.res[r] / 5)), busy, S.research && S.research.id + S.research.target, S.silver, Math.floor(S.res.gold / 1000)]);
}
// Der gewählte Anführer soll in der Heldenreihe sichtbar sein (auch bei automatischer Wahl)
function showSelHero() {
  const on = document.querySelector('.hpick .hchip.on'), row = on && on.parentElement; if (!row) return;
  const l = on.offsetLeft - row.offsetLeft, r = l + on.offsetWidth;
  if (l < row.scrollLeft || r > row.scrollLeft + row.clientWidth) row.scrollLeft = l - (row.clientWidth - on.offsetWidth) / 2;
}
{ const si = document.getElementById('sheetInner'); if (si) new MutationObserver(showSelHero).observe(si, { childList: true, subtree: true }); }
// Rathaus: Rohstoffe gegen Silber tauschen (1000 Rohstoffe = 1 Silber). Silber braucht man zum Spähen.
const exchAmt = {};
function exchangeHTML() {
  const rows = [['food', 'Nahrung'], ['wood', 'Holz'], ['stone', 'Stein'], ['gold', 'Gold']].map(([r, n]) => {
    const k = Math.floor(S.res[r] / 1000), v = Math.min(k, exchAmt[r] || 0);
    return `<div class="urow exrow"><div class="un"><b>${n}</b><small>${fmtN(S.res[r])} da · <span data-exl="${r}">${v} Silber für ${fmtN(v * 1000)}</span></small>
      </div><div class="exline"><input type="range" class="exr" data-exr="${r}" min="0" max="${k}" step="1" value="${v}" ${k > 0 ? '' : 'disabled'} aria-label="Silber aus ${n}">
      <button class="btn small exok" type="button" data-act="exch" data-r="${r}" ${v > 0 ? '' : 'disabled'}>OK</button></div></div>`; }).join('');
  return `<div class="block exch"><h3>Silber <span class="silv">🥈 ${fmtN(S.silver || 0)}</span></h3><p class="note">1000 Rohstoffe, egal welche, werden zu 1 Silber. Mit Silber schickst du Späher los. Regler einstellen, dann tauschen.</p>${rows}</div>`;
}
document.addEventListener('input', e => {
  const r = e.target && e.target.dataset && e.target.dataset.exr; if (!r) return;
  const v = Number(e.target.value); exchAmt[r] = v;
  const l = document.querySelector(`[data-exl="${r}"]`); if (l) l.textContent = `${v} Silber für ${fmtN(v * 1000)}`;
  const bt = document.querySelector(`[data-act="exch"][data-r="${r}"]`); if (bt) bt.disabled = v < 1;
});
function renderSheet() {
  $('sheet').classList.add('parch'); $('sheet').classList.toggle('popup', !!msel);
  if (msel) return renderMapSheet();
  if (!sel) return;
  const id = sel, b = B[id], L = S.lv[id];
  $('sheetInner').innerHTML = `<div class="sh-head"><h2>${b.name}</h2><span class="lvl">${L ? 'Stufe ' + L : 'nicht gebaut'}</span><button class="close" type="button" data-act="close">Schließen</button></div>
    <p class="desc">${b.desc}</p>${statsHTML(id)}${upgradeHTML(id)}${unitsHTML(id)}${b.units && L ? troopsHTML() : ''}${id === 'lazarett' && L ? healHTML() : ''}${id === 'rathaus' && L ? exchangeHTML() : ''}${id === 'akademie' ? researchHTML() : ''}`;
  sheetSig = signature();
}
function updateSheet() {
  if (msel) return updateMapSheet();
  if (!sel) return;
  if (signature() !== sheetSig) return renderSheet();
  const q = inQueue(S, sel);
  if (q) { const p = $('upProg'), t = $('upTime'); if (p) p.style.width = Math.max(0, 1 - q.left / q.total) * 100 + '%'; if (t) t.textContent = fmtT(real(q.left)); }
  if (S.research) { const p = $('rsProg'); if (p) p.style.width = Math.max(0, 1 - S.research.left / S.research.total) * 100 + '%'; }
  const o = (S.train[sel] || [])[0];
  if (o) { const p = $('trProg'), t = $('trTime'); if (p) p.style.width = (1 - o.left / o.per) * 100 + '%'; if (t) t.textContent = fmtT(real(o.left + (o.count - 1) * o.per)); }
}
function openSheet(id) { msel = null; sel = id; document.body.classList.add('sheet-open'); renderSheet(); }
// Hinweisleiste, solange ein Heer ein neues Ziel bekommt (wie in Rise of Kingdoms: Ziel antippen, das Heer zieht sofort los)
function syncMoveBar() {
  let el = $('moveBar');
  if (!sendFrom && !sendFromOp && !sendGroup.length) { if (el) el.hidden = true; return; }
  if (!el) { el = document.createElement('div'); el.id = 'moveBar'; el.className = 'movebar'; el.innerHTML = '<span></span><button class="btn ghost small" type="button">Abbrechen</button>'; el.querySelector('button').onclick = e => { e.stopPropagation(); sendFrom = 0; sendFromOp = ''; sendGroup = []; syncMoveBar(); closeSheet(); }; document.body.appendChild(el); }
  el.querySelector('span').textContent = sendGroup.length ? '➜ Alle ' + sendGroup.length + ' Heere: Ziel antippen – sie ziehen gemeinsam los' : '➜ Ziel antippen – das Heer zieht sofort los'; el.hidden = false;
}
function closeSheet() { if (scoutEl) scoutEl.hidden = true; if (miniEl) miniEl.hidden = true; miniTile = null; sel = null; msel = null; if (wm) { wm.select(null); wm.setPreview(null); } document.body.classList.remove('sheet-open'); }

async function command(cmd) {
  if (busy) return false; busy = true;
  const moved = (sendFrom || sendFromOp) && cmd.type === 'march'; if (moved) cmd = sendFrom ? { ...cmd, from: sendFrom } : { ...cmd, fromOp: sendFromOp, troops: Object.keys(cmd.troops || {}).length ? cmd.troops : sendOpAll() };
  if (cmd.type === 'march' && !cmd.from && !cmd.hero) cmd = { ...cmd, hero: sendHero };
  const r = await api('/api/cmd', cmd).catch(() => ({ ok: false, data: { error: 'Keine Verbindung zum Server.' } }));
  busy = false; if (moved) { sendFrom = 0; sendFromOp = ''; syncMoveBar(); }
  if (r.data && r.data.state) accept(r.data);
  if (!r.ok) toast(r.data.error || 'Das hat nicht geklappt.');
  renderSheet(); renderTop(); renderHud(); renderNav(); renderCity(true); renderBanner(); renderPanel(true);
  return r.ok;
}
function setupSheet() {
  $('sheetInner').addEventListener('click', async e => {
    const hc = e.target.closest('[data-hero]');
    if (hc && !hc.disabled) {
      sendHero = hc.dataset.hero; const pf = heroPrefers(sendHero)[0];
      if (pf && pf !== 'trans' && !sendFrom && !sendFromOp) { const ns = {}; for (const u in S.troops) if (U[u].g === pf && S.troops[u] > 0) ns[u] = S.troops[u]; if (sum(ns)) { send = ns; toast(HEROES[sendHero].name + ' führt am liebsten ' + { inf: 'Infanterie', kav: 'Kavallerie', art: 'Fernkampf-Truppen' }[pf] + ' an.', 'info'); } }
      return renderSheet();
    }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, u = el.dataset.u, id = sel;
    if (act === 'close') { sendFrom = 0; sendFromOp = ''; syncMoveBar(); return closeSheet(); }
    if (act === 'toTech') { closeSheet(); return openPanel('tech'); }
    if (act === 'cancelResearch') return void command({ type: 'cancelResearch' });
    if (mapAct(act, el)) return;
    if (act === 'upgrade') return command({ type: 'upgrade', id });
    if (act === 'upgradeSp') { const ok = await command({ type: 'upgrade', id }); if (ok) openSpeed('build', id); return; }
    if (act === 'cancel') return command({ type: 'cancel', id });
    if (act === 'askHelp') { const ok = await command({ type: 'askHelp', id }); if (ok) toast('Dein Bündnis wurde um Hilfe gebeten.', 'info'); return renderSheet(); }
    if (act === 'train') return command({ type: 'train', id, unit: u, count: pick[u] || 10 });
    if (act === 'exch') { const n = exchAmt[el.dataset.r] || 0; exchAmt[el.dataset.r] = 0; return void command({ type: 'exchange', res: el.dataset.r, count: n }).then(ok => renderSheet()); }
    if (act === 'max') { pick[u] = maxTrain(u); return void renderSheet(); }
    if (act === 'plus' || act === 'minus') {
      const n = pick[u] || 10, step = n >= 100 ? 50 : n >= 20 ? 10 : 5;
      pick[u] = Math.max(1, Math.min(MAX_TRAIN_COUNT, act === 'plus' ? n + step : n - step)); renderSheet();
    }
    if (act === 'heal') return command({ type: 'heal', unit: u, count: Math.min(S.wounded[u] || 0, Number(el.dataset.n) || 1e9) });
    if (act === 'logout') { await api('/api/logout', {}); location.href = '/'; }
  });
}

/* ---------- Stadt als Menü (wie bei Lords & Knights) ---------- */
const BGROUPS = [['eco', 'Wirtschaft', '🌾', ['farm', 'saege', 'stein', 'lager']], ['mil', 'Militär', '⚔️', ['kaserne', 'schiess', 'stall', 'lazarett']], ['adm', 'Verwaltung', '🏛️', ['rathaus', 'akademie', 'mauer']], ['tech', 'Forschung', '📜', []]];
let cityCat = 'eco';
// Gebäude-Symbole im Stil der Ressourcen-Zeichen (🌾 Nahrung, 🪵 Holz, 🪨 Stein, 🪙 Gold)
const BICON = { rathaus: '🏰', farm: '🌾', saege: '🪵', stein: '🪨', lager: '📦', kaserne: '⚔️', schiess: '🏹', stall: '🐎', lazarett: '🩹', akademie: '📜', mauer: '🧱', bau: '🔨', gold: '💰', taktik: '♟️', drill: '🛡️' };
const BORDER = ['rathaus', 'farm', 'saege', 'stein', 'lager', 'kaserne', 'schiess', 'stall', 'lazarett', 'akademie', 'mauer'];
const bico = id => `<span class="bi">${BICON[id] || '🏠'}</span>`;
const tierOf = L => L >= 14 ? 3 : L >= 7 ? 2 : 1;
const imgCache = {}, imgReal = {};
// Eigene Bilder (Ordner public/img/city/, z. B. farm1.jpg, rathaus2.jpg) ersetzen die gemalten, sobald sie existieren.
function imgKey(id) { return id + (id === 'rathaus' ? tierOf(S.lv.rathaus) : 1); }
function imgOf(id) {
  const key = imgKey(id);
  if (imgReal[key]) return imgReal[key];
  if (!imgCache[key]) {
    imgCache[key] = buildingImage(id, key.slice(id.length) | 0 || 1).toDataURL('image/jpeg', .86);
    if (imgReal[key] === undefined) {
      imgReal[key] = null;
      const im = new Image();
      im.onload = () => { imgReal[key] = im.src; citySigV = ''; renderCity(true); if (sel) renderSheet(); };
      im.onerror = () => {};
      im.src = '/public/img/city/' + key + '.jpg';
    }
  }
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
const locked_ = id => S.lv[id] === 0 && S.lv.rathaus < B[id].unlock;
function plateHTML(id) {
  const b = B[id], L = S.lv[id], q = inQueue(S, id), locked = locked_(id), why = locked ? '' : blocker(S, id), t = (S.train[id] || [])[0];
  let act;
  if (q) act = `<div class="bprog"><div class="prog"><i data-qprog="${id}" style="width:${Math.max(0, 1 - q.left / q.total) * 100}%"></i></div><span class="time" data-qtime="${id}">${fmtT(real(q.left))}</span></div>`;
  else if (locked) act = `<span class="why">Rathaus Stufe ${b.unlock} nötig</span>`;
  else if (id === 'rathaus' && L >= 30) act = '<span class="note">Höchststufe</span>';
  else act = `<span class="costs sm">${costHTML(costOf(id, L + 1))}<span class="cost bt" title="Bauzeit">⏱ ${fmtT(real(buildTime(S, id, L + 1)))}</span></span><button class="btn small" type="button" data-up="${id}" ${why ? 'disabled' : ''}>${L ? 'Ausbauen' : 'Bauen'}</button>${why ? `<div class="why one">${why}</div>` : ''}`;
  const extra = t ? `<div class="pmeta"><span data-tinfo="${id}">${t.count}× ${U[t.unit].name}${t.heal ? ' (Heilung)' : ''} · ${fmtT(real(t.left + (t.count - 1) * t.per))}</span></div>` : '';
  return `<article class="plate ${locked ? 'locked' : L ? '' : 'empty'}" data-b="${id}"><div class="pimg">${bico(id)}<span class="ribbon">${L || '–'}</span>${q ? '<span class="btag">Bau</span>' : ''}</div>
    <div class="ptext"><div class="pname">${b.name}</div><div class="pmeta">${cityMeta(id)}</div>${extra}</div><div class="pact">${act}</div></article>`;
}
function techPlateHTML(id) {
  const t = T[id], L = techLv(S, id), run = S.research && S.research.id === id, next = L + 1, why = L >= T_MAX || run ? '' : techBlocker(S, id);
  const pips = `<span class="pips">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= L ? 'on' : ''}"></i>`).join('')}</span>`;
  const now = Math.round(techBonus(id, L) * 100), nx = Math.round(techBonus(id, next) * 100);
  let act;
  if (run) act = `<div class="bprog"><div class="prog"><i data-rprog="1" style="width:${Math.max(0, 1 - S.research.left / S.research.total) * 100}%"></i></div><span class="time" data-rtime="1">${fmtT(real(S.research.left))}</span></div>`;
  else if (L >= T_MAX) act = '<span class="note">Höchststufe erreicht</span>';
  else act = `<span class="costs sm">${costHTML(techCost(id, next))}</span><button class="btn small" type="button" data-tech="${id}" ${why ? 'disabled' : ''}>Erforschen</button><div class="${why ? 'why' : 'note'} one">${why || 'Dauer ' + fmtT(real(techTime(id, next))) + ' · braucht Akademie ' + techReq(next)}</div>`;
  return `<article class="plate tech ${L ? '' : 'empty'}"><div class="pimg">${bico(t.icon)}<span class="ribbon">${L}</span></div>
    <div class="ptext"><div class="pname">${t.name}</div>${pips}<div class="pmeta">${esc(t.desc)}.<br>Jetzt <b>+${now} %</b>${L < T_MAX ? ` → <b>+${nx} %</b>` : ''} ${esc(t.unit)}</div></div><div class="pact">${act}</div></article>`;
}
function citySig() {
  return JSON.stringify([S.lv, S.queue.map(q => q.id + q.target), Object.keys(S.train).map(k => k + S.train[k].map(o => o.count + o.unit).join()), S.troops, S.away, S.wounded,
    Object.keys(B).map(id => locked_(id) ? 'L' : blocker(S, id)), ownMarches().map(m => m.id + m.phase), unread(), me.name, match.name, cityCat, S.stationed, match.phase,
    S.tech, S.research && S.research.id + S.research.target, Object.keys(T).map(id => techBlocker(S, id)), S.items, S.packs && S.packs.length, S.daily && S.daily.quests.map(q => q.done)]);
}
let citySigV = '';
function renderCity(force) {
  if (!S || !$('city')) return;
  const sig = citySig(); if (!force && sig === citySigV) return; citySigV = sig;
  const L = S.lv.rathaus, q = S.queue, marches = ownMarches(), keepTop = $('city').scrollTop;
  const tr = []; for (const k in S.train) for (const [i, o] of S.train[k].entries()) tr.push({ k, o, first: i === 0 });
  const row = (img, main, prog, time, sp) => `<div class="ord">${bico(img)}<div class="qmain">${main}${prog}</div>${time}${sp ? `<button class="spd" type="button" data-speed="${sp}" aria-label="Beschleunigen">⚡</button>` : ''}</div>`;
  const orders = q.map(x => row(x.id, `<b>${B[x.id].name}</b> → Stufe ${x.target}`, `<div class="prog"><i data-qprog="${x.id}" style="width:${Math.max(0, 1 - x.left / x.total) * 100}%"></i></div>`, `<span class="time" data-qtime="${x.id}">${fmtT(real(x.left))}</span>`, 'build:' + x.id))
    .concat(S.research ? [row(T[S.research.id].icon, `<b>${T[S.research.id].name}</b> → Stufe ${S.research.target} <span class="note">(Forschung)</span>`, `<div class="prog"><i data-rprog="1" style="width:${Math.max(0, 1 - S.research.left / S.research.total) * 100}%"></i></div>`, `<span class="time" data-rtime="1">${fmtT(real(S.research.left))}</span>`, 'research:1')] : [])
    .concat(tr.map(({ k, o, first }) => row(k, `<b>${B[k].name}</b>: ${o.count}× ${U[o.unit].name}${o.heal ? ' heilen' : ''}`, first ? `<div class="prog"><i data-tprog="${k}" style="width:${(1 - o.left / o.per) * 100}%"></i></div>` : '', `<span class="time" ${first ? `data-ttime="${k}"` : ''}>${first ? fmtT(real(o.left + (o.count - 1) * o.per)) : 'wartet'}</span>`, first && !o.heal ? 'train:' + k : '')))
    .concat(marches.map(m => `<button class="ord go" type="button" data-march="${m.id}"><div class="qmain"><b>Heer</b> · ${KIND_SHORT[m.tk] || ''}</div><span class="time" data-mtime="${m.id}">${marchLine(m)}</span></button>`));
  const freeSlots = q.length < maxQueues(S) ? '<div class="ord free">Baumeister frei: wähle unten ein Gebäude.</div>' : '';
  const stRow = stationTotal() ? `<div class="ord free">Verbündete Truppen in deiner Burg: <b>${fmtN(stationTotal())}</b> (Tab Bündnis)</div>` : '';
  const home = homeTroops(S), away = awayTroops(S), wd = woundedCount(S);
  const A = S.lv.akademie;
  const body = BORDER.map(plateHTML).join('');
  $('cityList').innerHTML = `<div class="city-in">
    <div class="burg" data-b="rathaus"><b>Burg von ${esc(me.name)}</b><span>Rathaus Stufe ${L} · „${esc(match.name)}“</span></div>
    <div class="bagrow"><button class="bagbtn" type="button" data-bag="1" aria-label="Speedups">⚡ Speedups<b>${SPEED_IDS.reduce((a, i) => a + itemN(i), 0)}</b></button><button class="bagbtn" type="button" data-daily="daily" aria-label="Tägliche Aufgaben">📅 Aufgaben<b>${dailyBadge()}</b></button><button class="bagbtn" type="button" data-daily="packs" aria-label="Ressourcenpakete">🎁 Ressourcen<b>${packN()}</b></button></div>
    <div class="strip parch"><div><b>${fmtN(home)}</b><span>Truppen daheim</span></div><div><b>${fmtN(away)}</b><span>unterwegs</span></div><div><b>${fmtN(wd)}</b><span>verwundet</span></div><div><b>${fmtN(rate(S, 'gold'))}</b><span>Gold/h</span></div></div>
    <section class="orders parch"><h3 class="sec">Aufträge</h3>${orders.join('')}${freeSlots}${stRow}</section>
    <div class="tabbody parch">${body}</div>
  </div>`;
  $('city').scrollTop = keepTop;
}
function updateCity() {
  renderCity(false); city3d();
  for (const x of S.queue) {
    document.querySelectorAll(`[data-qprog="${x.id}"]`).forEach(e => { e.style.width = Math.max(0, 1 - x.left / x.total) * 100 + '%'; });
    document.querySelectorAll(`[data-qtime="${x.id}"]`).forEach(e => { e.textContent = fmtT(real(x.left)); });
  }
  if (S.research) {
    document.querySelectorAll('[data-rprog]').forEach(e => { e.style.width = Math.max(0, 1 - S.research.left / S.research.total) * 100 + '%'; });
    document.querySelectorAll('[data-rtime]').forEach(e => { e.textContent = fmtT(real(S.research.left)); });
  }
  for (const k in S.train) { const o = S.train[k][0]; if (!o) continue;
    document.querySelectorAll(`[data-tprog="${k}"]`).forEach(e => { e.style.width = (1 - o.left / o.per) * 100 + '%'; });
    document.querySelectorAll(`[data-ttime="${k}"]`).forEach(e => { e.textContent = fmtT(real(o.left + (o.count - 1) * o.per)); });
    document.querySelectorAll(`[data-tinfo="${k}"]`).forEach(e => { e.textContent = `${o.count}× ${U[o.unit].name}${o.heal ? ' (Heilung)' : ''} · ${fmtT(real(o.left + (o.count - 1) * o.per))}`; }); }
  for (const m of ownMarches()) document.querySelectorAll(`[data-mtime="${m.id}"]`).forEach(e => { e.textContent = marchLine(m); });
}

/* ---------- 3D-Stadt ---------- */
const CITY_3D = false;   // 3D-Stadt ist abgeschaltet (Text-Stadt); Code bleibt für später
let cv = null, cvLoop = 0, cvFail = !CITY_3D;
const colNum = c => typeof c === 'number' ? c : parseInt(String(c || '#3a6fd0').replace('#', ''), 16) || 0x3a6fd0;
function ensureCity() {
  if (cv || cvFail || !S || !window.THREE) return !!cv;
  try {
    cv = new CityView(THREE, $('cityStage'), { onPick: id => { if (id) openSheet(id); else if (sel && !msel) closeSheet(); } });
    cv.configure({ color: colNum(PLAYER_COLORS[(S.slot || 0) % PLAYER_COLORS.length]), slot: S.slot || 0, layout: Object.fromEntries(Object.keys(B).map(k => [k, [B[k].x, B[k].y, B[k].w]])) });
    let last = performance.now();
    const loop = now => { cvLoop = requestAnimationFrame(loop); const dt = Math.min(.1, (now - last) / 1000); last = now; if (mode === 'city' && !document.hidden) cv.frame(dt); };
    cvLoop = requestAnimationFrame(loop);
    document.body.classList.add('city3d');
  } catch (e) { cvFail = true; cv = null; document.body.classList.remove('city3d'); console.error(e); }
  return !!cv;
}
function city3d() {
  if (!ensureCity()) return;
  const infos = {};
  for (const id of Object.keys(B)) {
    const lv = S.lv[id], q = S.queue.find(x => x.id === id), tr = S.train[id] && S.train[id][0];
    let st = 'none', txt = '';
    if (q) { st = 'build'; txt = fmtT(real(q.left)); }
    else if (id === 'akademie' && S.research) { st = 'research'; txt = fmtT(real(S.research.left)); }
    else if (tr) { st = 'train'; txt = fmtT(real(tr.left + (tr.count - 1) * tr.per)); }
    else if (locked_(id)) st = 'lock';
    else if (!blocker(S, id)) st = lv ? 'up' : 'new';
    infos[id] = { lv, st, txt, name: B[id].name, locked: locked_(id), build: !!q };
  }
  cv.update(infos);
}
function setupCity() {
  $('city').addEventListener('click', async e => {
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'cdrawer') { $('cityDrawer').classList.toggle('open'); return; }
    if (act && act.dataset.act === 'chome') { if (cv) cv.home(); return; }
    const up = e.target.closest('[data-up]');
    if (up) { e.stopPropagation(); return void command({ type: 'upgrade', id: up.dataset.up }); }
    const rs = e.target.closest('[data-tech]');
    if (rs) { e.stopPropagation(); return void command({ type: 'research', tech: rs.dataset.tech }); }
    if (e.target.closest('[data-recallall]')) { for (const m of ownMarches().filter(x => x.phase !== 'back')) await command({ type: 'recall', id: m.id }); return; }
    const mb = e.target.closest('[data-march]');
    if (mb) { await setMode('map'); if (mode === 'map') selectMap({ type: 'march', id: Number(mb.dataset.march) }, true); return; }
    const ct = e.target.closest('[data-cat]'); if (ct) { cityCat = ct.dataset.cat; return void renderCity(true); }
    const c = e.target.closest('[data-b]'); if (c) openSheet(c.dataset.b);
  });
}


/* ---------- Partie: Phase, Schutz, Bündnis, Meldungen ---------- */
const DAY = 86400, THRONE_HOLD = 2 * DAY;
const SANCT = [['Heiligtum der Felder', 'food'], ['Heiligtum des Holzes', 'wood'], ['Heiligtum der Steine', 'stone'], ['Heiligtum des Goldes', 'gold']];
const pname = id => { const p = match.players.find(x => x.id === id); return p ? p.name : '?'; };
const allyOf = id => { const p = match.players.find(x => x.id === id); return p && p.ally ? match.alliances.find(a => a.id === p.ally) : null; };
const isAlly = id => !!(view.ally && id !== me.id && view.ally.members.includes(id));
const dayOf = gt => Math.floor(Math.max(0, gt - match.startGt) / DAY) + 1;
const tagOf = id => { const a = allyOf(id); return a ? '[' + a.tag + '] ' : ''; };
const stationTotal = () => Object.values(S.stationed || {}).reduce((a, t) => a + sum(t), 0);
let armedKey = '', armedTimer;
function twice(key) {
  if (armedKey === key) { armedKey = ''; return true; }
  armedKey = key; clearTimeout(armedTimer); armedTimer = setTimeout(() => { armedKey = ''; renderPanel(true); if (msel) renderSheet(); }, 4000);
  return false;
}
let bannerSig = '';
function renderBanner() {
  const el = $('banner'); if (!el || !view) return;
  const gt = gtNow(), L = [], m = match;
  if (m.phase === 'lobby') L.push(['info', `Lobby · ${m.players.length} Spieler warten. Der Admin startet die Partie, dann beginnt dein Schutz.`]);
  else if (m.phase === 'paused') L.push(['info', 'Die Partie ist pausiert. Die Zeit steht, bis der Admin sie fortsetzt.']);
  else if (m.phase === 'ended') L.push(['info', 'Die Partie ist beendet' + (m.result ? ' · Sieger: ' + m.result.label : '') + '.']);
  if (S.out) L.push(['bad', 'Du bist ausgeschieden. Du kannst die Partie weiter ansehen.']);
  else if (m.phase === 'running') {
    for (const i of view.incoming || []) L.push(['bad', `⚔ ${i.fromTag ? '[' + esc(i.fromTag) + '] ' : ''}${esc(i.from)} ${i.siege ? 'kämpft gegen' : 'greift'} ${i.mine ? 'dich' : esc(i.target)}${i.siege ? '' : ' an'}${i.siege ? ' – Kampf läuft, jetzt Verstärkung schicken!' : ' · Ankunft in ' + fmtT(real(i.eta - gt))}`]);
    const seen = new Set((view.incoming || []).map(i => i.id));
    for (const sg of view.sieges || []) if (!seen.has(sg.id)) L.push(['warn', `<span data-goto="${esc(sg.kind)}:${esc(String(sg.tid))}" style="cursor:pointer">⚔ ${sg.fromTag ? '[' + esc(sg.fromTag) + '] ' : ''}${esc(sg.from)} kämpft gegen ${esc(sg.tname)} – tippen und eingreifen</span>`]);
    if (S.protUntil > gt) L.push(['good mini', `🛡 ${S.protKind === 'fall' ? 'Schutz' : 'Neulingsschutz'} ${fmtT(real(S.protUntil - gt))}`]);
    if (S.vassalOf) L.push(['warn', `Du bist Vasall von ${esc(pname(S.vassalOf))} (20 % Tribut) · frei in ${fmtT(real(S.vassalUntil - gt))}. Fällt deine Burg noch einmal, scheidest du aus.`]);
    const vs = m.players.filter(p => p.vassalOf === me.id); if (vs.length) L.push(['good', `Deine Vasallen: ${vs.map(p => esc(p.name)).join(', ')}`]);
    const th = (m.holds || []).find(h => h.id === 'throne1');
    if (th) L.push([th.mine ? 'good' : 'bad', th.mine ? `👑 Ihr haltet den Thron – noch ${fmtT(real(th.since + THRONE_HOLD - gt))} bis zum Sieg` : `⚠ ALARM: ${esc(th.label)} hat den Thron erreicht! Sieg in ${fmtT(real(th.since + THRONE_HOLD - gt))}. Zerstört ihre Außenposten am Thron, bevor die Zeit abläuft.`]);
  }
  const html = L.map(([k, t]) => `<div class="bn ${k}">${t}</div>`).join('');
  el.classList.toggle('onlymini', L.length > 0 && L.every(l => /mini/.test(l[0])));
  if (html !== bannerSig) { bannerSig = html; el.innerHTML = html; }
}
// Neue Meldungen als kurze Hinweise einblenden (Push erreicht dich, wenn die Seite zu ist)
let feedToasted = null;
const unreadFeed = () => S.feed.filter(f => f.id > (S.feedSeen || 0)).length;
// Held ist aufgestiegen: goldene Anzeige mit Heldenbild
let lvTimer = 0, lvQueue = [];
function heroLevelUp(f) {
  lvQueue.push(f); if (lvQueue.length > 1) return; showLvUp();
}
function showLvUp() {
  const f = lvQueue[0]; if (!f) return;
  const id = HERO_IDS.find(h => f.title.startsWith(HEROES[h].name)), H = id ? HEROES[id] : null, lv = (/Stufe (\d+)/.exec(f.body) || [])[1] || '';
  let el = $('lvUp'); if (!el) { el = document.createElement('div'); el.id = 'lvUp'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = `<span class="lvpic">${H ? hpic(id, H) : '⭐'}</span><div><b>STUFE ${esc(lv)}</b><small>${esc(H ? H.name : 'Held')} ist aufgestiegen</small></div>`;
  el.hidden = false; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(lvTimer); lvTimer = setTimeout(() => { el.hidden = true; lvQueue.shift(); if (lvQueue.length) setTimeout(showLvUp, 300); }, 3800);
}
function checkFeed() {
  const top = S.feed.length ? S.feed[0].id : 0;
  if (feedToasted === null) { feedToasted = S.feedSeen || 0; }
  const fresh = S.feed.filter(f => f.id > feedToasted);
  if (fresh.length) {
    feedToasted = top;
    for (const f of fresh) if (f.kind === 'hero' && /aufgestiegen/.test(f.title)) heroLevelUp(f);
    const rest = fresh.filter(f => !(f.kind === 'hero' && /aufgestiegen/.test(f.title)));
    if (!rest.length) return;
    const bad = rest.some(f => ['attack', 'battle', 'out'].includes(f.kind));
    toast(rest.length === 1 ? rest[0].title + (rest[0].body ? ' – ' + rest[0].body : '') : rest.length + ' neue Meldungen (Mehr)', bad ? '' : 'info');
  }
}

/* ---------- gemeinsame Bausteine der Menüs ---------- */
const PSC = { '🛡️': 'ally', '☰': 'more', '⚔️': 'train', '🎓': 'academy', '🪖': 'units', '📜': 'reports', '🦸': 'heroes' };
const phead = (ico, title, sub, right) => `<header class="phead">${banner(PSC[ico] || 'city')}<span class="pico">${ico}</span><div class="ptitle"><h2>${title}</h2>${sub ? `<small>${sub}</small>` : ''}</div>${right || ''}</header>`;
const ptabs = (items, cur, act) => `<div class="ptabs" role="tablist">${items.map(([id, label, n]) => `<button type="button" role="tab" class="ptab ${id === cur ? 'on' : ''}" data-act="${act}" data-t="${id}">${label}${n ? `<span class="pbadge">${n}</span>` : ''}</button>`).join('')}</div>`;
let moreFrom = '', allyTab = '', moreSub = '', repTab = 'all';

/* ---------- Bündnis ---------- */
function revierHTML() {
  const myOps = (view.world.outposts || []).filter(o => o.mine), gt2 = gtNow(), al0 = view.ally, st = al0 ? al0.store : null;
  const revier = !al0 ? '<p class="note">Außenposten, Bündnislager und gemeinsames Revier gibt es nur im Bündnis. Gründe eines oder tritt einem bei (Tab Bündnis).</p>' : `
    <p class="note">Das Revier gehört dem Bündnis: Jeder Außenposten beansprucht ein Viereck, die Kette beginnt an einem der zehn Türme am Kartenrand. Außenposten baut ihr nur gemeinsam aus dem <b>Bündnislager</b> und nur an euer eigenes Revier. Ihr haltet ${myOps.length} Außenposten (ohne Limit).</p>
    <div class="block"><div class="store"><h2>🏛 Bündnislager</h2><p class="stock-sub">Aktueller Stand</p>
      <div class="stock">${RES.map((r, k) => `<div class="stk ${st[r] >= OP_COST[k] ? 'ok' : 'low'}"><i class="r r-${r}"></i><b>${fmtN(st[r])}</b><span>${RES_DE[r]}</span><small>${st[r] >= OP_COST[k] ? '✓ genug' : 'noch ' + fmtN(OP_COST[k] - st[r])}</small></div>`).join('')}</div>
      ${(() => { const f = al0.fields || {}, tot = RES.reduce((a, r) => a + (f[r] || 0), 0), inc = al0.fieldIncome || 50; return `<div class="fieldinc"><p class="stock-sub"><b>Automatischer Zufluss</b> · ${inc} pro Feld und Stunde</p>${tot ? `<div class="stock">${RES.map(r => `<div class="stk ${f[r] ? 'ok' : 'low'}"><i class="r r-${r}"></i><b>+${fmtN((f[r] || 0) * inc)}/h</b><span>${f[r] || 0} ${f[r] === 1 ? 'Feld' : 'Felder'}</span></div>`).join('')}</div>` : '<p class="note">Noch kein Feld (Farm, Wald, Steinbruch) im Revier. Jedes Feld in eurem fertigen Revier füllt das Lager von selbst, auch ohne dass jemand dort farmt.</p>'}</div>`; })()}
      <p class="stock-sub">${OP_COST.every((c, k) => st[RES[k]] >= c) ? '✅ Das Lager reicht für einen neuen Außenposten.' : '⏳ Für den nächsten Außenposten fehlt noch etwas.'}</p></div>
      <p class="note">Ein neuer Außenposten kostet:</p><div class="costs">${costHTML(OP_COST, st)}</div><p class="note">Wer im Bündnisgebiet Felder, Wälder oder Brüche abbaut, füllt das Lager zusätzlich um ${Math.round(CLAN_SHARE * 100)} % der Beute; dir wird nichts abgezogen. Dazu liefert jedes Feld im Revier automatisch ${al0.fieldIncome || 50} pro Stunde.</p>
      <div class="donate">${RES.map(r => `<label>${RES_DE[r]}<input id="dn_${r}" type="number" inputmode="numeric" min="0" placeholder="0"></label>`).join('')}</div>
      <div class="row"><button class="btn" type="button" data-act="donate">In das Lager einzahlen</button></div></div>`
    + (myOps.map(o => `<div class="mrow"><div><b>Außenposten</b><div class="note">${gt2 < o.done ? 'im Bau, noch ' + fmtT(real(o.done - gt2)) : 'fertig'} · Besatzung ${fmtN(o.total || 0)}</div></div><button class="btn ghost small" type="button" data-act="opGoto" data-id="${o.id}">Auf der Karte</button></div>`).join('') || (al0 ? '<p class="note">Noch kein Außenposten. Den ersten baut der Gründer: auf der Karte den Button „Außenposten“ benutzen (nur mit gefülltem Lager).</p>' : ''));
  return revier;
}
function allyHTML() {
  const cap = match.cap, a = view.ally;
  const intro = `<p class="note">Ein Bündnis darf höchstens <b>${cap}</b> Mitglieder haben (Hälfte der Spieler plus eins). Verbündete können sich nicht angreifen, gewinnen gemeinsam und dürfen Truppen in die Burg des anderen legen. Jeder darf jederzeit austreten. Nach dem Austritt sind Angriffe auf die früheren Verbündeten 24 Stunden gesperrt.</p>`;
  if (!a) {
    const invs = view.invites || [], tab = ['inv', 'list', 'found'].includes(allyTab) ? allyTab : invs.length ? 'inv' : 'list';
    const inv = invs.map(i => `<div class="mrow"><div><b>${esc(i.name)}</b> <span class="tag">${esc(i.tag)}</span><div class="note">Einladung von ${esc(i.by)}</div></div><div class="acts"><button class="btn small" data-act="allyAnswer" data-id="${i.id}" data-yes="1" type="button">Annehmen</button><button class="btn ghost small" data-act="allyAnswer" data-id="${i.id}" type="button">Ablehnen</button></div></div>`).join('') || '<p class="note">Im Moment hat dich niemand eingeladen.</p>';
    const list = match.alliances.map(x => `<div class="mrow"><div><b>${esc(x.name)}</b> <span class="tag">${esc(x.tag)}</span><div class="note">${x.members.length} von ${cap} · ${x.members.map(id => esc(pname(id))).join(', ')}</div></div>${x.members.length >= cap ? '<span class="note">voll</span>' : (view.requests || []).some(r => r.al === x.id) ? '<span class="note">angefragt</span>' : `<button class="btn small" data-act="allyRequest" data-al="${x.id}" type="button">Anfragen</button>`}</div>`).join('') || '<p class="note">Noch kein Bündnis gegründet. Gründe das erste!</p>';
    const body = tab === 'inv' ? `<div class="block"><h3>Einladungen</h3>${inv}</div>`
      : tab === 'list' ? `<div class="block"><h3>Bestehende Bündnisse</h3>${list}</div>`
      : `${intro}<div class="block"><h3>Bündnis gründen</h3><div class="field"><label for="alName">Name</label><input id="alName" maxlength="20" placeholder="z. B. Rote Garde"></div>
        <div class="field"><label for="alTag">Kürzel (2 bis 4 Zeichen)</label><input id="alTag" maxlength="4" placeholder="z. B. ROT"></div>
        <div class="row"><button class="btn" data-act="allyCreate" type="button">Gründen</button></div></div>`;
    return phead('🛡️', 'Bündnis', 'Du bist in keinem Bündnis') + ptabs([['inv', 'Einladungen', invs.length], ['list', 'Bündnisse'], ['found', 'Gründen']], tab, 'atab') + body;
  }
  const lead = a.leader === me.id, reqN = (a.requests || []).length;
  const tab = ['ov', 'lager', 'chat', 'shop', 'adm'].includes(allyTab) ? allyTab : 'ov';
  const members = a.members.map(id => {
    const p = match.players.find(x => x.id === id) || {};
    const st = p.out ? 'ausgeschieden' : p.vassalOf ? 'Vasall' : p.protUntil > gtNow() ? 'geschützt' : '';
    return `<div class="mrow"><div><b>${esc(p.name || '?')}</b>${id === a.leader ? ' 👑' : ''}${id === me.id ? ' <span class="note">(du)</span>' : ''}<div class="note">Rathaus ${p.rathaus || 0}${st ? ' · ' + st : ''}</div></div>
      ${lead && id !== me.id ? `<div class="acts"><button class="btn ghost small" data-act="allyLead" data-pid="${id}" type="button">${armedKey === 'lead' + id ? 'Wirklich übergeben' : 'Führung'}</button><button class="btn ${armedKey === 'kick' + id ? 'danger' : 'ghost'} small" data-act="allyKick" data-pid="${id}" type="button">${armedKey === 'kick' + id ? 'Wirklich entfernen' : 'Entfernen'}</button></div>` : ''}</div>`;
  }).join('');
  const reqs = (a.requests || []).map(r => `<div class="mrow"><div><b>${esc(r.name)}</b><div class="note">möchte beitreten</div></div><div class="acts"><button class="btn small" data-act="allyAnswer" data-id="${r.id}" data-yes="1" type="button">Aufnehmen</button><button class="btn ghost small" data-act="allyAnswer" data-id="${r.id}" type="button">Ablehnen</button></div></div>`).join('');
  const invd = (a.invites || []).map(r => `<div class="note">Eingeladen: ${esc(r.name)}</div>`).join('');
  const free = match.players.filter(p => !p.ally && !p.out && p.id !== me.id);
  const invForm = a.members.length >= cap ? `<p class="note">Das Bündnis ist voll.</p>` : free.length ? `<div class="chatform"><select id="alInv">${free.map(p => `<option>${esc(p.name)}</option>`).join('')}</select><button class="btn small" data-act="allyInvite" type="button">Einladen</button></div>` : '<p class="note">Alle anderen Spieler sind schon in einem Bündnis oder ausgeschieden.</p>';
  const stat = Object.keys(S.stationed || {}).map(pid => `<div class="mrow"><div><b>${esc(pname(Number(pid)))}</b><div class="note">${troopsLine(S.stationed[pid])}</div></div><button class="btn ghost small" data-act="stationDismiss" data-pid="${pid}" type="button">Zurückschicken</button></div>`).join('');
  const mine = (view.myStations || []).map(x => `<div class="mrow"><div><b>${esc(x.name)}</b><div class="note">${troopsLine(x.troops)}</div></div><button class="btn ghost small" data-act="stationRecall" data-pid="${x.host}" type="button">Zurückrufen</button></div>`).join('');
  const chat = (a.ann || []).slice().reverse().map(c => `<div class="msg"><b>${esc(c.name)}</b><small>${ago(c.t)}</small><br>${esc(c.text)}</div>`).join('') || '<p class="note">Noch keine Ankündigungen.</p>';
  const body = tab === 'ov' ? `<div class="block"><h3>Mitglieder</h3>${members}</div>
      <div class="block"><h3>Verstärkung</h3><p class="note">In deiner Burg: ${fmtN(stationTotal())} von ${fmtN(60 * S.lv.rathaus)} fremden Truppen (Platz wächst mit dem Rathaus). Sie helfen bei der Verteidigung. Neue schickst du über die Karte: Burg des Verbündeten antippen, Stationieren.</p>${stat || '<p class="note">Im Moment liegen keine fremden Truppen bei dir.</p>'}
      <h3 style="margin-top:12px">Deine Truppen bei Verbündeten</h3>${mine || '<p class="note">Keine.</p>'}</div>`
    : tab === 'lager' ? revierHTML()
    : tab === 'chat' ? `<div class="block"><h3>Ankündigungen</h3>${lead ? '<div class="chatform"><input id="alMsg" maxlength="400" placeholder="Ankündigung an alle Mitglieder" autocomplete="off"><button class="btn small" data-act="allyAnnounce" type="button">Senden</button></div>' : '<p class="note">Hier schreibt nur der Anführer. Zum Unterhalten nutze den Bündnis-Chat auf der Karte (Sprechblase links unten).</p>'}<div class="msgs" id="chatBox" style="max-height:none;margin-top:8px">${chat}</div></div>`
    : tab === 'shop' ? shopHTML()
    : `${reqs ? `<div class="block"><h3>Beitrittsanfragen</h3>${reqs}</div>` : ''}
      ${lead ? `<div class="block"><h3>Farbe des Reviers</h3><div class="swatches">${['#c8372d', '#2f6fd1', '#e2b02e', '#3f9d4c', '#8a4bc4', '#e0782b', '#27a7a1', '#d9609c', '#9aa5b1', '#b9d03a', '#ffffff', '#1c1c1c'].map(c => `<button type="button" class="sw ${(a.color || '').toLowerCase() === c ? 'on' : ''}" style="background:${c}" data-act="allyColor" data-c="${c}" aria-label="Farbe ${c}"></button>`).join('')}</div><p class="note">So sehen alle Mitglieder euer Revier und eure Außenposten.</p></div>` : ''}
      <div class="block"><h3>Spieler einladen</h3>${invd}${invForm}</div>
      <div class="block"><h3>Regeln</h3>${intro}</div>
      <div class="block"><button class="btn ${armedKey === 'leave' ? 'danger' : 'ghost'}" data-act="allyLeave" type="button">${armedKey === 'leave' ? 'Wirklich austreten' : 'Bündnis verlassen'}</button>${lead ? '<p class="note">Als Anführer kannst du die Führung vorher übergeben. Verlässt du es, übernimmt das nächste Mitglied.</p>' : ''}</div>`;
  return phead('🛡️', `${esc(a.name)} <span class="tag">${esc(a.tag)}</span>`, `${a.members.length} von ${cap} Mitgliedern`) + ptabs([['ov', 'Übersicht'], ['lager', 'Revier'], ['chat', 'Ansagen'], ['shop', 'Shop'], ['adm', lead ? 'Verwaltung' : 'Einladen', reqN]], tab, 'atab') + body;
}

/* ---------- Mehr: Partie, Rangliste, Chronik, Erste Schritte, Einstellungen ---------- */
const FEED_ICON = { spy: '🔍', attack: '⚔', battle: '🛡', station: '🤝', ally: '🤝', hold: '👑', out: '✖', free: '🕊', protect: '🛡', start: '🏁', end: '🏆', scout: '🧭', help: '🤝', hero: '🦸' };
let pushOn = null, pushMsg = '';
async function pushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return (pushOn = 'unsupported');
  try { const reg = await navigator.serviceWorker.getRegistration('/'); const sub = reg && await reg.pushManager.getSubscription(); pushOn = sub && Notification.permission === 'granted' ? 'on' : 'off'; } catch { pushOn = 'off'; }
  return pushOn;
}
const b64u = s => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };
async function enablePush() {
  try {
    const k = await api('/api/push/key'); if (!k.ok) throw new Error(k.data.error || 'Nicht verfügbar.');
    const perm = await Notification.requestPermission(); if (perm !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt. Erlaube sie in den Browser-Einstellungen.');
    const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(k.data.key) }), j = sub.toJSON();
    const r = await api('/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys }); if (!r.ok) throw new Error(r.data.error || 'Abo fehlgeschlagen.');
    pushMsg = 'Benachrichtigungen sind eingeschaltet.';
  } catch (e) { pushMsg = String(e.message || e); }
  await pushStatus(); renderPanel(true);
}
async function disablePush() {
  try { const reg = await navigator.serviceWorker.getRegistration('/'), sub = reg && await reg.pushManager.getSubscription(); if (sub) { await api('/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); } pushMsg = 'Benachrichtigungen sind aus.'; } catch (e) { pushMsg = String(e.message || e); }
  await pushStatus(); renderPanel(true);
}
function tutorialHTML() {
  const rp = S.reports, steps = [
    ['Bauernhof und Sägewerk bauen', S.lv.farm > 0 && S.lv.saege > 0, 'Stadt → Wirtschaft. Ohne Nahrung und Holz geht nichts.'],
    ['Rathaus auf Stufe 2 ausbauen', S.lv.rathaus >= 2, 'Schaltet die Kaserne und weitere Gebäude frei.'],
    ['Kaserne bauen und Truppen ausbilden', troopCount(S) > 0, 'Stadt → Militär → Kaserne.'],
    ['Ein Heer zu einem Feld schicken', rp.some(r => r.kind === 'gather' || r.kind === 'return'), 'Karte → Feld antippen, Truppen wählen, Sammeln.'],
    ['Einen Räuber besiegen', rp.some(r => r.kind === 'camp' && r.win), 'Niedrige Stufen sind leicht. Die Prognose zeigt dir vorher den Ausgang.'],
    ['Einem Bündnis beitreten oder eines gründen', !!view.ally, 'Tab Bündnis. Zusammen seid ihr stärker und gewinnt gemeinsam.'],
    ['Einen Außenposten bauen', ((view.world.outposts || []).some(o => o.mine)), 'Braucht ein Bündnis mit gefülltem Lager (Bündnis → Revier & Lager); den ersten baut der Gründer, an einem der Türme am Kartenrand. Karte → Button „Außenposten“ → Karte verschieben → Hier bauen. Er vergrößert das Revier und ist nötig für Heiligtümer und Thron.'],
    ['Einen Gegner ausspähen', rp.some(r => r.kind === 'spy'), 'Silber im Rathaus tauschen, dann Karte → Burg eines Gegners → Spähen (30 Minuten).'],
    ['Ein Heiligtum andocken', (match.holds || []).some(h => h.mine && h.id !== 'throne1'), 'Ein Außenposten-Viereck deines Bündnisses muss das weiße Viereck um ein Heiligtum berühren. Dann bekommt ihr +15 % auf einen Rohstoff.']
  ];
  const done = steps.filter(x => x[1]).length;
  return `<p class="note">${done} von ${steps.length} geschafft.</p>${steps.map(([t, ok, h]) => `<div class="chk ${ok ? 'done' : ''}"><i>${ok ? '✓' : ''}</i><span><b>${t}</b><br><small class="note">${h}</small></span></div>`).join('')}`;
}
function combatRulesHTML() {
  return `<p class="desc"><b>So wird gekämpft:</b> Der Kampf dauert höchstens 30 Runden, beide Seiten schlagen gleichzeitig zu. Jede Einheit hat Angriff und Abwehr gegen Fernkämpfer, Infanterie und Kavallerie (siehe Ausbildung). Pro Runde fallen auf der Gegenseite: Anzahl × Angriff gegen deren Gattung × 0,25 ÷ Abwehr der Gegenseite gegen deine Gattung, verteilt nach Anteil auf deren Einheiten. Wer keine Einheit mehr hat, verliert, der Sieger behält seine Reste.</p>
  <p class="desc"><b>Verluste:</b> 30 % der Verluste sind verwundet und kommen ins Lazarett (solange Platz ist), 70 % sind gefallen. Karren greifen nicht an, haben nur Abwehr 10 und werden nicht verwundet. Die Forschung Kriegskunst gibt +4 % pro Stufe auf Angriff und Verteidigung.</p>
  <p class="desc"><b>Beim Sammeln:</b> Ein Gegner kann dein Heer auf dem Feld überfallen (Schutz und Bündnisse gelten). Es verteidigt allein, ohne Wachen und Bonus. Verlierst du, ist das Heer weg und der Angreifer nimmt mit, was du schon gesammelt hattest (begrenzt durch seine Traglast). Gewinnst du, sammelst du mit den Überlebenden weiter, mit entsprechend weniger Traglast. Auf einem Feld sammelt immer nur ein Heer.</p>
  <p class="desc"><b>Außenposten:</b> Angreifen können nur Bündnisse, und nur Außenposten, an die ein eigener fertiger Außenposten grenzt. Verteidigt wird mit einer Wache (30 Infanterie, 20 Fernkämpfer) plus allen dort stationierten Truppen. Ein fertiger Außenposten gibt der Wache +30 %, ein im Bau befindlicher nichts. Bei einem Sieg wird er zerstört, das Revier dahinter ist dann inaktiv, der Angreifer erbeutet 30 % der Baukosten und die stationierten Truppen sind verloren. Bei einer Niederlage verlieren die Verteidiger nur die gefallenen Truppen.</p>
  <p class="desc"><b>Burgen:</b> Es verteidigen alle Truppen zu Hause, stationierte Verbündete und die Stadtwache (10 + 8 pro Rathausstufe + 15 pro Mauerstufe Infanterie). Die Mauer gibt +5 % pro Stufe. Siegt der Angreifer, plündert er 40 % der Rohstoffe über dem geschützten Anteil (20 % + 1 % je Lagerstufe, höchstens 40 %) und 25 % des Golds, begrenzt durch seine Traglast. Der Besitzer wird Vasall, beim zweiten Fall scheidet er aus. Unter Schutz sind Burgen nicht angreifbar.</p>`;
}
function rulesHTML() {
  return `<p class="desc"><b>Ziel:</b> Das Bündnis, das den <b>Thron</b> in der Mitte 2 Tage hält, gewinnt. Es gibt kein Zeitlimit. Das geht nur über ein Bündnis: Nur Bündnisse können ihr Revier mit Außenposten bis zum weißen Viereck am Thron vergrößern, wer allein spielt, erreicht ihn nicht. Außerdem gewinnt, wer als Erste alle Feinde ausgeschaltet hat.</p>
  <p class="desc"><b>Schutz:</b> Neue Spieler sind 4 Tage vor Angriffen sicher. Wer selbst einen Spieler angreift, verliert den Schutz sofort.</p>
  <p class="desc"><b>Fall einer Burg:</b> Das erste Mal wird der Besiegte <b>Vasall</b> (7 Tage, 20 % seiner Erträge gehen an den Sieger, danach 12 Stunden Schutz). Fällt die Burg ein zweites Mal, <b>scheidet</b> der Spieler aus.</p>
  <p class="desc"><b>Bündnisse:</b> Höchstens die Hälfte der Spieler plus eins. Verbündete siegen gemeinsam und helfen sich mit Truppen in der Burg.</p>
  <p class="desc"><b>Revier:</b> Jeder Außenposten beansprucht ein Viereck auf der Karte. Der erste muss an einem der zehn Türme am Kartenrand beginnen (nicht an der Burg), jeder weitere das Revier berühren. Ohne Bündnis gibt es kein Revier. Außenposten gehören dem Bündnis, haben eine Stufe, werden aus dem Bündnislager bezahlt und über den Button auf der Karte gebaut. Wer im Bündnisgebiet farmt, füllt zusätzlich das Lager. Einen feindlichen Außenposten greift an, wer direkt daneben einen eigenen baut.</p>
  <p class="desc"><b>Felder:</b> Ein Heer sammelt dort 20 Rohstoffe pro Minute, begrenzt durch seine Traglast und den Vorrat. Ein geleertes Feld ist 6 Stunden leer und dann wieder voll, ein angebrochenes erneuert sich 6 Stunden nach dem letzten Besuch. Auf dem Feld kann dein Heer von Feinden überfallen werden (Schutzzeit und Bündnisse gelten wie sonst).</p>
  <p class="desc"><b>Heiligtümer:</b> Jedes gehaltene Heiligtum gibt der Gruppe +15 % auf einen Rohstoff, der Thron +25 % Gold. Dafür muss ein Außenposten-Viereck deines Bündnisses das weiße Viereck um den Ort berühren. Thron und Heiligtümer werden nicht besetzt oder bewacht: Wer dort andockt, hält sie und die Mitglieder bekommen den Bonus.</p>
  <div class="row"><button class="btn" type="button" data-act="sub" data-t="combat">⚔️ Kampfregeln</button></div>`;
}
let devOk = false; try { devOk = sessionStorage.getItem('zk-dev') === '1'; } catch {}
function devHTML() {
  if (!devOk) return '<div class="field"><label for="devPw">Passwort</label><input id="devPw" type="password" autocomplete="off"></div><div class="row"><button class="btn" type="button" data-act="devUnlock">Freischalten</button><span class="note" id="devMsg"></span></div>';
  return '<p class="note">Nur für die Testversion.</p><div class="row"><button class="btn" type="button" data-act="devTools">' + (document.body.classList.contains('dev-tools') ? '🛠 Testwerkzeuge ausblenden' : '🛠 Testwerkzeuge einblenden') + '</button><button class="btn ghost" type="button" data-act="devAdmin">Admin</button></div>';
}
function moreHTML() {
  const m = match, gt = gtNow(), rk = m.ranking || { players: [], groups: [] };
  const state = m.phase === 'lobby' ? 'Lobby (noch nicht gestartet)' : m.phase === 'paused' ? 'pausiert' : m.phase === 'ended' ? 'beendet' : 'läuft';
  const days = m.phase === 'lobby' ? '' : m.phase === 'ended' ? '' : `Tag ${dayOf(gt)}`;
  const th = (m.holds || []).find(h => h.id === 'throne1');
  const info = `<dl class="stats"><dt>Partie</dt><dd>${esc(m.name)} · ${state}</dd>${days ? `<dt>Zeit</dt><dd>${days}</dd>` : ''}<dt>Thron</dt><dd>${th ? esc(th.label) + ' (noch ' + fmtT(real(th.since + THRONE_HOLD - gt)) + ')' : 'frei'}</dd>
    <dt>Bündnisgröße</dt><dd>höchstens ${m.cap}</dd><dt>Tempo</dt><dd>×${m.speed}</dd></dl>${m.result ? `<div class="row"><button class="btn" data-act="showEnd" type="button">Ergebnis ansehen</button></div>` : ''}`;
  const rank = `<table class="rank"><thead><tr><th>#</th><th>Spieler</th><th>Punkte</th><th></th></tr></thead><tbody>${rk.players.map((r, i) => `<tr class="${r.id === me.id ? 'me' : ''}"><td>${i + 1}</td><td>${r.tag ? '<span class="tag">' + esc(r.tag) + '</span> ' : ''}${esc(r.name)}</td><td>${fmtN(r.score)}</td><td>${r.out ? '✖' : r.vassalOf ? 'Vasall' : ''}</td></tr>`).join('')}</tbody></table>
    ${rk.groups.some(g => g.members.length > 1) ? `<h3 style="margin-top:12px">Gruppen</h3><table class="rank"><tbody>${rk.groups.map((g, i) => `<tr><td>${i + 1}</td><td>${esc(g.label)}</td><td>${fmtN(g.score)}</td></tr>`).join('')}</tbody></table>` : ''}
    <p class="note">Punkte: Gebäudestufen, Truppen, eroberte Burgen und besiegte Einheiten.</p>`;
  const chron = (m.chron || []).map(c => `<div class="mrow"><div><span class="note">Tag ${dayOf(c.gt)}</span><br>${esc(c.text)}</div></div>`).join('') || '<p class="note">Noch nichts passiert.</p>';
  const uf = S.feedSeen || 0;
  const feed = S.feed.map(f => `<div class="mrow"><div>${FEED_ICON[f.kind] || '•'} <b>${esc(f.title)}</b>${f.id > uf ? ' <span class="tag">neu</span>' : ''}<div class="note">${esc(f.body)} · ${ago(f.t)}</div></div></div>`).join('') || '<p class="note">Keine Meldungen.</p>';
  const ps = pushOn === 'unsupported' ? '<p class="note">Dein Browser unterstützt keine Benachrichtigungen. Auf dem iPhone: Seite zum Home-Bildschirm hinzufügen und von dort öffnen.</p>'
    : `<div class="row">${pushOn === 'on' ? '<button class="btn ghost" data-act="pushOff" type="button">Benachrichtigungen ausschalten</button>' : '<button class="btn" data-act="pushOn" type="button">Benachrichtigungen einschalten</button>'}</div><p class="note">${pushMsg || 'Du bekommst eine Meldung, wenn dich jemand angreift, ein Heer zurückkehrt oder das Bündnis dich braucht. Auf dem iPhone: zuerst zum Home-Bildschirm hinzufügen.'}</p>`;
  const sc = snd.cfg;
  const settings = `<div class="block"><h3>Ton und Musik</h3><div class="row"><button class="btn ${sc.sfx ? '' : 'ghost'}" data-snd="sfx" type="button">🔊 Töne: ${sc.sfx ? 'an' : 'aus'}</button><button class="btn ${sc.music ? '' : 'ghost'}" data-snd="music" type="button">🎵 Musik: ${sc.music ? 'an' : 'aus'}</button></div>
    <div class="field"><label for="vs">Lautstärke Töne</label><input id="vs" type="range" min="0" max="1" step=".05" value="${sc.vs}" data-sndv="vs"></div><div class="field"><label for="vm">Lautstärke Musik</label><input id="vm" type="range" min="0" max="1" step=".05" value="${sc.vm}" data-sndv="vm"></div></div>
    <div class="block"><h3>Benachrichtigungen</h3>${ps}</div>
    <div class="block"><h3>Passwort ändern</h3><div class="field"><label for="pwOld">Altes Passwort</label><input id="pwOld" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="pwNew">Neues Passwort (mindestens 6 Zeichen)</label><input id="pwNew" type="password" autocomplete="new-password"></div>
      <div class="row"><button class="btn ghost" data-act="pwChange" type="button">Passwort ändern</button><span class="note" id="pwMsg"></span></div>
      <p class="note">Pro Person ist ein Konto vorgesehen. Mehrfachkonten fallen dem Admin auf und können entfernt werden.</p></div>
    <div class="block"><div class="row"><button class="btn ghost" data-act="logout" type="button">Abmelden</button></div>
      <div class="links"><a href="/impressum" target="_blank" rel="noopener">Impressum</a><a href="/datenschutz" target="_blank" rel="noopener">Datenschutz</a></div></div>`;
  const SUBS = {
    units: ['🪖', 'Militär', unitOverviewHTML()], dev: ['🛠', 'Entwickler', devHTML()], game: ['🏁', 'Partie', info], rank: ['🏆', 'Rangliste', rank], chron: ['📖', 'Chronik der Welt', chron],
    feed: ['🔔', 'Meldungen', feed], shop: ['🛒', 'Shop', shopHTML()], speed: ['⚡', 'Speedups', speedupsHTML()], daily: ['📅', 'Tägliche Aufgaben', dailyHTML()], packs: ['🎁', 'Ressourcen', packsHTML()], rules: ['📜', 'Spielregeln', rulesHTML()], combat: ['⚔️', 'Kampfregeln', combatRulesHTML()], settings: ['⚙️', 'Einstellungen', settings]
  };
  if (SUBS[moreSub]) { const [ico, t, body] = SUBS[moreSub]; return phead(ico, t, '', '<button class="pback" type="button" data-act="back">‹ Zurück</button>') + `<div class="block flat">${body}</div>`; }
  const myRank = rk.players.findIndex(r => r.id === me.id), mine = rk.players[myRank], al = view.ally;
  const tile = (id, ico, t, s, n) => `<button type="button" class="tile" data-act="sub" data-t="${id}"><span class="tico">${ico}</span><b>${t}</b><small>${s}</small>${n ? `<span class="pbadge">${n}</span>` : ''}</button>`;
  return phead('☰', 'Mehr', esc(m.name) + ' · ' + state)
    + `<div class="profile"><span class="avatar" style="background:${PLAYER_COLORS[(S.slot || 0) % PLAYER_COLORS.length] || '#8a5412'}">${esc((me.name || '?').slice(0, 1).toUpperCase())}</span><div><b>${esc(me.name)}</b>${al ? ` <span class="tag">${esc(al.tag)}</span>` : ''}<div class="note">Rathaus ${S.lv.rathaus}${myRank >= 0 ? ` · Platz ${myRank + 1} von ${rk.players.length} · ${fmtN(mine.score)} Punkte` : ''}</div></div></div>`
    + `<div class="hub">${tile('units', '🪖', 'Militär', 'Truppen im Überblick')}${tile('shop', '🛒', 'Shop', 'Teleporter', itemN('teleport'))}${tile('rank', '🏆', 'Rangliste', myRank >= 0 ? 'Du bist Platz ' + (myRank + 1) : 'Wer führt?')}${tile('feed', '🔔', 'Meldungen', unreadFeed() ? unreadFeed() + ' neu' : 'alles gelesen', unreadFeed())}${tile('daily', '📅', 'Tägliche Aufgaben', dailyDone(S) && !(S.daily || {}).claimed ? 'Belohnung bereit!' : dailySub(), dailyBadge())}${tile('packs', '🎁', 'Ressourcen', packN() ? packN() + ' Pakete' : 'keine Pakete', packN())}${tile('speed', '⚡', 'Speedups', SPEED_IDS.reduce((a, i) => a + itemN(i) * ITEMS[i].sec, 0) ? fmtT(real(SPEED_IDS.reduce((a, i) => a + itemN(i) * ITEMS[i].sec, 0))) + ' gefunden' : 'noch keine gefunden', SPEED_IDS.reduce((a, i) => a + itemN(i), 0))}${tile('chron', '📖', 'Chronik', 'Ereignisse der Welt')}${window.zkSimMode ? tile('dev', '🛠', 'Entwickler', 'Test und Admin') : ''}${tile('reports', '📜', 'Berichte', unread() ? unread() + ' ungelesen' : 'Kämpfe und Funde', unread())}${tile('rules', '📜', 'Spielregeln', 'Ziel und Ablauf')}${tile('settings', '⚙️', 'Einstellungen', 'Konto, Mitteilungen')}</div>`;
}

/* ---------- Ausbilden (eigenes Menü) ---------- */
let trainTab = '';
// Werte einer Einheit: Angriff/Abwehr gegen Artillerie · Infanterie · Kavallerie, Traglast, Tempo
const f1 = n => String(n).replace('.', ',');
const unitStatsHTML = u => { const d = U[u], sec = Math.round(d.tempo * 60 / MARCH_BOOST / 1);
  return (d.at ? `<span title="Angriff gegen Fernkämpfer / Infanterie / Kavallerie">⚔ ${d.at.join(' / ')}</span><span title="Abwehr gegen Fernkämpfer / Infanterie / Kavallerie">🛡 ${d.df.join(' / ')}</span>` : '<span>🚚 kämpft nicht</span>')
    + `<span title="Traglast je Einheit">🎒 ${fmtN(d.c)}</span><span title="Tempo (1×): Sekunden je Feld">👣 ${f1(sec)} s/Feld</span>`; };
const TNAME = { lager: 'Transport' };
const tabName = x => TNAME[x] || B[x].name;
// Übersicht über alle Einheiten: daheim, unterwegs, verwundet, in Ausbildung
function unitOverviewHTML() {
  const q = {}; for (const k in S.train) for (const o of S.train[k]) if (!o.heal) q[o.unit] = (q[o.unit] || 0) + o.count;
  const rows = Object.keys(U).map(u => { const h = S.troops[u] || 0, a = (S.away || {})[u] || 0, w = S.wounded[u] || 0, t = q[u] || 0, tot = h + a;
    return `<tr class="${tot + w + t ? '' : 'zero'}"><td>${U[u].name}<small>${GATT[U[u].g]}</small></td><td>${fmtN(h)}</td><td>${fmtN(a)}</td><td>${fmtN(w)}</td><td>${fmtN(t)}</td></tr>`; }).join('');
  const cap = capacityOf(S.troops, S);
  return `<div class="block"><h3>Deine Einheiten</h3><table class="uov"><thead><tr><th>Einheit</th><th title="Zu Hause">Daheim</th><th title="Auf Märschen oder als Besatzung">Unterw.</th><th>Verw.</th><th title="In Ausbildung">Ausb.</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">Traglast der Truppen daheim: <b>${fmtN(cap)}</b> Rohstoffe · Märsche sind so schnell wie die langsamste Einheit (Karren zählen mit).</p></div>`; }
const TRAIN_B = ['kaserne', 'schiess', 'stall', 'lager'];
const trainBuilding = () => TRAIN_B.includes(trainTab) ? trainTab : TRAIN_B.find(b => S.lv[b]) || 'kaserne';
function trainHTML() {
  const strip = `<div class="strip"><div><b>${fmtN(troopCount(S))}</b><span>Truppen gesamt</span></div><div><b>${fmtN(queuedTroops(S))}</b><span>in Ausbildung</span></div><div><b>${fmtN(Object.values(S.troops).reduce((a, n) => a + n, 0))}</b><span>daheim</span></div></div>`;
  const groups = TRAIN_B.map(tab => {
    const b = B[tab], L = S.lv[tab], q = S.train[tab] || [];
    if (!L) {
      const blk = blocker(S, tab);
      return `<div class="block"><h3>${tabName(tab)}: ${b.name} fehlt</h3><p class="note">${esc(b.desc)}</p><p class="note">${blk ? esc(blk) : 'Du kannst sie jetzt bauen.'}</p><div class="row"><button class="btn" type="button" data-act="toCityB" data-b="${tab}">Zum Gebäude</button></div></div>`;
    }
    const rows = b.units.map(u => {
      const d = U[u], ok = L >= d.req, n = pick[u] || 10, total = d.cost.map(c => c * n), home = S.troops[u] || 0;
      return `<div class="ucard ${ok ? '' : 'locked'}"><div class="uhead"><div><b>${d.name}</b><small>${fmtN(home)} daheim</small></div><span class="utime">${fmtT(real(unitTime(S, u, tab)))} je Einheit</span></div>
        <div class="ustats">${unitStatsHTML(u)}</div>
        ${ok ? `<div class="uact">${qtyHTML('pick', u, n, 1, MAX_TRAIN_COUNT, 'minus', 'plus')}
          <button class="btn" type="button" data-act="train" data-u="${u}" data-b="${tab}" ${afford(S, total) && q.length < MAX_TRAIN_ORDERS ? '' : 'disabled'}>Ausbilden</button></div><div class="costs">${costHTML(total)}</div>` : `<p class="note">Ab ${b.name} Stufe ${d.req}</p>`}</div>`;
    }).join('');
    const list = q.map((o, i) => `<div class="train-row"><span>${o.count}× ${U[o.unit].name}</span>${i === 0 ? `<div class="prog"><i data-tp="${tab}" style="width:${(1 - o.left / o.per) * 100}%"></i></div><span class="time" data-tt="${tab}">${fmtT(real(o.left + (o.count - 1) * o.per))}</span><button class="spd" type="button" data-speed="train:${tab}" aria-label="Beschleunigen">⚡</button>` : '<span class="time">wartet</span>'}</div>`).join('');
    return `<h3 class="tgroup">${tabName(tab)} · ${b.name} Stufe ${L}</h3>` + rows + `<div class="block"><h3>Schleife (${q.length} von ${MAX_TRAIN_ORDERS})</h3>${list || '<p class="note">Im Moment wird hier nichts ausgebildet.</p>'}</div>`;
  }).join('');
  const byG = {}; for (const u of Object.keys(U)) { const n = (S.troops[u] || 0) + ((S.away || {})[u] || 0); byG[U[u].g] = (byG[U[u].g] || 0) + n; }
  const typ = `<div class="strip">${Object.keys(GATT).map(g => `<div><b>${fmtN(byG[g] || 0)}</b><span>${GATT[g]}</span></div>`).join('')}</div>`;
  return phead('⚔️', 'Ausbilden', 'Alle Einheiten') + strip + typ + groups;
}
function updateTrainPanel() {
  if (panelName !== 'train') return;
  for (const tab of TRAIN_B) {
    const o = (S.train[tab] || [])[0], p = document.querySelector(`[data-tp="${tab}"]`), t = document.querySelector(`[data-tt="${tab}"]`);
    if (o && p) { p.style.width = (1 - o.left / o.per) * 100 + '%'; if (t) t.textContent = fmtT(real(o.left + (o.count - 1) * o.per)); }
  }
}

/* ---------- Forschung (eigenes Menü) ---------- */
// Genau, was eine Technik auf der angegebenen Stufe für dich bringt (mit deinen aktuellen Werten)
function techEffect(id, lvl) {
  const t = T[id], x = t.per * lvl, pct = Math.round(x * 100);
  if (['food', 'wood', 'stone'].includes(t.eff)) {
    const b = Object.keys(B).find(k => B[k].prod === t.eff), base = (15 + prodAt(b, S.lv[b])) * bonusOf(S, t.eff);
    return `+${pct} % ${RES_DE[t.eff]}-Ertrag aus ${B[b].name}: <b>${fmtN(base * (1 + x))}/h</b> statt ${fmtN(base)}/h (bei deiner ${B[b].name}-Stufe ${S.lv[b]})`;
  }
  if (t.eff === 'gold') { const base = (5 + 10 * S.lv.rathaus) * bonusOf(S, 'gold'); return `+${pct} % Steuergold aus dem Rathaus: <b>${fmtN(base * (1 + x))}/h</b> statt ${fmtN(base)}/h (bei Rathaus ${S.lv.rathaus})`; }
  if (t.eff === 'force') return `+${pct} % Angriff und +${pct} % Verteidigung für alle deine Truppen, in jedem Kampf (Burg, Außenposten, Felder, Lager)`;
  if (t.eff === 'speed') return `+${pct} % Marschtempo: Märsche und Sammelwege dauern <b>${Math.round((1 - 1 / (1 + x)) * 100)} % kürzer</b>`;
  if (t.eff === 'carry') { const base = Math.floor(Object.keys(S.troops).reduce((a, u) => a + (S.troops[u] || 0) * U[u].c, 0)); return `+${pct} % Traglast: Beute und Sammelmenge pro Marsch steigen, deine Truppen daheim tragen <b>${fmtN(Math.floor(base * (1 + x)))}</b> statt ${fmtN(base)}`; }
  return '';
}
function techCardHTML(id) {
  const t = T[id], L = techLv(S, id), run = S.research && S.research.id === id, next = L + 1, why = L >= T_MAX || run ? '' : techBlocker(S, id);
  const pips = `<span class="pips">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= L ? 'on' : ''}"></i>`).join('')}</span>`;
  let act;
  if (run) act = `<div class="bprog"><div class="prog"><i data-rprog="1" style="width:${Math.max(0, 1 - S.research.left / S.research.total) * 100}%"></i></div><span class="time" data-rtime="1">${fmtT(real(S.research.left))}</span><button class="spd" type="button" data-speed="research:1" aria-label="Beschleunigen">⚡</button></div>`;
  else if (L >= T_MAX) act = '<span class="note">Höchststufe erreicht</span>';
  else act = `<div class="costs">${costHTML(techCost(id, next))}</div><div class="row"><button class="btn" type="button" data-act="techGo" data-id="${id}" ${why ? 'disabled' : ''}>Stufe ${next} erforschen</button><button class="btn ghost" type="button" data-act="techGoSp" data-id="${id}" ${why ? 'disabled' : ''}>⚡ + Speedups</button><span class="${why ? 'why' : 'note'}">${why || 'Dauer ' + fmtT(real(techTime(id, next))) + ' · Akademie ' + techReq(next)}</span></div>`;
  const rows = [1, 2, 3, 4, 5].map(l => `<div class="tlv ${l === L ? 'cur' : ''}"><b>Stufe ${l}${l <= L ? ' ✓' : ''}</b><div class="note">${techEffect(id, l)}</div><div class="tmeta"><span class="costs sm">${costHTML(techCost(id, l))}</span><span class="note">Dauer ${fmtT(real(techTime(id, l)))} · Akademie ${techReq(l)}</span></div></div>`).join('');
  return `<div class="ucard tcard"><div class="uhead"><div><b>${t.name}</b> ${pips}</div><span class="utime">Stufe ${L} von ${T_MAX}</span></div>
    <p class="note" style="margin:4px 0">${L ? 'Jetzt: ' + techEffect(id, L) : 'Noch nicht erforscht.'}</p>
    ${L < T_MAX ? `<p class="note" style="margin:4px 0">Nächste Stufe: ${techEffect(id, next)}</p>` : ''}
    ${act}
    <details class="tdet"><summary>Alle Stufen</summary>${rows}</details></div>`;
}
let techSel = '';
const TN = { w: 148, h: 58, gx: 34, gy: 18, pad: 10 };
function techTreeHTML() {
  const ids = Object.keys(T), px = id => TN.pad + T[id].col * (TN.w + TN.gx), py = id => TN.pad + T[id].row * (TN.h + TN.gy);
  const W = TN.pad * 2 + (Math.max(...ids.map(i => T[i].col)) + 1) * (TN.w + TN.gx) - TN.gx, H = TN.pad * 2 + (Math.max(...ids.map(i => T[i].row)) + 1) * (TN.h + TN.gy) - TN.gy;
  const lines = ids.filter(i => T[i].pre).map(i => {
    const p = T[i].pre, x1 = px(p) + TN.w, y1 = py(p) + TN.h / 2, x2 = px(i), y2 = py(i) + TN.h / 2, mx = (x1 + x2) / 2, on = techLv(S, p) >= T_PRE_LV;
    return `<path class="tl ${on ? 'on' : ''}" d="M${x1} ${y1} H${mx} V${y2} H${x2}"/>`;
  }).join('');
  const nodes = ids.map(id => {
    const t = T[id], L = techLv(S, id), run = S.research && S.research.id === id, locked = t.pre && techLv(S, t.pre) < T_PRE_LV, max = L >= T_MAX;
    return `<button type="button" class="tn ${id === techSel ? 'sel' : ''} ${run ? 'run' : ''} ${locked ? 'lock' : ''} ${max ? 'max' : ''}" data-act="techSel" data-id="${id}" style="left:${px(id)}px;top:${py(id)}px;width:${TN.w}px;height:${TN.h}px">
      <span class="tni">${bico(t.icon)}</span><span class="tnt"><b>${t.name}</b><span class="tnb"><i style="width:${L / T_MAX * 100}%"></i></span><small ${run ? 'data-rtime="1"' : ''}>${locked ? '🔒 ' + T[t.pre].name : run ? '⏳ ' + fmtT(real(S.research.left)) : L + ' / ' + T_MAX}</small></span></button>`;
  }).join('');
  return `<div class="tree"><div class="treein" style="width:${W}px;height:${H}px"><svg width="${W}" height="${H}">${lines}</svg>${nodes}</div></div>`;
}
function techPopHTML(id) {
  const t = T[id], L = techLv(S, id), run = S.research && S.research.id === id, next = L + 1, why = L >= T_MAX || run ? '' : techBlocker(S, id), now = Math.round(techBonus(id, L) * 100), nx = Math.round(techBonus(id, Math.min(T_MAX, next)) * 100);
  let act;
  if (run) act = `<div class="prog"><i data-rprog="1" style="width:${Math.max(0, 1 - S.research.left / S.research.total) * 100}%"></i></div><div class="row"><span class="time" data-rtime="1">${fmtT(real(S.research.left))}</span><button class="btn small" type="button" data-speed="research:1">⚡ Beschleunigen</button></div>`;
  else if (L >= T_MAX) act = '<p class="note">Höchststufe erreicht ✓</p>';
  else act = `<div class="costs">${costHTML(techCost(id, next))}</div><p class="note">Dauer ${fmtT(real(techTimeFor(S, id, next)))} · braucht Akademie ${techReq(next)}</p><button class="btn" type="button" data-act="techGo" data-id="${id}" ${why ? 'disabled' : ''}>Stufe ${next} erforschen</button><button class="btn ghost" type="button" data-act="techGoSp" data-id="${id}" ${why ? 'disabled' : ''}>⚡ + Speedups</button>${why ? `<p class="why">${why}</p>` : ''}`;
  return `<div class="tpop" data-act="techClose"><div class="tpin"><div class="uhead"><div><b>${t.name}</b> <span class="pips">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= L ? 'on' : ''}"></i>`).join('')}</span></div><button class="pback" type="button" data-act="techClose">✕</button></div>
    <p class="note">${t.desc}</p><p class="tbo"><b>+${now} %</b>${L < T_MAX ? ` → <b>+${nx} %</b> ${t.unit}` : ' ' + t.unit}</p>${act}</div></div>`;
}
function techHTML() {
  const A = S.lv.akademie, r = S.research;
  const run = r ? `<div class="trun"><span class="tni">${bico(T[r.id].icon)}</span><div class="trb"><div class="trt"><b>${T[r.id].name} → Stufe ${r.target}</b><span class="time" data-rtime="1">${fmtT(real(r.left))}</span></div><div class="prog"><i data-rprog="1" style="width:${Math.max(0, 1 - r.left / r.total) * 100}%"></i></div></div><button class="btn small" type="button" data-speed="research:1">⚡</button></div>` : '';
  const note = A ? '' : `<div class="note-box">Die Akademie ist noch nicht gebaut${S.lv.rathaus >= B.akademie.unlock ? '.' : ' (ab Rathaus Stufe ' + B.akademie.unlock + ').'}</div>`;
  return phead('🎓', 'Akademie', A ? 'Stufe ' + A + ' · Techtree' : 'Noch nicht gebaut', `<button class="bagbtn small" type="button" data-bag="1" aria-label="Speedups">⚡<b>${SPEED_IDS.reduce((a, i) => a + itemN(i), 0)}</b></button>`) + note + run + techTreeHTML() + (techSel && T[techSel] ? techPopHTML(techSel) : '');
}

/* ---------- Panels (Bündnis, Mehr) ---------- */
let panelName = '', panelSig = '';
function panelSignature() {
  if (panelName === 'tech') return JSON.stringify([S.items, techSel, S.lv, S.tech, S.research && S.research.id + S.research.target, RES.map(r => Math.floor(S.res[r] / 50)), Object.keys(T).map(id => techBlocker(S, id)), S.troops]);
  if (panelName === 'train') return JSON.stringify([trainTab, S.lv, S.troops, pick, Object.fromEntries(Object.entries(S.train).map(([k, l]) => [k, l.map(o => o.unit + o.count)])), U && Object.keys(U).map(u => afford(S, U[u].cost.map(c => c * (pick[u] || 10))))]);
  if (panelName === 'units') return JSON.stringify([S.troops, S.away, S.wounded, S.train, S.lv]);
  if (panelName === 'heroes') return JSON.stringify([S.heroes, S.defHero, S.defDeputy, heroSel, ownMarches().map(m => m.hero)]);
  if (panelName === 'ally') return JSON.stringify([allyTab, allyTab === 'shop' ? [Math.floor(S.res.gold / 10), S.items, S.tpAt, S.startTp] : 0, view.world.outposts, Math.floor(gtNow() / 300), view.ally, view.invites, view.requests, match.alliances, match.players.map(p => p.id + ':' + p.ally + p.out + p.vassalOf), S.stationed, view.myStations, match.cap, S.lv.rathaus, armedKey]);
  return JSON.stringify([moreSub, moreSub === 'daily' ? [S.daily, S.packs && S.packs.length, Math.floor(serverNow() / 30000)] : 0, view.world.outposts, match.phase, match.ranking, (match.chron || []).length, S.feed.length, S.feedSeen, S.lv, S.reports.length, view.ally && view.ally.store, Math.floor(S.res.gold / 10), S.items, S.tpAt, !!view.ally, (match.holds || []).map(h => h.id + h.label), pushOn, pushMsg, S.stats]);
}
/* ---------- Helden ---------- */
const FX_GLYPH = { shield: '🛡', wind: '💨', leaf: '🍃', grain: '🌾', chips: '🪵', sparks: '✨', dust: '💨', ward: '✦', glow: '✦', shadow: '✦', flame: '🔥', gust: '🌀' };
const hpic = (id, H) => HERO_PIC[id] ? `<img class="himg" src="${HERO_PIC[id]}" alt="" draggable="false">` : H.pic;
const alaricIco = () => HERO_PIC.aldric ? `<img class="navhero" src="${HERO_PIC.aldric}" alt="" draggable="false">` : '🦸';
{ const ni = document.querySelector('[data-nav=heroes] i'); if (ni) ni.innerHTML = alaricIco(); }
const heroPortrait = (id, cls = '') => { const H = HEROES[id]; return `<div class="hport ${cls} fx-${H.fx}" style="--hc:${H.col}"><span class="haura"></span><span class="hface${HERO_PIC[id] ? ' img' : ''}">${hpic(id, H)}</span><span class="hweap">${H.icon}</span><i></i><i></i><i></i><i></i></div>`; };
const keeperNow = () => [S.defHero, S.defDeputy].find(id => id && HEROES[id] && !busyHero(id)) || '';
const SK_ICO = { gather: '🧺', carry: '🛒', atkInf: '🛡️', atkCav: '🐎', atkRng: '🏹', force: '⚔️', garrison: '🏰', camp: '🗡️', assault: '🔥', speed: '💨' };
const pct = v => (Math.round(v * 1000) / 10).toString().replace('.', ',') + ' %';
const PREF_NAME = { inf: 'Infanterie', kav: 'Kavallerie', art: 'Fernkampf', trans: 'Handkarren' };
let dockX = -1;
// Heldenkraft: Stufe und Fähigkeiten in einer Zahl (nur zur Anzeige)
const heroPowerOf = id => Math.round(1000 + heroLvl(id) * 90 + skillList(S, id).reduce((a, k) => a + k.val, 0) * 6000);
function heroStageHTML(id) {
  const H = HEROES[id], lv = heroLvl(id), xp = (S.heroes[id] || {}).xp || 0, need = xpNeed(lv), sk = skillList(S, id), k = keeperNow();
  const st = busyHero(id) ? ['🚩', 'führt ein Heer an'] : id === k ? ['🏰', 'bewacht die Burg'] : id === S.defHero ? ['🏰', 'Wächter, gerade unterwegs'] : id === S.defDeputy ? ['🛡', 'Stellvertreter'] : ['✔', 'bereit in der Burg'];
  const pr = heroPrefers(id).map(x => PREF_NAME[x]).filter(Boolean);
  const how = H.role === 'gather' ? 'Lernt beim <b>Sammeln</b> auf Feldern (1 Erfahrung je 4 Rohstoffe).' : 'Lernt im <b>Kampf</b>: Lager, Räuber, Spieler, Außenposten. Zu schwache Ziele geben kaum Erfahrung.';
  const nxt = lv >= HERO_MAX ? '' : sk.map(x => `<span>+${pct(x.max * .75 / (HERO_MAX - 1))} ${x.name}</span>`).join('');
  return `<div class="hscene fx-${H.fx}" style="--hc:${H.col}" key="${id}">
      <img class="hart" src="${HERO_ART[id] || HERO_PIC[id] || ''}" alt="" draggable="false"${HERO_POS[id] ? ' style="object-position:' + HERO_POS[id] + '"' : ''}><span class="hglow"></span>
      <i></i><i></i><i></i><i></i><i></i><i></i>
      <div class="hover"><div class="htags"><span>${H.role === 'gather' ? 'Sammler' : 'Kämpfer'}</span>${sk.map(x => `<span><i class="tki">${SK_ICO[x.k] || ''}</i><em>${x.name}</em></span>`).join('')}</div>
        <h2>${H.name}</h2><div class="hsub">${H.title}</div></div>
    </div>
    <div class="hbody" style="--hc:${H.col}">
      <div class="hlvrow"><span class="hlvb"><small>Stufe</small><b>${lv}</b></span><div class="hxp"><div class="hxbar"><i style="width:${lv >= HERO_MAX ? 100 : Math.min(100, Math.round(xp / need * 100))}%"></i></div>
        <small>${lv >= HERO_MAX ? 'Höchststufe erreicht' : fmtN(xp) + ' / ' + fmtN(need) + ' Erfahrung bis Stufe ' + (lv + 1)}</small></div>
        <span class="hpow"><small>Heldenkraft</small><b>${fmtN(heroPowerOf(id))}</b></span></div>
      <p class="hstoryq">„${H.story}“</p>
      <div class="hsecs">Fähigkeiten</div>
      ${sk.map(x => `<div class="hskill"><span class="hsi">${SK_ICO[x.k] || '✦'}</span><div class="hsm"><b>${x.name}</b><small>${x.text}</small><div class="hsbar"><i style="width:${Math.round(x.val / x.top * 100)}%"></i></div></div><div class="hsv2"><b>+${pct(x.val)}</b><small>Stufe ${HERO_MAX}: +${pct(x.top)}</small></div></div>`).join('')}
      ${nxt ? `<div class="hnext"><small>Mit jeder Stufe</small>${nxt}</div>` : ''}
      <div class="hsecs">Einsatz</div>
      <div class="hinfo2"><div><small>Zustand</small><b>${st[0]} ${st[1]}</b></div><div><small>Bevorzugte Truppen</small><b>${pr.length ? pr.join(', ') : 'keine'}</b></div></div>
      <p class="hhow">${how}</p>
      <div class="hsecs">Burgverteidigung</div>
      <p class="hhow">Der Wächter verstärkt die Verteidigung der Burg, solange er nicht unterwegs ist; dann springt der Stellvertreter ein.${H.keeper ? ' <b>' + H.name + ' ist dafür besonders geeignet.</b>' : ''}</p>
      <div class="hbtns"><button type="button" data-act="keeperSet" data-id="${id}" data-r="main" ${S.defHero === id ? 'disabled' : ''}>🏰 Zum Wächter</button><button type="button" data-act="keeperSet" data-id="${id}" data-r="dep" ${S.defDeputy === id ? 'disabled' : ''}>🛡 Zum Stellvertreter</button></div>
    </div>`;
}
function heroesHTML() {
  const sel = HERO_IDS.includes(heroSel) ? heroSel : (keeperNow() || HERO_IDS[0]), k = keeperNow();
  const dock = HERO_IDS.map(id => { const H = HEROES[id], mk = busyHero(id) ? '🚩' : id === k ? '🏰' : id === S.defDeputy ? '🛡' : '';
    return `<button type="button" class="hdk${id === sel ? ' on' : ''} fx-${H.fx}" data-act="heroOpen" data-id="${id}" style="--hc:${H.col}" aria-label="${H.name}"><span class="hdp">${hpic(id, H)}</span><b class="hdl">${heroLvl(id)}</b>${mk ? `<em>${mk}</em>` : ''}<small>${H.name}</small></button>`; }).join('');
  return `<div class="hstage" data-sel="${sel}">${heroStageHTML(sel)}<div class="hdock" id="hdock"><div class="hdrow">${dock}</div></div></div>`;
}
function renderPanel(force) {
  if (!panelName || !view) return;
  const sig = panelSignature(); if (!force && sig === panelSig) return; panelSig = sig;
  const el = $('sidePanelInner'), keep = {};
  el.querySelectorAll('input,select').forEach(i => { if (i.id) keep[i.id] = [i.value, document.activeElement === i]; });
  const top = $('sidePanel').scrollTop, box = $('chatBox'), atEnd = !box || box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  el.innerHTML = panelName === 'ally' ? allyHTML() : panelName === 'train' ? trainHTML() : panelName === 'tech' ? techHTML() : panelName === 'units' ? phead('🪖', 'Einheiten', 'Deine Truppen im Überblick') + unitOverviewHTML() : panelName === 'heroes' ? heroesHTML() : moreHTML();
  { const dk = $('hdock'); if (dk) { const centre = () => { const on = dk.querySelector('.on'); if (on) { dk.scrollLeft = on.offsetLeft - dk.clientWidth / 2 + on.offsetWidth / 2; dockX = dk.scrollLeft; } }; if (dockX < 0) { centre(); requestAnimationFrame(centre); } else dk.scrollLeft = dockX; } }
  for (const id in keep) { const i = document.getElementById(id); if (i) { i.value = keep[id][0]; if (keep[id][1]) i.focus(); } }
  const nb = $('chatBox'); if (nb) nb.scrollTop = atEnd ? nb.scrollHeight : nb.scrollTop;
  $('sidePanel').scrollTop = top;
  fitTree();
}
function fitTree() {}
window.addEventListener('resize', () => { if (panelName === 'tech') fitTree(); });
function openPanel(name) {
  if (name === 'heroes') { heroSel = ''; dockX = -1; }
  if (!$('reports').hidden) closeReports();
  closeSheet(); panelName = name; panelSig = ''; if (name === 'more') { moreSub = ''; moreFrom = ''; } if (name === 'ally') allyTab = ''; renderPanel(true); $('sidePanel').hidden = false; document.body.classList.add('reports-open'); setNav(name);
  if (name === 'tech') { fitTree(); requestAnimationFrame(fitTree); }
  if (name === 'more') {
    pushStatus().then(() => renderPanel(true));
  }
}
function closePanel() { panelName = ''; $('sidePanel').hidden = true; document.body.classList.remove('reports-open'); setNav(mode); }
function setupPanel() {
  $('sidePanelInner').addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, d = el.dataset, val = id => (document.getElementById(id) || {}).value || '';
    const go = () => { $('sidePanel').scrollTop = 0; renderPanel(true); };
    if (act === 'ttab') { trainTab = d.t; return go(); }
    if (act === 'techSel') { techSel = d.id; return renderPanel(true); }
    if (act === 'techClose') { if (el.classList.contains('tpop') && e.target !== el) return; techSel = ''; return renderPanel(true); }
    if (act === 'techGoSp') { techSel = ''; renderPanel(true); const ok = await command({ type: 'research', tech: d.id }); if (ok) openSpeed('research', '1'); return; }
    if (act === 'techGo') { techSel = ''; renderPanel(true); return void command({ type: 'research', tech: d.id }); }
    if (act === 'toCityB') { closePanel(); await setMode('city'); return void openSheet(d.b); }
    if (act === 'train') return void command({ type: 'train', id: d.b, unit: d.u, count: pick[d.u] || 10 });
    if (act === 'max') { pick[d.u] = maxTrain(d.u); return renderPanel(true); }
    if (act === 'plus' || act === 'minus') { const n = pick[d.u] || 10, step = n >= 100 ? 50 : n >= 20 ? 10 : 5; pick[d.u] = Math.max(1, Math.min(MAX_TRAIN_COUNT, act === 'plus' ? n + step : n - step)); return renderPanel(true); }
    if (act === 'atab') { allyTab = d.t; return go(); }
    if (act === 'devUnlock') { if (val('devPw') === 'Bailey') { devOk = true; try { sessionStorage.setItem('zk-dev', '1'); } catch {} return go(); } const mm = $('devMsg'); if (mm) mm.textContent = 'Falsches Passwort.'; return; }
    if (act === 'devTools') { closePanel(); const on = !document.body.classList.contains('dev-tools'); document.body.classList.toggle('dev-tools', on); const bx = document.getElementById('zkToolsBox'); if (on && bx && bx.hidden) document.getElementById('zkToolsBtn').click(); return; }
    if (act === 'devAdmin') { closePanel(); document.getElementById('swap').click(); return; }
    if (act === 'sub' && d.t === 'reports') return openReports();
    if (act === 'sub') { moreFrom = ''; moreSub = d.t; if (d.t === 'feed' && unreadFeed()) api('/api/cmd', { type: 'readFeed' }).then(r => { if (r.ok) { S.feedSeen = S.feed.length ? S.feed[0].id : 0; renderNav(); } }); return go(); }
    if (act === 'heroOpen') { heroSel = d.id; return go(); }
    if (act === 'keeperSet') {
      let a = S.defHero, b = S.defDeputy; if (d.r === 'main') { a = d.id; if (b === d.id) b = ''; } else { b = d.id; if (a === d.id) a = ''; }
      const ok = await command({ type: 'setKeeper', hero: a, deputy: b }); if (ok) toast(HEROES[d.id].name + (d.r === 'main' ? ' bewacht jetzt die Burg.' : ' ist jetzt Stellvertreter.'), 'info'); return renderPanel(true);
    }
    if (act === 'back') { moreSub = ''; if (moreFrom) { moreFrom = ''; return closePanel(); } return go(); }
    if (act === 'claimDaily') { const ok = await command({ type: 'claimDaily' }); if (ok) toast('3 Stunden Speedups erhalten!', 'info'); return renderPanel(true); }
    if (act === 'openPack') {
      const pk = (S.packs || []).find(x => x.id === Number(d.pid)), room = cap(S);
      const lost = pk ? RES.map(r => [r, Math.max(0, S.res[r] + pk.res[r] - room)]).filter(x => x[1] > 0) : [];
      if (lost.length && !d.sure) {   // Hinweis vor dem Einlösen: ein Teil würde verfallen
        const nm = { food: 'Nahrung', wood: 'Holz', stone: 'Stein', ore: 'Erz' };
        $('modalIn').innerHTML = `<h2>Lager würde überlaufen</h2><p class="desc">Dein Lager fasst ${fmtN(room)} je Rohstoff. Wenn du „${esc(pk.name)}“ jetzt einlöst, verfällt ein Teil:</p><div class="block">${lost.map(([r, n]) => `<div class="mrow"><span>${nm[r] || r}</span><b>${fmtN(n)} verfallen</b></div>`).join('')}</div><p class="note">Tipp: Erst Rohstoffe ausgeben (bauen, ausbilden, forschen) und das Paket danach einlösen.</p><div class="row" style="margin-top:12px"><button class="btn ghost" type="button" id="packNo">Abbrechen</button><button class="btn" type="button" id="packYes">Trotzdem einlösen</button></div>`;
        $('modal').hidden = false; $('packNo').onclick = () => { $('modal').hidden = true; };
        $('packYes').onclick = async () => { $('modal').hidden = true; const ok2 = await command({ type: 'openPack', pid: pk.id }); if (ok2) toast('Ressourcenpaket eingelöst.', 'info'); renderPanel(true); };
        return;
      }
      const ok = await command({ type: 'openPack', pid: Number(d.pid) }); if (ok) toast('Ressourcenpaket eingelöst.', 'info'); return renderPanel(true); }
    if (act === 'donate') { const amounts = {}; for (const r of RES) { const v = Math.floor(Number(val('dn_' + r)) || 0); if (v > 0) amounts[r] = v; } if (!Object.keys(amounts).length) return void toast('Gib an, wie viel du einzahlen willst.'); return void command({ type: 'donate', amounts }).then(ok => { if (ok) { for (const r of RES) { const i = document.getElementById('dn_' + r); if (i) i.value = ''; } toast('Eingezahlt. Danke!', 'info'); } }); }
    if (act === 'shopBuy') return void command({ type: 'buy', item: d.i, n: 1 }).then(ok => ok && toast(ITEMS[d.i].name + ' gekauft.', 'info'));
    if (act === 'opGoto') { closePanel(); await setMode('map'); if (mode === 'map') selectMap({ type: 'op', id: d.id }, false); return; }
    if (act === 'allyCreate') return void command({ type: 'allyCreate', name: val('alName'), tag: val('alTag') });
    if (act === 'allyRequest') return void command({ type: 'allyRequest', al: Number(d.al) });
    if (act === 'allyAnswer') return void command({ type: 'allyAnswer', id: Number(d.id), accept: !!d.yes });
    if (act === 'allyInvite') { const n = val('alInv'); if (n) command({ type: 'allyInvite', name: n }).then(ok => ok && toast('Einladung verschickt.', 'info')); return; }
    if (act === 'allyColor') return void command({ type: 'allyColor', color: d.c });
    if (act === 'allyKick') { if (!twice('kick' + d.pid)) return renderPanel(true); return void command({ type: 'allyKick', pid: Number(d.pid) }); }
    if (act === 'allyLead') { if (!twice('lead' + d.pid)) return renderPanel(true); return void command({ type: 'allyLead', pid: Number(d.pid) }); }
    if (act === 'allyLeave') { if (!twice('leave')) return renderPanel(true); return void command({ type: 'allyLeave' }); }
    if (act === 'allyAnnounce') { const t = val('alMsg').trim(); if (!t) return; const ok = await command({ type: 'allyAnnounce', text: t }); if (ok) renderPanel(true); return; }
    if (act === 'allyChat') { const t = val('alMsg').trim(); if (!t) return; const ok = await command({ type: 'allyChat', text: t }); if (ok) { const i = document.getElementById('alMsg'); if (i) { i.value = ''; i.focus(); } } return; }
    if (act === 'stationRecall') return void command({ type: 'stationRecall', host: Number(d.pid) });
    if (act === 'stationDismiss') return void command({ type: 'stationDismiss', owner: Number(d.pid) });
    if (act === 'pushOn') return void enablePush();
    if (act === 'pushOff') return void disablePush();
    if (act === 'showEnd') return void showEnd(true);
    if (act === 'logout') { await api('/api/logout', {}); location.href = '/'; return; }
    if (act === 'pwChange') {
      const r = await api('/api/password', { old: val('pwOld'), password: val('pwNew') }), m = document.getElementById('pwMsg');
      if (m) m.textContent = r.ok ? 'Passwort geändert.' : (r.data.error || 'Fehler');
      if (r.ok) { document.getElementById('pwOld').value = ''; document.getElementById('pwNew').value = ''; }
    }
  });
  $('sidePanelInner').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'alMsg') { e.preventDefault(); const bt = $('sidePanelInner').querySelector('[data-act=allyAnnounce],[data-act=allyChat]'); if (bt) bt.click(); } });
}



/* ---------- Außenposten platzieren: Karte verschieben, bis das Viereck passt ---------- */
let placing = false, placeKey = '', placeWhy = '';
function placeTile() {
  return wm.tileAtScreen(window.innerWidth / 2, window.innerHeight * .42);
}
// Welche Rohstoffpunkte liegen im Viereck (nur Erkundetes)?
function placeInfo(t) {
  const cnt = { farm: 0, wood: 0, stone: 0, sanct: 0, throne: 0 }, lv = { farm: 0, wood: 0, stone: 0 };
  for (const o of wm.map.objects) {
    if (!(o.k in cnt) || Math.abs(o.x - t.x) > OP_R || Math.abs(o.y - t.y) > OP_R || !wm.exploredBit(o.x, o.y)) continue;
    cnt[o.k]++; if (o.k in lv) lv[o.k] += o.lv;
  }
  const chip = (ico, name, k) => `<span class="${cnt[k] ? '' : 'z'}" title="${name}: ${cnt[k]}${cnt[k] ? ' (Stufe ' + lv[k] + ' gesamt)' : ''}">${ico} ${cnt[k]}</span>`;
  $('placeInfo').innerHTML = chip('🌾', 'Nahrung', 'farm') + chip('🪵', 'Holz', 'wood') + chip('🪨', 'Stein', 'stone')
    + (cnt.sanct ? `<span title="Heiligtum">✨ ${cnt.sanct}</span>` : '') + (cnt.throne ? '<span title="Thron">👑</span>' : '');
}
// Pfeil am Bildschirmrand, wenn die eigene Burg nicht im Blick ist
function homeStep() {
  let el = $('homeArrow');
  if (!el) { el = document.createElement('button'); el.id = 'homeArrow'; el.hidden = true; el.innerHTML = '<span class="ha-ico">🏰</span><i class="ha-tip"></i>'; document.body.appendChild(el); el.onclick = () => { if (S && S.pos) wm.panTo(S.pos[0] + .5, S.pos[1] + .5); }; }
  if (mode !== 'map' || !S || S.slot < 0 || S.out || !S.pos || panelName || !wm.screenOf) { el.hidden = true; return; }
  const p = wm.screenOf(S.pos[0] + .5, wm.yAt ? Math.max(0, wm.yAt(S.pos[0] + .5, S.pos[1] + .5)) : 0, S.pos[1] + .5), W = wm.W, H = wm.H, m = 36;
  const behind = p.z > 1;
  if (!behind && p.x > 0 && p.x < W && p.y > 0 && p.y < H) { el.hidden = true; return; }
  const cx = W / 2, cy = H / 2; let dx = p.x - cx, dy = p.y - cy; if (behind) { dx = -dx; dy = -dy; }
  const k = Math.min((W / 2 - m) / Math.abs(dx || 1e-6), (H / 2 - m - 70) / Math.abs(dy || 1e-6));
  el.hidden = false; el.style.left = (cx + dx * k) + 'px'; el.style.top = (cy + dy * k) + 'px';
  el.querySelector('.ha-tip').style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
}
function placeStep() {
  const show = mode === 'map' && view && (view.ally || S.startTp > 0) && !msel && view.match.phase === 'running' && !panelName && $('reports').hidden;
  $('placeBtn').hidden = !show || !!placing || !view.ally; $('tpBtn').hidden = !show || !!placing || (!(S.startTp > 0) && itemN('teleport') <= 0);
  $('placeBar').hidden = !(show && placing); $('placeInfo').hidden = !(show && placing === 'build');
  if (!placing || !show) { if (placing && !show) placing = false; return; }
  const t = placeTile(), key = placing + t.x + ',' + t.y + ',' + Math.floor(gtNow() / 60) + itemN('teleport') + 's' + (S.startTp || 0);
  if (key === placeKey) return; placeKey = key;
  const { mt, pls } = siteCtx(), el = $('placeTxt');
  $('placeGo').hidden = placing !== 'build'; $('placeTp').hidden = placing !== 'tp';
  if (placing === 'tp') {
    const why = checkTeleport(mt, pls, { id: me.id, state: { lv: { rathaus: S.lv.rathaus }, startTp: S.startTp } }, t.x, t.y, gtNow()), free = S.startTp > 0, cd = free ? 0 : TELEPORT_COOLDOWN - (gtNow() - S.tpAt), has = free || itemN('teleport') > 0;
    const r = cityR(S.lv.rathaus); wm.setPreview({ x: t.x, y: t.y, r, ok: !why, ghost: true });
    const msg = !has ? 'Du hast keinen Teleporter (Mehr → Shop).' : cd > 0 ? 'Der Teleporter lädt noch ' + fmtT(real(cd)) + '.' : why;
    el.className = 'pl-txt ' + (msg ? 'bad' : 'ok'); el.textContent = msg || (free ? 'Start-Teleporter (einmalig, überallhin): ' : '') + 'Deine Burg zieht hierher um (' + t.x + ' | ' + t.y + '). Verschiebe die Karte, bis der Ort stimmt.';
    $('placeTp').disabled = !!msg; return;
  }
  placeInfo(t);
  placeWhy = checkSite(mt, pls, { id: me.id }, t.x, t.y, gtNow());
  wm.setPreview({ x: t.x, y: t.y, r: OP_R, ok: !placeWhy });
  el.className = 'pl-txt ' + (placeWhy ? 'bad' : 'ok');
  el.textContent = placeWhy || 'Hier passt der Außenposten (' + t.x + ' | ' + t.y + '). Verschiebe die Karte, bis der Ort stimmt.';
  const poor = OP_COST.some((c, i) => view.ally.store[RES[i]] < c);
  $('placeGo').disabled = !!placeWhy || poor;
  if (!placeWhy && poor) { el.className = 'pl-txt bad'; el.textContent = 'Der Platz passt, aber im Bündnislager fehlen Rohstoffe (Bündnis → Revier & Lager).'; }
}
function setupPlace() {
  $('placeBtn').onclick = () => { placing = 'build'; placeKey = ''; placeStep(); };
  $('tpBtn').onclick = () => { placing = 'tp'; placeKey = ''; placeStep(); };
  $('placeCancel').onclick = () => { placing = false; wm.setPreview(null); placeStep(); };
  $('placeTp').onclick = () => { const t = placeTile(), from = [...S.pos]; command({ type: 'teleport', x: t.x, y: t.y }).then(ok => { if (ok) { placing = false; wm.setPreview(null); wm.teleportFx(from, [t.x, t.y]); placeStep(); } }); };
  $('placeGo').onclick = () => { const t = placeTile(); selectMap({ type: 'site', x: t.x, y: t.y }, false); placeStep(); };
}

/* ---------- Shop, Beutel, Beschleuniger ---------- */
let speedCtx = null;
const itemN = id => (S.items || {})[id] || 0;
function speedTarget(kind, ref) {
  if (kind === 'build') { const q = inQueue(S, ref); return q ? { name: B[ref].name + ' → Stufe ' + q.target, left: q.left } : null; }
  if (kind === 'research') return S.research ? { name: T[S.research.id].name + ' → Stufe ' + S.research.target, left: S.research.left } : null;
  const l = S.train[ref]; return l && l.length ? { name: B[ref].name + ': ' + l.reduce((a, o) => a + o.count, 0) + ' Einheiten', left: l.reduce((a, o, i) => a + o.left + (o.count - 1) * o.per, 0) } : null;
}
const findsLine = () => 'Speedups findet dein Heer beim Ressourcensammeln: je Stunde Sammeln im Schnitt ' + SPEED_IDS.map(id => FINDS[id] + '× ' + ITEMS[id].name.replace('Beschleuniger ', '')).join(', ') + ' – man kann sie nicht kaufen.';
const bagList = () => SPEED_IDS.map(id => { const it = ITEMS[id]; return `<div class="mrow shopi"><span class="tico">${it.icon}</span><div><b>${it.name}</b></div><b class="spn">${itemN(id)}×</b></div>`; }).join('');
const bagTotal = () => SPEED_IDS.reduce((a, i) => a + itemN(i) * ITEMS[i].sec, 0);
function speedHTML() {
  if (speedCtx.kind === 'bag') return `<h2>⚡ Deine Speedups</h2>${bagList()}<p class="note">Zusammen: <b>${bagTotal() ? fmtT(real(bagTotal())) : '0'}</b> Zeitersparnis. Benutzen kannst du sie mit dem ⚡ bei einem Bau, einer Ausbildung oder einer Forschung.</p><p class="note">${findsLine()}</p><div class="row"><button class="btn ghost" type="button" data-act="mClose">Schließen</button></div>`;
  const t = speedTarget(speedCtx.kind, speedCtx.ref);
  if (!t) return `<h2>⚡ Beschleunigen</h2><p class="note">Dieser Auftrag ist fertig.</p><div class="row"><button class="btn" type="button" data-act="mClose">Schließen</button></div>`;
  const w = speedCtx.warn, nm = u => Object.keys(u).map(id => u[id] + '× ' + ITEMS[id].name.replace('Beschleuniger ', '')).join(', ');
  let warn = '';
  if (w) warn = w.short > 0
    ? `<div class="note-box">Alle deine Speedups (${fmtT(real(w.sum))}) reichen nicht ganz: Es bleiben noch ${fmtT(real(w.short))}.<div class="row" style="margin-top:6px"><button class="btn small" type="button" data-act="mAutoGo">Alle einsetzen</button><button class="btn ghost small" type="button" data-act="mAutoNo">Abbrechen</button></div></div>`
    : `<div class="note-box why">Kein passender Speedup: Der beste (${nm(w.use)}) spart ${fmtT(real(w.sum))}, davon sind <b>${fmtT(real(w.over))}</b> zu viel. Diese Zeit würde verschwendet.<div class="row" style="margin-top:6px"><button class="btn small" type="button" data-act="mAutoGo">Trotzdem nehmen</button><button class="btn ghost small" type="button" data-act="mAutoNo">Abbrechen</button></div></div>`;
  return `<h2>⚡ Beschleunigen</h2><p class="desc"><b>${esc(t.name)}</b><br>Noch ${fmtT(real(t.left))}</p>
    <button class="btn" type="button" data-act="mAuto" ${bagTotal() ? '' : 'disabled'}>✨ Automatisch anpassen</button>
    <p class="note">Wählt Speedups, die zur Restzeit passen (höchstens ${Math.round(SPEED_SLACK / 60)} Min. überstehend).</p>${warn}
    ${SPEED_IDS.map(id => { const it = ITEMS[id], n = itemN(id); return `<div class="mrow"><div><b>${it.icon} ${it.name}</b><div class="note">Im Beutel: ${n}</div></div>
      <div class="row">${n ? `<button class="btn small" type="button" data-act="mUse" data-i="${id}">Benutzen</button>` : '<span class="note">keiner</span>'}</div></div>`; }).join('')}
    <p class="note">${findsLine()}</p>
    <div class="row"><button class="btn ghost" type="button" data-act="mClose">Schließen</button></div>`;
}
function openSpeed(kind, ref) { speedCtx = { kind, ref, warn: null }; $('modalIn').innerHTML = speedHTML(); $('modal').hidden = false; }
function refreshSpeed() { if (!speedCtx || $('modal').hidden) return; $('modalIn').innerHTML = speedHTML(); }
function setupModal() {
  document.addEventListener('click', async e => {
    const sp = e.target.closest('[data-speed]'); if (sp) { const [k, r] = sp.dataset.speed.split(':'); return openSpeed(k, r); }
    if (e.target.closest('[data-bag]')) return openSpeed('bag', '');
    if (e.target.closest('[data-daily]')) { const sub = e.target.closest('[data-daily]').dataset.daily; openPanel('more'); moreSub = sub; moreFrom = mode; return renderPanel(true); }
    const el = e.target.closest('#modalIn [data-act]'); if (!el || !speedCtx) return;
    const act = el.dataset.act, i = el.dataset.i;
    if (act === 'mClose') { $('modal').hidden = true; speedCtx = null; }
    else if (act === 'mAuto' || act === 'mAutoGo') {
      const t = speedTarget(speedCtx.kind, speedCtx.ref); if (!t) return refreshSpeed();
      const plan = act === 'mAutoGo' && speedCtx.warn ? speedCtx.warn : planSpeeds(S.items, t.left);
      if (act === 'mAuto' && !plan.ok) { speedCtx.warn = plan; return refreshSpeed(); }
      if (!Object.keys(plan.use).length) return refreshSpeed();
      const ok = await command({ type: 'useSpeeds', kind: speedCtx.kind, ref: speedCtx.ref, items: plan.use }); speedCtx.warn = null;
      if (ok) { toast('Beschleunigt um ' + fmtT(real(plan.sum)) + '.', 'info'); if (!speedTarget(speedCtx.kind, speedCtx.ref)) { $('modal').hidden = true; speedCtx = null; return; } }
      refreshSpeed();
    }
    else if (act === 'mAutoNo') { speedCtx.warn = null; refreshSpeed(); }
    else if (act === 'mBuy') { await command({ type: 'buy', item: i, n: 1 }); refreshSpeed(); }
    else if (act === 'mUse') { const ok = await command({ type: 'useSpeed', item: i, kind: speedCtx.kind, ref: speedCtx.ref }); if (ok) toast('Beschleunigt um ' + ITEMS[i].name.replace('Beschleuniger ', '') + '.', 'info'); refreshSpeed(); }
  });
}
const dailySub = () => { const d = S.daily; return d ? d.quests.filter(q => q.done).length + ' von ' + d.quests.length + ' erledigt' : 'heute'; };
const packN = () => (S.packs || []).length;
const dailyBadge = () => (dailyDone(S) && !(S.daily || {}).claimed ? 1 : 0);
function dailyHTML() {
  const d = S.daily; if (!d) return '<p class="note">Die Aufgaben für heute werden gerade vorbereitet.</p>';
  const done = d.quests.filter(q => q.done).length, n = d.quests.length, left = secUntilNextDay(serverNow()), all = dailyDone(S);
  const gift = Object.keys(DAILY_SPEED_GIFT).map(id => DAILY_SPEED_GIFT[id] + '× ' + ITEMS[id].name.replace('Beschleuniger ', '')).join(', ');
  const cards = d.quests.map(q => { const I = QUEST_INFO[q.t], pct = Math.round(q.prog / q.target * 100);
    return `<div class="dq${q.done ? ' done' : ''}"><span class="dqi">${I.icon}</span><div class="dqm"><b>${I.title}</b><small>${I.text(fmtN(q.target))}</small>
      <div class="dqb"><i style="width:${pct}%"></i><span>${fmtN(q.prog)}/${fmtN(q.target)}</span></div></div><div class="dqr">${q.done ? '✔' : '🎁'}<small>${q.done ? 'erledigt' : 'Paket'}</small></div></div>`; }).join('');
  return `<div class="dhead"><div><b>Heute erledigt</b><div class="dbig">${done}<small>/${n}</small></div></div><div class="dtime">Neue Aufgaben in<b>${fmtT(left)}</b></div></div>
    <div class="dfin${all ? ' ready' : ''}"><span class="dqi">🏆</span><div class="dqm"><b>Alle Aufgaben geschafft</b><small>Belohnung: 3 Stunden Speedups (${gift}).</small></div>
      ${d.claimed ? '<span class="note">abgeholt ✔</span>' : `<button class="btn small" type="button" data-act="claimDaily" ${all ? '' : 'disabled'}>Abholen</button>`}</div>
    <h3>Aufgaben</h3>${cards}
    <p class="note">Für jede erledigte Aufgabe bekommst du ein Ressourcenpaket. Du findest sie unter „🎁 Ressourcen“ (jetzt ${packN()}).</p>`;
}
function packsHTML() {
  const list = S.packs || [], room = cap(S);
  if (!list.length) return '<p class="note">Du hast keine Ressourcenpakete. Für jede erledigte tägliche Aufgabe bekommst du eines. Der Inhalt richtet sich nach deiner Produktion zum Zeitpunkt der Aufgabe.</p>';
  const ico = { food: '🌾', wood: '🪵', stone: '🪨', gold: '🪙' };
  return '<p class="note">Wähle, welches Paket du einlösen willst. Was nicht ins Lager passt (Grenze ' + fmtN(room) + '), verfällt.</p>' + list.map(pk => {
    const lost = RES.some(r => S.res[r] + pk.res[r] > room);
    return `<div class="dq"><span class="dqi">🎁</span><div class="dqm"><b>${esc(pk.name)}</b><small>${[...RES, 'gold'].map(r => ico[r] + ' ' + fmtN(pk.res[r])).join(' · ')}</small>${lost ? '<small>⚠ Lager würde überlaufen</small>' : ''}</div><button class="btn small" type="button" data-act="openPack" data-pid="${pk.id}">Einlösen</button></div>`; }).join('');
}
function speedupsHTML() {
  return `<p class="note">${findsLine()}</p><div class="block"><h3>Deine Speedups</h3>${bagList()}
    <p class="note">Zusammen: <b>${bagTotal() ? fmtT(real(bagTotal())) : '0'}</b> Zeitersparnis. Benutzen kannst du sie mit dem ⚡ bei einem Bau, einer Ausbildung oder einer Forschung.</p></div>`;
}
function shopHTML() {
  const tp = ITEMS.teleport, cd = Math.max(0, TELEPORT_COOLDOWN - (gtNow() - S.tpAt));
  const card = (id) => { const it = ITEMS[id]; return `<div class="mrow shopi"><span class="tico">${it.icon}</span><div><b>${it.name}</b><div class="note">${it.desc}</div><div class="note">Im Beutel: <b>${itemN(id)}</b></div></div>
    ${it.price ? `<button class="btn small" type="button" data-act="shopBuy" data-i="${id}" ${S.res.gold >= it.price ? '' : 'disabled'}>${it.price} 🪙</button>` : ''}</div>`; };
  return `<p class="note">Du hast <b>${fmtN(Math.floor(S.res.gold))} 🪙 Gold</b>. Gold bekommst du aus Heiligtümern, Lagern und Beute.</p>
    <div class="block"><h3>Teleporter</h3>${S.startTp > 0 ? '<p class="note"><b>Start-Teleporter bereit:</b> einmalig, bringt deine Burg überallhin – auch außerhalb eines Reviers. Auf der Karte den Teleporter-Knopf antippen.</p>' : ''}${card('teleport')}${itemN('teleport') ? `<p class="note">${cd > 0 ? 'Lädt noch ' + fmtT(real(cd)) + '.' : 'Bereit. Auf der Karte den Button „Teleportieren“ nutzen.'}</p>` : ''}</div>`;
}

/* ---------- Ergebnis ---------- */
let endShown = false;
function showEnd(force) {
  const r = match.result; if (!r || (endShown && !force)) return; endShown = true;
  const won = r.winners.some(w => w.id === me.id), rk = r.ranking || { players: [] };
  $('modalIn').innerHTML = `<div class="crown">${won ? '👑' : '🏁'}</div><h2>${won ? 'Ihr habt gewonnen!' : 'Die Partie ist beendet'}</h2>
    <p class="desc">Sieger: <b>${esc(r.label)}</b> – ${{ throne: 'der Thron wurde zwei Tage gehalten', last: 'alle anderen sind ausgeschieden', time: 'die Zeit ist abgelaufen', admin: 'der Admin hat die Partie beendet' }[r.kind] || ''}.</p>
    <table class="rank"><thead><tr><th>#</th><th>Spieler</th><th>Punkte</th></tr></thead><tbody>${rk.players.slice(0, 10).map((p, i) => `<tr class="${p.id === me.id ? 'me' : ''}"><td>${i + 1}</td><td>${p.tag ? '<span class="tag">' + esc(p.tag) + '</span> ' : ''}${esc(p.name)}${r.winners.some(w => w.id === p.id) ? ' 👑' : ''}</td><td>${fmtN(p.score)}</td></tr>`).join('')}</tbody></table>
    <div class="row" style="margin-top:14px"><button class="btn" id="modalClose" type="button">Weiter ansehen</button></div>`;
  $('modal').hidden = false; $('modalClose').onclick = () => { $('modal').hidden = true; };
}

/* ---------- Karte: Bedienung ---------- */
const OBJ_NAME = { raider: 'Räuber', farm: 'Kornfeld', wood: 'Holzfällerlager', stone: 'Steinbruch', camp: 'Banditenlager', ruin: 'Alte Ruine', sanct: 'Heiligtum', throne: 'Der Thron', tower: 'Turm', start: 'Burg' };
const KIND_SHORT = { site: 'Bauplatz', outpost: 'Außenposten', start: 'Burg', farm: 'Feld', wood: 'Holz', stone: 'Bruch', camp: 'Lager', ruin: 'Ruine', sanct: 'Heiligtum', throne: 'Thron', tower: 'Turm' };
const gtNow = () => { const w = view.world; return w.gt + (Date.now() + offset - w.at) / 1000 * speed; };
const ownMarches = () => view ? view.world.marches.filter(m => m.own) : [];
function marchRemain(m) { const L = m.arr[m.arr.length - 1], g = gtNow(); return m.phase === 'gather' ? m.tEnd - g : m.phase === 'fight' ? 0 : m.t0 + L - g; }
function marchState(m) {
  const L = m.arr[m.arr.length - 1], g = gtNow();
  if (m.phase === 'gather') return { moving: false, pct: Math.max(0, Math.min(1, (g - m.tStart) / ((m.tEnd - m.tStart) || 1))) };
  if (m.phase === 'post') return { moving: false, pct: 1 };
  if (m.phase === 'fight') return { moving: false, pct: 1 };
  return { moving: true, pct: Math.max(0, Math.min(1, (g - m.t0) / (L || 1))) };
}
function marchLine(m) {
  const ph = m.phase === 'out' ? (m.mode === 'attack' ? 'Angriff' : m.mode === 'station' ? 'Verstärkung' : m.mode === 'occupy' ? 'Besetzung' : m.mode === 'build' ? 'Bautrupp' : m.mode === 'raid' ? 'Angriff' : m.mode === 'garrison' ? 'Verstärkung' : 'Marsch') : m.phase === 'fight' ? 'Kampf' : m.phase === 'gather' ? 'Sammelt' : 'Rückweg';
  return `${ph} · ${KIND_SHORT[m.tk] || ''} · ${fmtT(real(Math.max(0, marchRemain(m))))}`;
}
const lootHTML = l => Object.keys(l).filter(r => l[r] > 0).map(r => `<span class="cost"><i class="r r-${r}"></i>${RES_DE[r]} ${fmtN(l[r])}</span>`).join('');
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

const redirectable = x => ['post', 'gather', 'back', 'fight'].includes(x.phase) || (x.phase === 'out' && x.mode !== 'build');
const nearIds = m0 => { const o0 = wm.marchObjs[m0.id]; return ownMarches().filter(x => { if (!redirectable(x)) return false; const o = wm.marchObjs[x.id]; return o && o0 && Math.hypot(o.grp.position.x - o0.grp.position.x, o.grp.position.z - o0.grp.position.z) <= 14; }).map(x => x.id); };
// Alle gewählten Heere auf einmal losschicken (Gelände, Sammelfelder, Räuber)
async function groupSend(hit, sx, sy, idList) {
  const cmd = orderCmd(hit, sx, sy); if (!cmd) return;
  const ids = (idList || sendGroup).slice(); sendGroup = []; syncMoveBar(); let okN = 0;
  for (const id of ids) { sendFrom = id; if (await command(cmdFor(cmd, id))) okN++; }
  sendFrom = 0; syncMoveBar(); renderArmyBtns(); if (okN) dismissAll(); if (okN) toast(okN + ' Heere ziehen gemeinsam los.', 'info');
}
function mapTap(sx, sy) {
  if (!wm || !mapReady) return;
  const hit = wm.pickAt(sx, sy);
  if (sendGroup.length) { groupSend(hit, sx, sy); return; }
  // Doppeltipp auf eines deiner Heere: alle eigenen Heere in der Nähe wählen (auch stehende)
  const nowT = Date.now(), m0 = hit && hit.type === 'march' ? ownMarches().find(x => x.id === hit.id) : null;
  if (m0 && lastMapTap.id === m0.id && nowT - lastMapTap.t < 450) {
    lastMapTap = { id: 0, t: 0 };
    const o0 = wm.marchObjs[m0.id], near = ownMarches().filter(x => {
      if (!(['post', 'gather', 'back', 'fight'].includes(x.phase) || (x.phase === 'out' && x.mode !== 'build'))) return false;
      const o = wm.marchObjs[x.id]; return o && o0 && Math.hypot(o.grp.position.x - o0.grp.position.x, o.grp.position.z - o0.grp.position.z) <= 14;
    });
    if (near.length < 2) { toast('Kein weiteres Heer in der Nähe, das umgeleitet werden kann.'); return; }
    closeSheet(); miniClose(); sendFrom = 0; sendFromOp = ''; sendGroup = near.map(x => x.id); syncMoveBar(); renderArmyBtns(); return;
  }
  lastMapTap = { id: m0 ? m0.id : 0, t: nowT };
  if (!hit && (sendFrom || sendFromOp)) { const t = wm.tileAtScreen(sx, sy); command({ type: 'march', mode: 'post', x: t.x, y: t.y, troops: {} }).then(ok => { if (ok) { toast('Das Heer zieht dorthin.', 'info'); dismissAll(); } }); return; }
  if (!hit) {
    closeSheet(); const t = wm.tileAtScreen(sx, sy);
    if (t && view.match.phase === 'running') { if (!wm.exploredBit(t.x, t.y) && S.slot >= 0 && !S.out) scoutOpen(fieldAt(t.x, t.y), sx, sy); else miniOpen(t.x, t.y, sx, sy); }
    return;
  }
  miniClose(); selectMap(hit, false);
}
// Erkunder: Tipp auf ein Nebelfeld → Erkunden oder Abbrechen
let scoutEl = null, scoutF = -1;
function scoutOpen(f, sx, sy) {
  if (miniEl) miniEl.hidden = true;
  if (!scoutEl) {
    scoutEl = document.createElement('div'); scoutEl.id = 'scoutPop'; scoutEl.className = 'scoutpop'; document.body.appendChild(scoutEl);
    scoutEl.addEventListener('pointerdown', e => e.stopPropagation());
    scoutEl.addEventListener('click', async e => {
      const b = e.target.closest('[data-sc]'); if (!b) return; const a = b.dataset.sc, f2 = scoutF; scoutEl.hidden = true;
      if (a === 'go') { const ok = await command({ type: 'scout', f: f2 }); if (ok) toast('Dein Erkunder macht sich auf den Weg zu Feld ' + fieldName(f2) + '.', 'info'); }
      else if (a === 'stop') { const ok = await command({ type: 'scoutCancel' }); if (ok) toast('Erkundung abgebrochen.', 'info'); }
    });
  }
  scoutF = f; const sc = S.scout, mine = sc && sc.f === f, [cx, cy] = fieldCenter(f), go = Math.round(Math.hypot(cx - S.pos[0], cy - S.pos[1]) / SCOUT_SPEED);
  let t, btns;
  if (mine) { t = `<b>Feld ${fieldName(f)}</b><small>Erkunder ${gtNow() < sc.t0 + sc.go ? 'ist unterwegs' : 'erkundet'} · noch ${fmtT(real(Math.max(0, sc.end - gtNow())))}</small>`; btns = '<button type="button" class="btn ghost small" data-sc="stop">Erkundung abbrechen</button><button type="button" class="btn small" data-sc="no">Schließen</button>'; }
  else if (sc) { t = `<b>Feld ${fieldName(f)}</b><small>Dein Erkunder ist noch auf Feld ${fieldName(sc.f)} unterwegs.</small>`; btns = '<button type="button" class="btn small" data-sc="no">Schließen</button>'; }
  else { t = `<b>Feld ${fieldName(f)} erkunden?</b><small>Dauer ${fmtT(real(SCOUT_SEC))} + Weg ${fmtT(real(go))} · du findest Ressourcenpakete</small>`; btns = '<button type="button" class="btn small" data-sc="go">Erkunden</button><button type="button" class="btn ghost small" data-sc="no">Abbrechen</button>'; }
  scoutEl.innerHTML = `<span class="mp-t">${t}</span><div class="row">${btns}</div>`; scoutEl.hidden = false;
  const W = window.innerWidth, w = scoutEl.offsetWidth || 240;
  scoutEl.style.left = Math.max(8, Math.min(W - w - 8, sx - w / 2)) + 'px'; scoutEl.style.top = Math.max(70, sy - 96) + 'px';
}
// Kleines Pop-up nach kurzem Tippen aufs Gelände: Marschieren oder Abbrechen – die Karte bleibt stehen
let miniEl = null, miniTile = null;
function miniClose() { if (scoutEl) scoutEl.hidden = true; if (miniEl) miniEl.hidden = true; if (miniTile) { miniTile = null; if (!msel && wm) wm.select(null); } }
function miniOpen(x, y, sx, sy) {
  if (!miniEl) {
    miniEl = document.createElement('div'); miniEl.id = 'miniPop'; miniEl.innerHTML = '<span class="mp-t"></span><button type="button" class="btn small" data-mp="go">Marschieren</button><button type="button" class="btn ghost small" data-mp="no">Abbrechen</button>';
    document.body.appendChild(miniEl);
    miniEl.addEventListener('click', e => { const b = e.target.closest('[data-mp]'); if (!b) return; const t = miniTile; miniEl.hidden = true; miniTile = null;
      if (b.dataset.mp === 'go' && t) selectMap({ type: 'site', x: t.x, y: t.y, post: true }, false); else if (!msel) wm.select(null); });
    miniEl.addEventListener('pointerdown', e => e.stopPropagation());
  }
  miniTile = { x, y }; wm.select({ type: 'site', x, y });
  miniEl.querySelector('.mp-t').textContent = x + ' | ' + y; miniEl.hidden = false;
  const W = window.innerWidth, w = miniEl.offsetWidth || 220;
  miniEl.style.left = Math.max(8, Math.min(W - w - 8, sx - w / 2)) + 'px'; miniEl.style.top = Math.max(70, sy - 62) + 'px';
}
function selectMap(hit, keepSend) {
  placing = false; 
  sel = null; msel = hit; wm.select(hit);
  if (sendFromOp) send = sendOpAll();
  else if (sendFrom) { const sm = view.world.marches.find(x => x.id === sendFrom); send = sm ? { ...sm.troops } : {}; }
  else if (!keepSend) { send = {}; for (const u in S.troops) if (S.troops[u] > 0) send[u] = S.troops[u]; autoSend(hit); sendHero = bestHero(hit); const ob = hit.type === 'obj' ? wm.map.byId[hit.id] : null; if (!ob || !['farm', 'wood', 'stone'].includes(ob.k)) delete send.handkarren; }   // Handkarren nur beim Farmen automatisch dabei
  document.body.classList.add('sheet-open');
  if (hit.type === 'obj') { const o = wm.map.byId[hit.id]; revealMap(o.x + .5, o.y + .5); }
  else if (hit.type === 'op') { const o = (view.world.outposts || []).find(x => x.id === hit.id); if (o) revealMap(o.x + .5, o.y + .5); }
  else if (hit.type === 'site') revealMap(hit.x + .5, hit.y + .5);
  else if (hit.type === 'raider') { const r = (view.world.raiders || []).find(x => x.id === hit.id); if (r) revealMap(r.x + .5, r.y + .5); }
  else { const m = view.world.marches.find(x => x.id === hit.id); if (m) { const p = marchPos(m, gtNow()); revealMap(p.x, p.y); } }
  renderSheet();
}
// Bei Ressourcenfeldern wird die Truppenzahl so vorgewählt, dass das Feld damit geleert werden kann (mehr geht immer)
function autoSend(hit) {
  const o = hit.type === 'obj' ? wm.map.byId[hit.id] : null;
  if (!o || !['farm', 'wood', 'stone'].includes(o.k)) return;
  const left = view.world.nodes[o.id] == null ? NODE_MAX(o.lv) : view.world.nodes[o.id];
  if (left < 50) return;
  const us = Object.keys(S.troops).filter(u => S.troops[u] > 0).sort((a, b) => U[b].c - U[a].c), pick_ = {};
  let cap = 0;
  for (const u of us) {
    if (cap >= left) break;
    const per = capacityOf({ [u]: 1000 }, S) / 1000; if (per <= 0) continue;
    const n = Math.min(S.troops[u], Math.ceil((left - cap) / per));
    pick_[u] = n; cap += n * per;
  }
  if (Object.keys(pick_).length) send = pick_;
}
function fieldFoes(id) { return (view.world.marches || []).filter(m => m.phase === 'gather' && m.tid === id && !m.own && !m.friend); }
function mapSignature() {
  const w = view.world, id = msel.id;
  return JSON.stringify([msel, send, S.troops, S.lv.rathaus, S.silver, (S.spies || []).length, ownMarches().map(m => m.id + m.phase + (m.hero || '')), sendHero, w.camps[id] || 0, w.nodes[id], fieldFoes(id).map(m => m.id), w.ruins[id], w.outposts, RES.map(r => Math.floor(S.res[r] / 50)), busy, (view.match.players || []).map(p => p.id + ':' + p.out + p.vassalOf + p.ally + (p.protUntil > gtNow())), view.match.holds, view.match.phase, armedKey, S.stationed, S.res.gold >= 50]);
}
function sendOpAll() { const q = (view.world.outposts || []).find(x => x.id === sendFromOp), g = q && q.garr ? q.garr[me.id] : null; return g ? { ...g } : {}; }
function sendList() { const t = {}; for (const u in send) if (send[u] > 0) t[u] = send[u]; return t; }
function planFor(o) {
  if (sendFromOp) { const t0 = sendOpAll(), q = (view.world.outposts || []).find(x => x.id === sendFromOp); if (!q || !sum(t0)) return null; const k0 = sendHero + o.id + 'op' + sendFromOp + JSON.stringify(t0) + wm.roadSig.length; if (planCache.key !== k0) planCache = { key: k0, plan: planFrom(wm.map, [q.x, q.y], o.x, o.y, t0, S, sendHero) }; return planCache.plan; }
  const t = sendList(), key = sendHero + o.id + JSON.stringify(t) + S.pos + wm.roadSig.length;
  if (!sum(t)) return null;
  if (planCache.key !== key) { const sm = sendFrom && view.world.marches.find(x => x.id === sendFrom); planCache = { key: key + sendFrom, plan: sm ? planFrom(wm.map, (sm.phase === 'post' || sm.phase === 'gather') ? cellXY(sm.path[sm.path.length - 1]) : (q => [Math.floor(q.x), Math.floor(q.y)])(marchPos(sm, gtNow())), o.x, o.y, t, S, sm.hero) : planMarch(wm.map, S, o, t, sendHero) }; }
  return planCache.plan;
}
/* ---------- Helden als Anführer ---------- */
const heroLvl = id => (S.heroes && S.heroes[id] ? S.heroes[id].lv : 1);
const busyHero = id => ownMarches().some(m => m.hero === id);
function bestHero(hit) {
  const free = HERO_IDS.filter(id => !busyHero(id)); if (!free.length) return '';
  const o = hit && hit.type === 'obj' ? wm.map.byId[hit.id] : null, k = o ? o.k : hit ? hit.type : '';
  const want = k === 'farm' ? ['gorm', 'mira'] : k === 'wood' ? ['thorin', 'mira'] : k === 'stone' ? ['ilsa', 'mira'] : (k === 'camp' || k === 'raider') ? ['draven'] : (k === 'start' || k === 'op' || k === 'throne' || k === 'sanct') ? ['kael', 'seraphine'] : ['seraphine'];
  return want.find(id => free.includes(id)) || free.sort((a, b) => heroLvl(b) - heroLvl(a))[0];
}
const heroBonusText = id => skillList(S, id).map(k => '+' + (Math.round(k.val * 1000) / 10).toString().replace('.', ',') + ' % ' + k.name).join(' · ');
function heroPickHTML(closeBtn) {
  if (!sendHero || busyHero(sendHero)) sendHero = bestHero(msel);
  return `<div class="block hpick"><h3>Anführer${closeBtn ? '<button class="xclose" type="button" data-act="close" aria-label="Schließen">✕</button>' : ''}</h3><div class="hrow">${HERO_IDS.map(id => { const H = HEROES[id], b = busyHero(id);
    return `<button type="button" class="hchip${id === sendHero ? ' on' : ''}" data-hero="${id}" ${b ? 'disabled' : ''}><span class="hpic fx-${H.fx}" style="--hc:${H.col}">${hpic(id, H)}</span><b>${H.name}</b><small>${b ? 'unterwegs' : 'Stufe ' + heroLvl(id)}</small></button>`; }).join('')}</div>
    ${sendHero ? `<p class="note">${HEROES[sendHero].name}: ${heroBonusText(sendHero)}</p>` : '<p class="why">Alle Helden sind unterwegs.</p>'}</div>`;
}
function pickerHTML(closeBtn) {
  if (sendFromOp) return heroPickHTML() + `<div class="block picker"><h3>Besatzung weiterschicken</h3><p class="note">${troopsLine(sendOpAll())} ziehen vom Außenposten zum Ziel.</p><div class="row"><button class="btn ghost small" type="button" data-act="sfCancel">Abbrechen</button></div></div>`;
  if (sendFrom) { const sm = view.world.marches.find(x => x.id === sendFrom); return `<div class="block picker"><h3>Marschieren</h3><p class="note">${sm ? (sm.troops.n != null ? fmtN(sm.troops.n) + ' Einheiten' : troopsLine(sm.troops)) : ''} ziehen von ihrem Standort zum Ziel.</p><div class="row"><button class="btn ghost small" type="button" data-act="sfCancel">Abbrechen</button></div></div>`; }
  const us = Object.keys(U).filter(u => S.troops[u] > 0);
  if (!us.length) return '<p class="note">Du hast keine Truppen zu Hause. Bilde sie in der Kaserne aus (Stadt).</p>';
  const tot = sendList(), cp = capacityOf(tot, S, sendHero);
  return heroPickHTML(closeBtn) + `<div class="block picker"><h3>Heer <span class="quick"><button class="btn ghost small" type="button" data-act="sall">Alle</button><button class="btn ghost small" type="button" data-act="shalf">Hälfte</button><button class="btn ghost small" type="button" data-act="snone">Keine</button></span></h3>${us.map(u => {
    const max = S.troops[u], val = Math.max(0, Math.min(max, send[u] || 0));
    return `<div class="urow"><div class="un"><b>${U[u].name}</b><small>${fmtN(max)} daheim</small></div><input class="qr" type="range" min="0" max="${max}" value="${val}" data-q="send" data-u="${u}" aria-label="${U[u].name}"><input class="qn" type="number" inputmode="numeric" min="0" max="${max}" value="${val}" data-q="send" data-u="${u}" aria-label="Anzahl"></div>`; }).join('')}
    <p class="note usum">${fmtN(sum(tot))} Einheiten · tragen ${fmtN(cp)}</p></div>`;
}

/* ---------- Revier: Bauplatz und Außenposten (gehören dem Bündnis) ---------- */
// Spähen: Silber einsetzen, 30 Minuten unterwegs
function spyBlock(p) {
  const run = (S.spies || []).find(x => x.target === p.id), si = S.silver || 0;
  if (run) return `<div class="row"><span class="note">🔍 Dein Späher ist unterwegs, noch ${fmtT(real(Math.max(0, run.done - gtNow())))} · Einsatz ${fmtN(run.stake)} Silber</span></div>`;
  return `<div class="block"><h3>Spähen · ${fmtT(real(SPY_SEC))}</h3><p class="note">Setze Silber ein: Hat ${esc(p.name)} weniger Silber in der Burg, gelingt es. Sonst scheitert es und ${esc(p.name)} erfährt davon. Das eingesetzte Silber ist in beiden Fällen weg. Du hast ${fmtN(si)} Silber (Tausch im Rathaus).</p>
    <div class="row"><input class="qn" id="spyStake" type="number" inputmode="numeric" min="1" max="${si}" value="${Math.min(si, Math.max(1, spyStakeN))}" aria-label="Silber einsetzen"><button class="btn" type="button" data-act="spy" data-pid="${p.id}" ${si >= 1 ? '' : 'disabled'}>Spähen</button></div></div>`;
}
let spyStakeN = 1;
function siteCtx() {
  const m = view.match, gt = gtNow();
  return { mt: { seed: m.seed, world: { gt, alliances: Object.fromEntries((m.alliances || []).map(a => [a.id, a])), outposts: Object.fromEntries((view.world.outposts || []).map(o => [o.id, o])) } },
    pls: m.players.map(p => ({ id: p.id, name: p.name, state: { out: p.out, slot: p.slot, pos: p.pos, lv: { rathaus: p.rathaus }, explored: p.id === me.id ? S.explored : '' } })) };
}
const opOwnerName = o => { const a = (view.match.alliances || []).find(x => x.id === o.al); return a ? '[' + a.tag + '] ' + a.name : '?'; };
function siteSheet(w) {
  const { mt, pls } = siteCtx(), gt = gtNow(), al = view.ally, free = sendFrom || sendFromOp || ownMarches().length < armySlots(S), st = al ? al.store : null;
  const mineN = (w.outposts || []).filter(o => o.mine).length;
  let why = checkSite(mt, pls, { id: me.id }, msel.x, msel.y, gt);
  if (!why && view.match.phase !== 'running') why = 'Die Partie läuft nicht.';
  const poor = al && OP_COST.some((c, i) => st[RES[i]] < c);
  wm.setPreview({ x: msel.x, y: msel.y, r: OP_R, ok: !why });
  const o = { id: 'site', x: msel.x, y: msel.y }, plan = !why ? planFor(o) : null;
  if (msel.post) {
    wm.setPreview(null);
    const plan2 = planFor({ id: 'post', x: msel.x, y: msel.y }), ok = view.match.phase === 'running';
    return pickerHTML(true)
      + (plan2 && !plan2.error ? `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan2.duration))}</dd></dl>` : '')
      + actionRow('Marschieren', ok ? plan2 : null, ok ? '' : 'Die Partie läuft nicht.', free, '', 'post');
  }
  let body = '';
  body += `<p class="desc">Ein Außenposten gehört eurem Bündnis und erweitert das gemeinsame Revier um ein Viereck (13×13 Felder). Es gibt nur eine Stufe. Mitglieder können ihn mit Truppen bewachen. Feinde können ihn zerstören, wenn ihr Außenposten an seinen grenzt.</p>
    <dl class="stats"><dt>Kosten (Bündnislager)</dt><dd class="costs">${costHTML(OP_COST, st || {})}</dd><dt>Bauzeit</dt><dd>${fmtT(real(opBuildTime(sum(sendList()) || 1)))} nach der Ankunft<br><span class="note">1 Einheit ${fmtT(real(OP_BUILD))}, ${OP_HELP_MAX} Einheiten ${fmtT(real(OP_BUILD_FAST))}. Mehr als ${OP_HELP_MAX} verkürzen nicht weiter.</span></dd><dt>Außenposten des Bündnisses</dt><dd>${mineN} (ohne Limit)</dd></dl>`;
  if (why) body += `<p class="why">${esc(why)}</p>`;
  const o2 = { id: 'post', x: msel.x, y: msel.y }, plan2 = planFor(o2), postOk = view.match.phase === 'running';
  if (why) {
    body += `<h3>Heer hier aufstellen</h3><p class="note">Das Heer bleibt auf dem Feld stehen, bis du es zurückrufst. Feinde können es angreifen.</p>` + pickerHTML();
    if (plan2 && !plan2.error) body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan2.duration))}</dd></dl>`;
    body += actionRow('Marschieren', postOk ? plan2 : null, postOk ? '' : 'Die Partie läuft nicht.', free, '', 'post');
  } else {
    body += pickerHTML();
    if (plan && !plan.error) body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan.duration))}</dd></dl>`;
    body += actionRow('Außenposten bauen', plan, poor ? 'Im Bündnislager fehlen Rohstoffe (Bündnis → Revier & Lager).' : '', free, '', 'build', OP_MIN_TROOPS) + `<p class="note">Die Einheiten bleiben als Besatzung dort (beliebig viele). Du kannst sie jederzeit abziehen.</p>`;
    body += actionRow('Nur Marschieren', plan2, '', free, 'ghost', 'post') + `<p class="note">Das Heer bleibt ohne Bau auf dem Feld stehen. Feinde können es angreifen.</p>`;
  }
  return `<div class="sh-head"><h2>Freies Feld</h2><span class="lvl">${msel.x} | ${msel.y}</span><button class="close" type="button" data-act="close">Schließen</button></div>${body}`;
}
// Kräfte beider Seiten als zwei Balken: wer länger ist, gewinnt eher
function powBars(pw) {
  if (!pw) return '';
  const pa = Math.round(100 * pw.fa), pd = Math.round(100 * pw.fd);
  return `<div class="pbars fight"><div class="pb att"><span>Angreifer</span><div class="bar"><i style="width:${pa}%"></i></div><b>${pw.na == null ? '?' : fmtN(pw.na)}</b></div>`
    + `<div class="pb def"><span>Verteidiger</span><div class="bar"><i style="width:${pd}%"></i></div><b>${pw.nd == null ? '?' : fmtN(pw.nd)}</b></div>`
    + (pw.wall != null ? `<div class="pb wall"><span>Mauer</span><div class="bar"><i style="width:${Math.round(100 * pw.wall)}%"></i></div><b>${Math.round(100 * pw.wall)}%</b></div>` : '')
    + `<div class="pv">${pw.fa >= pw.fd ? '⚔ Die Angreifer sind vorn' : '🛡 Die Verteidiger sind vorn'} · ⏱ noch ca. ${fmtT(real(pw.left))}</div></div>`;
}
function siegeBlock(tid, defName) {
  const sg = (view.sieges || []).find(x => x.tid === tid); if (!sg || view.match.phase !== 'running') return '';
  const free = sendFrom || sendFromOp || ownMarches().length < armySlots(S), none = !sum(sendList()) ? 'Wähle Truppen aus.' : !free ? 'Alle Heere sind unterwegs.' : '';
  return `<div class="block"><h3>⚔ Kampf läuft</h3><p class="note">${sg.fromTag ? '[' + esc(sg.fromTag) + '] ' : ''}${esc(sg.from)} kämpft gegen ${esc(defName)}. Du kannst Verstärkung schicken – auch aus anderen Bündnissen. Der Balken verändert sich, sobald sie eintrifft.</p>${powBars(sg.pw)}`
    + `<div class="row"><button class="btn ghost" type="button" data-act="assistD" ${none ? 'disabled' : ''}>Verteidigern helfen</button><button class="btn ghost" type="button" data-act="assistA" ${none ? 'disabled' : ''}>Angreifern helfen</button></div>${none ? `<span class="why">${none}</span>` : ''}</div>`;
}
function opSheet(w) {
  const o = (w.outposts || []).find(x => x.id === msel.id); if (!o) return '';
  const gt = gtNow(), ready = opReady(o, gt), g = opGuard(), free = sendFrom || sendFromOp || ownMarches().length < armySlots(S);
  wm.setPreview(null);
  const names = id => pname(id);
  let body = `<dl class="stats"><dt>Gehört</dt><dd>${esc(opOwnerName(o))}</dd><dt>Revier</dt><dd>${2 * OP_R + 1}×${2 * OP_R + 1} Felder</dd>
    <dt>Zustand</dt><dd>${ready ? ((wm.rectList().find(r => r.id === o.id) || {}).off ? '<b>inaktiv</b> – keine Verbindung zum Turm. Schließe die Lücke mit einem neuen Außenposten.' : 'fertig') : 'im Bau, noch ' + fmtT(real(o.done - gt))}</dd><dt>Wachen</dt><dd>${troopsLine(g.troops)} (+${Math.round((g.mult - 1) * 100)} %)</dd>`;
  if (o.mine) {
    const gr = o.garr || {}, ids = Object.keys(gr).filter(k => sum(gr[k]) > 0);
    body += `<dt>Besatzung</dt><dd>${ids.length ? ids.map(k => `<div><b>${esc(names(Number(k)))}</b>${Number(k) === me.id ? ' (du)' : ''}: ${troopsLine(gr[k])}</div>`).join('') : 'niemand'}</dd></dl>`;
  } else body += '</dl>';
  if (view.match.phase !== 'running') body += '<p class="why">Die Partie läuft nicht.</p>';
  else if (o.mine) {
    const mineG = (o.garr || {})[me.id], others = (w.outposts || []).filter(x => x.mine && x.id !== o.id && opReady(x, gt));
    body += pickerHTML() + actionRow('Truppen hierher schicken', planFor({ id: o.id, x: o.x, y: o.y }), '', free, '', 'garrison');
    if (mineG && sum(mineG)) {
      body += `<div class="block"><h3>Deine Truppen hier</h3><div class="row"><button class="btn" type="button" data-act="opSend">Weiterschicken</button><button class="btn ghost" type="button" data-act="opRecall">Alle abziehen</button></div>`
        + (others.length ? `<p class="note">Oder zu einem anderen Außenposten schicken:</p><div class="row">${others.map(x => `<button class="btn ghost small" type="button" data-act="opMove" data-to="${x.id}">Nach ${x.x} | ${x.y}</button>`).join('')}</div>` : '') + '</div>';
    }
    body += `<div class="row"><button class="btn ${armedKey === 'opdis' + o.id ? 'danger' : 'ghost'}" type="button" data-act="opDis">${armedKey === 'opdis' + o.id ? 'Wirklich abreißen' : 'Abreißen'}</button></div><p class="note">Beim Abreißen kehren alle Besatzungen heim und ein Teil der Kosten fließt ins Bündnislager zurück.</p>`;
  } else {
    const { mt, pls } = siteCtx(), why0 = checkRaid({ match: mt, players: pls }, { id: me.id }, o), plan = why0 ? null : planFor({ id: o.id, x: o.x, y: o.y });
    body += '<p class="note">Wie viele Truppen als Besatzung dort stehen, siehst du erst im Kampf. Gewinnst du, verschwindet der Außenposten samt Revier.</p>';
    if (why0) body += `<p class="why">${esc(why0)}</p>`;
    else {
      body += pickerHTML();
      if (plan && !plan.error) body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan.duration))}</dd></dl>`;
      body += (S.protUntil > gt ? '<p class="why">Wenn du angreifst, endet dein Schutz sofort.</p>' : '') + actionRow(armedKey === 'raid' + o.id ? 'Jetzt wirklich angreifen' : 'Außenposten angreifen', plan, '', free, armedKey === 'raid' + o.id ? 'danger' : '', 'raid');
    }
  }
  body = siegeBlock(o.id, 'diesen Außenposten') + body;
  return `<div class="sh-head"><h2>Außenposten</h2><span class="lvl">${o.mine ? 'Bündnis' : esc(opOwnerName(o))}</span><button class="close" type="button" data-act="close">Schließen</button></div>${body}`;
}
function renderMapSheet() {
  const w = view.world; let h = '';
  if (msel.type === 'raider') {
    h = raiderSheet(w); if (!h) { closeSheet(); return; }
  } else if (msel.type === 'march') {
    const m = w.marches.find(x => x.id === msel.id);
    if (!m) { closeSheet(); return; }
    const tgt = wm.map.byId[m.tid] || null, mine = m.own, st = marchState(m);
    const modeName = m.phase === 'fight' ? 'Im Kampf' : m.phase === 'post' ? 'Aufgestellt' : m.phase === 'gather' ? 'Sammelt' : m.phase === 'back' ? 'Rückmarsch' : ({ attack: 'Angriff', station: 'Verstärkung', occupy: 'Besetzung', build: 'Bautrupp', raid: 'Überfall', garrison: 'Verstärkung' }[m.mode] || 'Marsch');
    const goal = m.phase === 'back' ? 'Zur Burg' : m.tk === 'site' ? 'Bauplatz' : m.tk === 'outpost' ? 'Außenposten' : m.tk === 'post' ? (m.phase === 'post' ? 'Hier' : 'Feld auf der Karte') : tgt ? (tgt.k === 'start' ? 'Burg von ' + esc((view.match.players.find(p => p.slot === tgt.slot) || {}).name || '?') : OBJ_NAME[tgt.k] + (tgt.lv ? ' ' + tgt.lv : '')) : '—';
    const trp = m.troops.n != null ? `<span class="tp"><b>${fmtN(m.troops.n)}</b> Einheiten</span>` : Object.keys(m.troops).filter(u => m.troops[u] > 0 && U[u]).map(u => `<span class="tp"><b>${fmtN(m.troops[u])}</b> ${U[u].name}</span>`).join('');
    const eta = st.moving ? Date.now() + offset + real(Math.max(0, marchRemain(m))) * 1000 : 0;
    const btn = (act, label, cls = '') => `<button class="btn ${cls}" type="button" data-act="${act}">${label}</button>`;
    const acts = mine ? [
      !(m.phase === 'out' && m.mode === 'build') ? btn('sfStart', '➜ Marschieren') : '',
      m.phase === 'out' && m.mode !== 'build' ? btn('halt', '✋ Anhalten', 'ghost') : '',
      m.phase !== 'back' ? btn('recall', m.phase === 'gather' ? '⌂ Heimrufen (mit Beute)' : m.phase === 'fight' ? '⌂ Abziehen' : '⌂ Heimrufen', 'ghost') : ''
    ].filter(Boolean).join('') : '';
    h = `<div class="sh-head"><h2>${mine ? 'Dein Heer' : 'Heer von ' + esc(m.name)}</h2><span class="lvl">${modeName}</span><button class="close" type="button" data-act="close">Schließen</button></div>
      ${st.moving || m.phase === 'gather' ? `<div class="mprog"><div class="prog"><i id="mProg" style="width:${Math.round(st.pct * 100)}%"></i></div><span class="mtime" id="mTime">${fmtT(real(Math.max(0, marchRemain(m))))}</span></div>` : ''}
      <dl class="stats"><dt>Ziel</dt><dd>${goal}</dd>${eta ? `<dt>Ankunft</dt><dd>${new Date(eta).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} Uhr</dd>` : ''}
      <dt>Truppen</dt><dd><span class="trps">${trp}</span></dd>
      ${mine && m.troops.n == null ? `<dt>Tragkraft</dt><dd>${fmtN(capacityOf(m.troops, S))}</dd>` : ''}
      ${mine && m.load && Object.keys(m.load).length ? `<dt>Beute</dt><dd class="costs">${lootHTML(m.load)}</dd>` : ''}
      ${m.phase === 'gather' && mine ? `<dt>Sammelt</dt><dd class="costs" id="mGather">${lootHTML({ [m.res]: Math.floor(m.amount * st.pct) })} <span class="note">von ${fmtN(m.amount)}</span></dd>` : ''}</dl>
      ${m.phase === 'fight' ? powBars(((view.sieges || []).find(x => x.id === (m.lead || m.id)) || {}).pw) : ''}
      ${acts ? `<div class="row acts">${acts}</div>` : ''}
      ${!mine && m.phase === 'post' ? `${pickerHTML()}<div class="row"><button class="btn ${armedKey === 'patk' + m.id ? 'danger' : ''}" type="button" data-act="patk" ${!sum(sendList()) || ownMarches().length >= armySlots(S) ? 'disabled' : ''}>${armedKey === 'patk' + m.id ? 'Jetzt wirklich angreifen' : '⚔ Heer angreifen'}</button></div>` : ''}`;
  } else if (msel.type === 'site' || msel.type === 'op') {
    h = msel.type === 'site' ? siteSheet(w) : opSheet(w);
    if (!h) { closeSheet(); return; }
  } else {
    wm.setPreview(null);
    const o = wm.map.byId[msel.id], k = o.k, id = o.id, free = sendFrom || sendFromOp || ownMarches().length < armySlots(S);
    const title = k === 'start' ? ((view.match.players.find(p => p.slot === o.slot) || {}).name ? 'Burg von ' + esc(view.match.players.find(p => p.slot === o.slot).name) : 'Freier Burgplatz') : k === 'sanct' ? SANCT[o.n][0] : OBJ_NAME[k];
    const lv = o.lv ? `<span class="lvl">Stufe ${o.lv}</span>` : '';
    let body = '';
    if (k === 'tower') {
      body = `<p class="desc">Startpunkt für Außenposten. Ein Bündnis beginnt hier seine Kette: Der erste Außenposten muss das weiße Feld um den Turm berühren, jeder weitere das Revier davor. Reißt die Kette in der Mitte ab, sind alle Außenposten dahinter inaktiv, bis die Lücke wieder geschlossen ist. Der Turm selbst kann nicht zerstört werden.</p>`;
    } else if (['farm', 'wood', 'stone'].includes(k)) {
      const max = NODE_MAX(o.lv), left = w.nodes[id] == null ? max : w.nodes[id], res = { farm: 'food', wood: 'wood', stone: 'stone' }[k], plan = planFor(o);
      body = `<dl class="stats"><dt>Vorrat</dt><dd>${fmtN(left)} von ${fmtN(max)} ${RES_DE[res]}</dd></dl>${pickerHTML()}`;
      if (plan && !plan.error) {
        const amount = Math.floor(Math.min(plan.capacity, left)), gather = amount ? GATHER_SEC * amount : 0;
        body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan.duration))}</dd><dt>Traglast</dt><dd>${fmtN(plan.capacity)}</dd><dt>Ertrag</dt><dd class="costs">${lootHTML({ [res]: amount })}</dd><dt>Sammeln</dt><dd>${fmtT(real(gather))}</dd><dt>Gesamt</dt><dd>${fmtT(real(2 * plan.duration + gather))}</dd></dl>`;
      }
      body += actionRow('Sammeln', plan, left < 50 ? 'Das Feld ist erschöpft.' : (view.world.marches || []).some(m => m.tid === id && !m.mode && m.phase !== 'back') ? 'Hier sammelt schon ein Heer.' : '', free);
      const foes = fieldFoes(id);
      if (foes.length) body += `<div class="block"><h3>Sammler auf dem Feld</h3>${foes.map(m => `<div class="mrow"><div><b>${esc(m.name)}</b><div class="note">${fmtN((m.troops && m.troops.n) || 0)} Truppen · sammelt noch ${fmtT(real(Math.max(0, m.tEnd - gtNow())))}</div></div></div>`).join('')}</div>` + actionRow(armedKey === 'fattack' + id ? 'Wirklich überfallen' : 'Sammler überfallen', plan, '', free, 'danger', 'fattack');
    } else if (k === 'camp') {
      const dead = (w.camps[id] || 0) > gtNow(), def = campTroops(o.lv), mult = campMult(o.lv), plan = planFor(o), sel_ = sendList();
      body = `<dl class="stats"><dt>Verteidiger</dt><dd>${troopsLine(def)}</dd><dt>Stärke</dt><dd>+${Math.round((mult - 1) * 100)} %</dd><dt>Beute</dt><dd class="costs">${lootHTML(campLoot(o.lv))}</dd></dl>`;
      if (dead) body += '<p class="why">Dieses Lager ist gerade zerstört.</p>';
      else {
        body += pickerHTML();
        if (plan && !plan.error) {
          const r = battle(sel_, def, mult, forceOf(S) * (sendHero ? heroForce(S, sendHero, sel_, 'att', 'camp') : 1)), lost = sum(sel_) - sum(r.attLeft);
          body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan.duration))}</dd><dt>Prognose</dt><dd class="${r.win ? '' : 'why'}">${r.win ? `Sieg · du verlierst ${fmtN(lost)} von ${fmtN(sum(sel_))} (rund 30 % davon kommen verwundet ins Lazarett, wenn dort Platz ist)` : 'Niederlage · dein Heer wird aufgerieben'}</dd></dl>`;
        }
        body += actionRow('Angreifen', plan, '', free);
      }
    } else if (k === 'ruin') {
      const done = !!w.ruins[id], plan = planFor(o), loot = { food: 200 * o.lv, wood: 200 * o.lv, stone: 600 * o.lv, gold: 150 * o.lv };
      body = `<dl class="stats"><dt>Beute (einmalig)</dt><dd class="costs">${lootHTML(loot)}</dd></dl>`;
      if (done) body += '<p class="why">Diese Ruine ist schon geplündert.</p>';
      else { body += pickerHTML(); if (plan && !plan.error) body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan.duration))}</dd></dl>`; body += actionRow('Plündern', plan, '', free); }
    } else if (k === 'start') {
      const p = view.match.players.find(x => x.slot === o.slot), gt = gtNow();
      if (!p) body = '<p class="desc">Hier ist noch niemand eingezogen. Mit dem Einladungslink kann ein Mitspieler diesen Platz besetzen.</p>';
      else if (p.id === me.id) body = `<p class="desc">Rathaus Stufe ${p.rathaus}. Das ist deine Burg.</p><div class="row"><button class="btn" type="button" data-act="toCity">Zur Stadt</button></div>`;
      else {
        const al = allyOf(p.id), friend = isAlly(p.id), prot = p.protUntil > gt;
        body = `<dl class="stats"><dt>Rathaus</dt><dd>Stufe ${p.rathaus}</dd><dt>Bündnis</dt><dd>${al ? esc(al.name) + ' [' + esc(al.tag) + ']' + (friend ? ' (deins)' : '') : 'keins'}</dd>
          <dt>Lage</dt><dd>${p.out ? 'ausgeschieden' : p.vassalOf ? 'Vasall von ' + esc(pname(p.vassalOf)) : prot ? 'geschützt, noch ' + fmtT(real(p.protUntil - gt)) : 'angreifbar'}</dd></dl>`;
        body += siegeBlock(o.id, p.name);
        if (p.out) body += '<p class="note">Diese Burg ist erobert. Der Spieler ist ausgeschieden.</p>';
        else {
          const plan = planFor(o);
          body += pickerHTML();
          if (plan && !plan.error) body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan.duration))}</dd></dl>`;
          if (friend) body += actionRow('Truppen stationieren', plan, '', free) + `<p class="note">Stationierte Truppen helfen ${esc(p.name)} bei der Verteidigung. Du kannst sie jederzeit zurückrufen (Tab Bündnis). Die Burg nimmt höchstens ${60 * p.rathaus} fremde Truppen auf.</p>`;
          else {
            const why = p.vassalOf === me.id ? 'Das ist dein Vasall.' : p.vassalOf && isAlly(p.vassalOf) ? 'Dieser Vasall gehört einem Verbündeten.' : prot ? 'Steht unter Schutz.' : (() => { const { mt, pls } = siteCtx(); return castleSafe({ match: mt, players: pls }, { id: p.id, state: { pos: p.pos || [o.x, o.y] } }, gtNow()) ? 'Liegt im aktiven Revier ihres Bündnisses – nicht angreifbar.' : ''; })() || (view.match.phase !== 'running' ? 'Die Partie läuft nicht.' : '');
            body += (S.protUntil > gt ? '<p class="why">Wenn du angreifst, endet dein Schutz sofort.</p>' : '')
              + actionRow(armedKey === 'attack' + id ? 'Jetzt wirklich angreifen' : 'Angreifen', plan, why, free, armedKey === 'attack' + id ? 'danger' : '')
              + spyBlock(p);
          }
        }
      }
    } else if (k === 'sanct' || k === 'throne') {
      const hd = (view.match.holds || []).find(x => x.id === id), plan = planFor(o), gt = gtNow(), g = holdGuard(k), sn = k === 'sanct' ? SANCT[o.n] : null;
      const eff = k === 'sanct' ? `+15 % ${RES_DE[sn[1]]} für den Halter und sein Bündnis` : '+25 % Gold für den Halter und sein Bündnis';
      body = `<p class="desc">${k === 'sanct' ? 'Ein Heiligtum wird nicht besetzt. Sobald ein Außenposten deines Bündnisses am weißen Viereck um das Heiligtum andockt, gehört es dem Bündnis und alle Mitglieder bekommen den Bonus, ganz ohne Truppen.' : k === 'throne' ? 'In der Mitte der Welt. Wer den Thron zwei Tage ohne Unterbrechung hält, gewinnt die Partie. Nur Bündnisse können ihn erreichen: Sobald ein Außenposten am weißen Viereck um den Thron andockt, gehört er dem Bündnis, ganz ohne Truppen. Spieler ohne Bündnis können das nicht.' : 'Ein altes Heiligtum an den vier Wegen zum Thron.'}</p>
        <dl class="stats"><dt>Wirkung</dt><dd>${eff}</dd><dt>Halter</dt><dd>${hd ? '<b>' + esc(hd.label) + '</b> seit Tag ' + dayOf(hd.since) : 'frei · ohne Wächter'}</dd>
        ${k === 'throne' && hd ? `<dt>Sieg in</dt><dd>${fmtT(real(hd.since + THRONE_HOLD - gt))}</dd>` : ''}${hd && !hd.mine && k !== 'throne' ? `<dt>Besatzung</dt><dd>${fmtN(hd.total)} Einheiten</dd>` : ''}</dl>`;
      if (false) {
        body += `<div class="block"><h3>Eure Besatzung</h3>${Object.keys(hd.garr || {}).map(pid => `<div class="mrow"><div><b>${esc(pname(Number(pid)))}</b><div class="note">${troopsLine(hd.garr[pid])}</div></div>${Number(pid) === me.id ? '<button class="btn ghost small" type="button" data-act="holdRecall">Zurückrufen</button>' : ''}</div>`).join('')}</div>`;
      }
      if (k === 'throne' || k === 'sanct') body += `<p class="note">Das Bündnis, dessen Außenposten am weißen Feld angedockt ist, hält ihn. Wer ihn übernehmen will, muss erst die Außenposten des Halters zerstören, sodass er nicht mehr andockt, und dann selbst andocken.${hd ? '' : ' Im Moment ist er frei.'}</p>`;
      else if (view.match.phase !== 'running') body += '<p class="why">Die Partie läuft nicht.</p>';
      else {
        body += pickerHTML();
        if (plan && !plan.error) {
          body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan.duration))}</dd>`;
          if (!hd) { const sl = sendList(), r = battle(sl, g.troops, g.mult, forceOf(S)); body += `<dt>Prognose</dt><dd class="${r.win ? '' : 'why'}">${r.win ? `Sieg · du verlierst ${fmtN(sum(sl) - sum(r.attLeft))} von ${fmtN(sum(sl))}` : 'Niederlage'}</dd>`; }
          body += '</dl>';
        }
        const myP = view.match.players.find(p => p.id === me.id), touchOK = touchesObj(wm.rectList(), myP && myP.ally ? 'a' + myP.ally : 'p' + me.id, o);
        if (!touchOK) body += '<p class="why">Dein Revier (oder das deines Bündnisses) berührt diesen Ort nicht. Baue Außenposten in seine Richtung: freies Feld antippen.</p>';
        body += actionRow(hd && hd.mine ? 'Besatzung verstärken' : hd ? 'Besatzung angreifen' : 'Besetzen', plan, touchOK ? '' : 'Kein Revier an diesem Ort.', free);
        body += '<p class="note">Die Truppen bleiben dort stehen, bis du sie zurückrufst. Verlierst du den Ort, sind sie verloren (zum Teil verwundet).</p>';
      }
    }
    h = `<div class="sh-head"><h2>${title}</h2>${lv}<button class="close" type="button" data-act="close">Schließen</button></div>${body}`;
  }
  const MI = { farm: '🌾', wood: '🪵', stone: '🪨', camp: '⚔️', ruin: '🏛️', sanct: '✨', throne: '👑', tower: '🗼', start: '🏰' };
  const ico = msel.type === 'raider' ? '☠️' : msel.type === 'march' ? '🚩' : msel.type === 'site' ? '🏗️' : msel.type === 'op' ? '🗼' : MI[(wm.map.byId[msel.id] || {}).k] || '📍';
  h = h.replace('<div class="sh-head">', `<div class="sh-head"><span class="sh-ico">${ico}</span>`).replace('data-act="close">Schließen</button>', 'data-act="close" aria-label="Schließen">✕</button>');
  $('sheet').classList.add('popup');
  $('sheetInner').innerHTML = h; sheetSig = mapSignature();
}
const raiderXpText = lv => { const base = raiderXp(lv), hv = sendHero && HEROES[sendHero] && HEROES[sendHero].role !== 'gather' ? sendHero : '', low = hv && heroLv(S, hv) >= 2 * lv + 8; return hv ? `${fmtN(Math.round(base * (low ? .2 : 1)))} Erfahrung für ${HEROES[hv].name}${low ? ' (Held ist deutlich stärker)' : ''}` : `bis zu ${fmtN(base)} Erfahrung für den Helden`; };
function raiderSheet(w) {
  const r = (w.raiders || []).find(x => x.id === msel.id); if (!r) return null;
  const def = campTroops(r.lv), mult = campMult(r.lv), plan = planFor(r), sel_ = sendList(), free = sendFrom || sendFromOp || ownMarches().length < armySlots(S), cl = campLoot(r.lv);
  let body = `<dl class="stats"><dt>Gegner</dt><dd>Räuber-Armee</dd><dt>Verteidiger</dt><dd>${troopsLine(def)}</dd><dt>Stärke</dt><dd>+${Math.round((mult - 1) * 100)} %</dd><dt>Beute</dt><dd class="costs">${lootHTML({ food: Math.round(cl.food / 2), wood: Math.round(cl.wood / 2), stone: Math.round(cl.stone / 2), gold: Math.round(cl.gold / 2) })}</dd>
    <dt>Erfahrung</dt><dd>${raiderXpText(r.lv)}</dd><dt>Mutkosten</dt><dd>${MUT_COST} Mut je Angriff</dd><dt>Belohnung</dt><dd>Beschleuniger${r.lv >= 5 ? ' und Ressourcenpakete' : ''}</dd><dt>Zieht ab in</dt><dd>${fmtT(real(Math.max(0, r.until - gtNow())))}</dd></dl>`;
  if (view.match.phase !== 'running') body += '<p class="why">Die Partie läuft nicht.</p>';
  else {
    body += pickerHTML();
    if (plan && !plan.error) {
      const r2 = battle(sel_, def, mult, forceOf(S) * (sendHero ? heroForce(S, sendHero, sel_, 'att', 'camp') : 1)), lost = sum(sel_) - sum(r2.attLeft);
      body += `<dl class="stats"><dt>Marsch</dt><dd>${fmtT(real(plan.duration))}</dd><dt>Prognose</dt><dd class="${r2.win ? '' : 'why'}">${r2.win ? `Sieg · du verlierst ${fmtN(lost)} von ${fmtN(sum(sel_))}` : 'Niederlage · dein Heer wird aufgerieben'}</dd></dl>`;
    }
    body += actionRow('Angreifen', plan, '', free);
  }
  return `<div class="sh-head"><h2>Räuber</h2><span class="lvl">Stufe ${r.lv}</span><button class="close" type="button" data-act="close">Schließen</button></div>${body}`;
}
function actionRow(label, plan, why, free, cls = '', act = 'march', minT = 0) {
  const bad = why || (!sum(sendList()) ? 'Wähle Truppen aus.' : !sendFrom && !sendHero ? 'Wähle einen Helden als Anführer.' : sum(sendList()) < minT ? 'Mindestens ' + minT + ' Truppen nötig.' : !free ? 'Alle Heere sind unterwegs.' : plan && plan.error ? plan.error : '');
  return `<div class="row"><button class="btn ${cls}" type="button" data-act="${act}" ${bad ? 'disabled' : ''}>${label}</button>${bad ? `<span class="why">${bad}</span>` : ''}</div>`;
}
function updateMapSheet() {
  if (!msel) return;
  if (mapSignature() !== sheetSig) return renderSheet();
  if (msel.type === 'march') { const m = view.world.marches.find(x => x.id === msel.id), t = $('mTime'); if (m && t) { t.textContent = fmtT(real(Math.max(0, marchRemain(m)))); const pr = $('mProg'), st = marchState(m); if (pr) pr.style.width = Math.round(st.pct * 100) + '%'; const gl = $('mGather'); if (gl && m.own) gl.innerHTML = lootHTML({ [m.res]: Math.floor(m.amount * st.pct) }) + ` <span class="note">von ${fmtN(m.amount)}</span>`; } }
}
function mapAct(act, el) {
  if (!['sminus', 'splus', 'sall', 'shalf', 'snone', 'march', 'recall', 'toCity', 'spy', 'holdRecall', 'build', 'raid', 'fattack', 'garrison', 'opMove', 'opSend', 'teleport', 'opRecall', 'opDis', 'opGoto', 'post', 'patk', 'sfStart', 'sfCancel', 'halt', 'assistA', 'assistD'].includes(act)) return false;
  const u = el.dataset.u;
  if (act === 'splus' || act === 'sminus') {
    const home = S.troops[u] || 0, n = send[u] || 0, step = n >= 100 ? 50 : n >= 20 ? 10 : 5;
    send[u] = Math.max(0, Math.min(home, act === 'splus' ? n + step : n - step)); renderSheet();
  } else if (act === 'sall') { send = {}; for (const k in S.troops) if (S.troops[k] > 0) send[k] = S.troops[k]; renderSheet(); }
  else if (act === 'shalf') { send = {}; for (const k in S.troops) if (S.troops[k] > 0) send[k] = Math.ceil(S.troops[k] / 2); renderSheet(); }
  else if (act === 'snone') { send = {}; renderSheet(); }
  else if (act === 'toCity') setMode('city');
  else if (act === 'march' && msel.type === 'raider') { command({ type: 'march', target: msel.id, troops: sendList() }).then(ok => { if (ok) { toast('Dein Heer marschiert gegen die Räuber.', 'info'); closeSheet(); } }); }
  else if (act === 'march') {
    const o = wm.map.byId[msel.id], pl = o.k === 'start' ? view.match.players.find(x => x.slot === o.slot) : null;
    const mode = o.k === 'start' ? (pl && isAlly(pl.id) ? 'station' : 'attack') : (o.k === 'sanct' || o.k === 'throne') ? 'occupy' : undefined;
    if (mode === 'attack' && !twice('attack' + o.id)) { renderSheet(); return true; }
    command({ type: 'march', target: msel.id, mode, troops: sendList() }).then(ok => { if (ok) { toast(mode === 'attack' ? 'Dein Heer marschiert zum Angriff.' : mode === 'station' ? 'Verstärkung ist unterwegs.' : 'Dein Heer ist unterwegs.', 'info'); closeSheet(); } });
  }
  else if (act === 'fattack') { if (!twice('fattack' + msel.id)) { renderSheet(); return true; } command({ type: 'march', target: msel.id, mode: 'attack', troops: sendList() }).then(ok => { if (ok) { toast('Dein Heer marschiert zum Überfall.', 'info'); closeSheet(); } }); }
  else if (act === 'post') command({ type: 'march', mode: 'post', x: msel.x, y: msel.y, troops: sendList() }).then(ok => { if (ok) { toast('Dein Heer marschiert zum Aufstellen.', 'info'); closeSheet(); } });
  else if (act === 'patk') { const m = view.world.marches.find(x => x.id === msel.id); if (!m) return true; if (!twice('patk' + m.id)) { renderSheet(); return true; } command({ type: 'march', mode: 'attack', target: m.tid, troops: sendList() }).then(ok => { if (ok) { toast('Dein Heer marschiert zum Angriff.', 'info'); closeSheet(); } }); }
  else if (act === 'opSend') { sendFromOp = msel.id; closeSheet(); syncMoveBar(); }
  else if (act === 'sfStart') { sendFrom = msel.id; closeSheet(); syncMoveBar(); }
  else if (act === 'assistA' || act === 'assistD') { const tid = msel.type === 'op' ? msel.id : msel.id; command({ type: 'march', mode: 'assist', target: tid, side: act === 'assistA' ? 'att' : 'def', troops: sendList() }).then(ok => { if (ok) { toast('Verstärkung ist unterwegs.', 'info'); closeSheet(); } }); }
  else if (act === 'halt') command({ type: 'halt', id: msel.id }).then(ok => ok && toast('Das Heer bleibt stehen.', 'info'));
  else if (act === 'sfCancel') { sendFrom = 0; sendFromOp = ''; closeSheet(); syncMoveBar(); }
  else if (act === 'spy') { const st = $('spyStake'), n = st ? Math.floor(Number(st.value)) : 1; spyStakeN = n >= 1 ? n : 1; command({ type: 'spy', target: Number(el.dataset.pid), silver: n }).then(ok => { if (ok) { toast('Dein Späher ist unterwegs. Der Bericht kommt in ' + fmtT(real(SPY_SEC)) + ' unter Berichte.', 'info'); renderSheet(); } }); }
  else if (act === 'holdRecall') command({ type: 'holdRecall', id: msel.id });
  else if (act === 'build') command({ type: 'march', mode: 'build', x: msel.x, y: msel.y, troops: sendList() }).then(ok => { if (ok) { toast('Dein Bautrupp marschiert los.', 'info'); closeSheet(); } });
  else if (act === 'raid') { if (!twice('raid' + msel.id)) { renderSheet(); return true; } command({ type: 'march', mode: 'raid', target: msel.id, troops: sendList() }).then(ok => { if (ok) { toast('Dein Heer marschiert zum Angriff auf den Außenposten.', 'info'); closeSheet(); } }); }
  else if (act === 'garrison') command({ type: 'march', mode: 'garrison', target: msel.id, troops: sendList() }).then(ok => { if (ok) { toast('Verstärkung ist unterwegs.', 'info'); closeSheet(); } });
  else if (act === 'opMove') { const from = msel.id, to = el.dataset.to; command({ type: 'opMove', from, to }).then(ok => ok && toast('Deine Truppen ziehen um.', 'info')); }
  else if (act === 'teleport') { const from = [...S.pos], x = msel.x, y = msel.y; command({ type: 'teleport', x, y }).then(ok => { if (ok) { closeSheet(); wm.teleportFx(from, [x, y]); } }); }
  else if (act === 'opRecall') command({ type: 'opRecall', id: msel.id }).then(ok => ok && toast('Die Besatzung kehrt heim.', 'info'));
  else if (act === 'opDis') { if (!twice('opdis' + msel.id)) { renderSheet(); return true; } command({ type: 'opDismantle', id: msel.id }).then(ok => { if (ok) closeSheet(); }); }
  else if (act === 'recall') command({ type: 'recall', id: msel.id });
  return true;
}

/* ---------- Berichte ---------- */
const unread = () => S.reports.filter(r => !r.read).length;
function ago(t) { const s = Math.max(0, (Date.now() + offset - t) / 1000); return s < 90 ? 'gerade eben' : s < 5400 ? Math.round(s / 60) + ' Min.' : s < 129600 ? Math.round(s / 3600) + ' Std.' : Math.round(s / 86400) + ' Tage'; }
function repTable(head, start, left, w, dd) {
  const us = Object.keys(start || {}).filter(u => U[u]); if (!us.length) return '';
  return `<table class="rep"><thead><tr><th>${esc(head)}</th><th>Vor</th><th>Übrig</th>${w ? '<th>Verw.</th><th>Gef.</th>' : ''}</tr></thead><tbody>${us.map(u => `<tr><td>${U[u].name}</td><td>${fmtN(start[u])}</td><td>${fmtN((left || {})[u] || 0)}</td>${w ? `<td>${fmtN(w[u] || 0)}</td><td>${fmtN((dd || {})[u] || 0)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}
const KIND_DE = { city: 'Sturm auf die Burg', raid: 'Angriff auf einen Außenposten', camp: 'Kampf um ein Banditenlager', field: 'Überfall auf dem Feld', hold: 'Kampf um eine Festung' };
const sumO = o => Object.values(o || {}).reduce((a, b) => a + (+b || 0), 0);
// Gegner-Truppen werden nie in Zahlen gezeigt, nur wie viel Prozent von ihnen gefallen sind
const foeLine = (label, start, left) => { const a = sumO(start), l = sumO(left); return a ? `<p class="note">${esc(label)}: <b>${Math.round(100 * (1 - l / a))} %</b> der Truppen verloren.</p>` : ''; };
function fxHTML(r) {
  const x = r.fx; if (!x) return '';
  const pc = (a, b) => Math.round(Math.max(0, Math.min(1, b ? a / b : 0)) * 100), sm = o => Object.values(o || {}).reduce((a, b) => a + (+b || 0), 0);
  const bar = (cls, v) => `<div class="fxbar"><i class="${cls}" style="width:${v}%"></i></div>`;
  const mine = r.role === 'def' ? 'def' : 'att', wd = r.att ? sm(r.att.wounded) : 0, dd = r.att ? sm(r.att.dead) : 0;
  const helpers = (list, lab) => list && list.length ? `<dt>${lab}</dt><dd>${list.map(esc).join(', ')}</dd>` : '';
  const row = (lab, n0, nL, cls, own) => `<div class="fxrow"><span>${lab}</span><b>${own ? fmtN(n0) + ' → ' + fmtN(nL) : pc(nL, n0) + ' % übrig'}</b></div>${bar(cls, pc(nL, n0))}`;
  return `<div class="fx"><div class="fxh"><b>${KIND_DE[x.kind] || 'Kampf'}</b><span>${r.win ? '🏆 Sieg' : '💀 Niederlage'} · ${fmtT(real(x.dur))} Kampfdauer</span></div>
    ${row('Angreifer' + (x.att ? ' (' + esc(x.att) + ')' : ''), x.na0, x.naL, 'a', mine === 'att')}${row('Verteidiger', x.nd0, x.ndL, 'd', mine === 'def')}
    ${x.wall0 != null ? `<div class="fxrow"><span>Mauer</span><b>${Math.round(x.wall0 * 100)} % → ${Math.round(x.wall * 100)} %</b></div>${bar('w', Math.round(x.wall * 100))}` : ''}
    <dl class="stats"><dt>Deine Gefallenen</dt><dd>${fmtN(mine === 'att' ? x.killD : x.killA)}</dd>
    ${mine === 'att' && (wd || dd) ? `<dt>Dein Heer: tot / verwundet</dt><dd>${fmtN(dd)} / ${fmtN(wd)}</dd>` : ''}
    <dt>Kampfdauer</dt><dd>${fmtT(real(x.dur))}</dd>
    ${helpers(x.helpA, 'Helfer des Angreifers')}${helpers(x.helpD, 'Helfer der Verteidiger')}</dl></div>`;
}
function reportHTML(r) {
  let d = fxHTML(r);
  if (r.att && r.def) {
    if (r.role === 'def') { d += foeLine('Angreifer', r.att.start, r.att.left); for (const g of r.def.groups || []) d += repTable(g.label, g.start, g.left, g.wounded, g.dead); }
    else if (r.role === 'att') d += repTable('Dein Heer', r.att.start, r.att.left, r.att.wounded, r.att.dead) + foeLine('Verteidiger', r.def.start, r.def.left);
    else d += repTable('Dein Heer', r.att.start, r.att.left, r.att.wounded, r.att.dead) + foeLine(r.defLabel || (r.kind === 'camp' ? 'Banditen' : 'Verteidiger'), r.def.start, r.def.left);
  }
  if (r.spy) {
    const sp = r.spy, lvs = Object.keys(sp.lv || {}).filter(k => B[k] && sp.lv[k] > 0).map(k => `${B[k].name} ${sp.lv[k]}`).join(' · '), tch = Object.keys(sp.tech || {}).filter(k => T[k] && sp.tech[k] > 0).map(k => `${T[k].name} ${sp.tech[k]}`).join(' · ');
    d += `<dl class="stats"><dt>Truppen daheim</dt><dd>${troopsLine(sp.home)}</dd>${sp.wounded && Object.keys(sp.wounded).length ? `<dt>Verwundete</dt><dd>${troopsLine(sp.wounded)}</dd>` : ''}<dt>Stadtwache</dt><dd>${troopsLine(sp.guard)}</dd>
      <dt>Verbündete in der Burg</dt><dd>${fmtN(sp.stationed)}</dd><dt>Heere unterwegs</dt><dd>${fmtN(sp.away)} Einheiten</dd><dt>Rohstoffe</dt><dd class="costs">${lootHTML(sp.res)}</dd>
      <dt>Gebäude</dt><dd>${lvs || '—'}</dd><dt>Forschung</dt><dd>${tch || 'keine'}</dd>
      <dt>Schutz</dt><dd>${sp.protectedFor ? 'noch ' + fmtT(real(sp.protectedFor)) : 'keiner'}</dd>${sp.vassalOf ? `<dt>Vasall von</dt><dd>${esc(sp.vassalOf)}</dd>` : ''}</dl>`;
  }
  if (r.text) d += `<p class="desc">${esc(r.text)}</p>`;
  if (r.loot && Object.keys(r.loot).length) d += `<div class="costs">${lootHTML(r.loot)}</div>`;
  return `<details class="report ${r.read ? '' : 'new'} ${r.win ? 'win' : 'loss'}"><summary><span class="ricon">${REP_ICON[r.kind] || '📜'}</span><span class="rt"><b>${esc(r.title)}</b><small>${ago(r.t)}${r.kind === 'camp' || r.kind === 'pvp' ? (r.win ? ' · Sieg' : ' · Niederlage') : ''}</small></span></summary>${d}</details>`;
}
const REP_ICON = { pvp: '⚔️', camp: '🏕️', spy: '🔍', gather: '🌾', return: '🏠' };
const REP_TABS = [['all', 'Alle', () => true], ['fight', 'Kämpfe', r => r.kind === 'pvp' || r.kind === 'camp'], ['spy', 'Späher', r => r.kind === 'spy'], ['march', 'Märsche', r => r.kind === 'gather' || r.kind === 'return']];
function renderReports() {
  const f = (REP_TABS.find(x => x[0] === repTab) || REP_TABS[0])[2], un = S.reports.filter(r => !r.read).length;
  const list = S.reports.filter(f).map(reportHTML).join('') || '<p class="note">Hier ist noch nichts. Schicke ein Heer zu einem Feld, gegen Räuber oder spähe einen Gegner aus.</p>';
  $('reportsInner').innerHTML = phead('📜', 'Berichte', un ? un + ' ungelesen' : S.reports.length + ' Berichte', '<button class="pback" type="button" data-act="rclose">Schließen</button>')
    + ptabs(REP_TABS.map(([id, l, fn]) => [id, l, id === 'all' ? 0 : S.reports.filter(fn).length]), repTab, 'rtab') + list;
}
function openReports() {
  if (panelName) closePanel();
  closeSheet(); renderReports(); $('reports').hidden = false; document.body.classList.add('reports-open'); setNav('reports');
  if (unread()) api('/api/cmd', { type: 'readReports' }).then(r => { if (r.data && r.data.state) { S.reports.forEach(x => { x.read = true; }); renderNav(); } });
}
function closeReports() { $('reports').hidden = true; if (!panelName) document.body.classList.remove('reports-open'); setNav(panelName || mode); }
function renderNav() {
  const f = S ? unreadFeed() + unread() : 0, mb = $('moreBadge'); if (mb) { mb.textContent = f; mb.hidden = !f; }
  const a = view ? (view.invites || []).length + (view.ally ? (view.ally.requests || []).length : 0) : 0, ab = $('allyBadge'); if (ab) { ab.textContent = a; ab.hidden = !a; }
}
function setNav(m) { document.querySelectorAll('.nav button[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === m)); }

/* ---------- Umschalten Stadt / Karte ---------- */
async function buildMap() {
  if (mapReady) return true;
  const el = $('loading'); el.hidden = false; await new Promise(r => setTimeout(r, 40));
  try {
    const r = await api('/api/map'); if (!r.ok) throw new Error(r.data.error || 'Karte nicht verfügbar');
    document.body.classList.add('mode-map');   // damit die Zeichenfläche eine Größe hat
    wm = new WorldMap(THREE, $('stage')); wm.onFlash = () => { const f = document.createElement('div'); f.className = 'tpflash'; document.body.appendChild(f); setTimeout(() => f.remove(), 1400); }; wm.load(r.data); mapReady = true; wm.sync(view, me.id, offset);
    const own = wm.map.starts[S.slot] || { x: 48, y: 48 };
    focusMap(own.x + .5, own.y + .5, Math.min(60, Math.max(34, 26000 / Math.max(360, window.innerWidth) * 1.2)));
    setupInput();
    let last = performance.now();
    const loop = now => { mapLoop = requestAnimationFrame(loop); const dt = Math.min(.1, (now - last) / 1000); last = now; if (mode !== 'map' || document.hidden || document.body.classList.contains('reports-open')) return; placeStep(); wm.frame(dt); homeStep(); };   // hinter einem Menü wird die Karte nicht gezeichnet
    mapLoop = requestAnimationFrame(loop);
    document.body.classList.remove('mode-map');
  } catch (e) { document.body.classList.remove('mode-map'); toast(String(e.message || e)); el.hidden = true; return false; }
  el.hidden = true; return true;
}
async function setMode(m) {
  if (m !== 'map' && (sendFrom || sendFromOp || sendGroup.length)) { sendFrom = 0; sendFromOp = ''; sendGroup = []; syncMoveBar(); }
  placing = false;
  if (!$('reports').hidden) closeReports();
  if (panelName) closePanel();
  if (m === mode && (m === 'city' || mapReady)) return;
  if (m === 'map' && !(await buildMap())) return;
  closeSheet(); mode = m;
  document.body.classList.toggle('mode-map', m === 'map'); setNav(m);
  $('city').hidden = m === 'map'; renderHud(); if (m === 'city') { renderCity(true); city3d(); if (cv) cv.resize(); }
}
function setupNav() {
  $('banner').addEventListener('click', async e => {
    const c = e.target.closest('[data-goto]'); if (!c) return; const [k, id] = c.dataset.goto.split(':');
    await setMode('map'); if (mode === 'map') selectMap(k === 'op' ? { type: 'op', id } : { type: 'obj', id }, true);
  });
  $('nav').addEventListener('click', e => {
    const b = e.target.closest('button[data-nav]'); if (!b) return;
    if (b.dataset.nav === 'ally' || b.dataset.nav === 'heroes' || b.dataset.nav === 'more' || b.dataset.nav === 'train' || b.dataset.nav === 'tech') { if (panelName === b.dataset.nav) return closePanel(); return openPanel(b.dataset.nav); }
    setMode(b.dataset.nav);
  });
  $('reportsInner').addEventListener('click', e => { if (e.target.closest('[data-act=rclose]')) closeReports(); const t = e.target.closest('[data-act=rtab]'); if (t) { repTab = t.dataset.t; renderReports(); } });
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
  setupSheet(); setupModal(); setupPlace(); setupNav(); setupCity(); setupPanel(); setupChat(); live = true; renderNav(); renderTop(); renderHud(); renderCity(true);
  connect(); afterAccept();
  setInterval(resync, 60000);
  window.zkRefresh = resync;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });
  setInterval(() => {
    advanceTo(S, serverNow(), speed); // dieselben Regeln wie auf dem Server, nur zur Anzeige
    renderTop(); renderHud(); renderBanner(); updateSheet(); updateTrainPanel(); if (mode === 'city') updateCity();
  }, 250);
}
window.__zk = { get wm() { return wm; }, get cam() { return wm && wm.cam; }, get sel() { return msel; } };   // nur für Tests
installIcons();
boot();
