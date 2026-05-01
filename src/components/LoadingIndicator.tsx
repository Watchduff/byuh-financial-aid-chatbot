export default function LoadingIndicator() {
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#9E1B34] text-[10px] font-bold text-white shadow-sm">
        BYU
      </div>
      <div className="rounded-3xl border border-[#eadfe0] bg-white px-5 py-4 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#9E1B34]/60 [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#9E1B34]/60 [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#9E1B34]/60" />
        </div>
      </div>
    </div>
  )
}
