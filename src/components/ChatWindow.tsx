"use client"

import { useEffect, useRef } from "react"
import type { UIMessage } from "@/lib/useChat"
import MessageBubble from "./MessageBubble"
import LoadingIndicator from "./LoadingIndicator"

type Props = {
  messages: UIMessage[]
  isLoading: boolean
  error: Error | null
}

export default function ChatWindow({ messages, isLoading, error }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  return (
    <div className="flex-1 space-y-3 overflow-y-auto pb-4 pt-2">
      {messages.length === 0 && !isLoading && (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-slate-400">Ask a question to get started.</p>
        </div>
      )}

      {messages.map((msg) => {
        const content =
          msg.parts
            ?.filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join("") ||
          (msg as unknown as { content?: string }).content ||
          ""

        return (
          <MessageBubble
            key={msg.id}
            role={msg.role as "user" | "assistant"}
            content={content}
          />
        )
      })}

      {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
        <LoadingIndicator />
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
