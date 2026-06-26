"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

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
  confidence: "high" | "low" | null
  confidenceScore: number | null
  mode: string | null
  sources: string[]
}

type Filter = "overview" | "pending" | "answered" | "all" | "trash" | "history" | "analytics"

type ConfidenceFilter = "all" | "high" | "low"
type TypeFilter = "all" | "bot-only" | "escalated"
type HistoryGroupBy = "day" | "month"

const STATUS_STYLES: Record<string, string> = {
  pending:  "border-ad-warn/30  bg-ad-warn/15  text-ad-warn",
  active:   "border-ad-warn/30  bg-ad-warn/15  text-ad-warn",
  answered: "border-emerald-700/40 bg-emerald-900/25 text-emerald-300",
  assigned: "border-blue-700/40 bg-blue-900/25 text-blue-300",
  resolved: "border-emerald-700/40 bg-emerald-900/25 text-emerald-300",
  closed:   "border-white/10 bg-white/6 text-ad-muted",
  deleted:  "border-ad-danger/30 bg-ad-danger/10 text-ad-danger",
}

type QueueFilter = Exclude<Filter, "trash" | "history" | "analytics">

const FILTER_OPTIONS: Array<{ id: QueueFilter; label: string; description: string }> = [
  { id: "pending", label: "Pending", description: "Open conversations waiting for staff" },
  { id: "answered", label: "Answered", description: "Completed or closed support threads" },
  { id: "all", label: "All Requests", description: "Every visible support request" },
]

const REASON_LABELS: Record<string, string> = {
  "wrong-info": "Wrong info",
  "too-vague": "Too vague",
  "missing-info": "Missing info",
  "not-relevant": "Not relevant",
  "other": "Other",
}

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

