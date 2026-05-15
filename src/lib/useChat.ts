import { useState, useCallback } from "react"

export type UIMessage = {
  id: string
  role: "user" | "assistant" | "agent"
  content: string
  mode?: "grounded" | "demo" | "unavailable" | "handoff" | "session-ended"
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
}

export function useChat(options?: UseChatOptions) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [status, setStatus] = useState<"idle" | "streaming" | "submitted">("idle")
  const [error, setError] = useState<Error | null>(null)

  const sendMessage = useCallback(
    async (message: SendMessageInput) => {
      const conversationId = message.conversationId
      const conversationTitle = message.conversationTitle

      const userMessage: UIMessage = {
        id: crypto.randomUUID(),
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
          }),
        })

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }

        const data = await response.json()
        const mode = ["grounded", "demo", "unavailable", "handoff"].includes(data.mode)
          ? data.mode
          : undefined

        const assistantMessage: UIMessage = {
          id: crypto.randomUUID(),
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
