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
  deletedFromStatus: "pending" | "answered" | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  chatHistory: ChatMessage[]
  adminMessages: AdminMessage[]
}

type ChatHistoryEntry = {
  id: string
  conversationId: string
  conversationTitle: string
  question: string
  questionAt: string
  answer: string
  answerAt: string | null
  confidence: "high" | "low"
  confidenceScore: number | null
  mode: string | null
  sources: string[]
}

type Filter = "pending" | "answered" | "all" | "trash" | "history"
type ConfidenceFilter = "all" | "high" | "low"
type HistoryGroupBy = "day" | "month"

const STATUS_STYLES: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  active: "border-amber-200 bg-amber-50 text-amber-800",
  answered: "border-emerald-200 bg-emerald-50 text-emerald-800",
  assigned: "border-blue-200 bg-blue-50 text-blue-800",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  closed: "border-slate-200 bg-slate-100 text-slate-600",
  deleted: "border-red-200 bg-red-50 text-red-800",
}

type QueueFilter = Exclude<Filter, "trash" | "history">

const FILTER_OPTIONS: Array<{ id: QueueFilter; label: string; description: string }> = [
  { id: "pending", label: "Pending", description: "Open conversations waiting for staff" },
  { id: "answered", label: "Answered", description: "Completed or closed support threads" },
  { id: "all", label: "All Requests", description: "Every visible support request" },
]

const TRASH_FILTER = {
  id: "trash" as const,
  label: "Trash Bin",
  description: "Deleted support requests for supervisor review",
}

const HISTORY_FILTER = {
  id: "history" as const,
  label: "Chat History",
  description: "User questions and chatbot confidence",
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })
}

function formatDayLabel(value: string) {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return "Today"

  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function formatMonthLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  })
}

function statusLabel(status: SupportRequest["status"]) {
  return status === "answered" || status === "resolved" || status === "closed"
    ? "Answered"
    : status === "deleted"
      ? "Deleted"
    : "Pending"
}

