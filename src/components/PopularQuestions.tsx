type Props = {
  questions: string[]
  onSelect: (question: string) => void
  disabled: boolean
  /** "sidebar" = white-on-dark cards; "mobile" = light cards for the mobile panel */
  variant?: "sidebar" | "mobile"
}

export default function PopularQuestions({
  questions,
  onSelect,
  disabled,
  variant = "sidebar",
}: Props) {
  if (variant === "sidebar") {
    return (
      <div className="space-y-2">
        {questions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onSelect(q)}
            disabled={disabled}
            className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-left text-sm leading-snug text-white transition hover:bg-white/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {q}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      {questions.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onSelect(q)}
          disabled={disabled}
          className="rounded-xl border border-[#eadfe0] bg-[#fcfbfb] px-4 py-3 text-left text-sm font-medium leading-snug text-slate-800 transition hover:border-[#BA0C2F] hover:bg-[#fff7f8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {q}
        </button>
      ))}
    </div>
  )
}
