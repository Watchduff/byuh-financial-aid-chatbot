/**
 * cleanup-garbled-chunks.ts
 *
 * Finds and removes chunks whose content is garbled binary (raw PDF bytes,
 * non-ASCII garbage). Safe to re-run — already-clean DBs produce no deletions.
 *
 * Usage:
 *   npx tsx src/scripts/cleanup-garbled-chunks.ts --dry-run   # preview, no changes
 *   npx tsx src/scripts/cleanup-garbled-chunks.ts             # interactive confirm
 *   npx tsx src/scripts/cleanup-garbled-chunks.ts --yes       # skip prompt
 */

import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import * as readline from "readline"
import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { chunks, pages } from "@/db/schema"
import { sql } from "drizzle-orm"

const DRY_RUN = process.argv.includes("--dry-run")
const AUTO_YES = process.argv.includes("--yes")

// ---------------------------------------------------------------------------
// Garbled content detector
// ---------------------------------------------------------------------------
function isGarbled(content: string): boolean {
  if (!content || content.length < 10) return false

  // Raw PDF binary header
  if (content.trimStart().startsWith("%PDF")) return true

  // More than 30% non-ASCII characters (code point > 127).
  // Normal English/financial-aid text stays well below 5%.
  // Raw binary data typically hits 80-100%.
  const nonAsciiCount = [...content].filter((ch) => ch.charCodeAt(0) > 127).length
  return nonAsciiCount / content.length > 0.3
}

// ---------------------------------------------------------------------------
// Interactive confirmation prompt
// ---------------------------------------------------------------------------
async function confirm(question: string): Promise<boolean> {
  if (AUTO_YES) return true
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === "y")
    })
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("\nGarbled Chunk Cleanup")
  console.log("=====================")
  console.log(
    DRY_RUN
      ? "Mode: DRY RUN — no changes will be made\n"
      : AUTO_YES
      ? "Mode: LIVE (--yes) — deletions will proceed without prompt\n"
      : "Mode: LIVE — will prompt before deleting\n"
  )

  // ── 1. Load all chunks ──────────────────────────────────────────────────
  console.log("Loading chunks from database...")
  const allChunks = await db
    .select({ id: chunks.id, content: chunks.content, pageId: chunks.pageId })
    .from(chunks)

  console.log(`Total chunks in DB : ${allChunks.length}`)

  // ── 2. Identify garbled rows ────────────────────────────────────────────
  const garbled = allChunks.filter((c) => isGarbled(c.content))
  console.log(`Garbled chunks     : ${garbled.length}`)

  if (garbled.length === 0) {
    console.log("\n✓ No garbled chunks found — database is clean.\n")
    await verifyFaqContent()
    return
  }

  // ── 3. Preview sample ──────────────────────────────────────────────────
  console.log("\nSample garbled chunks (first 5):")
  garbled.slice(0, 5).forEach((c, i) => {
    const preview = c.content.slice(0, 100).replace(/[\n\r]/g, " ")
    const nonAsciiPct = Math.round(
      ([...c.content].filter((ch) => ch.charCodeAt(0) > 127).length / c.content.length) * 100
    )
    const reason = c.content.trimStart().startsWith("%PDF")
      ? "PDF header"
      : `${nonAsciiPct}% non-ASCII`
    console.log(`  ${i + 1}. [id=${c.id}, pageId=${c.pageId}, reason=${reason}]`)
    console.log(`     ${preview}`)
  })

  // Which pages are affected?
  const garbledPageIds = [...new Set(garbled.map((c) => c.pageId))]
  console.log(`\nAffected pages     : ${garbledPageIds.length}`)

  // ── 4. Dry-run exits here ──────────────────────────────────────────────
  if (DRY_RUN) {
    console.log("\nDry run complete — no changes made.")
    console.log("Re-run without --dry-run to delete these chunks.\n")
    return
  }

  // ── 5. Confirm and delete ──────────────────────────────────────────────
  const proceed = await confirm(
    `\nDelete ${garbled.length} garbled chunk(s) from ${garbledPageIds.length} page(s)?`
  )
  if (!proceed) {
    console.log("Aborted — no changes made.\n")
    return
  }

  const garbledIds = garbled.map((c) => c.id)
  await db.delete(chunks).where(inArray(chunks.id, garbledIds))
  console.log(`\n✓ Deleted ${garbledIds.length} garbled chunk(s)`)

  // ── 6. Clean up orphaned pages (pages with no remaining chunks) ─────────
  const remaining = await db
    .select({ pageId: chunks.pageId })
    .from(chunks)

  const remainingPageIdSet = new Set(remaining.map((r) => r.pageId))
  const orphanedPageIds = garbledPageIds.filter((id) => !remainingPageIdSet.has(id))

  if (orphanedPageIds.length > 0) {
    await db.delete(pages).where(inArray(pages.id, orphanedPageIds))
    console.log(`✓ Deleted ${orphanedPageIds.length} orphaned page(s) (no chunks remaining)`)
  } else {
    console.log("✓ No orphaned pages")
  }

  // ── 7. Verify FAQ content ──────────────────────────────────────────────
  await verifyFaqContent()

  console.log("\nDone ✓\n")
}

async function verifyFaqContent() {
  console.log("\nVerifying FAQ content (Returned Missionary Voucher)...")
  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(chunks)
    .where(sql`LOWER(${chunks.content}) LIKE '%returned missionary voucher%'`)

  const count = Number(rows[0]?.count ?? 0)
  if (count > 0) {
    console.log(`✓ FAQ content present: ${count} chunk(s) contain "Returned Missionary Voucher"`)
  } else {
    console.log(`⚠  "Returned Missionary Voucher" not found in any chunk.`)
    console.log(`   Re-ingest with INGEST_USE_PLAYWRIGHT=true to capture accordion content:`)
    console.log(`   INGEST_USE_PLAYWRIGHT=true npx tsx src/scripts/ingest.ts`)
  }
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
