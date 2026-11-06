/**
 * 飞书卡片里的代码块经常有两个非标准格式：
 *  1. 开头的 ``` 和说明文字挤在同一行；
 *  2. 卡片 Markdown 为了换行，把代码行之间写成了空行。
 *
 * 这里在交给 react-markdown 之前做一次保守归一化：
 *  - 把贴在文字后面的 fence 拆到独立行；
 *  - 只有代码块内“空行数量接近非空行”时，才压缩双换行，避免动正常代码里的空行。
 */
export function normalizeMarkdown(input: string): string {
  const source = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/([^\n])(`{3,})/g, '$1\n$2')

  const lines = source.split('\n')
  const out: string[] = []
  let fence: string | null = null
  let code: string[] = []

  for (const line of lines) {
    if (!fence) {
      const opening = /^\s*(`{3,})(.*)$/.exec(line)
      if (opening) {
        out.push(line)
        fence = opening[1]!
        code = []
      } else {
        out.push(line)
      }
      continue
    }

    const closing = new RegExp(`^\\s*${fence}\\s*$`).test(line)
    if (closing) {
      out.push(normalizeCode(code.join('\n')))
      out.push(line)
      fence = null
      code = []
    } else {
      code.push(line)
    }
  }

  if (fence) out.push(normalizeCode(code.join('\n')))
  return out.join('\n')
}

function normalizeCode(code: string): string {
  const lines = code.split('\n')
  const nonEmpty = lines.filter((line) => line.trim()).length
  const blank = lines.length - nonEmpty
  if (nonEmpty >= 2 && blank > nonEmpty * 0.5) {
    return code.replace(/\n\n/g, '\n')
  }
  return code
}
