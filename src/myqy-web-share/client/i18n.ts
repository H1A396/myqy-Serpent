export const PREFERS_CHINESE =
  typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');

/** Minimal two-language copy for the read-only web client. */
export function t(zh: string, en: string): string {
  return PREFERS_CHINESE ? zh : en;
}