const OVERVIEW_FILTER = {
  id: "overview" as const,
  label: "Overview",
  description: "At-a-glance summary of conversations and usage trends",
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


function formatListTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
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


const VALID_FILTERS: Filter[] = ["overview", "trash", "history", "analytics"]

function AdminConsolePageInner() {
  const adminName = "Financial Aid Advisor"
  const router = useRouter()
  const searchParams = useSearchParams()

  function parseTabParam(param: string | null): Filter {
    if (param && (VALID_FILTERS as string[]).includes(param)) return param as Filter
    return "overview"
  }

  const [filter, setFilter] = useState<Filter>(() => parseTabParam(searchParams.get("tab")))

  function navigateTo(tab: Filter) {
    setFilter(tab)
    if (tab !== "history") { setActiveTopicFilter(null); setActiveDateFilter(null) }
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", tab)
    router.replace(`?${params.toString()}`, { scroll: false })
  }
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all")
  const [historyGroupBy, setHistoryGroupBy] = useState<HistoryGroupBy>("day")
  const [historySearch, setHistorySearch] = useState("")
  const [activeTopicFilter, setActiveTopicFilter] = useState<{ label: string; keywords: string[] } | null>(null)
  const [activeDateFilter, setActiveDateFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false)
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
  const replyPanelRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const prevMessageCountsRef = useRef<Record<string, number>>({})
  const prevPendingCountRef = useRef<number | null>(null)
  const notHelpfulSectionRef = useRef<HTMLParagraphElement>(null)
  const [analyticsYear, setAnalyticsYear] = useState(new Date().getFullYear())
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsView, setAnalyticsView] = useState<"yearly" | "monthly">("yearly")
  const [selectedAnalyticsMonth, setSelectedAnalyticsMonth] = useState<string | null>(null)
  const [monthlyDetail, setMonthlyDetail] = useState<MonthlyDetail | null>(null)
  const [monthlyDetailLoading, setMonthlyDetailLoading] = useState(false)
  const [feedbackStats, setFeedbackStats] = useState<{ totals: { helpful: number; notHelpful: number; total: number }; recent: Array<{ id: number; question: string; answer: string; reason: string | null; comment: string | null; createdAt: string }>; helpfulConvIds: string[]; notHelpfulConvIds: string[] } | null>(null)
  const [feedbackFilter, setFeedbackFilter] = useState<"helpful" | "not-helpful" | null>(null)
  const [darkMode, setDarkMode] = useState(true)

  type DeletedConversation = {
    id: string
    title: string
    sessionId: string
    createdAt: string
    deletedAt: string
    messageCount: number
  }
  const [deletedConversations, setDeletedConversations] = useState<DeletedConversation[]>([])
  const [deletedConvsLoading, setDeletedConvsLoading] = useState(false)
  const [deletingConvId, setDeletingConvId] = useState<string | null>(null)
  const [restoringConvId, setRestoringConvId] = useState<string | null>(null)
  const [permanentDeletingConvId, setPermanentDeletingConvId] = useState<string | null>(null)
  const [expandedTrashConvId, setExpandedTrashConvId] = useState<string | null>(null)
  const [trashConvMessages, setTrashConvMessages] = useState<Record<string, Array<{ id: number; role: string; content: string; createdAt: string }>>>({})
  const [loadingTrashConvId, setLoadingTrashConvId] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem("admin-dark-mode")
    if (stored === "false") setDarkMode(false)
  }, [])

  function toggleDarkMode() {
    setDarkMode((prev) => {
      const next = !prev
      localStorage.setItem("admin-dark-mode", String(next))
      return next
    })
  }

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

  const fetchFeedbackStats = useCallback(async () => {
    try {
      const res = await fetch("/api/feedback")
      if (res.ok) setFeedbackStats(await res.json())
    } catch {}
  }, [])

  const fetchDeletedConversations = useCallback(async () => {
    setDeletedConvsLoading(true)
    try {
      const res = await fetch("/api/admin/conversations/deleted")
      if (res.ok) {
        const data = await res.json()
        setDeletedConversations(data.conversations ?? [])
      }
    } catch {} finally {
      setDeletedConvsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (filter === "trash") fetchDeletedConversations()
  }, [filter, fetchDeletedConversations])

  const toggleTrashConvMessages = useCallback(async (convId: string) => {
    if (expandedTrashConvId === convId) {
      setExpandedTrashConvId(null)
      return
    }
    setExpandedTrashConvId(convId)
    if (trashConvMessages[convId]) return
    setLoadingTrashConvId(convId)
    try {
      const res = await fetch(`/api/admin/conversations/${convId}/messages`)
      if (res.ok) {
        const data = await res.json()
        setTrashConvMessages((prev) => ({ ...prev, [convId]: data.messages ?? [] }))
      }
    } catch {} finally {
      setLoadingTrashConvId(null)
    }
  }, [expandedTrashConvId, trashConvMessages])

  async function deleteConversation(id: string) {
    setDeletingConvId(id)
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      })
      if (res.ok) {
        await fetchChatHistory()
        await fetchDeletedConversations()
      }
    } finally {
      setDeletingConvId(null)
    }
  }

  async function restoreConversation(id: string) {
    setRestoringConvId(id)
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      })
      if (res.ok) {
        await fetchChatHistory()
        await fetchDeletedConversations()
      }
    } finally {
      setRestoringConvId(null)
    }
  }

  async function permanentDeleteConversation(id: string) {
    if (!window.confirm("Permanently delete this conversation? This cannot be undone.")) return
    setPermanentDeletingConvId(id)
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, { method: "DELETE" })
      if (res.ok) await fetchDeletedConversations()
    } finally {
      setPermanentDeletingConvId(null)
    }
  }

  useEffect(() => {
    if (filter === "overview") fetchFeedbackStats()
  }, [filter, fetchFeedbackStats])

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

  // Update browser tab title with pending count so it's visible from any tab
  useEffect(() => {
    if (counts.pending > 0) {
      document.title = `(${counts.pending}) Admin | BYU–Hawaii Financial Aid`
    } else {
      document.title = "Admin | BYU–Hawaii Financial Aid"
    }
    return () => {
      document.title = "Admin | BYU–Hawaii Financial Aid"
    }
  }, [counts.pending])

  // Fire a browser notification when a new pending request arrives
  useEffect(() => {
    if (prevPendingCountRef.current === null) {
      prevPendingCountRef.current = counts.pending
      return
    }
    if (counts.pending > prevPendingCountRef.current) {
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        new Notification("New Live Support Request", {
          body: "A student is waiting for help in Live Support.",
          icon: "/favicon.ico",
        })
      }
    }
    prevPendingCountRef.current = counts.pending
  }, [counts.pending])

  const trashCounts = useMemo(() => {
    const deleted = requests.filter((request) => request.status === "deleted")
    const pending = deleted.filter((request) => deletedCategory(request) === "pending").length
    const answered = deleted.filter((request) => deletedCategory(request) === "answered").length
    return { pending, answered, all: deleted.length }
  }, [requests])

  const historyCounts = useMemo(() => {
    const high = chatHistory.filter((entry) => entry.confidence === "high").length
    const low = chatHistory.filter((entry) => entry.confidence === "low").length
    const uniqueConversations = new Set(chatHistory.map((entry) => entry.conversationId)).size
    return { high, low, all: chatHistory.length, conversations: uniqueConversations }
  }, [chatHistory])

  const visibleChatHistory = useMemo(() => {
    const byConfidence =
      confidenceFilter === "all"
        ? chatHistory
        : chatHistory.filter((entry) => entry.confidence === confidenceFilter)

    const byTopic = activeTopicFilter
      ? byConfidence.filter((entry) => {
          const haystack = `${entry.conversationTitle} ${entry.question} ${entry.answer}`.toLowerCase()
          return activeTopicFilter.keywords.some((kw) => haystack.includes(kw))
        })
      : byConfidence

    const byDate = activeDateFilter
      ? byTopic.filter((entry) => toHawaiiDateString(entry.questionAt) === activeDateFilter)
      : byTopic

    const query = historySearch.trim().toLowerCase()
    if (!query) return byDate

    return byDate.filter((entry) =>
      [
        entry.conversationTitle,
        entry.question,
        entry.answer,
        entry.confidence ?? "",
        ...entry.sources,
      ].some((value) => value.toLowerCase().includes(query))
    )
  }, [chatHistory, confidenceFilter, historySearch, activeTopicFilter, activeDateFilter])

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
        const agentReplies = historyAgentReplies[conversationId] ?? []
        const agentNames = [...new Set(agentReplies.map((r) => r.agentName))]

        return {
          conversationId,
          title: latestEntry.conversationTitle,
          preview: latestEntry.question,
          latestAt: latestEntry.questionAt,
          entries: sortedEntries,
          lowCount,
          highCount,
          total: entries.length,
          agentNames,
          hasLiveSupport: agentReplies.length > 0,
        }
      })
      .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())
  }, [visibleChatHistory, historyAgentReplies])

  const filteredHistoryConversations = useMemo(() => {
    let result = historyConversations
    if (typeFilter === "escalated") result = result.filter((c) => c.hasLiveSupport)
    if (typeFilter === "bot-only") result = result.filter((c) => !c.hasLiveSupport)
    if (feedbackFilter === "helpful") {
      const ids = new Set(feedbackStats?.helpfulConvIds ?? [])
      result = result.filter((c) => ids.has(c.conversationId))
    } else if (feedbackFilter === "not-helpful") {
      const ids = new Set(feedbackStats?.notHelpfulConvIds ?? [])
      result = result.filter((c) => ids.has(c.conversationId))
    }
    return result
  }, [historyConversations, typeFilter, feedbackFilter, feedbackStats])

  const filteredQuestionsCount = useMemo(() =>
    filteredHistoryConversations.reduce((sum, c) => sum + c.total, 0),
    [filteredHistoryConversations]
  )

  const activeHistoryFilterCount = useMemo(() => {
    return [
      confidenceFilter !== "all",
      typeFilter !== "all",
      historyGroupBy !== "day",
      feedbackFilter !== null,
    ].filter(Boolean).length
  }, [confidenceFilter, typeFilter, historyGroupBy, feedbackFilter])

  const selectedHistoryConversation = useMemo(() => {
    return filteredHistoryConversations.find((conversation) => conversation.conversationId === selectedHistoryConversationId)
      ?? filteredHistoryConversations[0]
      ?? null
  }, [filteredHistoryConversations, selectedHistoryConversationId])

  const groupedHistoryConversations = useMemo(() => {
    return filteredHistoryConversations.reduce<Array<{ label: string; conversations: typeof filteredHistoryConversations }>>((groups, conversation) => {
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
  }, [filteredHistoryConversations, historyGroupBy])

  const visibleRequests = useMemo(() => {
    if (filter === "trash") return requests.filter((request) => request.status === "deleted")
    const notDeleted = requests.filter((request) => request.status !== "deleted")
    if (filter === "all") return notDeleted
    return notDeleted.filter((request) => statusLabel(request.status).toLowerCase() === filter)
  }, [filter, requests])

  const activeFilter = filter === "overview"
    ? OVERVIEW_FILTER
    : filter === "trash"
      ? TRASH_FILTER
      : filter === "history"
        ? HISTORY_FILTER
        : filter === "analytics"
          ? ANALYTICS_FILTER
          : FILTER_OPTIONS.find((option) => option.id === filter) ?? FILTER_OPTIONS[0]
  const isOverviewView = filter === "overview"
  const isTrashView = filter === "trash"
  const isHistoryView = filter === "history"
  const isAnalyticsView = filter === "analytics"

  // Hawaii is UTC-10 and never observes DST
  function toHawaiiDateString(utcStr: string): string {
    const d = new Date(new Date(utcStr).getTime() - 10 * 60 * 60 * 1000)
    return d.toISOString().slice(0, 10)
  }

  // 14-day conversation chart data derived from chatHistory
  const conversationChart = useMemo(() => {
    const todayHawaii = toHawaiiDateString(new Date().toISOString())
    const todayMs = new Date(todayHawaii).getTime()
    const days: { label: string; date: string; count: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(todayMs - i * 24 * 60 * 60 * 1000)
      const dateStr = d.toISOString().slice(0, 10)
      days.push({
        date: dateStr,
        label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        count: 0,
      })
    }
    const conversationDays = new Map<string, Set<string>>()
    for (const entry of chatHistory) {
      const day = toHawaiiDateString(entry.questionAt)
      if (!conversationDays.has(day)) conversationDays.set(day, new Set())
      conversationDays.get(day)!.add(entry.conversationId)
    }
    for (const slot of days) {
      slot.count = conversationDays.get(slot.date)?.size ?? 0
    }
    return days
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatHistory])

  const todaySessionStats = useMemo(() => {
    const today = conversationChart.at(-1)?.count ?? 0
    const yesterday = conversationChart.at(-2)?.count ?? 0
    const diff = today - yesterday
    const trend = diff > 0 ? `↑ ${diff} vs yesterday` : diff < 0 ? `↓ ${Math.abs(diff)} vs yesterday` : "Same as yesterday"
    return { today, trend }
  }, [conversationChart])

  // ~15 min saved per bot-handled question (industry standard for FA email inquiries)
  const MINS_PER_INQUIRY = 15

  const staffHoursSaved = useMemo(() => {
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    // Count non-escalated bot answers this month (conversational greetings excluded)
    const handled = chatHistory.filter((entry) => {
      if (!entry.questionAt) return false
      const entryMonth = entry.questionAt.slice(0, 7)
      if (entryMonth !== thisMonth) return false
      return entry.mode !== "handoff" && entry.mode !== "unavailable"
    }).length
    const hours = (handled * MINS_PER_INQUIRY) / 60
    return hours > 0 ? parseFloat(hours.toFixed(1)) : 0
  }, [chatHistory])

  const TOPIC_DEFINITIONS = [
    { label: "FAFSA & Aid Application", keywords: ["fafsa", "financial aid", "aid application", "federal aid", "student aid", "apply for aid", "efc", "expected family contribution", "css profile", "pell grant"] },
    { label: "Scholarship Requirements", keywords: ["scholarship", "merit", "renewal", "eligibility", "gpa requirement", "byu scholarship", "academic scholarship", "dean's list"] },
    { label: "Disbursement Dates", keywords: ["disbursement", "when will i get", "when will i receive", "refund", "check", "deposit", "funds released", "direct deposit", "payment date"] },
    { label: "SAP & Appeals", keywords: ["sap", "satisfactory academic progress", "appeal", "academic standing", "financial aid suspension", "warning", "probation"] },
    { label: "Work Study / Employment", keywords: ["work study", "work-study", "iwork", "i-work", "campus job", "student employment", "iwork payback", "payback", "on-campus work"] },
    { label: "Cost of Attendance", keywords: ["tuition", "cost of attendance", "coa", "fees", "room and board", "housing cost", "how much does it cost", "total cost"] },
    { label: "Verification & Documents", keywords: ["verification", "document", "submit", "upload", "form", "required document", "tax return", "w2", "identity verification"] },
  ]

  const topTopics = useMemo(() => {
    // Build a combined text blob per conversation from all user questions + answers
    const byConversation = new Map<string, string>()
    for (const entry of chatHistory) {
      const existing = byConversation.get(entry.conversationId) ?? ""
      byConversation.set(entry.conversationId, `${existing} ${entry.question} ${entry.answer}`)
    }

    // Assign each conversation to the first matching topic (priority order)
    const counts = new Map<string, number>(TOPIC_DEFINITIONS.map((t) => [t.label, 0]))
    for (const text of byConversation.values()) {
      const lower = text.toLowerCase()
      for (const topic of TOPIC_DEFINITIONS) {
        if (topic.keywords.some((kw) => lower.includes(kw))) {
          counts.set(topic.label, (counts.get(topic.label) ?? 0) + 1)
          break
        }
      }
    }

    const totalClassified = Array.from(counts.values()).reduce((a, b) => a + b, 0)
    return TOPIC_DEFINITIONS
      .map((topic) => ({
        label: topic.label,
        keywords: topic.keywords,
        count: counts.get(topic.label) ?? 0,
        pct: totalClassified > 0 ? Math.round(((counts.get(topic.label) ?? 0) / totalClassified) * 100) : 0,
      }))
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatHistory])

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
        // Scroll the reply panel into view after the DOM has rendered
        setTimeout(() => {
          replyPanelRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }, 80)
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

  // Shared CSS used by both print reports
  const PRINT_CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 32px; }
    h1 { font-size: 20px; font-weight: 700; color: #9E1B34; }
    .meta { color: #64748b; font-size: 11px; margin-top: 4px; margin-bottom: 28px; }
    .section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: #94a3b8; margin-bottom: 10px; margin-top: 28px; }
    .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
    .card { border: 1px solid #e5dede; border-radius: 8px; padding: 12px 16px; min-width: 120px; }
    .card-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #94a3b8; }
    .card-value { font-size: 28px; font-weight: 800; color: #9E1B34; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 12px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #64748b; border-top: 2px solid #e5dede; border-bottom: 1px solid #e5dede; background: #f8fafc; }
    th:not(:first-child) { text-align: right; }
    td { padding: 9px 12px; border-bottom: 1px solid #f0eaea; font-size: 12px; }
    td:not(:first-child) { text-align: right; }
    .tfoot-row td { font-weight: 700; border-top: 2px solid #e5dede; border-bottom: none; background: #f8fafc; font-size: 12px; }
    .bar-wrap { height: 10px; background: #f1f5f9; border-radius: 99px; overflow: hidden; margin: 8px 0 16px; }
    .bar-fill { height: 100%; border-radius: 99px; background: #059669; }
    .feedback-table td:first-child { text-align: left; font-weight: 600; }
    .not-helpful-list { margin-top: 12px; }
    .not-helpful-item { border: 1px solid #fee2e2; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; background: #fff5f5; }
    .not-helpful-date { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #f87171; margin-bottom: 4px; }
    .not-helpful-q { font-weight: 600; font-size: 11px; margin-bottom: 3px; }
    .not-helpful-a { font-size: 11px; color: #64748b; white-space: pre-wrap; }
    .footer { margin-top: 32px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e5dede; padding-top: 12px; }
    @media print { body { padding: 16px; } }
  `

  // Builds the feedback HTML block; filteredRecent = not-helpful entries scoped to report period
  function buildFeedbackSection(filteredRecent: Array<{ id: number; question: string; answer: string; reason: string | null; comment: string | null; createdAt: string }>) {
    if (!feedbackStats) return ""
    const { helpful, notHelpful, total } = feedbackStats.totals
    const satisfactionPct = total > 0 ? Math.round((helpful / total) * 100) : 0
    const notHelpfulRows = filteredRecent.map((item) => `
      <div class="not-helpful-item">
        <div class="not-helpful-date">
          ${new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          ${item.reason ? `<span style="margin-left:8px;background:#fee2e2;color:#ef4444;border-radius:99px;padding:1px 8px;font-size:9px;font-weight:700;text-transform:capitalize">${item.reason.replace(/-/g, " ")}</span>` : ""}
        </div>
        <div class="not-helpful-q">Q: ${item.question}</div>
        <div class="not-helpful-a">A: ${item.answer.slice(0, 300)}${item.answer.length > 300 ? "…" : ""}</div>
        ${item.comment ? `<div style="margin-top:6px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;padding:6px 8px;font-size:10px;color:#64748b"><strong style="color:#f87171">User comment:</strong> ${item.comment}</div>` : ""}
      </div>`).join("")

    return `
  <p class="section-label">Chatbot Response Feedback — All Time</p>
  <div class="cards">
    <div class="card"><div class="card-label">Helpful</div><div class="card-value" style="color:#059669">${helpful}</div></div>
    <div class="card"><div class="card-label">Not Helpful</div><div class="card-value" style="color:#dc2626">${notHelpful}</div></div>
    <div class="card"><div class="card-label">Total Rated</div><div class="card-value">${total}</div></div>
    <div class="card"><div class="card-label">Satisfaction</div><div class="card-value">${satisfactionPct}%</div></div>
  </div>
  ${total > 0 ? `<div class="bar-wrap"><div class="bar-fill" style="width:${satisfactionPct}%"></div></div>` : ""}
  ${filteredRecent.length > 0 ? `
  <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin-bottom:8px">
    Not-Helpful Responses ${filteredRecent.length < feedbackStats.recent.length ? "(this period)" : "(recent)"}
  </p>
  <div class="not-helpful-list">${notHelpfulRows}</div>` : total > 0 ? `<p style="font-size:11px;color:#94a3b8;margin-bottom:16px">No not-helpful responses recorded for this period.</p>` : `<p style="font-size:11px;color:#94a3b8;margin-bottom:16px">No feedback submitted yet.</p>`}`
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

    // Filter not-helpful responses to this year
    const yearRecent = (feedbackStats?.recent ?? []).filter(
      (item) => new Date(item.createdAt).getFullYear() === year
    )

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>BYU-Hawaii Financial Aid — Analytics ${year}</title>
  <style>${PRINT_CSS}</style>
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
    <div class="card"><div class="card-label">High Confidence %</div><div class="card-value">${highPct}%</div></div>
  </div>

  <p class="section-label">Monthly Breakdown — ${year}</p>
  <table>
    <thead>
      <tr>
        <th>Month</th><th>Conversations</th><th>Questions</th>
        <th>High Confidence</th><th>Low Confidence</th><th>High %</th>
      </tr>
    </thead>
    <tbody>${monthRows}</tbody>
    <tfoot>
      <tr class="tfoot-row">
        <td>Year Total</td><td>${totals.conversations}</td><td>${totals.questions}</td>
        <td style="color:#059669">${totals.high}</td><td style="color:#d97706">${totals.low}</td>
        <td>${highPct}%</td><td style="color:#dc2626">${totals.escalations}</td>
      </tr>
    </tfoot>
  </table>

  ${buildFeedbackSection(yearRecent)}

  <p class="footer">BYU-Hawaii Financial Aid &amp; Scholarships &nbsp;·&nbsp; (808) 675-3316 &nbsp;·&nbsp; financialaid@byuh.edu &nbsp;·&nbsp; Lorenzo Snow Building Room 180</p>
</body>
</html>`

    const win = window.open("", "_blank", "width=960,height=720")
    if (win) { win.document.write(html); win.document.close(); win.focus(); win.print() }
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

    // Filter not-helpful responses to this month; fall back to all recent if none found
    const monthPrefix = selectedAnalyticsMonth ?? ""
    const monthFiltered = (feedbackStats?.recent ?? []).filter(
      (item) => item.createdAt.startsWith(monthPrefix)
    )
    const monthRecent = monthFiltered.length > 0 ? monthFiltered : (feedbackStats?.recent ?? [])

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>BYU-Hawaii Financial Aid — ${label} Report</title>
  <style>${PRINT_CSS}</style>
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
    <div class="card"><div class="card-label">High Confidence %</div><div class="card-value">${highPct}%</div></div>
  </div>

  <p class="section-label">Daily Breakdown — ${label} (${activeDays.length} active day${activeDays.length !== 1 ? "s" : ""})</p>
  <table>
    <thead>
      <tr>
        <th>Day</th><th>Conversations</th><th>Questions</th>
        <th>High Confidence</th><th>Low Confidence</th><th>High %</th>
      </tr>
    </thead>
    <tbody>${dayRows}</tbody>
    <tfoot>
      <tr class="tfoot-row">
        <td>Month Total</td><td>${totals.conversations}</td><td>${totals.questions}</td>
        <td style="color:#059669">${totals.high}</td><td style="color:#d97706">${totals.low}</td>
        <td>${highPct}%</td><td style="color:#dc2626">${totals.escalations}</td>
      </tr>
    </tfoot>
  </table>

  ${buildFeedbackSection(monthRecent)}

  <p class="footer">BYU-Hawaii Financial Aid &amp; Scholarships &nbsp;·&nbsp; (808) 675-3316 &nbsp;·&nbsp; financialaid@byuh.edu &nbsp;·&nbsp; Lorenzo Snow Building Room 180</p>
</body>
</html>`

    const win = window.open("", "_blank", "width=960,height=720")
    if (win) { win.document.write(html); win.document.close(); win.focus(); win.print() }
  }


  return (
    <main data-admin-theme={darkMode ? "dark" : "light"} className="min-h-screen bg-ad-bg text-ad-text">
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
          className={`fixed inset-y-0 left-0 z-40 flex w-18 flex-col items-center border-r border-[#7d1428] bg-[#9E1B34] py-4 text-white shadow-xl transition-transform md:sticky md:top-0 md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
            className="mb-4 rounded-lg p-2 text-white/65 transition hover:bg-white/10 hover:text-white md:hidden"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>

          <div className="mb-7 flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full bg-white/15 leading-none shadow-sm ring-2 ring-white/30">
            <span className="text-[10px] font-extrabold text-white">BYU</span>
            <span className="text-[5px] font-bold uppercase tracking-widest text-white/80">HAWAII</span>
          </div>

          <nav className="flex flex-1 flex-col items-center gap-3">
            {[
              {
                label: "Overview",
                active: isOverviewView,
                onClick: () => navigateTo("overview"),
                icon: (
                  <path fillRule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z" clipRule="evenodd" />
                ),
              },
              {
                label: "Live Support",
                active: filter === "pending" || filter === "answered" || filter === "all",
                dot: counts.pending > 0,
                onClick: () => navigateTo("pending"),
                icon: (
                  <path fillRule="evenodd" d="M2 5.75A2.75 2.75 0 0 1 4.75 3h10.5A2.75 2.75 0 0 1 18 5.75v8.5A2.75 2.75 0 0 1 15.25 17H4.75A2.75 2.75 0 0 1 2 14.25v-8.5Zm2.75-1.25c-.69 0-1.25.56-1.25 1.25v1h13v-1c0-.69-.56-1.25-1.25-1.25H4.75Zm11.75 3.75h-13v6c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6Z" clipRule="evenodd" />
                ),
              },
              {
                label: "Chat History",
                count: historyCounts.conversations,
                active: isHistoryView,
                onClick: () => navigateTo("history"),
                icon: (
                  <path fillRule="evenodd" d="M10 3c-4.418 0-8 2.91-8 6.5 0 1.508.635 2.89 1.697 3.993-.102.838-.367 1.522-.667 2.04a.75.75 0 0 0 .889 1.09 8.66 8.66 0 0 0 2.826-1.563A9.43 9.43 0 0 0 10 16c4.418 0 8-2.91 8-6.5S14.418 3 10 3ZM6.75 9.5a.75.75 0 1 0 0 1.5h.008a.75.75 0 1 0 0-1.5H6.75Zm3.25 0a.75.75 0 1 0 0 1.5h.008a.75.75 0 1 0 0-1.5H10Zm3.25 0a.75.75 0 1 0 0 1.5h.008a.75.75 0 1 0 0-1.5h-.008Z" clipRule="evenodd" />
                ),
              },
              {
                label: "Analytics",
                count: analyticsData?.totals.questions ?? 0,
                active: isAnalyticsView,
                onClick: () => navigateTo("analytics"),
                icon: (
                  <path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 15.5 2ZM9.5 6A1.5 1.5 0 0 0 8 7.5v9a1.5 1.5 0 0 0 3 0v-9A1.5 1.5 0 0 0 9.5 6ZM3.5 10A1.5 1.5 0 0 0 2 11.5v5a1.5 1.5 0 0 0 3 0v-5A1.5 1.5 0 0 0 3.5 10Z" />
                ),
              },
              {
                label: "Trash Bin",
                count: deletedConversations.length,
                active: isTrashView,
                onClick: () => navigateTo("trash"),
                icon: (
                  <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4Z" clipRule="evenodd" />
                ),
              },
            ].map((item) => {
              const isLiveSupportDisabled = item.label === "Live Support"
              return (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  if (isLiveSupportDisabled) return
                  item.onClick()
                  setSidebarOpen(false)
                }}
                aria-label={item.label}
                className={`group relative flex h-11 w-11 items-center justify-center rounded-lg transition ${
                  isLiveSupportDisabled
                    ? "cursor-not-allowed opacity-40 text-white/40"
                    : item.active
                      ? "bg-white text-[#9E1B34] shadow-sm"
                      : "text-white/70 hover:bg-white/12 hover:text-white"
                }`}
              >
                {item.active && !isLiveSupportDisabled && <span className="absolute -left-3 h-7 w-1 rounded-r-full bg-white" />}
                {"dot" in item && item.dot && !isLiveSupportDisabled && (
                  <span className="absolute right-1.5 top-1.5 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                  </span>
                )}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  {item.icon}
                </svg>
                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition group-hover:translate-x-1 group-hover:opacity-100">
                  {item.label}
                </span>
              </button>
              )
            })}
          </nav>

          <button
            type="button"
            onClick={fetchRequests}
            aria-label="Refresh requests"
            className="group relative mb-3 flex h-11 w-11 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/12 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466.75.75 0 0 0-1.061 1.061 7 7 0 0 0 11.856-3.061.75.75 0 0 0-1.594-.466ZM4.688 8.576a5.5 5.5 0 0 1 9.201-2.466.75.75 0 1 0 1.061-1.061A7 7 0 0 0 3.094 8.11a.75.75 0 0 0 1.594.466Z" clipRule="evenodd" />
            </svg>
            <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition group-hover:translate-x-1 group-hover:opacity-100">
              Refresh requests
            </span>
          </button>

          <div className="group relative flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-bold text-white">
            {(adminName || "A").charAt(0).toUpperCase()}
            <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition group-hover:translate-x-1 group-hover:opacity-100">
              {adminName || "Financial Aid Advisor"}
            </span>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="admin-header sticky top-0 z-20 border-b border-white/7 bg-ad-bg/95 px-4 py-4 backdrop-blur md:px-6">
            <div className="mx-auto flex max-w-6xl items-center gap-4">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
                className="rounded-lg border border-white/7 bg-ad-surface p-2 text-ad-muted shadow-sm transition hover:bg-white/5 md:hidden"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-bold text-ad-text md:text-2xl">
                  {isOverviewView ? "Overview" : isHistoryView ? "Chat History" : isAnalyticsView ? "Analytics" : isTrashView ? "Trash Bin" : "Live Support"}
                </h2>
                <p className="mt-1 text-sm text-[#787878]">{activeFilter.description}</p>
              </div>
              <button
                type="button"
                onClick={toggleDarkMode}
                aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/7 bg-ad-surface text-ad-muted transition hover:bg-ad-raised hover:text-ad-text"
                title={darkMode ? "Light mode" : "Dark mode"}
              >
                {darkMode ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.06 1.06l1.06 1.06ZM5.404 6.464a.75.75 0 0 0 1.06-1.06l-1.06-1.06a.75.75 0 1 0-1.061 1.06l1.06 1.06Z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M7.455 2.004a.75.75 0 0 1 .26.77 7 7 0 0 0 9.958 7.967.75.75 0 0 1 1.067.853A8.5 8.5 0 1 1 6.647 1.921a.75.75 0 0 1 .808.083Z" clipRule="evenodd" />
                  </svg>
                )}
              </button>

              <div className="hidden rounded-lg border border-white/7 bg-ad-surface px-3 py-2 text-right shadow-sm sm:block">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">
                  {isOverviewView ? "Chats" : isHistoryView ? "Questions" : isAnalyticsView ? "Questions" : isTrashView ? "Deleted" : "Visible"}
                </p>
                <p className="text-lg font-bold text-[#9E1B34]">
                  {isOverviewView ? historyCounts.conversations : isHistoryView ? filteredQuestionsCount : isAnalyticsView ? (analyticsData?.totals.questions ?? "—") : isTrashView ? deletedConversations.length : visibleRequests.length}
                </p>
              </div>
            </div>
          </header>

          <div className={`relative mx-auto px-4 py-6 md:px-6 ${isHistoryView ? "max-w-none" : "max-w-6xl"}`}>
            {!isHistoryView && !isAnalyticsView && !isTrashView && !isOverviewView && (
              <div className="mb-5 flex gap-2">
                {([
                  { id: "pending" as const, label: "Pending", count: counts.pending },
                  { id: "answered" as const, label: "Answered", count: counts.answered },
                  { id: "all" as const, label: "All Requests", count: counts.all },
                ] as const).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => navigateTo(option.id)}
                    className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                      filter === option.id
                        ? "bg-[#9E1B34] text-white shadow-sm"
                        : "border border-white/7 bg-ad-surface text-ad-muted hover:bg-white/6 hover:text-white"
                    }`}
                  >
                    {option.label}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      filter === option.id ? "bg-white/20 text-white" : "bg-white/8 text-[#787878]"
                    }`}>
                      {option.count}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {!isHistoryView && !isAnalyticsView && !isOverviewView && (
              <div className="mb-6 flex items-start gap-3 rounded-lg border border-white/7 bg-ad-raised px-6 py-5">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-ad-dim">
                  <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
                </svg>
                <p className="text-xs leading-6 text-[#787878]">
                  <span className="font-semibold text-ad-muted">Hours:</span> Mon–Fri, 8 AM–5 PM HST. Closed during devotional (Tue 11 AM–12 PM) and holidays.
                  <span className="mx-2 text-[#3e3e3e]">·</span>
                  <span className="font-semibold text-ad-warn">Privacy:</span> Do not collect or store sensitive personal information in live chat — direct account-specific records to official Financial Aid channels.
                </p>
              </div>
            )}

            {isTrashView && (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    { label: "Deleted Conversations", count: deletedConversations.length },
                    { label: "Total Messages", count: deletedConversations.reduce((s, c) => s + c.messageCount, 0) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-white/7 bg-ad-surface px-6 py-5 shadow-sm">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ad-dim">{item.label}</p>
                      <p className="mt-2 text-2xl font-bold text-[#9E1B34]">{item.count}</p>
                    </div>
                  ))}
                </div>

                {deletedConvsLoading ? (
                  <p className="py-10 text-center text-sm text-ad-dim">Loading...</p>
                ) : deletedConversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-white/7 bg-ad-surface py-20 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mb-3 h-8 w-8 text-ad-dim">
                      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4Z" clipRule="evenodd" />
                    </svg>
                    <p className="text-sm font-semibold text-ad-dim">Trash is empty</p>
                    <p className="mt-1 text-xs text-ad-dim">Conversations deleted from Chat History appear here.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {deletedConversations.map((conv) => {
                      const isExpanded = expandedTrashConvId === conv.id
                      const messages = trashConvMessages[conv.id]
                      const isLoadingMsgs = loadingTrashConvId === conv.id
                      return (
                        <div key={conv.id} className={`group rounded-lg border shadow-sm transition ${isExpanded ? "border-[#9E1B34]/40 bg-[#9E1B34]/5" : "border-white/7 bg-ad-surface hover:border-[#9E1B34]/40 hover:bg-[#9E1B34]/5"}`}>
                          <div className="flex items-center justify-between gap-4 px-6 py-4">
                            <button
                              type="button"
                              onClick={() => toggleTrashConvMessages(conv.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-center gap-2">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                  className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? "rotate-90 text-[#9E1B34]" : "text-ad-dim group-hover:text-[#9E1B34]"}`}
                                >
                                  <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                                </svg>
                                <p className={`truncate text-sm font-semibold transition ${isExpanded ? "text-[#9E1B34]" : "text-ad-text group-hover:text-[#9E1B34]"}`}>{conv.title}</p>
                              </div>
                              <p className="mt-0.5 pl-5 text-[10px] text-ad-muted">
                                {conv.messageCount} messages · Deleted {new Date(conv.deletedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </p>
                            </button>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => restoreConversation(conv.id)}
                                disabled={restoringConvId === conv.id}
                                className="rounded-lg border border-white/7 bg-ad-raised px-3 py-1.5 text-xs font-semibold text-ad-muted transition hover:bg-white/8 hover:text-ad-text disabled:opacity-50"
                              >
                                {restoringConvId === conv.id ? "Restoring..." : "Restore"}
                              </button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-white/7 px-6 py-5">
                              {isLoadingMsgs ? (
                                <p className="py-4 text-center text-xs text-ad-dim">Loading messages...</p>
                              ) : !messages || messages.length === 0 ? (
                                <p className="py-4 text-center text-xs text-ad-dim">No messages found.</p>
                              ) : (
                                <div className="space-y-3">
                                  {messages.map((msg) => (
                                    <div
                                      key={msg.id}
                                      className={`flex gap-3 ${msg.role === "user" ? "flex-row" : "flex-row-reverse"}`}
                                    >
                                      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${msg.role === "user" ? "bg-white/10 text-ad-muted" : "bg-[#9E1B34]/20 text-[#9E1B34]"}`}>
                                        {msg.role === "user" ? "S" : "AI"}
                                      </div>
                                      <div className={`max-w-[75%] rounded-lg px-4 py-2.5 text-xs leading-relaxed ${msg.role === "user" ? "bg-white/6 text-ad-muted" : "bg-ad-raised text-ad-text"}`}>
                                        {msg.content}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mb-5 rounded-lg border border-ad-danger/30 bg-ad-danger/10 px-6 py-5 text-sm text-ad-danger">
                {error}
              </div>
            )}

            {loading ? (
              <div className="rounded-lg border border-white/7 bg-ad-surface py-16 text-center text-sm text-ad-dim">
                Loading support requests...
              </div>
            ) : isOverviewView ? (
              /* ═══════════════════════════════════════════
                 OVERVIEW PAGE
              ═══════════════════════════════════════════ */
              <div className="space-y-6">
                {/* ── Crimson header banner ── */}
                <div className="rounded-xl bg-ad-accent2 px-6 py-5 shadow-md">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/60">BYU–Hawaii</p>
                      <h1 className="mt-0.5 text-lg font-bold text-white">Financial Aid Assistant · Admin Console</h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white">
                        {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ── Four metric cards ── */}
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    {
                      label: "Conversations",
                      value: historyCounts.conversations,
                      sub: "All time",
                      color: "text-ad-text",
                      tab: "history" as Filter,
                    },
                    {
                      label: "Today's Sessions",
                      value: todaySessionStats.today,
                      sub: todaySessionStats.trend,
                      color: "text-ad-up",
                      tab: "analytics" as Filter,
                    },
                    {
                      label: "Staff hours saved",
                      value: `${staffHoursSaved}h`,
                      sub: `This month · ${MINS_PER_INQUIRY} min per inquiry`,
                      color: "text-ad-warn",
                      tab: "analytics" as Filter,
                    },
                  ].map((card) => (
                    <button
                      key={card.label}
                      type="button"
                      onClick={() => navigateTo(card.tab)}
                      className="group rounded-xl border border-white/7 bg-ad-surface px-6 py-5 shadow-sm text-left transition hover:border-ad-accent/40 hover:bg-ad-raised"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ad-muted">{card.label}</p>
                      <p className={`mt-2 text-3xl font-bold ${card.color}`}>{card.value}</p>
                      <p className="mt-1 text-[10px] text-ad-muted">{card.sub}</p>
                    </button>
                  ))}
                </div>

                {/* ── Middle row: Knowledge Gaps + Live Support Queue ── */}
                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Response Feedback card */}
                  <div className="rounded-xl border border-white/7 bg-ad-surface p-6 shadow-sm">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-emerald-400">
                            <path d="M1 8.25a1.25 1.25 0 1 1 2.5 0v7.5a1.25 1.25 0 1 1-2.5 0v-7.5ZM11 3V1.7c0-.268.14-.526.395-.607A2 2 0 0 1 14 3c0 .995-.182 1.948-.514 2.826-.204.54.166 1.174.744 1.174h2.52c1.243 0 2.261 1.01 2.146 2.247a23.864 23.864 0 0 1-1.341 5.974C17.153 16.323 16.072 17 14.9 17H8.774c-1.164 0-2.154-.774-2.154-1.938V10.3c0-.54.26-1.02.714-1.365 1.865-1.4 2.703-4.105 2.703-5.935Z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-ad-text">Response Feedback</p>
                          <p className="text-[10px] text-ad-muted">
                            {feedbackStats
                              ? `${feedbackStats.totals.total} rating${feedbackStats.totals.total !== 1 ? "s" : ""} collected`
                              : "Loading…"}
                          </p>
                        </div>
                      </div>
                      {feedbackStats && feedbackStats.totals.total > 0 && (
                        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
                          {Math.round((feedbackStats.totals.helpful / feedbackStats.totals.total) * 100)}% helpful
                        </span>
                      )}
                    </div>

                    {feedbackStats && feedbackStats.totals.total > 0 && (
                      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/8">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${Math.round((feedbackStats.totals.helpful / feedbackStats.totals.total) * 100)}%` }}
                        />
                      </div>
                    )}

                    {!feedbackStats ? (
                      <p className="py-6 text-center text-xs text-ad-muted">Loading…</p>
                    ) : feedbackStats.totals.total === 0 ? (
                      <p className="py-6 text-center text-xs text-ad-muted">No feedback submitted yet.</p>
                    ) : (
                      <>
                        <div className="mb-4 grid grid-cols-2 gap-3">
                          <div className="rounded-lg border border-white/7 bg-ad-raised px-4 py-3 text-center">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-ad-muted">Helpful</p>
                            <p className="mt-1 text-xl font-bold text-emerald-400">{feedbackStats.totals.helpful}</p>
                          </div>
                          <div className="rounded-lg border border-white/7 bg-ad-raised px-4 py-3 text-center">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-ad-muted">Not Helpful</p>
                            <p className="mt-1 text-xl font-bold text-ad-danger">{feedbackStats.totals.notHelpful}</p>
                          </div>
                        </div>
                        {feedbackStats.recent.slice(0, 3).map((item) => (
                          <div key={item.id} className="mb-2 rounded-lg border border-ad-danger/20 bg-ad-danger/8 px-4 py-3">
                            <p className="line-clamp-2 text-sm font-semibold text-ad-text">{item.question}</p>
                            {item.reason && (
                              <span className="mt-1.5 inline-block rounded-full bg-ad-danger/15 px-2 py-0.5 text-[10px] font-bold text-ad-danger">
                                {REASON_LABELS[item.reason] ?? item.reason}
                              </span>
                            )}
                            {item.comment && (
                              <p className="mt-1 text-[11px] italic text-ad-muted">&ldquo;{item.comment}&rdquo;</p>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => navigateTo("analytics")}
                          className="mt-2 w-full rounded-lg border border-white/7 py-2 text-xs font-semibold text-ad-muted transition hover:bg-white/6"
                        >
                          View full analytics →
                        </button>
                      </>
                    )}
                  </div>

                  {/* Top topics */}
                  <div className="rounded-xl border border-white/7 bg-ad-surface p-6 shadow-sm">
                    <div className="mb-5 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-ad-text">Top topics</p>
                        <p className="mt-0.5 text-[10px] text-ad-muted">
                          {topTopics.length > 0 ? "Based on real conversation data · click to filter" : "No conversation data yet"}
                        </p>
                      </div>
                      {topTopics.length > 0 && (
                        <span className="shrink-0 rounded-full bg-white/6 px-2 py-0.5 text-[10px] font-bold text-ad-muted">
                          {topTopics.reduce((s, t) => s + t.count, 0)} convs
                        </span>
                      )}
                    </div>
                    {topTopics.length === 0 ? (
                      <p className="py-6 text-center text-xs text-ad-muted">Start chatting to see topic trends here.</p>
                    ) : (
                      <div className="space-y-3">
                        {topTopics.map((topic) => (
                          <button
                            key={topic.label}
                            type="button"
                            onClick={() => {
                              setActiveTopicFilter({ label: topic.label, keywords: topic.keywords })
                              navigateTo("history")
                            }}
                            className="group w-full text-left"
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-ad-text transition group-hover:text-ad-accent2">{topic.label}</span>
                              <span className="text-[10px] text-ad-muted">{topic.pct}% · {topic.count}</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                              <div className="h-full rounded-full bg-ad-accent2 transition-all group-hover:bg-ad-accent" style={{ width: `${topic.pct}%` }} />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Bottom row: 14-day chart + Live Support Queue ── */}
                <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                  {/* 14-day conversations bar chart */}
                  <div className="rounded-xl border border-white/7 bg-ad-surface p-6 shadow-sm">
                    <p className="mb-1 text-sm font-bold text-ad-text">Conversations · last 14 days</p>
                    <p className="mb-5 text-[10px] text-ad-muted">Unique conversations per day · click a bar to view chats</p>
                    {conversationChart.every((d) => d.count === 0) ? (
                      <p className="py-8 text-center text-xs text-ad-muted">No conversation data yet.</p>
                    ) : (() => {
                      const max = Math.max(...conversationChart.map((d) => d.count), 1)
                      const BAR_H = 160
                      const step = max <= 5 ? 1 : max <= 15 ? 5 : 10
                      const ticks: number[] = []
                      for (let t = 0; t <= max; t += step) ticks.push(t)
                      if (ticks[ticks.length - 1] < max) ticks.push(max)
                      return (
                        <div className="flex gap-3">
                          {/* Y-axis labels */}
                          <div className="relative shrink-0 w-5" style={{ height: BAR_H + 20 }}>
                            {ticks.map((t) => (
                              <span
                                key={t}
                                className="absolute right-0 text-right text-[9px] leading-none text-ad-muted -translate-y-1/2"
                                style={{ bottom: `${(t / max) * BAR_H + 20}px` }}
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                          {/* Chart body */}
                          <div className="relative flex-1">
                            {/* Horizontal grid lines */}
                            <div className="pointer-events-none absolute inset-x-0" style={{ bottom: 20, height: BAR_H }}>
                              {ticks.map((t) => (
                                <div
                                  key={t}
                                  className="absolute left-0 right-0 border-t border-white/8"
                                  style={{ bottom: `${(t / max) * BAR_H}px` }}
                                />
                              ))}
                            </div>
                            {/* Bars + date labels */}
                            <div className="flex items-end gap-1 pb-5" style={{ height: BAR_H + 20 }}>
                              {conversationChart.map((day) => {
                                const barH = Math.max(day.count > 0 ? 3 : 0, (day.count / max) * BAR_H)
                                const isClickable = day.count > 0
                                return (
                                  <button
                                    key={day.date}
                                    type="button"
                                    disabled={!isClickable}
                                    onClick={() => {
                                      if (!isClickable) return
                                      setActiveDateFilter(day.date)
                                      setActiveTopicFilter(null)
                                      navigateTo("history")
                                    }}
                                    className={`group relative flex flex-1 flex-col items-center ${isClickable ? "cursor-pointer" : "cursor-default"}`}
                                  >
                                    <div
                                      className={`w-full rounded-t-sm transition-all ${isClickable ? "bg-ad-accent2 group-hover:bg-ad-accent" : "bg-white/10"}`}
                                      style={{ height: `${barH}px` }}
                                    />
                                    {isClickable && (
                                      <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-950 px-1.5 py-0.5 text-[9px] font-bold text-white opacity-0 shadow transition-opacity group-hover:opacity-100">
                                        {day.count} chat{day.count !== 1 ? "s" : ""}
                                      </span>
                                    )}
                                    <span className="mt-1 text-[8px] text-ad-muted">{day.label.split(" ")[1]}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>

                  {/* Live Support Queue card — graded out until feature is enabled */}
                  <div className="rounded-xl border border-white/5 bg-ad-surface/50 p-6 shadow-sm opacity-50">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ad-muted/10">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-ad-muted">
                          <path fillRule="evenodd" d="M2 5.75A2.75 2.75 0 0 1 4.75 3h10.5A2.75 2.75 0 0 1 18 5.75v8.5A2.75 2.75 0 0 1 15.25 17H4.75A2.75 2.75 0 0 1 2 14.25v-8.5Zm2.75-1.25c-.69 0-1.25.56-1.25 1.25v1h13v-1c0-.69-.56-1.25-1.25-1.25H4.75Zm11.75 3.75h-13v6c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6Z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-ad-muted">Live Support Queue</p>
                        <p className="text-[10px] text-ad-dim">Coming soon</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-center py-8 text-center">
                      <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-ad-dim">Coming Soon</span>
                      <p className="mt-3 text-xs text-ad-dim">Live advisor support is temporarily disabled.</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : isAnalyticsView ? (
              <div className="space-y-5">
                <section className="rounded-lg border border-white/7 bg-ad-surface px-6 py-6 shadow-sm">
                  {/* Header row: view toggle + year dropdown + print */}
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Yearly / Monthly toggle */}
                      <div className="flex items-center gap-1 rounded-xl border border-white/7 bg-ad-raised p-1">
                        <button
                          type="button"
                          onClick={() => setAnalyticsView("yearly")}
                          className={`rounded-lg px-5 py-2 text-sm font-bold transition ${
                            analyticsView === "yearly"
                              ? "bg-[#9E1B34] text-white shadow-sm"
                              : "text-[#787878] hover:text-[#e0e0e0]"
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
                              : "text-[#787878] hover:text-[#e0e0e0]"
                          }`}
                        >
                          Monthly
                        </button>
                      </div>

                      {/* Year dropdown — only shown in Yearly view */}
                      {analyticsView === "yearly" && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ad-dim">Year</span>
                          <select
                            value={analyticsYear}
                            onChange={(e) => {
                              setAnalyticsYear(Number(e.target.value))
                              setSelectedAnalyticsMonth(null)
                            }}
                            className="rounded-lg border border-white/7 bg-ad-surface px-3 py-2 text-sm font-semibold text-[#c4c4c4] outline-none focus:border-[#9E1B34]/50 focus:ring-2 focus:ring-[#9E1B34]/10"
                          >
                            {(analyticsData?.availableYears ?? Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i)).map((y) => (
                              <option key={y} value={y}>{y}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Print button — context-aware */}
                    {analyticsData && (
                      analyticsView === "yearly" ? (
                        <button
                          type="button"
                          onClick={printAnalyticsReport}
                          className="flex items-center gap-2 rounded-lg border border-white/7 bg-ad-surface px-4 py-2 text-sm font-semibold text-ad-muted transition hover:bg-ad-raised"
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
                          className="flex items-center gap-2 rounded-lg border border-white/7 bg-ad-surface px-4 py-2 text-sm font-semibold text-ad-muted transition hover:bg-ad-raised disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                            <path fillRule="evenodd" d="M5 4v3H4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2h1a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1Zm2 0h6v3H7V4Zm-1 9v-1h8v3H6v-2Zm9-5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" clipRule="evenodd" />
                          </svg>
                          Print Monthly Report
                        </button>
                      )
                    )}
                  </div>

                  {analyticsLoading ? (
                    <p className="py-10 text-center text-sm text-ad-dim">Loading analytics...</p>
                  ) : analyticsData ? (
                    analyticsView === "yearly" ? (
                      <>
                        {/* Yearly totals */}
                        <p className="mb-5 text-[10px] font-bold uppercase tracking-[0.18em] text-ad-dim">
                          Yearly Summary — {analyticsData.year}
                        </p>
                        <div className="mb-8 grid gap-4 sm:grid-cols-4">
                          {[
                            { label: "Conversations",  value: analyticsData.totals.conversations, conf: "all" as ConfidenceFilter, type: "all" as TypeFilter },
                            { label: "Questions",      value: analyticsData.totals.questions,     conf: "all" as ConfidenceFilter, type: "all" as TypeFilter },
                            { label: "High Confidence",value: analyticsData.totals.high,          conf: "high" as ConfidenceFilter,type: "all" as TypeFilter },
                            { label: "Low Confidence", value: analyticsData.totals.low,           conf: "low"  as ConfidenceFilter,type: "all" as TypeFilter },
                          ].map((item) => (
                            <button
                              key={item.label}
                              onClick={() => { navigateTo("history"); setConfidenceFilter(item.conf); setTypeFilter(item.type); }}
                              className="group rounded-lg border border-white/7 bg-ad-raised px-6 py-5 text-left transition hover:border-ad-accent/40 hover:bg-ad-surface hover:shadow-sm"
                            >
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">{item.label}</p>
                              <p className="mt-1 text-2xl font-bold text-[#9E1B34]">{item.value}</p>
                              <p className="mt-2 text-[9px] font-semibold text-ad-accent opacity-0 transition group-hover:opacity-100">View →</p>
                            </button>
                          ))}
                        </div>

                        {/* Monthly table — all months visible */}
                        <p className="mb-5 text-[10px] font-bold uppercase tracking-[0.18em] text-ad-dim">
                          Monthly Breakdown — {analyticsData.year}
                        </p>
                        <div className="overflow-hidden rounded-lg border border-white/7">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/7 bg-ad-raised">
                                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">Month</th>
                                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">Conversations</th>
                                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">Questions</th>
                                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">High</th>
                                <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">Low</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analyticsData.months.map((row) => (
                                <tr key={row.month} className="border-b border-white/5 last:border-0">
                                  <td className="px-4 py-3 font-semibold text-[#e0e0e0]">{row.label}</td>
                                  <td className="px-4 py-3 text-right text-[#c4c4c4]">{row.conversations}</td>
                                  <td className="px-4 py-3 text-right text-[#c4c4c4]">{row.questions}</td>
                                  <td className="px-4 py-3 text-right">
                                    <span className={row.high > 0 ? "font-semibold text-emerald-300" : "text-[#3e3e3e]"}>{row.high}</span>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <span className={row.low > 0 ? "font-semibold text-ad-warn" : "text-[#3e3e3e]"}>{row.low}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 border-white/7 bg-ad-raised">
                                <td className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#787878]">Year Total</td>
                                <td className="px-4 py-3 text-right font-bold text-[#e0e0e0]">{analyticsData.totals.conversations}</td>
                                <td className="px-4 py-3 text-right font-bold text-[#e0e0e0]">{analyticsData.totals.questions}</td>
                                <td className="px-4 py-3 text-right font-bold text-emerald-300">{analyticsData.totals.high}</td>
                                <td className="px-4 py-3 text-right font-bold text-ad-warn">{analyticsData.totals.low}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </>
                    ) : (
                      /* Monthly view */
                      <>
                        <div className="mb-5 flex flex-wrap items-center gap-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ad-dim">Select Month</p>
                          <select
                            value={selectedAnalyticsMonth ?? ""}
                            onChange={(e) => setSelectedAnalyticsMonth(e.target.value)}
                            className="rounded-lg border border-white/7 bg-ad-surface px-3 py-2 text-sm font-semibold text-[#c4c4c4] outline-none focus:border-[#9E1B34]/50 focus:ring-2 focus:ring-[#9E1B34]/10"
                          >
                            {analyticsData.months.map((m) => (
                              <option key={m.month} value={m.month}>{m.label}</option>
                            ))}
                          </select>
                        </div>

                        {monthlyDetailLoading ? (
                          <p className="py-10 text-center text-sm text-ad-dim">Loading monthly data...</p>
                        ) : monthlyDetail ? (
                          <>
                            <p className="mb-5 text-[10px] font-bold uppercase tracking-[0.18em] text-ad-dim">
                              Monthly Summary — {monthlyDetail.label}
                            </p>
                            <div className="mb-8 grid gap-4 sm:grid-cols-4">
                              {[
                                { label: "Conversations",  value: monthlyDetail.totals.conversations, conf: "all" as ConfidenceFilter, type: "all" as TypeFilter },
                                { label: "Questions",      value: monthlyDetail.totals.questions,     conf: "all" as ConfidenceFilter, type: "all" as TypeFilter },
                                { label: "High Confidence",value: monthlyDetail.totals.high,          conf: "high" as ConfidenceFilter,type: "all" as TypeFilter },
                                { label: "Low Confidence", value: monthlyDetail.totals.low,           conf: "low"  as ConfidenceFilter,type: "all" as TypeFilter },
                              ].map((item) => (
                                <button
                                  key={item.label}
                                  onClick={() => { navigateTo("history"); setConfidenceFilter(item.conf); setTypeFilter(item.type); }}
                                  className="group rounded-lg border border-white/7 bg-ad-raised px-6 py-5 text-left transition hover:border-ad-accent/40 hover:bg-ad-surface hover:shadow-sm"
                                >
                                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">{item.label}</p>
                                  <p className="mt-1 text-2xl font-bold text-[#9E1B34]">{item.value}</p>
                                  <p className="mt-2 text-[9px] font-semibold text-ad-accent opacity-0 transition group-hover:opacity-100">View →</p>
                                </button>
                              ))}
                            </div>

                            <p className="mb-5 text-[10px] font-bold uppercase tracking-[0.18em] text-ad-dim">
                              Daily Breakdown — {monthlyDetail.label}
                            </p>
                            <div className="overflow-hidden rounded-lg border border-white/7">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-white/7 bg-ad-raised">
                                    <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">Day</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">Conversations</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">Questions</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">High</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">Low</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {monthlyDetail.days.filter((d) => d.questions > 0).map((d) => (
                                    <tr key={d.date} className="border-b border-white/5 last:border-0">
                                      <td className="px-4 py-3 font-semibold text-[#e0e0e0]">{d.label}</td>
                                      <td className="px-4 py-3 text-right text-[#c4c4c4]">{d.conversations}</td>
                                      <td className="px-4 py-3 text-right text-[#c4c4c4]">{d.questions}</td>
                                      <td className="px-4 py-3 text-right">
                                        <span className={d.high > 0 ? "font-semibold text-emerald-300" : "text-[#3e3e3e]"}>{d.high}</span>
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                        <span className={d.low > 0 ? "font-semibold text-ad-warn" : "text-[#3e3e3e]"}>{d.low}</span>
                                      </td>
                                    </tr>
                                  ))}
                                  {monthlyDetail.days.filter((d) => d.questions > 0).length === 0 && (
                                    <tr>
                                      <td colSpan={5} className="px-4 py-10 text-center text-ad-dim">No activity recorded this month.</td>
                                    </tr>
                                  )}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-white/7 bg-ad-raised">
                                    <td className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#787878]">Month Total</td>
                                    <td className="px-4 py-3 text-right font-bold text-[#e0e0e0]">{monthlyDetail.totals.conversations}</td>
                                    <td className="px-4 py-3 text-right font-bold text-[#e0e0e0]">{monthlyDetail.totals.questions}</td>
                                    <td className="px-4 py-3 text-right font-bold text-emerald-300">{monthlyDetail.totals.high}</td>
                                    <td className="px-4 py-3 text-right font-bold text-ad-warn">{monthlyDetail.totals.low}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </>
                        ) : (
                          <p className="py-10 text-center text-sm text-ad-dim">Select a month above to view daily data.</p>
                        )}
                      </>
                    )
                  ) : (
                    <p className="py-10 text-center text-sm text-ad-dim">No analytics data available.</p>
                  )}
                </section>

                {/* Chatbot Response Feedback */}
                <section className="rounded-lg border border-white/7 bg-ad-surface px-6 py-6 shadow-sm">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-ad-dim">Chatbot Response Feedback</p>
                  <p className="mb-5 text-xs text-[#787878]">Student ratings on chatbot responses — all time</p>

                  {feedbackStats ? (
                    <>
                      <div className="mb-6 grid gap-4 sm:grid-cols-3">
                        {[
                          { label: "Helpful", value: feedbackStats.totals.helpful, color: "text-emerald-400", hoverBorder: "hover:border-emerald-500/40 hover:bg-emerald-500/8", activeBorder: "border-emerald-500/40 bg-emerald-500/8", feedbackType: "helpful" as const, hint: "View helpful chats →" },
                          { label: "Not Helpful", value: feedbackStats.totals.notHelpful, color: "text-red-500", hoverBorder: "hover:border-ad-danger/50 hover:bg-ad-danger/8", activeBorder: "border-ad-danger/50 bg-ad-danger/8", feedbackType: "not-helpful" as const, hint: "View not-helpful chats →" },
                          { label: "Total Rated", value: feedbackStats.totals.total, color: "text-[#9E1B34]", feedbackType: null as null, hint: null, hoverBorder: "", activeBorder: "" },
                        ].map((item) =>
                          item.feedbackType ? (
                            <button
                              key={item.label}
                              type="button"
                              onClick={() => {
                                setFeedbackFilter(item.feedbackType)
                                navigateTo("history")
                              }}
                              className={`group rounded-lg border px-6 py-5 text-left transition ${item.hoverBorder} border-white/7 bg-ad-raised`}
                            >
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">{item.label}</p>
                              <p className={`mt-1 text-2xl font-bold ${item.color}`}>{item.value}</p>
                              {feedbackStats.totals.total > 0 && (
                                <p className="mt-0.5 text-xs text-ad-dim">
                                  {Math.round((item.value / feedbackStats.totals.total) * 100)}%
                                </p>
                              )}
                              <p className="mt-2 text-[10px] font-semibold text-ad-muted opacity-0 transition group-hover:opacity-100">
                                {item.hint}
                              </p>
                            </button>
                          ) : (
                            <div key={item.label} className="rounded-lg border border-white/7 bg-ad-raised px-6 py-5">
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">{item.label}</p>
                              <p className={`mt-1 text-2xl font-bold ${item.color}`}>{item.value}</p>
                              {feedbackStats.totals.total > 0 && (
                                <p className="mt-0.5 text-xs text-ad-dim">
                                  {Math.round((item.value / feedbackStats.totals.total) * 100)}%
                                </p>
                              )}
                            </div>
                          )
                        )}
                      </div>

                      {feedbackStats.totals.total > 0 && (
                        <div className="mb-5 h-3 w-full overflow-hidden rounded-full bg-white/8">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${Math.round((feedbackStats.totals.helpful / feedbackStats.totals.total) * 100)}%` }}
                          />
                        </div>
                      )}

                      {feedbackStats.recent.length > 0 && (
                        <>
                          <p ref={notHelpfulSectionRef} className="mb-5 scroll-mt-8 text-[10px] font-bold uppercase tracking-[0.18em] text-ad-dim">
                            Recent Not-Helpful Responses
                          </p>
                          <div className="space-y-4">
                            {feedbackStats.recent.map((item) => (
                              <div key={item.id} className="rounded-lg border border-ad-danger/20 bg-ad-danger/10 px-6 py-5">
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-red-400">
                                    {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                  </p>
                                  {item.reason && (
                                    <span className="rounded-full border border-red-200/60 bg-red-100/50 px-2 py-0.5 text-[10px] font-semibold capitalize text-red-500">
                                      {item.reason.replace(/-/g, " ")}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs font-semibold text-ad-muted">Q: {item.question}</p>
                                <p className="mt-1 line-clamp-2 text-xs text-[#787878]">A: {item.answer}</p>
                                {item.comment && (
                                  <div className="mt-2 rounded-lg border border-red-200/40 bg-white/40 px-3 py-2">
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-red-400">User comment</p>
                                    <p className="mt-0.5 text-xs text-ad-muted">{item.comment}</p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {feedbackStats.totals.total === 0 && (
                        <p className="py-6 text-center text-sm text-ad-dim">No feedback submitted yet.</p>
                      )}
                    </>
                  ) : (
                    <p className="py-6 text-center text-sm text-ad-dim">Loading feedback data...</p>
                  )}
                </section>
              </div>
            ) : isHistoryView ? (
              <div className="space-y-5">
                  {chatHistory.length === 0 ? (
                    <div className="rounded-lg border border-white/7 bg-ad-surface py-16 text-center text-sm text-ad-dim">
                      No chat history yet.
                    </div>
                  ) : (
                  <div className="grid min-h-180 overflow-hidden rounded-lg border border-white/7 bg-ad-surface shadow-sm lg:grid-cols-[420px_minmax(0,1fr)] 2xl:grid-cols-[480px_minmax(0,1fr)]">
                  <aside className="border-b border-white/7 bg-ad-raised lg:border-b-0 lg:border-r">
                    <div className="border-b border-white/7 px-6 py-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ad-dim">
                            Inbox Chats
                          </p>
                          <h3 className="mt-1 text-lg font-bold text-ad-text">{filteredHistoryConversations.length} conversations</h3>
                        </div>
                        <span className="rounded-lg border border-white/10 bg-ad-raised px-2.5 py-1 text-xs font-bold text-ad-muted">
                          {filteredQuestionsCount} questions
                        </span>
                      </div>
                      <div className="relative mt-4">
                        {(activeTopicFilter || activeDateFilter || feedbackFilter) && (
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            {activeTopicFilter && (
                              <span className="flex items-center gap-1.5 rounded-full border border-ad-accent2/40 bg-ad-accent2/15 px-3 py-1 text-xs font-semibold text-ad-accent2">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                                  <path d="M3.75 2a.75.75 0 0 0-.75.75v.423a3.001 3.001 0 0 0 .345 5.535L4.5 10.5V13a.75.75 0 0 0 1.5 0v-2.5L7.155 8.708A3.001 3.001 0 0 0 7.5 3.173V2.75A.75.75 0 0 0 6.75 2h-3Z" />
                                  <path d="M9.25 2a.75.75 0 0 0-.75.75v.423a3.001 3.001 0 0 0 .345 5.535L10 10.5V13a.75.75 0 0 0 1.5 0v-2.5l1.155-1.792A3.001 3.001 0 0 0 13 3.173V2.75a.75.75 0 0 0-.75-.75h-3Z" />
                                </svg>
                                Topic: {activeTopicFilter.label}
                                <button type="button" onClick={() => setActiveTopicFilter(null)} className="ml-1 opacity-60 hover:opacity-100">×</button>
                              </span>
                            )}
                            {activeDateFilter && (
                              <span className="flex items-center gap-1.5 rounded-full border border-blue-500/40 bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-300">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                                  <path fillRule="evenodd" d="M4 1.75a.75.75 0 0 1 1.5 0V3h5V1.75a.75.75 0 0 1 1.5 0V3h.25A2.75 2.75 0 0 1 15 5.75v7.5A2.75 2.75 0 0 1 12.25 16H3.75A2.75 2.75 0 0 1 1 13.25v-7.5A2.75 2.75 0 0 1 3.75 3H4V1.75ZM3.75 4.5c-.69 0-1.25.56-1.25 1.25v1h11v-1c0-.69-.56-1.25-1.25-1.25H3.75ZM2.5 8.25v5c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25v-5h-11Z" clipRule="evenodd" />
                                </svg>
                                {new Date(activeDateFilter + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                <button type="button" onClick={() => setActiveDateFilter(null)} className="ml-1 opacity-60 hover:opacity-100">×</button>
                              </span>
                            )}
                            {feedbackFilter && (
                              <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${feedbackFilter === "helpful" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400" : "border-ad-danger/40 bg-ad-danger/15 text-red-400"}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                                  <path d="M2 10.5a1.5 1.5 0 1 1 3 0v3.5a1.5 1.5 0 0 1-3 0v-3.5Zm5.5-8.5a1.5 1.5 0 0 1 3 0V13a1.5 1.5 0 0 1-3 0V2Zm5.5 5a1.5 1.5 0 1 1 3 0v6a1.5 1.5 0 0 1-3 0V7Z" />
                                </svg>
                                Feedback: {feedbackFilter === "helpful" ? "Helpful" : "Not Helpful"}
                                <button type="button" onClick={() => setFeedbackFilter(null)} className="ml-1 opacity-60 hover:opacity-100">×</button>
                              </span>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-3">
                          <label className="min-w-0 flex-1">
                            <span className="sr-only">Search conversations</span>
                            <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-ad-raised px-3 py-3">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-ad-dim">
                                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.473 9.765l2.631 2.631a.75.75 0 1 0 1.061-1.06l-2.631-2.632A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0A4 4 0 0 1 5 9Z" clipRule="evenodd" />
                              </svg>
                              <input
                                value={historySearch}
                                onChange={(event) => setHistorySearch(event.target.value)}
                                placeholder="Search conversations"
                                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#c4c4c4] outline-none placeholder:text-ad-dim"
                              />
                            </div>
                          </label>
                          <button
                            type="button"
                            onClick={() => setHistoryFiltersOpen((open) => !open)}
                            aria-expanded={historyFiltersOpen}
                            className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border text-ad-muted shadow-sm transition ${
                              historyFiltersOpen
                                ? "border-[#9E1B34] bg-[#9E1B34] text-white"
                                : "border-white/10 bg-ad-raised hover:bg-white/8"
                            }`}
                          >
                            <span className="sr-only">Open chat history filters</span>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                              <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 0 1 .628.74v2.288a2.25 2.25 0 0 1-.659 1.591l-4.682 4.683a2.25 2.25 0 0 0-.659 1.59v3.037a2.25 2.25 0 0 1-1.244 2.013l-2 1A.75.75 0 0 1 7.5 17.87v-5.378a2.25 2.25 0 0 0-.659-1.591L2.159 6.22A2.25 2.25 0 0 1 1.5 4.629V2.34a.75.75 0 0 1 .628-.74Z" clipRule="evenodd" />
                            </svg>
                            {activeHistoryFilterCount > 0 && (
                              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-ad-accent2 px-1 text-[10px] font-bold text-white">
                                {activeHistoryFilterCount}
                              </span>
                            )}
                          </button>
                        </div>

                        {historyFiltersOpen && (
                          <div className="absolute right-0 top-14 z-20 w-full rounded-lg border border-white/7 bg-ad-surface p-4 shadow-xl sm:w-90">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ad-dim">Filters</p>
                              <button
                                type="button"
                                onClick={() => {
                                  setConfidenceFilter("all")
                                  setTypeFilter("all")
                                  setHistoryGroupBy("day")
                                  setHistorySearch("")
                                  setFeedbackFilter(null)
                                }}
                                className="rounded-md border border-white/7 bg-ad-raised px-3 py-1.5 text-xs font-semibold text-[#787878] transition hover:bg-white/8"
                              >
                                Reset
                              </button>
                            </div>

                            <div className="space-y-4">
                              <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">Confidence</p>
                                <div className="flex flex-wrap gap-2">
                                  {([
                                    { id: "all", label: "All", count: historyCounts.all },
                                    { id: "high", label: "High", count: historyCounts.high },
                                    { id: "low", label: "Low", count: historyCounts.low },
                                  ] as const).map((option) => (
                                    <button
                                      key={option.id}
                                      type="button"
                                      onClick={() => setConfidenceFilter(option.id)}
                                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                        confidenceFilter === option.id
                                          ? "border-[#9E1B34] bg-[#9E1B34] text-white"
                                          : "border-white/7 bg-ad-surface text-ad-muted hover:bg-ad-raised"
                                      }`}
                                    >
                                      {option.label}
                                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${confidenceFilter === option.id ? "bg-white/20 text-white" : "bg-white/8 text-[#787878]"}`}>
                                        {option.count}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ad-dim">Group</p>
                                <div className="inline-flex items-center gap-1 rounded-lg border border-white/7 bg-ad-raised p-0.5">
                                  {(["day", "month"] as const).map((option) => (
                                    <button
                                      key={option}
                                      type="button"
                                      onClick={() => setHistoryGroupBy(option)}
                                      className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                                        historyGroupBy === option
                                          ? "bg-slate-900 text-white shadow-sm"
                                          : "text-[#787878] hover:text-[#e0e0e0]"
                                      }`}
                                    >
                                      {option}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="max-h-140 overflow-y-auto px-5 py-5 lg:max-h-157.5">
                      {filteredHistoryConversations.length === 0 && (
                        <div className="rounded-lg border border-dashed border-white/7 bg-ad-surface px-5 py-8 text-center text-sm text-ad-dim">
                          No conversations match these filters.
                        </div>
                      )}
                      {groupedHistoryConversations.map((group) => (
                        <div key={group.label} className="mb-5">
                          <div className="mb-3 inline-flex items-center gap-2 rounded-lg bg-ad-raised px-3 py-2 text-xs font-bold text-ad-muted">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                              <path fillRule="evenodd" d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z" clipRule="evenodd" />
                            </svg>
                            {group.label}
                          </div>
                          <div className="space-y-3">
                            {group.conversations.map((conversation) => {
                              const selected = selectedHistoryConversation?.conversationId === conversation.conversationId
                              return (
                                <div key={conversation.conversationId} className="group/conv relative">
                                <button
                                  type="button"
                                  onClick={() => setSelectedHistoryConversationId(conversation.conversationId)}
                                  className={`block w-full rounded-lg px-5 py-5 text-left transition ${
                                    selected ? "bg-ad-surface shadow-sm ring-2 ring-[#9E1B34]/30" : "hover:bg-white/5"
                                  } ${conversation.hasLiveSupport ? "border-l-[3px] border-l-blue-600 pl-4" : ""}`}
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[11px] font-bold text-[#787878]">{formatListTimestamp(conversation.latestAt)}</p>
                                      <div className="mt-1 flex items-center gap-2">
                                        <p className="line-clamp-1 text-sm font-semibold text-[#e0e0e0]">
                                          {conversation.title}
                                        </p>
                                        {conversation.hasLiveSupport && (
                                          <span className="shrink-0 rounded-full border border-blue-700/40 bg-blue-900/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-300">
                                            ESCALATED
                                          </span>
                                        )}
                                      </div>
                                      <p className="mt-1 line-clamp-1 text-xs leading-6 text-[#787878]">
                                        {conversation.preview}
                                      </p>
                                      {conversation.hasLiveSupport && (
                                        <div className="mt-2 flex items-center gap-2">
                                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-blue-400">
                                            <path fillRule="evenodd" d="M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0Zm-6-3.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM7.25 6.5a.75.75 0 0 0 0 1.5h.25V10a.75.75 0 0 0 1.5 0V7.25A.75.75 0 0 0 8.25 6.5h-1Z" clipRule="evenodd" />
                                          </svg>
                                          <span className="text-[10px] font-semibold text-blue-300">
                                            Advisor: {conversation.agentNames.join(", ")}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-2">
                                      <span className="rounded-full bg-white/8 px-2 py-1 text-[10px] font-bold text-ad-muted">
                                        {conversation.total} Q
                                      </span>
                                      {conversation.lowCount > 0 ? (
                                        <span className="rounded-full bg-ad-warn/15 px-2 py-1 text-[10px] font-bold text-ad-warn">
                                          Low confidence
                                        </span>
                                      ) : conversation.highCount > 0 ? (
                                        <span className="rounded-full bg-emerald-900/20 px-2 py-1 text-[10px] font-bold text-emerald-300">
                                          High confidence
                                        </span>
                                      ) : null}
                                      {selected && (
                                        <span className="rounded-full bg-[#9E1B34]/10 px-2 py-1 text-[10px] font-bold text-[#9E1B34]">
                                          Open
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </button>
                                <div className="hidden border-t border-white/5 group-hover/conv:flex">
                                  <button
                                    type="button"
                                    onClick={() => deleteConversation(conversation.conversationId)}
                                    disabled={deletingConvId === conversation.conversationId}
                                    className="flex w-full items-center justify-center gap-1.5 rounded-b-lg px-4 py-2 text-[11px] font-medium text-ad-muted transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                                      <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.712Z" clipRule="evenodd" />
                                    </svg>
                                    {deletingConvId === conversation.conversationId ? "Moving…" : "Move to trash"}
                                  </button>
                                </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </aside>

                  <section className="min-h-180 bg-ad-surface">
                    {selectedHistoryConversation ? (
                      <div className="flex h-full flex-col">
                        <div className="border-b border-white/7 px-6 py-6 md:px-10 md:py-8">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ad-accent2/70">
                                Selected Chat
                              </p>
                              <h3 className="mt-1 line-clamp-2 text-xl font-bold text-ad-text">
                                {selectedHistoryConversation.title}
                              </h3>
                              <p className="mt-1 text-sm text-[#787878]">
                                Last message {formatDate(selectedHistoryConversation.latestAt)}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="rounded-full border border-white/7 bg-ad-raised px-3 py-1 text-xs font-bold text-ad-muted">
                                {selectedHistoryConversation.total} questions
                              </span>
                              {selectedHistoryConversation.lowCount > 0 ? (
                                <span className="rounded-full border border-ad-warn/30 bg-ad-warn/15 px-3 py-1 text-xs font-bold text-ad-warn">
                                  Low confidence
                                </span>
                              ) : selectedHistoryConversation.highCount > 0 ? (
                                <span className="rounded-full border border-emerald-700/40 bg-emerald-900/20 px-3 py-1 text-xs font-bold text-emerald-300">
                                  High confidence
                                </span>
                              ) : null}
                              {selectedHistoryConversation.hasLiveSupport && (
                                <span className="rounded-full border border-blue-700/40 bg-blue-900/20 px-3 py-1 text-xs font-bold text-blue-300">
                                  Advisor: {selectedHistoryConversation.agentNames.join(", ")}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6 md:px-10 md:py-8">
                          {selectedHistoryConversation.entries.map((entry) => (
                            <div key={entry.id} className="space-y-4">
                              <div className="flex justify-end">
                                <div className="max-w-[86%] rounded-lg bg-[#9E1B34] px-6 py-5 text-white shadow-sm md:max-w-[76%]">
                                  <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
                                    User - {formatDate(entry.questionAt)}
                                  </div>
                                  <p className="whitespace-pre-wrap text-sm leading-7">{entry.question}</p>
                                </div>
                              </div>

                              <div className="flex justify-start">
                                <div className="max-w-[86%] rounded-lg border border-white/7 bg-ad-raised px-6 py-5 shadow-sm md:max-w-[76%]">
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#787878]">
                                      Chatbot - {entry.answerAt ? formatDate(entry.answerAt) : "No response saved"}
                                    </span>
                                    {entry.confidence !== null ? (
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                          entry.confidence === "high"
                                            ? "bg-emerald-900/30 text-emerald-300"
                                            : "bg-ad-warn/20 text-ad-warn"
                                        }`}
                                      >
                                        {entry.confidence === "high" ? "High confidence" : "Low confidence"}
                                      </span>
                                    ) : (
                                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-white/8 text-[#787878]">
                                        Greeting
                                      </span>
                                    )}
                                    {entry.confidenceScore !== null && (
                                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-ad-muted">
                                        {entry.confidenceScore}%
                                      </span>
                                    )}
                                  </div>
                                  <p className="whitespace-pre-wrap text-sm leading-7 text-[#e0e0e0]">
                                    {entry.answer || "No chatbot response was saved for this question."}
                                  </p>
                                  {entry.sources.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {entry.sources.map((source) => (
                                        <span key={source} className="rounded-full border border-white/7 bg-ad-surface px-2.5 py-1 text-[11px] font-semibold text-[#787878]">
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
                            <div className="mt-2 space-y-4">
                              <div className="flex items-center gap-3">
                                <div className="h-px flex-1 bg-white/10" />
                                <span className="rounded-full border border-blue-700/40 bg-blue-900/20 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-300">
                                  Live Support Session
                                </span>
                                <div className="h-px flex-1 bg-white/10" />
                              </div>
                              {historyAgentReplies[selectedHistoryConversation.conversationId].map((reply) => (
                                <div key={reply.id} className="flex justify-start">
                                  <div className="max-w-[86%] rounded-lg border border-blue-700/40 bg-blue-900/20 px-6 py-5 shadow-sm md:max-w-[76%]">
                                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-400">
                                      {reply.agentName} &mdash; {formatDate(reply.createdAt)}
                                    </div>
                                    <p className="whitespace-pre-wrap text-sm leading-7 text-[#e0e0e0]">{reply.content}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full min-h-160 items-center justify-center text-center text-ad-dim">
                        <div>
                          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-white/7 bg-ad-raised">
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
                  )}
              </div>
            ) : isTrashView ? null : visibleRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-white/7 bg-ad-surface py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/8">
                  {isTrashView ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-7 w-7 text-ad-dim">
                      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-7 w-7 text-ad-dim">
                      <path fillRule="evenodd" d="M1 11.27c0-.246.033-.492.099-.73l1.523-5.521A2.75 2.75 0 0 1 5.273 3h9.454a2.75 2.75 0 0 1 2.651 2.019l1.523 5.52c.066.239.099.485.099.732V15a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-3.73Zm3.068-5.852A1.25 1.25 0 0 1 5.273 4.5h9.454a1.25 1.25 0 0 1 1.205.918l1.523 5.52c.006.02.01.041.015.062H14a1 1 0 0 0-.86.49l-.606 1.02a1 1 0 0 1-.86.49H8.326a1 1 0 0 1-.86-.49l-.606-1.02A1 1 0 0 0 6 11H2.53l.015-.062 1.523-5.52Z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <p className="mt-4 text-base font-semibold text-[#c4c4c4]">
                  {isTrashView ? "Trash is empty" : "All caught up"}
                </p>
                <p className="mt-1 text-sm text-ad-dim">
                  {isTrashView
                    ? "No deleted support requests to show."
                    : filter === "all"
                      ? "No support requests yet."
                      : `No ${filter} support requests right now.`}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
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
                      className={`rounded-lg border bg-ad-surface p-6 shadow-sm transition-all ${
                        isLive && expanded ? "border-[#9E1B34]/30 ring-1 ring-[#9E1B34]/15" : "border-white/7"
                      }`}
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        <span
                          className={`rounded-full border px-3 py-1.5 text-xs font-bold ${STATUS_STYLES[request.status]}`}
                        >
                          {isTrashView ? `Deleted ${label}` : label}
                        </span>
                        {isLive && (
                          <span className="flex items-center gap-2 rounded-full border border-emerald-700/40 bg-emerald-900/20 px-3 py-1.5 text-xs font-bold text-emerald-300">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                            LIVE
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-wider text-ad-dim">
                            Requested {formatDate(request.createdAt)}
                          </p>
                          {request.assignedAgentName && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-blue-300">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                                <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12.735 14c.618 0 1.093-.561.872-1.139a6.002 6.002 0 0 0-11.215 0c-.22.578.254 1.139.872 1.139h9.47Z" />
                              </svg>
                              Handled by: {request.assignedAgentName}
                            </p>
                          )}
                          {isTrashView && (
                            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-red-500">
                              Deleted {formatDate(request.deletedAt ?? request.updatedAt)}
                            </p>
                          )}
                          <h2 className="mt-1 line-clamp-2 text-base font-semibold text-ad-text">
                            {request.latestQuestion}
                          </h2>
                          {!expanded && (
                            <p className="mt-3 rounded-lg border border-white/7 bg-ad-raised px-4 py-3 text-sm leading-6 text-ad-muted">
                              <span className="font-semibold text-[#e0e0e0]">Escalation reason:</span>{" "}
                              {request.chatbotNote}
                            </p>
                          )}

                          {/* Live draft preview on collapsed card */}
                          {isLive && !expanded && typingStatuses[request.id] && (
                            <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-700/40 bg-emerald-900/20 px-4 py-3">
                              <span className="flex shrink-0 items-center gap-1 pt-0.5">
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.3s]" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.15s]" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500" />
                              </span>
                              {studentDrafts[request.id] ? (
                                <p className="min-w-0 text-sm italic text-emerald-300">
                                  &ldquo;{studentDrafts[request.id]}&rdquo;
                                </p>
                              ) : (
                                <p className="text-sm text-emerald-300">Student is typing…</p>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(request.id)}
                          className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-ad-muted transition hover:bg-ad-raised"
                        >
                          {expanded ? "Collapse" : "Expand"}
                        </button>
                      </div>

                      {expanded && (
                        <div className="mt-6 border-t border-white/7 pt-6">
                          <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
                            {/* ── Left: transcript ─────────────────────── */}
                            <div className="flex min-w-0 flex-col">
                              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#787878]">
                                    Live Chat
                                  </p>
                                  <p className="mt-1 text-xs text-ad-dim">
                                    {preHistory.length > 0 ? `${preHistory.length} messages before escalation, ` : ""}
                                    {liveMessages.length} live message{liveMessages.length !== 1 ? "s" : ""}
                                  </p>
                                </div>
                                <span className="rounded-full border border-white/7 bg-ad-surface px-4 py-2 text-xs font-semibold text-[#787878]">
                                  {timeline.length} total
                                </span>
                              </div>

                              <div
                                ref={(el) => { transcriptContainerRefs.current[request.id] = el }}
                                className="max-h-155 min-h-40 overflow-y-auto rounded-lg border border-white/7 bg-ad-raised p-4"
                              >
                            {timeline.length === 0 ? (
                              <p className="px-3 py-6 text-center text-sm text-ad-dim">
                                No conversation history was saved for this request.
                              </p>
                            ) : (
                              <div className="space-y-3">
                                {preHistory.length > 0 && (
                                  <>
                                    {preHistory.map((message) => (
                                      <div
                                        key={message.id}
                                        className={`rounded-lg border px-4 py-3 opacity-70 ${
                                          message.role === "USER"
                                            ? "border-white/5 bg-ad-accent/10"
                                            : "border-white/7 bg-ad-surface"
                                        }`}
                                      >
                                        <div className="mb-1 flex items-center justify-between gap-3">
                                          <span className="text-[10px] font-bold uppercase tracking-widest text-ad-dim">
                                            {message.role === "USER" ? "Student" : "Chatbot"}
                                          </span>
                                          <span className="text-[10px] text-ad-dim">{formatDate(message.createdAt)}</span>
                                        </div>
                                        <p className="whitespace-pre-wrap text-sm leading-6 text-ad-muted">{message.content}</p>
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
                                  <p className="py-4 text-center text-sm text-ad-dim">
                                    Waiting for the student to send a message...
                                  </p>
                                ) : (
                                  liveMessages.map((message) => (
                                    <div
                                      key={message.id}
                                      className={`rounded-lg border px-4 py-3 ${
                                        message.role === "USER"
                                          ? "border-white/5 bg-ad-accent/10"
                                          : message.role === "ADMIN"
                                            ? "border-blue-700/40 bg-blue-900/20"
                                            : "border-white/7 bg-ad-surface"
                                      }`}
                                    >
                                      <div className="mb-1 flex items-center justify-between gap-3">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-[#787878]">
                                          {message.role === "USER" ? "Student" : message.role === "ADMIN" ? "Advisor" : "Chatbot"}
                                        </span>
                                        <span className="text-[10px] text-ad-dim">{formatDate(message.createdAt)}</span>
                                      </div>
                                      <p className="whitespace-pre-wrap text-sm leading-6 text-[#e0e0e0]">{message.content}</p>
                                    </div>
                                  ))
                                )}

                                {/* Typing indicator — inline at the bottom of the thread */}
                                {label === "Pending" && typingStatuses[request.id] && (
                                  <div className="flex items-start gap-2 rounded-lg border border-emerald-700/40 bg-emerald-900/20 px-4 py-3">
                                    <span className="flex shrink-0 items-center gap-1 pt-1">
                                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.3s]" />
                                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.15s]" />
                                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500" />
                                    </span>
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Student is typing…</p>
                                      {studentDrafts[request.id] && (
                                        <p className="mt-0.5 wrap-break-word text-sm italic text-emerald-300">
                                          &ldquo;{studentDrafts[request.id]}&rdquo;
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}

                              </div>
                            )}
                              </div>{/* end transcript scroll */}
                            </div>{/* end left column */}

                            {/* ── Right: reply panel ───────────────────── */}
                            {!isTrashView && (
                              <div
                                ref={(el) => { replyPanelRefs.current[request.id] = el }}
                                className="flex flex-col gap-4 rounded-lg border border-white/7 bg-ad-raised p-5 xl:sticky xl:top-24 xl:self-start"
                              >
                                {label === "Pending" && (
                                  <div>
                                    <div className="mb-2.5 flex items-center justify-between gap-2">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-ad-dim">
                                        Suggested Replies
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => fetchSuggestedReplies(request.id)}
                                        disabled={suggestingId === request.id}
                                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-[#9E1B34] transition hover:bg-white/5 disabled:opacity-50"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                                          <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466.75.75 0 0 0-1.061 1.061 7 7 0 0 0 11.856-3.061.75.75 0 0 0-1.594-.466ZM4.688 8.576a5.5 5.5 0 0 1 9.201-2.466.75.75 0 1 0 1.061-1.061A7 7 0 0 0 3.094 8.11a.75.75 0 0 0 1.594.466Z" clipRule="evenodd" />
                                        </svg>
                                        {suggestingId === request.id ? "Generating…" : "Regenerate"}
                                      </button>
                                    </div>

                                    {suggestingId === request.id && !suggestedReplies[request.id] ? (
                                      <div className="flex items-center gap-2 rounded-lg border border-white/7 bg-ad-raised px-4 py-3 text-xs text-ad-dim">
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
                                            className="block w-full rounded-lg border border-white/7 bg-ad-surface px-3 py-2.5 text-left text-sm leading-6 text-[#c4c4c4] transition hover:border-[#9E1B34]/30 hover:bg-white/5"
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

                                <div>
                                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#787878]">
                                    Reply to user
                                  </label>
                                  <textarea
                                    value={replies[request.id] ?? ""}
                                    onChange={(event) => handleReplyChange(request.id, event.target.value)}
                                    onFocus={() => {
                                      const y = window.scrollY
                                      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }))
                                    }}
                                    rows={5}
                                    placeholder="Type your reply or click a suggestion above…"
                                    className="w-full resize-none rounded-lg border border-white/10 bg-ad-raised px-3 py-2.5 text-sm text-ad-text outline-none placeholder:text-ad-dim transition focus:border-ad-accent2/50 focus:ring-2 focus:ring-ad-accent2/10"
                                  />
                                </div>

                                <div className="flex flex-wrap justify-end gap-2">
                                  {(label === "Pending" || label === "Answered") && (
                                    <button
                                      type="button"
                                      onClick={() => deleteRequest(request.id, label)}
                                      disabled={deletingId === request.id}
                                      className="rounded-lg border border-ad-danger/30 bg-ad-danger/10 px-4 py-2.5 text-sm font-semibold text-ad-danger transition hover:bg-ad-danger/20 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {deletingId === request.id ? "Deleting..." : "Delete"}
                                    </button>
                                  )}
                                  {label === "Pending" && (
                                    <button
                                      type="button"
                                      onClick={() => markDone(request.id)}
                                      disabled={completingId === request.id}
                                      className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-50"
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
                                    className="rounded-lg bg-ad-accent2 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ad-accent disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {sendingId === request.id ? "Sending..." : "Send Reply"}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>{/* end grid */}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}

            {!isHistoryView && !isAnalyticsView && !isTrashView && !isOverviewView && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-ad-bg/75 backdrop-blur-[2px]">
                <div className="flex flex-col items-center gap-3 rounded-xl border border-white/7 bg-ad-surface px-10 py-8 shadow-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-8 w-8 text-[#3e3e3e]">
                    <path fillRule="evenodd" d="M2 5.75A2.75 2.75 0 0 1 4.75 3h10.5A2.75 2.75 0 0 1 18 5.75v8.5A2.75 2.75 0 0 1 15.25 17H4.75A2.75 2.75 0 0 1 2 14.25v-8.5Zm2.75-1.25c-.69 0-1.25.56-1.25 1.25v1h13v-1c0-.69-.56-1.25-1.25-1.25H4.75Zm11.75 3.75h-13v6c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6Z" clipRule="evenodd" />
                  </svg>
                  <p className="text-base font-bold text-ad-dim">Live Support</p>
                  <p className="text-xs text-ad-dim">Coming soon</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

export default function AdminConsolePage() {
  return (
    <Suspense>
      <AdminConsolePageInner />
    </Suspense>
  )
}
