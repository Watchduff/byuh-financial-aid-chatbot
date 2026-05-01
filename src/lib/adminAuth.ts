import { cookies } from "next/headers"

const COOKIE_NAME = "byuh_admin"

export async function verifyAdminAuth(): Promise<boolean> {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return false
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  return token === secret
}

export function getAdminCookieName() {
  return COOKIE_NAME
}
