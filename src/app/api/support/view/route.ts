import { NextRequest } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/index"
import { supportRequests } from "@/db/schema"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Called when an admin expands a pending request card.
// Marks the request as "active" so the student sees the advisor is here.
export async function POST(req: NextRequest) {
  // LIVE_SUPPORT_DISABLED — remove this block to re-enable
  return Response.json({ error: "Live support is temporarily unavailable." }, { status: 503 })
  try {
    const body = await req.json().catch(() => ({}))
    const requestId: string = typeof body.requestId === "string" ? body.requestId.trim() : ""

    if (!requestId) {
      return Response.json({ error: "requestId is required" }, { status: 400 })
    }

    await db
      .update(supportRequests)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(supportRequests.id, requestId))

    return Response.json({ ok: true })
  } catch (error) {
    console.error("[support/view] Error:", error)
    return Response.json({ error: "Failed to update request" }, { status: 500 })
  }
}
