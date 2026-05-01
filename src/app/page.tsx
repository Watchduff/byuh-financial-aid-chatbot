"use client"

import { useEffect, useRef, useState } from "react"
import { useChat, type UIMessage } from "@/lib/useChat"
import Sidebar from "@/components/Sidebar"
import IntroScreen from "@/components/IntroScreen"
import ChatWindow from "@/components/ChatWindow"
import ChatInput from "@/components/ChatInput"
import { FINANCIAL_AID_CONTACT, getSupportAvailability } from "@/lib/supportHours"
import {
  DEFAULT_LANGUAGE_CODE,
  SUPPORTED_LANGUAGES,
  detectSupportedLanguage,
  getSupportedLanguage,
} from "@/lib/languages"
import { DEFAULT_UI_TEXT, type UIText } from "@/lib/uiText"

const HANDOFF_NOTICE =
  "Thanks — your request has been sent to the BYU–Hawaii Financial Aid team. An advisor will join when available. Please stay on this chat while you wait."
const SUPPORT_COMPLETE_NOTICE =
  "This live support conversation has been marked complete. You can continue asking financial aid questions or start a new support request if needed."
const SUPPORT_CLOSED_NOTICE =
  "This live support request was closed. You can start a new live support request if you still need help."
const OUTSIDE_HOURS_NOTICE =
  `Live support is currently outside Financial Aid office hours. The chatbot is still available for general BYU–Hawaii Financial Aid questions. For account-specific help, contact ${FINANCIAL_AID_CONTACT.email} or ${FINANCIAL_AID_CONTACT.office} during office hours.`

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Conversation = {
  id: string
  title: string
  savedMessages: UIMessage[]
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Page() {
  const [viewMode, setViewMode] = useState<"intro" | "chat">("intro")
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [supportRequestId, setSupportRequestId] = useState<string | null>(null)
  const [seenAgentMessageIds, setSeenAgentMessageIds] = useState<Set<string>>(new Set())
  const [completedSupportRequestIds, setCompletedSupportRequestIds] = useState<Set<string>>(new Set())
  const [adminTyping, setAdminTyping] = useState(false)
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE_CODE)
  const [uiText, setUiText] = useState<UIText>(DEFAULT_UI_TEXT)

  const activeConvIdRef = useRef<string | null>(null)
  const messagesRef = useRef<UIMessage[]>([])
  const seenAgentMessageIdsRef = useRef<Set<string>>(new Set())
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const studentTypingRef = useRef(false)
  const studentTypingOffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { messages, sendMessage, setMessages, status, stop, error } = useChat({
    api: "/api/chat",
    languageCode,
  })

  const isLoading = status === "streaming" || status === "submitted"
  const supportAvailability = getSupportAvailability()
  const selectedLanguage = getSupportedLanguage(languageCode)
  const liveSupportStatusLabel =
    supportRequestId && seenAgentMessageIds.size > 0 ? "Connected" : "Waiting for advisor"

  useEffect(() => { activeConvIdRef.current = activeConversationId })
  useEffect(() => { messagesRef.current = messages })
  useEffect(() => { seenAgentMessageIdsRef.current = seenAgentMessageIds }, [seenAgentMessageIds])

  useEffect(() => {
    const savedLanguageCode = window.localStorage.getItem("byuh-chat-language")
    if (savedLanguageCode) {
      setLanguageCode(getSupportedLanguage(savedLanguageCode).code)
      return
    }

    setLanguageCode(detectSupportedLanguage(navigator.languages).code)
  }, [])

  useEffect(() => {
    let cancelled = false
    const cacheKey = `byuh-chat-ui-text-${languageCode}`

    if (languageCode === DEFAULT_LANGUAGE_CODE) {
      setUiText(DEFAULT_UI_TEXT)
      return
    }

    const cached = window.localStorage.getItem(cacheKey)
    if (cached) {
      try {
        setUiText({ ...DEFAULT_UI_TEXT, ...JSON.parse(cached) })
      } catch {
        window.localStorage.removeItem(cacheKey)
      }
    } else {
      setUiText(DEFAULT_UI_TEXT)
    }

    async function loadUiText() {
      try {
        const res = await fetch(`/api/ui-text?languageCode=${encodeURIComponent(languageCode)}`)
        if (!res.ok) return
        const data = await res.json()
        const nextUiText = { ...DEFAULT_UI_TEXT, ...(data.uiText ?? {}) }
        if (cancelled) return
        setUiText(nextUiText)
        window.localStorage.setItem(cacheKey, JSON.stringify(nextUiText))
      } catch {
        // Keep English UI labels if translation is unavailable.
      }
    }

    void loadUiText()
    return () => {
      cancelled = true
    }
  }, [languageCode])

  useEffect(() => {
    if (!supportRequestId) {
      setAdminTyping(false)
      return
    }

    async function pollTypingStatus() {
      try {
        const res = await fetch(`/api/support/typing?requestId=${supportRequestId}`)
        if (!res.ok) return
        const data = await res.json()
        setAdminTyping(Boolean(data.adminTyping))
      } catch {
        // ignore transient typing status failures
      }
    }

    pollTypingStatus()
    const interval = setInterval(pollTypingStatus, 1500)
    return () => clearInterval(interval)
  }, [supportRequestId])

  // ---------------------------------------------------------------------------
  // Agent message polling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!supportRequestId) return
    const activeSupportRequestId = supportRequestId

    async function pollAgentMessages() {
      try {
        const res = await fetch(`/api/support/messages?requestId=${supportRequestId}`)
        if (!res.ok) return
        const data = await res.json()
        const incoming: Array<{ id: string; agentName: string; content: string }> =
          data.messages ?? []
        const requestStatus = data.supportRequest?.status as string | undefined

        const alreadySeen = seenAgentMessageIdsRef.current
        const newOnes = incoming.filter((m) => !alreadySeen.has(m.id))
        const nextMessages: UIMessage[] = newOnes.map((m) => ({
          id: m.id,
          role: "agent",
          content: m.content,
          agentName: m.agentName,
        }))

        const terminalNotice =
          requestStatus === "answered"
            ? SUPPORT_COMPLETE_NOTICE
            : requestStatus === "deleted"
              ? SUPPORT_CLOSED_NOTICE
              : null

        if (terminalNotice && !completedSupportRequestIds.has(activeSupportRequestId)) {
          nextMessages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            mode: "handoff",
            content: terminalNotice,
            sources: [],
          })
          setCompletedSupportRequestIds((prev) => new Set(prev).add(activeSupportRequestId))
          setSupportRequestId(null)
          setAdminTyping(false)
        }

        if (nextMessages.length === 0) return

        setMessages((prev) => {
          const existingIds = new Set(prev.map((message) => message.id))
          const uniqueNextMessages = nextMessages.filter((message) => !existingIds.has(message.id))
          return uniqueNextMessages.length > 0 ? [...prev, ...uniqueNextMessages] : prev
        })
        setSeenAgentMessageIds((prev) => {
          const next = new Set(prev)
          newOnes.forEach((m) => next.add(m.id))
          seenAgentMessageIdsRef.current = next
          return next
        })
      } catch {
        // silently ignore polling errors
      }
    }

    pollIntervalRef.current = setInterval(pollAgentMessages, 3000)
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [completedSupportRequestIds, supportRequestId, setMessages])

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function saveCurrentMessages() {
    const convId = activeConvIdRef.current
    const currentMessages = messagesRef.current
    if (convId && currentMessages.length > 0) {
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, savedMessages: [...currentMessages] } : c))
      )
    }
  }

  async function ensureServerConversation(id: string, title: string) {
    await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    })
  }

  async function saveChatMessages(conversationId: string, messages: UIMessage[]) {
    if (messages.length === 0) return

    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, messages }),
    }).catch(() => undefined)
  }

  async function updateStudentTyping(isTyping: boolean) {
    if (!supportRequestId) return

    await fetch("/api/support/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: supportRequestId,
        role: "student",
        isTyping,
      }),
    }).catch(() => undefined)
  }

  function handleLanguageChange(nextLanguageCode: string) {
    const language = getSupportedLanguage(nextLanguageCode)
    setLanguageCode(language.code)
    window.localStorage.setItem("byuh-chat-language", language.code)
  }

  function handleInputChange(value: string) {
    setInput(value)

    if (!supportRequestId) return

    if (value.trim() && !studentTypingRef.current) {
      studentTypingRef.current = true
      void updateStudentTyping(true)
    }

    if (studentTypingOffTimerRef.current) {
      clearTimeout(studentTypingOffTimerRef.current)
    }

    studentTypingOffTimerRef.current = setTimeout(() => {
      studentTypingRef.current = false
      void updateStudentTyping(false)
    }, 2500)
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function handleStartFromIntro(question: string) {
    const id = crypto.randomUUID()
    const title = question.length > 50 ? question.slice(0, 47) + "…" : question

    setConversations((prev) => [{ id, title, savedMessages: [] }, ...prev])
    setActiveConversationId(id)
    setViewMode("chat")

    await ensureServerConversation(id, title)
    const result = await sendMessage({ text: question })
    if (result) {
      await saveChatMessages(id, [
        result.userMessage,
        ...(result.assistantMessage ? [result.assistantMessage] : []),
      ])
    }
  }

  async function handleChatSend() {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    setInput("")
    if (studentTypingRef.current) {
      studentTypingRef.current = false
      void updateStudentTyping(false)
    }
    await sendQuestion(trimmed)
  }

  async function sendQuestion(question: string) {
    const trimmed = question.trim()
    if (!trimmed || isLoading) return

    if (supportRequestId) {
      const userMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      }

      setMessages((prev) => [...prev, userMessage])

      await fetch("/api/support/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: supportRequestId,
          content: trimmed,
        }),
      }).catch(() => undefined)

      return
    }

    let conversationId = activeConvIdRef.current
    let conversationTitle = trimmed.length > 50 ? trimmed.slice(0, 47) + "..." : trimmed

    if (!conversationId) {
      const id = crypto.randomUUID()
      conversationId = id
      setConversations((prev) => [{ id, title: conversationTitle, savedMessages: [] }, ...prev])
      setActiveConversationId(id)
      setViewMode("chat")
    } else {
      const activeConversation = conversations.find((c) => c.id === conversationId)
      conversationTitle = activeConversation?.title ?? conversationTitle
    }

    await ensureServerConversation(conversationId, conversationTitle)
    const result = await sendMessage({ text: trimmed })

    if (result) {
      await saveChatMessages(conversationId, [
        result.userMessage,
        ...(result.assistantMessage ? [result.assistantMessage] : []),
      ])
    }
  }
  function handleNewChat() {
    saveCurrentMessages()
    setMessages([])
    setActiveConversationId(null)
    setViewMode("intro")
    setInput("")
    setSupportRequestId(null)
    setAdminTyping(false)
    setSeenAgentMessageIds(new Set())
    seenAgentMessageIdsRef.current = new Set()
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
  }

  function handleSelectConversation(id: string) {
    if (id === activeConvIdRef.current) return

    saveCurrentMessages()

    const conv = conversations.find((c) => c.id === id)
    setMessages(conv?.savedMessages ?? [])
    setActiveConversationId(id)
    setViewMode("chat")
    setInput("")
    setSupportRequestId(null)
    setAdminTyping(false)
    setSeenAgentMessageIds(new Set())
    seenAgentMessageIdsRef.current = new Set()
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
  }

  function handleDeleteConversation(id: string) {
    if (id === activeConvIdRef.current) {
      setMessages([])
      setActiveConversationId(null)
      setViewMode("intro")
      setInput("")
      setSupportRequestId(null)
      setAdminTyping(false)
      setSeenAgentMessageIds(new Set())
      seenAgentMessageIdsRef.current = new Set()
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
    setConversations((prev) => prev.filter((c) => c.id !== id))
  }

  async function handleLiveSupportFromIntro() {
    const id = crypto.randomUUID()
    setConversations((prev) => [{ id, title: "Live Support Request", savedMessages: [] }, ...prev])
    setActiveConversationId(id)
    setViewMode("chat")
    await handleSpeakToHuman(id)
  }

  async function handleSpeakToHuman(forConversationId?: string) {
    const currentMessages = messagesRef.current

    if (supportRequestId) return

    if (!supportAvailability.isAvailable) {
      const closedMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        mode: "handoff",
        content: OUTSIDE_HOURS_NOTICE,
        sources: [],
      }
      setMessages((prev) => [...prev, closedMsg])
      return
    }

    let conversationId = forConversationId ?? activeConvIdRef.current

    if (!conversationId) {
      const newConversationId = crypto.randomUUID()
      conversationId = newConversationId
      setConversations((prev) => [
        { id: newConversationId, title: "Live Support Request", savedMessages: [] },
        ...prev,
      ])
      setActiveConversationId(newConversationId)
      setViewMode("chat")
    }

    try {
      const res = await fetch("/api/support/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          title: activeConversation?.title ?? "Live Support Request",
          messages: currentMessages,
        }),
      })

      if (!res.ok) {
        throw new Error(`Support request failed: ${res.status}`)
      }

      const data = await res.json()
      const requestId = data.supportRequest?.id as string | undefined

      if (requestId) {
        setSupportRequestId(requestId)
      }

      const handoffMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        mode: "handoff",
        content: HANDOFF_NOTICE,
        sources: [],
      }

      setMessages((prev) => [...prev, handoffMsg])
    } catch {
      const unavailableMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        mode: "unavailable",
        content:
          "I could not send your live support request right now. Please contact the BYU–Hawaii Financial Aid Office through financialaid.byuh.edu.",
        sources: [],
      }
      setMessages((prev) => [...prev, unavailableMsg])
    }
  }
  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const activeConversation = conversations.find((c) => c.id === activeConversationId)

  return (
    <main className="h-screen overflow-hidden bg-[#f7f4f2] text-slate-900">
      <div className="flex h-full">
        {/* ── Left sidebar ── */}
        <Sidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onNewChat={handleNewChat}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
          uiText={uiText}
        />

        {/* ── Main content column ── */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Header */}
          <header className="shrink-0 border-b border-[#9e1b34]/20 bg-[#BA0C2F] text-white shadow-md">
            <div className="flex items-center gap-3 px-4 py-3 md:px-6">
              {/* Hamburger — mobile only */}
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
                className="shrink-0 rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white md:hidden"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                </svg>
              </button>

              {/* Logo mark */}
              <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-full bg-white leading-none shadow-sm">
                <span className="text-[9px] font-extrabold text-[#9E1B34]">BYU</span>
                <span className="text-[5.5px] font-bold uppercase tracking-wide text-[#9E1B34]">HAWAII</span>
              </div>

              {/* Title */}
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/60">
                  BYU–Hawaii
                </p>
                <h2 className="truncate text-base font-bold leading-tight md:text-lg">
                  {viewMode === "chat" && activeConversation
                    ? activeConversation.title
                    : uiText.financialAidAssistant}
                </h2>
              </div>

              <label className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-xs font-semibold text-white transition focus-within:bg-white/20">
                <span className="sr-only">{uiText.responseLanguage}</span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                  <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-2.05c.884-.903 1.575-2.258 1.88-3.95H7.37c.305 1.692.996 3.047 1.88 3.95a6.655 6.655 0 0 0 1.5 0ZM7.1 10.5a15.62 15.62 0 0 1 0-1h5.8a15.62 15.62 0 0 1 0 1H7.1Zm.27-2.5h5.26c-.305-1.692-.996-3.047-1.88-3.95a6.655 6.655 0 0 0-1.5 0C8.366 4.953 7.675 6.308 7.37 8Zm6.78 0h1.573a6.52 6.52 0 0 0-2.537-3.03c.43.82.758 1.848.964 3.03Zm1.852 1.5h-1.596a17.265 17.265 0 0 1 0 1h1.596a6.784 6.784 0 0 0 0-1Zm-.279 2.5H14.15c-.206 1.182-.534 2.21-.964 3.03A6.52 6.52 0 0 0 15.723 12ZM6.814 15.03c-.43-.82-.758-1.848-.964-3.03H4.277a6.52 6.52 0 0 0 2.537 3.03ZM3.998 10.5h1.596a17.265 17.265 0 0 1 0-1H3.998a6.783 6.783 0 0 0 0 1ZM4.277 8H5.85c.206-1.182.534-2.21.964-3.03A6.52 6.52 0 0 0 4.277 8Z" clipRule="evenodd" />
                </svg>
                <select
                  value={selectedLanguage.code}
                  onChange={(event) => handleLanguageChange(event.target.value)}
                  className="w-16 border-0 bg-transparent text-xs font-semibold text-white outline-none [color-scheme:dark] sm:w-32"
                  title={uiText.responseLanguage}
                >
                  {SUPPORTED_LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code} className="bg-white text-slate-900">
                      {language.nativeName}
                    </option>
                  ))}
                </select>
              </label>

              {/* Live Support button */}
              {!supportRequestId ? (
                <button
                  type="button"
                  onClick={() => handleSpeakToHuman()}
                  title={supportAvailability.note}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20 active:scale-[0.97]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM1.49 15.326a.78.78 0 0 1-.358-.442 3 3 0 0 1 4.308-3.516 6.484 6.484 0 0 0-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 0 1-2.07-.655ZM16.44 15.98a4.97 4.97 0 0 0 2.07-.654.78.78 0 0 0 .357-.442 3 3 0 0 0-4.308-3.517 6.484 6.484 0 0 1 1.907 3.96 2.32 2.32 0 0 1-.026.654ZM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM5.304 16.19a.844.844 0 0 1-.277-.71 5 5 0 0 1 9.947 0 .843.843 0 0 1-.277.71A6.975 6.975 0 0 1 10 18a6.974 6.974 0 0 1-4.696-1.81Z" />
                  </svg>
                  <span className="hidden sm:inline">
                    {supportAvailability.label === "Live Support Closed" ? uiText.liveSupportClosed : uiText.liveSupport}
                  </span>
                </button>
              ) : (
                <div className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white/70">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                  <span className="hidden sm:inline">
                    {liveSupportStatusLabel === "Connected" ? uiText.connected : uiText.waitingForAdvisor}
                  </span>
                </div>
              )}

            </div>
          </header>

          {/* ── Intro screen ── */}
          {viewMode === "intro" && (
            <IntroScreen
              onStart={handleStartFromIntro}
              onLiveSupport={handleLiveSupportFromIntro}
              liveSupportLabel={supportAvailability.label}
              liveSupportNote={supportAvailability.note}
              uiText={uiText}
            />
          )}

          {/* ── Active conversation ── */}
          {viewMode === "chat" && (
            <>
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden px-6 py-2 md:px-10">
                  <ChatWindow
                    messages={messages}
                    isLoading={isLoading}
                    error={error ?? null}
                    supportRequestId={supportRequestId}
                    adminTyping={adminTyping}
                    onSpeakToHuman={() => handleSpeakToHuman()}
                    onFollowUp={(question) => void sendQuestion(question)}
                    uiText={uiText}
                  />
                </div>
              </div>

              <ChatInput
                value={input}
                onChange={handleInputChange}
                onSubmit={handleChatSend}
                onStop={stop}
                isLoading={isLoading}
                showPrivacyReminder={Boolean(supportRequestId)}
                uiText={uiText}
              />
            </>
          )}
        </section>
      </div>
    </main>
  )
}
