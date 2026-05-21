import { db } from "../db"
import {
  messageFeedback,
  chatMessages,
  conversations,
  sessions,
} from "../db/schema"

async function clearChatData() {
  console.log("Clearing chat history, sessions, and feedback...\n")

  const fb = await db.delete(messageFeedback).returning({ id: messageFeedback.id })
  console.log(`✓ message_feedback: ${fb.length} rows deleted`)

  const msgs = await db.delete(chatMessages).returning({ id: chatMessages.id })
  console.log(`✓ chat_messages:    ${msgs.length} rows deleted`)

  // Deleting conversations cascades to support_requests (via conversationId FK)
  const convs = await db.delete(conversations).returning({ id: conversations.id })
  console.log(`✓ conversations:    ${convs.length} rows deleted`)

  // Deleting sessions cascades to any remaining support_requests (via sessionId FK)
  const sess = await db.delete(sessions).returning({ id: sessions.id })
  console.log(`✓ sessions:         ${sess.length} rows deleted`)

  console.log("\nDone — ready for fresh testing.")
}

clearChatData().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
