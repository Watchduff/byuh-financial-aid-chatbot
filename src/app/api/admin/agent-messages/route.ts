import { NextRequest } from "next/server"
import { verifyAdminAuth } from "@/lib/adminAuth"
import { db } from "@/db/index"
import { agentMessages, supportRequests } from "@/db/schema"
import { eq } from "drizzle-orm"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// GET /api/admin/agent-messages?requestId=... — fetch all agent messages for a request
export async function GET(req: NextRequest) {
  if (!(await verifyAdminAuth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const requestId = req.nextUrl.searchParams.get("requestId")
  if (!requestId) {
    return Response.json({ error: "requestId is required" }, { status: 400 })
  }

  try {
    const messages = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.supportRequestId, requestId))
      .orderBy(agentMessages.createdAt)

    return Response.json({ messages })
  } catch (error) {
    console.error("[admin/agent-messages] GET error:", error)
    return Response.json({ error: "Failed to fetch" }, { status: 500 })
  }
}

// POST /api/admin/agent-messages — send a message as a human agent
export async function POST(req: NextRequest) {
  if (!(await verifyAdminAuth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json()
    const requestId = (body.requestId as string | undefined)?.trim()
    const agentName = (body.agentName as string | undefined)?.trim() || "Advisor"
    const content = (body.content as string | undefined)?.trim()

    if (!requestId || !content) {
      return Response.json({ error: "requestId and content are required" }, { status: 400 })
    }

    // Verify the support request exists
    const [sr] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, requestId))
      .limit(1)

    if (!sr) return Response.json({ error: "Support request not found" }, { status: 404 })

    const id = crypto.randomUUID()
    const [msg] = await db
      .insert(agentMessages)
      .values({ id, supportRequestId: requestId, agentName, content })
      .returning()

    // Auto-assign and mark as assigned if still pending
    if (sr.status === "pending") {
      await db
        .update(supportRequests)
        .set({ status: "assigned", assignedAgentName: agentName, updatedAt: new Date() })
        .where(eq(supportRequests.id, requestId))
    }

    return Response.json({ message: msg }, { status: 201 })
  } catch (error) {
    console.error("[admin/agent-messages] POST error:", error)
    return Response.json({ error: "Failed to send message" }, { status: 500 })
  }
}
