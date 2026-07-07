import re
import json
from dataclasses import dataclass
from typing import Any

import asyncpg
from openai import AsyncOpenAI

from .config import Settings
from .models import ChatResponse, Escalation, Sentiment


DEFAULT_LANGUAGE_CODE = "en"
SUPPORTED_LANGUAGES = {
    "en": ("English", "English"),
    "es": ("Spanish", "Espanol"),
    "fr": ("French", "Francais"),
}

SYSTEM_PROMPT = """You are the BYU-Hawaii Financial Aid Assistant. You answer questions about financial aid, scholarships, tuition, FAFSA, grants, deadlines, and funding options at BYU-Hawaii using only the content provided to you from the official website.

Rules:
1. Use only the provided context and verified facts below as your source of truth. Verified facts are always authoritative.
2. Keep answers concise: 1 to 4 short paragraphs or a brief bullet list.
3. Do not write emails, letters, essays, templates, appeals, or personal statements.
4. Do not perform calculations or estimate amounts beyond the context.
5. SCHOLARSHIP QUESTIONS: When asked what scholarships are available, list them by student type using VERIFIED SCHOLARSHIP FACTS. If the student has not stated whether they are International, Domestic (U.S.), or from Hawaii, ask that one clarifying question first. Do not deflect to "contact the office" for general scholarship questions. Only direct to the office for account-specific questions (eligibility checks, status, personal situations).
6. DEADLINE QUESTIONS: When asked about financial aid dates or deadlines, cite the VERIFIED DEADLINE FACTS directly. Never say you don't have this information.
7. FAFSA QUESTIONS: When asked about FAFSA, explain what it is, who needs it, and the steps including school code 001606 and the March 15 priority deadline.
8. WEAK CONTEXT: If the context does not clearly answer a question not covered by verified facts, say so and direct the user to financialaid.byuh.edu.
9. Do not ask for private personal information.
10. End grounded answers with the source URL when available.
11. Respond in the user's selected language while preserving official names, URLs, phone numbers, and email addresses.

VERIFIED OFFICE FACTS:
- Financial Aid & Scholarships: (808) 675-3316 | financialaid@byuh.edu | Lorenzo Snow Admin Bldg, Room 180
- Hours: Monday-Friday, 8:00 AM - 5:00 PM HST. Closed devotionals (Tuesday 11 AM-12 PM) and university holidays.
- Financial Services (payments/billing): (808) 675-3706 | financialservices@byuh.edu
- IWORK Office: (808) 675-3720 | iwork@byuh.edu
- Website: https://financialaid.byuh.edu/

VERIFIED DEADLINE FACTS (2025-2026):
| Event                        | Fall 2025 | Winter 2026 | Spring 2026 |
|------------------------------|-----------|-------------|-------------|
| Classes Begin                | Sep. 3    | Jan. 7      | Apr. 29     |
| Awards Disbursed             | Sep. 10   | Jan. 14     | May 6       |
| Refunds Begin                | Sep. 17   | Jan. 21     | May 13      |
| Federal Aid Verification Due | Sep. 24   | Jan. 28     | May 20      |
| Full Tuition Due             | Dec. 12   | Apr. 17     | Jun. 26     |

FAFSA priority deadline: March 15 annually.
IWORK/Hukilau job deadline: 3rd Wednesday after classes begin. If not employed by 2nd Wednesday, student must meet counselor within 48 hours.

VERIFIED SCHOLARSHIP FACTS:

International Students (Non-U.S.):
- IWORK Work-Study Program
- Return Missionary Scholarship
- Dean's List Scholarship
- Department Scholarships
- Holokai Mentoring Scholarship
- External Scholarships

Domestic Students (U.S.):
- Hukilau Work-Study Program
- Return Missionary Scholarship
- Dean's List Scholarship
- Department Scholarships
- Holokai Mentoring Scholarship
- External Scholarships
- Federal Financial Aid Programs

Hawaii Students (all Domestic options PLUS):
- Seminary Graduate Scholarship

Additional: David O. McKay Presidential Scholarship (top merit award, open to all).
Enrollment requirement: 12+ credits (Fall/Winter) or 8+ credits (Spring).
When listing scholarships, close with: "For full details, visit https://financialaid.byuh.edu/scholarships or call (808) 675-3316."

VERIFIED FAFSA FACTS:
- School code: 001606
- Priority deadline: March 15
- Steps: (1) Create FSA ID at studentaid.gov, (2) file FAFSA with code 001606, (3) BYUH receives it in 3-5 business days
- U.S. citizens/eligible non-citizens: required for federal aid AND need-based BYUH scholarships
- International students: not eligible for U.S. federal aid; use CES application (new) or ISAA (continuing)

VERIFIED TUITION FACTS (2025-2026, per semester at 12+ credits):
- Latter-day Saint students: $3,415 | Per credit: $284
- Non-Latter-day Saint students: $6,830 | Per credit: $568
- Full Cost of Attendance: https://financialaid.byuh.edu/cost-of-attendance

ELIGIBILITY RULES:
- Students taking 50%+ of credits online are NOT eligible for federal aid
- Must maintain Satisfactory Academic Progress (SAP)
- Visiting/non-degree students are NOT eligible for any aid"""

