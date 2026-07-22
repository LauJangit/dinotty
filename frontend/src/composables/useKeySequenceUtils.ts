export const FKEY_SEQ: Record<string, string> = {
  F1: '\x1bOP',
  F2: '\x1bOQ',
  F3: '\x1bOR',
  F4: '\x1bOS',
  F5: '\x1b[15~',
  F6: '\x1b[17~',
  F7: '\x1b[18~',
  F8: '\x1b[19~',
  F9: '\x1b[20~',
  F10: '\x1b[21~',
  F11: '\x1b[23~',
  F12: '\x1b[24~',
}

export function letterFromPhysicalCode(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase()
  if (code.startsWith('Digit')) return code.slice(5)
  return null
}

export function keyEventToSequence(e: KeyboardEvent): string {
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey
  let ch = ''

  const fk = FKEY_SEQ[e.key]
  if (fk) return fk

  if (e.key === 'Escape') ch = '\x1b'
  else if (e.key === 'Tab') ch = e.shiftKey ? '\x1b[Z' : '\t'
  else if (e.key === 'Backspace') ch = '\x7f'
  else if (e.key === 'Enter') ch = '\r'
  else if (e.key === 'ArrowUp') ch = '\x1b[A'
  else if (e.key === 'ArrowDown') ch = '\x1b[B'
  else if (e.key === 'ArrowRight') ch = '\x1b[C'
  else if (e.key === 'ArrowLeft') ch = '\x1b[D'
  else if (e.key === 'Insert') ch = '\x1b[2~'
  else if (e.key === 'Delete') ch = '\x1b[3~'
  else if (e.key === 'Home') ch = '\x1b[H'
  else if (e.key === 'End') ch = '\x1b[F'
  else if (e.key === 'PageUp') ch = '\x1b[5~'
  else if (e.key === 'PageDown') ch = '\x1b[6~'
  else if (e.key.length === 1) {
    ch = e.key
    if (ctrl) {
      const code = ch.toUpperCase().charCodeAt(0) - 64
      if (code >= 1 && code <= 26) return String.fromCharCode(code)
    }
    if (alt) return '\x1b' + ch
    return ch
  } else {
    const phys = letterFromPhysicalCode(e.code)
    if (phys && phys.length === 1) {
      if (ctrl) {
        const code = phys.toUpperCase().charCodeAt(0) - 64
        if (code >= 1 && code <= 26) return String.fromCharCode(code)
      }
      if (alt) return '\x1b' + phys
      return phys
    }
    return ''
  }

  if (alt && ch.length > 0) return '\x1b' + ch
  return ch
}

export function keyEventToLabel(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.metaKey) parts.push('cmd')
  if (e.altKey) parts.push('opt')
  if (e.shiftKey) parts.push('shift')

  let key = e.key
  if (key === ' ') key = 'space'
  else if (key === 'Escape') key = 'esc'
  else if (key === 'Backspace') key = '⌫'
  else if (key === 'Tab') key = 'tab'
  else if (key === 'Enter') key = '↵'
  else if (key === 'ArrowUp') key = '↑'
  else if (key === 'ArrowDown') key = '↓'
  else if (key === 'ArrowLeft') key = '←'
  else if (key === 'ArrowRight') key = '->'
  else if (key.length === 1) key = key.toLowerCase()
  else return key

  if (parts.length && !['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    parts.push(key)
  } else if (!parts.length) {
    return key
  }
  return parts.join('+')
}

export function escapeForDisplay(s: string | undefined): string {
  if (s === undefined) return ''
  return s.replace(/[\x00-\x1f\x7f]/g, (c) => {
    const code = c.charCodeAt(0)
    if (code === 0x1b) return '\\e'
    if (code === 0x09) return '\\t'
    if (code === 0x0d) return '\\r'
    if (code === 0x0a) return '\\n'
    if (code === 0x7f) return '\\x7f'
    if (code <= 26) return '^' + String.fromCharCode(code + 64)
    return '\\x' + code.toString(16).padStart(2, '0')
  })
}

export function unescapeFromDisplay(s: string): string {
  return s.replace(/\\e|\\t|\\r|\\n|\\x([0-9a-fA-F]{2})|\^([A-Z@\[\\\]\^_?])/g, (m, hex, caret) => {
    if (m === '\\e') return '\x1b'
    if (m === '\\t') return '\t'
    if (m === '\\r') return '\r'
    if (m === '\\n') return '\n'
    if (hex) return String.fromCharCode(parseInt(hex, 16))
    if (caret) {
      if (caret === '?') return '\x7f'
      if (caret === '@') return '\x00'
      return String.fromCharCode(caret.charCodeAt(0) - 64)
    }
    return m
  })
}

export function unescapeData(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')
}
