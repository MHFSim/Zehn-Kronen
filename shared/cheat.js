// Cheats für den Admin-Bereich (Tests und Vorführung). Nur über den Admin-Zugang erreichbar, nie über Spielerbefehle.
import { B, U, RES, cap } from './rules.js';
import { ensureState, reveal, flushBits } from './core.js';
import { N } from './mapgen.js';
import { syncMatch } from './world.js';

const num = (v, d = 0, max = 1e9) => Math.max(0, Math.min(max, Math.floor(Number(v)) || d));

export const CHEATS = {
  resources: 'Rohstoffe geben', fill: 'Lager füllen', troops: 'Truppen geben', finish: 'Alle Aufträge fertigstellen', levels: 'Gebäudestufe setzen',
  store: 'Bündnislager füllen', items: 'Gegenstände geben', protection: 'Schutz', reveal: 'Karte aufdecken', outposts: 'Außenposten fertigbauen',
  respawn: 'Lager und Vorkommen erneuern', time: 'Zeit vorspulen'
};

// Gibt '' zurück oder den Fehlertext
export function cheat(match, players, c, now) {
  const w = match.world; if (!w) return 'Keine Welt';
  syncMatch(match, players, now);
  const targets = c.player === 'all' || c.player == null || c.player === '' ? players.filter(p => p.state.slot >= 0 && !p.state.out) : players.filter(p => p.id === Number(c.player));
  // Nur das Bündnis des gewählten Spielers, wenn ein einzelner Spieler gewählt ist
  const alsOf = () => { const all = Object.values(w.alliances || {}); return targets.length === 1 && c.player != null && c.player !== 'all' ? all.filter(a => a.members.includes(targets[0].id)) : all; };
  const needPlayers = ['resources', 'fill', 'troops', 'finish', 'levels', 'items', 'protection', 'reveal'];
  if (needPlayers.includes(c.kind) && !targets.length) return 'Spieler nicht gefunden';
  for (const p of targets) ensureState(p.state);
  switch (c.kind) {
    case 'resources':
      for (const p of targets) for (const r of [...RES, 'gold']) p.state.res[r] = (p.state.res[r] || 0) + num(c[r]);
      return '';
    case 'fill':
      for (const p of targets) { const k = cap(p.state); for (const r of RES) p.state.res[r] = Math.max(p.state.res[r], k); }
      return '';
    case 'troops': {
      const n = num(c.count, 100, 1e6), units = c.unit && U[c.unit] ? [c.unit] : Object.keys(U);
      for (const p of targets) for (const u of units) p.state.troops[u] = (p.state.troops[u] || 0) + n;
      return '';
    }
    case 'finish':
      for (const p of targets) {
        const S = p.state;
        for (const q of S.queue) S.lv[q.id] = q.target; S.queue = [];
        for (const k in S.train) for (const o of S.train[k]) S.troops[o.unit] = (S.troops[o.unit] || 0) + o.count; S.train = {};
        if (S.research) { S.tech = S.tech || {}; S.tech[S.research.id] = S.research.target; S.research = null; }
      }
      return '';
    case 'levels': {
      const L = Math.max(1, Math.min(20, num(c.level, 1)));
      for (const p of targets) { const S = p.state; S.lv.rathaus = L; for (const id in B) if (id !== 'rathaus') S.lv[id] = Math.min(L, B[id].max || 20); S.queue = []; }
      return '';
    }
    case 'store': {
      const n = num(c.amount, 5000);
      for (const al of alsOf()) { al.store = al.store || { food: 0, wood: 0, stone: 0 }; for (const r of RES) al.store[r] += n; }
      return '';
    }
    case 'items':
      for (const p of targets) {
        const S = p.state; S.items = S.items || {};
        for (const id of ['teleport', 'sp5', 'sp15']) if (num(c[id])) S.items[id] = (S.items[id] || 0) + num(c[id], 0, 999);
        if (c.resetTp) S.tpAt = -1e9;
      }
      return '';
    case 'protection':
      for (const p of targets) p.state.protUntil = c.on ? w.gt + 4 * 86400 : 0;
      return '';
    case 'reveal':
      for (const p of targets) { reveal(p.state, N / 2, N / 2, N); flushBits(p.state); }
      return '';
    case 'outposts':
      for (const o of Object.values(w.outposts || {})) if (alsOf().some(a => a.id === o.al)) o.done = Math.min(o.done, w.gt);
      return '';
    case 'respawn':
      w.camps = {}; w.nodes = {}; w.ruins = {};
      return '';
    case 'time': {
      const h = Math.max(0, Math.min(24 * 14, Number(c.hours) || 0)); if (!h) return 'Wie viele Stunden?';
      if (w.phase !== 'running') return 'Die Partie läuft nicht.';
      w.at -= h * 3600 * 1000 / match.speed; syncMatch(match, players, now);
      return '';
    }
    default: return 'Unbekannter Cheat';
  }
}
