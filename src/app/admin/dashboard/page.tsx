"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

type SupportRequest = {
  id: string
  userMessage: string
  userEmail: string | null
  userPhone: string | null
  status: "pending" | "assigned" | "resolved" | "closed"
  assignedAgentName: string | null
  createdAt: string
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  assigned: "bg-blue-50 text-blue-700 border-blue-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-500 border-slate-200",
}

const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber-400",
  assigned: "bg-blue-400",
  resolved: "bg-emerald-400",
  closed: "bg-slate-300",
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const [requests, setRequests] = useState<SupportRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "pending" | "assigned" | "resolved">("all")

  async function fetchRequests() {
    try {
      const res = await fetch("/api/admin/support-requests")
      if (res.status === 401) { router.push("/admin"); return }
      const data = await res.json()
      setRequests(data.supportRequests ?? [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRequests()
    const interval = setInterval(fetchRequests, 10000)
    return () => clearInterval(interval)
  }, [])

  async function handleLogout() {
    await fetch("/api/admin/auth", { method: "DELETE" })
    router.push("/admin")
  }

  const filtered = requests.filter((r) => filter === "all" || r.status === filter)
  const pendingCount = requests.filter((r) => r.status === "pending").length
  const assignedCount = requests.filter((r) => r.status === "assigned").length
  const resolvedCount = requests.filter((r) => r.status === "resolved").length

  return (
    <div className="min-h-screen bg-[#f7f4f2]">
      {/* Header */}
      <header className="border-b border-[#9e1b34]/20 bg-[#BA0C2F] text-white shadow-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-[11px] font-extrabold text-white ring-1 ring-white/30">
            BYU
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/60">BYU–Hawaii · Financial Aid</p>
            <h1 className="text-base font-bold leading-tight">Support Dashboard</h1>
          </div>
          {pendingCount > 0 && (
            <span className="animate-pulse rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-bold text-amber-900">
              {pendingCount} pending
            </span>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M2 4.75A2.75 2.75 0 0 1 4.75 2h3a.75.75 0 0 1 0 1.5h-3c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h3a.75.75 0 0 1 0 1.5h-3A2.75 2.75 0 0 1 2 11.25v-6.5Zm9.47.47a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 1 1-1.06-1.06l.97-.97H6.75a.75.75 0 0 1 0-1.5h5.69l-.97-.97a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Stats row */}
        <div className="mb-7 grid grid-cols-3 gap-4">
          {[
            { label: "Pending", count: pendingCount, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
            { label: "Assigned", count: assignedCount, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200" },
            { label: "Resolved", count: resolvedCount, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
          ].map(({ label, count, color, bg, border }) => (
            <div key={label} className={`rounded-2xl border ${border} ${bg} px-5 py-4`}>
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <p className={`mt-1 text-3xl font-bold ${color}`}>{count}</p>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="mb-5 flex items-center gap-2">
          {(["all", "pending", "assigned", "resolved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold capitalize transition ${
                filter === f
                  ? "bg-[#BA0C2F] text-white shadow-sm"
                  : "border border-[#e5dede] bg-white text-slate-600 hover:bg-[#fff7f7] hover:border-[#BA0C2F]/30"
              }`}
            >
              {f}
              {f !== "all" && (
                <span className="ml-1.5 text-[10px] opacity-70">
                  ({requests.filter((r) => r.status === f).length})
                </span>
              )}
            </button>
          ))}
          <button
            onClick={fetchRequests}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-[#e5dede] bg-white px-4 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.932.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-1.242l.842.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.241l-.84-.84v1.371a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.932.75.75 0 0 1 1.025-.273Z" clipRule="evenodd" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-sm text-slate-400">
            <div className="flex gap-1.5">
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
            </div>
            Loading requests…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#e5dede] bg-white py-24 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mb-3 h-8 w-8 text-slate-200">
              <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.17l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.17 48.9 48.9 0 0 1-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97Z" clipRule="evenodd" />
            </svg>
            <p className="font-medium text-slate-400">No {filter === "all" ? "" : filter + " "}requests</p>
            <p className="mt-1 text-xs text-slate-300">New requests will appear here automatically.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#e5dede] bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f0e8e8] bg-[#fdf8f8]">
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Message</th>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Contact</th>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Assigned to</th>
                  <th className="px-5 py-3.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Time</th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f5efef]">
                {filtered.map((req) => (
                  <tr key={req.id} className="transition hover:bg-[#fdf8f8]">
                    <td className="max-w-65 px-5 py-4">
                      <p className="truncate font-medium text-slate-800">{req.userMessage}</p>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500">
                      {req.userEmail && <p>{req.userEmail}</p>}
                      {req.userPhone && <p>{req.userPhone}</p>}
                      {!req.userEmail && !req.userPhone && <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold capitalize ${STATUS_STYLES[req.status]}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[req.status]}`} />
                        {req.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500">
                      {req.assignedAgentName ?? <span className="text-slate-300">Unassigned</span>}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-400">{timeAgo(req.createdAt)}</td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/admin/dashboard/${req.id}`}
                        className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 active:scale-95 ${
                          req.status === "pending" ? "bg-[#BA0C2F]" : "bg-slate-500"
                        }`}
                      >
                        {req.status === "pending" ? "Respond" : "View"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
