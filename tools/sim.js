// Nur für die Testversion im Chat: bildet den Node.js-Server im Browser nach.
// Gleiche Routen und Antworten wie server/index.js, gespeichert in localStorage dieses Browsers.
// Benutzt dieselbe Spiel-Engine (shared/world.js) wie der echte Server.
import { syncMatch, addPlayer, command, viewFor, setSpeed, setWeeks, startMatch, pauseMatch, resumeMatch, endMatch, removePlayer } from '/shared/world.js';
import { newWorld, mapOf, takeNotes } from '/shared/core.js';
import { cheat } from '/shared/cheat.js';
const KEY = 'zk-sim-v10';
const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[b % 57]).join('');
let mem = null;
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY)); } catch { mem = null; }
  if (!mem || !mem.matches) {
    mem = { seq: 1, adminPass: 'admin', matches: [], players: [], session: { playerId: null, admin: false } };
    mem.matches.push({ id: mem.seq++, name: 'Testpartie', speed: 1, invite: rnd(10), max_players: 10, created: Date.now(), seed: newSeed(), world: newWorld(Date.now(), { phase: 'running' }) });
  }
  return mem;
}
function store() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch {} }
const validName = n => typeof n === 'string' && /^[\p{L}\p{N} _-]{3,20}$/u.test(n.trim());
const validPass = p => typeof p === 'string' && p.length >= 6 && p.length <= 100;
const newSeed = () => Math.floor(Math.random() * 2000000000) + 1;
function ctxOf(playerId) {
  const db = load(), p = db.players.find(x => x.id === playerId); if (!p) return null;
  const match = db.matches.find(x => x.id === p.match_id); if (!match) return null;
  const players = db.players.filter(x => x.match_id === match.id);
  return { db, match, players, me: p };
}
function touch(c) { const r = syncMatch(c.match, c.players, Date.now()); takeNotes(c.match); c.me.last_seen = Date.now(); return r; }
const viewOf = c => viewFor(c.match, c.players, c.me, Date.now());
const R = (status, body) => ({ status, body });
const routes = {
  'GET /api/invite': (b, q) => {
    const db = load(), m = db.matches.find(x => x.invite === q.get('code'));
    if (!m) return R(404, { error: 'Diese Einladung gibt es nicht (mehr).' });
    return R(200, { match: m.name, players: db.players.filter(x => x.match_id === m.id).length, max: m.max_players });
  },
  'POST /api/join': b => {
    const db = load(), m = db.matches.find(x => x.invite === String(b.invite || ''));
    if (!m) return R(404, { error: 'Diese Einladung gibt es nicht (mehr).' });
    if (!validName(b.name)) return R(400, { error: 'Name: 3 bis 20 Zeichen, nur Buchstaben, Ziffern, Leerzeichen, _ und -.' });
    if (!validPass(b.password)) return R(400, { error: 'Passwort: mindestens 6 Zeichen.' });
    if (db.players.some(x => x.name.toLowerCase() === b.name.trim().toLowerCase())) return R(409, { error: 'Dieser Name ist schon vergeben.' });
    const players = db.players.filter(x => x.match_id === m.id), t = Date.now();
    const S = addPlayer(m, players, 0, b.name.trim(), t);
    if (m.world.phase === 'ended') return R(409, { error: 'Diese Partie ist schon beendet.' });
    if (!S) return R(409, { error: 'Diese Partie ist voll.' });
    const p = { id: db.seq++, match_id: m.id, name: b.name.trim(), pass: b.password, state: S, created: t, last_seen: t };
    db.players.push(p); db.session.playerId = p.id; store();
    return R(200, viewOf(ctxOf(p.id)));
  },
  'POST /api/login': b => {
    const db = load(), p = db.players.find(x => x.name.toLowerCase() === String(b.name || '').trim().toLowerCase());
    if (!p || p.pass !== String(b.password || '')) return R(401, { error: 'Name oder Passwort stimmt nicht.' });
    db.session.playerId = p.id; const c = ctxOf(p.id); touch(c); store();
    return R(200, viewOf(c));
  },
  'POST /api/logout': () => { load().session.playerId = null; store(); return R(200, { ok: true }); },
  'GET /api/me': () => {
    const c = load().session.playerId && ctxOf(load().session.playerId);
    if (!c) return R(401, { error: 'Nicht angemeldet' });
    touch(c); store(); return R(200, viewOf(c));
  },
  'GET /api/map': () => {
    const c = load().session.playerId && ctxOf(load().session.playerId);
    if (!c) return R(401, { error: 'Nicht angemeldet' });
    return R(200, { seed: c.match.seed, objects: mapOf(c.match).objects });
  },
  'POST /api/cmd': b => {
    const c = load().session.playerId && ctxOf(load().session.playerId);
    if (!c) return R(401, { error: 'Nicht angemeldet' });
    const err = command(c.match, c.players, c.me, b, Date.now()); takeNotes(c.match); store();
    return err ? R(400, { error: err, ...viewOf(c) }) : R(200, viewOf(c));
  },
  'POST /api/password': b => {
    const c = load().session.playerId && ctxOf(load().session.playerId);
    if (!c) return R(401, { error: 'Nicht angemeldet' });
    if (String(b.old || '') !== c.me.pass) return R(401, { error: 'Das alte Passwort stimmt nicht.' });
    if (!validPass(b.password)) return R(400, { error: 'Neues Passwort: mindestens 6 Zeichen.' });
    c.me.pass = b.password; store(); return R(200, { ok: true });
  },
  'GET /api/push/key': () => R(404, { error: 'In der Testversion gibt es keine Push-Nachrichten.' }),
  'POST /api/push/subscribe': () => R(404, { error: 'In der Testversion gibt es keine Push-Nachrichten.' }),
  'POST /api/push/unsubscribe': () => R(200, { ok: true }),
  'POST /api/admin/login': b => {
    const db = load(); if (String(b.password || '') !== db.adminPass) return R(401, { error: 'Falsches Admin-Passwort.' });
    db.session.admin = true; store(); return R(200, { ok: true });
  },
  'GET /api/admin/overview': () => {
    const db = load(); if (!db.session.admin) return R(401, { error: 'Nicht als Admin angemeldet' });
    const t = Date.now();
    const matches = db.matches.slice().reverse().map(m => {
      const players = db.players.filter(p => p.match_id === m.id); syncMatch(m, players, t); takeNotes(m); const w = m.world;
      return { id: m.id, name: m.name, speed: m.speed, invite: m.invite, max_players: m.max_players, created: m.created, phase: w.phase, weeks: w.weeks, gt: w.gt, startGt: w.startGt, endGt: w.endGt,
        result: w.result && { label: w.result.label, kind: w.result.kind }, players: players.map(p => ({
        id: p.id, name: p.name, rathaus: p.state.lv.rathaus, out: !!p.state.out, vassalOf: p.state.vassalOf || 0, sameIp: [], push: 0,
        troops: Object.values(p.state.troops).reduce((a, c) => a + c, 0) + Object.values(p.state.away || {}).reduce((a, c) => a + c, 0), lastSeen: p.last_seen })) };
    });
    store(); return R(200, { matches, now: t, backups: [] });
  },
  'POST /api/admin/match': b => {
    const db = load(); if (!db.session.admin) return R(401, { error: 'Nicht als Admin angemeldet' });
    const speed = Math.min(1000, Math.max(1, Number(b.speed) || 1)), id = Number(b.id), t = Date.now();
    if (b.action === 'create') { db.matches.push({ id: db.seq++, name: String(b.name || '').trim().slice(0, 40) || 'Neue Partie', speed, invite: rnd(10), max_players: 10, created: t, seed: newSeed(), world: newWorld(t, { phase: 'lobby', weeks: Math.min(52, Math.max(1, Math.round(Number(b.weeks)) || 10)) }) }); store(); return R(200, { ok: true }); }
    if (b.action === 'resetpw') { const p = db.players.find(x => x.id === Number(b.playerId)); if (!p) return R(404, { error: 'Spieler nicht gefunden' }); p.pass = rnd(8); store(); return R(200, { ok: true, password: p.pass }); }
    if (b.action === 'backup') return R(200, { ok: true, file: '(nur in der Testversion simuliert)' });
    const m = db.matches.find(x => x.id === id); if (!m) return R(404, { error: 'Partie nicht gefunden' });
    const pl = db.players.filter(p => p.match_id === id); let err = '';
    if (b.action === 'speed') setSpeed(m, pl, speed, t);
    else if (b.action === 'weeks') setWeeks(m, pl, Number(b.weeks), t);
    else if (b.action === 'start') err = startMatch(m, pl, t);
    else if (b.action === 'pause') err = pauseMatch(m, pl, t);
    else if (b.action === 'resume') err = resumeMatch(m, pl, t);
    else if (b.action === 'end') err = endMatch(m, pl, t);
    else if (b.action === 'cheat') {   // in der Testversion wirken Cheats nur auf den angemeldeten Spieler (und dessen Bündnis)
      const me = pl.find(p => p.id === db.session.playerId); if (!me) return R(400, { error: 'Melde dich zuerst im Spiel an (in diesem Browser), dann wirken die Cheats auf dich.' });
      err = cheat(m, pl, { ...(b.cheat || {}), player: me.id }, t);
    }
    else if (b.action === 'invite') m.invite = rnd(10);
    else if (b.action === 'delete') { db.matches = db.matches.filter(x => x.id !== id); db.players = db.players.filter(p => p.match_id !== id); }
    else if (b.action === 'kick') { const pid = Number(b.playerId); if (pl.some(p => p.id === pid)) { removePlayer(m, pl, pid, t); db.players = db.players.filter(p => p.id !== pid); } }
    else return R(400, { error: 'Unbekannte Aktion' });
    if (err) return R(400, { error: err });
    takeNotes(m); db.rev = (db.rev || 0) + 1;
    if (!db.players.some(p => p.id === db.session.playerId)) db.session.playerId = null;
    store(); return R(200, { ok: true });
  }
};
const realFetch = window.fetch.bind(window);
window.fetch = async (url, opts = {}) => {
  const u = new URL(url, 'http://sim.local');
  if (!u.pathname.startsWith('/api/')) return realFetch(url, opts);
  const key = (opts.method || 'GET') + ' ' + u.pathname, h = routes[key];
  let body = {}; try { body = opts.body ? JSON.parse(opts.body) : {}; } catch {}
  const r = h ? h(body, u.searchParams) : R(404, { error: 'Nicht gefunden' });
  await new Promise(res => setTimeout(res, 60)); // kleine Verzögerung wie im Netz
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};
window.EventSource = class {
  constructor() {
    this.h = {}; this.rev = load().rev || 0; setTimeout(() => this.onopen && this.onopen(), 0);
    this.iv = setInterval(() => {
      const c = load().session.playerId && ctxOf(load().session.playerId); if (!c || !this.h.state) return;
      const rev = load().rev || 0, changed = rev !== this.rev; this.rev = rev;
      if (touch(c).events || changed) { store(); const v = JSON.stringify(viewOf(c)); this.h.state.forEach(f => f({ data: v })); }
    }, 2000);
  }
  addEventListener(n, f) { (this.h[n] = this.h[n] || []).push(f); }
  close() { clearInterval(this.iv); }
};

