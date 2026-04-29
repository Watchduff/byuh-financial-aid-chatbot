import * as cheerio from "cheerio"

export interface ScrapedPage {
  url: string
  title: string
  content: string
}

// CMS template variable noise found on BYUH pages
const CMS_NOISE_REGEX =
  /\b(contentVerticalPosition|overrideVerticalAlignment|contentHorizontalPosition|overrideHorizontalAlignment|overrideBackgroundColorOrImage|overrideTextColor|promoTextAlignment|overrideCardHide\w*|overridebuttonBgColor|overrideButtonText|data-content-type)\s*[:=][^,\n]*/g

// Navigation junk words that appear in titles when nav text bleeds in
const NAV_JUNK_REGEX =
  /\b(Close|Burger Menu Icon|Open Menu|Toggle Menu|Skip to Content|Skip Navigation)\b/gi

function cleanTitle(raw: string): string {
  return raw
    .replace(NAV_JUNK_REGEX, "")          // strip nav junk words
    .replace(/\s*[|–\-]\s*BYU.*/i, "")   // strip " | BYU–Hawaii" style suffixes
    .replace(/\s+/g, " ")
    .trim()
}

export async function scrapePage(url: string, html?: string): Promise<ScrapedPage> {
  let rawHtml = html

  if (!rawHtml) {
    const res = await fetch(url, {
      headers: { "User-Agent": "BYUH-FinancialAid-Ingestion/1.0" },
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`)
    }
    rawHtml = await res.text()
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

  // Find the primary content container (check .length explicitly — cheerio objects
  // are always truthy, so || alone would always pick the first selector)
  const mainEl = $("main").length
    ? $("main")
    : $("article").length
    ? $("article")
    : $("[role='main']").length
    ? $("[role='main']")
    : $("body")

  // Build title: prefer <head title>, then h1 scoped to content container
  const h1Title = cleanTitle(mainEl.find("h1").first().text())
  const title = headTitle || h1Title || url

  const content = mainEl
    .text()
    .replace(CMS_NOISE_REGEX, "")
    .replace(/\s+/g, " ")
    .trim()

  return { url, title, content }
}
