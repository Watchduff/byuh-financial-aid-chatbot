import { NextRequest } from "next/server"
import { db } from "@/db/index"
import { messageFeedback } from "@/db/schema"
import { and, desc, count, eq, isNotNull, sql } from "drizzle-orm"

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

export async function GET() {
  try {
    const [totals] = await db
      .select({
        helpful: count(sql`CASE WHEN ${messageFeedback.feedback} = 'helpful' THEN 1 END`),
        notHelpful: count(sql`CASE WHEN ${messageFeedback.feedback} = 'not-helpful' THEN 1 END`),
        total: count(),
      })
      .from(messageFeedback)

    const recent = await db
      .select()
      .from(messageFeedback)
      .where(eq(messageFeedback.feedback, "not-helpful"))
      .orderBy(desc(messageFeedback.createdAt))
      .limit(20)

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
