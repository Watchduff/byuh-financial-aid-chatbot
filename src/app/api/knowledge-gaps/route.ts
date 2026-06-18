import { asc } from "drizzle-orm"
import { db } from "@/db/index"
import { chatMessages, conversations } from "@/db/schema"

export const runtime = "nodejs"

type MessageRow = typeof chatMessages.$inferSelect

function parseSources(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : []
  } catch {
    return []
  }
}

function inferConfidence(msg: MessageRow | undefined): "high" | "low" | null {
  if (!msg) return "low"
  if (msg.responseMode === "conversational") return null
  if (msg.responseConfidence === "high" || msg.responseConfidence === "low") return msg.responseConfidence
  if (msg.responseMode === "unavailable") return "low"
  if (/not finding a clear answer|don't have that specific detail|could not access a reliable|not able to pull up/i.test(msg.content)) return "low"
  return "high"
}

export type KnowledgeGap = {
  question: string
  count: number
  lastAskedAt: string
  confidence: "high" | "low" | null
  sources: string[]
  reason: string
}

export async function GET() {
  try {
    const conversationRows = await db.select().from(conversations)
    const allMessages = await db.select().from(chatMessages).orderBy(asc(chatMessages.createdAt))

    const byConversation = new Map<string, MessageRow[]>()
    for (const msg of allMessages) {
      const list = byConversation.get(msg.conversationId) ?? []
      list.push(msg)
      byConversation.set(msg.conversationId, list)
    }

    const gapMap = new Map<string, KnowledgeGap>()

    for (const conv of conversationRows) {
      const messages = byConversation.get(conv.id) ?? []
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        if (msg.role !== "user") continue

        const assistant = messages.slice(i + 1).find((m) => m.role === "assistant")
        if (!assistant) continue

        const confidence = inferConfidence(assistant)
        if (confidence === null) continue // skip greetings / conversational

        if (confidence !== "low") continue // only flag answers the bot wasn't confident about

        const sources = parseSources(assistant.responseSources)
        const hasNoByuhSource = !sources.some((s) => s.includes("byuh.edu"))

        const reason = hasNoByuhSource
          ? "Low confidence · no matching source"
          : "Low confidence answer"

        // Normalise key so near-identical phrasings group together
        const key = msg.content.trim().toLowerCase().slice(0, 120)
        const existing = gapMap.get(key)
        if (existing) {
          existing.count++
          existing.lastAskedAt = msg.createdAt.toISOString()
          existing.confidence = confidence
          existing.sources = sources
          existing.reason = reason
        } else {
          gapMap.set(key, {
            question: msg.content.trim(),
            count: 1,
            lastAskedAt: msg.createdAt.toISOString(),
            confidence,
            sources,
            reason,
          })
        }
      }
    }

    const gaps = Array.from(gapMap.values()).sort(
      (a, b) =>
        b.count - a.count ||
        new Date(b.lastAskedAt).getTime() - new Date(a.lastAskedAt).getTime()
    )

    return Response.json({ gaps })
  } catch (error) {
    console.error("[knowledge-gaps] Error:", error)
    return Response.json({ error: "Failed to fetch knowledge gaps" }, { status: 500 })
  }
}
