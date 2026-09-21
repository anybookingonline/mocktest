// Server entry: imports the configured Express app (routes, middleware, error
// handling and static dist/ serving) and starts listening.
import app from './app.js'
import db from './db.js'
import { seed } from './utils/seed.js'
import { purgeExpiredData } from './utils/retention.js'

const PORT = process.env.PORT || 3001

async function main() {
  try {
    await db.initSchema()
    console.log('[db] Postgres schema ready')
  } catch (e) {
    console.error('[db] Schema init failed:', e.message)
    process.exit(1)
  }
  // Seed is idempotent (ON CONFLICT DO NOTHING) — har start par safe. Naya
  // syllabus, icon migration aur admin account (agar ADMIN_PASSWORD set ho)
  // yahin se production me automatically apply ho jate hain.
  try {
    await seed()
  } catch (e) {
    console.error('[seed] Seed failed (server continue kar raha hai):', e.message)
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ExamAI backend running on http://0.0.0.0:${PORT}`)
  })

  const runPurge = async () => {
    try {
      const res = await purgeExpiredData()
      if (res.purgedUsers > 0) console.log('[retention] purged', res.purgedUsers, 'user(s):', JSON.stringify(res.stats))
    } catch (e) {
      console.error('[retention] purge error:', e.message)
    }
  }
  runPurge()
  setInterval(runPurge, 60 * 60 * 1000)
}

main()
