"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SUPPORT_HOURS_NOTE } from "@/lib/supportHours"

type ChatMessage = {
  id: number
  role: "user" | "assistant"
  content: string
  createdAt: string
}

type AdminMessage = {
  id: string
  agentName: string
  content: string
  createdAt: string
}

type SupportRequest = {
  id: string
  status: "pending" | "active" | "answered" | "deleted" | "assigned" | "resolved" | "closed"
  latestQuestion: string
  userMessage: string
  chatbotNote: string
  assignedAgentName: string | null
  createdAt: string
  updatedAt: string
  chatHistory: ChatMessage[]
  adminMessages: AdminMessage[]
}

type Filter = "pending" | "answered" | "all"

const STATUS_STYLES: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  active: "border-amber-200 bg-amber-50 text-amber-800",
  answered: "border-emerald-200 bg-emerald-50 text-emerald-800",
  assigned: "border-blue-200 bg-blue-50 text-blue-800",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  closed: "border-slate-200 bg-slate-100 text-slate-600",
}

const FILTER_OPTIONS: Array<{ id: Filter; label: string; description: string }> = [
  { id: "pending", label: "Pending", description: "Open conversations waiting for staff" },
  { id: "answered", label: "Answered", description: "Completed or closed support threads" },
  { id: "all", label: "All Requests", description: "Every visible support request" },
]

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function statusLabel(status: SupportRequest["status"]) {
  return status === "answered" || status === "resolved" || status === "closed"
    ? "Answered"
    : "Pending"
}

function InlineTypingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#eadfe0] bg-white px-3 py-2 text-xs text-slate-500">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9E1B34]/60 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9E1B34]/60 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9E1B34]/60" />
      </span>
    </div>
  )
}

