import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import hljs from 'highlight.js/lib/common'
import remarkGfm from 'remark-gfm'
import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  Download,
  FileText,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageSquare,
  Music,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { ApiError, api, type AppItem, type ChatAttachment, type ChatMessage } from './api'
import { normalizeMarkdown } from './markdown'
import './styles.css'

type View = 'empty' | 'new' | 'app' | 'chat'

const chatMessagesCache = new Map<string, ChatMessage[]>()

function setPath(path: string): void {
  if (window.location.pathname !== path) window.history.replaceState({}, '', path)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败'
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'compact' : ''}`}>
      <span className="brand-mark"><Sparkles size={15} strokeWidth={1.8} /></span>
      <span className="brand-word">Web飞书客户端</span>
    </div>
  )
}

function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle className="spinner" size={size} strokeWidth={1.8} />
}

function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: ReactNode
  description: string
  children: ReactNode
}) {
  return (
    <main className="auth-page">
      <section className="auth-art">
        <div className="auth-brand">
          <Brand />
          <span className="brand-tagline">定制化飞书客户端远程接入 DSH 智能体</span>
        </div>
        <div className="art-copy">
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div className="orbit" aria-hidden="true">
          <span className="orbit-ring orbit-ring-a" />
          <span className="orbit-ring orbit-ring-b" />
          <span className="orbit-dot orbit-dot-a" />
          <span className="orbit-dot orbit-dot-b" />
          <span className="orbit-dot orbit-dot-c" />
        </div>
        <div className="art-foot">
          <span className="art-foot-line" />
          <span>单用户 · 本地优先 · 独立部署</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">{children}</div>
      </section>
    </main>
  )
}

function SetupPage({ onDone }: { onDone: () => Promise<void> }) {
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      await api.setup(token, password)
      await onDone()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      eyebrow="FIRST RUN"
      title={<>把对话，安放在<br />一张安静的工作台上。</>}
      description="第一次启动需要设置管理员密码。设置完成后，这个实例只属于你。"
    >
      <div className="auth-card-head">
        <div className="auth-icon"><KeyRound size={18} strokeWidth={1.7} /></div>
        <div>
          <div className="eyebrow">初始化</div>
          <h2>设置管理员密码</h2>
        </div>
      </div>
      <p className="auth-copy">
        设置 token 已输出到服务端控制台，并保存在
        <code>~/.web-feishu-client/setup-token.txt</code>。完成设置后文件会自动删除。
      </p>
      <form className="form-stack" onSubmit={submit}>
        <label className="field">
          <span>设置 token</span>
          <input
            autoFocus
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="从服务端控制台复制"
            autoComplete="one-time-code"
            required
          />
        </label>
        <label className="field">
          <span>管理员密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 8 位"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <label className="field">
          <span>确认密码</span>
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="再输入一次"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button className="button primary wide" type="submit" disabled={busy}>
          {busy ? <Spinner /> : <LockKeyhole size={15} />}
          {busy ? '正在设置…' : '设置并进入'}
        </button>
      </form>
      <div className="form-hint">
        <ShieldCheck size={14} />
        密码只保存为 scrypt 哈希；setup token 一次性使用。
      </div>
    </AuthShell>
  )
}

function LoginPage({ onDone }: { onDone: () => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.login(password)
      await onDone()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      eyebrow="WELCOME BACK"
      title="回到你的飞书工作台。"
      description="一个安静的入口，连接飞书里的机器人，以及远端的 DSH。"
    >
      <div className="auth-card-head">
        <div className="auth-icon"><LockKeyhole size={18} strokeWidth={1.7} /></div>
        <div>
          <div className="eyebrow">单用户模式</div>
          <h2>登录</h2>
        </div>
      </div>
      <p className="auth-copy">输入管理员密码，继续进入工作台。</p>
      <form className="form-stack" onSubmit={submit}>
        <label className="field">
          <span>管理员密码</span>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="输入密码"
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button className="button primary wide" type="submit" disabled={busy}>
          {busy ? <Spinner /> : <ArrowRight size={15} />}
          {busy ? '正在登录…' : '进入工作台'}
        </button>
      </form>
      <div className="form-hint">
        <ShieldCheck size={14} />
        会话保存在 HttpOnly Cookie 中，7 天后过期。
      </div>
    </AuthShell>
  )
}

function AppRow({ app, active, onClick }: { app: AppItem; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`app-row ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="app-avatar"><Bot size={16} strokeWidth={1.7} /></span>
      <span className="app-info">
        <span className="app-name">{app.name}</span>
        <span className="app-meta">{app.appId}</span>
      </span>
      <span className={`app-dot ${app.authorized ? 'ok' : ''}`} title={app.authorized ? '已授权' : '未授权'} />
      <ChevronRight className="app-chevron" size={14} />
    </button>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-art" aria-hidden="true">
        <span className="empty-ring" />
        <span className="empty-ring small" />
        <Sparkles size={22} strokeWidth={1.4} />
      </div>
      <div className="eyebrow">A QUIET WORKSPACE</div>
      <h2>把飞书里的智能体对话，放到这里来...</h2>
      <p>
        先添加一个飞书机器人。凭据会加密保存在本地；下一步接入 OAuth 后，
        就可以在这个页面里收发消息、查看代码和审批。
      </p>
      <button type="button" className="button primary" onClick={onCreate}>
        <Plus size={16} /> 添加第一个飞书机器人
      </button>
    </div>
  )
}

