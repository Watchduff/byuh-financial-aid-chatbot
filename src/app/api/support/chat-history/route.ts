import { asc, desc, eq } from "drizzle-orm"
import { db } from "@/db/index"
import { chatMessages, conversations } from "@/db/schema"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type MessageRow = typeof chatMessages.$inferSelect

function parseSources(value: string | null) {
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((source) => typeof source === "string") : []
  } catch {
    return []
  }
}

function inferConfidence(message: MessageRow | undefined) {
  if (!message) return "low" as const
  if (message.responseConfidence === "high" || message.responseConfidence === "low") {
    return message.responseConfidence
  }
  if (message.responseMode === "unavailable") return "low" as const
  if (/not finding a clear answer|don't have that specific detail|could not access a reliable|not able to pull up/i.test(message.content)) {
    return "low" as const
  }
  return "high" as const
}

export async function GET() {
  try {
    const conversationRows = await db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))

    const entries = await Promise.all(
      conversationRows.map(async (conversation) => {
        const messages = await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.conversationId, conversation.id))
          .orderBy(asc(chatMessages.createdAt))

        return messages
          .flatMap((message, index) => {
            if (message.role !== "user") return []

            const assistantMessage = messages
              .slice(index + 1)
              .find((candidate) => candidate.role === "assistant")

            return [{
              id: `${conversation.id}-${message.id}`,
              conversationId: conversation.id,
              conversationTitle: conversation.title,
              question: message.content,
              questionAt: message.createdAt,
              answer: assistantMessage?.content ?? "",
              answerAt: assistantMessage?.createdAt ?? null,
              confidence: inferConfidence(assistantMessage),
              confidenceScore: assistantMessage?.responseConfidenceScore ?? null,
              mode: assistantMessage?.responseMode ?? null,
              sources: parseSources(assistantMessage?.responseSources ?? null),
            }]
          })
      })
    )

    return Response.json({
      history: entries
        .flat()
        .sort((a, b) => new Date(b.questionAt).getTime() - new Date(a.questionAt).getTime()),
    })
  } catch (error) {
    console.error("[support/chat-history] Error:", error)
    return Response.json({ error: "Failed to fetch chat history" }, { status: 500 })
  }
}