CONVERSATIONAL_OPENER_RESPONSE = (
    "Of course! I'm happy to help. Go ahead and ask your question about BYU-Hawaii financial aid, "
    "whether it's about scholarships, FAFSA, tuition, deadlines, required documents, or the iWork program."
)

FRUSTRATION_RESPONSE = (
    "I'm sorry I didn't give you a helpful answer. Could you rephrase your question with a bit more detail? "
    "For example, try something like \"What scholarships are available for international students?\" or "
    "\"When is the FAFSA deadline?\" If I still can't help, the Financial Aid office at "
    "https://financialaid.byuh.edu/ will have the answer for sure."
)

SENSITIVE_INFO_RESPONSE = (
    "Please don't share private personal information in this chat. For help with your specific financial aid "
    "record or documents, contact the BYU-Hawaii Financial Aid Office directly at financialaid@byuh.edu or "
    "(808) 675-3316."
)

OUT_OF_SCOPE_RESPONSE = (
    "That's outside what I can help with, but I'm happy to assist with BYU-Hawaii financial aid questions. "
    "You can ask about scholarships, FAFSA, tuition costs, deadlines, required documents, or the iWork program."
)

UNAVAILABLE_RESPONSE = (
    "I'm not able to pull up the full knowledge base right now, but I can still help with common questions. "
    "Try asking about scholarships, how to apply for financial aid, FAFSA, tuition costs, deadlines, required "
    "documents, or the iWork program. For anything else, the Financial Aid office can help at "
    "https://financialaid.byuh.edu/."
)

LOW_CONFIDENCE_RESPONSE = (
    "That's a great question, but I'm not finding a clear answer in my current information. For the most accurate "
    "help, reach out to the Financial Aid office directly or visit https://financialaid.byuh.edu/. In the meantime, "
    "feel free to ask me about scholarships, FAFSA, tuition costs, deadlines, required documents, or the iWork program."
)

CONVERSATIONAL_OPENER_PATTERNS = [
    re.compile(pattern, re.I)
    for pattern in [
        r"^\s*(hi+|hey+|hello+|howdy|greetings|good\s+(morning|afternoon|evening|day))[!,.\s]*$",
        r"^\s*i\s+(have|got|had)\s+(a\s+)?(quick\s+)?(question|query|concern|inquiry)[!,.\s?]*$",
        r"^\s*(can\s+you\s+help(\s+me)?|i\s+need\s+help|help\s+me|i\s+need\s+assistance)[!,.\s?]*$",
        r"^\s*(thanks?|thank\s+you|thx|ty|ok|okay|got\s+it|sure|sounds\s+good|great|awesome|cool|perfect)[!,.\s]*$",
    ]
]

FRUSTRATION_PATTERNS = [
    re.compile(pattern, re.I)
    for pattern in [
        r"\byou\s+(do\s+not|don'?t)\s+know\b",
        r"\byou\s+know\s+nothing\b",
        r"\b(not\s+(helpful|useful)|doesn'?t\s+help|not\s+helping)\b",
        r"^\s*(bad|terrible|awful|useless|horrible|worst|garbage|trash)[!.\s]*$",
        r"^\s*(i\s+give\s+up|forget\s+it|never\s?mind|this\s+is\s+pointless)[!.\s]*$",
    ]
]

