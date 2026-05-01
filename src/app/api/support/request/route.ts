import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db/index"
import { chatMessages, conversations, supportRequests } from "@/db/schema"
import { getOrCreateSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type IncomingMessage = {
  id?: string
  role?: string
  content?: string
}

function latestStudentQuestion(messages: IncomingMessage[]) {
  const latest = [...messages]
    .reverse()
    .find((message) => message.role === "user" && message.content?.trim())

  return latest?.content?.trim() || "Student asked to speak to a human"
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    const sessionId = await getOrCreateSession(cookieStore)
    const body = await req.json().catch(() => ({}))

    const messages = Array.isArray(body.messages) ? (body.messages as IncomingMessage[]) : []
    const conversationId = (body.conversationId as string | undefined)?.trim() || crypto.randomUUID()
    const title =
      (body.title as string | undefined)?.trim() ||
      latestStudentQuestion(messages).slice(0, 80) ||
      "Live Support Request"
    const latestQuestion = latestStudentQuestion(messages)

    const [existingConversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.sessionId, sessionId)))
      .limit(1)

    if (!existingConversation) {
      await db.insert(conversations).values({
        id: conversationId,
        sessionId,
        title,
        updatedAt: new Date(),
      })
    }

    const existingMessages = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .limit(1)

    if (existingMessages.length === 0) {
      const rows = messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .filter((message) => message.content?.trim())
        .map((message) => ({
          conversationId,
          role: message.role as "user" | "assistant",
          content: message.content!.trim(),
        }))

      if (rows.length > 0) {
        await db.insert(chatMessages).values(rows)
      }
    }

    const [existingRequest] = await db
      .select()
      .from(supportRequests)
      .where(
        and(
          eq(supportRequests.conversationId, conversationId),
          eq(supportRequests.sessionId, sessionId),
          inArray(supportRequests.status, ["pending", "active", "assigned"])
        )
      )
      .limit(1)

    if (existingRequest) {
      return Response.json({ supportRequest: existingRequest }, { status: 200 })
    }

    const [supportRequest] = await db
      .insert(supportRequests)
      .values({
        id: crypto.randomUUID(),
        sessionId,
        conversationId,
        userMessage: latestQuestion,
        status: "pending",
      })
      .returning()

    return Response.json({ supportRequest }, { status: 201 })
  } catch (error) {
    console.error("[support/request] Error:", error)
    return Response.json({ error: "Failed to create support request" }, { status: 500 })
  }
}
