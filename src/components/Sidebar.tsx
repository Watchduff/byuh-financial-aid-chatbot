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
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex h-full w-52 shrink-0 flex-col overflow-hidden bg-[#9E1B34] text-white transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } md:flex`}
      >
        {/* ── Compact top bar ── */}
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 flex-col items-center justify-center rounded-full bg-white leading-none">
              <span className="text-[8px] font-extrabold text-[#9E1B34]">BYU</span>
              <span className="text-[5px] font-bold uppercase tracking-wide text-[#9E1B34]">HAWAII</span>
            </div>
            <span className="text-xs font-bold text-white/90">Financial Aid</span>
          </div>
          {/* Mobile close */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-lg p-1 text-white/50 transition hover:bg-white/10 hover:text-white md:hidden"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* ── New chat button ── */}
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => { onNewChat(); onClose() }}
            className="flex w-full items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-white/20 active:scale-[0.98]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
            </svg>
            New chat
          </button>
        </div>

        {/* ── Conversation list ── */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {conversations.length === 0 ? (
            <p className="px-3 pt-2 text-[11px] leading-relaxed text-white/40">
              No conversations yet.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((conv) => {
                const isActive = conv.id === activeConversationId
                return (
                  <li key={conv.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => { onSelectConversation(conv.id); onClose() }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 pr-8 text-left text-xs transition ${
                        isActive
                          ? "bg-white/20 font-semibold text-white"
                          : "text-white/65 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0 opacity-50">
                        <path fillRule="evenodd" d="M8 2c-2.245 0-4.463.165-6.636.484A1.793 1.793 0 0 0 .5 4.27v3.038c0 .87.627 1.629 1.484 1.786.863.16 1.739.274 2.631.336A.8.8 0 0 1 5 9.92L6.938 12.5a.75.75 0 0 0 1.124 0L10 9.92a.8.8 0 0 1 .385-.49 29.04 29.04 0 0 0 2.631-.336A1.793 1.793 0 0 0 14.5 7.308V4.27a1.793 1.793 0 0 0-1.364-1.786A34.68 34.68 0 0 0 8 2Z" clipRule="evenodd" />
                      </svg>
                      <span className="truncate">{conv.title}</span>
                    </button>

                    {/* Delete — on hover */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id) }}
                      aria-label="Delete conversation"
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/0 transition group-hover:text-white/40 hover:text-white! hover:bg-white/10"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                        <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.36 15h5.28a1.5 1.5 0 0 0 1.495-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}
