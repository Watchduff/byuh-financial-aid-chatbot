import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db/index"
import { chatMessages, conversations, supportRequests } from "@/db/schema"
import { getOrCreateSession } from "@/lib/session"
import { getSupportAvailability, getClosedMessage } from "@/lib/supportHours"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type IncomingMessage = {
  id?: string
  role?: string
  content?: string
}

const ESCALATION_NOTE_PREFIX = "[Support escalation]"

function latestUserQuestion(messages: IncomingMessage[]) {
  const latest = [...messages]
    .reverse()
    .find((message) => message.role === "user" && message.content?.trim())

  return latest?.content?.trim() || "User asked to speak to a human"
}

export async function POST(req: NextRequest) {
  try {
    // Enforce office hours server-side so direct API calls can't bypass the UI guard
    const availability = getSupportAvailability()
    if (!availability.isAvailable) {
      return Response.json(
        { error: "live_support_unavailable", message: getClosedMessage(availability.closedReason) },
        { status: 503 }
      )
    }

    const cookieStore = await cookies()
    const sessionId = await getOrCreateSession(cookieStore)
    const body = await req.json().catch(() => ({}))

    const messages = Array.isArray(body.messages) ? (body.messages as IncomingMessage[]) : []
    const escalationReason = (body.escalationReason as string | undefined)?.trim()
    const sentimentLabel = (body.sentimentLabel as string | undefined)?.trim()
    const escalationPriority = (body.escalationPriority as string | undefined)?.trim()
    const conversationId = (body.conversationId as string | undefined)?.trim() || crypto.randomUUID()
    const title =
      (body.title as string | undefined)?.trim() ||
      latestUserQuestion(messages).slice(0, 80) ||
      "Live Support Request"
    const latestQuestion = latestUserQuestion(messages)

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

    if (escalationReason) {
      const noteParts = [
        `${ESCALATION_NOTE_PREFIX} ${escalationReason}`,
        sentimentLabel ? `Sentiment: ${sentimentLabel}` : null,
        escalationPriority ? `Priority: ${escalationPriority}` : null,
      ].filter(Boolean)

      await db.insert(chatMessages).values({
        conversationId,
        role: "assistant",
        content: noteParts.join(" | "),
      })
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
