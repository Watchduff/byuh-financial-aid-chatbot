import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { sql, eq, ilike, or } from "drizzle-orm"
import { db } from "@/db"
import { chunks, pages } from "@/db/schema"
import { getEmbedding, generateChatResponse } from "@/lib/openai"
import { DEFAULT_LANGUAGE_CODE, getSupportedLanguage, type SupportedLanguage } from "@/lib/languages"
import { getOrCreateSession } from "@/lib/session"

// ---------------------------------------------------------------------------
// Response mode — included in every response so the frontend can render
// the correct UI treatment without parsing message text.
//
//   "grounded"   — answer came from the real RAG pipeline (DB + OpenAI)
//   "demo"       — answer came from hardcoded demo data (no live KB access)
//   "unavailable"  — KB is empty/unreachable AND no demo answer matched
//   "conversational"— greeting / acknowledgement / opener — no RAG involved
// ---------------------------------------------------------------------------
export type ResponseMode = "grounded" | "demo" | "unavailable" | "conversational"
type SentimentLabel = "neutral" | "confused" | "frustrated" | "urgent"

async function proxyToFastApi(body: Record<string, unknown>): Promise<NextResponse | null> {
  const baseUrl = process.env.FASTAPI_URL?.replace(/\/$/, "")
  if (!baseUrl) return null

  try {
    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : ""
    const payload = { ...body }
    if (conversationId) {
      const cookieStore = await cookies()
      payload.sessionId = await getOrCreateSession(cookieStore)
      payload.conversationId = conversationId
    }

    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({
      mode: "unavailable",
      message: "The FastAPI service returned an unreadable response.",
      confidence: "low",
      confidenceScore: 0,
      sources: [],
    }))

    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.warn("[chat] FastAPI proxy failed, falling back to local Next handler:", error)
    return null
  }
}

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

// Cosine distance thresholds (pgvector's <=> operator: 0 = identical, 1 = orthogonal).
//
//  < RELEVANCE_THRESHOLD  → confident match, generate grounded response
//  ≥ RELEVANCE_THRESHOLD  → low confidence, return soft "not in my info" fallback
//  ≥ OFF_TOPIC_THRESHOLD  → clearly unrelated to financial aid, return out-of-scope
const RELEVANCE_THRESHOLD = 0.72
const OFF_TOPIC_THRESHOLD = 0.88

// ---------------------------------------------------------------------------
// System prompt — only used for real grounded responses
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the BYU–Hawaii Financial Aid Assistant — a warm, knowledgeable, and encouraging guide who helps students navigate financial aid, scholarships, tuition, FAFSA, grants, deadlines, and funding at BYU–Hawaii. You answer exclusively using the content provided to you from the official BYU–Hawaii Financial Aid website.

RULES — follow every one without exception:

1. LEAD WITH THE ANSWER: Start directly with the answer, not a disclaimer. If the answer is yes, open with "Yes!" If there's good news, lead with it. Never open with "I", "According to", "Based on the context", or "The provided information states." Treat the context as your own knowledge — speak from it, not about it.

   Good: "Yes, you can walk in to meet with a financial aid advisor! The office encourages scheduling an appointment by calling (808) 675-3316 or emailing financialaid@byuh.edu, but walk-ins are welcome."
   Bad: "According to the provided context, walk-in policies may be available at BYU–Hawaii. For the most accurate information..."

2. CONVERSATIONAL TONE: Sound like a knowledgeable friend who works in the Financial Aid office, not a document reader. Use natural affirmations ("Yes!", "Absolutely!", "Great question!") when they fit, but don't overuse them. Vary your openers. Be warm and encouraging — students are often stressed about money.

3. CONTEXT ONLY: Every factual statement must come from the provided context. Never use outside knowledge, assumptions, or guesses. If the context supports the answer, state it confidently.

4. CONCISE FORMAT: 1 to 4 short paragraphs or a brief bullet list. No long essays. Break up text naturally like a real conversation.

5. NO WRITING ASSISTANCE: Do not write emails, letters, appeal letters, personal statements, essays, or templates. If asked: "I'm here to answer financial aid questions — I'd be happy to explain the process or requirements instead!"

6. NO CALCULATIONS: Do not estimate dollar amounts beyond what the context explicitly states. If asked: "For exact figures, contact the Financial Aid office or visit financialaid.byuh.edu — they can give you a personalized breakdown."

