// @ts-nocheck
import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { eq } from "drizzle-orm"
import { db } from "@/db/index"
import { chatMessages, supportRequests } from "@/db/schema"
import { getOrCreateSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type TranscriptMessage = {
  role?: string
  content?: string
}

export async function POST(req: NextRequest) {
  // LIVE_SUPPORT_DISABLED — remove this block to re-enable
  return Response.json({ error: "Live support is temporarily unavailable." }, { status: 503 })
  try {
    const cookieStore = await cookies()
    const sessionId = await getOrCreateSession(cookieStore)
    const body = await req.json().catch(() => ({}))
    const requestId: string = typeof body.requestId === "string" ? body.requestId.trim() : ""
    const messages = Array.isArray(body.messages) ? (body.messages as TranscriptMessage[]) : []

    if (!requestId || messages.length === 0) {
      return Response.json({ error: "requestId and messages are required" }, { status: 400 })
    }

    const [supportRequest] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, requestId))
      .limit(1)

    if (!supportRequest || supportRequest.sessionId !== sessionId || !supportRequest.conversationId) {
      return Response.json({ error: "Not found" }, { status: 404 })
    }

    const rows = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .filter((message) => message.content?.trim())
      .map((message) => ({
        conversationId: supportRequest.conversationId!,
        role: message.role as "user" | "assistant",
        content: message.content!.trim(),
      }))

    if (rows.length > 0) {
      await db.insert(chatMessages).values(rows)
      await db
        .update(supportRequests)
        .set({ updatedAt: new Date() })
        .where(eq(supportRequests.id, requestId))
    }

    return Response.json({ ok: true })
  } catch (error) {
    console.error("[support/transcript] Error:", error)
    return Response.json({ error: "Failed to save transcript messages" }, { status: 500 })
  }
}
