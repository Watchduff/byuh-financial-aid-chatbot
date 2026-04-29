import { useRef } from "react"

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  isLoading: boolean
}

export default function ChatInput({ value, onChange, onSubmit, onStop, isLoading }: Props) {
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
              placeholder="Ask a question about BYUH financial aid..."
              rows={1}
              className="min-h-[44px] max-h-40 flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />

            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                className="flex shrink-0 items-center gap-2 rounded-xl border border-[#BA0C2F]/40 bg-white px-5 py-2.5 text-sm font-semibold text-[#BA0C2F] transition hover:bg-red-50 active:scale-95"
              >
                <span className="inline-block h-3 w-3 rounded-sm bg-[#BA0C2F]" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
                className="flex shrink-0 items-center gap-2 rounded-xl bg-[#BA0C2F] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#a80b2a] active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Send
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
      </div>
    </div>
  )
}
