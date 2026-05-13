from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .models import ChatRequest, ChatResponse
from .rag import RagService


settings = get_settings()
rag_service = RagService(settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await rag_service.connect()
    yield
    await rag_service.close()


app = FastAPI(
    title="BYU-Hawaii Financial Aid Assistant API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required.")
    response = await rag_service.answer(message, request.languageCode)
    if request.sessionId and request.conversationId:
        response.stored = await rag_service.store_chat_turn(
            session_id=request.sessionId,
            conversation_id=request.conversationId,
            conversation_title=request.conversationTitle,
            user_message=message,
            assistant_response=response,
        )
    return response
