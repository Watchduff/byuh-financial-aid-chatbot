import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type TypingRole = "student" | "admin"
type TypingState = {
  studentTyping: boolean
  adminTyping: boolean
  studentUpdatedAt: number
  adminUpdatedAt: number
}

const typingByRequest = new Map<string, TypingState>()
const TYPING_TTL_MS = 3500

function getTypingState(requestId: string): TypingState {
  const current = typingByRequest.get(requestId)
  if (current) return current

  const initial = {
    studentTyping: false,
    adminTyping: false,
    studentUpdatedAt: 0,
    adminUpdatedAt: 0,
  }
  typingByRequest.set(requestId, initial)
  return initial
}

function withExpiredStatuses(state: TypingState) {
  const now = Date.now()
  return {
    studentTyping: state.studentTyping && now - state.studentUpdatedAt < TYPING_TTL_MS,
    adminTyping: state.adminTyping && now - state.adminUpdatedAt < TYPING_TTL_MS,
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const requestId = (body.requestId as string | undefined)?.trim()
  const role = body.role as TypingRole | undefined
  const isTyping = Boolean(body.isTyping)

  if (!requestId || (role !== "student" && role !== "admin")) {
    return Response.json({ error: "requestId and valid role are required" }, { status: 400 })
  }

  const state = getTypingState(requestId)
  const now = Date.now()

  if (role === "student") {
    state.studentTyping = isTyping
    state.studentUpdatedAt = now
  } else {
    state.adminTyping = isTyping
    state.adminUpdatedAt = now
  }

  return Response.json(withExpiredStatuses(state))
}

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId")?.trim()

  if (!requestId) {
    return Response.json({ error: "requestId is required" }, { status: 400 })
  }

  const state = getTypingState(requestId)
  const statuses = withExpiredStatuses(state)

  if (!statuses.studentTyping) state.studentTyping = false
  if (!statuses.adminTyping) state.adminTyping = false

  return Response.json(statuses)
}
