import { verifyAdminAuth } from "@/lib/adminAuth"
import { db } from "@/db/index"
import { supportRequests, sessions } from "@/db/schema"
import { desc, eq } from "drizzle-orm"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// GET /api/admin/support-requests — list all support requests
export async function GET() {
  if (!(await verifyAdminAuth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const rows = await db
      .select({
        id: supportRequests.id,
        sessionId: supportRequests.sessionId,
        conversationId: supportRequests.conversationId,
        userMessage: supportRequests.userMessage,
        userEmail: supportRequests.userEmail,
        userPhone: supportRequests.userPhone,
        status: supportRequests.status,
        assignedAgentName: supportRequests.assignedAgentName,
        createdAt: supportRequests.createdAt,
        updatedAt: supportRequests.updatedAt,
      })
      .from(supportRequests)
      .orderBy(desc(supportRequests.createdAt))

    return Response.json({ supportRequests: rows })
  } catch (error) {
    console.error("[admin/support-requests] GET error:", error)
    return Response.json({ error: "Failed to fetch" }, { status: 500 })
  }
}
