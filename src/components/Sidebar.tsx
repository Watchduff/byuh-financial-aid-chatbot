type ConversationSummary = {
  id: string
  title: string
}

type Props = {
  conversations: ConversationSummary[]
  activeConversationId: string | null
  isOpen: boolean
  onClose: () => void
  onNewChat: () => void
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
}

export default function Sidebar({
  conversations,
  activeConversationId,
  isOpen,
  onClose,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
}: Props) {
  return (
    <>
      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex h-full w-80 shrink-0 flex-col overflow-hidden border-r border-white/10 bg-[#9E1B34] text-white transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } md:flex`}
      >
        {/* ── Branding ── */}
        <div className="border-b border-white/10 px-6 py-7">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/50">
                BYU–Hawaii
              </p>
              <h1 className="mt-2.5 text-[23px] font-bold leading-tight">
                Financial Aid
                <br />
                Assistant
              </h1>
            </div>
            {/* Close button — mobile only */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sidebar"
              className="mt-1 rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white md:hidden"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            Get answers about scholarships, tuition, FAFSA, grants, deadlines,
            and financial aid options at BYU–Hawaii.
          </p>
        </div>

        {/* ── New Chat button ── */}
        <div className="px-5 pt-5 pb-3">
          <button
            type="button"
            onClick={() => { onNewChat(); onClose() }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-[0.98]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            New Chat
          </button>
        </div>

        {/* ── Session conversation history ── */}
        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-2">
          {conversations.length === 0 ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-5 text-center">
              <p className="text-xs text-white/50">No conversations yet.</p>
              <p className="mt-1 text-xs text-white/35">Ask a question to get started.</p>
            </div>
          ) : (
            <>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">
                This Session
              </p>
              <ul className="space-y-1">
                {conversations.map((conv) => {
                  const isActive = conv.id === activeConversationId
                  return (
                    <li key={conv.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => { onSelectConversation(conv.id); onClose() }}
                        className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 pr-9 text-left text-sm transition ${
                          isActive
                            ? "bg-white/20 font-semibold text-white"
                            : "text-white/75 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 opacity-60">
                          <path fillRule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902.848.137 1.705.248 2.57.331v3.443a.75.75 0 0 0 1.28.53l3.58-3.579a.78.78 0 0 1 .527-.224 41.202 41.202 0 0 0 5.183-.5c1.437-.232 2.43-1.49 2.43-2.903V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.289 0 0 0 10 2Z" clipRule="evenodd" />
                        </svg>
                        <span className="truncate">{conv.title}</span>
                      </button>

                      {/* Delete button — revealed on hover */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id) }}
                        aria-label="Delete conversation"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/0 transition group-hover:text-white/50 hover:!text-white hover:bg-white/10"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                          <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.519.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </aside>
    </>
  )
}
