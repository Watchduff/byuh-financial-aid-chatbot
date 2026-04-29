import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  customType,
} from "drizzle-orm/pg-core"

// OpenAI text-embedding-3-small produces 1536-dimensional vectors
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)"
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value)
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value)
  },
})

// pages — one row per scraped URL
export const pages = pgTable("pages", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(),
  title: text("title").notNull(),
  scrapedAt: timestamp("scraped_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

// chunks — text segments split from a page, each with an embedding vector
export const chunks = pgTable("chunks", {
  id: serial("id").primaryKey(),
  pageId: integer("page_id")
    .references(() => pages.id, { onDelete: "cascade" })
    .notNull(),
  content: text("content").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  embedding: vector("embedding"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

// sessions — one anonymous session per browser (stored in HttpOnly cookie)
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
})

// conversations — a named thread belonging to a session
export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .references(() => sessions.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull().default("New Conversation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

// chat_messages — individual turns in a conversation
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export type Page = typeof pages.$inferSelect
export type NewPage = typeof pages.$inferInsert
export type Chunk = typeof chunks.$inferSelect
export type NewChunk = typeof chunks.$inferInsert
export type Session = typeof sessions.$inferSelect
export type Conversation = typeof conversations.$inferSelect
export type ChatMessage = typeof chatMessages.$inferSelect
