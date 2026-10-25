// Nur für die Testversion im Chat: bildet den Node.js-Server im Browser nach.
// Gleiche Routen und Antworten wie server/index.js, gespeichert in localStorage dieses Browsers.
// Erwartet freshState, advanceTo, applyCommand im umgebenden Gültigkeitsbereich.
const KEY = 'zk-sim-v1';
const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[b % 57]).join('');
let mem = null;
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY)); } catch { mem = null; }
  if (!mem || !mem.matches) {
    mem = { seq: 1, adminPass: 'admin', matches: [], players: [], session: { playerId: null, admin: false } };
    mem.matches.push({ id: mem.seq++, name: 'Testpartie', speed: 10, invite: rnd(10), max_players: 10, created: Date.now() });
  }
  return mem;
}
function store() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch {} }
const validName = n => typeof n === 'string' && /^[\p{L}\p{N} _-]{3,20}$/u.test(n.trim());
const validPass = p => typeof p === 'string' && p.length >= 6 && p.length <= 100;
function loadPlayer(id) {
  const db = load(), p = db.players.find(x => x.id === id); if (!p) return null;
  const m = db.matches.find(x => x.id === p.match_id); if (!m) return null;
  advanceTo(p.state, Date.now(), m.speed); p.last_seen = Date.now();
  return { p, m };
}
function view({ p, m }) {
  const others = load().players.filter(x => x.match_id === m.id).map(x => x.name);
  return { now: Date.now(), me: { name: p.name }, match: { name: m.name, speed: m.speed, players: others }, state: JSON.parse(JSON.stringify(p.state)) };
}
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
    if (db.players.filter(x => x.match_id === m.id).length >= m.max_players) return R(409, { error: 'Diese Partie ist voll.' });
    if (db.players.some(x => x.name.toLowerCase() === b.name.trim().toLowerCase())) return R(409, { error: 'Dieser Name ist schon vergeben.' });
    const t = Date.now(), p = { id: db.seq++, match_id: m.id, name: b.name.trim(), pass: b.password, state: freshState(t), created: t, last_seen: t };
    db.players.push(p); db.session.playerId = p.id; store();
    return R(200, view(loadPlayer(p.id)));
  },
  'POST /api/login': b => {
    const db = load(), p = db.players.find(x => x.name.toLowerCase() === String(b.name || '').trim().toLowerCase());
    if (!p || p.pass !== String(b.password || '')) return R(401, { error: 'Name oder Passwort stimmt nicht.' });
    db.session.playerId = p.id; store();
    return R(200, view(loadPlayer(p.id)));
  },
  'POST /api/logout': () => { load().session.playerId = null; store(); return R(200, { ok: true }); },
  'GET /api/me': () => {
    const db = load(), lp = db.session.playerId && loadPlayer(db.session.playerId);
    if (!lp) return R(401, { error: 'Nicht angemeldet' });
    store(); return R(200, view(lp));
  },
  'POST /api/cmd': b => {
    const db = load(), lp = db.session.playerId && loadPlayer(db.session.playerId);
    if (!lp) return R(401, { error: 'Nicht angemeldet' });
    const err = applyCommand(lp.p.state, b); store();
    return err ? R(400, { error: err, ...view(lp) }) : R(200, view(lp));
  },
  'POST /api/admin/login': b => {
    const db = load(); if (String(b.password || '') !== db.adminPass) return R(401, { error: 'Falsches Admin-Passwort.' });
    db.session.admin = true; store(); return R(200, { ok: true });
  },
  'GET /api/admin/overview': () => {
    const db = load(); if (!db.session.admin) return R(401, { error: 'Nicht als Admin angemeldet' });
    const matches = db.matches.slice().reverse().map(m => ({ ...m, players: db.players.filter(p => p.match_id === m.id).map(p => {
      const st = advanceTo(JSON.parse(JSON.stringify(p.state)), Date.now(), m.speed);
      return { id: p.id, name: p.name, rathaus: st.lv.rathaus, troops: Object.values(st.troops).reduce((a, c) => a + c, 0), lastSeen: p.last_seen };
    }) }));
    return R(200, { matches, now: Date.now() });
  },
  'POST /api/admin/match': b => {
    const db = load(); if (!db.session.admin) return R(401, { error: 'Nicht als Admin angemeldet' });
    const speed = Math.min(1000, Math.max(1, Number(b.speed) || 1)), id = Number(b.id);
    if (b.action === 'create') db.matches.push({ id: db.seq++, name: String(b.name || '').trim().slice(0, 40) || 'Neue Partie', speed, invite: rnd(10), max_players: 10, created: Date.now() });
    else if (b.action === 'speed') { db.players.filter(p => p.match_id === id).forEach(p => loadPlayer(p.id)); const m = db.matches.find(x => x.id === id); if (m) m.speed = speed; }
    else if (b.action === 'invite') { const m = db.matches.find(x => x.id === id); if (m) m.invite = rnd(10); }
    else if (b.action === 'delete') { db.matches = db.matches.filter(x => x.id !== id); db.players = db.players.filter(p => p.match_id !== id); }
    else if (b.action === 'kick') db.players = db.players.filter(p => p.id !== Number(b.playerId));
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
window.EventSource = class { constructor() { setTimeout(() => this.onopen && this.onopen(), 0); } addEventListener() {} close() {} };

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
