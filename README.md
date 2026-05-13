# BYU–Hawaii Financial Aid Assistant

An AI-powered chatbot that answers student questions about financial aid at BYU–Hawaii — scholarships, FAFSA, tuition, iWork, grants, and deadlines — backed by a live-support escalation system for human advisors.

---

## Features

- **RAG chatbot** — Answers questions using content scraped from `financialaid.byuh.edu`, embedded with OpenAI, and retrieved via pgvector cosine similarity
- **Source citations** — Every response links back to the original BYUH web pages
- **Live support escalation** — Students can request a human advisor; messages are delivered in real time via polling
- **Admin dashboard** — Advisors log in, view support requests, reply to students, and update request status
- **Session history** — Conversations are stored per browser session; students can switch between past chats
- **Mobile-friendly** — Responsive layout with collapsible sidebar

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | Neon PostgreSQL (serverless) |
| ORM | Drizzle ORM |
| Vector search | pgvector (`<=>` cosine similarity) |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims) |
| AI responses | Anthropic Claude (`claude-haiku-4-5`) |
| Scraping | Axios + Cheerio (BFS crawler) |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                        # Student chatbot UI
│   ├── layout.tsx
│   ├── globals.css
│   ├── admin/
│   │   ├── page.tsx                    # Admin login
│   │   └── dashboard/
│   │       ├── page.tsx                # Support request list
│   │       └── [id]/page.tsx           # Individual request + reply
│   └── api/
│       ├── chat/route.ts               # RAG chat endpoint
│       ├── support-requests/route.ts   # Create support request
│       ├── user/agent-messages/        # Student polling endpoint
│       └── admin/
│           ├── auth/route.ts           # Admin login/logout
│           ├── support-requests/       # List + update requests
│           └── agent-messages/         # Send/fetch agent replies
├── components/
│   ├── Sidebar.tsx
│   ├── IntroScreen.tsx
│   ├── ChatWindow.tsx
│   ├── ChatInput.tsx
│   ├── MessageBubble.tsx
│   └── LoadingIndicator.tsx
├── db/
│   ├── index.ts                        # Drizzle + Neon client
│   ├── schema.ts                       # Tables: pages, chunks, conversations, messages, supportRequests, agentMessages
│   └── migrate.ts                      # Migration runner
├── lib/
│   ├── scraper.ts                      # Single-page content extractor
│   ├── chunker.ts                      # Text splitter
│   ├── openai.ts                       # Embedding helper
│   ├── adminAuth.ts                    # Cookie-based admin auth
│   └── useChat.ts                      # Custom React chat hook
└── scripts/
    └── ingest.ts                       # BFS crawler + embed pipeline
drizzle/
├── 0000_first_sister_grimm.sql         # Initial schema
├── 0001_sticky_annihilus.sql           # Sessions + conversations
├── 0002_add_support_requests.sql       # Support request table
├── 0003_add_agent_messages.sql         # Agent messages + assignedAgentName
└── meta/_journal.json
```

---

## Setup

### 1. Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- A [Neon](https://neon.tech) PostgreSQL database with the `pgvector` extension enabled
- An [OpenAI](https://platform.openai.com) API key
- An [Anthropic](https://console.anthropic.com) API key

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

Create `.env.local` in the project root:

```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
ADMIN_SECRET=your-admin-password
FASTAPI_URL=http://localhost:8000
```

`FASTAPI_URL` is optional. When it is set, the Next.js `/api/chat` route forwards chat requests to the FastAPI backend. When it is not set, the original Next.js handler runs locally.

### 4. Push the database schema

```bash
pnpm db:push
```

This uses Drizzle's push mode to create all tables directly from `src/db/schema.ts`.

### 5. Run the ingestion pipeline

Crawls `financialaid.byuh.edu`, scrapes content, chunks it, embeds it, and stores it in the database.

```bash
pnpm ingest
```

This takes a few minutes. It processes up to 60 pages with a polite 500 ms delay between requests.

### 6. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) for the student chatbot.
Open [http://localhost:3000/admin](http://localhost:3000/admin) for the admin portal.

### Optional: Run the FastAPI backend

Install the Python dependencies:

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r backend/requirements.txt
```

Start FastAPI on port 8000:

```bash
pnpm fastapi:dev
```

With `FASTAPI_URL=http://localhost:8000` in `.env.local`, Next.js keeps serving the UI while FastAPI handles the heavier RAG chat workload through `POST /chat`.

---

## Available Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start development server on port 3000 |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm fastapi:dev` | Start the FastAPI backend on port 8000 |
| `pnpm ingest` | Run the BFS scraper + embedding pipeline |
| `pnpm db:push` | Push schema changes to the database |
| `pnpm db:generate` | Generate Drizzle migration files |
| `pnpm db:migrate` | Run migration files against the database |

---

## Admin Access

Navigate to `/admin` and enter the password set in `ADMIN_SECRET`.

From the dashboard, advisors can:
- View all support requests filtered by status (pending / assigned / resolved / closed)
- Click into a request to see the full conversation history
- Send replies that appear in the student's chat in real time (3-second polling)
- Update the request status

---

## Re-ingesting Content

The ingestion pipeline is idempotent — re-running it updates existing pages and replaces stale chunks:

```bash
pnpm ingest
```

The scraper stays within `financialaid.byuh.edu` and respects a crawl limit of 60 pages.