function AppForm({ onCancel, onCreate }: {
  onCancel: () => void
  onCreate: (input: { name: string; appId: string; appSecret: string }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await onCreate({ name, appId, appSecret })
      setName('')
      setAppId('')
      setAppSecret('')
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel form-panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">NEW CONNECTION</div>
          <h2>添加飞书机器人</h2>
          <p>使用目标 DSH 的 @cubeai/dsh-feishu-channels 插件正在使用的同一个飞书应用账号。</p>
        </div>
        <span className="panel-icon"><Bot size={18} strokeWidth={1.7} /></span>
      </div>
      <form className="form-stack" onSubmit={submit}>
        <label className="field">
          <span>显示名称 <em>可选</em></span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：远端 DSH" maxLength={60} />
        </label>
        <label className="field">
          <span>App ID</span>
          <input
            value={appId}
            onChange={(event) => setAppId(event.target.value)}
            placeholder="cli_xxxxxxxxxxxx"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          <span>App Secret</span>
          <input
            type="password"
            value={appSecret}
            onChange={(event) => setAppSecret(event.target.value)}
            placeholder="只在服务端加密保存"
            autoComplete="new-password"
            required
          />
        </label>
        <div className="form-hint">
          <ShieldCheck size={14} />
          Secret 使用 AES-256-GCM 加密，不会返回浏览器。
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="button ghost" onClick={onCancel} disabled={busy}>取消</button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? <Spinner /> : <Check size={15} />}
            {busy ? '保存中…' : '保存机器人'}
          </button>
        </div>
      </form>
    </section>
  )
}

