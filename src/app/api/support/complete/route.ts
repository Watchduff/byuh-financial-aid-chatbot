import { NextRequest } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/index"
import { supportRequests } from "@/db/schema"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  // LIVE_SUPPORT_DISABLED — remove this block to re-enable
  return Response.json({ error: "Live support is temporarily unavailable." }, { status: 503 })
  try {
    const body = await req.json().catch(() => ({}))
    const requestId: string = typeof body.requestId === "string" ? body.requestId.trim() : ""

    if (!requestId) {
      return Response.json({ error: "requestId is required" }, { status: 400 })
    }

    const [supportRequest] = await db
      .update(supportRequests)
      .set({ status: "answered", updatedAt: new Date() })
      .where(eq(supportRequests.id, requestId))
      .returning()

    if (!supportRequest) {
      return Response.json({ error: "Support request not found" }, { status: 404 })
    }

    return Response.json({ supportRequest })
  } catch (error) {
    console.error("[support/complete] Error:", error)
    return Response.json({ error: "Failed to complete support request" }, { status: 500 })
  }
}
