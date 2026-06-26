// @ts-nocheck
import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { asc, eq } from "drizzle-orm"
import { db } from "@/db/index"
import { agentMessages, supportRequests } from "@/db/schema"
import { getOrCreateSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  // LIVE_SUPPORT_DISABLED — remove this block to re-enable
  return Response.json({ error: "Live support is temporarily unavailable." }, { status: 503 })
  try {
    const requestId = req.nextUrl.searchParams.get("requestId")
    if (!requestId) {
      return Response.json({ error: "requestId is required" }, { status: 400 })
    }

    const cookieStore = await cookies()
    const sessionId = await getOrCreateSession(cookieStore)

    const [supportRequest] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, requestId))
      .limit(1)

    if (!supportRequest || supportRequest.sessionId !== sessionId) {
      return Response.json({ error: "Not found" }, { status: 404 })
    }

    const messages = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.supportRequestId, requestId))
      .orderBy(asc(agentMessages.createdAt))

    return Response.json({ messages, supportRequest })
  } catch (error) {
    console.error("[support/messages] Error:", error)
    return Response.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}
