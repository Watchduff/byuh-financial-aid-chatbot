import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { eq, desc } from "drizzle-orm"
import { db } from "@/db/index"
import { conversations } from "@/db/schema"
import { getOrCreateSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// GET /api/conversations — list all conversations for the current session
export async function GET() {
  const cookieStore = await cookies()
  const sessionId = await getOrCreateSession(cookieStore)

  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.sessionId, sessionId))
    .orderBy(desc(conversations.updatedAt))

  return Response.json({ conversations: rows })
}

// POST /api/conversations — create a new empty conversation
export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const sessionId = await getOrCreateSession(cookieStore)

  const body = await req.json().catch(() => ({}))
  const title = (body.title as string | undefined)?.slice(0, 80) || "New Conversation"

  const id = crypto.randomUUID()
  const [conv] = await db
    .insert(conversations)
    .values({ id, sessionId, title })
    .returning()

  return Response.json({ conversation: conv }, { status: 201 })
}
