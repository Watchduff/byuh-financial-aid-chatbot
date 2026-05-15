import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { neon } from "@neondatabase/serverless"

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing in .env.local")
  process.exit(1)
}

async function migrate() {
  const sql = neon(process.env.DATABASE_URL!)

  await sql`CREATE EXTENSION IF NOT EXISTS vector`
  console.log("pgvector extension ready")

  await sql`
    CREATE TABLE IF NOT EXISTS pages (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS chunks (
      id SERIAL PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      embedding vector(1536),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  await sql`
    CREATE INDEX IF NOT EXISTS chunks_embedding_idx
    ON chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New Conversation',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      response_mode TEXT,
      response_confidence TEXT,
      response_confidence_score INTEGER,
      response_sources TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  await sql`
    CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx
    ON chat_messages (conversation_id, created_at)
  `

  await sql`
    CREATE TABLE IF NOT EXISTS support_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      user_message TEXT NOT NULL,
      user_email TEXT,
      user_phone TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_agent_name TEXT,
      deleted_from_status TEXT,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      support_request_id TEXT NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  console.log("All migrations complete!")
}

migrate().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
