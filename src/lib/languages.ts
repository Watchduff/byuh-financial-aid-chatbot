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
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ur", name: "Urdu", nativeName: "اردو" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
  { code: "km", name: "Khmer", nativeName: "ខ្មែរ" },
  { code: "mn", name: "Mongolian", nativeName: "Монгол" },
  { code: "tl", name: "Tagalog", nativeName: "Tagalog" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "haw", name: "Hawaiian", nativeName: "ʻŌlelo Hawaiʻi" },
  { code: "sm", name: "Samoan", nativeName: "Gagana Samoa" },
  { code: "to", name: "Tongan", nativeName: "Lea Faka-Tonga" },
  { code: "fj", name: "Fijian", nativeName: "Na Vosa Vakaviti" },
  { code: "mi", name: "Maori", nativeName: "Māori" },
  { code: "ty", name: "Tahitian", nativeName: "Reo Tahiti" },
  { code: "mh", name: "Marshallese", nativeName: "Kajin M̧ajeļ" },
  { code: "gil", name: "Kiribati", nativeName: "Taetae ni Kiribati" },
  { code: "ch", name: "Chamorro", nativeName: "Chamoru" },
  { code: "pau", name: "Palauan", nativeName: "a tekoi er a Belau" },
  { code: "bi", name: "Bislama", nativeName: "Bislama" },
  { code: "tpi", name: "Tok Pisin", nativeName: "Tok Pisin" },
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
