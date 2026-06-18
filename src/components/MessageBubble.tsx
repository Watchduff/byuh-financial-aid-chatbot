"use client"

import { useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { UIText } from "@/lib/uiText"

type Props = {
  role: "user" | "assistant" | "agent"
  content: string
  mode?: "grounded" | "demo" | "unavailable" | "handoff" | "session-ended"
  sources?: string[]
  agentName?: string
  precedingQuestion?: string
  conversationId?: string | null
  onFollowUp?: (question: string) => void
  uiText: UIText
}

function BYUAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#9E1B34] text-[10px] font-bold text-white shadow-sm">
      BYU
    </div>
  )
}

function SourcePills({ sources, uiText }: { sources: string[]; uiText: UIText }) {
  const unique = Array.from(new Set(sources)).slice(0, 5)
  if (unique.length === 0) return null

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
        {uiText.sources}
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {unique.map((url) => {
          let label = url
          try {
            const u = new URL(url)
            label = u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "")
            if (label.length > 40) label = label.slice(0, 37) + "…"
          } catch {
            // keep raw url
          }
          return (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-center gap-2 rounded-lg border border-[#e5dede] bg-[#fdf8f8] px-2.5 py-2 text-[10px] font-medium text-[#9E1B34] transition hover:bg-[#fff0f0]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="currentColor" className="h-2.5 w-2.5 shrink-0">
                <path d="M6.5 1.75a.75.75 0 0 0-1.5 0V5H1.75a.75.75 0 0 0 0 1.5H5v3.25a.75.75 0 0 0 1.5 0V6.5h3.25a.75.75 0 0 0 0-1.5H6.5V1.75Z" />
              </svg>
              <span className="truncate">{label}</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}

function GroundingLabel({ mode, hasSources, uiText }: { mode?: Props["mode"]; hasSources: boolean; uiText: UIText }) {
  if (mode === "handoff") return null

  const grounded = mode === "grounded" || hasSources
  return (
    <div className="mb-2">
      <span
        className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
          grounded
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
        }`}
      >
        {grounded
          ? uiText.answeredFromSources
          : uiText.needsOfficialConfirmation}
      </span>
    </div>
  )
}

type FeedbackReason = "wrong-info" | "too-vague" | "missing-info" | "not-relevant" | "other"

const REASONS: { value: FeedbackReason; label: string }[] = [
  { value: "wrong-info",    label: "Wrong info" },
  { value: "too-vague",     label: "Too vague" },
  { value: "missing-info",  label: "Missing info" },
  { value: "not-relevant",  label: "Not relevant" },
  { value: "other",         label: "Other" },
]

export default function MessageBubble({ role, content, mode, sources, agentName, precedingQuestion, conversationId, onFollowUp, uiText }: Props) {
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<"helpful" | "not-helpful" | null>(null)
  const [step, setStep] = useState<"idle" | "reason" | "done">("idle")
  const [selectedReason, setSelectedReason] = useState<FeedbackReason | null>(null)
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submitFeedback(value: "helpful" | "not-helpful", reason?: FeedbackReason, feedbackComment?: string) {
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: conversationId ?? undefined,
        question: precedingQuestion ?? "",
        answer: content,
        feedback: value,
        reason: reason ?? undefined,
        comment: feedbackComment ?? undefined,
      }),
    }).catch(() => undefined)
  }

  async function handleThumbsUp() {
    if (feedback) return
    setFeedback("helpful")
    setStep("done")
    await submitFeedback("helpful")
  }

  async function handleThumbsDown() {
    if (feedback) return
    setFeedback("not-helpful")
    setStep("reason")
  }

  async function handleSubmitReason() {
    setSubmitting(true)
    await submitFeedback("not-helpful", selectedReason ?? undefined, comment.trim() || undefined)
    setSubmitting(false)
    setStep("done")
  }
  const isUser = role === "user"
  const isAgent = role === "agent"
  const followUps = useMemo(
    () => [uiText.followUpDocuments, uiText.followUpDeadline, uiText.followUpContact],
    [uiText]
  )
  const hasSources = Boolean(sources && sources.length > 0)

  async function handleCopy() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  if (mode === "session-ended") {
    return (
      <div className="my-2 flex flex-col items-center gap-3 py-2">
        <div className="flex items-center gap-3 w-full max-w-sm">
          <div className="h-px flex-1 bg-slate-200" />
          <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-slate-400">
              <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.844-8.791a.75.75 0 0 0-1.188-.918l-3.7 4.79-1.649-1.833a.75.75 0 1 0-1.114 1.004l2.25 2.5a.75.75 0 0 0 1.15-.043l4.25-5.5Z" clipRule="evenodd" />
            </svg>
            Session Ended
          </div>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
        <p className="max-w-sm text-center text-sm text-slate-500 leading-6">{content}</p>
      </div>
    )
  }

  if (mode === "handoff") {
    return (
      <div className="flex items-start gap-2.5">
        <BYUAvatar />
        <div className="max-w-[92%] rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm leading-7 text-amber-950 shadow-sm md:max-w-[85%]">
          <p className="mb-1 text-xs font-bold uppercase tracking-widest text-amber-700">
            {uiText.liveSupportNotice}
          </p>
          <span className="whitespace-pre-wrap">{content}</span>
        </div>
      </div>
    )
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-3xl bg-ad-accent2 px-5 py-3.5 text-sm leading-7 text-white shadow-sm md:max-w-[68%]">
          <span className="whitespace-pre-wrap">{content}</span>
        </div>
      </div>
    )
  }

  if (isAgent) {
    return (
      <div className="flex items-start gap-2.5">
        <BYUAvatar />
        <div className="max-w-[92%] rounded-3xl border border-[#eadfe0] bg-white px-5 py-3.5 text-sm leading-7 text-slate-800 shadow-sm md:max-w-[85%]">
          {agentName && (
            <p className="mb-2 text-sm text-slate-500">
              {uiText.advisorReplied.split("{agentName}")[0]}
              <span className="font-semibold text-slate-700">{agentName}</span>
              {uiText.advisorReplied.split("{agentName}")[1]}
            </p>
          )}
          <span className="whitespace-pre-wrap">{content}</span>
        </div>
      </div>
    )
  }

  // assistant
  return (
    <div className="flex items-start gap-2.5">
      <BYUAvatar />
      <div className="max-w-[92%] rounded-3xl border border-[#eadfe0] bg-white px-5 py-3.5 text-sm leading-7 text-slate-800 shadow-sm md:max-w-[85%]">
        <GroundingLabel mode={mode} hasSources={hasSources} uiText={uiText} />
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ul: ({ children }) => (
              <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
            ),
            li: ({ children }) => <li className="leading-snug">{children}</li>,
            strong: ({ children }) => (
              <strong className="font-semibold text-slate-900">{children}</strong>
            ),
            em: ({ children }) => <em className="italic text-slate-600">{children}</em>,
            h1: ({ children }) => (
              <h1 className="mb-2 mt-3 text-base font-bold text-slate-900 first:mt-0">{children}</h1>
            ),
            h2: ({ children }) => (
              <h2 className="mb-1.5 mt-3 text-sm font-bold text-slate-900 first:mt-0">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="mb-1 mt-2 text-sm font-semibold text-slate-800 first:mt-0">{children}</h3>
            ),
            a: ({ href, children }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#946f0a] underline underline-offset-2 hover:text-[#7a5c08]"
              >
                {children}
              </a>
            ),
            code: ({ children }) => (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                {children}
              </code>
            ),
            blockquote: ({ children }) => (
              <blockquote className="my-2 border-l-4 border-ad-accent2/30 pl-3 text-slate-600 italic">
                {children}
              </blockquote>
            ),
            hr: () => <hr className="my-3 border-slate-200" />,
          }}
        >
          {content}
        </ReactMarkdown>
        {sources && sources.length > 0 && <SourcePills sources={sources} uiText={uiText} />}

        {/* Feedback section */}
        <div className="mt-4 border-t border-slate-100 pt-3">
          {step === "done" ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">Thanks for your feedback — it helps us improve.</span>
            </div>
          ) : step === "reason" ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">What was the issue?</p>
              <div className="flex flex-wrap gap-2">
                {REASONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setSelectedReason(r.value === selectedReason ? null : r.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      selectedReason === r.value
                        ? "border-[#9E1B34]/30 bg-[#fff0f2] text-[#9E1B34]"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Tell us more (optional)…"
                rows={2}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-slate-300 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSubmitReason()}
                  disabled={submitting}
                  className="rounded-full bg-[#9E1B34] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#7d1428] disabled:opacity-50"
                >
                  {submitting ? "Submitting…" : "Submit feedback"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("done")}
                  className="rounded-full border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
                >
                  Skip
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-slate-400">Was this helpful?</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleThumbsUp()}
                  title="Helpful"
                  className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M1 8.25a1.25 1.25 0 1 1 2.5 0v7.5a1.25 1.25 0 1 1-2.5 0v-7.5ZM11 3V1.7c0-.268.14-.526.395-.607A2 2 0 0 1 14 3c0 .995-.182 1.948-.514 2.826-.204.536.166 1.174.744 1.174h2.52c1.243 0 2.261 1.01 2.146 2.247a23.864 23.864 0 0 1-1.341 5.974C17.153 16.323 16.072 17 14.9 17h-3.192a3 3 0 0 1-1.341-.317l-2.734-1.381A1.15 1.15 0 0 1 7 14.25V7.024c0-.309.126-.6.351-.815l2.14-2.088A.75.75 0 0 0 9.75 3.5l.388.388c.406.407.674.902.803 1.438L11 3Z" />
                  </svg>
                  Helpful
                </button>
                <button
                  type="button"
                  onClick={() => void handleThumbsDown()}
                  title="Not helpful"
                  className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M18.905 12.75a1.25 1.25 0 1 1-2.5 0v-7.5a1.25 1.25 0 0 1 2.5 0v7.5ZM8.905 17v1.3c0 .268-.14.526-.395.607A2 2 0 0 1 5.905 17c0-.995.182-1.948.514-2.826.204-.536-.166-1.174-.744-1.174h-2.52c-1.243 0-2.261-1.01-2.146-2.247.193-2.08.652-4.082 1.341-5.974C2.752 3.678 3.833 3 5.005 3h3.192a3 3 0 0 1 1.341.317l2.734 1.381c.383.193.633.587.633 1.019v7.226c0 .309-.126.6-.351.815l-2.14 2.088a.75.75 0 0 0-.159.532l-.388-.388a3.002 3.002 0 0 1-.803-1.438L8.905 17Z" />
                  </svg>
                  Not helpful
                </button>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                title="Copy"
                className="ml-auto flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-slate-50"
              >
                {copied ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-emerald-500">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
                    <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
                  </svg>
                )}
                {copied ? uiText.copied : uiText.copy}
              </button>
            </div>
          )}
        </div>
        {onFollowUp && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {followUps.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => onFollowUp(question)}
                className="rounded-full border border-[#e5dede] bg-[#fdf8f8] px-3 py-1.5 text-[11px] font-medium text-[#9E1B34] transition hover:bg-[#fff0f0]"
              >
                {question}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
