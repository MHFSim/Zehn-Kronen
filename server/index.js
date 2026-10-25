// Zehn Kronen – Spielserver.
// Nur Node.js-Bordmittel: http, crypto, sqlite. Start: `npm start` (Node 22.13 oder neuer).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { freshState, advanceTo, applyCommand } from '../shared/rules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
const db = openDb(join(DATA, 'zehn-kronen.sqlite'));
const now = () => Date.now();

/* ---------- Passwörter und Sitzungen ---------- */
function hashPass(pw) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(pw, salt, 64).toString('hex');
}
function checkPass(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex'), b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}
const sha = s => createHash('sha256').update(s).digest('hex');
const token = (n = 24) => randomBytes(n).toString('base64url');

// Admin-Passwort: aus ADMIN_PASSWORD oder beim ersten Start erzeugt und einmal angezeigt
(function setupAdmin() {
  const get = db.prepare('SELECT value FROM settings WHERE key = ?'), set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  if (process.env.ADMIN_PASSWORD) { set.run('admin_pass', hashPass(process.env.ADMIN_PASSWORD)); return; }
  if (get.get('admin_pass')) return;
  const pw = token(9);
  set.run('admin_pass', hashPass(pw));
  console.log('\n  Admin-Passwort (nur jetzt sichtbar, bitte notieren): ' + pw + '\n  Ändern: Server mit ADMIN_PASSWORD=dein-passwort starten.\n');
})();

function newSession(playerId, isAdmin) {
  const t = token();
  db.prepare('INSERT INTO sessions (token, player_id, is_admin, created) VALUES (?, ?, ?, ?)').run(sha(t), playerId, isAdmin ? 1 : 0, now());
  return t;
}
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
function sessionOf(req) {
  const t = readCookie(req, 'zk');
  return t ? db.prepare('SELECT * FROM sessions WHERE token = ?').get(sha(t)) : null;
}
function setCookie(req, res, value, maxAge) {
  const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `zk=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

/* ---------- Spieler laden: Zustand bis jetzt nachrechnen ---------- */
function loadPlayer(id) {
  const p = db.prepare('SELECT p.*, m.speed, m.name AS match_name FROM players p JOIN matches m ON m.id = p.match_id WHERE p.id = ?').get(id);
  if (!p) return null;
  const state = advanceTo(JSON.parse(p.state), now(), p.speed);
  return { ...p, state };
}
function savePlayer(p) {
  db.prepare('UPDATE players SET state = ?, last_seen = ? WHERE id = ?').run(JSON.stringify(p.state), now(), p.id);
}
function view(p) {
  const others = db.prepare('SELECT name FROM players WHERE match_id = ? ORDER BY created').all(p.match_id).map(r => r.name);
  return { now: now(), me: { name: p.name }, match: { name: p.match_name, speed: p.speed, players: others }, state: p.state };
}

/* ---------- Live-Verbindungen (Server-Sent Events) ---------- */
const streams = new Map(); // playerId -> Set(res)
function push(playerId, data) {
  const set = streams.get(playerId); if (!set) return;
  const msg = 'event: state\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const res of set) res.write(msg);
}
setInterval(() => { for (const set of streams.values()) for (const res of set) res.write(': ping\n\n'); }, 25000).unref();

/* ---------- Schutz vor Passwort-Raten ---------- */
const attempts = new Map();
function tooMany(req) {
  const ip = req.socket.remoteAddress, t = now(), list = (attempts.get(ip) || []).filter(x => t - x < 60000);
  list.push(t); attempts.set(ip, list);
  return list.length > 12;
}

/* ---------- HTTP-Helfer ---------- */
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
const fail = (res, status, error) => send(res, status, { error });
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 16384) { reject(new Error('zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('kein JSON')); } });
    req.on('error', reject);
  });
}
const validName = n => typeof n === 'string' && /^[\p{L}\p{N} _-]{3,20}$/u.test(n.trim());
const validPass = p => typeof p === 'string' && p.length >= 6 && p.length <= 100;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' };
async function serveFile(res, rel) {
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(join(ROOT, 'public')) && !file.startsWith(join(ROOT, 'shared'))) return fail(res, 404, 'Nicht gefunden');
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(buf);
  } catch { fail(res, 404, 'Nicht gefunden'); }
}

/* ---------- Routen ---------- */
const routes = {
  'GET /api/invite': (req, res, q) => {
    const m = db.prepare('SELECT id, name, max_players FROM matches WHERE invite = ?').get(q.get('code') || '');
    if (!m) return fail(res, 404, 'Diese Einladung gibt es nicht (mehr).');
    const n = db.prepare('SELECT COUNT(*) AS n FROM players WHERE match_id = ?').get(m.id).n;
    send(res, 200, { match: m.name, players: n, max: m.max_players });
  },
  'POST /api/join': async (req, res) => {
    if (tooMany(req)) return fail(res, 429, 'Zu viele Versuche. Bitte eine Minute warten.');
    const { invite, name, password } = await readBody(req);
    const m = db.prepare('SELECT * FROM matches WHERE invite = ?').get(String(invite || ''));
    if (!m) return fail(res, 404, 'Diese Einladung gibt es nicht (mehr).');
    if (!validName(name)) return fail(res, 400, 'Name: 3 bis 20 Zeichen, nur Buchstaben, Ziffern, Leerzeichen, _ und -.');
    if (!validPass(password)) return fail(res, 400, 'Passwort: mindestens 6 Zeichen.');
    const n = db.prepare('SELECT COUNT(*) AS n FROM players WHERE match_id = ?').get(m.id).n;
    if (n >= m.max_players) return fail(res, 409, 'Diese Partie ist voll.');
    if (db.prepare('SELECT 1 FROM players WHERE name = ?').get(name.trim())) return fail(res, 409, 'Dieser Name ist schon vergeben.');
    const t = now();
    const r = db.prepare('INSERT INTO players (match_id, name, pass, state, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
      .run(m.id, name.trim(), hashPass(password), JSON.stringify(freshState(t)), t, t);
    setCookie(req, res, newSession(Number(r.lastInsertRowid), false), 60 * 86400);
    send(res, 200, view(loadPlayer(Number(r.lastInsertRowid))));
  },
  'POST /api/login': async (req, res) => {
    if (tooMany(req)) return fail(res, 429, 'Zu viele Versuche. Bitte eine Minute warten.');
    const { name, password } = await readBody(req);
    const p = db.prepare('SELECT id, pass FROM players WHERE name = ?').get(String(name || '').trim());
    if (!p || !checkPass(String(password || ''), p.pass)) return fail(res, 401, 'Name oder Passwort stimmt nicht.');
    setCookie(req, res, newSession(p.id, false), 60 * 86400);
    send(res, 200, view(loadPlayer(p.id)));
  },
  'POST /api/logout': (req, res) => {
    const t = readCookie(req, 'zk'); if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(t));
    setCookie(req, res, '', 0); send(res, 200, { ok: true });
  },
  'GET /api/me': (req, res) => {
    const s = sessionOf(req); if (!s || !s.player_id) return fail(res, 401, 'Nicht angemeldet');
    const p = loadPlayer(s.player_id); if (!p) return fail(res, 401, 'Nicht angemeldet');
    savePlayer(p); send(res, 200, view(p));
  },
  'POST /api/cmd': async (req, res) => {
    const s = sessionOf(req); if (!s || !s.player_id) return fail(res, 401, 'Nicht angemeldet');
    const cmd = await readBody(req);
    const p = loadPlayer(s.player_id); if (!p) return fail(res, 401, 'Nicht angemeldet');
    const err = applyCommand(p.state, cmd);
    savePlayer(p);
    const v = view(p);
    if (err) return send(res, 400, { error: err, ...v });
    push(p.id, v); send(res, 200, v);
  },
  'GET /api/events': (req, res) => {
    const s = sessionOf(req); if (!s || !s.player_id) return fail(res, 401, 'Nicht angemeldet');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': verbunden\n\n');
    const set = streams.get(s.player_id) || new Set(); set.add(res); streams.set(s.player_id, set);
    req.on('close', () => { set.delete(res); if (!set.size) streams.delete(s.player_id); });
  },

  /* ----- Admin ----- */
  'POST /api/admin/login': async (req, res) => {
    if (tooMany(req)) return fail(res, 429, 'Zu viele Versuche. Bitte eine Minute warten.');
    const { password } = await readBody(req);
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'admin_pass'").get();
    if (!stored || !checkPass(String(password || ''), stored.value)) return fail(res, 401, 'Falsches Admin-Passwort.');
    setCookie(req, res, newSession(null, true), 7 * 86400); send(res, 200, { ok: true });
  },
  'GET /api/admin/overview': (req, res) => {
    if (!isAdmin(req)) return fail(res, 401, 'Nicht als Admin angemeldet');
    const matches = db.prepare('SELECT * FROM matches ORDER BY created DESC').all().map(m => ({
      ...m,
      players: db.prepare('SELECT id, name, state, last_seen FROM players WHERE match_id = ? ORDER BY created').all(m.id).map(p => {
        const st = advanceTo(JSON.parse(p.state), now(), m.speed);
        return { id: p.id, name: p.name, rathaus: st.lv.rathaus, troops: Object.values(st.troops).reduce((a, b) => a + b, 0), lastSeen: p.last_seen };
      })
    }));
    send(res, 200, { matches, now: now() });
  },
  'POST /api/admin/match': async (req, res) => {
    if (!isAdmin(req)) return fail(res, 401, 'Nicht als Admin angemeldet');
    const b = await readBody(req);
    const speed = Math.min(1000, Math.max(1, Number(b.speed) || 1));
    if (b.action === 'create') {
      const name = String(b.name || '').trim().slice(0, 40) || 'Neue Partie';
      db.prepare('INSERT INTO matches (name, speed, invite, max_players, created) VALUES (?, ?, ?, 10, ?)').run(name, speed, token(9), now());
    } else if (b.action === 'speed') {
      // Tempo-Wechsel: erst alle Städte mit dem alten Tempo bis jetzt nachrechnen
      const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(b.id)); if (!m) return fail(res, 404, 'Partie nicht gefunden');
      for (const p of db.prepare('SELECT id FROM players WHERE match_id = ?').all(m.id)) savePlayer(loadPlayer(p.id));
      db.prepare('UPDATE matches SET speed = ? WHERE id = ?').run(speed, m.id);
    } else if (b.action === 'invite') {
      db.prepare('UPDATE matches SET invite = ? WHERE id = ?').run(token(9), Number(b.id));
    } else if (b.action === 'delete') {
      db.prepare('DELETE FROM matches WHERE id = ?').run(Number(b.id));
    } else if (b.action === 'kick') {
      db.prepare('DELETE FROM players WHERE id = ?').run(Number(b.playerId));
    } else return fail(res, 400, 'Unbekannte Aktion');
    send(res, 200, { ok: true });
  }
};
function isAdmin(req) { const s = sessionOf(req); return !!(s && s.is_admin); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const key = req.method + ' ' + url.pathname;
  try {
    if (routes[key]) return await routes[key](req, res, url.searchParams);
    if (req.method !== 'GET') return fail(res, 404, 'Nicht gefunden');
    if (url.pathname === '/' || url.pathname === '/spiel') return serveFile(res, 'public/index.html');
    if (url.pathname === '/admin') return serveFile(res, 'public/admin.html');
    if (url.pathname.startsWith('/public/') || url.pathname === '/shared/rules.js') return serveFile(res, url.pathname.slice(1));
    fail(res, 404, 'Nicht gefunden');
  } catch (e) {
    if (!res.headersSent) fail(res, 400, e.message === 'kein JSON' || e.message === 'zu groß' ? 'Ungültige Anfrage' : 'Serverfehler');
    if (!(e.message === 'kein JSON' || e.message === 'zu groß')) console.error(e);
  }
});
server.listen(PORT, () => console.log(`Zehn Kronen läuft auf http://localhost:${PORT}  (Admin: http://localhost:${PORT}/admin)`));
