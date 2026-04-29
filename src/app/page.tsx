"use client"

import { useRef, useState } from "react"
import { useChat, type UIMessage } from "@/lib/useChat"
import Sidebar from "@/components/Sidebar"
import IntroScreen from "@/components/IntroScreen"
import ChatWindow from "@/components/ChatWindow"
import ChatInput from "@/components/ChatInput"

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

  const activeConvIdRef = useRef<string | null>(null)
  const messagesRef = useRef<UIMessage[]>([])

  const { messages, sendMessage, setMessages, status, stop, error } = useChat({
    api: "/api/chat",
  })

  const isLoading = status === "streaming" || status === "submitted"

  activeConvIdRef.current = activeConversationId
  messagesRef.current = messages

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

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function handleStartFromIntro(question: string) {
    const id = crypto.randomUUID()
    const title = question.length > 50 ? question.slice(0, 47) + "…" : question

    setConversations((prev) => [{ id, title, savedMessages: [] }, ...prev])
    setActiveConversationId(id)
    setViewMode("chat")

    await sendMessage({ text: question })
  }

  async function handleChatSend() {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    setInput("")

    if (!activeConvIdRef.current) {
      const id = crypto.randomUUID()
      const title = trimmed.length > 50 ? trimmed.slice(0, 47) + "…" : trimmed
      setConversations((prev) => [{ id, title, savedMessages: [] }, ...prev])
      setActiveConversationId(id)
      setViewMode("chat")
    }

    await sendMessage({ text: trimmed })
  }

  function handleNewChat() {
    saveCurrentMessages()
    setMessages([])
    setActiveConversationId(null)
    setViewMode("intro")
    setInput("")
  }

  function handleSelectConversation(id: string) {
    if (id === activeConvIdRef.current) return

    saveCurrentMessages()

    const conv = conversations.find((c) => c.id === id)
    setMessages(conv?.savedMessages ?? [])
    setActiveConversationId(id)
    setViewMode("chat")
    setInput("")
  }

  function handleDeleteConversation(id: string) {
    if (id === activeConvIdRef.current) {
      setMessages([])
      setActiveConversationId(null)
      setViewMode("intro")
      setInput("")
    }
    setConversations((prev) => prev.filter((c) => c.id !== id))
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
        />

        {/* ── Main content column ── */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Header */}
          <header className="shrink-0 border-b border-[#9e1b34]/20 bg-[#BA0C2F] text-white shadow-md">
            <div className="flex items-center gap-3 px-4 py-3 md:px-8">
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

              {viewMode === "intro" ? (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/60">
                    BYU–Hawaii
                  </p>
                  <h2 className="text-lg font-bold leading-tight md:text-xl">
                    Financial Aid Assistant
                  </h2>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/60">
                    BYU–Hawaii · Financial Aid Assistant
                  </p>
                  <h2 className="truncate text-lg font-bold leading-tight md:text-xl">
                    {activeConversation?.title ?? "New Conversation"}
                  </h2>
                </div>
              )}
            </div>
          </header>

          {/* ── Intro screen ── */}
          {viewMode === "intro" && <IntroScreen onStart={handleStartFromIntro} />}

          {/* ── Active conversation ── */}
          {viewMode === "chat" && (
            <>
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden px-6 py-2 md:px-10">
                  <ChatWindow messages={messages} isLoading={isLoading} error={error ?? null} />
                </div>
              </div>

              <ChatInput
                value={input}
                onChange={setInput}
                onSubmit={handleChatSend}
                onStop={stop}
                isLoading={isLoading}
              />
            </>
          )}
        </section>
      </div>
    </main>
  )
}
