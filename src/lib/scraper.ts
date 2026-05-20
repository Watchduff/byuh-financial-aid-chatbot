import * as cheerio from "cheerio"

export interface ScrapedPage {
  url: string
  title: string
  content: string
}

const FETCH_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS ?? 30000)
const USE_PLAYWRIGHT = /^(1|true|yes)$/i.test(process.env.INGEST_USE_PLAYWRIGHT ?? "")

// CMS template variable noise found on BYUH pages
const CMS_NOISE_REGEX =
  /\b(contentVerticalPosition|overrideVerticalAlignment|contentHorizontalPosition|overrideHorizontalAlignment|overrideBackgroundColorOrImage|overrideTextColor|promoTextAlignment|overrideCardHide\w*|overridebuttonBgColor|overrideButtonText|data-content-type)\s*[:=][^,\n]*/g

// Navigation junk words that appear in titles when nav text bleeds in
const NAV_JUNK_REGEX =
  /\b(Close|Burger Menu Icon|Open Menu|Toggle Menu|Skip to Content|Skip Navigation)\b/gi

function cleanTitle(raw: string): string {
  return raw
    .replace(NAV_JUNK_REGEX, "")
    .replace(/\s*[|–\-]\s*BYU.*/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

// ---------------------------------------------------------------------------
// Playwright singleton — only imported/launched when INGEST_USE_PLAYWRIGHT=true
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _browser: any = null

async function getBrowser() {
  if (!_browser) {
    const { chromium } = await import("playwright")
    _browser = await chromium.launch({ headless: true })
  }
  return _browser
}

/** Release the Playwright browser. Call once at the end of ingestion. */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close()
    _browser = null
  }
}

async function fetchWithPlaywright(url: string): Promise<string> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: FETCH_TIMEOUT_MS })

    // Expand all collapsed accordion items so their text is in the DOM
    const collapsed = await page.locator("[aria-expanded='false']").all()
    for (const btn of collapsed) {
      await btn.click().catch(() => undefined)
    }
    if (collapsed.length > 0) {
      await page.waitForTimeout(500)
    }

    return await page.content()
  } finally {
    await page.close()
  }
}

// ---------------------------------------------------------------------------
// PDF text extraction — uses pdf-parse, no browser required
// ---------------------------------------------------------------------------
async function extractPdfText(url: string): Promise<ScrapedPage> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 BYUH-FinancialAid-Bot/1.0" },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const buffer = Buffer.from(await res.arrayBuffer())

    const { extractText, getDocumentProxy } = await import("unpdf")
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text: rawText } = await extractText(pdf, { mergePages: true })

    // Reject raw binary — safety net if extraction passes through the file header
    if (rawText.trimStart().startsWith("%PDF-")) {
      console.warn(`  ⚠ Rejected (raw binary): ${url}`)
      throw new Error("PDF extraction returned raw binary content")
    }

    // Reject garbled output — >30% non-printable chars means extraction failed
    const nonPrintable = (rawText.match(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f-\x9f]/g) ?? []).length
    if (rawText.length > 0 && nonPrintable / rawText.length > 0.3) {
      console.warn(
        `  ⚠ Rejected (${Math.round((nonPrintable / rawText.length) * 100)}% non-printable): ${url}`
      )
      throw new Error("PDF extraction returned >30% non-printable characters")
    }

    const content = rawText
      .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, "")
      .replace(/\s+/g, " ")
      .trim()

    const pathSegment =
      url.split("/").pop()?.split("?")[0]?.replace(/\.pdf$/i, "").replace(/[-_]/g, " ") ?? ""
    const title = cleanTitle(pathSegment) || "PDF Document"

    return { url, title, content }
  } finally {
    clearTimeout(timeout)
  }
}

// Probe content-type with a HEAD request to avoid downloading the full body
async function isPdfUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 BYUH-FinancialAid-Bot/1.0" },
    })
    return (res.headers.get("content-type") ?? "").toLowerCase().includes("application/pdf")
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function scrapePage(url: string, html?: string): Promise<ScrapedPage> {
  // PDF detection — skip if html is pre-supplied (caller already fetched it)
  if (!html && (await isPdfUrl(url))) {
    console.log(`  [PDF] Extracting text from: ${url}`)
    return extractPdfText(url)
  }

  let rawHtml = html

  if (!rawHtml) {
    if (USE_PLAYWRIGHT) {
      rawHtml = await fetchWithPlaywright(url)
    } else {
      // Original fetch+Cheerio path
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        })

        if (!res.ok) {
          throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`)
        }

        rawHtml = await res.text()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Failed to fetch ${url}: ${message}`)
      } finally {
        clearTimeout(timeout)
      }
    }
  }

  const $ = cheerio.load(rawHtml)

  // Extract title from <head> before any DOM manipulation.
  // Use "head title" (not just "title") so SVG <title> elements are excluded.
  const headTitle = cleanTitle($("head title").first().text())

  // Strip boilerplate — order matters: do this AFTER extracting title
  $(
    "script, style, noscript, nav, footer, header, iframe, " +
      "[aria-hidden='true'], [role='navigation'], [role='banner'], [role='contentinfo']"
  ).remove()

  // Find the primary content container
  const mainEl = $("main").length
    ? $("main")
    : $("article").length
    ? $("article")
    : $("[role='main']").length
    ? $("[role='main']")
    : $("body")

  const h1Title = cleanTitle(mainEl.find("h1").first().text())
  const title = headTitle || h1Title || url

  const content = mainEl
    .text()
    .replace(CMS_NOISE_REGEX, "")
    .replace(/\s+/g, " ")
    .trim()

  return { url, title, content }
}
