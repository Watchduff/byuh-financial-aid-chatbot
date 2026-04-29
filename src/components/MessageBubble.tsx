import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type Props = {
  role: "user" | "assistant"
  content: string
}

export default function MessageBubble({ role, content }: Props) {
  const isUser = role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`rounded-3xl px-5 py-3.5 text-sm leading-7 shadow-sm ${
          isUser
            ? "max-w-[85%] bg-[#BA0C2F] text-white md:max-w-[68%]"
            : "max-w-[97%] border border-[#eadfe0] bg-white text-slate-800 md:max-w-[92%]"
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{content}</span>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => (
                <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
              ),
              li: ({ children }) => <li className="leading-snug">{children}</li>,
              strong: ({ children }) => (
                <strong className="font-semibold text-slate-900">{children}</strong>
              ),
              em: ({ children }) => <em className="italic text-slate-600">{children}</em>,
              h1: ({ children }) => (
                <h1 className="mb-2 mt-3 text-base font-bold text-slate-900 first:mt-0">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="mb-1.5 mt-3 text-sm font-bold text-slate-900 first:mt-0">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="mb-1 mt-2 text-sm font-semibold text-slate-800 first:mt-0">{children}</h3>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#946f0a] underline underline-offset-2 hover:text-[#7a5c08]"
                >
                  {children}
                </a>
              ),
              code: ({ children }) => (
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                  {children}
                </code>
              ),
              blockquote: ({ children }) => (
                <blockquote className="my-2 border-l-4 border-[#BA0C2F]/30 pl-3 text-slate-600 italic">
                  {children}
                </blockquote>
              ),
              hr: () => <hr className="my-3 border-slate-200" />,
            }}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}
