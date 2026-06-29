import { asc } from "drizzle-orm"
import { db } from "@/db/index"
import { chatMessages, chunks, conversations, messageFeedback, pages, supportRequests } from "@/db/schema"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type MessageRow = typeof chatMessages.$inferSelect
type RangeId = "all" | "7d" | "14d" | "30d" | "custom"

const UNAVAILABLE_PATTERN =
  /not finding a clear answer|don't have that specific detail|could not access a reliable|not able to pull up/i

function inferConfidence(message: MessageRow | undefined): "high" | "low" | null {
  if (!message) return "low"
  if (message.responseMode === "conversational") return null
  if (message.responseConfidence === "high" || message.responseConfidence === "low") {
    return message.responseConfidence
  }
  if (message.responseMode === "unavailable") return "low"
  if (UNAVAILABLE_PATTERN.test(message.content)) return "low"
  return "high"
}

function parseSources(value: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((source) => typeof source === "string") : []
  } catch {
    return []
  }
}

function startOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function endOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(23, 59, 59, 999)
  return copy
}

function parseDateParam(value: string | null, fallback: Date) {
  if (!value) return fallback
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

function resolveRange(url: URL) {
  const requested = url.searchParams.get("range") as RangeId | null
  const range: RangeId = requested && ["all", "7d", "14d", "30d", "custom"].includes(requested)
    ? requested
    : "all"

  if (range === "all") {
    return { id: range, label: "All Time", from: null as Date | null, to: null as Date | null }
  }

  if (range === "custom") {
    const today = new Date()
    const from = startOfDay(parseDateParam(url.searchParams.get("from"), today))
    const to = endOfDay(parseDateParam(url.searchParams.get("to"), today))
    return {
      id: range,
      label: "Custom Range",
      from: from <= to ? from : startOfDay(to),
      to: from <= to ? to : endOfDay(from),
    }
  }

  const days = range === "7d" ? 7 : range === "14d" ? 14 : 30
  const to = endOfDay(new Date())
  const from = startOfDay(new Date())
  from.setDate(from.getDate() - (days - 1))
  return { id: range, label: `Last ${days} days`, from, to }
}

function inRange(value: Date | string, from: Date | null, to: Date | null) {
  const date = new Date(value)
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

function isoDate(value: Date | null) {
  return value ? value.toISOString() : null
}

// All date bucketing uses Hawaii time (Pacific/Honolulu, UTC-10, no DST)
// so that June 30 at 11 PM HST counts as June, not July.
function toHawaiiParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00"
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number(get("hour")),
  }
}

function yearKey(value: Date | string) {
  return toHawaiiParts(new Date(value)).year
}

function dayKey(value: Date | string) {
  const { year, month, day } = toHawaiiParts(new Date(value))
  return `${year}-${month}-${day}`
}

