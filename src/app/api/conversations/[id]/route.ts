import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { eq, asc } from "drizzle-orm"
import { db } from "@/db/index"
import { conversations, chatMessages } from "@/db/schema"
import { getSessionId } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// GET /api/conversations/[id] — get conversation + messages
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const cookieStore = await cookies()
  const sessionId = await getSessionId(cookieStore)
  if (!sessionId) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1)

  if (rows.length === 0 || rows[0].sessionId !== sessionId) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, id))
    .orderBy(asc(chatMessages.createdAt))

  return Response.json({ conversation: rows[0], messages })
}

// DELETE /api/conversations/[id] — delete a conversation owned by this session
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const cookieStore = await cookies()
  const sessionId = await getSessionId(cookieStore)
  if (!sessionId) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1)

  if (rows.length === 0 || rows[0].sessionId !== sessionId) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  await db.delete(conversations).where(eq(conversations.id, id))
  return Response.json({ ok: true })
}
