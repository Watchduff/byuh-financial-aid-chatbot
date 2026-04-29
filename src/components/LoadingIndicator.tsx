export default function LoadingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="rounded-3xl border border-[#eadfe0] bg-white px-5 py-4 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#9E1B34] [animation-delay:-0.3s]" />
          <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#9E1B34] [animation-delay:-0.15s]" />
          <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#9E1B34]" />
        </div>
      </div>
    </div>
  )
}