7. OUT-OF-SCOPE: If the question has nothing to do with BYU–Hawaii financial aid, redirect warmly: "I'm set up specifically for BYU–Hawaii financial aid questions! I can help with scholarships, FAFSA, tuition, deadlines, required documents, and the iWork program — want to ask about any of those?"

8. WEAK CONTEXT: If the context does not clearly answer the question: "That's a great question! I don't have that specific detail right now — for the most accurate answer, the Financial Aid office at [financialaid.byuh.edu](https://financialaid.byuh.edu/) or (808) 675-3316 can help you directly. Anything else I can look into for you?"

9. PRIVACY: Never ask for Social Security numbers, passwords, FAFSA login credentials, full student ID numbers, passport numbers, bank details, tax documents, medical information, or immigration documents. For account-specific help, direct students to official BYU–Hawaii Financial Aid channels.

10. SOURCES: When a URL is available in the context, weave it naturally into the answer (e.g., "you can find the full details at [financialaid.byuh.edu](https://financialaid.byuh.edu/)") rather than listing it as a footnote.

11. LANGUAGE: Respond in the user's selected language. Keep office names, email addresses, phone numbers, URLs, and scholarship/program names accurate and unchanged.

VERIFIED OFFICE FACTS — always use these exactly; never guess or say you don't know these:
- Office name: Financial Aid & Scholarships
- Location: Lorenzo Snow Administration Building, Room 180
- Hours: Monday–Friday, 8:00 AM – 5:00 PM HST. Closed on devotionals (Tuesday 11 AM–12 PM) and university holidays.
- Phone: (808) 675-3316
- Fax: (808) 675-3323
- Email: financialaid@byuh.edu
- Website: https://financialaid.byuh.edu/
- Mailing address: BYU-Hawaii #1980, 55-220 Kulanui Street Bldg 5, Laie, Hawaii 96762-1294`

// ---------------------------------------------------------------------------
// Conversational opener guard
//
// Each group has its own patterns + a response that fits that specific context
// so "hello" gets a greeting, "thanks" gets "you're welcome", etc.
// ---------------------------------------------------------------------------
const CONVERSATIONAL_OPENER_GROUPS: Array<{ patterns: RegExp[]; response: string }> = [
  {
    // Pure greetings
    patterns: [
      /^\s*(hi+|hey+|hello+|howdy|greetings|good\s+(morning|afternoon|evening|day))[!,.\s]*$/i,
    ],
    response:
      "Hi there! I'm the BYU–Hawaii Financial Aid assistant. What can I help you with today? " +
      "I can answer questions about scholarships, FAFSA, tuition, deadlines, required documents, the iWork program, and more!",
  },
  {
    // "I have a question" / "I have a concern"
    patterns: [
      /^\s*i\s+(have|got|had)\s+(a\s+)?(quick\s+)?(question|query|concern|inquiry)[!,.\s?]*$/i,
    ],
    response:
      "Of course — go ahead and ask! I'm here to help with anything about BYU–Hawaii financial aid.",
  },
  {
    // "Can you help me" / "I need help"
    patterns: [
      /^\s*(can\s+you\s+help(\s+me)?|i\s+need\s+help|help\s+me|i\s+need\s+assistance)[!,.\s?]*$/i,
    ],
    response:
      "Absolutely! What's your question? I can help with scholarships, FAFSA, tuition costs, deadlines, required documents, and the iWork program.",
  },
  {
    // "Are you there?" / presence checks
    patterns: [
      /^\s*(are\s+you\s+there|is\s+anyone\s+there|anyone\s+here)[!,.\s?]*$/i,
    ],
    response:
      "Yes, I'm here! Go ahead and ask your financial aid question — I'm ready to help.",
  },
  {
    // Thanks / acknowledgements
    patterns: [
      /^\s*(thanks?|thank\s+you|thx|ty)[!,.\s]*$/i,
    ],
    response:
      "You're welcome! Feel free to ask anytime if you have more financial aid questions — I'm always here.",
  },
  {
    // Positive acknowledgements — "ok", "got it", "sounds good", etc.
    patterns: [
      /^\s*(ok|okay|got\s+it|sure|sounds\s+good|great|awesome|cool|perfect|alright|noted)[!,.\s]*$/i,
    ],
    response:
      "Great! Let me know if anything else comes up — happy to help with any BYU–Hawaii financial aid questions.",
  },
]

