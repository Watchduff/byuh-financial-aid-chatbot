import { asc, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/db/index"
import { agentMessages, chatMessages, conversations, supportRequests } from "@/db/schema"

export const runtime = "nodejs"

type MessageRow = typeof chatMessages.$inferSelect

function parseSources(value: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : []
  } catch {
    return []
  }
}

function inferConfidence(message: MessageRow | undefined): "high" | "low" | null {
  if (!message) return "low"
  // Conversational openers (greetings, thanks, etc.) have no RAG confidence
  if (message.responseMode === "conversational") return null
  if (message.responseConfidence === "high" || message.responseConfidence === "low") {
    return message.responseConfidence
  }
  if (message.responseMode === "unavailable") return "low"
  if (/not finding a clear answer|don't have that specific detail|could not access a reliable|not able to pull up/i.test(message.content)) {
    return "low"
  }
  return "high"
}

export async function GET() {
  try {
    const conversationRows = await db
      .select()
      .from(conversations)
      .where(isNull(conversations.deletedAt))
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

    // Fetch advisor (agent) replies grouped by conversationId
    const supportRequestRows = await db
      .select()
      .from(supportRequests)
      .orderBy(asc(supportRequests.createdAt))

    const agentRepliesByConversation: Record<string, Array<{
      id: string
      agentName: string
      content: string
      createdAt: string
    }>> = {}

    await Promise.all(
      supportRequestRows
        .filter((r) => r.conversationId)
        .map(async (request) => {
          const replies = await db
            .select()
            .from(agentMessages)
            .where(eq(agentMessages.supportRequestId, request.id))
            .orderBy(asc(agentMessages.createdAt))

          if (replies.length > 0 && request.conversationId) {
            const convId = request.conversationId
            if (!agentRepliesByConversation[convId]) {
              agentRepliesByConversation[convId] = []
            }
            for (const reply of replies) {
              agentRepliesByConversation[convId].push({
                id: reply.id,
                agentName: reply.agentName,
                content: reply.content,
                createdAt: reply.createdAt.toISOString(),
              })
            }
          }
        })
    )

    return Response.json({
      history: entries
        .flat()
        .sort((a, b) => new Date(b.questionAt).getTime() - new Date(a.questionAt).getTime()),
      agentReplies: agentRepliesByConversation,
    })
  } catch (error) {
    console.error("[support/chat-history] Error:", error)
    return Response.json({ error: "Failed to fetch chat history" }, { status: 500 })
  }
}
