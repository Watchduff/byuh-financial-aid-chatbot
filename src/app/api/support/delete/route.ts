import { NextRequest } from "next/server"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db/index"
import { supportRequests } from "@/db/schema"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function deletedFromStatus(status: string) {
  return status === "answered" || status === "resolved" || status === "closed" ? "answered" : "pending"
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const requestId = (body.requestId as string | undefined)?.trim()

    if (!requestId) {
      return Response.json({ error: "requestId is required" }, { status: 400 })
    }

    const [existingRequest] = await db
      .select()
      .from(supportRequests)
      .where(
        and(
          eq(supportRequests.id, requestId),
          inArray(supportRequests.status, ["pending", "active", "assigned", "answered", "resolved", "closed"])
        )
      )

    if (!existingRequest) {
      return Response.json({ error: "Support request not found" }, { status: 404 })
    }

    const deletedAt = new Date()
    const [supportRequest] = await db
      .update(supportRequests)
      .set({
        status: "deleted",
        deletedFromStatus: deletedFromStatus(existingRequest.status),
        deletedAt,
        updatedAt: deletedAt,
      })
      .where(eq(supportRequests.id, requestId))
      .returning()

    return Response.json({ supportRequest })
  } catch (error) {
    console.error("[support/delete] Error:", error)
    return Response.json({ error: "Failed to delete support request" }, { status: 500 })
  }
}