function getConversationalOpenerResponse(message: string): string | null {
  for (const group of CONVERSATIONAL_OPENER_GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(message))) {
      return group.response
    }
  }
  return null
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
// Human escalation request detector
//
// Catches explicit requests to talk to a person/advisor BEFORE retrieval
// so we respond immediately and trigger the live support handoff.
// ---------------------------------------------------------------------------
const HUMAN_ESCALATION_PATTERNS: RegExp[] = [
  // "speak/talk/chat/connect/reach to/with a human/person/advisor/agent/staff/someone"
  /\b(speak|talk|chat|connect|reach|get)\s+(to|with)\s+(a\s+)?(human|real\s+person|actual\s+person|live\s+person|person|advisor|adviser|staff|agent|representative|rep|someone|anybody|anyone)\b/i,
  // "i want/need to speak/talk to…"
  /\b(i\s+(want|need|would\s+like|wanna|gotta)|can\s+i|could\s+i|may\s+i)\s+(to\s+)?(speak|talk|chat)\s+(to|with)\s+(a\s+)?(human|person|advisor|adviser|staff|agent|someone|anyone)\b/i,
  // "transfer me", "connect me", "put me through"
  /\b(transfer|connect|put)\s+me\s+(to|through|with)\s+(a\s+)?(human|person|advisor|adviser|agent|staff|someone|live\s+support)\b/i,
  // "live support", "live chat", "live agent", "live advisor"
  /\blive\s+(support|chat|agent|advisor|adviser|help|person)\b/i,
  // "real person", "actual person", "human help", "human agent"
  /\b(real|actual|live)\s+person\b/i,
  /\bhuman\s+(help|agent|advisor|adviser|support|assistance)\b/i,
  // "need more help", "need additional help" — with person/human connotation
  /\b(i\s+)?(need|want)\s+(more|additional|extra|further)\s+help\s+(from\s+)?(a\s+)?(person|human|advisor|adviser|someone|staff|agent)\b/i,
  // "is there anyone I can talk to", "can someone help me"
  /\b(is\s+there\s+(anyone|somebody|someone)\s+(i\s+can\s+)?(talk|speak|chat)\s+(to|with)|can\s+(someone|anybody|a\s+person)\s+(help|assist)\s+me)\b/i,
  // Standalone short phrases
  /^\s*(talk\s+to\s+(a\s+)?(human|person|advisor)|speak\s+to\s+(a\s+)?(human|person|advisor)|i\s+want\s+(a\s+)?(human|person|advisor)|connect\s+me|need\s+a\s+(human|person|advisor|agent)|human\s+please|get\s+me\s+(a\s+)?(person|human|advisor))\s*[!?.]*\s*$/i,
  // Informal / abbreviated — "someone please", "just someone", "a person"
  /^\s*(someone\s+(please|help|now)?|just\s+(a\s+)?(someone|person|human|advisor)|a\s+(real\s+)?(person|human|advisor)\s*(please)?)\s*[!?.]*\s*$/i,
  // Hawaiian Pidgin / informal: "no like someone/advisor/person" = "I want a human instead"
  /\bno\s+like\s+(a\s+)?(someone|person|human|advisor|adviser|agent|staff|real\s+person)\b/i,
  // "like someone/a person" as a standalone clarification
  /^\s*like\s+(a\s+)?(someone|person|human|advisor|adviser|real\s+person)\s*[!?.]*\s*$/i,
  // "i just want someone/a person to talk to"
  /\bi\s+(just\s+)?(want|need)\s+(a\s+)?(someone|person|human|advisor)\s*(to\s+(talk|speak|chat))?\b/i,
  // "can i talk to someone", "can someone help"
  /\bcan\s+(i\s+)?(talk|speak|chat)\s+to\s+(a\s+)?(someone|person|human|advisor)\b/i,
]

const HUMAN_ESCALATION_RESPONSE =
  "Got it — I'll connect you with a Financial Aid advisor right away! " +
  "Someone from the team will join this chat shortly. " +
  "Feel free to share more details about your question while you wait so the advisor can help you faster."

