"use client"

import { FormEvent, KeyboardEvent, useState } from "react"

// These must stay in sync with DEMO_ENTRIES in src/app/api/chat/route.ts
// so that clicking a suggestion always gets a demo response when the KB is empty.
export const SUGGESTED_QUESTIONS = [
  "What scholarships are available?",
  "How do I apply for financial aid?",
  "What is FAFSA and do I need it?",
  "What are the financial aid deadlines?",
]

type Props = {
  onStart: (question: string) => void
  onLiveSupport: () => void
}

export default function IntroScreen({ onStart, onLiveSupport }: Props) {
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

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-5 md:justify-center md:py-6">
      {/* ── Hero ── */}
      <div className="mb-5 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#BA0C2F] text-base font-extrabold text-white shadow-lg">
          BYU
        </div>
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#BA0C2F]/70">
          BYU–Hawaii · Financial Aid
        </p>
        <h1 className="mt-1.5 text-3xl font-bold text-slate-900 md:text-4xl">
          How can I help you today?
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          Ask me about scholarships, tuition, FAFSA, grants, deadlines, and
          financial aid requirements at BYU–Hawaii.
        </p>
      </div>

      {/* ── Suggested question cards ── */}
      <div className="mb-5 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onStart(q)}
            className="group rounded-xl border border-[#ede5e6] bg-white px-3.5 py-2.5 text-left text-sm leading-snug text-slate-600 shadow-sm transition hover:border-[#BA0C2F]/35 hover:bg-[#fff7f7] hover:text-slate-800 hover:shadow active:scale-[0.98]"
          >
            <span className="flex items-start gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#BA0C2F]/50 transition group-hover:text-[#BA0C2F]/70"
              >
                <path
                  fillRule="evenodd"
                  d="M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0ZM9 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM6.75 8a.75.75 0 0 0 0 1.5h.75v1.75a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8.25 8h-1.5Z"
                  clipRule="evenodd"
                />
              </svg>
              {q}
            </span>
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
            placeholder="Or type your own financial aid question…"
            rows={1}
            className="min-h-11 max-h-32 flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-[#BA0C2F] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#a80b2a] active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Ask
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M2.87 2.298a.75.75 0 0 0-.812.743v2.91c0 .375.256.7.625.782L9 8 2.683 9.267a.75.75 0 0 0-.625.782v2.91a.75.75 0 0 0 1.052.692l11.5-5.25a.75.75 0 0 0 0-1.362L3.11 2.089a.75.75 0 0 0-.24-.211Z" />
            </svg>
          </button>
        </div>
        <p className="mt-2 px-1 text-center text-[11px] text-slate-400">
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

      {/* ── Live advisor CTA ── */}
      <div className="mt-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] text-slate-400">or</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      <button
        type="button"
        onClick={onLiveSupport}
        className="mt-3 flex items-center gap-2.5 rounded-xl border border-[#BA0C2F]/20 bg-white px-5 py-2.5 text-sm font-semibold text-[#BA0C2F] shadow-sm transition hover:border-[#BA0C2F]/40 hover:bg-[#fff7f7] hover:shadow active:scale-[0.98]"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
          <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM1.49 15.326a.78.78 0 0 1-.358-.442 3 3 0 0 1 4.308-3.516 6.484 6.484 0 0 0-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 0 1-2.07-.655ZM16.44 15.98a4.97 4.97 0 0 0 2.07-.654.78.78 0 0 0 .357-.442 3 3 0 0 0-4.308-3.517 6.484 6.484 0 0 1 1.907 3.96 2.32 2.32 0 0 1-.026.654ZM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM5.304 16.19a.844.844 0 0 1-.277-.71 5 5 0 0 1 9.947 0 .843.843 0 0 1-.277.71A6.975 6.975 0 0 1 10 18a6.974 6.974 0 0 1-4.696-1.81Z" />
        </svg>
        Chat with a Live Financial Aid Advisor
      </button>
    </div>
  )
}
