import { NextRequest } from "next/server"
import { db } from "@/db/index"
import { messageFeedback } from "@/db/schema"
import { and, desc, count, eq, gte, isNotNull, lte, sql } from "drizzle-orm"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { conversationId, question, answer, feedback, reason, comment } = body as {
      conversationId?: string
      question?: string
      answer?: string
      feedback?: string
      reason?: string
      comment?: string
    }

    if (!question || !answer || (feedback !== "helpful" && feedback !== "not-helpful")) {
      return Response.json({ error: "question, answer, and valid feedback are required" }, { status: 400 })
    }

    const validReasons = ["wrong-info", "too-vague", "missing-info", "not-relevant", "other"]

    await db.insert(messageFeedback).values({
      conversationId: conversationId ?? null,
      question: question.slice(0, 1000),
      answer: answer.slice(0, 2000),
      feedback,
      reason: reason && validReasons.includes(reason) ? (reason as "wrong-info" | "too-vague" | "missing-info" | "not-relevant" | "other") : null,
      comment: comment ? comment.slice(0, 500) : null,
    })

    return Response.json({ ok: true })
  } catch (error) {
    console.error("[feedback] Error:", error)
    return Response.json({ error: "Failed to save feedback" }, { status: 500 })
  }
}

// Callers send wall-clock boundaries (e.g. "2026-01-01T00:00:00") meaning
// Hawaii local time, to match the Hawaii-time bucketing used everywhere else
// in analytics. Without an explicit offset, `new Date()` would parse these
// as the server's local time (UTC), shifting every boundary by 10 hours.
// Hawaii (Pacific/Honolulu) is UTC-10 year-round with no DST, so a fixed
// offset is always correct.
function parseHawaiiBoundary(value: string | null): Date | null {
  if (!value) return null
  const hasOffset = /Z$|[+-]\d{2}:\d{2}$/.test(value)
  const date = new Date(hasOffset ? value : `${value}-10:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function GET(req: NextRequest) {
  try {
    // Optional date range (ISO strings) so callers — e.g. the yearly/monthly
    // printed reports — can scope totals and the not-helpful list to a period
    // instead of always getting all-time data.
    const url = new URL(req.url)
    const from = parseHawaiiBoundary(url.searchParams.get("from"))
    const to = parseHawaiiBoundary(url.searchParams.get("to"))
    const dateFilter = [
      from ? gte(messageFeedback.createdAt, from) : undefined,
      to ? lte(messageFeedback.createdAt, to) : undefined,
    ].filter((clause): clause is NonNullable<typeof clause> => clause !== undefined)
    const scoped = dateFilter.length > 0 ? and(...dateFilter) : undefined

    const [totals] = await db
      .select({
        helpful: count(sql`CASE WHEN ${messageFeedback.feedback} = 'helpful' THEN 1 END`),
        notHelpful: count(sql`CASE WHEN ${messageFeedback.feedback} = 'not-helpful' THEN 1 END`),
        total: count(),
      })
      .from(messageFeedback)
      .where(scoped)

    const recentWhere = scoped
      ? and(eq(messageFeedback.feedback, "not-helpful"), scoped)
      : eq(messageFeedback.feedback, "not-helpful")

    const recent = await db
      .select()
      .from(messageFeedback)
      .where(recentWhere)
      .orderBy(desc(messageFeedback.createdAt))
      .limit(scoped ? 500 : 20)

    const helpfulConvIds = await db
      .selectDistinct({ conversationId: messageFeedback.conversationId })
      .from(messageFeedback)
      .where(and(eq(messageFeedback.feedback, "helpful"), isNotNull(messageFeedback.conversationId)))
      .then((rows) => rows.map((r) => r.conversationId).filter((id): id is string => id !== null))

    const notHelpfulConvIds = await db
      .selectDistinct({ conversationId: messageFeedback.conversationId })
      .from(messageFeedback)
      .where(and(eq(messageFeedback.feedback, "not-helpful"), isNotNull(messageFeedback.conversationId)))
      .then((rows) => rows.map((r) => r.conversationId).filter((id): id is string => id !== null))

    return Response.json({ totals, recent, helpfulConvIds, notHelpfulConvIds })
  } catch (error) {
    console.error("[feedback] GET Error:", error)
    return Response.json({ error: "Failed to fetch feedback" }, { status: 500 })
  }
}
