// Datenbank: SQLite, direkt in Node.js eingebaut (node:sqlite). Eine Datei, kein Zusatzprogramm.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      speed REAL NOT NULL DEFAULT 1,
      invite TEXT NOT NULL UNIQUE,
      max_players INTEGER NOT NULL DEFAULT 10,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass TEXT NOT NULL,
      state TEXT NOT NULL,
      created INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL
    );
  `);
  return db;
}
