import { NextRequest } from "next/server"
import { asc, eq } from "drizzle-orm"
import { db } from "@/db/index"
import { chatMessages, conversations } from "@/db/schema"

export const runtime = "nodejs"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1)

  if (!conv) return Response.json({ error: "Not found" }, { status: 404 })

  const messages = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, id))
    .orderBy(asc(chatMessages.createdAt))

  return Response.json({ messages })
}
