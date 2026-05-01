import { NextRequest } from "next/server"
import { verifyAdminAuth } from "@/lib/adminAuth"
import { db } from "@/db/index"
import { supportRequests, chatMessages, agentMessages } from "@/db/schema"
import { eq } from "drizzle-orm"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// GET /api/admin/support-requests/[id] — get one request with conversation history
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminAuth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id } = await params
    const [sr] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, id))
      .limit(1)

    if (!sr) return Response.json({ error: "Not found" }, { status: 404 })

    // Fetch chat history if linked to a conversation
    const chatHistory = sr.conversationId
      ? await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.conversationId, sr.conversationId))
          .orderBy(chatMessages.createdAt)
      : []

    // Fetch agent messages
    const agentMsgs = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.supportRequestId, id))
      .orderBy(agentMessages.createdAt)

    return Response.json({ supportRequest: sr, chatHistory, agentMessages: agentMsgs })
  } catch (error) {
    console.error("[admin/support-requests/[id]] GET error:", error)
    return Response.json({ error: "Failed to fetch" }, { status: 500 })
  }
}

// PATCH /api/admin/support-requests/[id] — update status or assignedAgentName
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminAuth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await req.json()

    const updates: Partial<{ status: "pending" | "assigned" | "resolved" | "closed"; assignedAgentName: string; updatedAt: Date }> = {
      updatedAt: new Date(),
    }

    if (body.status) updates.status = body.status
    if (body.assignedAgentName !== undefined) updates.assignedAgentName = body.assignedAgentName

    const [updated] = await db
      .update(supportRequests)
      .set(updates)
      .where(eq(supportRequests.id, id))
      .returning()

    if (!updated) return Response.json({ error: "Not found" }, { status: 404 })

    return Response.json({ supportRequest: updated })
  } catch (error) {
    console.error("[admin/support-requests/[id]] PATCH error:", error)
    return Response.json({ error: "Failed to update" }, { status: 500 })
  }
}
