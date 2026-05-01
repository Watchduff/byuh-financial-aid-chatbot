import { useRef } from "react"

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  isLoading: boolean
  showPrivacyReminder?: boolean
}

export default function ChatInput({ value, onChange, onSubmit, onStop, isLoading, showPrivacyReminder }: Props) {
  const formRef = useRef<HTMLFormElement>(null)

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (!isLoading && value.trim()) {
        onSubmit()
      }
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!isLoading && value.trim()) {
      onSubmit()
    }
  }

  const canSend = value.trim().length > 0 && !isLoading

  return (
    <div className="shrink-0 border-t border-[#e8dcdc] bg-[#f7f4f2]">
      <div className="mx-auto w-full max-w-4xl px-6 py-2.5 md:px-10">
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="rounded-2xl border border-[#dccfd0] bg-white p-2.5 shadow-sm transition-shadow focus-within:border-[#BA0C2F]/40 focus-within:shadow-md"
        >
          <div className="flex items-end gap-3">
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about BYU-Hawaii financial aid..."
              rows={1}
              className="min-h-11 max-h-40 flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />

            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                className="flex shrink-0 items-center gap-2 rounded-xl border border-[#BA0C2F]/40 bg-white px-4 py-2.5 text-sm font-semibold text-[#BA0C2F] transition hover:bg-red-50 active:scale-95"
              >
                <span className="inline-block h-3 w-3 rounded-sm bg-[#BA0C2F]" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
                className="flex shrink-0 items-center justify-center rounded-xl bg-[#BA0C2F] p-2.5 text-white transition hover:bg-[#a80b2a] active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.154.75.75 0 0 0 0-1.115A28.897 28.897 0 0 0 3.105 2.288Z" />
                </svg>
              </button>
            )}
          </div>
        </form>

        <p className="mt-1 px-1 text-[11px] text-slate-400">
          <kbd className="rounded border border-slate-300 px-1 py-0.5 font-mono text-[10px]">Enter</kbd>{" "}
          to send &middot;{" "}
          <kbd className="rounded border border-slate-300 px-1 py-0.5 font-mono text-[10px]">
            Shift+Enter
          </kbd>{" "}
          for a new line
        </p>
        {showPrivacyReminder && (
          <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            Please do not share Social Security numbers, passwords, bank details, or other sensitive personal information in this chat.
          </p>
        )}
      </div>
    </div>
  )
}
