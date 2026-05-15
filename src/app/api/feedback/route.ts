import { NextRequest } from "next/server"
import { db } from "@/db/index"
import { messageFeedback } from "@/db/schema"
import { desc, count, eq, sql } from "drizzle-orm"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { conversationId, question, answer, feedback } = body as {
      conversationId?: string
      question?: string
      answer?: string
      feedback?: string
    }

    if (!question || !answer || (feedback !== "helpful" && feedback !== "not-helpful")) {
      return Response.json({ error: "question, answer, and valid feedback are required" }, { status: 400 })
    }

    await db.insert(messageFeedback).values({
      conversationId: conversationId ?? null,
      question: question.slice(0, 1000),
      answer: answer.slice(0, 2000),
      feedback,
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

    return Response.json({ totals, recent })
  } catch (error) {
    console.error("[feedback] GET Error:", error)
    return Response.json({ error: "Failed to fetch feedback" }, { status: 500 })
  }
}
