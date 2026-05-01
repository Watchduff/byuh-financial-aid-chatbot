import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { eq } from "drizzle-orm"
import { db } from "@/db/index"
import { agentMessages, supportRequests } from "@/db/schema"
import { getOrCreateSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// GET /api/user/agent-messages?requestId=... — poll for agent replies on a support request
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    const sessionId = await getOrCreateSession(cookieStore)

    const requestId = req.nextUrl.searchParams.get("requestId")
    if (!requestId) {
      return Response.json({ error: "requestId is required" }, { status: 400 })
    }

    // Verify the support request belongs to this session
    const [sr] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, requestId))
      .limit(1)

    if (!sr || sr.sessionId !== sessionId) {
      return Response.json({ error: "Not found" }, { status: 404 })
    }

    const messages = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.supportRequestId, requestId))
      .orderBy(agentMessages.createdAt)

    return Response.json({ messages })
  } catch (error) {
    console.error("[user/agent-messages] Error:", error)
    return Response.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}
