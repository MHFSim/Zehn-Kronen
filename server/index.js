// Zehn Kronen – Spielserver.
// Nur Node.js-Bordmittel: http, crypto, sqlite. Start: `npm start` (Node 22.13 oder neuer).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { syncMatch, addPlayer, command, viewFor, setSpeed, setWeeks, startMatch, pauseMatch, resumeMatch, endMatch, removePlayer, takeNotes } from '../shared/world.js';
import { mapOf, newWorld } from '../shared/core.js';
import { makeVapid, sendPush } from './push.js';
import { mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';

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
const newSeed = () => (randomBytes(4).readUInt32BE() % 2000000000) + 1;

// Admin-Passwort: aus ADMIN_PASSWORD oder beim ersten Start erzeugt und einmal angezeigt
(function setupAdmin() {
  const get = db.prepare('SELECT value FROM settings WHERE key = ?'), set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  if (process.env.ADMIN_PASSWORD) { set.run('admin_pass', hashPass(process.env.ADMIN_PASSWORD)); return; }
  if (get.get('admin_pass')) return;
  const pw = token(9);
  set.run('admin_pass', hashPass(pw));
  console.log('\n  Admin-Passwort (nur jetzt sichtbar, bitte notieren): ' + pw + '\n  Ändern: Server mit ADMIN_PASSWORD=dein-passwort starten.\n');
})();

/* ---------- Push-Benachrichtigungen ---------- */
const vapid = (() => {
  const get = db.prepare('SELECT value FROM settings WHERE key = ?'), set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const r = get.get('vapid'); if (r) return JSON.parse(r.value);
  const v = makeVapid(); set.run('vapid', JSON.stringify(v)); return v;
})();
const PUSH_SUBJECT = process.env.PUSH_SUBJECT || 'mailto:admin@example.com';
// Neue Meldungen der Engine einsammeln und als Push an Spieler schicken, die gerade nicht live verbunden sind
function flushNotes(match) {
  const notes = takeNotes(match); if (!notes.length) return;
  for (const n of notes) {
    if (streams.has(n.pid)) continue;
    const subs = db.prepare('SELECT * FROM push_subs WHERE player_id = ?').all(n.pid);
    for (const sub of subs) {
      sendPush(vapid, PUSH_SUBJECT, { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, { title: n.title, body: n.body, kind: n.kind, url: '/' })
        .then(code => { if (code === 404 || code === 410) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(sub.endpoint); });
    }
  }
}

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

/* ---------- Partie laden und speichern ---------- */
function loadMatch(mid) {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(mid);
  if (!m) return null;
  const match = { id: m.id, name: m.name, speed: m.speed, seed: m.seed || newSeed(), world: m.world ? JSON.parse(m.world) : newWorld(now()) };
  const players = db.prepare('SELECT id, name, state FROM players WHERE match_id = ? ORDER BY created').all(mid)
    .map(r => ({ id: r.id, name: r.name, state: JSON.parse(r.state) }));
  return { match, players };
}
function saveMatch({ match, players }) {
  flushNotes(match);
  db.prepare('UPDATE matches SET world = ?, seed = ?, speed = ? WHERE id = ?').run(JSON.stringify(match.world), match.seed, match.speed, match.id);
  const up = db.prepare('UPDATE players SET state = ?, last_seen = ? WHERE id = ?');
  for (const p of players) up.run(JSON.stringify(p.state), now(), p.id);
}
const matchOfPlayer = pid => { const r = db.prepare('SELECT match_id FROM players WHERE id = ?').get(pid); return r ? r.match_id : null; };

/* ---------- Live-Verbindungen (Server-Sent Events) ---------- */
const streams = new Map(); // playerId -> Set(res)
function pushTo(playerId, view) {
  const set = streams.get(playerId); if (!set) return;
  const msg = 'event: state\ndata: ' + JSON.stringify(view) + '\n\n';
  for (const res of set) res.write(msg);
}
function pushMatch(ctx) {
  const t = now();
  for (const p of ctx.players) if (streams.has(p.id)) pushTo(p.id, viewFor(ctx.match, ctx.players, p, t));
}
setInterval(() => { for (const set of streams.values()) for (const res of set) res.write(': ping\n\n'); }, 25000).unref();
// Ereignisse (Ankunft, Sammeln fertig, Kampf, Spielende) auch ohne Anfrage abarbeiten.
// Partien mit Live-Verbindung alle 2 s, alle anderen alle 16 s (damit Push-Meldungen auch Offline-Spieler erreichen).
let tick = 0;
setInterval(() => {
  tick++;
  const live = new Set(); for (const pid of streams.keys()) { const m = matchOfPlayer(pid); if (m) live.add(m); }
  const ids = tick % 8 === 0 ? db.prepare('SELECT id FROM matches').all().map(r => r.id) : [...live];
  for (const mid of ids) {
    const ctx = loadMatch(mid); if (!ctx || ctx.match.world.phase === 'lobby') continue;
    const r = syncMatch(ctx.match, ctx.players, now());
    if (r.events) { saveMatch(ctx); pushMatch(ctx); }
  }
}, 2000).unref();

const clientIp = req => (process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';

/* ---------- Schutz vor Passwort-Raten ---------- */
const attempts = new Map();
function tooMany(req) {
  const ip = clientIp(req), t = now(), list = (attempts.get(ip) || []).filter(x => t - x < 60000);
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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
async function serveFile(res, rel) {
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(join(ROOT, 'public')) && !file.startsWith(join(ROOT, 'shared'))) return fail(res, 404, 'Nicht gefunden');
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(buf);
  } catch { fail(res, 404, 'Nicht gefunden'); }
}

// Impressum und Datenschutz: eigene Fassung aus data/<name>.html, sonst die Vorlage aus public/
async function serveLegal(res, name) {
  const own = join(DATA, name + '.html');
  try { const buf = await readFile(existsSync(own) ? own : join(ROOT, 'public', name + '.html')); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(buf); }
  catch { fail(res, 404, 'Nicht gefunden'); }
}

/* ---------- Datensicherung ---------- */
const BACKUPS = join(DATA, 'backups');
function backupNow() {
  mkdirSync(BACKUPS, { recursive: true });
  const d = new Date(), name = 'zehn-kronen-' + d.toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.sqlite';
  db.exec(`VACUUM INTO '${join(BACKUPS, name).replace(/'/g, "''")}'`);
  const all = readdirSync(BACKUPS).filter(f => f.endsWith('.sqlite')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 14))) { try { unlinkSync(join(BACKUPS, f)); } catch {} }
  return name;
}
// Einmal beim Start (falls heute noch keine Sicherung existiert) und dann alle 24 Stunden
(function scheduleBackups() {
  try { const today = new Date().toISOString().slice(0, 10); if (!existsSync(BACKUPS) || !readdirSync(BACKUPS).some(f => f.includes(today))) backupNow(); } catch (e) { console.error('Backup fehlgeschlagen:', e.message); }
  setInterval(() => { try { backupNow(); } catch (e) { console.error('Backup fehlgeschlagen:', e.message); } }, 86400000).unref();
})();

