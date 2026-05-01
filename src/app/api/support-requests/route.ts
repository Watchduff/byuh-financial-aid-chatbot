import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { eq } from "drizzle-orm"
import { db } from "@/db/index"
import { supportRequests } from "@/db/schema"
import { getOrCreateSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// POST /api/support-requests — create a new support request for live agent assistance
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    const sessionId = await getOrCreateSession(cookieStore)

    const body = await req.json().catch(() => ({}))
    const userMessage = (body.userMessage as string | undefined)?.trim()
    const userEmail = (body.userEmail as string | undefined)?.trim()
    const userPhone = (body.userPhone as string | undefined)?.trim()
    const conversationId = (body.conversationId as string | undefined)?.trim()

    // Validate required field
    if (!userMessage) {
      return Response.json(
        { error: "userMessage is required" },
        { status: 400 }
      )
    }

    const id = crypto.randomUUID()
    const [request] = await db
      .insert(supportRequests)
      .values({
        id,
        sessionId,
        conversationId: conversationId || null,
        userMessage,
        userEmail: userEmail || null,
        userPhone: userPhone || null,
        status: "pending",
      })
      .returning()

    return Response.json({ supportRequest: request }, { status: 201 })
  } catch (error) {
    console.error("[support-requests] Error:", error)
    return Response.json(
      { error: "Failed to create support request" },
      { status: 500 }
    )
  }
}

// GET /api/support-requests — list all support requests for the current session
export async function GET() {
  try {
    const cookieStore = await cookies()
    const sessionId = await getOrCreateSession(cookieStore)

    const rows = await db
      .select()
      .from(supportRequests)
      .where(eq(supportRequests.sessionId, sessionId))

    return Response.json({ supportRequests: rows })
  } catch (error) {
    console.error("[support-requests] Error:", error)
    return Response.json(
      { error: "Failed to fetch support requests" },
      { status: 500 }
    )
  }
}
