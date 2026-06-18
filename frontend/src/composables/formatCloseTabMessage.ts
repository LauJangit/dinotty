import type { Locale } from './useI18n'

/**
 * Build the modal message for "close this tab" confirmation.
 * - When `title` is empty, returns the base message unmodified.
 * - English locale wraps the title in single quotes:  `... 'title'?`
 * - Chinese locale wraps the title in CJK brackets:   `...「title」？`
 */
export function formatCloseTabMessage(
  base: string,
  title: string,
  locale: Locale,
): string {
  if (!title) return base
  return locale === 'en'
    ? `${base} '${title}'?`
    : `${base}「${title}」？`
}