export default function AdminConsolePage() {
  const [adminName, setAdminName] = useState("Financial Aid Advisor")
  const [filter, setFilter] = useState<Filter>("pending")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [requests, setRequests] = useState<SupportRequest[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [replies, setReplies] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [typingStatuses, setTypingStatuses] = useState<Record<string, boolean>>({})
  const adminTypingRefs = useRef<Record<string, boolean>>({})
  const adminTypingOffTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const fetchRequests = useCallback(async () => {
    setError("")
    try {
      const res = await fetch("/api/support/requests")
      if (!res.ok) throw new Error(`Request failed: ${res.status}`)
      const data = await res.json()
      setRequests(data.supportRequests ?? [])
    } catch {
      setError("Could not load support requests.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRequests()
    const interval = setInterval(fetchRequests, 3000)
    return () => clearInterval(interval)
  }, [fetchRequests])

  useEffect(() => {
    const activeExpandedIds = requests
      .filter((request) => expandedIds.has(request.id) && statusLabel(request.status) === "Pending")
      .map((request) => request.id)

    if (activeExpandedIds.length === 0) {
      setTypingStatuses({})
      return
    }

    async function pollTypingStatuses() {
      const entries = await Promise.all(
        activeExpandedIds.map(async (requestId) => {
          try {
            const res = await fetch(`/api/support/typing?requestId=${requestId}`)
            if (!res.ok) return [requestId, false] as const
            const data = await res.json()
            return [requestId, Boolean(data.studentTyping)] as const
          } catch {
            return [requestId, false] as const
          }
        })
      )

      setTypingStatuses(Object.fromEntries(entries))
    }

    pollTypingStatuses()
    const interval = setInterval(pollTypingStatuses, 1500)
    return () => clearInterval(interval)
  }, [expandedIds, requests])

  const counts = useMemo(() => {
    const visible = requests.filter((request) => request.status !== "deleted")
    const pending = visible.filter((request) => statusLabel(request.status) === "Pending").length
    const answered = visible.filter((request) => statusLabel(request.status) === "Answered").length
    return { pending, answered, all: visible.length }
  }, [requests])

  const visibleRequests = useMemo(() => {
    const notDeleted = requests.filter((request) => request.status !== "deleted")
    if (filter === "all") return notDeleted
    return notDeleted.filter((request) => statusLabel(request.status).toLowerCase() === filter)
  }, [filter, requests])

  const activeFilter = FILTER_OPTIONS.find((option) => option.id === filter) ?? FILTER_OPTIONS[0]
  const recentRequests = requests.filter((request) => request.status !== "deleted").slice(0, 5)

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function sendReply(requestId: string) {
    const content = replies[requestId]?.trim()
    if (!content || !adminName.trim()) return

    setSendingId(requestId)
    setError("")
    try {
      const res = await fetch("/api/support/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          adminName: adminName.trim(),
          content,
        }),
      })

      if (!res.ok) throw new Error(`Reply failed: ${res.status}`)
      await updateAdminTyping(requestId, false)
      adminTypingRefs.current[requestId] = false
      setReplies((prev) => ({ ...prev, [requestId]: "" }))
      await fetchRequests()
      setExpandedIds((prev) => new Set(prev).add(requestId))
    } catch {
      setError("Could not send the reply.")
    } finally {
      setSendingId(null)
    }
  }

  async function updateAdminTyping(requestId: string, isTyping: boolean) {
    await fetch("/api/support/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        role: "admin",
        isTyping,
      }),
    }).catch(() => undefined)
  }

  function handleReplyChange(requestId: string, value: string) {
    setReplies((prev) => ({
      ...prev,
      [requestId]: value,
    }))

    if (value.trim() && !adminTypingRefs.current[requestId]) {
      adminTypingRefs.current[requestId] = true
      void updateAdminTyping(requestId, true)
    }

    if (adminTypingOffTimers.current[requestId]) {
      clearTimeout(adminTypingOffTimers.current[requestId])
    }

    adminTypingOffTimers.current[requestId] = setTimeout(() => {
      adminTypingRefs.current[requestId] = false
      void updateAdminTyping(requestId, false)
    }, 2500)
  }

  async function markDone(requestId: string) {
    setCompletingId(requestId)
    setError("")
    try {
      const res = await fetch("/api/support/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      })

      if (!res.ok) throw new Error(`Complete failed: ${res.status}`)
      await fetchRequests()
    } catch {
      setError("Could not mark the request as done.")
    } finally {
      setCompletingId(null)
    }
  }

  async function deleteRequest(requestId: string, label: "Pending" | "Answered") {
    const message =
      label === "Answered"
        ? "Delete this answered support request? This will remove it from the admin console."
        : "Delete this pending support request? This will remove it from the admin console."

    if (!window.confirm(message)) return

    setDeletingId(requestId)
    setError("")
    try {
      const res = await fetch("/api/support/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      })

      if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
      await fetchRequests()
    } catch {
      setError("Could not delete the request.")
    } finally {
      setDeletingId(null)
    }
  }

  function openRecentRequest(request: SupportRequest) {
    setFilter(statusLabel(request.status).toLowerCase() as Filter)
    setExpandedIds((prev) => new Set(prev).add(request.id))
    setSidebarOpen(false)
  }

  return (
    <main className="min-h-screen bg-[#f7f4f2] text-slate-900">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-slate-950/35 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation overlay"
        />
      )}

      <div className="flex min-h-screen">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-[#7d1428] bg-[#9E1B34] text-white shadow-xl transition-transform md:sticky md:top-0 md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="border-b border-white/10 px-5 py-5">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-full bg-white leading-none shadow-sm">
                  <span className="text-[10px] font-extrabold text-[#9E1B34]">BYU</span>
                  <span className="text-[5.5px] font-bold uppercase tracking-wide text-[#9E1B34]">
                    HAWAII
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/55">
                    Financial Aid
                  </p>
                  <h1 className="text-sm font-bold leading-tight">Officials Console</h1>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close sidebar"
                className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white md:hidden"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>

            <button
              type="button"
              onClick={fetchRequests}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466.75.75 0 0 0-1.061 1.061 7 7 0 0 0 11.856-3.061.75.75 0 0 0-1.594-.466ZM4.688 8.576a5.5 5.5 0 0 1 9.201-2.466.75.75 0 1 0 1.061-1.061A7 7 0 0 0 3.094 8.11a.75.75 0 0 0 1.594.466Z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M3.25 4.75A.75.75 0 0 1 4 4h4.25a.75.75 0 0 1 0 1.5H5.81l1.72 1.72a.75.75 0 0 1-1.06 1.06L4.75 6.56V9a.75.75 0 0 1-1.5 0V4.75Zm13.5 10.5A.75.75 0 0 1 16 16h-4.25a.75.75 0 0 1 0-1.5h2.44l-1.72-1.72a.75.75 0 1 1 1.06-1.06l1.72 1.72V11a.75.75 0 0 1 1.5 0v4.25Z" clipRule="evenodd" />
              </svg>
              Refresh requests
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4">
            <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
              Queue
            </p>
            <div className="space-y-1">
              {FILTER_OPTIONS.map((option) => {
                const active = filter === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setFilter(option.id)
                      setSidebarOpen(false)
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${
                      active
                        ? "bg-white text-[#9E1B34] shadow-sm"
                        : "text-white/72 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                        active ? "bg-[#9E1B34]/10" : "bg-white/10"
                      }`}
                    >
                      {counts[option.id]}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className={`block truncate text-[11px] ${active ? "text-[#9E1B34]/65" : "text-white/45"}`}>
                        {option.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-6 border-t border-white/10 pt-4">
              <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
                Recent
              </p>
              {recentRequests.length === 0 ? (
                <p className="px-2 py-2 text-xs leading-5 text-white/45">No live support activity yet.</p>
              ) : (
                <div className="space-y-1">
                  {recentRequests.map((request) => (
                    <button
                      key={request.id}
                      type="button"
                      onClick={() => openRecentRequest(request)}
                      className="w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/10"
                    >
                      <span className="block truncate text-xs font-semibold text-white/85">
                        {request.latestQuestion}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-white/45">
                        {statusLabel(request.status)} - {formatDate(request.createdAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>

          <div className="border-t border-white/10 p-4">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
                Name shown to user
              </span>
              <input
                value={adminName}
                onChange={(event) => setAdminName(event.target.value)}
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/45 focus:bg-white/15"
                placeholder="Financial Aid Advisor"
              />
            </label>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-[#e5dede] bg-[#f7f4f2]/95 px-4 py-4 backdrop-blur md:px-6">
            <div className="mx-auto flex max-w-6xl items-center gap-4">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
                className="rounded-lg border border-[#e5dede] bg-white p-2 text-slate-600 shadow-sm transition hover:bg-[#fff7f7] md:hidden"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#BA0C2F]/70">
                  Live Support
                </p>
                <h2 className="truncate text-xl font-bold text-slate-950 md:text-2xl">
                  {activeFilter.label}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{activeFilter.description}</p>
              </div>
              <div className="hidden rounded-lg border border-[#e5dede] bg-white px-3 py-2 text-right shadow-sm sm:block">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Visible</p>
                <p className="text-lg font-bold text-[#9E1B34]">{visibleRequests.length}</p>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-6xl px-4 py-5 md:px-6">
            <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_1fr]">
              <p className="rounded-lg border border-[#e5dede] bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                {SUPPORT_HOURS_NOTE}
              </p>
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
                Do not request or store sensitive personal information in live chat. Direct account-specific records to official BYU-Hawaii Financial Aid channels.
              </p>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="rounded-lg border border-[#e5dede] bg-white py-16 text-center text-sm text-slate-400">
                Loading support requests...
              </div>
            ) : visibleRequests.length === 0 ? (
              <div className="rounded-lg border border-[#e5dede] bg-white py-16 text-center text-sm text-slate-400">
                No {filter === "all" ? "" : filter} support requests.
              </div>
            ) : (
              <div className="space-y-4">
                {visibleRequests.map((request) => {
                  const expanded = expandedIds.has(request.id)
                  const label = statusLabel(request.status)
                  const timeline = [
                    ...request.chatHistory.map((message) => ({
                      id: `chat-${message.id}`,
                      role: message.role === "user" ? "USER" : "ASSISTANT",
                      content: message.content,
                      createdAt: message.createdAt,
                    })),
                    ...request.adminMessages.map((message) => ({
                      id: `admin-${message.id}`,
                      role: "ADMIN",
                      content: `${message.agentName}: ${message.content}`,
                      createdAt: message.createdAt,
                    })),
                  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

                  return (
                    <article
                      key={request.id}
                      className="rounded-lg border border-[#e5dede] bg-white p-5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[request.status]}`}
                        >
                          {label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                            {formatDate(request.createdAt)}
                          </p>
                          <h2 className="mt-1 line-clamp-2 text-base font-semibold text-slate-900">
                            {request.latestQuestion}
                          </h2>
                          <p className="mt-2 rounded-lg bg-[#fdf8f8] px-3 py-2 text-sm text-slate-600">
                            Chatbot note: {request.chatbotNote}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(request.id)}
                          className="rounded-lg border border-[#dccfd0] px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                        >
                          {expanded ? "Collapse" : "Expand"}
                        </button>
                      </div>

                      {expanded && (
                        <div className="mt-5 border-t border-[#f0e8e8] pt-5">
                          <div className="space-y-3">
                            {timeline.length === 0 ? (
                              <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-400">
                                No conversation history was saved for this request.
                              </p>
                            ) : (
                              timeline.map((message) => (
                                <div
                                  key={message.id}
                                  className={`rounded-lg border px-4 py-3 ${
                                    message.role === "USER"
                                      ? "border-[#f3ccd4] bg-[#fff7f7]"
                                      : message.role === "ADMIN"
                                        ? "border-blue-200 bg-blue-50"
                                        : "border-slate-200 bg-slate-50"
                                  }`}
                                >
                                  <div className="mb-1 flex items-center justify-between gap-3">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                      {message.role}
                                    </span>
                                    <span className="text-xs text-slate-400">
                                      {formatDate(message.createdAt)}
                                    </span>
                                  </div>
                                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
                                    {message.content}
                                  </p>
                                </div>
                              ))
                            )}
                          </div>

                          <div className="mt-5 rounded-lg border border-[#e5dede] bg-[#fdf8f8] p-4">
                            {label === "Pending" && typingStatuses[request.id] && (
                              <div className="mb-3">
                                <InlineTypingIndicator label="User is typing..." />
                              </div>
                            )}
                            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                              Reply to user
                            </label>
                            <textarea
                              value={replies[request.id] ?? ""}
                              onChange={(event) => handleReplyChange(request.id, event.target.value)}
                              rows={3}
                              placeholder="Type your reply..."
                              className="w-full resize-none rounded-lg border border-[#dccfd0] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#BA0C2F]/50 focus:ring-2 focus:ring-[#BA0C2F]/10"
                            />
                            <div className="mt-3 flex flex-wrap justify-end gap-2">
                              {(label === "Pending" || label === "Answered") && (
                                <button
                                  type="button"
                                  onClick={() => deleteRequest(request.id, label)}
                                  disabled={deletingId === request.id}
                                  className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {deletingId === request.id ? "Deleting..." : "Delete"}
                                </button>
                              )}
                              {label === "Pending" && (
                                <button
                                  type="button"
                                  onClick={() => markDone(request.id)}
                                  disabled={completingId === request.id}
                                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {completingId === request.id ? "Marking..." : "Mark as Done"}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => sendReply(request.id)}
                                disabled={
                                  sendingId === request.id ||
                                  label !== "Pending" ||
                                  !adminName.trim() ||
                                  !replies[request.id]?.trim()
                                }
                                className="rounded-lg bg-[#BA0C2F] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#a80b2a] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {sendingId === request.id ? "Sending..." : "Send Reply"}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
