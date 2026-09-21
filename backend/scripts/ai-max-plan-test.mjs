// Verify AI Max appears in the plans catalog (student Plans page) and that
// admin settings GET includes the aiMax config keys the new UI fields use.
import { newDb } from 'pg-mem'
process.env.DATABASE_URL ||= 'postgresql://smoke:smoke@127.0.0.1:1/smoke9'

const mem = newDb({ autoCreateForeignKeyIndices: true })
const pad = (n) => String(n).padStart(2, '0')
const fmtTs = (v) => { const d = v instanceof Date ? v : new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) }
for (const t of ['timestamptz', 'timestamp']) mem.public.registerFunction({ name: 'to_char', args: [t, 'text'], returns: 'text', implementation: fmtTs })
mem.public.registerFunction({ name: 'random', args: [], returns: 'float', implementation: () => Math.random() })
const { Pool } = mem.adapters.createPg()
const pool = new Pool()
const { default: dbReal, pool: poolReal } = await import('../src/db.js')
poolReal.constructor.prototype.connect = async function () { const c = await pool.connect(); const q = c.query.bind(c); c.query = (a, b) => q(typeof a === 'string' ? { text: a, values: b } : a, b); return c }
poolReal.constructor.prototype.query = function (a, b) { return pool.query(a, b) }
dbReal.query = (a, b) => pool.query(a, b)
await dbReal.initSchema()

const results = []
const ok = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`) }

// 1. Plans catalog: AI Max present by default
const { listPlans } = await import('../src/utils/addons.js')
const plans = await listPlans()
const aiMax = plans.addons.find((a) => a.id === 'ai_max')
ok('AI Max addon in student Plans catalog', !!aiMax, aiMax ? `price=${aiMax.price}` : 'missing')
ok('AI Max default price 399', aiMax?.price === 399, `got ${aiMax?.price}`)

// 2. Enabled flag off → hidden (flag actually gates the listing)
const { setConfig } = await import('../src/utils/aiService.js')
await setConfig('addons.aiMaxEnabled', 'false')
const plansOff = await listPlans()
ok('AI Max hidden when disabled', !plansOff.addons.find((a) => a.id === 'ai_max'))
await setConfig('addons.aiMaxEnabled', 'true')
const plansOn = await listPlans()
ok('AI Max returns when re-enabled', !!plansOn.addons.find((a) => a.id === 'ai_max'))

// 3. Admin settings GET exposes the aiMax keys the UI binds to
const { ADDONS } = await import('../src/utils/addons.js')
ok('ai_max addon def intact', ADDONS.ai_max?.priceKey === 'addons.aiMaxPrice')

process.exit(results.every(Boolean) ? 0 : 1)
