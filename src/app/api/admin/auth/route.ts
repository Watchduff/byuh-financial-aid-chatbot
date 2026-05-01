import { NextRequest } from "next/server"
import { getAdminCookieName } from "@/lib/adminAuth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// POST /api/admin/auth — login
export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json()
    const secret = process.env.ADMIN_SECRET

    if (!secret || password !== secret) {
      return Response.json({ error: "Invalid password" }, { status: 401 })
    }

    const response = Response.json({ ok: true })
    const cookieHeader = `${getAdminCookieName()}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 8}`
    response.headers.set("Set-Cookie", cookieHeader)
    return response
  } catch {
    return Response.json({ error: "Login failed" }, { status: 500 })
  }
}

// DELETE /api/admin/auth — logout
export async function DELETE() {
  const response = Response.json({ ok: true })
  const cookieHeader = `${getAdminCookieName()}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
  response.headers.set("Set-Cookie", cookieHeader)
  return response
}
