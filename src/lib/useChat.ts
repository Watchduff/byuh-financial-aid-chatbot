import { useState, useCallback } from "react"

export type UIMessage = {
  id: string
  role: "user" | "assistant" | "agent"
  content: string
  mode?: "grounded" | "demo" | "unavailable" | "handoff"
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
}

type UseChatOptions = {
  api?: string
  languageCode?: string
}

export function useChat(options?: UseChatOptions) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [status, setStatus] = useState<"idle" | "streaming" | "submitted">("idle")
  const [error, setError] = useState<Error | null>(null)

  const sendMessage = useCallback(
    async (message: { text: string }) => {
      const userMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: message.text,
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
          content: data.message || data.response || "",
          sources: Array.isArray(data.sources) ? data.sources : [],
          sentiment: data.sentiment,
          escalation: data.escalation,
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
