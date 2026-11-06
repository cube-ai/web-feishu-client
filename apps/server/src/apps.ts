import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AppRow } from './db.js'
import { HttpError } from './http.js'
import { requireString } from './http.js'
import { SecretStore } from './secrets.js'

const APP_ID_RE = /^cli_[A-Za-z0-9_-]{6,}$/u
const DEFAULT_AUTH = {
  authorized: false,
  expiresAt: null,
  scope: null,
  refreshable: false,
  warning: null,
  error: null,
}

export type PublicApp = {
  id: string
  name: string
  appId: string
  chatId: string
  authorized: boolean
  auth: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

function parseAuth(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { ...DEFAULT_AUTH }
  } catch {
    return { ...DEFAULT_AUTH }
  }
}

function toPublic(row: AppRow): PublicApp {
  const auth = parseAuth(row.auth_json)
  return {
    id: row.id,
    name: row.name,
    appId: row.app_id,
    chatId: row.chat_id,
    authorized: auth.authorized === true,
    auth,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class AppsService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly secrets: SecretStore,
  ) {}

  list(): PublicApp[] {
    const rows = this.db.prepare(`
      SELECT id, name, app_id, chat_id, app_secret_ref, auth_json, created_at, updated_at
      FROM apps
      ORDER BY updated_at DESC, created_at DESC
    `).all() as AppRow[]
    return rows.map(toPublic)
  }

  get(id: string): PublicApp {
    return toPublic(this.row(id))
  }

  create(input: { name?: string; appId: string; appSecret: string }): PublicApp {
    const name = (input.name ?? '').trim() || '未命名机器人'
    if (name.length > 60) throw new HttpError(400, '名称不能超过 60 个字符')
    const appId = requireString(input.appId, 'App ID', 120)
    if (!APP_ID_RE.test(appId)) throw new HttpError(400, 'App ID 格式不正确，应以 cli_ 开头')
    const appSecret = requireString(input.appSecret, 'App Secret', 300)
    if (appSecret.length < 8) throw new HttpError(400, 'App Secret 过短')

    const duplicate = this.db.prepare('SELECT id FROM apps WHERE app_id = ?').get(appId)
    if (duplicate) throw new HttpError(409, '这个应用已经添加过')

    const id = `app_${randomBytes(8).toString('hex')}`
    const ref = `${id}_app_secret`
    const now = new Date().toISOString()

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`
        INSERT INTO apps (id, name, app_id, chat_id, app_secret_ref, auth_json, created_at, updated_at)
        VALUES (?, ?, ?, '', ?, ?, ?, ?)
      `).run(id, name, appId, ref, JSON.stringify(DEFAULT_AUTH), now, now)
      this.secrets.set(ref, appSecret)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch {}
      if (error instanceof HttpError) throw error
      throw new HttpError(500, error instanceof Error ? error.message : '保存应用失败')
    }

    return this.get(id)
  }

  rename(id: string, name: string): PublicApp {
    const next = requireString(name, '名称', 60)
    this.row(id)
    this.db.prepare('UPDATE apps SET name = ?, updated_at = ? WHERE id = ?')
      .run(next, new Date().toISOString(), id)
    return this.get(id)
  }

  remove(id: string): void {
    const row = this.row(id)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const ref of [row.app_secret_ref, `${row.id}_user_access_token`, `${row.id}_refresh_token`]) {
        this.db.prepare('DELETE FROM secrets WHERE ref = ?').run(ref)
      }
      this.db.prepare('DELETE FROM apps WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch {}
      throw error
    }
  }

  private row(id: string): AppRow {
    const row = this.db.prepare(`
      SELECT id, name, app_id, chat_id, app_secret_ref, auth_json, created_at, updated_at
      FROM apps WHERE id = ?
    `).get(id) as AppRow | undefined
    if (!row) throw new HttpError(404, '机器人不存在')
    return row
  }
}
