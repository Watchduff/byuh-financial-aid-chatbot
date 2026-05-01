export type SupportedLanguage = {
  code: string
  name: string
  nativeName: string
}

export const DEFAULT_LANGUAGE_CODE = "en"

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
]

export function getSupportedLanguage(code: string | undefined | null): SupportedLanguage {
  const defaultLanguage =
    SUPPORTED_LANGUAGES.find((language) => language.code === DEFAULT_LANGUAGE_CODE) ?? SUPPORTED_LANGUAGES[0]

  if (!code) return defaultLanguage

  const normalizedCode = code.toLowerCase()
  return (
    SUPPORTED_LANGUAGES.find((language) => language.code === normalizedCode) ??
    SUPPORTED_LANGUAGES.find((language) => normalizedCode.startsWith(`${language.code}-`)) ??
    defaultLanguage
  )
}

export function detectSupportedLanguage(browserLanguages: readonly string[]): SupportedLanguage {
  for (const browserLanguage of browserLanguages) {
    const matchedLanguage = getSupportedLanguage(browserLanguage)
    if (matchedLanguage.code !== DEFAULT_LANGUAGE_CODE || browserLanguage.toLowerCase().startsWith("en")) {
      return matchedLanguage
    }
  }

  return getSupportedLanguage(DEFAULT_LANGUAGE_CODE)
}