SENSITIVE_INFO_PATTERNS = [
    re.compile(pattern, re.I)
    for pattern in [
        r"\b(social\s+security|ssn|social\s+security\s+number)\b",
        r"\b(full\s+)?date\s+of\s+birth\b|\bdob\b",
        r"\bpassport\s+(number|no\.?|#)?\b",
        r"\b(bank\s+account|routing\s+number|account\s+number|credit\s+card|debit\s+card)\b",
        r"\b(fafsa|fsa)\s+(login|username|password|id)\b",
        r"\b(password|passcode|login\s+credentials)\b",
        r"\b(full\s+)?student\s+id\s+(number|#)?\b|\bbyuh\s+id\s+(number|#)?\b",
        r"\b(my|our)\s+(tax\s+return|w-?2|1099|bank\s+statement|family\s+income|parents?'?\s+income)\b",
    ]
]

OUT_OF_SCOPE_PATTERNS = [
    re.compile(pattern, re.I)
    for pattern in [
        r"^\s*[\d\s()+\-*/^%.,]+\s*[=?]?\s*$",
        r"\b(write\s+(me\s+)?(an?\s+)?(essay|email|letter|appeal|personal\s+statement|template|draft)|help\s+me\s+write)\b",
        r"\b(python|javascript|typescript|react\b|node\.?js|algorithm|debug(ging)?|git\s+(push|pull|commit)|npm\s+install|pip\s+install)\b",
        r"\b(weather|tell\s+(me\s+)?a\s+joke|sports?\s+(score|update|news)|recommend\s+(a\s+)?(movie|song|book))\b",
    ]
]

DEMO_ANSWERS = {
    "scholarship": "BYU-Hawaii offers several financial aid options, including scholarships, grants, and the iWork program. For the most current eligibility details and deadlines, visit https://financialaid.byuh.edu/.",
    "fafsa": "FAFSA is the Free Application for Federal Student Aid. U.S. citizens and eligible non-citizens should complete it at https://studentaid.gov/ using BYU-Hawaii's school code, 001606.",
    "tuition": "Tuition and cost information can change by year and student type. For current official rates, visit https://financialaid.byuh.edu/ or contact the Financial Aid office.",
    "iwork": "The iWork program helps eligible students work part-time while studying so earnings can support education costs. For current details, visit https://financialaid.byuh.edu/.",
}


@dataclass
class ContextRow:
    content: str
    url: str
    title: str


@dataclass
class RetrievalResult:
    rows: list[ContextRow]
    confident: bool
    confidence_score: int


