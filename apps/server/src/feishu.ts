import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'
import type { AppRow } from './db.js'
import { HttpError } from './http.js'
import { SecretStore } from './secrets.js'

const OPEN_BASE = 'https://open.feishu.cn'
const ACCOUNTS_BASE = 'https://accounts.feishu.cn'
const SCOPES = ['im:message', 'im:message.send_as_user', 'offline_access']
const STATE_TTL_MS = 10 * 60_000

export type ChatAction = {
  label: string
  index: number
  text?: string
  url?: string
}

export type ChatAttachment = {
  kind: 'image' | 'file' | 'audio' | 'video'
  name: string
  size?: number
  mime?: string
  fileKey: string
  resourceType: 'image' | 'file'
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: number
  senderName: string
  actions?: ChatAction[]
  attachments?: ChatAttachment[]
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'amr'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'])

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name)
  return match?.[1]?.toLowerCase() ?? ''
}

function fileKind(name: string): ChatAttachment['kind'] {
  const ext = extensionOf(name)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return 'file'
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\r\n]/g, '_').trim().slice(0, 200)
  return cleaned || 'attachment'
}

type FeishuMessage = {
  message_id?: string
  msg_type?: string
  create_time?: string
  deleted?: boolean
  body?: { content?: string }
  content?: string
  sender?: { id?: string; sender_type?: string }
}

