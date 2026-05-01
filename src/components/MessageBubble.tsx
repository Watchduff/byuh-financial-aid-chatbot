"use client"

import { useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { UIText } from "@/lib/uiText"

type Props = {
  role: "user" | "assistant" | "agent"
  content: string
  mode?: "grounded" | "demo" | "unavailable" | "handoff"
  sources?: string[]
  agentName?: string
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

export default function MessageBubble({ role, content, mode, sources, agentName, onFollowUp, uiText }: Props) {
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<"helpful" | "not-helpful" | null>(null)
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
        <div className="max-w-[85%] rounded-3xl bg-[#BA0C2F] px-5 py-3.5 text-sm leading-7 text-white shadow-sm md:max-w-[68%]">
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
              <blockquote className="my-2 border-l-4 border-[#BA0C2F]/30 pl-3 text-slate-600 italic">
                {children}
              </blockquote>
            ),
            hr: () => <hr className="my-3 border-slate-200" />,
          }}
        >
          {content}
        </ReactMarkdown>
        {sources && sources.length > 0 && <SourcePills sources={sources} uiText={uiText} />}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setFeedback("helpful")}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${
              feedback === "helpful"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {uiText.helpful}
          </button>
          <button
            type="button"
            onClick={() => setFeedback("not-helpful")}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${
              feedback === "not-helpful"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {uiText.notHelpful}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-500 transition hover:bg-slate-50"
          >
            {copied ? uiText.copied : uiText.copy}
          </button>
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