class RagService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self.pool = await asyncpg.create_pool(self.settings.database_url, min_size=1, max_size=5)

    async def close(self) -> None:
        if self.pool:
            await self.pool.close()

    async def store_chat_turn(
        self,
        session_id: str,
        conversation_id: str,
        conversation_title: str | None,
        user_message: str,
        assistant_response: ChatResponse,
        max_messages: int = 40,
    ) -> bool:
        if not self.pool:
            return False

        title = (conversation_title or user_message[:80] or "New Conversation")[:80]
        sources = json.dumps(assistant_response.sources)

        try:
            async with self.pool.acquire() as connection:
                async with connection.transaction():
                    await connection.execute(
                        """
                        INSERT INTO sessions (id, created_at, last_active_at)
                        VALUES ($1, NOW(), NOW())
                        ON CONFLICT (id)
                        DO UPDATE SET last_active_at = NOW()
                        """,
                        session_id,
                    )
                    await connection.execute(
                        """
                        INSERT INTO conversations (id, session_id, title, created_at, updated_at)
                        VALUES ($1, $2, $3, NOW(), NOW())
                        ON CONFLICT (id)
                        DO NOTHING
                        """,
                        conversation_id,
                        session_id,
                        title,
                    )
                    owner_session_id = await connection.fetchval(
                        "SELECT session_id FROM conversations WHERE id = $1",
                        conversation_id,
                    )
                    if owner_session_id != session_id:
                        return False
                    await connection.execute(
                        "UPDATE conversations SET updated_at = NOW() WHERE id = $1",
                        conversation_id,
                    )
                    await connection.execute(
                        """
                        INSERT INTO chat_messages
                            (conversation_id, role, content, created_at)
                        VALUES ($1, 'user', $2, NOW())
                        """,
                        conversation_id,
                        user_message,
                    )
                    await connection.execute(
                        """
                        INSERT INTO chat_messages
                            (
                                conversation_id,
                                role,
                                content,
                                response_mode,
                                response_confidence,
                                response_confidence_score,
                                response_sources,
                                created_at
                            )
                        VALUES ($1, 'assistant', $2, $3, $4, $5, $6, NOW())
                        """,
                        conversation_id,
                        assistant_response.message,
                        assistant_response.mode,
                        assistant_response.confidence,
                        assistant_response.confidenceScore,
                        sources,
                    )
                    await connection.execute(
                        """
                        DELETE FROM chat_messages
                        WHERE id IN (
                            SELECT id
                            FROM chat_messages
                            WHERE conversation_id = $1
                            ORDER BY created_at DESC, id DESC
                            OFFSET $2
                        )
                        """,
                        conversation_id,
                        max_messages,
                    )
            return True
        except Exception:
            return False

    async def answer(self, raw_message: str, language_code: str | None) -> ChatResponse:
        message = raw_message.strip()
        language = get_supported_language(language_code)
        sentiment = detect_sentiment(message)

        guarded_response = await self._guarded_response(message, language, sentiment)
        if guarded_response:
            return guarded_response

        try:
            result = await self.retrieve_chunks(message)
        except Exception:
            return await self._fallback_response(message, language, sentiment)

        if not result.rows:
            return await self._fallback_response(message, language, sentiment)

        if not result.confident:
            return ChatResponse(
                mode="grounded",
                message=await self.localize(LOW_CONFIDENCE_RESPONSE, language),
                confidence="low",
                confidenceScore=result.confidence_score,
                sources=[],
                sentiment=sentiment,
                escalation=Escalation(
                    reason="The chatbot found low-confidence context and could not answer reliably.",
                    priority="normal",
                ),
            )

        context = "\n\n---\n\n".join(
            f"[Source {index + 1}]\nTitle: {row.title}\nURL: {row.url}\n\n{row.content}"
            for index, row in enumerate(result.rows)
        )
        language_instruction = get_language_instruction(language)
        user_message = (
            f"{language_instruction}\n\nUser question: {message}\n\n"
            f"Context from BYU-Hawaii Financial Aid website:\n{context}"
        )

        try:
            completion = await self.client.chat.completions.create(
                model=self.settings.openai_chat_model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.1,
                max_tokens=800,
            )
            answer = completion.choices[0].message.content or "Sorry, I could not generate a response. Please try again."
        except Exception:
            return await self._fallback_response(message, language, sentiment)

        sources = list(dict.fromkeys(row.url for row in result.rows))
        escalation = None
        if sentiment.label in {"urgent", "frustrated"}:
            escalation = Escalation(
                reason=f"Detected {sentiment.label} user sentiment.",
                priority="high" if sentiment.label == "frustrated" else "normal",
            )

        return ChatResponse(
            mode="grounded",
            message=answer,
            confidence="high",
            confidenceScore=result.confidence_score,
            sources=sources,
            sentiment=sentiment,
            escalation=escalation,
        )

    async def retrieve_chunks(self, message: str) -> RetrievalResult:
        if not self.pool:
            raise RuntimeError("Database pool is not initialized.")

        try:
            embedding_response = await self.client.embeddings.create(
                model=self.settings.openai_embedding_model,
                input=message,
            )
            vector_literal = str(embedding_response.data[0].embedding)
            rows = await self.pool.fetch(
                """
                SELECT chunks.content, pages.url, pages.title,
                       chunks.embedding <=> $1::vector AS distance
                FROM chunks
                INNER JOIN pages ON chunks.page_id = pages.id
                ORDER BY chunks.embedding <=> $1::vector
                LIMIT 6
                """,
                vector_literal,
            )
            if rows:
                best_distance = float(rows[0]["distance"])
                return RetrievalResult(
                    rows=[to_context_row(row) for row in rows],
                    confident=best_distance < self.settings.relevance_threshold,
                    confidence_score=max(0, min(100, round((1 - best_distance) * 100))),
                )
        except Exception:
            pass

        terms = [
            term
            for term in re.sub(r"[^\w\s]", " ", message.lower()).split()
            if len(term) > 2
        ][:8]
        if not terms:
            return RetrievalResult(rows=[], confident=False, confidence_score=0)

        like_terms = [f"%{term}%" for term in terms]
        conditions = " OR ".join(f"chunks.content ILIKE ${index}" for index in range(1, len(like_terms) + 1))
        rows = await self.pool.fetch(
            f"""
            SELECT chunks.content, pages.url, pages.title
            FROM chunks
            INNER JOIN pages ON chunks.page_id = pages.id
            WHERE {conditions}
            LIMIT 6
            """,
            *like_terms,
        )
        return RetrievalResult(
            rows=[to_context_row(row) for row in rows],
            confident=len(rows) >= 2,
            confidence_score=65 if len(rows) >= 2 else 35 if rows else 0,
        )

    async def localize(self, message: str, language: tuple[str, str, str]) -> str:
        code, name, native_name = language
        if code == DEFAULT_LANGUAGE_CODE:
            return message
        try:
            completion = await self.client.chat.completions.create(
                model=self.settings.openai_chat_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Translate chatbot responses. Preserve Markdown, URLs, email addresses, phone numbers, and official program names.",
                    },
                    {
                        "role": "user",
                        "content": f"Translate this response into {name} ({native_name}):\n\n{message}",
                    },
                ],
                temperature=0.1,
                max_tokens=800,
            )
            return completion.choices[0].message.content or message
        except Exception:
            return message

    async def _guarded_response(
        self,
        message: str,
        language: tuple[str, str, str],
        sentiment: Sentiment,
    ) -> ChatResponse | None:
        if matches(SENSITIVE_INFO_PATTERNS, message):
            return ChatResponse(
                mode="guard",
                message=await self.localize(SENSITIVE_INFO_RESPONSE, language),
                confidence=None,
                confidenceScore=None,
                sources=[],
                sentiment=sentiment,
            )
        if matches(CONVERSATIONAL_OPENER_PATTERNS, message):
            return ChatResponse(
                mode="conversational",
                message=await self.localize(CONVERSATIONAL_OPENER_RESPONSE, language),
                confidence=None,
                confidenceScore=None,
                sources=[],
                sentiment=sentiment,
            )
        if matches(FRUSTRATION_PATTERNS, message):
            return ChatResponse(
                mode="guard",
                message=await self.localize(FRUSTRATION_RESPONSE, language),
                confidence=None,
                confidenceScore=None,
                sources=[],
                sentiment=sentiment,
                escalation=Escalation(reason="The user appears frustrated and may need human support.", priority="high"),
            )
        if matches(OUT_OF_SCOPE_PATTERNS, message):
            return ChatResponse(
                mode="guard",
                message=await self.localize(OUT_OF_SCOPE_RESPONSE, language),
                confidence=None,
                confidenceScore=None,
                sources=[],
                sentiment=sentiment,
            )
        return None

    async def _fallback_response(
        self,
        message: str,
        language: tuple[str, str, str],
        sentiment: Sentiment,
    ) -> ChatResponse:
        lower_message = message.lower()
        for keyword, answer in DEMO_ANSWERS.items():
            if keyword in lower_message:
                return ChatResponse(
                    mode="demo",
                    message=await self.localize(answer, language),
                    confidence="high",
                    confidenceScore=80,
                    sources=[],
                    sentiment=sentiment,
                )

        return ChatResponse(
            mode="unavailable",
            message=await self.localize(UNAVAILABLE_RESPONSE, language),
            confidence="low",
            confidenceScore=0,
            sources=[],
            sentiment=sentiment,
            escalation=Escalation(
                reason="The chatbot could not access a reliable knowledge-base answer.",
                priority="high",
            ),
        )


