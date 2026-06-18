import { NextRequest } from "next/server"
import { eq } from "drizzle-orm"
import { db } from "@/db/index"
import { typingStates } from "@/db/schema"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type TypingRole = "student" | "admin"
const TYPING_TTL_MS = 3500

function withExpiredStatuses(state: typeof typingStates.$inferSelect) {
  const now = Date.now()
  const studentTyping =
    state.studentTyping &&
    state.studentUpdatedAt != null &&
    now - new Date(state.studentUpdatedAt).getTime() < TYPING_TTL_MS
  const adminTyping =
    state.adminTyping &&
    state.adminUpdatedAt != null &&
    now - new Date(state.adminUpdatedAt).getTime() < TYPING_TTL_MS
  return {
    studentTyping,
    adminTyping,
    studentDraft: studentTyping ? state.studentDraft : "",
  }
}

export async function POST(req: NextRequest) {
  // LIVE_SUPPORT_DISABLED — remove this block to re-enable
  return Response.json({ error: "Live support is temporarily unavailable." }, { status: 503 })
  const body = await req.json().catch(() => ({}))
  const requestId = (body.requestId as string | undefined)?.trim()
  const role = body.role as TypingRole | undefined
  const isTyping = Boolean(body.isTyping)
  const draft = typeof body.draft === "string" ? body.draft : ""

  if (!requestId || (role !== "student" && role !== "admin")) {
    return Response.json({ error: "requestId and valid role are required" }, { status: 400 })
  }

  const now = new Date()

  if (role === "student") {
    await db
      .insert(typingStates)
      .values({
        requestId,
        studentTyping: isTyping,
        studentUpdatedAt: now,
        studentDraft: isTyping ? draft : "",
        adminTyping: false,
        adminUpdatedAt: null,
      })
      .onConflictDoUpdate({
        target: typingStates.requestId,
        set: {
          studentTyping: isTyping,
          studentUpdatedAt: now,
          studentDraft: isTyping ? draft : "",
        },
      })
  } else {
    await db
      .insert(typingStates)
      .values({
        requestId,
        adminTyping: isTyping,
        adminUpdatedAt: now,
        studentTyping: false,
        studentUpdatedAt: null,
        studentDraft: "",
      })
      .onConflictDoUpdate({
        target: typingStates.requestId,
        set: {
          adminTyping: isTyping,
          adminUpdatedAt: now,
        },
      })
  }

  const state = await db
    .select()
    .from(typingStates)
    .where(eq(typingStates.requestId, requestId))
    .then((rows) => rows[0])

  if (!state) {
    return Response.json({ studentTyping: false, adminTyping: false, studentDraft: "" })
  }

  return Response.json(withExpiredStatuses(state))
}

export async function GET(req: NextRequest) {
  // LIVE_SUPPORT_DISABLED — remove this block to re-enable
  return Response.json({ studentTyping: false, adminTyping: false, studentDraft: "" }, { status: 200 })
  const requestId = req.nextUrl.searchParams.get("requestId")?.trim()

  if (!requestId) {
    return Response.json({ error: "requestId is required" }, { status: 400 })
  }

  const state = await db
    .select()
    .from(typingStates)
    .where(eq(typingStates.requestId, requestId))
    .then((rows) => rows[0])

  if (!state) {
    return Response.json({ studentTyping: false, adminTyping: false, studentDraft: "" })
  }

  return Response.json(withExpiredStatuses(state))
}