function isHumanEscalationRequest(message: string): boolean {
  return HUMAN_ESCALATION_PATTERNS.some((pattern) => pattern.test(message))
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
  // Weather queries — catches "do you know the weather", "what's the weather", "is it raining", etc.
  /\b(weather|forecast|raining|gonna\s+rain|will\s+it\s+rain|is\s+it\s+(sunny|cloudy|snowing|hot|cold|raining)|temperature\s+today|how\s+(hot|cold)\s+is\s+it)\b/i,
  // Joke requests
  /\b(tell\s+(me\s+)?(a\s+)?joke|give\s+me\s+a\s+joke|funny\s+joke|make\s+me\s+laugh|say\s+something\s+funny)\b/i,
  // Sports & entertainment
  /\b(sports?\s+(score|update|news)|who\s+(won|lost)\s+the\s+(game|match|series)|nba|nfl\b|mlb\b|nhl\b|epl\b|recommend\s+(a\s+)?(movie|song|book|tv\s+show|podcast)|what\s+(movie|show|song)\s+should)\b/i,
  // Generic trivia / general knowledge unrelated to BYUH
  /\b(capital\s+of\s+[a-z]+|population\s+of\s+[a-z]+|who\s+(is|was)\s+the\s+(president|prime\s+minister|ceo|inventor|founder)\s+of|what\s+country\s+is|recipe\s+for|how\s+to\s+cook|convert\s+\w+\s+to\s+\w+)\b/i,
  // Date / time queries — "what day is today", "what time is it", "what's the date"
  /\b(what\s+(day|time|date|year|month)\s+(is\s+)?(it|today|now|currently)|what'?s\s+(today'?s?\s+)?(date|day|time)|current\s+(time|date|day)|today'?s?\s+date|what\s+is\s+today)\b/i,
  // Opinion / personal preference questions directed at the bot
  /\b(do\s+you\s+(think|believe|feel|like|love|hate|prefer|agree|disagree|know\s+if)|what\s+do\s+you\s+(think|believe|feel|recommend\s+about)|in\s+your\s+opinion|what('?s|\s+is)\s+your\s+(opinion|view|take|thought)\b)/i,
  // Fitness, health, lifestyle — "muscular", "workout", "diet", "lose weight", etc.
  /\b(muscular|muscle|workout|exercise|gym|fitness|diet|lose\s+weight|calories|nutrition|healthy\s+eating|body\s+fat|protein|supplements?)\b/i,
  // Relationship / social questions
  /\b(boyfriend|girlfriend|relationship|dating|love\s+life|marriage|divorce|breakup|crush|romantic)\b/i,
  // General "is it good/great/bad to be/do X" opinion fishing
  /\b(is\s+it\s+(good|great|bad|cool|nice|fun|worth\s+it)\s+to\s+be|do\s+you\s+think\s+its?\s+(good|great|bad|cool|nice|fun))\b/i,
  // AI / chatbot self-reflection questions
  /\b(are\s+you\s+(a\s+)?(real|human|ai|robot|chat\s*bot|gpt|smart)|who\s+(made|built|created|trained)\s+you|what\s+(are|is)\s+you|do\s+you\s+have\s+feelings|can\s+you\s+feel|are\s+you\s+sentient)\b/i,
  // Food, cooking, and recipes
  /\b(recipe|how\s+to\s+cook|what\s+(to\s+)?eat|food\s+recommendation|best\s+restaurant|where\s+to\s+eat|cooking\s+tip)\b/i,
  // Travel and geography unrelated to BYUH
  /\b(best\s+place\s+to\s+(visit|travel|go)|travel\s+(tip|recommendation|advice)|tourist\s+(spot|attraction)|how\s+to\s+get\s+to\s+(?!byuh|byu.hawaii))\b/i,
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
      confidence: "high",
      confidenceScore: 80,
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
    confidence: "low",
    confidenceScore: 0,
    sources: [],
    sentiment: currentSentiment,
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
  confident: boolean
  confidenceScore: number
  /** Raw best cosine distance — used to detect completely off-topic queries */
  bestDistance: number
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
        confidenceScore: Math.max(0, Math.min(100, Math.round((1 - bestDistance) * 100))),
        bestDistance,
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

  if (terms.length === 0) return { rows: [], confident: false, confidenceScore: 0, bestDistance: 1 }

  const rows = await db
    .select({ content: chunks.content, url: pages.url, title: pages.title })
    .from(chunks)
    .innerJoin(pages, eq(chunks.pageId, pages.id))
    .where(or(...terms.map((t) => ilike(chunks.content, `%${t}%`))))
    .limit(6)

  console.log(`[chat] Keyword search: ${rows.length} chunks`)
  return { rows, confident: rows.length >= 2, confidenceScore: rows.length >= 2 ? 65 : rows.length > 0 ? 35 : 0, bestDistance: rows.length >= 2 ? 0.65 : 1 }
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

    const fastApiResponse = await proxyToFastApi(body)
    if (fastApiResponse) return fastApiResponse

    // Step 1: Do not process sensitive personal information in public chat.
    if (containsSensitiveInfo(message)) {
      console.log("[chat] Sensitive personal information detected — refusing")
      return NextResponse.json({
        mode: "grounded" as ResponseMode,
        message: await localizeResponse(SENSITIVE_INFO_RESPONSE, language),
        confidence: "high",
        confidenceScore: 100,
        sources: [],
        sentiment: currentSentiment,
      })
    }

    // Step 1a: Respond warmly to conversational openers (greetings, "i have a question", etc.)
    const openerResponse = getConversationalOpenerResponse(message)
    if (openerResponse) {
      console.log("[chat] Conversational opener detected — responding contextually")
      return NextResponse.json({
        mode: "conversational" as ResponseMode,
        message: await localizeResponse(openerResponse, language),
        confidence: null,
        confidenceScore: null,
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
        confidence: "high",
        confidenceScore: 100,
        sources: [],
        sentiment: currentSentiment,
        escalation: escalation("The user appears frustrated and may need human support.", "high"),
      })
    }

    // Step 1c: Detect explicit requests to speak to a human advisor
    if (isHumanEscalationRequest(message)) {
      console.log("[chat] Human escalation request detected — triggering handoff")
      return NextResponse.json({
        mode: "grounded" as ResponseMode,
        message: await localizeResponse(HUMAN_ESCALATION_RESPONSE, language),
        confidence: "high",
        confidenceScore: 100,
        sources: [],
        sentiment: currentSentiment,
        escalation: escalation("User explicitly requested to speak with a human advisor.", "high"),
      })
    }

    // Step 1d: Reject clearly out-of-scope questions before touching the DB or OpenAI
    if (isOutOfScope(message)) {
      console.log("[chat] Out-of-scope question detected — refusing")
      return NextResponse.json({
        mode: "grounded" as ResponseMode,
        message: await localizeResponse(OUT_OF_SCOPE_RESPONSE, language),
        confidence: "high",
        confidenceScore: 100,
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

    const { rows, confident, confidenceScore, bestDistance } = result

    // Step 3: Empty KB — no ingested data yet
    if (rows.length === 0) {
      console.log("[chat] Knowledge base is empty")
      return buildFallbackResponse(message, language)
    }

    // Step 4a: Definitely off-topic — cosine distance so high that no financial aid
    // content is anywhere near this query. Redirect cleanly rather than hedging.
    if (bestDistance >= OFF_TOPIC_THRESHOLD) {
      console.log(`[chat] Off-topic query (distance ${bestDistance.toFixed(3)}) — returning out-of-scope response`)
      return NextResponse.json({
        mode: "grounded" as ResponseMode,
        message: await localizeResponse(OUT_OF_SCOPE_RESPONSE, language),
        confidence: "low",
        confidenceScore: 0,
        sources: [],
        sentiment: currentSentiment,
      })
    }

    // Step 4b: Retrieval confidence guard — chunks exist but are too dissimilar to
    // be trusted. Return a safe "not in my info" response without hallucinating.
    if (!confident) {
      console.log("[chat] Low retrieval confidence — returning safe fallback")
      const lowConfidenceMessage =
        "I don't have that specific detail in my current information. " +
        "For the most accurate answer, reach out to the **Financial Aid office** directly or visit [financialaid.byuh.edu](https://financialaid.byuh.edu/) — they'll be able to help you right away. " +
        "In the meantime, feel free to ask me about **scholarships, FAFSA, tuition costs, deadlines, required documents, or the iWork program**!"

      return NextResponse.json({
        mode: "grounded" as ResponseMode,
        message: await localizeResponse(lowConfidenceMessage, language),
        confidence: "low",
        confidenceScore,
        sources: [],
        sentiment: currentSentiment,
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
      confidence: "high",
      confidenceScore,
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
      confidence: "low",
      confidenceScore: 0,
      sources: [],
    })
  }
}