def get_supported_language(language_code: str | None) -> tuple[str, str, str]:
    if not language_code:
        return ("en", *SUPPORTED_LANGUAGES["en"])
    normalized = language_code.lower()
    for code, names in SUPPORTED_LANGUAGES.items():
        if normalized == code or normalized.startswith(f"{code}-"):
            return (code, *names)
    return ("en", *SUPPORTED_LANGUAGES["en"])


def get_language_instruction(language: tuple[str, str, str]) -> str:
    code, name, native_name = language
    if code == DEFAULT_LANGUAGE_CODE:
        return "Respond in English."
    return (
        f"Respond in {name} ({native_name}). Keep BYU-Hawaii, Financial Aid office names, "
        "email addresses, phone numbers, URLs, and official program names accurate."
    )


def detect_sentiment(message: str) -> Sentiment:
    if matches(FRUSTRATION_PATTERNS, message):
        return Sentiment(label="frustrated", score=0.9)
    if re.search(r"\b(urgent|asap|immediately|right now|emergency|deadline today|due today)\b", message, re.I):
        return Sentiment(label="urgent", score=0.85)
    if re.search(r"\b(confused|lost|don't understand|do not understand|unclear|not sure|help me understand)\b", message, re.I):
        return Sentiment(label="confused", score=0.72)
    return Sentiment(label="neutral", score=0.2)


def matches(patterns: list[re.Pattern[str]], message: str) -> bool:
    return any(pattern.search(message) for pattern in patterns)


def to_context_row(row: Any) -> ContextRow:
    return ContextRow(content=row["content"], url=row["url"], title=row["title"])
