import { chmodSync, mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname } from 'node:path'

export type AppRow = {
  id: string
  name: string
  app_id: string
  chat_id: string
  app_secret_ref: string
  auth_json: string
  created_at: string
  updated_at: string
}

export type AdminRow = {
  id: number
  password_hash: string
  created_at: string
}

export type SessionRow = {
  id_hash: string
  csrf_token: string
  created_at: string
  expires_at: string
}

export function openDatabase(file: string): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  try { chmodSync(dirname(file), 0o700) } catch {}
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id_hash    TEXT PRIMARY KEY,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS apps (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      app_id          TEXT NOT NULL UNIQUE,
      chat_id         TEXT NOT NULL DEFAULT '',
      app_secret_ref  TEXT NOT NULL,
      auth_json       TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS secrets (
      ref        TEXT PRIMARY KEY,
      ciphertext BLOB NOT NULL,
      iv         BLOB NOT NULL,
      tag        BLOB NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash TEXT PRIMARY KEY,
      app_id     TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `)
  try { chmodSync(file, 0o600) } catch {}
  return db
}
