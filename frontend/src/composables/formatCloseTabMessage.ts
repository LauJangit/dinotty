// Composable extracted for testability (Task 5, openspec change `confirm-before-close-tab`).
// `t()` does not support {var} interpolation, so we inline the title into the message.
// Spec: openspec/changes/confirm-before-close-tab/design.md §E9 fallback.

export type Locale = 'en' | 'zh'

/**
 * Build the modal message for "close this tab" confirmation.
 * - When `title` is empty, returns the base message unmodified.
 * - English locale wraps the title in double quotes:  `... "title"?`
 * - Chinese locale wraps the title in CJK brackets:     `...「title」？`
 */
export function formatCloseTabMessage(
  base: string,
  title: string,
  locale: Locale,
): string {
  if (!title) return base
  return locale === 'en'
    ? `${base} "${title}"?`
    : `${base}「${title}」？`
}