// Test-Hilfen für die Bedienoberfläche
const pref = k => { try { return localStorage.getItem(k); } catch { return null; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
// Einladungscode, der beim Start wie ein geöffneter Einladungslink behandelt wird
window.zkSimInvite = () => {
  const db = load(), o = pref('zk-sim-invite');
  if (o && db.matches.some(m => m.invite === o)) return o;
  return db.matches[0] ? db.matches[0].invite : '';
};
// Zwischen Spiel und Admin wechseln; mit Code: als neuer Spieler über die Einladung beitreten
window.zkSwap = (view, code) => {
  setPref('zk-sim-view', view);
  if (code) { setPref('zk-sim-invite', code); load().session.playerId = null; store(); location.reload(); }
  else if (window.zkShow) window.zkShow(view);
};
window.zkWipe = () => { try { localStorage.removeItem(KEY); localStorage.removeItem('zk-sim-invite'); } catch {} setPref('zk-sim-view', 'game'); location.reload(); };
window.zkViewPref = () => pref('zk-sim-view') || 'game';

/* ---------- Testwerkzeuge (nur Testversion) ---------- */
// Kleine Leiste unten links: Spieler wechseln, Gegner (Bots) anlegen, Zeit vorspulen, Partie starten.
// So lassen sich Angriffe, Bündnisse und der Thron auch allein ausprobieren.
function toolsBar() {
  const bar = document.createElement('div');
  bar.id = 'zkTools';
  bar.style.cssText = 'position:fixed;left:8px;bottom:calc(58px + 12px + env(safe-area-inset-bottom,0px));z-index:9999;font:12px system-ui,sans-serif;color:#e9dfc8';
  bar.innerHTML = '<button id="zkToolsBtn" style="background:#2b241b;color:#d9b25c;border:1px solid #6b5420;border-radius:16px;padding:6px 10px;font:inherit;opacity:.85">🛠 Test</button><div id="zkToolsBox" hidden style="margin-top:6px;background:#1b1712f2;border:1px solid #6b5420;border-radius:10px;padding:10px;width:230px;max-height:60vh;overflow:auto"></div>';
  document.body.appendChild(bar);
  const box = bar.querySelector('#zkToolsBox');
  const cur = () => { const db = load(); return db.session.playerId && ctxOf(db.session.playerId); };
  const bots = ['Aldric', 'Brunhild', 'Cedric', 'Dagny', 'Eberhard', 'Fiona', 'Gunther', 'Hedda', 'Ingolf'];
  const render = () => {
    const db = load(), c = cur(), mid = c ? c.match.id : db.matches[0] && db.matches[0].id, m = db.matches.find(x => x.id === mid);
    if (!m) { box.innerHTML = 'Keine Partie.'; return; }
    const pl = db.players.filter(p => p.match_id === m.id), w = m.world;
    box.innerHTML = '<b>Partie:</b> ' + w.phase + ' · Tag ' + Math.floor(Math.max(0, w.gt - w.startGt) / 86400 + 1) + '<br>'
      + '<div style="margin:6px 0"><b>Spieler wechseln:</b></div>'
      + pl.map(p => '<button data-sw="' + p.id + '" style="display:block;width:100%;text-align:left;margin:2px 0;padding:4px 6px;background:' + (c && c.me.id === p.id ? '#6b5420' : '#2b241b') + ';color:inherit;border:1px solid #4a3d1c;border-radius:6px;font:inherit">' + p.name.replace(/</g, '&lt;') + (p.state.out ? ' ✖' : '') + '</button>').join('')
      + '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">'
      + '<button data-a="bot">+ Gegner</button><button data-a="d1">⏩ 1 Tag</button><button data-a="d5">⏩ 5 Tage</button>'
      + (w.phase === 'lobby' ? '<button data-a="start">Starten</button>' : '') + '<button data-a="wipe">Neu beginnen</button></div>';
    box.querySelectorAll('button[data-a]').forEach(b => { b.style.cssText = 'background:#2b241b;color:#e9dfc8;border:1px solid #4a3d1c;border-radius:6px;padding:4px 6px;font:inherit'; });
  };
  const skip = (m, pl, days) => {
    const ms = days * 86400 / m.speed * 1000;
    syncMatch(m, pl, Date.now()); m.world.at -= ms; for (const p of pl) p.state.at -= ms;
    syncMatch(m, pl, Date.now()); takeNotes(m);
  };
  bar.querySelector('#zkToolsBtn').onclick = () => { box.hidden = !box.hidden; if (!box.hidden) render(); };
  box.addEventListener('click', e => {
    const db = load(), c = cur(), m = c ? c.match : db.matches[0], pl = db.players.filter(p => p.match_id === m.id), t = Date.now();
    const sw = e.target.closest('[data-sw]'), a = e.target.closest('[data-a]');
    if (sw) { db.session.playerId = Number(sw.dataset.sw); store(); location.reload(); return; }
    if (!a) return;
    if (a.dataset.a === 'bot') {
      const name = bots.find(n => !db.players.some(p => p.name === n)) || 'Bot' + db.seq;
      const S = addPlayer(m, pl, 0, name, t); if (!S) { alert('Die Partie ist voll.'); return; }
      Object.assign(S.lv, { rathaus: 3, mauer: 2, kaserne: 2 }); S.troops = { speer: 60, schwert: 40, bogen: 30 };
      db.players.push({ id: db.seq++, match_id: m.id, name, pass: 'bot-' + rnd(8), state: S, created: t, last_seen: t });
    } else if (a.dataset.a === 'd1') skip(m, pl, 1);
    else if (a.dataset.a === 'd5') skip(m, pl, 5);
    else if (a.dataset.a === 'start') startMatch(m, pl, t);
    else if (a.dataset.a === 'wipe') { if (confirm('Alles zurücksetzen?')) window.zkWipe(); return; }
    store(); render();
    if (window.zkRefresh) window.zkRefresh();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', toolsBar); else toolsBar();
