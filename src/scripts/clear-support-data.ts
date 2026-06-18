import { db } from "../db"
import { typingStates, agentMessages, supportRequests } from "../db/schema"

async function clearSupportData() {
  console.log("Clearing live support data...\n")

  const ts = await db.delete(typingStates).returning({ requestId: typingStates.requestId })
  console.log(`✓ typing_states:    ${ts.length} rows deleted`)

  const am = await db.delete(agentMessages).returning({ id: agentMessages.id })
  console.log(`✓ agent_messages:   ${am.length} rows deleted`)

  const sr = await db.delete(supportRequests).returning({ id: supportRequests.id })
  console.log(`✓ support_requests: ${sr.length} rows deleted`)

  console.log("\nDone — live support queue cleared.")
}

clearSupportData().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