function deletedCategory(request: SupportRequest) {
  if (request.deletedFromStatus) return request.deletedFromStatus
  return request.adminMessages.length > 0 ? "answered" : "pending"
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
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all")
  const [historyGroupBy, setHistoryGroupBy] = useState<HistoryGroupBy>("day")
  const [historySearch, setHistorySearch] = useState("")
  const [selectedHistoryConversationId, setSelectedHistoryConversationId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [requests, setRequests] = useState<SupportRequest[]>([])
  const [chatHistory, setChatHistory] = useState<ChatHistoryEntry[]>([])
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

  const fetchChatHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/support/chat-history")
      if (!res.ok) throw new Error(`Request failed: ${res.status}`)
      const data = await res.json()
      setChatHistory(data.history ?? [])
    } catch {
      setError("Could not load chat history.")
    }
  }, [])

  useEffect(() => {
    fetchRequests()
    fetchChatHistory()
    const interval = setInterval(() => {
      fetchRequests()
      fetchChatHistory()
    }, 3000)
    return () => clearInterval(interval)
  }, [fetchChatHistory, fetchRequests])

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

  const trashCounts = useMemo(() => {
    const deleted = requests.filter((request) => request.status === "deleted")
    const pending = deleted.filter((request) => deletedCategory(request) === "pending").length
    const answered = deleted.filter((request) => deletedCategory(request) === "answered").length
    return { pending, answered, all: deleted.length }
  }, [requests])

  const historyCounts = useMemo(() => {
    const high = chatHistory.filter((entry) => entry.confidence === "high").length
    const low = chatHistory.filter((entry) => entry.confidence === "low").length
    return { high, low, all: chatHistory.length }
  }, [chatHistory])

  const visibleChatHistory = useMemo(() => {
    const byConfidence =
      confidenceFilter === "all"
        ? chatHistory
        : chatHistory.filter((entry) => entry.confidence === confidenceFilter)

    const query = historySearch.trim().toLowerCase()
    if (!query) return byConfidence

    return byConfidence.filter((entry) =>
      [
        entry.conversationTitle,
        entry.question,
        entry.answer,
        entry.confidence,
        ...entry.sources,
      ].some((value) => value.toLowerCase().includes(query))
    )
  }, [chatHistory, confidenceFilter, historySearch])

  const historyConversations = useMemo(() => {
    const byConversation = new Map<string, ChatHistoryEntry[]>()

    for (const entry of visibleChatHistory) {
      const current = byConversation.get(entry.conversationId) ?? []
      current.push(entry)
      byConversation.set(entry.conversationId, current)
    }

    return Array.from(byConversation.entries())
      .map(([conversationId, entries]) => {
        const sortedEntries = [...entries].sort(
          (a, b) => new Date(a.questionAt).getTime() - new Date(b.questionAt).getTime()
        )
        const latestEntry = sortedEntries.at(-1) ?? entries[0]
        const lowCount = entries.filter((entry) => entry.confidence === "low").length
        const highCount = entries.filter((entry) => entry.confidence === "high").length

        return {
          conversationId,
          title: latestEntry.conversationTitle,
          preview: latestEntry.question,
          latestAt: latestEntry.questionAt,
          entries: sortedEntries,
          lowCount,
          highCount,
          total: entries.length,
        }
      })
      .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())
  }, [visibleChatHistory])

  const selectedHistoryConversation = useMemo(() => {
    return historyConversations.find((conversation) => conversation.conversationId === selectedHistoryConversationId)
      ?? historyConversations[0]
      ?? null
  }, [historyConversations, selectedHistoryConversationId])

  const groupedHistoryConversations = useMemo(() => {
    return historyConversations.reduce<Array<{ label: string; conversations: typeof historyConversations }>>((groups, conversation) => {
      const label = historyGroupBy === "month"
        ? formatMonthLabel(conversation.latestAt)
        : formatDayLabel(conversation.latestAt)
      const current = groups.find((group) => group.label === label)
      if (current) {
        current.conversations.push(conversation)
      } else {
        groups.push({ label, conversations: [conversation] })
      }
      return groups
    }, [])
  }, [historyConversations, historyGroupBy])

  const visibleRequests = useMemo(() => {
    if (filter === "trash") return requests.filter((request) => request.status === "deleted")
    const notDeleted = requests.filter((request) => request.status !== "deleted")
    if (filter === "all") return notDeleted
    return notDeleted.filter((request) => statusLabel(request.status).toLowerCase() === filter)
  }, [filter, requests])

  const activeFilter = filter === "trash"
    ? TRASH_FILTER
    : filter === "history"
      ? HISTORY_FILTER
      : FILTER_OPTIONS.find((option) => option.id === filter) ?? FILTER_OPTIONS[0]
  const recentRequests = requests.filter((request) => request.status !== "deleted").slice(0, 5)
  const isTrashView = filter === "trash"
  const isHistoryView = filter === "history"

  useEffect(() => {
    if (!isHistoryView) return
    if (historyConversations.length === 0) {
      setSelectedHistoryConversationId(null)
      return
    }
    if (!selectedHistoryConversationId || !historyConversations.some((conversation) => conversation.conversationId === selectedHistoryConversationId)) {
      setSelectedHistoryConversationId(historyConversations[0].conversationId)
    }
  }, [historyConversations, isHistoryView, selectedHistoryConversationId])

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
    setFilter(statusLabel(request.status).toLowerCase() as QueueFilter)
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
                Insights
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilter("history")
                  setSidebarOpen(false)
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${
                  isHistoryView
                    ? "bg-white text-[#9E1B34] shadow-sm"
                    : "text-white/72 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    isHistoryView ? "bg-[#9E1B34]/10" : "bg-white/10"
                  }`}
                >
                  {historyCounts.all}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{HISTORY_FILTER.label}</span>
                  <span className={`block truncate text-[11px] ${isHistoryView ? "text-[#9E1B34]/65" : "text-white/45"}`}>
                    {HISTORY_FILTER.description}
                  </span>
                </span>
              </button>
            </div>

            <div className="mt-6 border-t border-white/10 pt-4">
              <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
                Deleted
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilter("trash")
                  setSidebarOpen(false)
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${
                  isTrashView
                    ? "bg-white text-[#9E1B34] shadow-sm"
                    : "text-white/72 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    isTrashView ? "bg-[#9E1B34]/10" : "bg-white/10"
                  }`}
                >
                  {trashCounts.all}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{TRASH_FILTER.label}</span>
                  <span className={`block truncate text-[11px] ${isTrashView ? "text-[#9E1B34]/65" : "text-white/45"}`}>
                    {TRASH_FILTER.description}
                  </span>
                </span>
              </button>
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
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {isHistoryView ? "Questions" : "Visible"}
                </p>
                <p className="text-lg font-bold text-[#9E1B34]">
                  {isHistoryView ? visibleChatHistory.length : visibleRequests.length}
                </p>
              </div>
            </div>
          </header>

          <div className={`mx-auto px-4 py-5 md:px-6 ${isHistoryView ? "max-w-none" : "max-w-6xl"}`}>
            <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_1fr]">
              <p className="rounded-lg border border-[#e5dede] bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                {SUPPORT_HOURS_NOTE}
              </p>
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
                Do not request or store sensitive personal information in live chat. Direct account-specific records to official BYU-Hawaii Financial Aid channels.
              </p>
            </div>

            {isTrashView && (
              <div className="mb-5 grid gap-3 sm:grid-cols-3">
                {[
                  { label: "Deleted Pending", count: trashCounts.pending },
                  { label: "Deleted Answered", count: trashCounts.answered },
                  { label: "All Deleted Requests", count: trashCounts.all },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-[#e5dede] bg-white px-4 py-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                      {item.label}
                    </p>
                    <p className="mt-2 text-2xl font-bold text-[#9E1B34]">{item.count}</p>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="rounded-lg border border-[#e5dede] bg-white py-16 text-center text-sm text-slate-400">
                Loading support requests...
              </div>
            ) : isHistoryView ? (
              historyConversations.length === 0 ? (
                <div className="rounded-lg border border-[#e5dede] bg-white py-16 text-center text-sm text-slate-400">
                  No {confidenceFilter === "all" ? "" : confidenceFilter + " confidence "}chat history yet.
                </div>
              ) : (
                <div className="space-y-5">
                  <section className="rounded-lg border border-[#d8e0e8] bg-white px-6 py-6 shadow-sm">
                    <div className="mb-6 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Controls</p>
                        <h3 className="mt-1 text-2xl font-bold text-slate-950">Filters</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setConfidenceFilter("all")
                          setHistoryGroupBy("day")
                          setHistorySearch("")
                        }}
                        className="rounded-lg border border-[#d8e0e8] bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
                      >
                        Reset
                      </button>
                    </div>

                    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                      <div>
                        <p className="mb-3 text-sm font-bold text-slate-950">Confidence</p>
                        <div className="grid gap-3 md:grid-cols-3">
                          {([
                            { id: "all", label: "All responses", count: historyCounts.all },
                            { id: "high", label: "High confidence", count: historyCounts.high },
                            { id: "low", label: "Low confidence", count: historyCounts.low },
                          ] as const).map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setConfidenceFilter(option.id)}
                              className={`flex items-center justify-between rounded-lg border px-5 py-4 text-left text-base font-semibold transition ${
                                confidenceFilter === option.id
                                  ? "border-[#9E1B34] bg-[#fff7f7] text-[#9E1B34]"
                                  : "border-[#e5dede] bg-white text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              <span>{option.label}</span>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-sm text-slate-500">{option.count}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="mb-3 text-sm font-bold text-slate-950">Group Chats</p>
                        <div className="grid grid-cols-2 gap-3">
                          {(["day", "month"] as const).map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => setHistoryGroupBy(option)}
                              className={`rounded-lg border px-5 py-4 text-base font-semibold capitalize transition ${
                                historyGroupBy === option
                                  ? "border-slate-800 bg-slate-900 text-white"
                                  : "border-[#e5dede] bg-white text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-6">
                      <p className="mb-3 text-sm font-bold text-slate-950">Cookie Note</p>
                      <p className="rounded-lg border border-blue-100 bg-blue-50 px-5 py-4 text-sm leading-6 text-blue-900">
                        Student chats use an anonymous browser session cookie to reconnect the student to their own conversation. This admin history is loaded from saved database records, so supervisors can review conversations even when they are not using the student&apos;s browser.
                      </p>
                    </div>
                  </section>

                  <div className="grid min-h-[720px] overflow-hidden rounded-lg border border-[#d8e0e8] bg-white shadow-sm lg:grid-cols-[420px_minmax(0,1fr)] 2xl:grid-cols-[480px_minmax(0,1fr)]">
                  <aside className="border-b border-[#d8e0e8] bg-slate-50 lg:border-b-0 lg:border-r">
                    <div className="border-b border-[#d8e0e8] px-6 py-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                            Inbox Chats
                          </p>
                          <h3 className="mt-1 text-lg font-bold text-slate-950">{historyConversations.length} conversations</h3>
                        </div>
                        <span className="rounded-lg border border-[#dccfd0] bg-white px-2.5 py-1 text-xs font-bold text-slate-500">
                          {visibleChatHistory.length} turns
                        </span>
                      </div>
                      <label className="mt-4 block">
                        <span className="sr-only">Search conversations</span>
                        <div className="flex items-center gap-3 rounded-lg border border-[#cbd5e1] bg-white px-3 py-3 shadow-sm">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-slate-400">
                            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.473 9.765l2.631 2.631a.75.75 0 1 0 1.061-1.06l-2.631-2.632A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0A4 4 0 0 1 5 9Z" clipRule="evenodd" />
                          </svg>
                          <input
                            value={historySearch}
                            onChange={(event) => setHistorySearch(event.target.value)}
                            placeholder="Search conversations"
                            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                          />
                        </div>
                      </label>
                    </div>
                    <div className="max-h-[560px] overflow-y-auto px-5 py-4 lg:max-h-[630px]">
                      {groupedHistoryConversations.map((group) => (
                        <div key={group.label} className="mb-5">
                          <div className="mb-2 inline-flex items-center gap-2 rounded-lg bg-slate-200 px-3 py-2 text-xs font-bold text-slate-700">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                              <path fillRule="evenodd" d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z" clipRule="evenodd" />
                            </svg>
                            {group.label}
                          </div>
                          <div className="space-y-2">
                            {group.conversations.map((conversation) => {
                              const selected = selectedHistoryConversation?.conversationId === conversation.conversationId
                              return (
                                <button
                                  key={conversation.conversationId}
                                  type="button"
                                  onClick={() => setSelectedHistoryConversationId(conversation.conversationId)}
                                  className={`block w-full rounded-lg px-4 py-4 text-left transition ${
                                    selected ? "bg-white shadow-sm ring-2 ring-[#9E1B34]/30" : "hover:bg-white"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                      <p className="font-bold text-slate-900">{formatTime(conversation.latestAt)}</p>
                                      <p className="mt-1 line-clamp-1 text-sm font-semibold text-slate-700">
                                        {conversation.title}
                                      </p>
                                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                                        {conversation.preview}
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-2">
                                      <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-bold text-slate-700">
                                        {conversation.total}
                                      </span>
                                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                                        conversation.lowCount > 0
                                          ? "bg-amber-100 text-amber-800"
                                          : "bg-emerald-100 text-emerald-800"
                                      }`}>
                                        {conversation.lowCount > 0 ? `${conversation.lowCount} low` : `${conversation.highCount} high`}
                                      </span>
                                      {selected && (
                                        <span className="rounded-full bg-[#9E1B34]/10 px-2 py-1 text-[10px] font-bold text-[#9E1B34]">
                                          Open
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </aside>

                  <section className="min-h-[720px] bg-white">
                    {selectedHistoryConversation ? (
                      <div className="flex h-full flex-col">
                        <div className="border-b border-[#d8e0e8] px-8 py-6">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#BA0C2F]/70">
                                Selected Chat
                              </p>
                              <h3 className="mt-1 line-clamp-2 text-xl font-bold text-slate-950">
                                {selectedHistoryConversation.title}
                              </h3>
                              <p className="mt-1 text-sm text-slate-500">
                                Last message {formatDate(selectedHistoryConversation.latestAt)}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="rounded-full border border-[#e5dede] bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                                {selectedHistoryConversation.total} questions
                              </span>
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                                {selectedHistoryConversation.lowCount} low
                              </span>
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
                                {selectedHistoryConversation.highCount} high
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex-1 space-y-6 overflow-y-auto px-8 py-7">
                          {selectedHistoryConversation.entries.map((entry) => (
                            <div key={entry.id} className="space-y-3">
                              <div className="flex justify-end">
                                <div className="max-w-[76%] rounded-lg bg-[#9E1B34] px-5 py-4 text-white shadow-sm">
                                  <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
                                    User - {formatDate(entry.questionAt)}
                                  </div>
                                  <p className="whitespace-pre-wrap text-sm leading-6">{entry.question}</p>
                                </div>
                              </div>

                              <div className="flex justify-start">
                                <div className="max-w-[76%] rounded-lg border border-[#e5dede] bg-slate-50 px-5 py-4 shadow-sm">
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                                      Chatbot - {entry.answerAt ? formatDate(entry.answerAt) : "No response saved"}
                                    </span>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                        entry.confidence === "high"
                                          ? "bg-emerald-100 text-emerald-800"
                                          : "bg-amber-100 text-amber-800"
                                      }`}
                                    >
                                      {entry.confidence === "high" ? "High confidence" : "Low confidence"}
                                    </span>
                                    {entry.confidenceScore !== null && (
                                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                        {entry.confidenceScore}%
                                      </span>
                                    )}
                                  </div>
                                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
                                    {entry.answer || "No chatbot response was saved for this question."}
                                  </p>
                                  {entry.sources.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {entry.sources.map((source) => (
                                        <span key={source} className="rounded-full border border-[#e5dede] bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                                          {source}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[640px] items-center justify-center text-center text-slate-400">
                        <div>
                          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-[#e5dede] bg-slate-50">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-7 w-7">
                              <path fillRule="evenodd" d="M10 3c-4.418 0-8 2.91-8 6.5 0 1.508.635 2.89 1.697 3.993-.102.838-.367 1.522-.667 2.04a.75.75 0 0 0 .889 1.09 8.66 8.66 0 0 0 2.826-1.563A9.43 9.43 0 0 0 10 16c4.418 0 8-2.91 8-6.5S14.418 3 10 3ZM6.75 9.5a.75.75 0 1 0 0 1.5h.008a.75.75 0 1 0 0-1.5H6.75Zm3.25 0a.75.75 0 1 0 0 1.5h.008a.75.75 0 1 0 0-1.5H10Zm3.25 0a.75.75 0 1 0 0 1.5h.008a.75.75 0 1 0 0-1.5h-.008Z" clipRule="evenodd" />
                            </svg>
                          </div>
                          <p className="text-lg font-bold">Select a chat to begin</p>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
                </div>
              )
            ) : visibleRequests.length === 0 ? (
              <div className="rounded-lg border border-[#e5dede] bg-white py-16 text-center text-sm text-slate-400">
                {isTrashView ? "No deleted support requests." : `No ${filter === "all" ? "" : filter} support requests.`}
              </div>
            ) : (
              <div className="space-y-4">
                {visibleRequests.map((request) => {
                  const expanded = expandedIds.has(request.id)
                  const label = isTrashView
                    ? deletedCategory(request) === "answered"
                      ? "Answered"
                      : "Pending"
                    : statusLabel(request.status)
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
                          {isTrashView ? `Deleted ${label}` : label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Requested {formatDate(request.createdAt)}
                          </p>
                          {isTrashView && (
                            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-red-500">
                              Deleted {formatDate(request.deletedAt ?? request.updatedAt)}
                            </p>
                          )}
                          <h2 className="mt-1 line-clamp-2 text-base font-semibold text-slate-900">
                            {request.latestQuestion}
                          </h2>
                          <p className="mt-2 rounded-lg border border-[#eadfe0] bg-[#fdf8f8] px-3 py-2 text-sm text-slate-600">
                            <span className="font-semibold text-slate-800">Escalation reason:</span>{" "}
                            {request.chatbotNote}
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
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                                Conversation transcript
                              </p>
                              <p className="mt-1 text-xs text-slate-400">
                                User and chatbot messages before handoff, followed by advisor replies.
                              </p>
                            </div>
                            <span className="rounded-full border border-[#e5dede] bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                              {timeline.length} messages
                            </span>
                          </div>
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

                          {!isTrashView && (
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
                          )}
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
