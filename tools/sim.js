// Nur für die Testversion im Chat: bildet den Node.js-Server im Browser nach.
// Gleiche Routen und Antworten wie server/index.js, gespeichert in localStorage dieses Browsers.
// Benutzt dieselbe Spiel-Engine (shared/world.js) wie der echte Server.
import { newWorld, syncMatch, addPlayer, command, viewFor, setSpeed, mapOf } from '/shared/world.js';
const KEY = 'zk-sim-v4';
const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[b % 57]).join('');
let mem = null;
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY)); } catch { mem = null; }
  if (!mem || !mem.matches) {
    mem = { seq: 1, adminPass: 'admin', matches: [], players: [], session: { playerId: null, admin: false } };
    mem.matches.push({ id: mem.seq++, name: 'Testpartie', speed: 10, invite: rnd(10), max_players: 10, created: Date.now(), seed: newSeed(), world: newWorld(Date.now()) });
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
function touch(c) { const r = syncMatch(c.match, c.players, Date.now()); c.me.last_seen = Date.now(); return r; }
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
    const err = command(c.match, c.players, c.me, b, Date.now()); store();
    return err ? R(400, { error: err, ...viewOf(c) }) : R(200, viewOf(c));
  },
  'POST /api/admin/login': b => {
    const db = load(); if (String(b.password || '') !== db.adminPass) return R(401, { error: 'Falsches Admin-Passwort.' });
    db.session.admin = true; store(); return R(200, { ok: true });
  },
  'GET /api/admin/overview': () => {
    const db = load(); if (!db.session.admin) return R(401, { error: 'Nicht als Admin angemeldet' });
    const t = Date.now();
    const matches = db.matches.slice().reverse().map(m => {
      const players = db.players.filter(p => p.match_id === m.id); syncMatch(m, players, t);
      return { id: m.id, name: m.name, speed: m.speed, invite: m.invite, max_players: m.max_players, created: m.created, players: players.map(p => ({
        id: p.id, name: p.name, rathaus: p.state.lv.rathaus,
        troops: Object.values(p.state.troops).reduce((a, c) => a + c, 0) + Object.values(p.state.away || {}).reduce((a, c) => a + c, 0), lastSeen: p.last_seen })) };
    });
    store(); return R(200, { matches, now: t });
  },
  'POST /api/admin/match': b => {
    const db = load(); if (!db.session.admin) return R(401, { error: 'Nicht als Admin angemeldet' });
    const speed = Math.min(1000, Math.max(1, Number(b.speed) || 1)), id = Number(b.id), t = Date.now();
    if (b.action === 'create') db.matches.push({ id: db.seq++, name: String(b.name || '').trim().slice(0, 40) || 'Neue Partie', speed, invite: rnd(10), max_players: 10, created: t, seed: newSeed(), world: newWorld(t) });
    else if (b.action === 'speed') { const m = db.matches.find(x => x.id === id); if (m) setSpeed(m, db.players.filter(p => p.match_id === id), speed, t); }
    else if (b.action === 'invite') { const m = db.matches.find(x => x.id === id); if (m) m.invite = rnd(10); }
    else if (b.action === 'delete') { db.matches = db.matches.filter(x => x.id !== id); db.players = db.players.filter(p => p.match_id !== id); }
    else if (b.action === 'kick') {
      const pid = Number(b.playerId), pl = db.players.find(p => p.id === pid);
      if (pl) { const m = db.matches.find(x => x.id === pl.match_id); syncMatch(m, db.players.filter(p => p.match_id === m.id), t); m.world.marches = m.world.marches.filter(x => x.owner !== pid); }
      db.players = db.players.filter(p => p.id !== pid);
    }
    else return R(400, { error: 'Unbekannte Aktion' });
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
    this.h = {}; setTimeout(() => this.onopen && this.onopen(), 0);
    this.iv = setInterval(() => {
      const c = load().session.playerId && ctxOf(load().session.playerId); if (!c || !this.h.state) return;
      if (touch(c).events) { store(); const v = JSON.stringify(viewOf(c)); this.h.state.forEach(f => f({ data: v })); }
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
