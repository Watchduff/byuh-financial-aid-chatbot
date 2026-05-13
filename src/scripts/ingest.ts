import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import axios from "axios"
import * as cheerio from "cheerio"
import { sql, eq } from "drizzle-orm"
import pLimit from "p-limit"
import { db } from "@/db"
import { pages, chunks } from "@/db/schema"
import { scrapePage } from "@/lib/scraper"
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
const SKIP_EXTENSIONS =
  /\.(pdf|jpg|jpeg|png|gif|svg|css|js|zip|doc|docx|xls|xlsx|mp4|mp3|webp|ico|woff|woff2|ttf|eot)$/i

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
      const { data, headers } = await axios.get(url, {
        timeout: CRAWL_TIMEOUT_MS,
        headers: { "User-Agent": "Mozilla/5.0 BYUH-FinancialAid-Bot/1.0" },
      })

      const contentType = (headers["content-type"] as string) ?? ""
      if (!contentType.includes("text/html")) {
        console.warn(`  Skipping non-HTML response: ${url} (${contentType || "unknown content type"})`)
        continue
      }

      crawlable.add(url)

      const $ = cheerio.load(data)

      $("a[href]").each((_, el) => {
        const href = $(el).attr("href")
        if (!href) return

        try {
          const resolved = new URL(href, url)
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
      console.warn(`  Crawl error detail: ${message}`)
      console.warn(`  ⚠ Could not crawl: ${url}`)
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
  console.log(`Crawling: ${START_URL}\n`)
  console.log(`Max pages: ${MAX_PAGES}`)
  console.log(`Mode     : ${SCRAPE_ONLY ? "scrape only (no DB/OpenAI writes)" : "scrape, embed, and store"}\n`)

  const urls = await crawl(START_URL)
  console.log(`Found ${urls.length} pages to ingest\n`)

  let totalPages = 0
  let totalChunks = 0

  for (const url of urls) {
    console.log(`→ ${url}`)
    try {
      const count = await ingestPage(url)
      totalChunks += count
      totalPages++
      console.log(`  ✓ ${count} chunks stored\n`)
    } catch (err) {
      console.error(`  ✗ Skipped:`, (err as Error).message)
    }
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