function parseContent(raw: string | undefined): Record<string, unknown> {
  try {
    const value = JSON.parse(raw ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function walkCard(element: unknown, out: string[]): void {
  if (!element) return
  if (Array.isArray(element)) {
    for (const item of element) walkCard(item, out)
    return
  }
  if (typeof element !== 'object') return
  const node = element as Record<string, unknown>
  if (node.tag === 'markdown' && typeof node.content === 'string') {
    out.push(node.content)
    return
  }
  if (node.tag === 'div') {
    const text = (node.text as Record<string, unknown> | undefined)?.content
      ?? (node.text as Record<string, unknown> | undefined)?.text
    if (typeof text === 'string') out.push(text)
  }
  if (node.tag === 'action' || node.tag === 'button') return
  if (node.tag === 'img') out.push('[图片]')
  for (const key of ['elements', 'columns', 'fields']) {
    if (Array.isArray(node[key])) for (const child of node[key]) walkCard(child, out)
  }
}

function cardText(card: Record<string, unknown>): string {
  const parts: string[] = []
  const header = card.header as Record<string, unknown> | undefined
  const title = header?.title as Record<string, unknown> | undefined
  const titleText = title?.content ?? title?.text
  if (typeof titleText === 'string' && titleText.trim()) parts.push(titleText.trim())
  const body = card.body as Record<string, unknown> | undefined
  walkCard(body?.elements ?? card.elements ?? [], parts)
  const text = parts.join('\n').trim()
  return text || '[卡片消息]'
}

function cardActionText(label: string, index: number, messageText: string): string {
  const text = label.trim()
  const approval = /需要你的审批|请精准回复「批准」|批准一次|工具调用审批/.test(messageText)
    && !/已失效|已结束/.test(messageText)
  if (approval) {
    if (/批准|同意|allow|^yes$|^y$/i.test(text)) return '批准'
    if (/拒绝|不同意|reject|deny|^no$|^n$/i.test(text)) return '拒绝'
  }
  return String(index + 1)
}

function cardActions(card: Record<string, unknown>, messageText: string): ChatAction[] {
  const out: ChatAction[] = []
  let choice = 0
  const walk = (element: unknown): void => {
    if (!element) return
    if (Array.isArray(element)) {
      for (const item of element) walk(item)
      return
    }
    if (typeof element !== 'object') return
    const node = element as Record<string, unknown>
    if (node.tag === 'action') {
      if (Array.isArray(node.actions)) for (const action of node.actions) walk(action)
      return
    }
    if (node.tag === 'button') {
      const text = node.text as Record<string, unknown> | undefined
      const label = text?.content ?? text?.text
      if (typeof label === 'string' && label.trim()) {
        const value = node.value as Record<string, unknown> | undefined
        const token = value?.token
        if (typeof token === 'string' && token) {
          const index = choice
          choice += 1
          out.push({ label: label.trim(), index, text: cardActionText(label, index, messageText) })
        } else {
          const behaviors = Array.isArray(node.behaviors) ? node.behaviors : []
          const open = behaviors.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'open_url') as Record<string, unknown> | undefined
          const url = open?.default_url ?? node.url
          if (typeof url === 'string' && /^https?:\/\//.test(url)) out.push({ label: label.trim(), index: choice++, url })
        }
      }
      return
    }
    for (const key of ['elements', 'columns', 'fields']) {
      if (Array.isArray(node[key])) for (const child of node[key]) walk(child)
    }
  }
  const body = card.body as Record<string, unknown> | undefined
  walk(body?.elements ?? card.elements ?? [])
  if (!out.length
    && /需要你的审批|请精准回复「批准」|批准一次|工具调用审批/.test(messageText)
    && !/已失效|已结束/.test(messageText)) {
    out.push({ label: '批准', index: 0, text: '批准' }, { label: '拒绝', index: 1, text: '拒绝' })
  }
  return out.slice(0, 20)
}

function postText(content: Record<string, unknown>): string {
  const post = (content.content && typeof content.content === 'object'
    ? content
    : content.zh_cn ?? content.en_us ?? Object.values(content)[0]) as Record<string, unknown> | undefined
  const rows = Array.isArray(post?.content) ? post.content : []
  const parts: string[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    for (const item of row) {
      if (!item || typeof item !== 'object') continue
      const node = item as Record<string, unknown>
      if (typeof node.text === 'string') parts.push(node.text)
      else if (typeof node.href === 'string' && typeof node.text !== 'string') parts.push(node.href)
    }
  }
  return parts.join('')
}

function postContent(content: Record<string, unknown>): { text: string; attachments: ChatAttachment[] } {
  const post = (content.content && typeof content.content === 'object'
    ? content
    : content.zh_cn ?? content.en_us ?? Object.values(content)[0]) as Record<string, unknown> | undefined
  const rows = Array.isArray(post?.content) ? post.content : []
  const parts: string[] = []
  const attachments: ChatAttachment[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    for (const item of row) {
      if (!item || typeof item !== 'object') continue
      const node = item as Record<string, unknown>
      if (typeof node.text === 'string') parts.push(node.text)
      else if (typeof node.href === 'string' && typeof node.text !== 'string') parts.push(node.href)
      if (node.tag === 'img' && typeof node.image_key === 'string') {
        attachments.push({ kind: 'image', name: '图片', fileKey: node.image_key, resourceType: 'image' })
      }
      if (node.tag === 'media' && typeof node.file_key === 'string') {
        attachments.push({ kind: 'video', name: '视频', fileKey: node.file_key, resourceType: 'file' })
      }
    }
  }
  return { text: parts.join(''), attachments }
}

type AuthState = {
  authorized: boolean
  expiresAt: string | null
  scope: string | null
  refreshable: boolean
  warning: string | null
  error: string | null
  user?: { openId: string; name: string; avatar: string }
}

function parseAuth(raw: string): AuthState {
  try {
    const value = JSON.parse(raw) as Partial<AuthState>
    return {
      authorized: value.authorized === true,
      expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
      scope: typeof value.scope === 'string' ? value.scope : null,
      refreshable: value.refreshable === true,
      warning: typeof value.warning === 'string' ? value.warning : null,
      error: typeof value.error === 'string' ? value.error : null,
      ...(value.user && typeof value.user === 'object' ? { user: value.user } : {}),
    }
  } catch {
    return { authorized: false, expiresAt: null, scope: null, refreshable: false, warning: null, error: null }
  }
}

function hashState(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char))
}

function friendlyFeishuError(code: unknown, message?: unknown): string {
  const map: Record<number, string> = {
    20027: '应用未开通 OAuth 所需权限，请先在开发者后台开通并发布版本',
    20010: '当前用户不在应用可用范围内',
    230027: '应用缺少所需权限，请检查 im:message / im:message:send_as_bot',
    230002: '机器人不在该会话中，请确认单聊',
    99991677: '用户授权已过期，请重新授权',
    99991679: '授权缺少 im:message.send_as_user，请重新授权',
  }
  const numeric = Number(code)
  if (map[numeric]) return map[numeric]
  const suffix = typeof message === 'string' && message.trim() ? `（${message.trim()}）` : ''
  return `飞书接口返回错误 ${String(code ?? '')}${suffix}`
}

export class FeishuService {
  private readonly tenantTokens = new Map<string, { token: string; expiresAt: number }>()

  constructor(
    private readonly db: DatabaseSync,
    private readonly secrets: SecretStore,
  ) { }

  async startOAuth(appId: string): Promise<{ url: string; redirectUri: string }> {
    const app = this.app(appId)
    const secret = this.secret(app, app.app_secret_ref)
    void secret
    const redirectUri = `${config.publicBaseUrl}/api/oauth/callback`
    const state = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString()
    this.cleanupStates()
    this.db.prepare('INSERT INTO oauth_states (state_hash, app_id, expires_at) VALUES (?, ?, ?)')
      .run(hashState(state), app.id, expiresAt)
    const query = new URLSearchParams({
      client_id: app.app_id,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      state,
      prompt: 'consent',
    })
    return {
      url: `${ACCOUNTS_BASE}/open-apis/authen/v1/authorize?${query.toString()}`,
      redirectUri,
    }
  }

  async handleCallback(url: URL): Promise<{ ok: boolean; message: string; appId?: string; warning?: string; html: string }> {
    const state = url.searchParams.get('state') ?? ''
    const row = state
      ? this.db.prepare('SELECT state_hash, app_id, expires_at FROM oauth_states WHERE state_hash = ?')
        .get(hashState(state)) as { state_hash: string; app_id: string; expires_at: string } | undefined
      : undefined
    if (state) this.db.prepare('DELETE FROM oauth_states WHERE state_hash = ?').run(hashState(state))
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      return this.callbackResult(false, '授权已过期，请重新发起')
    }
    const error = url.searchParams.get('error')
    if (error) {
      return this.callbackResult(false, error === 'access_denied' ? '你取消了授权' : '授权未完成')
    }
    const code = url.searchParams.get('code')
    if (!code) return this.callbackResult(false, '授权回调缺少 code')
    const app = this.db.prepare('SELECT id, name, app_id, chat_id, app_secret_ref, auth_json, created_at, updated_at FROM apps WHERE id = ?')
      .get(row.app_id) as AppRow | undefined
    if (!app) return this.callbackResult(false, '这个机器人已被删除')

    try {
      const secret = this.secret(app, app.app_secret_ref)
      const payload = await this.tokenRequest({
        grant_type: 'authorization_code',
        client_id: app.app_id,
        client_secret: secret,
        code,
        redirect_uri: `${config.publicBaseUrl}/api/oauth/callback`,
      })
      // 不要在绑定单聊前先把 authorized=true 写进数据库。否则前端轮询会看到
      // “已授权但 chatId 为空”的中间态，提前停在设置页，等刷新后才看到绑定结果。
      const auth = await this.saveTokens(app, payload, false)
      let warning: string | undefined
      try {
        const discovered = await this.discoverChatWithToken(app, String(payload.access_token ?? ''))
        if (discovered.user) auth.user = discovered.user
        this.updateApp(app.id, { auth, chatId: discovered.chatId })
      } catch (caught) {
        warning = caught instanceof Error ? caught.message : '授权成功，但单聊绑定失败'
        auth.warning = warning
        this.updateApp(app.id, { auth })
      }
      return this.callbackResult(true, '授权成功', app.id, warning)
    } catch (caught) {
      return this.callbackResult(false, caught instanceof Error ? caught.message : '授权失败')
    }
  }

  async discoverChat(appId: string): Promise<{ appId: string; chatId: string }> {
    const app = this.app(appId)
    const access = await this.userToken(app)
    const discovered = await this.discoverChatWithToken(app, access)
    const auth = parseAuth(app.auth_json)
    if (discovered.user) auth.user = discovered.user
    this.updateApp(app.id, { auth, chatId: discovered.chatId })
    return { appId: app.id, chatId: discovered.chatId }
  }

  async testApp(appId: string): Promise<{ bot: { name: string; openId: string }; authorized: boolean; chatBound: boolean }> {
    const app = this.app(appId)
    const token = await this.tenantToken(app)
    const data = await this.feishu(token, '/open-apis/bot/v3/info') as {
      bot?: { app_name?: string; name?: string; open_id?: string }
    }
    const auth = parseAuth(app.auth_json)
    return {
      bot: {
        name: String(data.bot?.app_name ?? data.bot?.name ?? ''),
        openId: String(data.bot?.open_id ?? ''),
      },
      authorized: auth.authorized,
      chatBound: Boolean(app.chat_id),
    }
  }

  setChat(appId: string, chatId: string): void {
    const value = chatId.trim()
    if (!value.startsWith('oc_')) throw new HttpError(400, 'Chat ID 应以 oc_ 开头')
    this.app(appId)
    this.updateApp(appId, { chatId: value })
  }

  async uploadMedia(
    appId: string,
    kind: 'image' | 'file',
    name: string,
    mime: string,
    buffer: Buffer,
  ): Promise<ChatAttachment> {
    const app = this.app(appId)
    if (!app.chat_id) throw new HttpError(400, '请先完成飞书授权和单聊绑定')
    const token = await this.tenantToken(app)
    const safeName = safeFileName(name)
    if (kind === 'image') {
      if (buffer.length > 10 * 1024 * 1024) throw new HttpError(400, '图片不能超过 10MB')
      if (!mime.startsWith('image/') || mime === 'image/svg+xml') {
        throw new HttpError(400, '飞书图片消息不支持该格式；请改用 PNG/JPG/GIF/WebP')
      }
      const form = new FormData()
      form.append('image_type', 'message')
      form.append('image', new Blob([buffer], { type: mime }), safeName)
      const response = await fetch(`${OPEN_BASE}/open-apis/im/v1/images`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
        redirect: 'error',
      })
      const text = await response.text()
      let data: Record<string, unknown> = {}
      try { data = JSON.parse(text) as Record<string, unknown> } catch { }
      if (data.code !== undefined && Number(data.code) !== 0) {
        throw new HttpError(502, friendlyFeishuError(data.code, data.msg), typeof data.code === 'string' ? data.code : undefined)
      }
      const imageKey = String((data.data as Record<string, unknown> | undefined)?.image_key ?? '')
      if (!imageKey) throw new HttpError(502, '飞书图片上传响应缺少 image_key')
      return { kind: 'image', name: safeName, size: buffer.length, mime, fileKey: imageKey, resourceType: 'image' }
    }

    if (buffer.length > 30 * 1024 * 1024) throw new HttpError(400, '附件不能超过 30MB')
    const form = new FormData()
    form.append('file_type', 'stream')
    form.append('file_name', safeName)
    form.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), safeName)
    const response = await fetch(`${OPEN_BASE}/open-apis/im/v1/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
      redirect: 'error',
    })
    const text = await response.text()
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(text) as Record<string, unknown> } catch { }
    if (data.code !== undefined && Number(data.code) !== 0) {
      throw new HttpError(502, friendlyFeishuError(data.code, data.msg), typeof data.code === 'string' ? data.code : undefined)
    }
    const fileKey = String((data.data as Record<string, unknown> | undefined)?.file_key ?? '')
    if (!fileKey) throw new HttpError(502, '飞书文件上传响应缺少 file_key')
    return {
      kind: fileKind(safeName),
      name: safeName,
      size: buffer.length,
      mime: mime || 'application/octet-stream',
      fileKey,
      resourceType: 'file',
    }
  }

  async sendAttachment(
    appId: string,
    text: string,
    attachment: ChatAttachment,
  ): Promise<{ messages: ChatMessage[]; attachmentSent: boolean; warning?: string }> {
    const app = this.app(appId)
    if (!app.chat_id) throw new HttpError(400, '请先完成飞书授权和单聊绑定')
    const messages: ChatMessage[] = []
    if (text.trim()) messages.push(await this.sendText(appId, text))
    try {
      const token = await this.userToken(app)
      const image = attachment.resourceType === 'image'
      const data = await this.feishu(token, '/open-apis/im/v1/messages?receive_id_type=chat_id', {
        method: 'POST',
        body: {
          receive_id: app.chat_id,
          msg_type: image ? 'image' : 'file',
          content: JSON.stringify(image ? { image_key: attachment.fileKey } : { file_key: attachment.fileKey }),
          uuid: randomUUID(),
        },
      }) as { message_id?: string; create_time?: string }
      messages.push({
        id: String(data.message_id ?? randomUUID()),
        role: 'user',
        text: '',
        createdAt: Number(data.create_time) || Date.now(),
        senderName: '你',
        attachments: [attachment],
      })
      return { messages, attachmentSent: true }
    } catch (caught) {
      if (!messages.length) throw caught
      return {
        messages,
        attachmentSent: false,
        warning: caught instanceof Error ? caught.message : '附件发送失败',
      }
    }
  }

  async fetchResource(
    appId: string,
    messageId: string,
    fileKey: string,
    type: 'image' | 'file',
    range?: string,
  ): Promise<Response> {
    const app = this.app(appId)
    if (!app.chat_id) throw new HttpError(400, '请先完成飞书授权和单聊绑定')
    const token = await this.tenantToken(app)
    const query = new URLSearchParams({ type })
    const response = await fetch(
      `${OPEN_BASE}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?${query.toString()}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          ...(type === 'file' && range ? { range } : {}),
        },
        signal: AbortSignal.timeout(120_000),
        redirect: 'error',
      },
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let data: Record<string, unknown> = {}
      try { data = JSON.parse(text) as Record<string, unknown> } catch { }
      const code = data.code
      const message = typeof data.msg === 'string' ? data.msg : `HTTP ${response.status}`
      throw new HttpError(502, friendlyFeishuError(code ?? response.status, message), typeof code === 'string' ? code : undefined)
    }
    return response
  }

  async listMessages(appId: string): Promise<ChatMessage[]> {
    const app = this.app(appId)
    if (!app.chat_id) throw new HttpError(400, '请先完成飞书授权和单聊绑定')
    const token = await this.tenantToken(app)
    const query = new URLSearchParams({
      container_id_type: 'chat',
      container_id: app.chat_id,
      sort_type: 'ByCreateTimeDesc',
      page_size: '50',
      card_msg_content_type: 'user_card_content',
    })
    const data = await this.feishu(token, `/open-apis/im/v1/messages?${query.toString()}`) as { items?: FeishuMessage[] }
    const items = Array.isArray(data.items) ? data.items.slice().reverse() : []
    return items.map((item) => this.normalizeMessage(item, app)).filter((item): item is ChatMessage => item !== null)
  }

  async sendText(appId: string, text: string): Promise<ChatMessage> {
    const app = this.app(appId)
    if (!app.chat_id) throw new HttpError(400, '请先完成飞书授权和单聊绑定')
    const token = await this.userToken(app)
    const data = await this.feishu(token, '/open-apis/im/v1/messages?receive_id_type=chat_id', {
      method: 'POST',
      body: {
        receive_id: app.chat_id,
        msg_type: 'text',
        content: JSON.stringify({ text }),
        uuid: randomUUID(),
      },
    }) as { message_id?: string; create_time?: string }
    return {
      id: String(data.message_id ?? randomUUID()),
      role: 'user',
      text,
      createdAt: Number(data.create_time) || Date.now(),
      senderName: '你',
    }
  }

  private normalizeMessage(item: FeishuMessage, app: AppRow): ChatMessage | null {
    if (!item || item.deleted === true) return null
    const type = item.msg_type ?? 'unknown'
    const content = parseContent(item.body?.content ?? item.content)
    let text = ''
    let attachments: ChatAttachment[] = []
    if (type === 'text') {
      text = String(content.text ?? '')
    } else if (type === 'post') {
      const parsed = postContent(content)
      text = parsed.text
      attachments = parsed.attachments
    } else if (type === 'interactive') {
      text = cardText(content)
    } else if (type === 'image') {
      const key = String(content.image_key ?? '')
      if (key) attachments = [{ kind: 'image', name: '图片', fileKey: key, resourceType: 'image' }]
    } else if (type === 'file') {
      const key = String(content.file_key ?? '')
      const name = safeFileName(String(content.file_name ?? '文件'))
      if (key) attachments = [{
        kind: fileKind(name),
        name,
        ...(Number(content.file_size) ? { size: Number(content.file_size) } : {}),
        fileKey: key,
        resourceType: 'file',
      }]
    } else if (type === 'audio') {
      const key = String(content.file_key ?? '')
      if (key) attachments = [{ kind: 'audio', name: '语音', fileKey: key, resourceType: 'file' }]
    } else if (type === 'media') {
      const key = String(content.file_key ?? '')
      if (key) attachments = [{ kind: 'video', name: '视频', fileKey: key, resourceType: 'file' }]
    } else if (type === 'sticker') {
      text = '[表情]'
    }
    if (!text.trim() && !attachments.length) return null
    const actions = type === 'interactive' ? cardActions(content, text) : []
    const senderType = item.sender?.sender_type ?? ''
    const senderId = item.sender?.id ?? ''
    const role: ChatMessage['role'] = senderType === 'user'
      ? 'user'
      : senderType === 'app' && senderId === app.app_id
        ? 'assistant'
        : 'system'
    return {
      id: String(item.message_id ?? randomUUID()),
      role,
      text,
      createdAt: Number(item.create_time) || Date.now(),
      senderName: role === 'user' ? '你' : role === 'assistant' ? app.name : '系统',
      ...(actions.length ? { actions } : {}),
      ...(attachments.length ? { attachments } : {}),
    }
  }

  private async discoverChatWithToken(app: AppRow, accessToken: string): Promise<{ chatId: string; user?: AuthState['user'] }> {
    const user = await this.feishu(accessToken, '/open-apis/authen/v1/user_info') as {
      open_id?: string; name?: string; avatar_url?: string
    }
    const openId = String(user?.open_id ?? '').trim()
    if (!openId) throw new HttpError(502, '无法获取用户 open_id，请重新授权')

    const tenant = await this.tenantToken(app)
    const sent = await this.feishu(tenant, '/open-apis/im/v1/messages?receive_id_type=open_id', {
      method: 'POST',
      body: {
        receive_id: openId,
        msg_type: 'text',
        content: JSON.stringify({ text: `Web飞书客户端：已绑定「${app.name}」。这条是设置消息，可忽略。` }),
        uuid: randomUUID(),
      },
    }) as { chat_id?: string }
    const chatId = String(sent?.chat_id ?? '').trim()
    if (!chatId) throw new HttpError(502, '机器人发送设置消息后没有返回 chat_id')
    return {
      chatId,
      user: { openId, name: String(user?.name ?? ''), avatar: String(user?.avatar_url ?? '') },
    }
  }

  private async saveTokens(app: AppRow, payload: Record<string, unknown>, persist = true): Promise<AuthState> {
    const accessToken = String(payload.access_token ?? '')
    if (!accessToken) throw new HttpError(502, '飞书授权响应缺少 access_token')
    const refreshToken = String(payload.refresh_token ?? '')
    const expiresIn = Number(payload.expires_in) || 7200
    const scope = String(payload.scope ?? '')
    const granted = new Set(scope.split(/\s+/).filter(Boolean))
    const missing = scope ? SCOPES.filter((item) => item !== 'offline_access' && !granted.has(item)) : []

    this.secrets.set(`${app.id}_user_access_token`, accessToken)
    if (refreshToken) this.secrets.set(`${app.id}_refresh_token`, refreshToken)
    else this.secrets.remove(`${app.id}_refresh_token`)

    const auth: AuthState = {
      authorized: true,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scope: scope || null,
      refreshable: Boolean(refreshToken),
      warning: missing.length ? `授权缺少权限：${missing.join('、')}` : null,
      error: null,
    }
    if (persist) this.updateApp(app.id, { auth })
    return auth
  }

  private async userToken(app: AppRow): Promise<string> {
    const access = this.secrets.get(`${app.id}_user_access_token`)
    const auth = parseAuth(app.auth_json)
    const expiresAt = Date.parse(auth.expiresAt ?? '') || 0
    if (access && (!expiresAt || expiresAt > Date.now() + 120_000)) return access
    if (auth.refreshable) {
      const refreshToken = this.secrets.get(`${app.id}_refresh_token`)
      if (!refreshToken) throw new HttpError(401, '授权已过期，请重新授权')
      const secret = this.secret(app, app.app_secret_ref)
      const payload = await this.tokenRequest({
        grant_type: 'refresh_token',
        client_id: app.app_id,
        client_secret: secret,
        refresh_token: refreshToken,
      })
      const next = await this.saveTokens(app, payload)
      const nextAccess = this.secrets.get(`${app.id}_user_access_token`)
      if (!nextAccess) throw new HttpError(401, '授权已过期，请重新授权')
      void next
      return nextAccess
    }
    if (access) return access
    throw new HttpError(401, '尚未授权飞书账号，请先完成 OAuth')
  }

  private async tokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
    const endpoints = [
      `${ACCOUNTS_BASE}/oauth/v3/token`,
      `${OPEN_BASE}/open-apis/authen/v2/oauth/token`,
    ]
    let last: Record<string, unknown> = {}
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
          redirect: 'error',
        })
        const text = await response.text()
        let data: Record<string, unknown> = {}
        try { data = JSON.parse(text) as Record<string, unknown> } catch { }
        const payload = (data.data && typeof data.data === 'object' ? data.data : data) as Record<string, unknown>
        if (payload.access_token) return payload
        last = payload
      } catch (caught) {
        last = { error: caught instanceof Error ? caught.message : String(caught) }
      }
    }
    const detail = typeof last.error_description === 'string' ? last.error_description : typeof last.error === 'string' ? last.error : typeof last.msg === 'string' ? last.msg : '获取用户令牌失败'
    throw new HttpError(502, `飞书授权失败：${detail}`, typeof last.code === 'string' ? last.code : undefined)
  }

  private async tenantToken(app: AppRow): Promise<string> {
    const cached = this.tenantTokens.get(app.id)
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
    const secret = this.secret(app, app.app_secret_ref)
    const data = await this.postJson(`${OPEN_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
      app_id: app.app_id,
      app_secret: secret,
    })
    if (Number(data.code) !== 0 || typeof data.tenant_access_token !== 'string') {
      throw new HttpError(502, friendlyFeishuError(data.code, data.msg), typeof data.code === 'string' ? data.code : undefined)
    }
    const expiresAt = Date.now() + (Number(data.expire) || 7200) * 1000
    this.tenantTokens.set(app.id, { token: data.tenant_access_token, expiresAt })
    return data.tenant_access_token
  }

  private async feishu(token: string, path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
    const response = await fetch(`${OPEN_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    })
    const text = await response.text()
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(text) as Record<string, unknown> } catch { }
    if (!response.ok && data.code === undefined) throw new HttpError(502, `飞书接口 HTTP ${response.status}`)
    if (data.code !== undefined && Number(data.code) !== 0) {
      throw new HttpError(502, friendlyFeishuError(data.code, data.msg), typeof data.code === 'string' ? data.code : undefined)
    }
    return data.data ?? {}
  }

  private async postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    })
    const text = await response.text()
    try { return JSON.parse(text) as Record<string, unknown> } catch { return { code: 'invalid-json', msg: `HTTP ${response.status}` } }
  }

  private app(id: string): AppRow {
    const row = this.db.prepare('SELECT id, name, app_id, chat_id, app_secret_ref, auth_json, created_at, updated_at FROM apps WHERE id = ?')
      .get(id) as AppRow | undefined
    if (!row) throw new HttpError(404, '机器人不存在')
    return row
  }

  private secret(app: AppRow, ref: string): string {
    const value = this.secrets.get(ref)
    if (!value) throw new HttpError(400, 'App Secret 未保存，请重新添加应用')
    return value
  }

  private updateApp(id: string, patch: { auth?: AuthState; chatId?: string }): void {
    const row = this.db.prepare('SELECT auth_json, chat_id FROM apps WHERE id = ?').get(id) as { auth_json: string; chat_id: string } | undefined
    if (!row) return
    const auth = patch.auth ?? parseAuth(row.auth_json)
    const chatId = patch.chatId ?? row.chat_id
    this.db.prepare('UPDATE apps SET auth_json = ?, chat_id = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(auth), chatId, new Date().toISOString(), id)
  }

  private cleanupStates(): void {
    this.db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(new Date().toISOString())
  }

  private callbackResult(ok: boolean, message: string, appId?: string, warning?: string): { ok: boolean; message: string; appId?: string; warning?: string; html: string } {
    return { ok, message, ...(appId ? { appId } : {}), ...(warning ? { warning } : {}), html: this.callbackPage(ok, message, appId, warning) }
  }

  private callbackPage(ok: boolean, message: string, appId?: string, warning?: string): string {
    const payload = JSON.stringify({
      type: 'web-feishu-client:oauth',
      ok,
      message,
      ...(appId ? { appId } : {}),
      ...(warning ? { warning } : {}),
    }).replaceAll('<', '\\u003c')
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>飞书授权</title>
<style>
:root{color-scheme:light}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f3ec;color:#24221e;font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
.card{padding:28px 32px;border:1px solid #e3ddd1;border-radius:16px;background:#fffdf8;box-shadow:0 18px 50px rgba(45,38,28,.08);max-width:360px;text-align:center}
.mark{width:38px;height:38px;margin:0 auto 14px;display:grid;place-items:center;border-radius:12px;background:#e2eee9;color:#2d6a5e;font-weight:700}
h1{font-size:16px;margin:0 0 8px}
p{margin:0;color:#5e594f;font-size:12px}
</style></head>
<body><div class="card"><div class="mark">${ok ? '✓' : '!'}</div><h1>${ok ? '授权成功' : '授权未完成'}</h1><p>${escapeHtml(message)}</p></div>
<script>
try { if (window.opener) window.opener.postMessage(${payload}, window.location.origin) } catch (error) {}
${ok ? 'setTimeout(function(){ window.close() }, 900)' : ''}
</script></body></html>`
  }
}
