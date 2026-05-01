"use client"

import { useEffect, useRef } from "react"
import type { UIMessage } from "@/lib/useChat"
import MessageBubble from "./MessageBubble"
import LoadingIndicator from "./LoadingIndicator"

type Props = {
  messages: UIMessage[]
  isLoading: boolean
  error: Error | null
  supportRequestId: string | null
  adminTyping: boolean
  onSpeakToHuman: () => void
  onFollowUp: (question: string) => void
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9E1B34]/60 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9E1B34]/60 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9E1B34]/60" />
    </div>
  )
}

export default function ChatWindow({ messages, isLoading, error, supportRequestId, adminTyping, onSpeakToHuman, onFollowUp }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  const lastAssistantIndex = messages.reduceRight(
    (found, msg, i) => (found === -1 && msg.role === "assistant" ? i : found),
    -1
  )
  const hasHandoffNotice = messages.some((msg) => msg.mode === "handoff")

  return (
    <div className="flex-1 space-y-3 overflow-y-auto pb-4 pt-2">
      {messages.length === 0 && !isLoading && (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-slate-400">Ask a question to get started.</p>
        </div>
      )}

      {messages.map((msg, i) => (
        <div key={msg.id}>
          <MessageBubble
            role={msg.role as "user" | "assistant" | "agent"}
            content={msg.content}
            mode={msg.mode}
            sources={msg.sources}
            agentName={msg.agentName}
            onFollowUp={onFollowUp}
          />
          {/* Speak-to-human: support notice, not a user chat message */}
          {msg.role === "assistant" &&
            i === lastAssistantIndex &&
            !isLoading &&
            !supportRequestId &&
            !hasHandoffNotice && (
              <div className="mt-3 flex justify-start pl-10">
                <button
                  type="button"
                  onClick={onSpeakToHuman}
                  className="rounded-full border border-[#e5dede] bg-white px-4 py-2 text-sm font-semibold text-[#9E1B34] shadow-sm transition hover:bg-[#fff7f7] active:scale-[0.99]"
                >
                  Live Support
                </button>
              </div>
            )}
        </div>
      ))}

      {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
        <LoadingIndicator />
      )}

      {supportRequestId && adminTyping && (
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#9E1B34] text-[10px] font-bold text-white shadow-sm">
            BYU
          </div>
          <div className="rounded-2xl border border-[#eadfe0] bg-white px-4 py-3 text-xs text-slate-500 shadow-sm">
            <div className="flex items-center gap-2">
              <span>Financial Aid Advisor is typing...</span>
              <TypingDots />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="font-semibold">Something went wrong.</span> Please try again or refresh the page.
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}