function hourKey(value: Date | string) {
  return toHawaiiParts(new Date(value)).hour
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const { id, label, from, to } = resolveRange(url)

    const [
      allMessages,
      allConversations,
      allSupportRequests,
      allFeedback,
      allPages,
      allChunks,
    ] = await Promise.all([
      db.select().from(chatMessages).orderBy(asc(chatMessages.createdAt)),
      db.select().from(conversations).orderBy(asc(conversations.createdAt)),
      db.select().from(supportRequests).orderBy(asc(supportRequests.createdAt)),
      db.select().from(messageFeedback).orderBy(asc(messageFeedback.createdAt)),
      db.select().from(pages),
      db.select().from(chunks),
    ])

    const messages = allMessages.filter((message) => inRange(message.createdAt, from, to))
    const userMessages = messages.filter((message) => message.role === "user")
    const assistantMessages = messages.filter((message) => message.role === "assistant")
    const conversationsInRange = allConversations.filter((conversation) => inRange(conversation.createdAt, from, to))
    const supportInRange = allSupportRequests.filter((supportRequest) => inRange(supportRequest.createdAt, from, to))
    const feedbackInRange = allFeedback.filter((feedback) => inRange(feedback.createdAt, from, to))

    const conversationsWithMessages = new Set(messages.map((message) => message.conversationId))
    const allConversationIds = new Set([
      ...conversationsInRange.map((conversation) => conversation.id),
      ...conversationsWithMessages,
    ])

    const lowConfidenceResponses = assistantMessages.filter((message) => inferConfidence(message) === "low")
    const highConfidenceResponses = assistantMessages.filter((message) => inferConfidence(message) === "high")
    const noConfidenceResponses = assistantMessages.filter(
      (message) => message.responseMode === "unavailable" || inferConfidence(message) === null
    )
    const retrievalResponses = assistantMessages.filter((message) => parseSources(message.responseSources).length > 0)
    const generativeResponses = assistantMessages.filter(
      (message) => !["unavailable", "handoff", "session-ended"].includes(message.responseMode ?? "")
    )

    const confidenceScores = assistantMessages
      .map((message) => message.responseConfidenceScore)
      .filter((score): score is number => typeof score === "number")
    const averageConfidenceScore = confidenceScores.length
      ? Math.round(confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length)
      : null

    const estimatedBrainWords = allChunks.reduce((sum, chunk) => {
      const words = chunk.content.trim().split(/\s+/).filter(Boolean).length
      return sum + words
    }, 0)

    const responseTypes = [
      { id: "generative", label: "Generative Responses", count: generativeResponses.length },
      { id: "retrieval", label: "Retrieval Responses", count: retrievalResponses.length },
      { id: "low-confidence", label: "Low Confidence Responses", count: lowConfidenceResponses.length },
      { id: "no-confidence", label: "No Confidence Responses", count: noConfidenceResponses.length },
    ]

    const yearSet = new Set<string>()
    for (const message of allMessages) yearSet.add(yearKey(message.createdAt))
    for (const supportRequest of allSupportRequests) yearSet.add(yearKey(supportRequest.createdAt))
    const currentYear = new Date().getFullYear()
    for (let year = currentYear - 4; year <= currentYear; year++) yearSet.add(String(year))
    const trendYears = Array.from(yearSet).sort().slice(-5)

    const responseTypeTrend = trendYears.map((year) => {
      const yearAssistants = allMessages.filter(
        (message) => message.role === "assistant" && yearKey(message.createdAt) === year
      )
      return {
        year,
        generative: yearAssistants.filter(
          (message) => !["unavailable", "handoff", "session-ended"].includes(message.responseMode ?? "")
        ).length,
        retrieval: yearAssistants.filter((message) => parseSources(message.responseSources).length > 0).length,
        lowConfidence: yearAssistants.filter((message) => inferConfidence(message) === "low").length,
        noConfidence: yearAssistants.filter(
          (message) => message.responseMode === "unavailable" || inferConfidence(message) === null
        ).length,
      }
    })

    const messageTrend = trendYears.map((year) => ({
      year,
      messagesSentToBot: allMessages.filter(
        (message) => message.role === "user" && yearKey(message.createdAt) === year
      ).length,
      botResponses: allMessages.filter(
        (message) => message.role === "assistant" && yearKey(message.createdAt) === year
      ).length,
    }))

    const conversationsPerHour = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${hour.toString().padStart(2, "0")}:00`,
      conversations: 0,
      messagesSentToBot: 0,
    }))

    for (const conversation of conversationsInRange) {
      conversationsPerHour[hourKey(conversation.createdAt)].conversations++
    }
    for (const message of userMessages) {
      conversationsPerHour[hourKey(message.createdAt)].messagesSentToBot++
    }

    const daySet = new Set(userMessages.map((message) => dayKey(message.createdAt)))
    for (const supportRequest of supportInRange) daySet.add(dayKey(supportRequest.createdAt))
    const dailyActivity = Array.from(daySet)
      .sort()
      .map((day) => ({
        date: day,
        messagesSentToBot: userMessages.filter((message) => dayKey(message.createdAt) === day).length,
        botResponses: assistantMessages.filter((message) => dayKey(message.createdAt) === day).length,
        conversations: conversationsInRange.filter((conversation) => dayKey(conversation.createdAt) === day).length,
        escalations: supportInRange.filter((supportRequest) => dayKey(supportRequest.createdAt) === day).length,
      }))

    const helpful = feedbackInRange.filter((feedback) => feedback.feedback === "helpful").length
    const notHelpful = feedbackInRange.filter((feedback) => feedback.feedback === "not-helpful").length

    return Response.json({
      range: {
        id,
        label,
        from: isoDate(from),
        to: isoDate(to),
      },
      totals: {
        conversations: allConversationIds.size,
        messagesSentToBot: userMessages.length,
        botResponses: assistantMessages.length,
        highConfidenceResponses: highConfidenceResponses.length,
        lowConfidenceResponses: lowConfidenceResponses.length,
        noConfidenceResponses: noConfidenceResponses.length,
        escalations: supportInRange.length,
        feedback: {
          helpful,
          notHelpful,
          total: feedbackInRange.length,
          helpfulRate: feedbackInRange.length ? Math.round((helpful / feedbackInRange.length) * 100) : null,
        },
        knowledgeBase: {
          pages: allPages.length,
          chunks: allChunks.length,
          estimatedWords: estimatedBrainWords,
        },
        averageConfidenceScore,
        lowConfidenceRate: assistantMessages.length
          ? Math.round((lowConfidenceResponses.length / assistantMessages.length) * 100)
          : null,
        escalationRate: userMessages.length ? Math.round((supportInRange.length / userMessages.length) * 100) : null,
      },
      responseTypes,
      responseTypeTrend,
      messageTrend,
      conversationsPerHour,
      dailyActivity,
      engagement: {
        liveSupportRequests: supportInRange.length,
        helpfulFeedback: helpful,
        notHelpfulFeedback: notHelpful,
        buttonClicksTracked: false,
      },
      notes: [
        "Button click engagement needs a click-event table before exact button analytics can be reported.",
        "Bot intelligence word count is estimated from stored knowledge chunks.",
      ],
    })
  } catch (error) {
    console.error("[analytics/dashboard] Error:", error)
    return Response.json({ error: "Failed to fetch dashboard analytics" }, { status: 500 })
  }
}
