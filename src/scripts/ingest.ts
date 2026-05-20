import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import * as cheerio from "cheerio"
import { sql, eq } from "drizzle-orm"
import pLimit from "p-limit"
import { db } from "@/db"
import { pages, chunks } from "@/db/schema"
import { scrapePage, closeBrowser } from "@/lib/scraper"
import { chunkText } from "@/lib/chunker"
import { getEmbedding } from "@/lib/openai"

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function envBoolean(name: string): boolean {
  return /^(1|true|yes)$/i.test(process.env[name] ?? "")
}

const START_URL = process.env.INGEST_START_URL ?? "https://financialaid.byuh.edu/"
const ALLOWED_HOSTNAMES = new Set(
  (process.env.INGEST_ALLOWED_HOSTS ?? "financialaid.byuh.edu,www.financialaid.byuh.edu")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
)
const MAX_PAGES = envNumber("INGEST_MAX_PAGES", 60)
const DELAY_MS = envNumber("INGEST_DELAY_MS", 500)
const CRAWL_TIMEOUT_MS = envNumber("INGEST_CRAWL_TIMEOUT_MS", 30000)
const SCRAPE_ONLY = envBoolean("INGEST_SCRAPE_ONLY")

// PDFs are now handled (text extracted) rather than skipped
const SKIP_EXTENSIONS =
  /\.(jpg|jpeg|png|gif|svg|css|js|zip|doc|docx|xls|xlsx|mp4|mp3|webp|ico|woff|woff2|ttf|eot)$/i

// Must-have pages — always scraped even if the crawler doesn't discover them.
// Verified 200 OK on 2026-05-19.
const SEED_URLS = [
  "https://financialaid.byuh.edu/scholarship-faqs",
  "https://financialaid.byuh.edu/deans-list",
  "https://financialaid.byuh.edu/scholarships",
  "https://financialaid.byuh.edu/IWORK",
  "https://financialaid.byuh.edu/hukilau",
]

// 5 concurrent embedding requests — safe default for OpenAI rate limits
const embedLimit = pLimit(5)

// ---------------------------------------------------------------------------
// BFS crawler — stays within financialaid.byuh.edu
// ---------------------------------------------------------------------------
async function crawl(startUrl: string): Promise<string[]> {
  const visited = new Set<string>()
  const crawlable = new Set<string>()
  const queue: string[] = [startUrl]

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const url = queue.shift()!
    if (visited.has(url)) continue
    visited.add(url)

    try {
      const res = await fetch(url, {
        // AbortSignal.timeout is available in Node 17.3+ (Next.js requires 18+)
        signal: AbortSignal.timeout(CRAWL_TIMEOUT_MS),
        headers: { "User-Agent": "Mozilla/5.0 BYUH-FinancialAid-Bot/1.0" },
        redirect: "follow",
      })

      // response.url is the final URL after any HTTP redirects (Fetch spec).
      // This is the fix for the scope leak: a financialaid URL that redirects
      // to admissions.byuh.edu would pass the original hostname check but fail here.
      const finalUrl = res.url
      const finalHostname = new URL(finalUrl).hostname.toLowerCase()

      if (!ALLOWED_HOSTNAMES.has(finalHostname)) {
        console.warn(`  ⊘ Skipped (redirect left domain → ${finalUrl}): ${url}`)
        continue
      }

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase()

      if (!contentType.includes("text/html") && !contentType.includes("application/pdf")) {
        console.warn(`  ⊘ Skipped (non-HTML/PDF content-type: ${contentType || "unknown"}): ${url}`)
        continue
      }

      // PDFs are ingested (scrapePage extracts text) but not followed for links
      if (contentType.includes("application/pdf")) {
        crawlable.add(url)
        await new Promise((r) => setTimeout(r, DELAY_MS))
        continue
      }

      crawlable.add(finalUrl)

      const html = await res.text()
      const $ = cheerio.load(html)

      $("a[href]").each((_, el) => {
        const href = $(el).attr("href")
        if (!href) return

        try {
          // Resolve relative links against finalUrl (not original url) so that
          // pages served after a redirect have their links resolved correctly.
          const resolved = new URL(href, finalUrl)
          resolved.hash = ""
          const clean = resolved.toString()

          if (
            ALLOWED_HOSTNAMES.has(resolved.hostname.toLowerCase()) &&
            !SKIP_EXTENSIONS.test(clean) &&
            !visited.has(clean) &&
            !queue.includes(clean)
          ) {
            queue.push(clean)
          }
        } catch {
          // ignore unparseable hrefs
        }
      })

      // Polite crawl delay
      await new Promise((r) => setTimeout(r, DELAY_MS))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`  ⊘ Skipped (fetch error: ${message}): ${url}`)
    }
  }

  return Array.from(crawlable)
}