// Spieler der Sitzung samt Partie laden und auf jetzt bringen
function playerCtx(req) {
  const s = sessionOf(req); if (!s || !s.player_id) return null;
  const mid = matchOfPlayer(s.player_id); if (!mid) return null;
  const ctx = loadMatch(mid); if (!ctx) return null;
  const me = ctx.players.find(p => p.id === s.player_id); if (!me) return null;
  return { ...ctx, me };
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
    if (db.prepare('SELECT 1 FROM players WHERE name = ?').get(name.trim())) return fail(res, 409, 'Dieser Name ist schon vergeben.');
    const ctx = loadMatch(m.id), t = now();
    if (ctx.match.world.phase === 'ended') return fail(res, 409, 'Diese Partie ist schon beendet.');
    const S = addPlayer(ctx.match, ctx.players, 0, name.trim(), t);
    if (!S) return fail(res, 409, 'Diese Partie ist voll.');
    const r = db.prepare('INSERT INTO players (match_id, name, pass, state, created, last_seen, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, name.trim(), hashPass(password), JSON.stringify(S), t, t, sha('zk' + clientIp(req)));
    const me = { id: Number(r.lastInsertRowid), name: name.trim(), state: S };
    ctx.players.push(me); saveMatch(ctx); pushMatch(ctx);
    setCookie(req, res, newSession(me.id, false), 60 * 86400);
    send(res, 200, viewFor(ctx.match, ctx.players, me, t));
  },
  'POST /api/login': async (req, res) => {
    if (tooMany(req)) return fail(res, 429, 'Zu viele Versuche. Bitte eine Minute warten.');
    const { name, password } = await readBody(req);
    const p = db.prepare('SELECT id, pass FROM players WHERE name = ?').get(String(name || '').trim());
    if (!p || !checkPass(String(password || ''), p.pass)) return fail(res, 401, 'Name oder Passwort stimmt nicht.');
    setCookie(req, res, newSession(p.id, false), 60 * 86400);
    const ctx = loadMatch(matchOfPlayer(p.id)), t = now();
    syncMatch(ctx.match, ctx.players, t); saveMatch(ctx);
    send(res, 200, viewFor(ctx.match, ctx.players, ctx.players.find(x => x.id === p.id), t));
  },
  'POST /api/logout': (req, res) => {
    const t = readCookie(req, 'zk'); if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(t));
    setCookie(req, res, '', 0); send(res, 200, { ok: true });
  },
  'GET /api/me': (req, res) => {
    const c = playerCtx(req); if (!c) return fail(res, 401, 'Nicht angemeldet');
    const t = now(), r = syncMatch(c.match, c.players, t);
    if (r.events) { saveMatch(c); pushMatch(c); }
    send(res, 200, viewFor(c.match, c.players, c.me, t));
  },
  'GET /api/map': (req, res) => {
    const c = playerCtx(req); if (!c) return fail(res, 401, 'Nicht angemeldet');
    if (!db.prepare('SELECT seed FROM matches WHERE id = ?').get(c.match.id).seed) saveMatch(c);
    send(res, 200, { seed: c.match.seed, objects: mapOf(c.match).objects });
  },
  'POST /api/cmd': async (req, res) => {
    const c = playerCtx(req); if (!c) return fail(res, 401, 'Nicht angemeldet');
    const cmd = await readBody(req), t = now();
    const err = command(c.match, c.players, c.me, cmd, t);
    saveMatch(c);
    const v = viewFor(c.match, c.players, c.me, t);
    if (err) return send(res, 400, { error: err, ...v });
    pushMatch(c); send(res, 200, v);
  },
  'POST /api/password': async (req, res) => {
    const s = sessionOf(req); if (!s || !s.player_id) return fail(res, 401, 'Nicht angemeldet');
    if (tooMany(req)) return fail(res, 429, 'Zu viele Versuche. Bitte eine Minute warten.');
    const { old, password } = await readBody(req);
    const p = db.prepare('SELECT pass FROM players WHERE id = ?').get(s.player_id);
    if (!p || !checkPass(String(old || ''), p.pass)) return fail(res, 401, 'Das alte Passwort stimmt nicht.');
    if (!validPass(password)) return fail(res, 400, 'Neues Passwort: mindestens 6 Zeichen.');
    db.prepare('UPDATE players SET pass = ? WHERE id = ?').run(hashPass(password), s.player_id);
    send(res, 200, { ok: true });
  },
  'GET /api/push/key': (req, res) => send(res, 200, { key: vapid.pub }),
  'POST /api/push/subscribe': async (req, res) => {
    const s = sessionOf(req); if (!s || !s.player_id) return fail(res, 401, 'Nicht angemeldet');
    const b = await readBody(req), k = b.keys || {};
    if (typeof b.endpoint !== 'string' || !b.endpoint.startsWith('https://') || b.endpoint.length > 600 || typeof k.p256dh !== 'string' || typeof k.auth !== 'string') return fail(res, 400, 'Ungültiges Abo');
    db.prepare('INSERT OR REPLACE INTO push_subs (endpoint, player_id, p256dh, auth, created) VALUES (?, ?, ?, ?, ?)').run(b.endpoint, s.player_id, k.p256dh, k.auth, now());
    send(res, 200, { ok: true });
  },
  'POST /api/push/unsubscribe': async (req, res) => {
    const s = sessionOf(req); if (!s || !s.player_id) return fail(res, 401, 'Nicht angemeldet');
    const b = await readBody(req);
    db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND player_id = ?').run(String(b.endpoint || ''), s.player_id);
    send(res, 200, { ok: true });
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
    const t = now();
    const matches = db.prepare('SELECT id FROM matches ORDER BY created DESC').all().map(({ id }) => {
      const c = loadMatch(id); syncMatch(c.match, c.players, t); saveMatch(c);
      const row = db.prepare('SELECT invite, max_players, created FROM matches WHERE id = ?').get(id), w = c.match.world;
      const ips = {}; for (const r of db.prepare('SELECT id, ip_hash FROM players WHERE match_id = ?').all(id)) if (r.ip_hash) (ips[r.ip_hash] = ips[r.ip_hash] || []).push(r.id);
      return { id, name: c.match.name, speed: c.match.speed, ...row, phase: w.phase, weeks: w.weeks, gt: w.gt, startGt: w.startGt, endGt: w.endGt, result: w.result && { label: w.result.label, kind: w.result.kind },
        players: c.players.map(p => {
          const r = db.prepare('SELECT last_seen, ip_hash FROM players WHERE id = ?').get(p.id);
          const same = r.ip_hash ? (ips[r.ip_hash] || []).filter(x => x !== p.id).map(x => (c.players.find(q => q.id === x) || {}).name).filter(Boolean) : [];
          return { id: p.id, name: p.name, rathaus: p.state.lv.rathaus, out: !!p.state.out, vassalOf: p.state.vassalOf || 0, sameIp: same, push: db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE player_id = ?').get(p.id).n,
            troops: Object.values(p.state.troops).reduce((a, b) => a + b, 0) + Object.values(p.state.away || {}).reduce((a, b) => a + b, 0), lastSeen: r.last_seen };
        }) };
    });
    const backups = existsSync(BACKUPS) ? readdirSync(BACKUPS).filter(f => f.endsWith('.sqlite')).sort().reverse().slice(0, 5) : [];
    send(res, 200, { matches, now: t, backups });
  },
  'POST /api/admin/match': async (req, res) => {
    if (!isAdmin(req)) return fail(res, 401, 'Nicht als Admin angemeldet');
    const b = await readBody(req);
    const speed = Math.min(1000, Math.max(1, Number(b.speed) || 1)), t = now();
    if (b.action === 'create') {
      const name = String(b.name || '').trim().slice(0, 40) || 'Neue Partie', weeks = Math.min(52, Math.max(1, Math.round(Number(b.weeks)) || 10));
      db.prepare('INSERT INTO matches (name, speed, invite, max_players, created, seed, world) VALUES (?, ?, ?, 10, ?, ?, ?)')
        .run(name, speed, token(9), t, newSeed(), JSON.stringify(newWorld(t, { phase: 'lobby', weeks })));
      return send(res, 200, { ok: true });
    }
    if (b.action === 'invite') { db.prepare('UPDATE matches SET invite = ? WHERE id = ?').run(token(9), Number(b.id)); return send(res, 200, { ok: true }); }
    if (b.action === 'delete') { db.prepare('DELETE FROM matches WHERE id = ?').run(Number(b.id)); return send(res, 200, { ok: true }); }
    if (b.action === 'resetpw') {
      const p = db.prepare('SELECT id FROM players WHERE id = ?').get(Number(b.playerId)); if (!p) return fail(res, 404, 'Spieler nicht gefunden');
      const pw = token(6); db.prepare('UPDATE players SET pass = ? WHERE id = ?').run(hashPass(pw), p.id);
      db.prepare('DELETE FROM sessions WHERE player_id = ?').run(p.id);
      return send(res, 200, { ok: true, password: pw });
    }
    if (b.action === 'backup') { return send(res, 200, { ok: true, file: backupNow() }); }
    const c = loadMatch(Number(b.id)); if (!c) return fail(res, 404, 'Partie nicht gefunden');
    let err = '';
    if (b.action === 'speed') setSpeed(c.match, c.players, speed, t);
    else if (b.action === 'weeks') setWeeks(c.match, c.players, Number(b.weeks), t);
    else if (b.action === 'start') err = startMatch(c.match, c.players, t);
    else if (b.action === 'pause') err = pauseMatch(c.match, c.players, t);
    else if (b.action === 'resume') err = resumeMatch(c.match, c.players, t);
    else if (b.action === 'end') err = endMatch(c.match, c.players, t);
    else if (b.action === 'kick') {
      const pid = Number(b.playerId); if (!c.players.some(p => p.id === pid)) return fail(res, 404, 'Spieler nicht gefunden');
      removePlayer(c.match, c.players, pid, t); c.players = c.players.filter(p => p.id !== pid); saveMatch(c);
      db.prepare('DELETE FROM players WHERE id = ?').run(pid); pushMatch(c); return send(res, 200, { ok: true });
    } else return fail(res, 400, 'Unbekannte Aktion');
    if (err) return fail(res, 400, err);
    saveMatch(c); pushMatch(c);
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
    if (url.pathname === '/sw.js') return serveFile(res, 'public/sw.js');
    if (url.pathname === '/manifest.json') return serveFile(res, 'public/manifest.json');
    if (url.pathname === '/impressum') return serveLegal(res, 'impressum');
    if (url.pathname === '/datenschutz') return serveLegal(res, 'datenschutz');
    if (url.pathname.startsWith('/public/') || url.pathname.startsWith('/shared/')) return serveFile(res, url.pathname.slice(1));
    fail(res, 404, 'Nicht gefunden');
  } catch (e) {
    const soft = e.message === 'kein JSON' || e.message === 'zu groß';
    if (!res.headersSent) fail(res, soft ? 400 : 500, soft ? 'Ungültige Anfrage' : 'Serverfehler');
    if (!soft) console.error(e);
  }
});
server.listen(PORT, () => console.log(`Zehn Kronen läuft auf http://localhost:${PORT}  (Admin: http://localhost:${PORT}/admin)`));
