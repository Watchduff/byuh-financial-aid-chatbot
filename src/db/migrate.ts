import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { migrate } from "drizzle-orm/neon-http/migrator"
import { db } from "./index"

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" })
  console.log("Migrations complete")
}

main().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})