function AppDetail({
  app,
  onRename,
  onDelete,
  onAuthorize,
  onBind,
  onOpenChat,
  onTest,
  onManualBind,
  authorizing,
  binding,
  testing,
  redirectUri,
}: {
  app: AppItem
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  onAuthorize: () => void
  onBind: () => void
  onOpenChat: () => void
  onTest: () => void
  onManualBind: (chatId: string) => Promise<void>
  authorizing: boolean
  binding: boolean
  testing: boolean
  redirectUri: string
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(app.name)
  const [busy, setBusy] = useState(false)
  const [manualBusy, setManualBusy] = useState(false)
  const [manualChatId, setManualChatId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setName(app.name)
    setEditing(false)
    setError('')
  }, [app.id, app.name])

  async function saveName(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onRename(name)
      setEditing(false)
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  async function bindManual(): Promise<void> {
    const value = manualChatId.trim()
    if (!value) return
    setManualBusy(true)
    setError('')
    try {
      await onManualBind(value)
      setManualChatId('')
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setManualBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm(`删除「${app.name}」？服务端的凭据也会一起删除。`)) return
    setBusy(true)
    setError('')
    try { await onDelete() } catch (caught) { setError(messageOf(caught)) } finally { setBusy(false) }
  }

  return (
    <section className="panel detail-panel">
      <div className="detail-head">
        <div className="detail-avatar"><Bot size={22} strokeWidth={1.6} /></div>
        <div className="detail-title">
          <div className="eyebrow">CONNECTION</div>
          {editing ? (
            <form className="rename-form" onSubmit={saveName}>
              <input className="inline-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus />
              <button type="submit" className="button tiny primary" disabled={busy}>保存</button>
              <button type="button" className="button tiny ghost" onClick={() => { setEditing(false); setName(app.name) }}>取消</button>
            </form>
          ) : (
            <h2>{app.name} <button type="button" className="icon-button" title="改名" onClick={() => setEditing(true)}><Pencil size={14} /></button></h2>
          )}
          <p className="mono">{app.appId}</p>
        </div>
        <span className={`status-pill ${app.authorized ? 'ok' : ''}`}>
          <span className="status-dot" />
          {app.authorized ? (app.chatId ? '已绑定' : '已授权') : '未授权'}
        </span>
      </div>

      {app.chatId ? (
        <div className="detail-cta">
          <span className="detail-cta-icon"><MessageSquare size={18} strokeWidth={1.7} /></span>
          <div className="detail-cta-copy">
            <div className="detail-cta-title">单聊已连接</div>
            <div className="detail-cta-desc">可以直接回到对话，继续和远端 DSH 聊天。</div>
          </div>
          <button type="button" className="button primary detail-cta-button" onClick={onOpenChat}>
            进入对话 <ChevronRight size={15} />
          </button>
        </div>
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}

      <div className="detail-grid">
        <div className="info-block">
          <span className="info-label">应用凭据</span>
          <span className="info-value"><ShieldCheck size={15} /> 已加密保存</span>
        </div>
        <div className="info-block">
          <span className="info-label">单聊绑定</span>
          <span className="info-value"><MessageSquare size={15} /> {app.chatId ? '已绑定' : '尚未绑定'}</span>
        </div>
      </div>

      <div className={`connect-card ${app.authorized ? 'connected' : ''}`}>
        <div className="connect-icon"><KeyRound size={18} strokeWidth={1.7} /></div>
        <div className="connect-copy">
          <div className="connect-title">
            {app.authorized
              ? (app.chatId ? '飞书已连接' : '授权成功，等待单聊绑定')
              : '接入飞书 OAuth'}
          </div>
          {app.authorized ? (
            <p>
              {app.chatId
                ? '应用凭据、飞书授权和单聊都已就绪；消息收发将在下一阶段接入。'
                : '飞书账号已授权，但自动绑定单聊没有完成，可以重试。'}
            </p>
          ) : (
            <>
              <p>用飞书账号授权，以你的身份发送消息，并自动发现机器人单聊。</p>
              <div className="redirect-hint">
                飞书后台重定向 URL：<code>{redirectUri}</code>
              </div>
            </>
          )}
          {app.authorized && typeof app.auth.warning === 'string' && app.auth.warning ? (
            <div className="connect-warning">{app.auth.warning}</div>
          ) : null}
        </div>
        <div className="connect-actions">
          <button
            type="button"
            className={`button ${app.authorized && app.chatId ? 'ghost' : 'primary'}`}
            onClick={onAuthorize}
            disabled={authorizing || binding}
          >
            {authorizing ? <Spinner /> : <KeyRound size={15} />}
            {authorizing ? '等待授权…' : app.authorized ? '重新授权' : '开始授权'}
          </button>
          {app.authorized && !app.chatId ? (
            <button type="button" className="button ghost" onClick={onBind} disabled={authorizing || binding}>
              {binding ? <Spinner /> : <MessageSquare size={15} />}
              {binding ? '绑定中…' : '重新绑定单聊'}
            </button>
          ) : null}
          <button type="button" className="button ghost" onClick={onTest} disabled={authorizing || binding || testing}>
            {testing ? <Spinner /> : <RefreshCw size={14} />}
            {testing ? '测试中…' : '测试应用'}
          </button>
        </div>
      </div>

      <div className="danger-zone">
        <div>
          <div className="danger-title">删除机器人</div>
          <p>只删除本应用中的凭据和记录；飞书侧聊天记录不受影响。</p>
        </div>
        <button type="button" className="button danger" onClick={() => { void remove() }} disabled={busy}>
          <Trash2 size={15} /> 删除
        </button>
      </div>
    </section>
  )
}

function formatTime(value: number): string {
  try {
    return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function MarkdownTable({ children }: { children?: ReactNode }) {
  return (
    <div className="chat-table-wrap">
      <table>{children}</table>
    </div>
  )
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children)
  return ''
}

function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement | null>(null)
  const [wrap, setWrap] = useState(false)
  const [copied, setCopied] = useState(false)
  const first = Children.toArray(children)[0]
  const className = isValidElement(first)
    ? String((first.props as { className?: unknown }).className ?? '')
    : ''
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? 'text'
  const code = nodeText(first)
  let highlighted: string | null = null
  if (language !== 'text') {
    try {
      if (hljs.getLanguage(language)) highlighted = hljs.highlight(code, { language }).value
    } catch {
      highlighted = null
    }
  }

  async function copy(): Promise<void> {
    const value = code || ref.current?.textContent || ''
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const area = document.createElement('textarea')
      area.value = value
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className={`chat-code ${wrap ? 'wrap' : ''}`}>
      <div className="chat-code-head">
        <span>{language}</span>
        <span className="chat-code-actions">
          <button type="button" onClick={() => { void copy() }}>{copied ? '已复制' : '复制'}</button>
          <button type="button" onClick={() => setWrap((current) => !current)}>{wrap ? '不换行' : '自动换行'}</button>
        </span>
      </div>
      <pre ref={ref}>
        {highlighted
          ? <code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
          : <code>{code}</code>}
      </pre>
    </div>
  )
}

type PendingAttachment = {
  file: File
  kind: 'image' | 'file'
  previewUrl?: string
}

function formatBytes(value: number | undefined): string {
  if (!value || value <= 0) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function attachmentUrl(appId: string, message: ChatMessage, attachment: ChatAttachment, download = false): string {
  const query = new URLSearchParams({ type: attachment.resourceType })
  if (download) query.set('download', '1')
  if (attachment.name) query.set('name', attachment.name)
  return `/api/apps/${encodeURIComponent(appId)}/messages/${encodeURIComponent(message.id)}/resources/${encodeURIComponent(attachment.fileKey)}?${query.toString()}`
}

function MessageAttachments({
  appId,
  message,
  attachments,
  onPreview,
}: {
  appId: string
  message: ChatMessage
  attachments: ChatAttachment[]
  onPreview: (preview: { url: string; name: string; download: string }) => void
}) {
  return (
    <div className="chat-attachments">
      {attachments.map((attachment, index) => {
        const url = attachmentUrl(appId, message, attachment)
        const download = attachmentUrl(appId, message, attachment, true)
        if (attachment.kind === 'image') {
          return (
            <button
              type="button"
              className="chat-image"
              key={`${attachment.fileKey}:${index}`}
              onClick={() => onPreview({ url, name: attachment.name, download })}
            >
              <img src={url} alt={attachment.name} loading="lazy" />
            </button>
          )
        }
        if (attachment.kind === 'video') {
          return (
            <div className="chat-video" key={`${attachment.fileKey}:${index}`}>
              <video controls preload="metadata" src={url} />
              <div className="chat-attachment-caption">{attachment.name}<a href={download}>下载</a></div>
            </div>
          )
        }
        if (attachment.kind === 'audio') {
          return (
            <div className="chat-audio" key={`${attachment.fileKey}:${index}`}>
              <span className="chat-file-icon"><Music size={15} /></span>
              <div className="chat-audio-main">
                <div className="chat-attachment-name">{attachment.name}</div>
                <audio controls preload="metadata" src={url} />
              </div>
            </div>
          )
        }
        return (
          <div className="chat-file" key={`${attachment.fileKey}:${index}`}>
            <span className="chat-file-icon"><FileText size={16} /></span>
            <div className="chat-file-main">
              <div className="chat-attachment-name">{attachment.name}</div>
              <div className="chat-attachment-meta">{formatBytes(attachment.size) || attachment.mime || '文件'}</div>
            </div>
            <div className="chat-file-actions">
              <a href={url} target="_blank" rel="noreferrer">预览</a>
              <a href={download}><Download size={13} /> 下载</a>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ChatView({ app }: { app: AppItem }) {
  const cacheKey = `${app.id}:${app.chatId}`
  const cachedMessages = chatMessagesCache.get(cacheKey)
  const [messages, setMessages] = useState<ChatMessage[]>(() => cachedMessages ?? [])
  const [loading, setLoading] = useState(!cachedMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [usedActions, setUsedActions] = useState<Record<string, boolean>>({})
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null)
  const [preview, setPreview] = useState<{ url: string; name: string; download: string } | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const atBottomRef = useRef(true)

  function scrollToBottom(): void {
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }

  function updateMessages(update: (current: ChatMessage[]) => ChatMessage[]): void {
    setMessages((current) => {
      const next = update(current)
      chatMessagesCache.set(cacheKey, next)
      return next
    })
  }

  useLayoutEffect(() => {
    if (atBottomRef.current) scrollToBottom()
  }, [messages, app.id, app.chatId])

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    let inFlight = false
    const cached = chatMessagesCache.get(cacheKey)
    if (cached) setMessages(cached)
    setLoading(!cached)
    setError('')
    setUsedActions({})

    function schedule(): void {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
      if (!alive || document.visibilityState !== 'visible') return
      timer = window.setTimeout(() => { void load(false) }, 5000)
    }

    async function load(initial: boolean): Promise<void> {
      if (!alive || inFlight) return
      inFlight = true
      try {
        const list = await api.listMessages(app.id)
        if (!alive) return
        chatMessagesCache.set(cacheKey, list)
        setMessages(list)
        if (initial) setLoading(false)
      } catch (caught) {
        if (!alive) return
        if (initial) {
          setLoading(false)
          setError(messageOf(caught))
        }
      } finally {
        inFlight = false
        schedule()
      }
    }

    function onVisibility(): void {
      if (document.visibilityState === 'visible') {
        if (timer !== undefined) window.clearTimeout(timer)
        timer = undefined
        void load(false)
      } else {
        if (timer !== undefined) window.clearTimeout(timer)
        timer = undefined
      }
    }

    function onFocus(): void {
      if (document.visibilityState === 'visible') {
        if (timer !== undefined) window.clearTimeout(timer)
        timer = undefined
        void load(false)
      }
    }

    void load(true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [app.id])

  useEffect(() => () => {
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
  }, [attachment])

  function actionKey(message: ChatMessage, action: NonNullable<ChatMessage['actions']>[number]): string {
    return `${message.id}:${action.index}`
  }

  function isApprovalAction(action: NonNullable<ChatMessage['actions']>[number]): boolean {
    return action.text === '批准' || action.text === '拒绝'
  }

  async function sendValue(value: string): Promise<boolean> {
    if (!value || sending) return false
    setSending(true)
    setError('')
    try {
      const result = await api.sendMessage(app.id, value)
      const sent = result.messages ?? (result.message ? [result.message] : [])
      updateMessages((current) => {
        const ids = new Set(sent.map((message) => message.id))
        return [...current.filter((message) => !ids.has(message.id)), ...sent]
      })
      atBottomRef.current = true
      return true
    } catch (caught) {
      setError(messageOf(caught))
      return false
    } finally {
      setSending(false)
    }
  }

  function clearAttachment(): void {
    setAttachment((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl)
      return null
    })
  }

  function attachFile(file: File): void {
    const image = file.type.startsWith('image/') && file.type !== 'image/svg+xml'
    const limit = image ? 10 * 1024 * 1024 : 30 * 1024 * 1024
    if (file.size > limit) {
      setError(image ? '图片不能超过 10MB' : '附件不能超过 30MB')
      return
    }
    const named = file.name
      ? file
      : new File(
        [file],
        `pasted-${Date.now()}.${(file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`,
        { type: file.type || 'application/octet-stream' },
      )
    setError('')
    setAttachment((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl)
      return {
        file: named,
        kind: image ? 'image' : 'file',
        ...(image ? { previewUrl: URL.createObjectURL(named) } : {}),
      }
    })
  }

  function selectAttachment(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) attachFile(file)
  }

  function pasteAttachment(event: ClipboardEvent<HTMLTextAreaElement>): void {
    let file: File | undefined = Array.from(event.clipboardData.files)[0]
    if (!file) {
      const item = Array.from(event.clipboardData.items)
        .find((entry) => entry.kind === 'file' && entry.type.startsWith('image/'))
      file = item?.getAsFile() ?? undefined
    }
    if (!file) return
    event.preventDefault()
    attachFile(file)
  }

  async function sendComposer(): Promise<void> {
    const value = text.trim()
    if ((!value && !attachment) || sending) return
    setSending(true)
    setError('')
    try {
      if (attachment) {
        const uploaded = await api.uploadMedia(app.id, attachment.file, attachment.kind)
        const result = await api.sendMessage(app.id, value, uploaded)
        const sent = result.messages ?? (result.message ? [result.message] : [])
        updateMessages((current) => {
          const ids = new Set(sent.map((message) => message.id))
          return [...current.filter((message) => !ids.has(message.id)), ...sent]
        })
        setText('')
        atBottomRef.current = true
        if (result.attachmentSent === false) {
          setError(result.warning || '附件发送失败；文字已发送，附件可以重试')
        } else {
          clearAttachment()
        }
      } else {
        const result = await api.sendMessage(app.id, value)
        const sent = result.messages ?? (result.message ? [result.message] : [])
        updateMessages((current) => {
          const ids = new Set(sent.map((message) => message.id))
          return [...current.filter((message) => !ids.has(message.id)), ...sent]
        })
        setText('')
        atBottomRef.current = true
      }
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setSending(false)
    }
  }

  async function handleAction(message: ChatMessage, action: NonNullable<ChatMessage['actions']>[number]): Promise<void> {
    if (action.url) {
      window.open(action.url, '_blank', 'noreferrer')
      return
    }
    const key = actionKey(message, action)
    if (usedActions[key]) return
    setUsedActions((current) => ({ ...current, [key]: true }))
    const ok = await sendValue(action.text ?? String(action.index + 1))
    if (!ok) {
      setUsedActions((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }

  function actionButton(message: ChatMessage, action: NonNullable<ChatMessage['actions']>[number], approval = false) {
    const key = actionKey(message, action)
    const used = Boolean(usedActions[key])
    const approve = action.text === '批准'
    if (action.url) {
      return (
        <a key={key} className="chat-action" href={action.url} target="_blank" rel="noreferrer">
          {action.label}
        </a>
      )
    }
    return (
      <button
        key={key}
        type="button"
        className={approval ? `chat-approval-btn ${approve ? 'approve' : 'reject'}` : 'chat-action'}
        disabled={used || sending}
        onClick={() => { void handleAction(message, action) }}
      >
        {used ? '已处理' : action.label}
      </button>
    )
  }

  const latestApproval = [...messages].reverse().find((message) => message.actions?.some(isApprovalAction))
  const latestApprovalActions = latestApproval?.actions?.filter(isApprovalAction).filter((action) => !usedActions[actionKey(latestApproval, action)]) ?? []

  return (
    <section className="chat-page">
      {error ? <div className="chat-error">{error}<button type="button" onClick={() => setError('')}><X size={13} /></button></div> : null}

      <div
        className="chat-messages"
        ref={listRef}
        onScroll={(event) => {
          const element = event.currentTarget
          atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        }}
      >
        {loading ? (
          <div className="chat-loading">
            <div className="chat-skeleton" />
            <div className="chat-skeleton short" />
            <div className="chat-skeleton" />
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon"><MessageSquare size={22} strokeWidth={1.5} /></div>
            <div className="eyebrow">CONNECTED</div>
            <h2>已经连接，开始对话。</h2>
            <p>这里会显示你与远端 DSH 的单聊消息。先从一句话开始。</p>
          </div>
        ) : (
          <div className="chat-message-list">
            {messages.map((message) => {
              if (message.role === 'system') {
                return <div className="chat-system" key={message.id}>{message.text}</div>
              }
              const actions = message.actions ?? []
              const approvalActions = actions.filter(isApprovalAction)
              const normalActions = actions.filter((action) => !isApprovalAction(action))
              return (
                <div className={`chat-row ${message.role}`} key={message.id}>
                  {message.role === 'assistant' ? <span className="chat-avatar"><Bot size={15} strokeWidth={1.7} /></span> : null}
                  <div className="chat-message-main">
                    <div className="chat-meta">
                      <span>{message.senderName}</span>
                      <time>{formatTime(message.createdAt)}</time>
                    </div>
                    {message.text ? (
                      <div className={`chat-bubble ${message.role === 'assistant' ? 'markdown' : ''}`}>
                        {message.role === 'assistant'
                          ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: MarkdownCodeBlock, table: MarkdownTable }}>{normalizeMarkdown(message.text)}</ReactMarkdown>
                          : message.text}
                      </div>
                    ) : null}
                    {message.attachments?.length ? (
                      <MessageAttachments
                        appId={app.id}
                        message={message}
                        attachments={message.attachments}
                        onPreview={setPreview}
                      />
                    ) : null}
                    {approvalActions.length ? (
                      <div className="chat-approval">
                        <div className="chat-approval-head">
                          <span className="chat-approval-icon"><ShieldCheck size={14} strokeWidth={1.8} /></span>
                          <div>
                            <div className="chat-approval-title">需要你的审批</div>
                            <div className="chat-approval-desc">点击按钮，或在输入框回复「批准」/「拒绝」。</div>
                          </div>
                        </div>
                        <div className="chat-approval-actions">
                          {approvalActions.map((action) => actionButton(message, action, true))}
                        </div>
                      </div>
                    ) : null}
                    {normalActions.length ? (
                      <div className="chat-actions">
                        {normalActions.map((action) => actionButton(message, action))}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {latestApproval && latestApprovalActions.length ? (
        <div className="chat-approval-bar">
          <span className="chat-approval-icon"><ShieldCheck size={15} strokeWidth={1.8} /></span>
          <div className="chat-approval-bar-main">
            <div className="chat-approval-title">需要你的审批</div>
            <div className="chat-approval-desc">请在有效期内选择；点击即以你的身份回复远端。</div>
          </div>
          <div className="chat-approval-actions">
            {latestApprovalActions.map((action) => actionButton(latestApproval, action, true))}
          </div>
        </div>
      ) : null}

      <div className="chat-composer-wrap">
        <div className="chat-composer">
          {attachment ? (
            <div className="chat-pending">
              {attachment.previewUrl
                ? <img className="chat-pending-thumb" src={attachment.previewUrl} alt="" />
                : <span className="chat-file-icon"><FileText size={16} /></span>}
              <div className="chat-pending-main">
                <div className="chat-attachment-name">{attachment.file.name}</div>
                <div className="chat-attachment-meta">{formatBytes(attachment.file.size) || (attachment.kind === 'image' ? '图片' : '文件')}</div>
              </div>
              <button type="button" className="chat-pending-remove" onClick={clearAttachment} aria-label="移除附件"><X size={14} /></button>
            </div>
          ) : null}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onPaste={pasteAttachment}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendComposer()
              }
            }}
            placeholder="给远端 DSH 发消息…"
            rows={2}
            disabled={sending}
          />
          <div className="chat-composer-foot">
            <button
              type="button"
              className="chat-attach"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title="添加图片或文件"
              aria-label="添加附件"
            >
              <Paperclip size={15} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="chat-file-input"
              onChange={selectAttachment}
              disabled={sending}
            />
            <span>Enter 发送 · Shift+Enter 换行 · 可粘贴图片/文件</span>
            <button type="button" className="button primary" onClick={() => { void sendComposer() }} disabled={sending || (!text.trim() && !attachment)}>
              {sending ? <Spinner /> : <Send size={14} />}
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
        </div>
      </div>
      {preview ? (
        <div className="chat-media-modal" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
          <div className="chat-media-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="chat-media-head">
              <span>{preview.name}</span>
              <span className="chat-media-actions">
                <a href={preview.download}><Download size={14} /> 下载</a>
                <button type="button" onClick={() => setPreview(null)} aria-label="关闭"><X size={17} /></button>
              </span>
            </div>
            <img src={preview.url} alt={preview.name} />
          </div>
        </div>
      ) : null}
    </section>
  )
}

function Workspace({
  apps,
  selectedApp,
  view,
  notice,
  error,
  onClearNotice,
  onClearError,
  onNew,
  onCancelNew,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onAuthorize,
  onBind,
  onOpenChat,
  onSettings,
  onTest,
  onManualBind,
  authorizingId,
  testingId,
  bindingId,
  redirectUri,
  onLogout,
}: {
  apps: AppItem[]
  selectedApp?: AppItem
  view: View
  notice: string
  error: string
  onClearNotice: () => void
  onClearError: () => void
  onNew: () => void
  onCancelNew: () => void
  onSelect: (app: AppItem) => void
  onCreate: (input: { name: string; appId: string; appSecret: string }) => Promise<void>
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  onAuthorize: () => void
  onBind: () => void
  onOpenChat: () => void
  onSettings: () => void
  onTest: () => void
  onManualBind: (chatId: string) => Promise<void>
  authorizingId: string
  testingId: string
  bindingId: string
  redirectUri: string
  onLogout: () => Promise<void>
}) {
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-head">
          <Brand compact />
          <span className="local-badge">LOCAL</span>
        </div>
        <button type="button" className="new-bot" onClick={onNew}>
          <Plus size={15} /> 添加飞书机器人
        </button>
        <div className="sidebar-section">
          <span>机器人</span>
          <span className="bot-count">{apps.length}</span>
        </div>
        <div className="app-list">
          {apps.length ? apps.map((app) => (
            <AppRow key={app.id} app={app} active={(view === 'app' || view === 'chat') && selectedApp?.id === app.id} onClick={() => onSelect(app)} />
          )) : <div className="sidebar-empty">还没有机器人。添加一个开始。</div>}
        </div>
        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="user-avatar">A</span>
            <span>
              <strong>本地管理员</strong>
              <small>单用户模式</small>
            </span>
          </div>
          <button type="button" className="icon-button" onClick={() => { void onLogout() }} title="退出登录" aria-label="退出登录">
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <main className="workspace-main">
        <header className={`topbar ${view === 'chat' && selectedApp ? 'chat-topbar' : ''}`}>
          {view === 'chat' && selectedApp ? (
            <>
              <div className="topbar-chat">
                <span className="topbar-chat-avatar"><Bot size={17} strokeWidth={1.6} /></span>
                <div className="topbar-chat-main">
                  <div className="topbar-chat-title">
                    {selectedApp.name}
                    <span className="connected-chip"><span className="status-dot" />已连接</span>
                  </div>
                  <div className="topbar-chat-sub">
                    <span className="mono">{selectedApp.appId}</span>
                    <span>·</span>
                    <span className="mono">{selectedApp.chatId ? `${selectedApp.chatId.slice(0, 10)}…` : '单聊'}</span>
                  </div>
                </div>
              </div>
              <div className="topbar-actions">
                <span className="topbar-note"><span className="live-dot" /> 本地运行</span>
                <button type="button" className="button ghost tiny topbar-settings" onClick={onSettings}>
                  <Settings2 size={14} /> 设置
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="crumbs">
                <span>工作台</span>
                <ChevronRight size={13} />
                <strong>{view === 'new' ? '添加飞书机器人' : selectedApp?.name || '开始'}</strong>
              </div>
              <span className="topbar-note"><span className="live-dot" /> 本地运行</span>
            </>
          )}
        </header>

        <div className={view === 'chat' ? 'content chat-content' : 'content'}>
          {notice ? <div className="notice"><Check size={15} />{notice}<button type="button" onClick={onClearNotice}><X size={14} /></button></div> : null}
          {error ? <div className="notice error"><X size={15} />{error}<button type="button" onClick={onClearError}><X size={14} /></button></div> : null}
          {view === 'chat' && selectedApp ? (
            <ChatView key={`${selectedApp.id}:${selectedApp.chatId}`} app={selectedApp} />
          ) : view === 'new' ? (
            <AppForm onCancel={onCancelNew} onCreate={onCreate} />
          ) : view === 'app' && selectedApp ? (
            <AppDetail
              app={selectedApp}
              onRename={onRename}
              onDelete={onDelete}
              onAuthorize={onAuthorize}
              onBind={onBind}
              onOpenChat={onOpenChat}
              onTest={onTest}
              onManualBind={onManualBind}
              authorizing={authorizingId === selectedApp.id}
              binding={bindingId === selectedApp.id}
              testing={testingId === selectedApp.id}
              redirectUri={redirectUri}
            />
          ) : (
            <EmptyState onCreate={onNew} />
          )}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [apps, setApps] = useState<AppItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [view, setView] = useState<View>('empty')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [authorizingId, setAuthorizingId] = useState('')
  const [bindingId, setBindingId] = useState('')
  const [testingId, setTestingId] = useState('')
  const [redirectUri, setRedirectUri] = useState(() => `${window.location.origin}/api/oauth/callback`)

  const selectedApp = apps.find((app) => app.id === selectedId)

  useEffect(() => {
    let alive = true
      ; (async () => {
        try {
          const status = await api.status()
          if (!alive) return
          if (status.needsSetup) {
            setNeedsSetup(true)
            setPath('/setup')
            return
          }
          try {
            await api.me()
            if (!alive) return
            setAuthed(true)
            setPath('/')
            const list = await api.listApps()
            if (!alive) return
            setApps(list)
            if (list.length) {
              const first = list[0]!
              setSelectedId(first.id)
              setView(first.authorized && first.chatId ? 'chat' : 'app')
            }
          } catch (caught) {
            if (caught instanceof ApiError && caught.status === 401) {
              setAuthed(false)
              setPath('/login')
            } else {
              throw caught
            }
          }
        } catch (caught) {
          setError(messageOf(caught))
        } finally {
          if (alive) setLoading(false)
        }
      })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as {
        type?: string
        ok?: boolean
        message?: string
        appId?: string
        warning?: string
      } | null
      if (!data || data.type !== 'web-feishu-client:oauth') return
      if (!data.ok) {
        setAuthorizingId('')
        setError(data.message || '授权未完成')
        return
      }
      // 消息可能比数据库提交更早到达；不要在这里清掉轮询，
      // 只有拿到已授权应用后再结束等待，否则由轮询兜底。
      void (async () => {
        try {
          const list = await api.listApps()
          setApps(list)
          const id = data.appId && list.some((app) => app.id === data.appId)
            ? data.appId
            : list[0]?.id
          const target = id ? list.find((app) => app.id === id) : undefined
          if (!target?.authorized) return
          setSelectedId(target.id)
          setView(target.chatId ? 'chat' : 'app')
          setAuthorizingId('')
          setNotice(data.warning ? `授权成功，但单聊绑定失败：${data.warning}` : '飞书授权完成。')
          setError('')
        } catch (caught) {
          setError(messageOf(caught))
        }
      })()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (!authorizingId) return
    let cancelled = false
    let busy = false
    let authorizedWithoutChatSince = 0
    const startedAt = Date.now()

    async function check(): Promise<void> {
      if (cancelled || busy) return
      if (Date.now() - startedAt > 180_000) {
        cancelled = true
        setAuthorizingId('')
        setError('授权等待超时，请重新发起授权')
        return
      }
      busy = true
      try {
        const list = await api.listApps()
        if (cancelled) return
        const target = list.find((app) => app.id === authorizingId)
        if (!target?.authorized) return
        // 老服务端/极端时序下可能先看到 authorized 但 chatId 还没写入。
        // 给绑定留出短暂窗口，避免提前停在设置页。
        if (!target.chatId && !target.auth.warning) {
          if (!authorizedWithoutChatSince) authorizedWithoutChatSince = Date.now()
          if (Date.now() - authorizedWithoutChatSince < 5000) {
            setApps(list)
            return
          }
        }
        setApps(list)
        setSelectedId(target.id)
        setView(target.chatId ? 'chat' : 'app')
        setAuthorizingId('')
        setError('')
        if (target.chatId) {
          setNotice('飞书授权完成，单聊已绑定。')
        } else if (typeof target.auth.warning === 'string' && target.auth.warning) {
          setNotice(`授权完成，但单聊绑定失败：${target.auth.warning}`)
        } else {
          setNotice('飞书授权完成；单聊尚未绑定，可以重试。')
        }
      } catch {
        // 轮询失败不打断授权流程；下次重试。
      } finally {
        busy = false
      }
    }

    const timer = window.setInterval(() => { void check() }, 1200)
    const onFocus = () => { void check() }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    void check()
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [authorizingId])

  async function enter() {
    setNeedsSetup(false)
    setAuthed(true)
    setPath('/')
    setError('')
    const list = await api.listApps()
    setApps(list)
    if (list.length) {
      const first = list[0]!
      setSelectedId(first.id)
      setView(first.authorized && first.chatId ? 'chat' : 'app')
    } else {
      setView('empty')
    }
  }

  async function create(input: { name: string; appId: string; appSecret: string }) {
    setError('')
    const created = await api.createApp(input)
    setApps((current) => [created, ...current])
    setSelectedId(created.id)
    setView('app')
    setNotice('机器人已保存，下一步可以接入飞书授权。')
  }

  function openApp(app: AppItem) {
    setSelectedId(app.id)
    setView(app.authorized && app.chatId ? 'chat' : 'app')
    setNotice('')
    setError('')
  }

  async function rename(name: string) {
    if (!selectedApp) return
    const updated = await api.renameApp(selectedApp.id, name)
    setApps((current) => current.map((app) => app.id === updated.id ? updated : app))
    setNotice('显示名称已更新。')
  }

  async function remove() {
    if (!selectedApp) return
    await api.deleteApp(selectedApp.id)
    const next = apps.filter((app) => app.id !== selectedApp.id)
    setApps(next)
    const first = next[0]
    setSelectedId(first?.id ?? '')
    setView(first ? (first.authorized && first.chatId ? 'chat' : 'app') : 'empty')
    setNotice('机器人已删除。')
  }

  async function authorizeSelected() {
    if (!selectedApp) return
    setAuthorizingId(selectedApp.id)
    setError('')
    try {
      const start = await api.oauthStart(selectedApp.id)
      setRedirectUri(start.redirectUri)
      const popup = window.open(
        start.url,
        'web-feishu-client-oauth',
        'popup=yes,width=540,height=700',
      )
      if (!popup) throw new Error('浏览器拦截了授权窗口，请允许弹窗后重试')
    } catch (caught) {
      setAuthorizingId('')
      setError(messageOf(caught))
    }
  }

  async function bindSelected() {
    if (!selectedApp) return
    setBindingId(selectedApp.id)
    setError('')
    try {
      const updated = await api.discoverChat(selectedApp.id)
      setApps((current) => current.map((app) => app.id === updated.id ? updated : app))
      setSelectedId(updated.id)
      setView('chat')
      setNotice('单聊绑定成功。')
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBindingId('')
    }
  }

  async function testSelected() {
    if (!selectedApp) return
    setTestingId(selectedApp.id)
    setError('')
    try {
      const result = await api.testApp(selectedApp.id)
      setNotice(
        `测试通过：${result.bot.name || '机器人'} · ${result.authorized ? '已授权' : '未授权'} · ${result.chatBound ? '已绑定单聊' : '未绑定单聊'}`,
      )
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setTestingId('')
    }
  }

  async function manualBind(chatId: string) {
    if (!selectedApp) return
    const updated = await api.setChat(selectedApp.id, chatId)
    setApps((current) => current.map((app) => app.id === updated.id ? updated : app))
    setSelectedId(updated.id)
    setView('chat')
    setNotice('单聊已绑定。')
  }

  async function logout() {
    try { await api.logout() } catch { }
    setAuthed(false)
    setApps([])
    setSelectedId('')
    setView('empty')
    setPath('/login')
  }

  if (loading) {
    return (
      <div className="splash">
        <Brand />
        <Spinner size={18} />
      </div>
    )
  }

  if (needsSetup) return <SetupPage onDone={enter} />
  if (!authed) return <LoginPage onDone={enter} />

  return (
    <Workspace
      apps={apps}
      selectedApp={selectedApp}
      view={view}
      notice={notice}
      error={error}
      onClearNotice={() => setNotice('')}
      onClearError={() => setError('')}
      onNew={() => { setView('new'); setNotice(''); setError('') }}
      onCancelNew={() => setView(selectedApp ? 'app' : 'empty')}
      onSelect={openApp}
      onOpenChat={() => { if (selectedId) setView('chat') }}
      onCreate={create}
      onRename={rename}
      onDelete={remove}
      onAuthorize={() => { void authorizeSelected() }}
      onBind={() => { void bindSelected() }}
      onSettings={() => setView('app')}
      onTest={() => { void testSelected() }}
      onManualBind={manualBind}
      authorizingId={authorizingId}
      testingId={testingId}
      bindingId={bindingId}
      redirectUri={redirectUri}
      onLogout={logout}
    />
  )
}
