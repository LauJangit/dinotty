// KEEP IN SYNC with src/workspace_mgmt/mod.rs WORKSPACE_PALETTE
export const WORKSPACE_COLORS = [
  '#FF5D5D',
  '#FF9F45',
  '#FFD23F',
  '#35D07F',
  '#29D6E8',
  '#4D9DFF',
  '#B084FF',
] as const

export function fnv1a32(s: string): number {
  const bytes = new TextEncoder().encode(s)
  let h = 0x811c9dc5
  for (const b of bytes) {
    h = (h ^ b) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function paletteColorFor(id: string): string {
  return WORKSPACE_COLORS[fnv1a32(id) % 7]
}

export function isValidHex(s: string | undefined): boolean {
  return !!s && /^#[0-9A-Fa-f]{6}$/.test(s)
}

export function stripMeaningless(s: string): string {
  return s.replace(/[\s\p{Cc}\p{Cf}]/gu, '')
}

export function autoMonogram(name: string): string {
  type SegmenterConstructor = new (
    locales?: string | string[],
    options?: { granularity: 'grapheme' },
  ) => { segment(input: string): Iterable<{ segment: string }> }
  const Segmenter = (Intl as unknown as { Segmenter: SegmenterConstructor }).Segmenter
  const segmenter = new Segmenter(undefined, { granularity: 'grapheme' })
  const clusters = [...segmenter.segment(name)]
    .map(({ segment }) => segment)
    .filter((cluster) => stripMeaningless(cluster) !== '')

  if (clusters.length === 0) return '?'

  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|[！-｠￠-￦]/u.test(clusters[0])) {
    return clusters.slice(0, 2).join('')
  }

  const result = clusters.slice(0, 3).join('').toLocaleUpperCase()
  return [...result].slice(0, 3).join('') || '?'
}

export function resolveAbbr(ws: { abbr?: string; name: string }): string {
  const stripped = ws.abbr ? stripMeaningless(ws.abbr) : ''
  return stripped ? [...stripped].slice(0, 3).join('') : autoMonogram(ws.name)
}

export function resolveColor(ws: { color?: string; id: string }): string {
  return isValidHex(ws.color) ? ws.color! : paletteColorFor(ws.id)
}

export function relativeLuminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(
    (channel) => Number.parseInt(channel, 16) / 255,
  )
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const aLuminance = relativeLuminance(a)
  const bLuminance = relativeLuminance(b)
  return (Math.max(aLuminance, bLuminance) + 0.05) / (Math.min(aLuminance, bLuminance) + 0.05)
}

function mix(hex: string, target: string, ratio: number): string {
  const mixed = [1, 3, 5].map((start) => {
    const sourceChannel = Number.parseInt(hex.slice(start, start + 2), 16)
    const targetChannel = Number.parseInt(target.slice(start, start + 2), 16)
    return Math.round(sourceChannel + (targetChannel - sourceChannel) * ratio)
      .toString(16)
      .padStart(2, '0')
  })
  return `#${mixed.join('')}`.toUpperCase()
}

export function outlineColor(hex: string, cardBgHex: string): string {
  if (contrastRatio(hex, cardBgHex) >= 3) return hex

  const target = contrastRatio('#000000', cardBgHex) >= contrastRatio('#FFFFFF', cardBgHex)
    ? '#000000'
    : '#FFFFFF'
  for (let step = 1; step <= 9; step += 1) {
    const candidate = mix(hex, target, step / 10)
    if (contrastRatio(candidate, cardBgHex) >= 3) return candidate
  }
  return target
}
