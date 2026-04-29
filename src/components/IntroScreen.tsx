"use client"

import { FormEvent, KeyboardEvent, useState } from "react"

// These must stay in sync with DEMO_ENTRIES in src/app/api/chat/route.ts
// so that clicking a suggestion always gets a demo response when the KB is empty.
export const SUGGESTED_QUESTIONS = [
  "What scholarships are available?",
  "How do I apply for financial aid?",
  "What is FAFSA and do I need it?",
  "What are the financial aid deadlines?",
  "How much is tuition?",
  "What documents do I need?",
  "What is the iWork scholarship?",
]

type Props = {
  /** Called when the user submits any question — intro → chat transition */
  onStart: (question: string) => void
}

export default function IntroScreen({ onStart }: Props) {
  const [input, setInput] = useState("")

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (text) {
      onStart(text)
      setInput("")
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      const text = input.trim()
      if (text) {
        onStart(text)
        setInput("")
      }
    }
  }

  const lastIndex = SUGGESTED_QUESTIONS.length - 1
  const isOddCount = SUGGESTED_QUESTIONS.length % 2 !== 0

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
      {/* ── Hero ── */}
      <div className="mb-10 text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#BA0C2F]/70">
          BYU–Hawaii
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900 md:text-4xl">
          Financial Aid Made Simple
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-base leading-relaxed text-slate-500">
          Ask me about scholarships, tuition, FAFSA, grants, deadlines, and
          financial aid requirements at BYU–Hawaii.
        </p>
      </div>

      {/* ── Suggested question cards ── */}
      <div className="mb-8 grid w-full max-w-2xl grid-cols-2 gap-3">
        {SUGGESTED_QUESTIONS.map((q, i) => (
          <button
            key={q}
            type="button"
            onClick={() => onStart(q)}
            className={`rounded-2xl border border-[#e5dede] bg-white px-4 py-3.5 text-left text-sm leading-snug text-slate-700 shadow-sm transition hover:border-[#BA0C2F]/40 hover:bg-[#fff7f7] hover:shadow-md active:scale-[0.98] ${
              // Last card spans full width when the count is odd
              i === lastIndex && isOddCount ? "col-span-2" : ""
            }`}
          >
            {q}
          </button>
        ))}
      </div>

      {/* ── Custom question input ── */}
      <form onSubmit={handleSubmit} className="w-full max-w-2xl">
        <div className="flex items-end gap-2.5 rounded-2xl border border-[#dccfd0] bg-white p-2.5 shadow-sm transition-shadow focus-within:border-[#BA0C2F]/40 focus-within:shadow-md">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Or type your own financial aid question..."
            rows={1}
            className="min-h-[44px] max-h-32 flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-[#BA0C2F] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#a80b2a] active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Ask
          </button>
        </div>
        <p className="mt-1.5 px-1 text-center text-[11px] text-slate-400">
          <kbd className="rounded border border-slate-300 px-1 py-0.5 font-mono text-[10px]">
            Enter
          </kbd>{" "}
          to send &middot;{" "}
          <kbd className="rounded border border-slate-300 px-1 py-0.5 font-mono text-[10px]">
            Shift+Enter
          </kbd>{" "}
          for a new line
        </p>
      </form>
    </div>
  )
}
