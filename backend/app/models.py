from typing import Literal

from pydantic import BaseModel, Field


SentimentLabel = Literal["neutral", "confused", "frustrated", "urgent"]
ResponseMode = Literal["grounded", "demo", "unavailable"]
Confidence = Literal["high", "low"]


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    languageCode: str | None = None
    sessionId: str | None = None
    conversationId: str | None = None
    conversationTitle: str | None = None


class Sentiment(BaseModel):
    label: SentimentLabel
    score: float


class Escalation(BaseModel):
    shouldEscalate: bool = True
    reason: str
    priority: Literal["normal", "high"] = "normal"


class ChatResponse(BaseModel):
    mode: ResponseMode
    message: str
    confidence: Confidence
    confidenceScore: int
    sources: list[str] = Field(default_factory=list)
    sentiment: Sentiment | None = None
    escalation: Escalation | None = None
    stored: bool = False
