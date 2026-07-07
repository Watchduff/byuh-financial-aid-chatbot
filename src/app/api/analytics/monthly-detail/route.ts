import { asc, eq } from "drizzle-orm"
import { db } from "@/db/index"
import { chatMessages, conversations, supportRequests } from "@/db/schema"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type MessageRow = typeof chatMessages.$inferSelect

function inferConfidence(message: MessageRow | undefined): "high" | "low" | null {
  if (!message) return "low"
  // Conversational greetings/openers and canned policy guards (privacy, frustration,
  // escalation, out-of-scope) never touch retrieval — exclude from high/low counts
  if (message.responseMode === "conversational" || message.responseMode === "guard") return null
  if (message.responseConfidence === "high" || message.responseConfidence === "low") {
    return message.responseConfidence
  }
  if (message.responseMode === "unavailable") return "low"
  if (/not finding a clear answer|don't have that specific detail|could not access a reliable|not able to pull up/i.test(message.content)) {
    return "low"
  }
  return "high"
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const month = url.searchParams.get("month") // "YYYY-MM"
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: "month param required (YYYY-MM)" }, { status: 400 })
    }

    const [year, monthNum] = month.split("-").map(Number)
    const daysInMonth = new Date(year, monthNum, 0).getDate()

    const dailyData: Record<string, {
      date: string
      label: string
      conversations: Set<string>
      questions: number
      high: number
      low: number
      escalations: number
    }> = {}

    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(monthNum).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      const date = new Date(year, monthNum - 1, d)
      dailyData[key] = {
        date: key,
        label: date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        conversations: new Set(),
        questions: 0,
        high: 0,
        low: 0,
        escalations: 0,
      }
    }

    const allConversations = await db.select().from(conversations)

    for (const conv of allConversations) {
      const messages = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conv.id))
        .orderBy(asc(chatMessages.createdAt))

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        if (msg.role !== "user") continue

        const date = new Date(msg.createdAt)
        if (date.getFullYear() !== year || date.getMonth() + 1 !== monthNum) continue

        const key = `${year}-${String(monthNum).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
        if (!dailyData[key]) continue

        const assistantMsg = messages.slice(i + 1).find((m) => m.role === "assistant")
        const confidence = inferConfidence(assistantMsg)

        dailyData[key].conversations.add(conv.id)
        dailyData[key].questions++
        if (confidence === "high") dailyData[key].high++
        else if (confidence === "low") dailyData[key].low++
      }
    }

    const allSupport = await db.select().from(supportRequests)
    for (const req of allSupport) {
      const date = new Date(req.createdAt)
      if (date.getFullYear() !== year || date.getMonth() + 1 !== monthNum) continue
      const key = `${year}-${String(monthNum).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
      if (!dailyData[key]) continue
      dailyData[key].escalations++
    }

    const days = Object.values(dailyData).map((d) => ({
      date: d.date,
      label: d.label,
      conversations: d.conversations.size,
      questions: d.questions,
      high: d.high,
      low: d.low,
      escalations: d.escalations,
    }))

    const totals = days.reduce(
      (acc, d) => ({
        conversations: acc.conversations + d.conversations,
        questions: acc.questions + d.questions,
        high: acc.high + d.high,
        low: acc.low + d.low,
        escalations: acc.escalations + d.escalations,
      }),
      { conversations: 0, questions: 0, high: 0, low: 0, escalations: 0 }
    )

    const label = new Date(year, monthNum - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    })

    return Response.json({ month, label, days, totals })
  } catch (error) {
    console.error("[analytics/monthly-detail] Error:", error)
    return Response.json({ error: "Failed to fetch monthly detail" }, { status: 500 })
  }
}
