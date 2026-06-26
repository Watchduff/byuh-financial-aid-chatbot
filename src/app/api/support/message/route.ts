// @ts-nocheck
import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { eq } from "drizzle-orm"
import { db } from "@/db/index"
import { chatMessages, supportRequests } from "@/db/schema"
import { getOrCreateSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  // LIVE_SUPPORT_DISABLED — remove this block to re-enable
  return Response.json({ error: "Live support is temporarily unavailable." }, { status: 503 })
  try {
    const cookieStore = await cookies()
    const sessionId = await getOrCreateSession(cookieStore)
    const body = await req.json().catch(() => ({}))
    const requestId: string = typeof body.requestId === "string" ? body.requestId.trim() : ""
    const content: string = typeof body.content === "string" ? body.content.trim() : ""

    if (!requestId || !content) {
      return Response.json({ error: "requestId and content are required" }, { status: 400 })
    }

    const [supportRequest] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, requestId))
      .limit(1)

    if (!supportRequest || supportRequest.sessionId !== sessionId || !supportRequest.conversationId) {
      return Response.json({ error: "Not found" }, { status: 404 })
    }

    const conversationId = supportRequest.conversationId as string

    if (supportRequest.status === "answered" || supportRequest.status === "deleted") {
      return Response.json({ error: "Support request is not active" }, { status: 409 })
    }

    const [message] = await db
      .insert(chatMessages)
      .values({
        conversationId,
        role: "user",
        content,
      })
      .returning()

    const [updatedRequest] = await db
      .update(supportRequests)
      .set({
        status: supportRequest.status === "pending" ? "active" : supportRequest.status,
        userMessage: content,
        updatedAt: new Date(),
      })
      .where(eq(supportRequests.id, requestId))
      .returning()

    return Response.json({ message, supportRequest: updatedRequest }, { status: 201 })
  } catch (error) {
    console.error("[support/message] Error:", error)
    return Response.json({ error: "Failed to save support message" }, { status: 500 })
  }
}
