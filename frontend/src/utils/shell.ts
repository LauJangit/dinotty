export function shellEscapePath(path: string): string {
  return /[\s'"\\()&;|<>$!`{}[\]#?*~]/.test(path) ? `'${path.replace(/'/g, "'\\''")}'` : path
}

export function trailingPathDeleteLen(text: string): number {
  if (!text) return 0
  const end = text.length
  if (text[end - 1] === "'") {
    let i = end - 2
    while (i >= 0) {
      if (text[i] === "'" && (i === 0 || /\s/.test(text[i - 1]))) break
      i--
    }
    if (i >= 0 && text[i] === "'") {
      let start = i
      if (start > 0 && text[start - 1] === ' ') start -= 1
      return end - start
    }
    return 0
  }
  let i = end - 1
  while (i >= 0 && !/\s/.test(text[i])) i--
  const token = text.slice(i + 1, end)
  if (!token) return 0
  if (!(token.includes('/') || token.startsWith('~'))) return 0
  let start = i + 1
  if (start > 0 && text[start - 1] === ' ') start -= 1
  return end - start
}
