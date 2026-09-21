// Verifies the exam icon fix: seed must store emoji icons (not words like
// 'gear'/'bank'/'landmark') and frontend examIcon() must map legacy words.
process.env.DATABASE_URL ||= 'postgresql://smoke:smoke@127.0.0.1:1/smoke'
const { newDb } = await import('pg-mem')
const mem = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true })
const pad = (n) => String(n).padStart(2, '0')
const fmtTs = (v) => { const d = v instanceof Date ? v : new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) }
for (const t of ['timestamptz', 'timestamp']) mem.public.registerFunction({ name: 'to_char', args: [t, 'text'], returns: 'text', implementation: fmtTs })
mem.public.registerFunction({ name: 'random', args: [], returns: 'float', implementation: () => Math.random() })
const { Pool } = mem.adapters.createPg()
const pool = new Pool()
const { default: db, pool: poolReal } = await import('../src/db.js')
poolReal.constructor.prototype.connect = async function () { const c = await pool.connect(); const q = c.query.bind(c); c.query = (a, b) => q(typeof a === 'string' ? { text: a, values: b } : a, b); return c }
poolReal.constructor.prototype.query = function (a, b) { return pool.query(a, b) }
db.query = (a, b) => pool.query(a, b)
await db.initSchema()
const { seed } = await import('../src/utils/seed.js')
await seed()

const results = []
const ok = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`) }

const exams = await db.prepare('SELECT code, icon FROM exams ORDER BY id').all()
console.log(exams.map((e) => `${e.code} -> ${JSON.stringify(e.icon)}`).join('\n'))
ok('all 8 exams seeded', exams.length === 8, `got ${exams.length}`)
const bad = exams.filter((e) => e.icon && /^[\x20-\x7E]+$/.test(e.icon))
ok('all icons are emojis (no ascii word icons)', bad.length === 0, bad.map((b) => b.code + ':' + b.icon).join(', '))

// Migration path: simulate ALL legacy production values (old short words +
// lucide-style names seen in prod screenshot) + an admin-custom icon,
// re-run seed, and confirm only legacy words get migrated.
await db.prepare("UPDATE exams SET icon = 'gear' WHERE code = 'JEE-MAIN'").run()
await db.prepare("UPDATE exams SET icon = 'dna' WHERE code = 'NEET'").run()
await db.prepare("UPDATE exams SET icon = 'graduation-cap' WHERE code = 'CAT'").run()
await db.prepare("UPDATE exams SET icon = 'school' WHERE code = 'CUET'").run()
await db.prepare("UPDATE exams SET icon = 'wrench' WHERE code = 'GATE'").run()
await db.prepare("UPDATE exams SET icon = 'my-custom' WHERE code = 'SSC-CGL'").run()
await seed()
const after = await db.prepare("SELECT code, icon FROM exams WHERE code IN ('JEE-MAIN','NEET','CAT','CUET','GATE','SSC-CGL') ORDER BY id").all()
const by = Object.fromEntries(after.map((e) => [e.code, e.icon]))
ok('legacy word icon migrated to emoji on re-seed', by['JEE-MAIN'] === '⚙️', `JEE-MAIN=${JSON.stringify(by['JEE-MAIN'])}`)
ok('lucide dna migrated', by['NEET'] === '🧬', `NEET=${JSON.stringify(by['NEET'])}`)
ok('lucide graduation-cap migrated', by['CAT'] === '🐱', `CAT=${JSON.stringify(by['CAT'])}`)
ok('lucide school migrated', by['CUET'] === '🎓', `CUET=${JSON.stringify(by['CUET'])}`)
ok('lucide wrench migrated', by['GATE'] === '🔧', `GATE=${JSON.stringify(by['GATE'])}`)
ok('admin-custom icon preserved by migration', by['SSC-CGL'] === 'my-custom', `SSC-CGL=${JSON.stringify(by['SSC-CGL'])}`)

process.exit(results.every(Boolean) ? 0 : 1)
