import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { eq, asc } from "drizzle-orm"
import { db } from "@/db/index"
import { conversations, chatMessages } from "@/db/schema"
import { getSessionId } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// GET /api/messages?conversationId=<id> — load all messages for a conversation
export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId")

  if (!conversationId) {
    return Response.json({ error: "conversationId is required" }, { status: 400 })
  }

  const cookieStore = await cookies()
  const sessionId = await getSessionId(cookieStore)
  if (!sessionId) return Response.json({ error: "Unauthorized" }, { status: 401 })

  // Verify the conversation belongs to this session
  const convRows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)

  if (convRows.length === 0 || convRows[0].sessionId !== sessionId) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt))

  return Response.json({ messages })
}
