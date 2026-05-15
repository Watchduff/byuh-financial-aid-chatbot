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

type Filter = "pending" | "answered" | "all" | "trash" | "history" | "analytics"
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

type QueueFilter = Exclude<Filter, "trash" | "history" | "analytics">

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

const ANALYTICS_FILTER = {
  id: "analytics" as const,
  label: "Analytics",
  description: "Monthly usage statistics and confidence trends",
}

type AnalyticsMonth = {
  month: string
  label: string
  conversations: number
  questions: number
  high: number
  low: number
  escalations: number
}

type AnalyticsData = {
  year: number
  months: AnalyticsMonth[]
  totals: { conversations: number; questions: number; high: number; low: number; escalations: number }
  availableYears: number[]
}

type DayAnalytics = {
  date: string
  label: string
  conversations: number
  questions: number
  high: number
  low: number
  escalations: number
}

type MonthlyDetail = {
  month: string
  label: string
  days: DayAnalytics[]
  totals: { conversations: number; questions: number; high: number; low: number; escalations: number }
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
  const [historyAgentReplies, setHistoryAgentReplies] = useState<Record<string, Array<{ id: string; agentName: string; content: string; createdAt: string }>>>({})
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [replies, setReplies] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [typingStatuses, setTypingStatuses] = useState<Record<string, boolean>>({})
  const [studentDrafts, setStudentDrafts] = useState<Record<string, string>>({})
  const [suggestedReplies, setSuggestedReplies] = useState<Record<string, string[]>>({})
  const [suggestingId, setSuggestingId] = useState<string | null>(null)
  const adminTypingRefs = useRef<Record<string, boolean>>({})
  const adminTypingOffTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const transcriptContainerRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const prevMessageCountsRef = useRef<Record<string, number>>({})
  const [analyticsYear, setAnalyticsYear] = useState(new Date().getFullYear())
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsView, setAnalyticsView] = useState<"yearly" | "monthly">("yearly")
  const [selectedAnalyticsMonth, setSelectedAnalyticsMonth] = useState<string | null>(null)
  const [monthlyDetail, setMonthlyDetail] = useState<MonthlyDetail | null>(null)
  const [monthlyDetailLoading, setMonthlyDetailLoading] = useState(false)
  const [feedbackStats, setFeedbackStats] = useState<{ totals: { helpful: number; notHelpful: number; total: number }; recent: Array<{ id: number; question: string; answer: string; createdAt: string }> } | null>(null)

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
      setHistoryAgentReplies(data.agentReplies ?? {})
    } catch {
      setError("Could not load chat history.")
    }
  }, [])

  const fetchAnalytics = useCallback(async (year: number) => {
    setAnalyticsLoading(true)
    try {
      const [analyticsRes, feedbackRes] = await Promise.all([
        fetch(`/api/analytics/monthly?year=${year}`),
        fetch("/api/feedback"),
      ])
      if (analyticsRes.ok) setAnalyticsData(await analyticsRes.json())
      if (feedbackRes.ok) setFeedbackStats(await feedbackRes.json())
    } catch {
      // silently fail
    } finally {
      setAnalyticsLoading(false)
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
    if (filter === "analytics") fetchAnalytics(analyticsYear)
  }, [filter, analyticsYear, fetchAnalytics])

  useEffect(() => {
    if (!selectedAnalyticsMonth) {
      setMonthlyDetail(null)
      return
    }
    setMonthlyDetailLoading(true)
    fetch(`/api/analytics/monthly-detail?month=${selectedAnalyticsMonth}`)
      .then((res) => res.json())
      .then((data: MonthlyDetail) => setMonthlyDetail(data))
      .catch(() => undefined)
      .finally(() => setMonthlyDetailLoading(false))
  }, [selectedAnalyticsMonth])

  useEffect(() => {
    const pendingIds = requests
      .filter((request) => statusLabel(request.status) === "Pending")
      .map((request) => request.id)

    if (pendingIds.length === 0) {
      setTypingStatuses({})
      setStudentDrafts({})
      return
    }

    async function pollTypingStatuses() {
      const results = await Promise.all(
        pendingIds.map(async (requestId) => {
          try {
            const res = await fetch(`/api/support/typing?requestId=${requestId}`)
            if (!res.ok) return { requestId, typing: false, draft: "" }
            const data = await res.json()
            return {
              requestId,
              typing: Boolean(data.studentTyping),
              draft: typeof data.studentDraft === "string" ? data.studentDraft : "",
            }
          } catch {
            return { requestId, typing: false, draft: "" }
          }
        })
      )

      setTypingStatuses(Object.fromEntries(results.map((r) => [r.requestId, r.typing])))
      setStudentDrafts(Object.fromEntries(results.map((r) => [r.requestId, r.draft])))
    }

    pollTypingStatuses()
    const interval = setInterval(pollTypingStatuses, 1500)
    return () => clearInterval(interval)
  }, [requests])

  useEffect(() => {
    expandedIds.forEach((id) => {
      const request = requests.find((r) => r.id === id)
      const currentCount = (request?.chatHistory?.length ?? 0) + (request?.adminMessages?.length ?? 0)
      const prevCount = prevMessageCountsRef.current[id]

      if (prevCount === undefined || currentCount > prevCount) {
        const container = transcriptContainerRefs.current[id]
        if (container) {
          const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80
          // Always scroll on first expand; on new messages only scroll if already near the bottom
          if (prevCount === undefined || isNearBottom) {
            container.scrollTop = container.scrollHeight
          }
        }
      }
      prevMessageCountsRef.current[id] = currentCount
    })
  }, [requests, expandedIds])

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
      : filter === "analytics"
        ? ANALYTICS_FILTER
        : FILTER_OPTIONS.find((option) => option.id === filter) ?? FILTER_OPTIONS[0]
  const recentRequests = requests.filter((request) => request.status !== "deleted").slice(0, 5)
  const isTrashView = filter === "trash"
  const isHistoryView = filter === "history"
  const isAnalyticsView = filter === "analytics"

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
        const request = requests.find((r) => r.id === id)
        if (request && statusLabel(request.status) === "Pending") {
          // auto-fetch suggestions
          if (!suggestedReplies[id]) void fetchSuggestedReplies(id)
          // signal to student that advisor is now reviewing their chat
          void fetch("/api/support/view", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId: id }),
          })
        }
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

  async function fetchSuggestedReplies(requestId: string) {
    setSuggestingId(requestId)
    try {
      const res = await fetch("/api/support/suggest-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data.suggestions)) {
        setSuggestedReplies((prev) => ({ ...prev, [requestId]: data.suggestions }))
      }
    } catch {
      // silently fail — suggestions are optional
    } finally {
      setSuggestingId(null)
    }
  }

  function printAnalyticsReport() {
    if (!analyticsData) return
    const { year, months, totals } = analyticsData
    const highPct = totals.questions > 0 ? Math.round((totals.high / totals.questions) * 100) : 0

    const monthRows = months.map((m) => {
      const pct = m.questions > 0 ? Math.round((m.high / m.questions) * 100) : 0
      return `<tr>
        <td>${m.label}</td>
        <td>${m.conversations}</td>
        <td>${m.questions}</td>
        <td style="color:#059669;font-weight:${m.high > 0 ? "600" : "400"}">${m.high}</td>
        <td style="color:#d97706;font-weight:${m.low > 0 ? "600" : "400"}">${m.low}</td>
        <td>${m.questions > 0 ? pct + "%" : "—"}</td>
        <td style="color:#dc2626;font-weight:${m.escalations > 0 ? "600" : "400"}">${m.escalations}</td>
      </tr>`
    }).join("")

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>BYU-Hawaii Financial Aid — Analytics ${year}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 32px; }
    h1 { font-size: 20px; font-weight: 700; color: #9E1B34; }
    .meta { color: #64748b; font-size: 11px; margin-top: 4px; margin-bottom: 28px; }
    .section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: #94a3b8; margin-bottom: 10px; }
    .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 32px; }
    .card { border: 1px solid #e5dede; border-radius: 8px; padding: 12px 16px; min-width: 130px; }
    .card-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #94a3b8; }
    .card-value { font-size: 28px; font-weight: 800; color: #9E1B34; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 12px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #64748b; border-top: 2px solid #e5dede; border-bottom: 1px solid #e5dede; background: #f8fafc; }
    th:not(:first-child) { text-align: right; }
    td { padding: 9px 12px; border-bottom: 1px solid #f0eaea; font-size: 12px; }
    td:not(:first-child) { text-align: right; }
    .tfoot-row td { font-weight: 700; border-top: 2px solid #e5dede; border-bottom: none; background: #f8fafc; font-size: 12px; }
    .footer { margin-top: 32px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e5dede; padding-top: 12px; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <h1>BYU-Hawaii Financial Aid &amp; Scholarships</h1>
  <p class="meta">Analytics Report &nbsp;·&nbsp; Year ${year} &nbsp;·&nbsp; Generated ${new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</p>

  <p class="section-label">Yearly Summary — ${year}</p>
  <div class="cards">
    <div class="card"><div class="card-label">Conversations</div><div class="card-value">${totals.conversations}</div></div>
    <div class="card"><div class="card-label">Questions Asked</div><div class="card-value">${totals.questions}</div></div>
    <div class="card"><div class="card-label">High Confidence</div><div class="card-value" style="color:#059669">${totals.high}</div></div>
    <div class="card"><div class="card-label">Low Confidence</div><div class="card-value" style="color:#d97706">${totals.low}</div></div>
    <div class="card"><div class="card-label">Escalations</div><div class="card-value" style="color:#dc2626">${totals.escalations}</div></div>
    <div class="card"><div class="card-label">High Confidence %</div><div class="card-value">${highPct}%</div></div>
  </div>

  <p class="section-label">Monthly Breakdown — ${year}</p>
  <table>
    <thead>
      <tr>
        <th>Month</th>
        <th>Conversations</th>
        <th>Questions</th>
        <th>High Confidence</th>
        <th>Low Confidence</th>
        <th>High %</th>
        <th>Escalations</th>
      </tr>
    </thead>
    <tbody>${monthRows}</tbody>
    <tfoot>
      <tr class="tfoot-row">
        <td>Year Total</td>
        <td>${totals.conversations}</td>
        <td>${totals.questions}</td>
        <td style="color:#059669">${totals.high}</td>
        <td style="color:#d97706">${totals.low}</td>
        <td>${highPct}%</td>
        <td style="color:#dc2626">${totals.escalations}</td>
      </tr>
    </tfoot>
  </table>

  <p class="footer">BYU-Hawaii Financial Aid &amp; Scholarships &nbsp;·&nbsp; (808) 675-3316 &nbsp;·&nbsp; financialaid@byuh.edu &nbsp;·&nbsp; Lorenzo Snow Building Room 180</p>
</body>
</html>`

    const win = window.open("", "_blank", "width=960,height=720")
    if (win) {
      win.document.write(html)
      win.document.close()
      win.focus()
      win.print()
    }
  }

  function printMonthlyReport() {
    if (!monthlyDetail) return
    const { label, days, totals } = monthlyDetail
    const highPct = totals.questions > 0 ? Math.round((totals.high / totals.questions) * 100) : 0
    const activeDays = days.filter((d) => d.questions > 0 || d.escalations > 0)

    const dayRows = activeDays.map((d) => {
      const pct = d.questions > 0 ? Math.round((d.high / d.questions) * 100) : 0
      return `<tr>
        <td>${d.label}</td>
        <td>${d.conversations}</td>
        <td>${d.questions}</td>
        <td style="color:#059669;font-weight:${d.high > 0 ? "600" : "400"}">${d.high}</td>
        <td style="color:#d97706;font-weight:${d.low > 0 ? "600" : "400"}">${d.low}</td>
        <td>${d.questions > 0 ? pct + "%" : "—"}</td>
        <td style="color:#dc2626;font-weight:${d.escalations > 0 ? "600" : "400"}">${d.escalations}</td>
      </tr>`
    }).join("") || `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">No activity recorded this month.</td></tr>`

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>BYU-Hawaii Financial Aid — ${label} Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 32px; }
    h1 { font-size: 20px; font-weight: 700; color: #9E1B34; }
    .meta { color: #64748b; font-size: 11px; margin-top: 4px; margin-bottom: 28px; }
    .section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: #94a3b8; margin-bottom: 10px; }
    .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 32px; }
    .card { border: 1px solid #e5dede; border-radius: 8px; padding: 12px 16px; min-width: 120px; }
    .card-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #94a3b8; }
    .card-value { font-size: 28px; font-weight: 800; color: #9E1B34; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 12px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #64748b; border-top: 2px solid #e5dede; border-bottom: 1px solid #e5dede; background: #f8fafc; }
    th:not(:first-child) { text-align: right; }
    td { padding: 9px 12px; border-bottom: 1px solid #f0eaea; font-size: 12px; }
    td:not(:first-child) { text-align: right; }
    .tfoot-row td { font-weight: 700; border-top: 2px solid #e5dede; border-bottom: none; background: #f8fafc; }
    .footer { margin-top: 32px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e5dede; padding-top: 12px; }
    @media print { body { padding: 16px; } }
  </style>
</head>
<body>
  <h1>BYU-Hawaii Financial Aid &amp; Scholarships</h1>
  <p class="meta">Monthly Analytics Report &nbsp;·&nbsp; ${label} &nbsp;·&nbsp; Generated ${new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</p>

  <p class="section-label">Monthly Summary — ${label}</p>
  <div class="cards">
    <div class="card"><div class="card-label">Conversations</div><div class="card-value">${totals.conversations}</div></div>
    <div class="card"><div class="card-label">Questions Asked</div><div class="card-value">${totals.questions}</div></div>
    <div class="card"><div class="card-label">High Confidence</div><div class="card-value" style="color:#059669">${totals.high}</div></div>
    <div class="card"><div class="card-label">Low Confidence</div><div class="card-value" style="color:#d97706">${totals.low}</div></div>
    <div class="card"><div class="card-label">Escalations</div><div class="card-value" style="color:#dc2626">${totals.escalations}</div></div>
    <div class="card"><div class="card-label">High Confidence %</div><div class="card-value">${highPct}%</div></div>
  </div>

  <p class="section-label">Daily Breakdown — ${label} (${activeDays.length} active day${activeDays.length !== 1 ? "s" : ""})</p>
  <table>
    <thead>
      <tr>
        <th>Day</th>
        <th>Conversations</th>
        <th>Questions</th>
        <th>High Confidence</th>
        <th>Low Confidence</th>
        <th>High %</th>
        <th>Escalations</th>
      </tr>
    </thead>
    <tbody>${dayRows}</tbody>
    <tfoot>
      <tr class="tfoot-row">
        <td>Month Total</td>
        <td>${totals.conversations}</td>
        <td>${totals.questions}</td>
        <td style="color:#059669">${totals.high}</td>
        <td style="color:#d97706">${totals.low}</td>
        <td>${highPct}%</td>
        <td style="color:#dc2626">${totals.escalations}</td>
      </tr>
    </tfoot>
  </table>

  <p class="footer">BYU-Hawaii Financial Aid &amp; Scholarships &nbsp;·&nbsp; (808) 675-3316 &nbsp;·&nbsp; financialaid@byuh.edu &nbsp;·&nbsp; Lorenzo Snow Building Room 180</p>
</body>
</html>`

    const win = window.open("", "_blank", "width=960,height=720")
    if (win) {
      win.document.write(html)
      win.document.close()
      win.focus()
      win.print()
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
              <div className="space-y-1">
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
                <button
                  type="button"
                  onClick={() => {
                    setFilter("analytics")
                    setSidebarOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${
                    isAnalyticsView
                      ? "bg-white text-[#9E1B34] shadow-sm"
                      : "text-white/72 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      isAnalyticsView ? "bg-[#9E1B34]/10" : "bg-white/10"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 15.5 2ZM9.5 6A1.5 1.5 0 0 0 8 7.5v9a1.5 1.5 0 0 0 3 0v-9A1.5 1.5 0 0 0 9.5 6ZM3.5 10A1.5 1.5 0 0 0 2 11.5v5a1.5 1.5 0 0 0 3 0v-5A1.5 1.5 0 0 0 3.5 10Z" />
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{ANALYTICS_FILTER.label}</span>
                    <span className={`block truncate text-[11px] ${isAnalyticsView ? "text-[#9E1B34]/65" : "text-white/45"}`}>
                      {ANALYTICS_FILTER.description}
                    </span>
                  </span>
                </button>
              </div>
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
                  {isHistoryView ? "Questions" : isAnalyticsView ? "Year" : "Visible"}
                </p>
                <p className="text-lg font-bold text-[#9E1B34]">
                  {isHistoryView ? visibleChatHistory.length : isAnalyticsView ? analyticsYear : visibleRequests.length}
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
            ) : isAnalyticsView ? (
              <div className="space-y-5">
                <section className="rounded-lg border border-[#d8e0e8] bg-white px-6 py-6 shadow-sm">
                  {/* Header row: view toggle + year + print */}
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-1 rounded-xl border border-[#e5dede] bg-slate-50 p-1">
                      <button
                        type="button"
                        onClick={() => setAnalyticsView("yearly")}
                        className={`rounded-lg px-5 py-2 text-sm font-bold transition ${
                          analyticsView === "yearly"
                            ? "bg-[#9E1B34] text-white shadow-sm"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Yearly
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAnalyticsView("monthly")
                          if (!selectedAnalyticsMonth && analyticsData) {
                            const now = new Date()
                            const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
                            const match = analyticsData.months.find((m) => m.month === key)
                            setSelectedAnalyticsMonth(match ? key : analyticsData.months[0].month)
                          }
                        }}
                        className={`rounded-lg px-5 py-2 text-sm font-bold transition ${
                          analyticsView === "monthly"
                            ? "bg-[#9E1B34] text-white shadow-sm"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Monthly
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Year buttons — show data years or a sensible fallback range */}
                      {(analyticsData?.availableYears ?? Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - 2 + i).reverse()).map((y) => (
                        <button
                          key={y}
                          type="button"
                          onClick={() => {
                            setAnalyticsYear(y)
                            setSelectedAnalyticsMonth(null)
                          }}
                          className={`rounded-lg border px-4 py-2 text-sm font-bold transition ${
                            analyticsYear === y
                              ? "border-[#9E1B34] bg-[#9E1B34] text-white"
                              : "border-[#e5dede] bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {y}
                        </button>
                      ))}

                      {/* Print button — context-aware */}
                      {analyticsData && (
                        analyticsView === "yearly" ? (
                          <button
                            type="button"
                            onClick={printAnalyticsReport}
                            className="flex items-center gap-2 rounded-lg border border-[#e5dede] bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                              <path fillRule="evenodd" d="M5 4v3H4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2h1a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1Zm2 0h6v3H7V4Zm-1 9v-1h8v3H6v-2Zm9-5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" clipRule="evenodd" />
                            </svg>
                            Print Yearly Report
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={printMonthlyReport}
                            disabled={!monthlyDetail}
                            className="flex items-center gap-2 rounded-lg border border-[#e5dede] bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                              <path fillRule="evenodd" d="M5 4v3H4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2h1a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1Zm2 0h6v3H7V4Zm-1 9v-1h8v3H6v-2Zm9-5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" clipRule="evenodd" />
                            </svg>
                            Print Monthly Report
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {analyticsLoading ? (
                    <p className="py-10 text-center text-sm text-slate-400">Loading analytics...</p>
                  ) : analyticsData ? (
                    analyticsView === "yearly" ? (
                      <>
                        {/* Yearly totals */}
                        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                          Yearly Summary — {analyticsData.year}
                        </p>
                        <div className="mb-8 grid gap-3 sm:grid-cols-5">
                          {[
                            { label: "Conversations", value: analyticsData.totals.conversations },
                            { label: "Questions", value: analyticsData.totals.questions },
                            { label: "High Confidence", value: analyticsData.totals.high },
                            { label: "Low Confidence", value: analyticsData.totals.low },
                            { label: "Escalations", value: analyticsData.totals.escalations },
                          ].map((item) => (
                            <div key={item.label} className="rounded-lg border border-[#e5dede] bg-slate-50 px-4 py-4">
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
                              <p className="mt-1 text-2xl font-bold text-[#9E1B34]">{item.value}</p>
                            </div>
                          ))}
                        </div>

                        {/* Monthly table — all months visible */}
                        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                          Monthly Breakdown — {analyticsData.year}
                        </p>
                        <div className="overflow-hidden rounded-lg border border-[#e5dede]">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-[#e5dede] bg-slate-50">
                                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Month</th>
                                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Conversations</th>
                                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Questions</th>
                                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">High</th>
                                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Low</th>
                                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Escalations</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analyticsData.months.map((row) => (
                                <tr key={row.month} className="border-b border-[#f0eaea] last:border-0">
                                  <td className="px-4 py-3 font-semibold text-slate-800">{row.label}</td>
                                  <td className="px-4 py-3 text-right text-slate-700">{row.conversations}</td>
                                  <td className="px-4 py-3 text-right text-slate-700">{row.questions}</td>
                                  <td className="px-4 py-3 text-right">
                                    <span className={row.high > 0 ? "font-semibold text-emerald-700" : "text-slate-300"}>{row.high}</span>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <span className={row.low > 0 ? "font-semibold text-amber-700" : "text-slate-300"}>{row.low}</span>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <span className={row.escalations > 0 ? "font-semibold text-red-700" : "text-slate-300"}>{row.escalations}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 border-[#e5dede] bg-slate-50">
                                <td className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Year Total</td>
                                <td className="px-4 py-3 text-right font-bold text-slate-800">{analyticsData.totals.conversations}</td>
                                <td className="px-4 py-3 text-right font-bold text-slate-800">{analyticsData.totals.questions}</td>
                                <td className="px-4 py-3 text-right font-bold text-emerald-700">{analyticsData.totals.high}</td>
                                <td className="px-4 py-3 text-right font-bold text-amber-700">{analyticsData.totals.low}</td>
                                <td className="px-4 py-3 text-right font-bold text-red-700">{analyticsData.totals.escalations}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </>
                    ) : (
                      /* Monthly view */
                      <>
                        <div className="mb-5 flex flex-wrap items-center gap-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Select Month</p>
                          <select
                            value={selectedAnalyticsMonth ?? ""}
                            onChange={(e) => setSelectedAnalyticsMonth(e.target.value)}
                            className="rounded-lg border border-[#e5dede] bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-[#9E1B34]/50 focus:ring-2 focus:ring-[#9E1B34]/10"
                          >
                            {analyticsData.months.map((m) => (
                              <option key={m.month} value={m.month}>{m.label}</option>
                            ))}
                          </select>
                        </div>

                        {monthlyDetailLoading ? (
                          <p className="py-10 text-center text-sm text-slate-400">Loading monthly data...</p>
                        ) : monthlyDetail ? (
                          <>
                            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                              Monthly Summary — {monthlyDetail.label}
                            </p>
                            <div className="mb-8 grid gap-3 sm:grid-cols-5">
                              {[
                                { label: "Conversations", value: monthlyDetail.totals.conversations },
                                { label: "Questions", value: monthlyDetail.totals.questions },
                                { label: "High Confidence", value: monthlyDetail.totals.high },
                                { label: "Low Confidence", value: monthlyDetail.totals.low },
                                { label: "Escalations", value: monthlyDetail.totals.escalations },
                              ].map((item) => (
                                <div key={item.label} className="rounded-lg border border-[#e5dede] bg-slate-50 px-4 py-4">
                                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
                                  <p className="mt-1 text-2xl font-bold text-[#9E1B34]">{item.value}</p>
                                </div>
                              ))}
                            </div>

                            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                              Daily Breakdown — {monthlyDetail.label}
                            </p>
                            <div className="overflow-hidden rounded-lg border border-[#e5dede]">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-[#e5dede] bg-slate-50">
                                    <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Day</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Conversations</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Questions</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">High</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Low</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Escalations</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {monthlyDetail.days.filter((d) => d.questions > 0 || d.escalations > 0).map((d) => (
                                    <tr key={d.date} className="border-b border-[#f0eaea] last:border-0">
                                      <td className="px-4 py-3 font-semibold text-slate-800">{d.label}</td>
                                      <td className="px-4 py-3 text-right text-slate-700">{d.conversations}</td>
                                      <td className="px-4 py-3 text-right text-slate-700">{d.questions}</td>
                                      <td className="px-4 py-3 text-right">
                                        <span className={d.high > 0 ? "font-semibold text-emerald-700" : "text-slate-300"}>{d.high}</span>
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                        <span className={d.low > 0 ? "font-semibold text-amber-700" : "text-slate-300"}>{d.low}</span>
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                        <span className={d.escalations > 0 ? "font-semibold text-red-700" : "text-slate-300"}>{d.escalations}</span>
                                      </td>
                                    </tr>
                                  ))}
                                  {monthlyDetail.days.filter((d) => d.questions > 0 || d.escalations > 0).length === 0 && (
                                    <tr>
                                      <td colSpan={6} className="px-4 py-10 text-center text-slate-400">No activity recorded this month.</td>
                                    </tr>
                                  )}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-[#e5dede] bg-slate-50">
                                    <td className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">Month Total</td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-800">{monthlyDetail.totals.conversations}</td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-800">{monthlyDetail.totals.questions}</td>
                                    <td className="px-4 py-3 text-right font-bold text-emerald-700">{monthlyDetail.totals.high}</td>
                                    <td className="px-4 py-3 text-right font-bold text-amber-700">{monthlyDetail.totals.low}</td>
                                    <td className="px-4 py-3 text-right font-bold text-red-700">{monthlyDetail.totals.escalations}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </>
                        ) : (
                          <p className="py-10 text-center text-sm text-slate-400">Select a month above to view daily data.</p>
                        )}
                      </>
                    )
                  ) : (
                    <p className="py-10 text-center text-sm text-slate-400">No analytics data available.</p>
                  )}
                </section>

                {/* Chatbot Response Feedback */}
                <section className="rounded-lg border border-[#d8e0e8] bg-white px-6 py-6 shadow-sm">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Chatbot Response Feedback</p>
                  <p className="mb-5 text-xs text-slate-500">Student ratings on chatbot responses — all time</p>

                  {feedbackStats ? (
                    <>
                      <div className="mb-6 grid gap-3 sm:grid-cols-3">
                        {[
                          { label: "Helpful", value: feedbackStats.totals.helpful, color: "text-emerald-700" },
                          { label: "Not Helpful", value: feedbackStats.totals.notHelpful, color: "text-red-600" },
                          { label: "Total Rated", value: feedbackStats.totals.total, color: "text-[#9E1B34]" },
                        ].map((item) => (
                          <div key={item.label} className="rounded-lg border border-[#e5dede] bg-slate-50 px-4 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
                            <p className={`mt-1 text-2xl font-bold ${item.color}`}>{item.value}</p>
                            {feedbackStats.totals.total > 0 && (
                              <p className="mt-0.5 text-xs text-slate-400">
                                {Math.round((item.value / feedbackStats.totals.total) * 100)}%
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      {feedbackStats.totals.total > 0 && (
                        <div className="mb-5 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${Math.round((feedbackStats.totals.helpful / feedbackStats.totals.total) * 100)}%` }}
                          />
                        </div>
                      )}

                      {feedbackStats.recent.length > 0 && (
                        <>
                          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                            Recent Not-Helpful Responses
                          </p>
                          <div className="space-y-3">
                            {feedbackStats.recent.map((item) => (
                              <div key={item.id} className="rounded-lg border border-red-100 bg-red-50 px-4 py-3">
                                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-400">
                                  {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </p>
                                <p className="text-xs font-semibold text-slate-600">Q: {item.question}</p>
                                <p className="mt-1 line-clamp-2 text-xs text-slate-500">A: {item.answer}</p>
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {feedbackStats.totals.total === 0 && (
                        <p className="py-6 text-center text-sm text-slate-400">No feedback submitted yet.</p>
                      )}
                    </>
                  ) : (
                    <p className="py-6 text-center text-sm text-slate-400">Loading feedback data...</p>
                  )}
                </section>
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

                  <div className="grid min-h-180 overflow-hidden rounded-lg border border-[#d8e0e8] bg-white shadow-sm lg:grid-cols-[420px_minmax(0,1fr)] 2xl:grid-cols-[480px_minmax(0,1fr)]">
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
                    <div className="max-h-140 overflow-y-auto px-5 py-4 lg:max-h-157.5">
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

                  <section className="min-h-180 bg-white">
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

                          {(historyAgentReplies[selectedHistoryConversation.conversationId] ?? []).length > 0 && (
                            <div className="mt-2 space-y-3">
                              <div className="flex items-center gap-3">
                                <div className="h-px flex-1 bg-slate-200" />
                                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-600">
                                  Live Support Session
                                </span>
                                <div className="h-px flex-1 bg-slate-200" />
                              </div>
                              {historyAgentReplies[selectedHistoryConversation.conversationId].map((reply) => (
                                <div key={reply.id} className="flex justify-start">
                                  <div className="max-w-[76%] rounded-lg border border-blue-200 bg-blue-50 px-5 py-4 shadow-sm">
                                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-500">
                                      {reply.agentName} &mdash; {formatDate(reply.createdAt)}
                                    </div>
                                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{reply.content}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full min-h-160 items-center justify-center text-center text-slate-400">
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

                  const requestCreatedAt = new Date(request.createdAt).getTime()
                  const preHistory = timeline.filter((m) => new Date(m.createdAt).getTime() < requestCreatedAt)
                  const liveMessages = timeline.filter((m) => new Date(m.createdAt).getTime() >= requestCreatedAt)
                  const isLive = label === "Pending" && !isTrashView

                  return (
                    <article
                      key={request.id}
                      className={`rounded-lg border bg-white p-5 shadow-sm transition-all ${
                        isLive && expanded ? "border-[#9E1B34]/30 ring-1 ring-[#9E1B34]/15" : "border-[#e5dede]"
                      }`}
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[request.status]}`}
                        >
                          {isTrashView ? `Deleted ${label}` : label}
                        </span>
                        {isLive && (
                          <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                            LIVE
                          </span>
                        )}
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

                          {/* Live draft preview on collapsed card */}
                          {isLive && !expanded && typingStatuses[request.id] && (
                            <div className="mt-2 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                              <span className="flex shrink-0 items-center gap-1 pt-0.5">
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.3s]" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.15s]" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500" />
                              </span>
                              {studentDrafts[request.id] ? (
                                <p className="min-w-0 text-sm italic text-emerald-800">
                                  &ldquo;{studentDrafts[request.id]}&rdquo;
                                </p>
                              ) : (
                                <p className="text-sm text-emerald-700">Student is typing…</p>
                              )}
                            </div>
                          )}
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
                                Live Chat
                              </p>
                              <p className="mt-1 text-xs text-slate-400">
                                {preHistory.length > 0 ? `${preHistory.length} messages before escalation, ` : ""}
                                {liveMessages.length} live message{liveMessages.length !== 1 ? "s" : ""}
                              </p>
                            </div>
                            <span className="rounded-full border border-[#e5dede] bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                              {timeline.length} total
                            </span>
                          </div>

                          <div
                            ref={(el) => { transcriptContainerRefs.current[request.id] = el }}
                            className="max-h-96 overflow-y-auto rounded-lg border border-[#e5dede] bg-slate-50 p-3"
                          >
                            {timeline.length === 0 ? (
                              <p className="px-3 py-6 text-center text-sm text-slate-400">
                                No conversation history was saved for this request.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {preHistory.length > 0 && (
                                  <>
                                    {preHistory.map((message) => (
                                      <div
                                        key={message.id}
                                        className={`rounded-lg border px-3 py-2.5 opacity-70 ${
                                          message.role === "USER"
                                            ? "border-[#f3ccd4] bg-[#fff7f7]"
                                            : "border-slate-200 bg-white"
                                        }`}
                                      >
                                        <div className="mb-1 flex items-center justify-between gap-3">
                                          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                            {message.role === "USER" ? "Student" : "Chatbot"}
                                          </span>
                                          <span className="text-[10px] text-slate-400">{formatDate(message.createdAt)}</span>
                                        </div>
                                        <p className="whitespace-pre-wrap text-sm leading-5 text-slate-600">{message.content}</p>
                                      </div>
                                    ))}
                                    <div className="flex items-center gap-2 py-2">
                                      <div className="h-px flex-1 bg-[#9E1B34]/20" />
                                      <span className="rounded-full bg-[#9E1B34]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#9E1B34]">
                                        Live Support Started — {formatDate(request.createdAt)}
                                      </span>
                                      <div className="h-px flex-1 bg-[#9E1B34]/20" />
                                    </div>
                                  </>
                                )}

                                {liveMessages.length === 0 ? (
                                  <p className="py-4 text-center text-sm text-slate-400">
                                    Waiting for the student to send a message...
                                  </p>
                                ) : (
                                  liveMessages.map((message) => (
                                    <div
                                      key={message.id}
                                      className={`rounded-lg border px-3 py-2.5 ${
                                        message.role === "USER"
                                          ? "border-[#f3ccd4] bg-[#fff7f7]"
                                          : message.role === "ADMIN"
                                            ? "border-blue-200 bg-blue-50"
                                            : "border-slate-200 bg-white"
                                      }`}
                                    >
                                      <div className="mb-1 flex items-center justify-between gap-3">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                          {message.role === "USER" ? "Student" : message.role === "ADMIN" ? "Advisor" : "Chatbot"}
                                        </span>
                                        <span className="text-[10px] text-slate-400">{formatDate(message.createdAt)}</span>
                                      </div>
                                      <p className="whitespace-pre-wrap text-sm leading-5 text-slate-800">{message.content}</p>
                                    </div>
                                  ))
                                )}

                              </div>
                            )}
                          </div>

                          {!isTrashView && (
                            <div className="mt-5 rounded-lg border border-[#e5dede] bg-[#fdf8f8] p-4">
                              {label === "Pending" && typingStatuses[request.id] && (
                                <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                                  <span className="flex shrink-0 items-center gap-1 pt-1">
                                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.3s]" />
                                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.15s]" />
                                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500" />
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-emerald-700">Student is typing…</p>
                                    {studentDrafts[request.id] && (
                                      <p className="mt-0.5 wrap-break-word text-sm italic text-emerald-800">
                                        &ldquo;{studentDrafts[request.id]}&rdquo;
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                              {/* Suggested replies */}
                              {label === "Pending" && (
                                <div className="mb-3">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                      Suggested Replies
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => fetchSuggestedReplies(request.id)}
                                      disabled={suggestingId === request.id}
                                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-[#9E1B34] transition hover:bg-[#fff7f7] disabled:opacity-50"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                                        <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466.75.75 0 0 0-1.061 1.061 7 7 0 0 0 11.856-3.061.75.75 0 0 0-1.594-.466ZM4.688 8.576a5.5 5.5 0 0 1 9.201-2.466.75.75 0 1 0 1.061-1.061A7 7 0 0 0 3.094 8.11a.75.75 0 0 0 1.594.466Z" clipRule="evenodd" />
                                      </svg>
                                      {suggestingId === request.id ? "Generating…" : "Regenerate"}
                                    </button>
                                  </div>

                                  {suggestingId === request.id && !suggestedReplies[request.id] ? (
                                    <div className="flex items-center gap-2 rounded-lg border border-[#e5dede] bg-slate-50 px-3 py-3 text-xs text-slate-400">
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 animate-spin">
                                        <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466.75.75 0 0 0-1.061 1.061 7 7 0 0 0 11.856-3.061.75.75 0 0 0-1.594-.466ZM4.688 8.576a5.5 5.5 0 0 1 9.201-2.466.75.75 0 1 0 1.061-1.061A7 7 0 0 0 3.094 8.11a.75.75 0 0 0 1.594.466Z" clipRule="evenodd" />
                                      </svg>
                                      Generating suggestions…
                                    </div>
                                  ) : suggestedReplies[request.id]?.length > 0 ? (
                                    <div className="space-y-2">
                                      {suggestedReplies[request.id].map((suggestion, i) => (
                                        <button
                                          key={i}
                                          type="button"
                                          onClick={() => handleReplyChange(request.id, suggestion)}
                                          className="block w-full rounded-lg border border-[#e5dede] bg-white px-3 py-2.5 text-left text-sm text-slate-700 transition hover:border-[#9E1B34]/30 hover:bg-[#fff7f7]"
                                        >
                                          <span className="mr-2 inline-block rounded bg-[#9E1B34]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#9E1B34]">
                                            {i + 1}
                                          </span>
                                          {suggestion}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              )}

                              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                                Reply to user
                              </label>
                              <textarea
                                value={replies[request.id] ?? ""}
                                onChange={(event) => handleReplyChange(request.id, event.target.value)}
                                onFocus={() => {
                                  const y = window.scrollY
                                  requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }))
                                }}
                                rows={3}
                                placeholder="Type your reply or click a suggestion above…"
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
