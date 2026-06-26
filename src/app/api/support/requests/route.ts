import { NextRequest } from "next/server"
import { asc, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db/index"
import { agentMessages, chatMessages, supportRequests } from "@/db/schema"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const ESCALATION_NOTE_PREFIX = "[Support escalation]"

export async function GET(req: NextRequest) {
  // LIVE_SUPPORT_DISABLED — remove this block to re-enable
  return Response.json({ supportRequests: [] }, { status: 200 })
  try {
    const status = req.nextUrl.searchParams.get("status")
    const where =
      status === "pending"
        ? inArray(supportRequests.status, ["pending", "active", "assigned"])
        : status === "answered"
          ? eq(supportRequests.status, "answered")
          : status === "deleted"
            ? eq(supportRequests.status, "deleted")
            : inArray(supportRequests.status, ["pending", "active", "assigned", "answered", "deleted"])

    const requests = await db
      .select()
      .from(supportRequests)
      .where(where)
      .orderBy(desc(supportRequests.createdAt))

    const supportRequestsWithMessages = await Promise.all(
      requests.map(async (request) => {
        const history = request.conversationId
          ? await db
              .select()
              .from(chatMessages)
              .where(eq(chatMessages.conversationId, request.conversationId as string))
              .orderBy(asc(chatMessages.createdAt))
          : []

        const replies = await db
          .select()
          .from(agentMessages)
          .where(eq(agentMessages.supportRequestId, request.id))
          .orderBy(asc(agentMessages.createdAt))

        const escalationNotes = history
          .filter((message) => message.content.startsWith(ESCALATION_NOTE_PREFIX))
          .map((message) => message.content.replace(ESCALATION_NOTE_PREFIX, "").trim())
        const visibleHistory = history.filter((message) => !message.content.startsWith(ESCALATION_NOTE_PREFIX))

        return {
          ...request,
          latestQuestion: request.userMessage,
          chatbotNote: escalationNotes.at(-1) || "User asked to speak to a human",
          chatHistory: visibleHistory,
          adminMessages: replies,
        }
      })
    )

    return Response.json({ supportRequests: supportRequestsWithMessages })
  } catch (error) {
    console.error("[support/requests] Error:", error)
    return Response.json({ error: "Failed to fetch support requests" }, { status: 500 })
  }
}
