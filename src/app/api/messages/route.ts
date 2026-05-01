import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { eq, asc } from "drizzle-orm"
import { db } from "@/db/index"
import { conversations, chatMessages } from "@/db/schema"
import { getOrCreateSession, getSessionId } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type IncomingChatMessage = {
  role?: string
  content?: string
}

type ChatMessageInsert = {
  conversationId: string
  role: "user" | "assistant"
  content: string
}

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

// POST /api/messages — save one or more chat messages for a conversation
export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const sessionId = await getOrCreateSession(cookieStore)
  const body = await req.json().catch(() => ({}))
  const conversationId = (body.conversationId as string | undefined)?.trim()
  const messages = Array.isArray(body.messages) ? (body.messages as IncomingChatMessage[]) : []

  if (!conversationId || messages.length === 0) {
    return Response.json({ error: "conversationId and messages are required" }, { status: 400 })
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)

  if (!conversation || conversation.sessionId !== sessionId) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  const rows: ChatMessageInsert[] = messages
    .flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") return []
      const content = message.content?.trim()
      if (!content) return []
      return [{
        conversationId,
        role: message.role,
        content,
      }]
    })

  if (rows.length === 0) {
    return Response.json({ messages: [] }, { status: 201 })
  }

  const saved = await db.insert(chatMessages).values(rows).returning()
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))

  return Response.json({ messages: saved }, { status: 201 })
}
