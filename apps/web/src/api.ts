export type ApiStatus = {
  needsSetup: boolean
}

export type Me = {
  csrfToken: string
  user: { role: string }
}

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

export type AppItem = {
  id: string
  name: string
  appId: string
  chatId: string
  authorized: boolean
  auth: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let csrfToken = ''

export function setCsrfToken(token: string): void {
  csrfToken = token
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('x-remote-feishu-client', '1')
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (csrfToken) headers.set('x-csrf-token', csrfToken)

  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      cache: 'no-store',
      ...options,
      headers,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, '无法连接服务器')
  }

  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    throw new ApiError(response.status, typeof data.error === 'string' ? data.error : '请求失败')
  }
  return data as T
}

export const api = {
  status: () => request<ApiStatus>('/auth/status'),
  me: async () => {
    const data = await request<Me>('/auth/me')
    setCsrfToken(data.csrfToken)
    return data
  },
  setup: async (token: string, password: string) => {
    const data = await request<{ csrfToken: string }>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    })
    setCsrfToken(data.csrfToken)
    return data
  },
  login: async (password: string) => {
    const data = await request<{ csrfToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
    setCsrfToken(data.csrfToken)
    return data
  },
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  listApps: async () => {
    const data = await request<{ apps: AppItem[] }>('/apps')
    return data.apps
  },
  createApp: async (input: { name: string; appId: string; appSecret: string }) => {
    const data = await request<{ app: AppItem }>('/apps', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return data.app
  },
  renameApp: async (id: string, name: string) => {
    const data = await request<{ app: AppItem }>(`/apps/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
    return data.app
  },
  deleteApp: (id: string) => request<{ ok: true }>(`/apps/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  oauthStart: (id: string) => request<{ url: string; redirectUri: string }>(`/apps/${encodeURIComponent(id)}/oauth/start`),
  discoverChat: async (id: string) => {
    const data = await request<{ app: AppItem }>(`/apps/${encodeURIComponent(id)}/discover`, { method: 'POST' })
    return data.app
  },
  listMessages: async (id: string) => {
    const data = await request<{ messages: ChatMessage[] }>(`/apps/${encodeURIComponent(id)}/messages`)
    return data.messages
  },
  sendMessage: async (id: string, text: string, attachment?: ChatAttachment) => {
    const data = await request<{
      message?: ChatMessage
      messages?: ChatMessage[]
      attachmentSent?: boolean
      warning?: string
    }>(`/apps/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify(attachment ? { text, attachment } : { text }),
    })
    return data
  },
  uploadMedia: async (id: string, file: File, kind: 'image' | 'file') => {
    const headers = new Headers({
      'content-type': kind === 'image' ? (file.type || 'image/png') : 'application/octet-stream',
      'x-remote-feishu-client': '1',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    })
    let response: Response
    try {
      response = await fetch(`/api/apps/${encodeURIComponent(id)}/media?kind=${kind}&name=${encodeURIComponent(file.name)}&mime=${encodeURIComponent(file.type || 'application/octet-stream')}`, {
        method: 'POST',
        headers,
        body: file,
        credentials: 'same-origin',
      })
    } catch {
      throw new ApiError(0, '无法连接服务器')
    }
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) throw new ApiError(response.status, typeof data.error === 'string' ? data.error : '附件上传失败')
    if (!data.attachment || typeof data.attachment !== 'object') throw new ApiError(502, '附件上传响应无效')
    return data.attachment as ChatAttachment
  },
  testApp: (id: string) => request<{
    bot: { name: string; openId: string }
    authorized: boolean
    chatBound: boolean
  }>(`/apps/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  setChat: async (id: string, chatId: string) => {
    const data = await request<{ app: AppItem }>(`/apps/${encodeURIComponent(id)}/chat`, {
      method: 'POST',
      body: JSON.stringify({ chatId }),
    })
    return data.app
  },
}
