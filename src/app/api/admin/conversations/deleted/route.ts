import { isNotNull, desc, eq, sql } from "drizzle-orm"
import { db } from "@/db/index"
import { conversations, chatMessages } from "@/db/schema"

export const runtime = "nodejs"

export async function GET() {
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      sessionId: conversations.sessionId,
      createdAt: conversations.createdAt,
      deletedAt: conversations.deletedAt,
      messageCount: sql<number>`cast(count(${chatMessages.id}) as int)`,
    })
    .from(conversations)
    .leftJoin(chatMessages, eq(chatMessages.conversationId, conversations.id))
    .where(isNotNull(conversations.deletedAt))
    .groupBy(conversations.id)
    .orderBy(desc(conversations.deletedAt))

  return Response.json({ conversations: rows })
}
