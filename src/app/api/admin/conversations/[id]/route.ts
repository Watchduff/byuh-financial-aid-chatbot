import { NextRequest } from "next/server"
import { eq, isNotNull } from "drizzle-orm"
import { db } from "@/db/index"
import { conversations } from "@/db/schema"

export const runtime = "nodejs"

// POST /api/admin/conversations/[id] with action in body
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { action } = await req.json().catch(() => ({ action: null }))

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1)

  if (!conv) return Response.json({ error: "Not found" }, { status: 404 })

  if (action === "delete") {
    await db
      .update(conversations)
      .set({ deletedAt: new Date() })
      .where(eq(conversations.id, id))
    return Response.json({ ok: true })
  }

  if (action === "restore") {
    await db
      .update(conversations)
      .set({ deletedAt: null })
      .where(eq(conversations.id, id))
    return Response.json({ ok: true })
  }

  return Response.json({ error: "Invalid action" }, { status: 400 })
}

// DELETE /api/admin/conversations/[id] — permanent delete
export async function DELETE(
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
  if (!conv.deletedAt) return Response.json({ error: "Conversation must be soft-deleted first" }, { status: 400 })

  await db.delete(conversations).where(eq(conversations.id, id))
  return Response.json({ ok: true })
}
