import { NextRequest, NextResponse } from "next/server"
import { DEFAULT_LANGUAGE_CODE, getSupportedLanguage } from "@/lib/languages"
import { DEFAULT_UI_TEXT, type UIText } from "@/lib/uiText"
import { generateChatResponse } from "@/lib/openai"

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
    return NextResponse.json({ uiText: DEFAULT_UI_TEXT })
  }

  try {
    const translated = await generateChatResponse(
      [
        "Translate UI labels for the BYU-Hawaii Financial Aid chatbot.",
        "Return only valid JSON with exactly the same keys as the source object.",
        "Keep BYU-Hawaii, FAFSA, URLs, email addresses, keyboard names like Enter and Shift+Enter, and agentName placeholders unchanged.",
        "Keep labels short enough for buttons and navigation.",
      ].join(" "),
      `Target language: ${language.name} (${language.nativeName})\n\nSource JSON:\n${JSON.stringify(DEFAULT_UI_TEXT, null, 2)}`
    )

    const jsonStart = translated.indexOf("{")
    const jsonEnd = translated.lastIndexOf("}")
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error("Translation response did not contain JSON")
    }

    const parsed = JSON.parse(translated.slice(jsonStart, jsonEnd + 1)) as Partial<UIText>
    return NextResponse.json({ uiText: mergeUiText(parsed) })
  } catch (error) {
    console.error("[ui-text] Translation failed:", error)
    return NextResponse.json({ uiText: DEFAULT_UI_TEXT })
  }
}
