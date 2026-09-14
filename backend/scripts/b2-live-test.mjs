// Live B2 self-test: loads .env.local (without printing any values) and runs
// the full authorize → upload → download → delete round-trip via utils/b2.js.
import fs from 'fs'
import path from 'path'

const envPath = path.resolve(process.cwd(), '../.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const { b2SelfTest, b2Status } = await import('../src/utils/b2.js')

console.log('Storage status:', JSON.stringify(await b2Status(), (k, v) => v))
const r = await b2SelfTest()
console.log('\n=== B2 SELF TEST ===')
for (const s of r.steps) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}  ${s.info}`)
console.log(r.ok ? '\nALL GREEN ✅ — B2 storage live' : '\nFAILED ❌')
process.exit(r.ok ? 0 : 1)
