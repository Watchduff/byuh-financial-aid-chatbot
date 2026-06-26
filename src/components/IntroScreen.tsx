"use client"

import type { UIText } from "@/lib/uiText"

type Props = {
  onStart: (question: string) => void
  uiText: UIText
}

export default function IntroScreen({ onStart, uiText }: Props) {
  const suggestedQuestions = [
    uiText.suggestedScholarships,
    uiText.suggestedApply,
    uiText.suggestedFafsa,
    uiText.suggestedDeadlines,
  ]

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
      {/* Logo */}
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-ad-accent2 shadow-lg">
        <div className="text-center leading-tight">
          <p className="text-lg font-extrabold text-white">BYU</p>
          <p className="text-[8px] font-bold uppercase tracking-widest text-white/80">Hawaii</p>
        </div>
      </div>

      {/* Heading */}
      <h1 className="mb-2 text-3xl font-bold text-slate-900 md:text-4xl">
        {uiText.introTitle}
      </h1>
      <p className="mb-8 max-w-md text-center text-sm leading-relaxed text-slate-500">
        {uiText.introDescription}
      </p>

      {/* Suggested topic buttons */}
      <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {suggestedQuestions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onStart(q)}
            className="rounded-xl border border-[#ede5e6] bg-white px-5 py-3.5 text-left text-sm font-medium text-slate-700 shadow-sm transition hover:border-ad-accent2/40 hover:bg-[#fff7f7] hover:text-slate-900 hover:shadow active:scale-[0.98]"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
