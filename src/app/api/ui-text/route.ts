import { NextRequest, NextResponse } from "next/server"
import { DEFAULT_LANGUAGE_CODE, getSupportedLanguage } from "@/lib/languages"
import { DEFAULT_UI_TEXT, getStaticUIText, type UIText } from "@/lib/uiText"
import { generateJsonResponse } from "@/lib/openai"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function mergeUiText(translated: Partial<UIText>): UIText {
  return {
    ...DEFAULT_UI_TEXT,
    ...translated,
  }
}

export async function GET(req: NextRequest) {
  const language = getSupportedLanguage(req.nextUrl.searchParams.get("languageCode"))

  if (language.code === DEFAULT_LANGUAGE_CODE) {
    return NextResponse.json({ uiText: DEFAULT_UI_TEXT, translated: true })
  }

  const staticUiText = getStaticUIText(language.code)
  if (staticUiText) {
    return NextResponse.json({ uiText: staticUiText, translated: true })
  }

  try {
    const translated = await generateJsonResponse(
      [
        "Translate UI labels for the BYU-Hawaii Financial Aid chatbot.",
        "Return a single JSON object with exactly one top-level key named uiText.",
        "uiText must contain exactly the same keys as the source object.",
        "Keep BYU-Hawaii, FAFSA, URLs, email addresses, keyboard names like Enter and Shift+Enter, and agentName placeholders unchanged.",
        "Keep labels short enough for buttons and navigation.",
        "Do not add commentary, markdown, code fences, or extra keys.",
      ].join(" "),
      [
        `Target language: ${language.name} (${language.nativeName})`,
        "Translate every value in this source UI text object.",
        "Return JSON shaped like: { \"uiText\": { ...translated labels... } }",
        `Source UI text object:\n${JSON.stringify(DEFAULT_UI_TEXT, null, 2)}`,
      ].join("\n\n")
    )

    const parsed = JSON.parse(translated) as { uiText?: Partial<UIText> }
    if (!parsed.uiText) {
      throw new Error("Translation response missing uiText")
    }

    return NextResponse.json({ uiText: mergeUiText(parsed.uiText), translated: true })
  } catch (error) {
    console.error("[ui-text] Translation failed:", error)
    return NextResponse.json({ uiText: DEFAULT_UI_TEXT, translated: false })
  }
}
