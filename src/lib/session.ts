import { cookies } from "next/headers"
import { eq } from "drizzle-orm"
import { db } from "@/db/index"
import { sessions } from "@/db/schema"

export const SESSION_COOKIE = "byuh_session"
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

/**
 * Reads or creates a session, sets the cookie, and returns the session ID.
 * Use in routes that need to establish a session (e.g. listing conversations).
 */
export async function getOrCreateSession(
  cookieStore: Awaited<ReturnType<typeof cookies>>
): Promise<string> {
  const existing = cookieStore.get(SESSION_COOKIE)?.value

  if (existing) {
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, existing))
      .limit(1)
    if (rows.length > 0) return existing
  }

  const id = crypto.randomUUID()
  await db.insert(sessions).values({ id })
  cookieStore.set(SESSION_COOKIE, id, {
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE,
  })
  return id
}

/**
 * Reads an existing session from the cookie. Returns null if none or invalid.
 * Use in routes that require an authenticated session (e.g. deleting conversations).
 */
export async function getSessionId(
  cookieStore: Awaited<ReturnType<typeof cookies>>
): Promise<string | null> {
  const id = cookieStore.get(SESSION_COOKIE)?.value
  if (!id) return null
  const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1)
  return rows.length > 0 ? id : null
}