// ---------------------------------------------------------------------------
// Upsert page row — returns the page ID
// ---------------------------------------------------------------------------
async function upsertPage(url: string, title: string): Promise<number> {
  const result = await db
    .insert(pages)
    .values({ url, title })
    .onConflictDoUpdate({
      target: pages.url,
      set: {
        title: sql`excluded.title`,
        scrapedAt: sql`NOW()`,
      },
    })
    .returning({ id: pages.id })

  if (!result[0]) throw new Error(`DB did not return a page row for URL: ${url}`)
  return result[0].id
}

// ---------------------------------------------------------------------------
// Ingest a single page: scrape → chunk → embed (parallel) → write to DB
// ---------------------------------------------------------------------------
async function ingestPage(url: string): Promise<number> {
  const { title, content } = await scrapePage(url)

  if (!content || content.length < 100) {
    throw new Error("Too little usable content")
  }

  const textChunks = chunkText(content)
  console.log(`  title  : ${title}`)
  console.log(`  chunks : ${textChunks.length}`)

  if (SCRAPE_ONLY) {
    return textChunks.length
  }

  const pageId = await upsertPage(url, title)

  // Delete stale chunks before re-inserting (idempotent re-runs)
  await db.delete(chunks).where(eq(chunks.pageId, pageId))

  // Embed all chunks in parallel (up to 5 concurrent)
  const tasks = textChunks.map((chunkContent, i) =>
    embedLimit(async () => {
      const embedding = await getEmbedding(chunkContent)
      await db.insert(chunks).values({
        pageId,
        content: chunkContent,
        chunkIndex: i,
        embedding,
      })
    })
  )

  const results = await Promise.allSettled(tasks)
  const stored = results.filter((r) => r.status === "fulfilled").length
  const failed = results.filter((r) => r.status === "rejected").length

  if (failed > 0) {
    results
      .filter((r) => r.status === "rejected")
      .forEach((r, i) => {
        if (r.status === "rejected") {
          console.warn(`    ⚠ Chunk ${i} failed: ${r.reason?.message ?? r.reason}`)
        }
      })
  }

  return stored
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("\nBYUH Financial Aid Ingestion Pipeline")
  console.log("======================================\n")
  console.log(`Crawling : ${START_URL}`)
  console.log(`Max pages: ${MAX_PAGES}`)
  console.log(`Mode     : ${SCRAPE_ONLY ? "scrape only (no DB/OpenAI writes)" : "scrape, embed, and store"}`)
  console.log(`Playwright: ${process.env.INGEST_USE_PLAYWRIGHT ? "enabled" : "disabled (set INGEST_USE_PLAYWRIGHT=true for JS-rendered pages)"}\n`)

  const crawledUrls = await crawl(START_URL)

  // Seed URLs come first so they're always included even if crawl hits MAX_PAGES early.
  // Set deduplicates any overlap with crawled URLs.
  const urls = [...new Set([...SEED_URLS, ...crawledUrls])]
  console.log(`Seed URLs : ${SEED_URLS.length}`)
  console.log(`Crawled   : ${crawledUrls.length}`)
  console.log(`Total     : ${urls.length} pages to ingest\n`)

  let totalPages = 0
  let totalChunks = 0

  try {
    for (const url of urls) {
      console.log(`→ ${url}`)
      try {
        const count = await ingestPage(url)
        totalChunks += count
        totalPages++
        console.log(`  ✓ ${count} chunks stored\n`)
      } catch (err) {
        console.error(`  ✗ Skipped: ${(err as Error).message}\n`)
      }
    }
  } finally {
    // Release the Playwright browser if it was launched
    await closeBrowser()
  }

  console.log("===================================")
  console.log(`Pages stored : ${totalPages} / ${urls.length}`)
  console.log(`Chunks stored: ${totalChunks}`)
  console.log("Done ✓\n")
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
