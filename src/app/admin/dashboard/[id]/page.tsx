"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"

type ChatMessage = {
  id: number
  role: "user" | "assistant"
  content: string
  createdAt: string
}

type AgentMessage = {
  id: string
  agentName: string
  content: string
  createdAt: string
}

type SupportRequest = {
  id: string
  userMessage: string
  userEmail: string | null
  userPhone: string | null
  status: "pending" | "assigned" | "resolved" | "closed"
  assignedAgentName: string | null
  conversationId: string | null
  createdAt: string
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  assigned: "bg-blue-50 text-blue-700 border-blue-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-500 border-slate-200",
}

const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber-400",
  assigned: "bg-blue-400",
  resolved: "bg-emerald-400",
  closed: "bg-slate-300",
}

export default function AdminDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const endRef = useRef<HTMLDivElement>(null)

  const [sr, setSr] = useState<SupportRequest | null>(null)
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [agentMsgs, setAgentMsgs] = useState<AgentMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState("")
  const [agentName, setAgentName] = useState("")
  const [sending, setSending] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)

  async function fetchDetail() {
    try {
      const res = await fetch(`/api/admin/support-requests/${id}`)
      if (res.status === 401) { router.push("/admin"); return }
      if (!res.ok) { router.push("/admin/dashboard"); return }
      const data = await res.json()
      setSr(data.supportRequest)
      setChatHistory(data.chatHistory ?? [])
      setAgentMsgs(data.agentMessages ?? [])
      if (data.supportRequest?.assignedAgentName && !agentName) {
        setAgentName(data.supportRequest.assignedAgentName)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDetail()
    const interval = setInterval(async () => {
      const res = await fetch(`/api/admin/agent-messages?requestId=${id}`)
      if (res.ok) {
        const data = await res.json()
        setAgentMsgs(data.messages ?? [])
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [id])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatHistory, agentMsgs])

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim() || !agentName.trim()) return

    setSending(true)
    try {
      const res = await fetch("/api/admin/agent-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id, agentName: agentName.trim(), content: reply.trim() }),
      })
      if (res.ok) {
        setReply("")
        await fetchDetail()
      }
    } finally {
      setSending(false)
    }
  }

  async function handleStatusChange(newStatus: string) {
    setStatusUpdating(true)
    try {
      await fetch(`/api/admin/support-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      await fetchDetail()
    } finally {
      setStatusUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#f7f4f2] text-sm text-slate-400">
        <div className="flex gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
        </div>
        Loading request…
      </div>
    )
  }

  if (!sr) return null

  type TimelineEntry =
    | { kind: "chat"; msg: ChatMessage }
    | { kind: "agent"; msg: AgentMessage }

  const timeline: TimelineEntry[] = [
    ...chatHistory.map((m) => ({ kind: "chat" as const, msg: m })),
    ...agentMsgs.map((m) => ({ kind: "agent" as const, msg: m })),
  ].sort((a, b) => new Date(a.msg.createdAt).getTime() - new Date(b.msg.createdAt).getTime())

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f4f2]">
      {/* Header */}
      <header className="border-b border-[#9e1b34]/20 bg-[#BA0C2F] text-white shadow-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <Link
            href="/admin/dashboard"
            className="rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="Back to dashboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
            </svg>
          </Link>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-[10px] font-extrabold ring-1 ring-white/30">
            BYU
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/60">Support Request</p>
            <p className="truncate text-sm font-bold">{sr.userMessage}</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold capitalize ${STATUS_STYLES[sr.status]}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[sr.status]}`} />
            {sr.status}
          </span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-5 px-6 py-6">
        {/* Sidebar: student info + status controls */}
        <aside className="w-64 shrink-0 space-y-4">
          <div className="rounded-2xl border border-[#e5dede] bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Student Info</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Requested</p>
                <p className="mt-0.5 text-slate-700">{new Date(sr.createdAt).toLocaleString()}</p>
              </div>
              {sr.userEmail && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Email</p>
                  <p className="mt-0.5 text-slate-700">{sr.userEmail}</p>
                </div>
              )}
              {sr.userPhone && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Phone</p>
                  <p className="mt-0.5 text-slate-700">{sr.userPhone}</p>
                </div>
              )}
              {sr.assignedAgentName && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Assigned to</p>
                  <p className="mt-0.5 font-medium text-slate-700">{sr.assignedAgentName}</p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[#e5dede] bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Update Status</h2>
            <div className="space-y-2">
              {(["pending", "assigned", "resolved", "closed"] as const).map((s) => (
                <button
                  key={s}
                  disabled={sr.status === s || statusUpdating}
                  onClick={() => handleStatusChange(s)}
                  className={`w-full rounded-xl border py-2 text-xs font-semibold capitalize transition ${
                    sr.status === s
                      ? "border-[#BA0C2F]/30 bg-[#BA0C2F] text-white"
                      : "border-[#e5dede] bg-white text-slate-600 hover:bg-[#fff7f7] hover:border-[#BA0C2F]/30"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main: conversation + reply */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Conversation timeline */}
          <div className="flex-1 overflow-y-auto rounded-2xl border border-[#e5dede] bg-white p-5 shadow-sm" style={{ minHeight: 320 }}>
            {timeline.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center py-12 text-center text-sm text-slate-400">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mb-3 h-8 w-8 text-slate-200">
                  <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.17l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.17 48.9 48.9 0 0 1-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97Z" clipRule="evenodd" />
                </svg>
                No conversation history linked.
                <p className="mt-1 text-xs text-slate-300">Original message: &ldquo;{sr.userMessage}&rdquo;</p>
              </div>
            ) : (
              <div className="space-y-3">
                {timeline.map((entry) => {
                  if (entry.kind === "chat") {
                    const m = entry.msg
                    const isUser = m.role === "user"
                    return (
                      <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                            isUser
                              ? "bg-[#BA0C2F] text-white"
                              : "border border-[#eadfe0] bg-[#fdf8f8] text-slate-800"
                          }`}
                        >
                          {!isUser && (
                            <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">AI Assistant</p>
                          )}
                          {m.content}
                        </div>
                      </div>
                    )
                  } else {
                    const m = entry.msg
                    return (
                      <div key={m.id} className="flex justify-start">
                        <div className="max-w-[80%] rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm leading-relaxed text-slate-800">
                          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-blue-500">
                            {m.agentName} · You
                          </p>
                          {m.content}
                        </div>
                      </div>
                    )
                  }
                })}
                <div ref={endRef} />
              </div>
            )}
          </div>

          {/* Reply form */}
          {sr.status !== "closed" ? (
            <div className="rounded-2xl border border-[#e5dede] bg-white p-5 shadow-sm">
              <form onSubmit={handleSendReply} className="space-y-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Your name (shown to student)
                  </label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="e.g. Jershon"
                    required
                    className="w-full rounded-xl border border-[#dccfd0] bg-[#fdf8f8] px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#BA0C2F]/40 focus:ring-2 focus:ring-[#BA0C2F]/10 placeholder:text-slate-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Reply to student
                  </label>
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Type your response here…"
                    rows={3}
                    required
                    className="w-full resize-none rounded-xl border border-[#dccfd0] bg-[#fdf8f8] px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#BA0C2F]/40 focus:ring-2 focus:ring-[#BA0C2F]/10 placeholder:text-slate-400"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">Delivered to the student in real time.</p>
                  <button
                    type="submit"
                    disabled={sending || !reply.trim() || !agentName.trim()}
                    className="flex items-center gap-2 rounded-xl bg-[#BA0C2F] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#a80b2a] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sending ? "Sending…" : "Send Reply"}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.154.75.75 0 0 0 0-1.115A28.897 28.897 0 0 0 3.105 2.288Z" />
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-center text-sm text-slate-400">
              This request is closed. No further replies can be sent.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
