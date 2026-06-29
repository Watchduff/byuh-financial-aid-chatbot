import { asc, eq } from "drizzle-orm"
import { db } from "@/db/index"
import { chatMessages, conversations, supportRequests } from "@/db/schema"

export const runtime = "nodejs"

type MessageRow = typeof chatMessages.$inferSelect

function inferConfidence(message: MessageRow | undefined): "high" | "low" | null {
  if (!message) return "low"
  // Conversational greetings/openers have no RAG confidence — exclude from high/low counts
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

// All date bucketing uses Hawaii time (Pacific/Honolulu, UTC-10, no DST)
// so that June 30 at 11 PM HST counts as June, not July.
function toHawaiiParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00"
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number(get("hour")),
  }
}

function monthKey(date: Date) {
  const { year, month } = toHawaiiParts(date)
  return `${year}-${month}`
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const year = parseInt(url.searchParams.get("year") ?? String(new Date().getFullYear()), 10)

    const monthlyData: Record<string, {
      month: string
      label: string
      conversations: Set<string>
      questions: number
      high: number
      low: number
      escalations: number
    }> = {}

    for (let m = 0; m < 12; m++) {
      const key = `${year}-${String(m + 1).padStart(2, "0")}`
      const date = new Date(year, m, 1)
      monthlyData[key] = {
        month: key,
        label: date.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
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
        if (date.getFullYear() !== year) continue

        const key = monthKey(date)
        if (!monthlyData[key]) continue

        const assistantMsg = messages.slice(i + 1).find((m) => m.role === "assistant")
        const confidence = inferConfidence(assistantMsg)

        monthlyData[key].conversations.add(conv.id)
        monthlyData[key].questions++
        if (confidence === "high") monthlyData[key].high++
        else if (confidence === "low") monthlyData[key].low++
        // null (conversational) = counted in questions but not in high/low
      }
    }

    const allSupport = await db.select().from(supportRequests)
    for (const req of allSupport) {
      const date = new Date(req.createdAt)
      if (date.getFullYear() !== year) continue
      const key = monthKey(date)
      if (!monthlyData[key]) continue
      monthlyData[key].escalations++
    }

    // Always show a range: earliest data year through current year
    const currentYear = new Date().getFullYear()
    const allYearsSet = new Set<number>()
    for (const conv of allConversations) {
      allYearsSet.add(new Date(conv.createdAt).getFullYear())
    }
    for (const req of allSupport) {
      allYearsSet.add(new Date(req.createdAt).getFullYear())
    }
    // Always include the last 3 years + current so the selector is never empty
    for (let y = currentYear - 2; y <= currentYear; y++) {
      allYearsSet.add(y)
    }
    const availableYears = Array.from(allYearsSet).sort((a, b) => b - a)

    const months = Object.values(monthlyData).map((entry) => ({
      month: entry.month,
      label: entry.label,
      conversations: entry.conversations.size,
      questions: entry.questions,
      high: entry.high,
      low: entry.low,
      escalations: entry.escalations,
    }))

    const totals = months.reduce(
      (acc, m) => ({
        conversations: acc.conversations + m.conversations,
        questions: acc.questions + m.questions,
        high: acc.high + m.high,
        low: acc.low + m.low,
        escalations: acc.escalations + m.escalations,
      }),
      { conversations: 0, questions: 0, high: 0, low: 0, escalations: 0 }
    )

    return Response.json(
      { year, months, totals, availableYears },
      {
        headers: {
          // Analytics are aggregated historical data — 5-minute cache is safe.
          // Stale-while-revalidate lets the admin see instant loads on repeat visits.
          "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
        },
      }
    )
  } catch (error) {
    console.error("[analytics/monthly] Error:", error)
    return Response.json({ error: "Failed to fetch analytics" }, { status: 500 })
  }
}
