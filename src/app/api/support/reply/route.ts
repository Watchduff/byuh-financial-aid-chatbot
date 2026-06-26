import { NextRequest } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/index"
import { agentMessages, supportRequests } from "@/db/schema"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  // LIVE_SUPPORT_DISABLED — remove this block to re-enable
  return Response.json({ error: "Live support is temporarily unavailable." }, { status: 503 })
  try {
    const body = await req.json().catch(() => ({}))
    const requestId: string = typeof body.requestId === "string" ? body.requestId.trim() : ""
    const adminName: string = typeof body.adminName === "string" && body.adminName.trim() ? body.adminName.trim() : "Financial Aid Advisor"
    const content: string = typeof body.content === "string" ? body.content.trim() : ""

    if (!requestId || !content) {
      return Response.json({ error: "requestId and content are required" }, { status: 400 })
    }

    const [supportRequest] = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.id, requestId))
      .limit(1)

    if (!supportRequest) {
      return Response.json({ error: "Support request not found" }, { status: 404 })
    }

    const [message] = await db
      .insert(agentMessages)
      .values({
        id: crypto.randomUUID(),
        supportRequestId: requestId,
        agentName: adminName,
        content,
      })
      .returning()

    const [updatedRequest] = await db
      .update(supportRequests)
      .set({
        assignedAgentName: adminName,
        updatedAt: new Date(),
      })
      .where(eq(supportRequests.id, requestId))
      .returning()

    return Response.json({ message, supportRequest: updatedRequest }, { status: 201 })
  } catch (error) {
    console.error("[support/reply] Error:", error)
    return Response.json({ error: "Failed to save reply" }, { status: 500 })
  }
}
