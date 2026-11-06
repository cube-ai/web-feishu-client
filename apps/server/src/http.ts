export class HttpError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export function requireString(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${field}不能为空`)
  const text = value.trim()
  if (text.length > max) throw new HttpError(400, `${field}过长`)
  return text
}
