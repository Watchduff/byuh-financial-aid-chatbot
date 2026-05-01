import { NextResponse } from "next/server"
import { sql, eq, ilike, or } from "drizzle-orm"
import { db } from "@/db"
import { chunks, pages } from "@/db/schema"
import { getEmbedding, generateChatResponse } from "@/lib/openai"
import { DEFAULT_LANGUAGE_CODE, getSupportedLanguage, type SupportedLanguage } from "@/lib/languages"

// ---------------------------------------------------------------------------
// Response mode — included in every response so the frontend can render
// the correct UI treatment without parsing message text.
//
//   "grounded"   — answer came from the real RAG pipeline (DB + OpenAI)
//   "demo"       — answer came from hardcoded demo data (no live KB access)
//   "unavailable"— KB is empty/unreachable AND no demo answer matched
// ---------------------------------------------------------------------------
export type ResponseMode = "grounded" | "demo" | "unavailable"
type SentimentLabel = "neutral" | "confused" | "frustrated" | "urgent"

function sentiment(label: SentimentLabel, score: number) {
  return { label, score }
}

function escalation(reason: string, priority: "normal" | "high" = "normal") {
  return { shouldEscalate: true, reason, priority }
}

function detectSentiment(message: string): { label: SentimentLabel; score: number } {
  if (isFrustration(message)) return sentiment("frustrated", 0.9)
  if (/\b(urgent|asap|immediately|right now|emergency|deadline today|due today)\b/i.test(message)) {
    return sentiment("urgent", 0.85)
  }
  if (/\b(confused|lost|don't understand|do not understand|unclear|not sure|help me understand)\b/i.test(message)) {
    return sentiment("confused", 0.72)
  }
  return sentiment("neutral", 0.2)
}

// Maximum cosine distance (0–1) allowed for a retrieved chunk to be treated
// as relevant. pgvector's <=> operator returns cosine distance where
// 0 = identical vectors and 1 = orthogonal. Chunks whose best-match distance
// exceeds this threshold are considered off-topic.
const RELEVANCE_THRESHOLD = 0.72

// ---------------------------------------------------------------------------
// System prompt — only used for real grounded responses
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the BYU–Hawaii Financial Aid Assistant. You answer questions about financial aid, scholarships, tuition, FAFSA, grants, deadlines, and funding options at BYU–Hawaii using only the content provided to you from the official website.

RULES — follow every one without exception:

1. ANSWER CONFIDENTLY FROM CONTEXT: When the context contains relevant information, give a clear, direct answer. Do not hedge unnecessarily. Use the provided content as your source of truth.

2. CONTEXT ONLY: Never use outside knowledge, assumptions, or guesses. Every factual statement must come from the provided context.

3. CONCISE FORMAT: Keep answers focused and to the point — 1 to 4 short paragraphs or a brief bullet list. Do not write long essays or walls of text.

4. NO WRITING ASSISTANCE: Do not write emails, letters, appeal letters, personal statements, essays, templates, or any draft content on behalf of the user. If asked, respond: "I'm here to answer financial aid questions, not to write content for you. I'd be happy to explain the process or requirements instead."

5. NO CALCULATIONS: Do not perform math calculations or estimate dollar amounts beyond what is explicitly stated in the context. If asked to calculate, respond: "I'm not able to calculate that for you — for exact figures, please contact the Financial Aid office or visit financialaid.byuh.edu."

6. OUT-OF-SCOPE: If the question has nothing to do with BYU–Hawaii financial aid, respond: "I'm set up to help with BYU–Hawaii financial aid questions only. Here are some things I can help with: scholarships, FAFSA, tuition costs, deadlines, required documents, and the iWork program."

7. WEAK CONTEXT: If the context does not clearly answer the question, be positive and helpful: "I don't have that specific detail in my current information — for the most accurate answer, reach out to the Financial Aid office directly or visit financialaid.byuh.edu. Is there something else about financial aid I can help with?"

8. TONE: Warm, positive, and conversational. Be encouraging and supportive — users are often stressed about finances. Be direct and confident, but never cold or robotic. Use natural language, not bureaucratic phrasing.

9. PRIVACY: Do not ask users to share private personal information in chat, including Social Security numbers, passwords, FAFSA login information, full student ID numbers, passport numbers, bank details, full tax return details, medical information, immigration documents, or private family financial details. For account-specific records or documents, direct users to official BYU–Hawaii Financial Aid channels.

10. SOURCES: End grounded answers with the source URL when it is available in the context.

11. LANGUAGE: Respond in the user's selected language. Keep official names, office names, email addresses, phone numbers, URLs, and scholarship/program names accurate.`

// ---------------------------------------------------------------------------
// Conversational opener guard
//
// Catches greetings and vague openers like "i have a question" BEFORE
// retrieval so we can respond warmly instead of returning a dead-end fallback.
// ---------------------------------------------------------------------------
const CONVERSATIONAL_OPENER_PATTERNS: RegExp[] = [
  // Greetings
  /^\s*(hi+|hey+|hello+|howdy|greetings|good\s+(morning|afternoon|evening|day))[!,.\s]*$/i,
  // "i have a question" variants
  /^\s*i\s+(have|got|had)\s+(a\s+)?(quick\s+)?(question|query|concern|inquiry)[!,.\s?]*$/i,
  // "can you help" variants
  /^\s*(can\s+you\s+help(\s+me)?|i\s+need\s+help|help\s+me|i\s+need\s+assistance)[!,.\s?]*$/i,
  // "are you there" / "is anyone there"
  /^\s*(are\s+you\s+there|is\s+anyone\s+there|anyone\s+here)[!,.\s?]*$/i,
  // Pure "thanks" / acknowledgements with no follow-up content
  /^\s*(thanks?|thank\s+you|thx|ty|ok|okay|got\s+it|sure|sounds\s+good|great|awesome|cool|perfect)[!,.\s]*$/i,
]

const CONVERSATIONAL_OPENER_RESPONSE =
  "Of course! I'm happy to help. Go ahead and ask your question about BYU–Hawaii financial aid — whether it's about scholarships, FAFSA, tuition, deadlines, required documents, or the iWork program, I've got you covered!"

function isConversationalOpener(message: string): boolean {
  return CONVERSATIONAL_OPENER_PATTERNS.some((pattern) => pattern.test(message))
}

// ---------------------------------------------------------------------------
// Frustration / feedback detector
//
// Catches messages where the user is expressing dissatisfaction rather than
// asking a new question, so we can respond with empathy instead of another
// unhelpful fallback.
// ---------------------------------------------------------------------------
const FRUSTRATION_PATTERNS: RegExp[] = [
  // "you do/don't know", "you know nothing"
  /\byou\s+(do\s+not|don'?t)\s+know\b/i,
  /\byou\s+know\s+nothing\b/i,
  // "so bad", "this is bad", "that was bad"
  /\b(so|this\s+is|that\s+(was|is))\s+bad\b/i,
  // standalone "bad", "terrible", "awful", "useless", "horrible", "worst"
  /^\s*(bad|terrible|awful|useless|horrible|worst|pathetic|garbage|trash)[!.\s]*$/i,
  // "not helpful", "that's not helpful", "not useful", "doesn't help"
  /\b(not\s+(helpful|useful)|that('?s|\s+is)\s+not\s+helpful|doesn'?t\s+help|not\s+helping)\b/i,
  // "you can't help", "you can't answer", "you don't have answers"
  /\byou\s+(can'?t|cannot|don'?t)\s+(help|answer|tell\s+me)\b/i,
  // "i give up", "forget it", "never mind" (with frustration context)
  /^\s*(i\s+give\s+up|forget\s+it|never\s?mind|this\s+is\s+pointless)[!.\s]*$/i,
  // "what a waste", "waste of time"
  /\b(what\s+a\s+waste|waste\s+of\s+(my\s+)?time)\b/i,
]

const FRUSTRATION_RESPONSE =
  "I'm sorry I didn't give you a helpful answer — that's genuinely frustrating, and I want to do better. " +
  "Could you try rephrasing your question with a bit more detail? For example, instead of a general phrase, " +
  "try something like *\"What scholarships are available for international students?\"* or *\"When is the FAFSA deadline?\"* " +
  "I'll do my best to find the right answer. And if I still can't help, the **Financial Aid office** at " +
  "[financialaid.byuh.edu](https://financialaid.byuh.edu/) will have the answer for sure!"

function isFrustration(message: string): boolean {
  return FRUSTRATION_PATTERNS.some((pattern) => pattern.test(message))
}

// ---------------------------------------------------------------------------
// Sensitive personal information guard
// ---------------------------------------------------------------------------
const SENSITIVE_INFO_PATTERNS: RegExp[] = [
  /\b(social\s+security|ssn|social\s+security\s+number)\b/i,
  /\b(full\s+)?date\s+of\s+birth\b|\bdob\b/i,
  /\bpassport\s+(number|no\.?|#)?\b/i,
  /\b(bank\s+account|routing\s+number|account\s+number|credit\s+card|debit\s+card)\b/i,
  /\b(fafsa|fsa)\s+(login|username|password|id)\b/i,
  /\b(password|passcode|login\s+credentials)\b/i,
  /\b(full\s+)?student\s+id\s+(number|#)?\b|\bbyuh\s+id\s+(number|#)?\b/i,
  /\b(medical\s+record|medical\s+information|diagnosis|health\s+record)\b/i,
  /\b(immigration\s+document|visa\s+document|green\s+card|alien\s+registration)\b/i,
  /\b(my|our)\s+(tax\s+return|w-?2|1099|bank\s+statement|family\s+income|parents?'?\s+income)\b/i,
]

const SENSITIVE_INFO_RESPONSE =
  "Please don’t share private personal information in this chat. For help with your specific financial aid record or documents, contact the BYU–Hawaii Financial Aid Office directly at financialaid@byuh.edu or (808) 675-3316."

function containsSensitiveInfo(message: string): boolean {
  return SENSITIVE_INFO_PATTERNS.some((pattern) => pattern.test(message))
}

// ---------------------------------------------------------------------------
// Out-of-scope guard
//
// These patterns catch obviously unrelated requests BEFORE retrieval so no
// embedding or OpenAI calls are wasted. This is a fast pre-filter, not a
// perfect classifier — the system prompt provides a second layer of defence.
// ---------------------------------------------------------------------------
const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  // Pure arithmetic / math expressions — e.g. "10+10", "3 * 4 =", "(8/2)"
  /^\s*[\d\s()+\-*/^%.,]+\s*[=?]?\s*$/,
  // Math word problems — "what is 5 + 3", "calculate 100 / 4", "solve for x"
  /\b(what[\s']*s\s+\d|calculate|compute|solve\s+for|evaluate|simplify)\b.{0,40}\d/i,
  // Writing assistance — essays, emails, letters, templates, personal statements
  /\b(write\s+(me\s+)?(an?\s+)?(essay|email|e-mail|letter|appeal|personal\s+statement|cover\s+letter|template|draft|message|paragraph|summary)|draft\s+(an?\s+)?(email|letter|appeal|essay|message)|compose\s+(an?\s+)?(email|letter|message)|help\s+me\s+write|write\s+a\s+sample|give\s+me\s+a\s+(template|sample|draft|example)\s+(email|letter|essay))\b/i,
  // Coding / programming topics
  /\b(python|javascript|typescript|java\b|ruby\b|php\b|golang|c\+\+|html\b|css\b|react\b|angular|vue\.?js|node\.?js|algorithm|recursion|debug(ging)?|compile[dr]?|git\s+(push|pull|commit|merge|clone)|npm\s+install|pip\s+install|write\s+(a\s+)?(function|program|script|class|loop)|code\s+snippet)\b/i,
  // Weather queries
  /\b(weather\s+(in|at|for|today|tomorrow|forecast)|will\s+it\s+rain|is\s+it\s+(sunny|cloudy|snowing|hot|cold)\s+(today|tomorrow|outside)|temperature\s+(in|at|today|tomorrow))\b/i,
  // Joke requests
  /\b(tell\s+(me\s+)?(a\s+)?joke|give\s+me\s+a\s+joke|funny\s+joke|make\s+me\s+laugh|say\s+something\s+funny)\b/i,
  // Sports & entertainment
  /\b(sports?\s+(score|update|news)|who\s+(won|lost)\s+the\s+(game|match|series)|nba|nfl\b|mlb\b|nhl\b|epl\b|recommend\s+(a\s+)?(movie|song|book|tv\s+show|podcast)|what\s+(movie|show|song)\s+should)\b/i,
  // Generic trivia / general knowledge unrelated to BYUH
  /\b(capital\s+of\s+[a-z]+|population\s+of\s+[a-z]+|who\s+(is|was)\s+the\s+(president|prime\s+minister|ceo|inventor|founder)\s+of|what\s+country\s+is|recipe\s+for|how\s+to\s+cook|convert\s+\w+\s+to\s+\w+)\b/i,
]

// Polite refusal message returned for all out-of-scope requests
const OUT_OF_SCOPE_RESPONSE =
  "That's outside what I can help with, but I'm happy to assist with any BYU–Hawaii financial aid questions! Here are some topics I cover:\n\n" +
  "- What scholarships are available at BYU–Hawaii?\n" +
  "- How do I apply for financial aid?\n" +
  "- What is FAFSA and do I need it?\n" +
  "- What are the financial aid deadlines?\n" +
  "- How much is tuition at BYU–Hawaii?\n" +
  "- What documents do I need for financial aid?\n" +
  "- What is the iWork program?\n\n" +
  "Feel free to ask any of those!"

/**
 * Returns true when the message clearly falls outside BYU–Hawaii financial
 * aid scope. Used as a fast pre-filter before any DB or OpenAI calls.
 */
function isOutOfScope(message: string): boolean {
  return OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(message))
}

// ---------------------------------------------------------------------------
// DEMO DATA
//
// Hardcoded sample answers used ONLY when the real knowledge base is
// unavailable (empty DB or OpenAI API down).
//
// Rules for this section:
//  - One entry per suggested question shown in IntroScreen.tsx
//  - Each entry matches a specific question — no broad keyword fishing
//  - Keep this list in sync with SUGGESTED_QUESTIONS in IntroScreen.tsx
//  - Intentionally narrow so the chatbot cannot fake broad knowledge
// ---------------------------------------------------------------------------

type DemoEntry = {
  /** Exact question text from IntroScreen — used as the primary match */
  question: string
  /** Short alternative phrasings that clearly map to the same topic */
  aliases: string[]
  answer: string
}

const DEMO_ENTRIES: DemoEntry[] = [
  {
    question: "What scholarships are available?",
    aliases: ["scholarships available", "scholarship options", "what scholarships", "available scholarships"],
    answer: `BYU–Hawaii offers several scholarships and financial aid options:

**Church Subsidy**
The most significant funding source — tuition is heavily subsidized for members of The Church of Jesus Christ of Latter-day Saints.

**Merit Scholarships**
Awarded based on GPA, test scores, and academic achievement. Renewable each semester with satisfactory academic progress.

**iWork (Cooperative Education)**
Students work part-time on campus (~20 hrs/week). Earnings offset tuition and living expenses and are integrated into the academic schedule.

**Need-Based Grants**
Available to qualifying U.S. students who complete the FAFSA.

**Outside Scholarships**
Students are encouraged to search for external scholarships through their home countries, communities, or professional organizations.

Visit [financialaid.byuh.edu](https://financialaid.byuh.edu/) for a complete list of current opportunities.`,
  },
  {
    question: "How do I apply for financial aid?",
    aliases: ["apply for financial aid", "apply financial aid", "how to get financial aid", "financial aid application", "apply for aid"],
    answer: `Here is how to apply for financial aid at BYU–Hawaii:

**U.S. Citizens and Eligible Non-Citizens:**
1. Complete the **FAFSA** at [studentaid.gov](https://studentaid.gov/) using BYU–Hawaii's school code: **001606**
2. Review your **Student Aid Report (SAR)** after submission
3. Check your **MyByuh portal** for required documents or verification steps
4. Accept or decline your aid package through the portal

**International Students:**
International students are generally not eligible for U.S. federal aid. Contact the Financial Aid office for available institutional options.

**All Students:**
- Apply early — many programs have limited funding
- Maintain satisfactory academic progress (SAP) to stay eligible

Visit [financialaid.byuh.edu](https://financialaid.byuh.edu/) for personalized guidance.`,
  },
  {
    question: "What is FAFSA and do I need it?",
    aliases: ["what is fafsa", "fafsa", "do i need fafsa", "federal student aid", "free application for federal"],
    answer: `**FAFSA** stands for the Free Application for Federal Student Aid — a U.S. government form that determines your eligibility for federal grants, loans, and work-study programs.

**Do you need it?**
- **U.S. citizens and eligible non-citizens:** Yes — filing the FAFSA unlocks federal Pell Grants, subsidized loans, and other aid. Strongly recommended.
- **International students:** No — international students are generally not eligible for U.S. federal aid.

**How to file:**
1. Go to [studentaid.gov](https://studentaid.gov/) and create an FSA ID
2. Complete the FAFSA using BYU–Hawaii's school code: **001606**
3. File as early as possible — some aid is first-come, first-served

Visit [financialaid.byuh.edu](https://financialaid.byuh.edu/) for FAFSA help and current deadline dates.`,
  },
  {
    question: "What are the financial aid deadlines?",
    aliases: ["financial aid deadline", "aid deadline", "deadline for financial aid", "when to apply for aid", "aid due date"],
    answer: `Financial aid deadlines at BYU–Hawaii vary by aid type and semester:

**FAFSA Filing**
File as early as possible after October 1 for the upcoming academic year. Earlier filing improves your chances of receiving need-based aid.

**General Priority Deadlines (approximate):**
- **Fall semester:** March–April
- **Winter semester:** September–October

**Scholarship Deadlines**
Scholarship deadlines are often tied to the financial aid application process. Check your **MyByuh portal** for scholarship-specific dates.

**Important:** Deadlines change each year. Always verify current deadlines at [financialaid.byuh.edu](https://financialaid.byuh.edu/) or by contacting the Financial Aid office directly.`,
  },
  {
    question: "How much is tuition?",
    aliases: ["tuition cost", "how much does it cost", "cost of attendance", "tuition fees", "how much is tuition", "tuition"],
    answer: `BYU–Hawaii tuition is significantly subsidized for members of The Church of Jesus Christ of Latter-day Saints.

**Approximate 2024–2025 tuition (per semester):**
- Church members: ~$5,970
- Non-members: ~$7,900

**Additional costs to budget for:**
- Housing and meals
- Textbooks and supplies
- Student fees
- Health insurance
- Personal expenses

The Financial Aid office can provide a full cost-of-attendance estimate. For the most current official rates, visit [financialaid.byuh.edu](https://financialaid.byuh.edu/).`,
  },
  {
    question: "What documents do I need?",
    aliases: ["what documents", "documents needed", "required documents", "financial aid documents", "what do i need to submit"],
    answer: `The documents required for financial aid at BYU–Hawaii depend on your situation:

**For FAFSA-based aid (U.S. students):**
- Completed FAFSA form (school code: 001606)
- Tax returns (yours and/or parents') if selected for verification
- W-2 forms or other income documentation

**If selected for verification:**
- Verification worksheet (provided by the Financial Aid office)
- Proof of untaxed income
- Additional identity documents as requested

**For institutional scholarships:**
- Completed scholarship application
- Academic transcripts
- Letters of recommendation (if required)
- Ecclesiastical endorsement (for Church members)

All documents are submitted through your **MyByuh portal**. Visit [financialaid.byuh.edu](https://financialaid.byuh.edu/) for a current checklist.`,
  },
  {
    question: "What is the iWork scholarship?",
    aliases: ["iwork", "i work", "iwork scholarship", "cooperative education", "work scholarship", "iwork program"],
    answer: `The **iWork** (Cooperative Education) program is a distinctive feature of BYU–Hawaii's educational model.

**How it works:**
- Full-time students work part-time (~20 hours/week) in on-campus positions
- Work hours are integrated with your academic schedule
- You earn a paycheck that can be applied toward tuition and living expenses

**Benefits:**
- Reduces the overall cost of your education
- Provides real-world professional experience
- Positions available across many campus departments

**Eligibility:**
- Available to full-time BYU–Hawaii students
- Students apply for specific iWork positions through campus employment

**Financial impact:**
iWork is earned income, not a traditional scholarship grant. Earnings vary by position and hours, but can significantly offset tuition and living costs.

For more details, visit [financialaid.byuh.edu](https://financialaid.byuh.edu/) or contact the Financial Aid office.`,
  },
]

/**
 * Matches the user message against the demo entries.
 * Returns a demo answer only if the message clearly maps to one of the
 * seven supported suggested questions. Returns null for anything else.
 */
function getDemoAnswer(message: string): string | null {
  const lower = message.toLowerCase()
  for (const entry of DEMO_ENTRIES) {
    const allPhrases = [entry.question.toLowerCase(), ...entry.aliases]
    if (allPhrases.some((phrase) => lower.includes(phrase))) {
      return entry.answer
    }
  }
  return null
}

async function localizeResponse(message: string, language: SupportedLanguage): Promise<string> {
  if (language.code === DEFAULT_LANGUAGE_CODE) return message

  try {
    const translated = await generateChatResponse(
      "You translate BYU-Hawaii Financial Aid chatbot responses. Keep Markdown formatting, URLs, email addresses, phone numbers, official office names, and program names unchanged unless there is a standard translation. Return only the translated response.",
      `Translate this response into ${language.name} (${language.nativeName}):\n\n${message}`
    )

    return translated.trim() || message
  } catch (error) {
    console.warn("[chat] Localization failed:", error)
    return message
  }
}

function languageInstruction(language: SupportedLanguage): string {
  return language.code === DEFAULT_LANGUAGE_CODE
    ? "Respond in English."
    : `Respond in ${language.name} (${language.nativeName}). Keep BYU-Hawaii, Financial Aid office names, email addresses, phone numbers, URLs, and official program names accurate.`
}

// ---------------------------------------------------------------------------
// Shared fallback helper — called whenever the real pipeline is unavailable.
// Tries a demo answer first; if none matches, returns the unavailable message.
// No technical error details are ever included in the response body.
// ---------------------------------------------------------------------------
async function buildFallbackResponse(message: string, language: SupportedLanguage): Promise<NextResponse> {
  const currentSentiment = detectSentiment(message)
  const demoAnswer = getDemoAnswer(message)
  if (demoAnswer) {
    console.log("[chat] Serving demo response")
    return NextResponse.json({
      mode: "demo" as ResponseMode,
      message: await localizeResponse(demoAnswer, language),
      sources: [],
      sentiment: currentSentiment,
    })
  }

  console.log("[chat] No demo match — returning unavailable response")
  const unavailableMessage =
    "I'm not able to pull up the full knowledge base right now, but I can still help with common questions! " +
    "Try asking about **scholarships**, **how to apply for financial aid**, **FAFSA**, **tuition costs**, **deadlines**, **required documents**, or the **iWork program**. " +
    "For anything else, the Financial Aid office is always ready to help at [financialaid.byuh.edu](https://financialaid.byuh.edu/)."

  return NextResponse.json({
    mode: "unavailable" as ResponseMode,
    message: await localizeResponse(unavailableMessage, language),
    sources: [],
    sentiment: currentSentiment,
    escalation: escalation("The chatbot could not access a reliable knowledge-base answer.", "high"),
  })
}

// ---------------------------------------------------------------------------
// Knowledge base retrieval
// ---------------------------------------------------------------------------
type ContextRow = {
  content: string
  url: string
  title: string
}

type RetrievalResult = {
  rows: ContextRow[]
  /** True when the top result is close enough to the query to be trusted */
  confident: boolean
}

async function retrieveChunks(message: string): Promise<RetrievalResult> {
  // Primary: vector similarity search using OpenAI embedding
  try {
    const embedding = await getEmbedding(message)
    const vectorLiteral = JSON.stringify(embedding)

    // Select the cosine distance alongside content so we can gauge relevance.
    // pgvector's <=> operator returns cosine distance: 0 = identical, 1 = orthogonal.
    const rows = await db
      .select({
        content: chunks.content,
        url: pages.url,
        title: pages.title,
        distance: sql<number>`(${chunks.embedding} <=> ${vectorLiteral}::vector)`,
      })
      .from(chunks)
      .innerJoin(pages, eq(chunks.pageId, pages.id))
      .orderBy(sql`${chunks.embedding} <=> ${vectorLiteral}::vector`)
      .limit(6)

    if (rows.length > 0) {
      const bestDistance = rows[0].distance
      const confident = bestDistance < RELEVANCE_THRESHOLD
      console.log(
        `[chat] Vector search: ${rows.length} chunks, best distance: ${bestDistance.toFixed(3)} (${confident ? "confident" : "low confidence"})`
      )
      return {
        rows: rows.map(({ content, url, title }) => ({ content, url, title })),
        confident,
      }
    }
  } catch (err) {
    console.warn("[chat] Vector search failed, falling back to keyword search:", (err as Error).message)
  }

  // Fallback: keyword search with ILIKE (no cosine distance available)
  const terms = message
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 8)

  if (terms.length === 0) return { rows: [], confident: false }

  const rows = await db
    .select({ content: chunks.content, url: pages.url, title: pages.title })
    .from(chunks)
    .innerJoin(pages, eq(chunks.pageId, pages.id))
    .where(or(...terms.map((t) => ilike(chunks.content, `%${t}%`))))
    .limit(6)

  console.log(`[chat] Keyword search: ${rows.length} chunks`)
  // Require at least 2 matching chunks before treating the result as confident
  return { rows, confident: rows.length >= 2 }
}

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const message = (body.message ?? "").trim()
    const language = getSupportedLanguage(body.languageCode)
    const currentSentiment = detectSentiment(message)

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 })
    }

    // Step 1: Do not process sensitive personal information in public chat.
    if (containsSensitiveInfo(message)) {
      console.log("[chat] Sensitive personal information detected — refusing")
      return NextResponse.json({
        mode: "grounded" as ResponseMode,
        message: await localizeResponse(SENSITIVE_INFO_RESPONSE, language),
        sources: [],
        sentiment: currentSentiment,
      })
    }

    // Step 1a: Respond warmly to conversational openers (greetings, "i have a question", etc.)
    if (isConversationalOpener(message)) {
      console.log("[chat] Conversational opener detected — responding with invitation")
      return NextResponse.json({
        mode: "grounded" as ResponseMode,
        message: await localizeResponse(CONVERSATIONAL_OPENER_RESPONSE, language),
        sources: [],
        sentiment: currentSentiment,
      })
    }

    // Step 1b: Respond with empathy to frustrated or negative feedback messages
    if (isFrustration(message)) {
      console.log("[chat] Frustration detected — responding with empathy")
      return NextResponse.json({
        mode: "grounded" as ResponseMode,
        message: await localizeResponse(FRUSTRATION_RESPONSE, language),
        sources: [],
        sentiment: currentSentiment,
        escalation: escalation("The user appears frustrated and may need human support.", "high"),
      })
    }

    // Step 1c: Reject clearly out-of-scope questions before touching the DB or OpenAI
    if (isOutOfScope(message)) {
      console.log("[chat] Out-of-scope question detected — refusing")
      return NextResponse.json({
        mode: "grounded" as ResponseMode,
        message: await localizeResponse(OUT_OF_SCOPE_RESPONSE, language),
        sources: [],
        sentiment: currentSentiment,
      })
    }

    // Step 2: Pull relevant chunks from the knowledge base
    let result: RetrievalResult
    try {
      result = await retrieveChunks(message)
    } catch (err) {
      console.error("[chat] Retrieval error:", err)
      return buildFallbackResponse(message, language)
    }

    const { rows, confident } = result

    // Step 3: Empty KB — no ingested data yet
    if (rows.length === 0) {
      console.log("[chat] Knowledge base is empty")
      return buildFallbackResponse(message, language)
    }

    // Step 4: Retrieval confidence guard — chunks exist but are too dissimilar to
    // the query to be trusted. Return a safe "can't find it" response instead of
    // hallucinating an answer from weakly-matched context.
    if (!confident) {
      console.log("[chat] Low retrieval confidence — returning safe fallback")
      const lowConfidenceMessage =
        "That's a great question, but I'm not finding a clear answer in my current information. " +
        "For the most accurate help, I'd recommend reaching out to the **Financial Aid office** directly or visiting [financialaid.byuh.edu](https://financialaid.byuh.edu/) — they'll know for sure. " +
        "In the meantime, feel free to ask me about **scholarships, FAFSA, tuition costs, deadlines, required documents, or the iWork program** and I'll do my best to help!"

      return NextResponse.json({
        mode: "grounded" as ResponseMode,
        message: await localizeResponse(lowConfidenceMessage, language),
        sources: [],
        sentiment: currentSentiment,
        escalation: escalation("The chatbot found low-confidence context and could not answer reliably.", "normal"),
      })
    }

    // Step 5: KB has relevant context — generate a grounded response with OpenAI
    const context = rows
      .map((row, i) => `[Source ${i + 1}]\nTitle: ${row.title}\nURL: ${row.url}\n\n${row.content}`)
      .join("\n\n---\n\n")

    const userMessage = `${languageInstruction(language)}\n\nUser question: ${message}\n\nContext from BYU–Hawaii Financial Aid website:\n${context}`

    let answer: string
    try {
      answer = await generateChatResponse(SYSTEM_PROMPT, userMessage)
      if (!answer.trim()) {
        answer = "Sorry, I could not generate a response. Please try again."
      }
    } catch (err) {
      // OpenAI is unavailable — KB context was found but generation failed.
      // Fall back gracefully instead of surfacing a technical error.
      console.error("[chat] OpenAI generation error:", err)
      return buildFallbackResponse(message, language)
    }

    const sources = Array.from(new Set(rows.map((r) => r.url)))
    return NextResponse.json({
      mode: "grounded" as ResponseMode,
      message: answer,
      sources,
      sentiment: currentSentiment,
      escalation:
        currentSentiment.label === "urgent" || currentSentiment.label === "frustrated"
          ? escalation(`Detected ${currentSentiment.label} user sentiment.`, currentSentiment.label === "frustrated" ? "high" : "normal")
          : undefined,
    })
  } catch (error) {
    console.error("[chat] Unhandled error:", error)
    return NextResponse.json({
      mode: "unavailable" as ResponseMode,
      message: "Something went wrong. Please try again.",
      sources: [],
    })
  }
}
