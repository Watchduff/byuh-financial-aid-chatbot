/**
 * Split text into overlapping chunks that prefer sentence boundaries.
 *
 * Strategy:
 * 1. Try to break at a sentence-ending punctuation (. ? !) followed by a space.
 * 2. Fall back to a paragraph break (\n) if no sentence boundary is close enough.
 * 3. Fall back to a word boundary (space) if neither is found.
 * 4. Hard-cut at chunkSize only as a last resort.
 *
 * Default 1000 chars / 200 overlap ≈ 250 tokens — solid for most RAG pipelines.
 */
export function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length === 0) return []

  const chunks: string[] = []
  let start = 0

  while (start < clean.length) {
    const tentativeEnd = Math.min(start + chunkSize, clean.length)

    let end = tentativeEnd

    // Only try to snap to a boundary if we're not already at the end of text
    if (end < clean.length) {
      // Look backwards from tentativeEnd for the best break point.
      // We search only within the last 30% of the chunk to avoid overly short chunks.
      const searchFrom = start + Math.floor(chunkSize * 0.7)

      // Prefer sentence boundaries (". ", "? ", "! ")
      const sentenceBreak = Math.max(
        clean.lastIndexOf(". ", end),
        clean.lastIndexOf("? ", end),
        clean.lastIndexOf("! ", end)
      )

      if (sentenceBreak >= searchFrom) {
        // +2 to include the punctuation and the space after it
        end = sentenceBreak + 2
      } else {
        // Prefer paragraph / newline break
        const paraBreak = clean.lastIndexOf(" \n", end)
        if (paraBreak >= searchFrom) {
          end = paraBreak + 1
        } else {
          // Fall back to the nearest word boundary (space)
          const wordBreak = clean.lastIndexOf(" ", end)
          if (wordBreak >= searchFrom) {
            end = wordBreak + 1
          }
          // else: hard-cut at tentativeEnd (already set)
        }
      }
    }

    const chunk = clean.slice(start, end).trim()
    if (chunk.length > 0) {
      chunks.push(chunk)
    }

    if (end >= clean.length) break

    // Next chunk starts with overlap so context isn't lost at boundaries
    start = end - overlap
    if (start < 0) start = 0
  }

  // Drop any chunks that are too short to be useful for retrieval
  return chunks.filter((c) => c.length >= 50)
}
