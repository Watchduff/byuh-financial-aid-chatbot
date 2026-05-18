import OpenAI from "openai"

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export type ConversationTurn = { role: "user" | "assistant"; content: string }

// OpenAI text-embedding-3-small produces 1536-dimensional vectors
export async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  })
  return response.data[0].embedding
}

// Non-streaming completion — used for guards, fallbacks, and localization.
// Pass an AbortSignal to enforce a hard timeout.
export async function generateChatResponse(
  systemPrompt: string,
  userMessage: string,
  history: ConversationTurn[] = [],
  signal?: AbortSignal
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 800,
    ...(signal ? { signal } : {}),
  })
  return response.choices[0]?.message?.content ?? ""
}

// Streaming completion — yields text deltas as they arrive.
// Used for the main grounded response so the user sees text appearing immediately.
export async function* streamChatResponse(
  systemPrompt: string,
  userMessage: string,
  history: ConversationTurn[] = [],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 800,
    stream: true,
    ...(signal ? { signal } : {}),
  })

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) yield delta
  }
}

export async function generateJsonResponse(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 2000,
  })
  return response.choices[0]?.message?.content ?? "{}"
}
