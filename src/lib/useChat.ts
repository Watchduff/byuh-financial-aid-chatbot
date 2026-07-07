"use client"

import { useState, useCallback, useRef } from "react"
import { generateId } from "@/lib/utils"

export type UIMessage = {
  id: string
  role: "user" | "assistant" | "agent"
  content: string
  mode?: "grounded" | "demo" | "unavailable" | "conversational" | "guard" | "handoff" | "session-ended"
  confidence?: "high" | "low"
  confidenceScore?: number
  sources?: string[]
  agentName?: string
  sentiment?: {
    label: "neutral" | "confused" | "frustrated" | "urgent"
    score: number
  }
  escalation?: {
    shouldEscalate: boolean
    reason: string
    priority: "normal" | "high"
  }
  stored?: boolean
}

type UseChatOptions = {
  api?: string
  languageCode?: string
}

type SendMessageInput = {
  text: string
  conversationId?: string
  conversationTitle?: string
  history?: Array<{ role: "user" | "assistant"; content: string }>
}

export function useChat(options?: UseChatOptions) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [status, setStatus] = useState<"idle" | "streaming" | "submitted">("idle")
  const [error, setError] = useState<Error | null>(null)
  // Holds the active SSE reader so stop() can cancel it
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  const sendMessage = useCallback(
    async (message: SendMessageInput) => {
      const conversationId = message.conversationId
      const conversationTitle = message.conversationTitle

      const userMessage: UIMessage = {
        id: generateId(),
        role: "user",
        content: message.text,
        stored: false,
      }

      setMessages((prev) => [...prev, userMessage])
      setStatus("submitted")
      setError(null)

      try {
        const response = await fetch(options?.api || "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: message.text,
            languageCode: options?.languageCode,
            conversationId,
            conversationTitle,
            history: message.history ?? [],
          }),
        })

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }

        const contentType = response.headers.get("content-type") ?? ""

        // ── SSE streaming path (grounded responses) ────────────────────────
        if (contentType.includes("text/event-stream") && response.body) {
          const reader = response.body.getReader()
          readerRef.current = reader
          const decoder = new TextDecoder()
          let buffer = ""

          // Mutable accumulator — updated on every delta
          let streamedMessage: UIMessage = {
            id: generateId(),
            role: "assistant",
            content: "",
            mode: "grounded",
            sources: [],
            stored: false,
          }

          try {
            outer: while (true) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop() ?? ""

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue
                const raw = line.slice(6).trim()
                if (!raw) continue

                let event: Record<string, unknown>
                try {
                  event = JSON.parse(raw)
                } catch {
                  continue
                }

                if (event.type === "meta") {
                  streamedMessage = {
                    ...streamedMessage,
                    mode: event.mode as UIMessage["mode"],
                    confidence: event.confidence as "high" | "low" | undefined,
                    confidenceScore: typeof event.confidenceScore === "number" ? event.confidenceScore : undefined,
                    sources: Array.isArray(event.sources) ? (event.sources as string[]) : [],
                    sentiment: event.sentiment as UIMessage["sentiment"],
                    escalation: event.escalation as UIMessage["escalation"],
                  }
                  const metaSnap = streamedMessage
                  setMessages((prev) => [...prev, metaSnap])
                  setStatus("streaming")
                } else if (event.type === "text" && typeof event.delta === "string") {
                  streamedMessage = { ...streamedMessage, content: streamedMessage.content + event.delta }
                  // Use map-by-id so the update is never position-dependent.
                  // Each closure captures its own snapId + snapContent at call time.
                  const snapId = streamedMessage.id
                  const snapContent = streamedMessage.content
                  setMessages((prev) =>
                    prev.map((m) => (m.id === snapId ? { ...m, content: snapContent } : m))
                  )
                } else if (event.type === "timeout") {
                  const msg = "This is taking longer than expected — please try again or contact the Financial Aid office at **(808) 675-3316**."
                  streamedMessage = { ...streamedMessage, content: msg, mode: "unavailable" }
                  const snapId = streamedMessage.id
                  const timeoutSnap = streamedMessage
                  setMessages((prev) =>
                    prev.map((m) => (m.id === snapId ? timeoutSnap : m))
                  )
                  break outer
                } else if (event.type === "done" || event.type === "error") {
                  break outer
                }
              }
            }
          } finally {
            reader.releaseLock()
            readerRef.current = null

            // If the stream ended with no text (API error, empty LLM response, etc.)
            // replace the blank bubble with a readable fallback rather than leaving it empty.
            if (streamedMessage.content === "") {
              const fallback: UIMessage = {
                ...streamedMessage,
                content: "I wasn't able to generate a response. Please try again or contact the Financial Aid office at **(808) 675-3316**.",
                mode: "unavailable",
              }
              streamedMessage = fallback
              const fid = fallback.id
              setMessages((prev) =>
                prev.map((m) => (m.id === fid ? fallback : m))
              )
            }

            setStatus("idle")
          }

          return { userMessage, assistantMessage: streamedMessage }
        }

        // ── JSON path (guards, demo, conversational, fallbacks) ────────────
        const data = await response.json()
        const mode = ["grounded", "demo", "unavailable", "conversational", "guard", "handoff"].includes(data.mode)
          ? data.mode
          : undefined

        const assistantMessage: UIMessage = {
          id: generateId(),
          role: "assistant",
          mode,
          confidence: data.confidence === "low" ? "low" : data.confidence === "high" ? "high" : undefined,
          confidenceScore: typeof data.confidenceScore === "number" ? data.confidenceScore : undefined,
          content: data.message || data.response || "",
          sources: Array.isArray(data.sources) ? data.sources : [],
          sentiment: data.sentiment,
          escalation: data.escalation,
          stored: data.stored === true,
        }

        setMessages((prev) => [...prev, assistantMessage])
        setStatus("idle")
        return { userMessage, assistantMessage }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setError(error)
        setStatus("idle")
        return { userMessage, assistantMessage: null }
      }
    },
    [options]
  )

  const stop = useCallback(() => {
    readerRef.current?.cancel().catch(() => undefined)
    readerRef.current = null
    setStatus("idle")
  }, [])

  return {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
    error,
  }
}
