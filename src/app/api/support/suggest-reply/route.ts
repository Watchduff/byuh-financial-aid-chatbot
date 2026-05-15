import { NextRequest } from "next/server"
import { asc, eq } from "drizzle-orm"
import { db } from "@/db/index"
import { agentMessages, chatMessages, supportRequests } from "@/db/schema"
import { generateJsonResponse } from "@/lib/openai"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const SYSTEM_PROMPT = `You are an assistant helping BYU-Hawaii Financial Aid staff respond to students in live support chat.

Generate exactly 3 short, professional reply suggestions for the Financial Aid advisor to send.

Rules:
- Each suggestion must be warm, clear, and conversational — not robotic or overly formal
- Keep each suggestion to 1–3 sentences max
- Address the student's question or situation directly using the conversation context
- Use "Aloha" as a greeting only in the first suggestion if this is the opening reply
- Do not promise specific dollar amounts or outcomes you cannot verify
- For account-specific issues (awards, holds, documents), include a prompt to visit the office or check MyByuh
- Do not include placeholder text like [Name] or [Date] — write complete ready-to-send replies
- Return a JSON object with key "suggestions" containing an array of exactly 3 strings`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const requestId = (body.requestId as string | undefined)?.trim()

    if (!requestId) {
      return Response.json({ error: "requestId is required" }, { status: 400 })
    }

    const [supportRequest] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, requestId))
      .limit(1)

    if (!supportRequest) {
      return Response.json({ error: "Support request not found" }, { status: 404 })
    }

    const chatHistory = supportRequest.conversationId
      ? await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.conversationId, supportRequest.conversationId))
          .orderBy(asc(chatMessages.createdAt))
      : []

    const adminReplies = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.supportRequestId, requestId))
      .orderBy(asc(agentMessages.createdAt))

    const conversationLines = [
      ...chatHistory
        .filter((m) => !m.content.startsWith("[Support escalation]"))
        .slice(-10)
        .map((m) => `${m.role === "user" ? "Student" : "Chatbot"}: ${m.content}`),
      ...adminReplies
        .slice(-4)
        .map((m) => `Advisor (${m.agentName}): ${m.content}`),
    ]

    const userMessage = `Student's latest message: "${supportRequest.userMessage}"
Escalation reason: ${supportRequest.userMessage}

${conversationLines.length > 0 ? `Recent conversation:\n${conversationLines.join("\n")}` : "No prior conversation history."}

Generate 3 ready-to-send reply suggestions for the Financial Aid advisor.`

    const raw = await generateJsonResponse(SYSTEM_PROMPT, userMessage)
    const parsed = JSON.parse(raw) as { suggestions?: unknown }
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === "string").slice(0, 3)
      : []

    return Response.json({ suggestions })
  } catch (error) {
    console.error("[suggest-reply] Error:", error)
    return Response.json({ error: "Failed to generate suggestions" }, { status: 500 })
  }
}
