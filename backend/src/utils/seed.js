import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import db from '../db.js'

const seed = async () => {
  await db.initSchema()

  // Admin + demo student
  const adminHash = bcrypt.hashSync('admin123', 10)
  const studentHash = bcrypt.hashSync('student123', 10)
  await db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO NOTHING`)
    .run('Admin', 'admin@examai.app', adminHash, 'admin')
  await db.prepare(`INSERT INTO users (name, email, password_hash, role, target_exam) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO NOTHING`)
    .run('Aarav Sharma', 'student@examai.app', studentHash, 'student', 'JEE Main')

  // Default AI config (placeholders - user adds real keys in Admin > AI Config)
  const defaults = {
    'ai.provider': 'deepseek',
    'ai.fallbackEnabled': 'true',
    'deepseek.model': 'deepseek-chat',
    'gemini.model': 'gemini-2.0-flash',
    'gemini.visionModel': 'gemini-2.0-flash',
    'openrouter.model': 'deepseek/deepseek-chat-v3-0324:free',
    'platform.name': 'ExamAI',
    'platform.tagline': 'AI-Powered Mock Test & Practice Platform'
  }
  for (const [k, v] of Object.entries(defaults)) {
    await db.prepare(`INSERT INTO ai_configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`).run(k, v)
  }

  // Seed exams with syllabus
  const exams = [
    {
      code: 'JEE-MAIN', name: 'JEE Main', duration_minutes: 180, total_questions: 90, marks_per_question: 4, negative_marks: 1,
      icon: 'gear', description: 'Joint Entrance Examination Main for engineering aspirants',
      subjects: [
        { name: 'Physics', chapters: [{ name: 'Mechanics', topics: ['Laws of Motion', 'Work, Energy and Power', 'Rotational Motion'] }, { name: 'Electrodynamics', topics: ['Current Electricity', 'Electrostatics'] }] },
        { name: 'Chemistry', chapters: [{ name: 'Physical Chemistry', topics: ['Mole Concept', 'Thermodynamics'] }, { name: 'Organic Chemistry', topics: ['GOC', 'Alkanes & Alkenes'] }] },
        { name: 'Mathematics', chapters: [{ name: 'Algebra', topics: ['Quadratic Equations', 'Sequence and Series'] }, { name: 'Calculus', topics: ['Limits and Continuity', 'Differentiation'] }] }
      ]
    },
    {
      code: 'NEET', name: 'NEET UG', duration_minutes: 200, total_questions: 200, marks_per_question: 4, negative_marks: 1,
      icon: 'dna', description: 'National Eligibility cum Entrance Test for medical aspirants',
      subjects: [
        { name: 'Physics', chapters: [{ name: 'Mechanics', topics: ['Kinematics', 'Laws of Motion'] }] },
        { name: 'Chemistry', chapters: [{ name: 'Inorganic', topics: ['Periodic Table', 'Chemical Bonding'] }] },
        { name: 'Biology', chapters: [{ name: 'Botany', topics: ['Plant Kingdom', 'Photosynthesis'] }, { name: 'Zoology', topics: ['Human Physiology', 'Genetics'] }] }
      ]
    },
    {
      code: 'SSC-CGL', name: 'SSC CGL', duration_minutes: 60, total_questions: 100, marks_per_question: 2, negative_marks: 0.5,
      icon: 'book', description: 'Staff Selection Commission Combined Graduate Level',
      subjects: [
        { name: 'Quantitative Aptitude', chapters: [{ name: 'Arithmetic', topics: ['Percentage', 'Time and Work', 'Ratio and Proportion'] }] },
        { name: 'Reasoning', chapters: [{ name: 'Verbal Reasoning', topics: ['Analogy', 'Coding Decoding'] }, { name: 'Non-Verbal', topics: ['Series', 'Figure Counting'] }] },
        { name: 'English', chapters: [{ name: 'Grammar', topics: ['Spotting Errors', 'Sentence Improvement'] }] }
      ]
    },
    {
      code: 'UPSC-CSE', name: 'UPSC Civil Services', duration_minutes: 120, total_questions: 100, marks_per_question: 2, negative_marks: 0.66,
      icon: 'landmark', description: 'Union Public Service Commission Civil Services Prelims',
      subjects: [
        { name: 'General Studies', chapters: [{ name: 'History', topics: ['Ancient India', 'Modern India'] }, { name: 'Polity', topics: ['Constitution', 'Governance'] }] },
        { name: 'Economy', chapters: [{ name: 'Indian Economy', topics: ['Budgeting', 'Banking Sector'] }] },
        { name: 'Environment', chapters: [{ name: 'Ecology', topics: ['Biodiversity', 'Climate Change'] }] }
      ]
    },
    {
      code: 'BANK-PO', name: 'Banking PO', duration_minutes: 120, total_questions: 155, marks_per_question: 1, negative_marks: 0.25,
      icon: 'bank', description: 'IBPS/SBI Probationary Officer',
      subjects: [
        { name: 'Quantitative Aptitude', chapters: [{ name: 'Arithmetic', topics: ['Simplification', 'Data Interpretation'] }] },
        { name: 'Reasoning', chapters: [{ name: 'Puzzle', topics: ['Seating Arrangement', 'Syllogism'] }] },
        { name: 'English', chapters: [{ name: 'Comprehension', topics: ['Reading Comprehension', 'Cloze Test'] }] }
      ]
    },
    {
      code: 'CAT', name: 'CAT', duration_minutes: 120, total_questions: 66, marks_per_question: 3, negative_marks: 1,
      icon: 'graduation-cap', description: 'Common Admission Test for MBA',
      subjects: [
        { name: 'Quant', chapters: [{ name: 'Arithmetic', topics: ['Percentages', 'Profit and Loss', 'Mixtures'] }, { name: 'Algebra', topics: ['Inequalities', 'Functions'] }] },
        { name: 'LRDI', chapters: [{ name: 'Logical Reasoning', topics: ['Arrangements', 'Cubes'] }, { name: 'Data Interpretation', topics: ['Tables and Charts', 'Caselets'] }] },
        { name: 'VARC', chapters: [{ name: 'Verbal', topics: ['RC', 'Para Jumbles'] }] }
      ]
    },
    {
      code: 'GATE', name: 'GATE', duration_minutes: 180, total_questions: 65, marks_per_question: 2, negative_marks: 0.66,
      icon: 'wrench', description: 'Graduate Aptitude Test in Engineering',
      subjects: [
        { name: 'Core Subject', chapters: [{ name: 'General Aptitude', topics: ['Numerical Ability', 'Verbal Ability'] }] },
        { name: 'Engineering Maths', chapters: [{ name: 'Maths', topics: ['Linear Algebra', 'Calculus', 'Probability'] }] }
      ]
    },
    {
      code: 'CUET', name: 'CUET UG', duration_minutes: 60, total_questions: 50, marks_per_question: 5, negative_marks: 1,
      icon: 'school', description: 'Common University Entrance Test',
      subjects: [
        { name: 'General Test', chapters: [{ name: 'GK', topics: ['Current Affairs', 'Static GK'] }, { name: 'Maths', topics: ['Basic Maths', 'Data Interpretation'] }] },
        { name: 'Language', chapters: [{ name: 'English', topics: ['Vocabulary', 'Comprehension'] }] }
      ]
    }
  ]

  for (const e of exams) {
    await db.prepare(`INSERT INTO exams (code, name, description, icon, duration_minutes, total_questions, marks_per_question, negative_marks, subjects_json, is_active)
      VALUES (?,?,?,?,?,?,?,?,?,1) ON CONFLICT(code) DO NOTHING`)
      .run(e.code, e.name, e.description, e.icon, e.duration_minutes, e.total_questions, e.marks_per_question, e.negative_marks, JSON.stringify(e.subjects.map(s => s.name)))
    const exam = await db.prepare('SELECT * FROM exams WHERE code = ?').get(e.code)
    for (const [si, s] of e.subjects.entries()) {
      await db.prepare(`INSERT INTO subjects (exam_id, name, sort_order) VALUES (?, ?, ?) ON CONFLICT(exam_id, name) DO NOTHING`)
        .run(exam.id, s.name, si)
      const sub = await db.prepare('SELECT * FROM subjects WHERE exam_id = ? AND name = ?').get(exam.id, s.name)
      for (const [ci, c] of s.chapters.entries()) {
        await db.prepare(`INSERT INTO chapters (subject_id, exam_id, name, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(subject_id, name) DO NOTHING`)
          .run(sub.id, exam.id, c.name, ci)
        const chap = await db.prepare('SELECT * FROM chapters WHERE subject_id = ? AND name = ?').get(sub.id, c.name)
        for (const [ti, t] of c.topics.entries()) {
          await db.prepare(`INSERT INTO topics (chapter_id, exam_id, name, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(chapter_id, name) DO NOTHING`)
            .run(chap.id, exam.id, t, ti)
        }
      }
    }
  }

  // Seed a few sample questions (physics, mechanics) so the platform works offline
  const seedQuestions = [
    {
      exam: 'JEE-MAIN', subject: 'Physics', chapter: 'Mechanics', topic: 'Laws of Motion',
      qtype: 'single', question: 'A 2 kg block rests on a frictionless horizontal surface. A force of 10 N is applied horizontally for 4 seconds. What is the final velocity of the block?',
      options: ['A. 5 m/s', 'B. 10 m/s', 'C. 20 m/s', 'D. 40 m/s'], answer: 'C',
      explanation: "Using Newton's second law, a = F/m = 10/2 = 5 m/s². Since the surface is frictionless, this acceleration is constant. Final velocity v = u + at = 0 + 5 × 4 = 20 m/s. Hence option C is correct.",
      difficulty: 'easy', marks: 4, neg: 1, est: 60, tags: ["Newton's Laws", 'Force'], source: 'ai'
    },
    {
      exam: 'JEE-MAIN', subject: 'Physics', chapter: 'Mechanics', topic: 'Laws of Motion',
      qtype: 'single', question: 'A body of mass 5 kg is moving with a velocity of 10 m/s. A constant force of 20 N acts on it opposite to the direction of motion. How much time is required to bring it to rest?',
      options: ['A. 1 s', 'B. 2 s', 'C. 2.5 s', 'D. 5 s'], answer: 'C',
      explanation: 'Deceleration a = F/m = 20/5 = 4 m/s². Using v = u - at, 0 = 10 - 4t, so t = 2.5 s. Option C is correct.',
      difficulty: 'medium', marks: 4, neg: 1, est: 75, tags: ['Momentum', 'Force'], source: 'ai'
    },
    {
      exam: 'JEE-MAIN', subject: 'Chemistry', chapter: 'Physical Chemistry', topic: 'Mole Concept',
      qtype: 'numerical', question: 'How many moles of oxygen atoms are present in 49 g of H₂SO₄? (Molar mass of H₂SO₄ = 98 g/mol)',
      options: [], answer: '2',
      explanation: 'Moles of H₂SO₄ = 49/98 = 0.5 mol. Each H₂SO₄ molecule has 4 oxygen atoms, so moles of O atoms = 0.5 × 4 = 2 mol.',
      difficulty: 'medium', marks: 4, neg: 1, est: 90, tags: ['Mole Concept', 'Stoichiometry'], source: 'ai'
    },
    {
      exam: 'JEE-MAIN', subject: 'Mathematics', chapter: 'Algebra', topic: 'Quadratic Equations',
      qtype: 'single', question: 'If α and β are the roots of the equation x² - 5x + 6 = 0, then the value of α² + β² is:',
      options: ['A. 13', 'B. 25', 'C. 11', 'D. 37'], answer: 'A',
      explanation: 'Sum of roots α + β = 5, product αβ = 6. α² + β² = (α + β)² - 2αβ = 25 - 12 = 13. Option A is correct.',
      difficulty: 'easy', marks: 4, neg: 1, est: 60, tags: ['Roots', 'Vieta'], source: 'ai'
    },
    {
      exam: 'SSC-CGL', subject: 'Quantitative Aptitude', chapter: 'Arithmetic', topic: 'Percentage',
      qtype: 'single', question: 'A number is increased by 20% and then decreased by 20%. What is the net change in the number?',
      options: ['A. 4% increase', 'B. 4% decrease', 'C. No change', 'D. 2% decrease'], answer: 'B',
      explanation: 'Let the number be 100. After 20% increase: 120. After 20% decrease: 120 × 0.8 = 96. Net change = -4%, i.e., a 4% decrease. Option B is correct.',
      difficulty: 'easy', marks: 2, neg: 0.5, est: 45, tags: ['Percentage'], source: 'ai'
    },
    {
      exam: 'NEET', subject: 'Biology', chapter: 'Zoology', topic: 'Genetics',
      qtype: 'single', question: 'In a dihybrid cross between two heterozygous pea plants (RrYy × RrYy), what fraction of offspring will be homozygous recessive for both traits?',
      options: ['A. 1/16', 'B. 1/8', 'C. 1/4', 'D. 9/16'], answer: 'A',
      explanation: 'For each gene, the probability of homozygous recessive is 1/4. For two independent genes: (1/4) × (1/4) = 1/16. Option A is correct.',
      difficulty: 'medium', marks: 4, neg: 1, est: 60, tags: ['Mendelian Genetics'], source: 'ai'
    }
  ]

  for (const sq of seedQuestions) {
    const exam = await db.prepare('SELECT * FROM exams WHERE code = ?').get(sq.exam)
    if (!exam) continue
    const sub = await db.prepare('SELECT * FROM subjects WHERE exam_id = ? AND name = ?').get(exam.id, sq.subject)
    const chap = sub ? await db.prepare('SELECT * FROM chapters WHERE subject_id = ? AND name = ?').get(sub.id, sq.chapter) : null
    const topic = chap ? await db.prepare('SELECT * FROM topics WHERE chapter_id = ? AND name = ?').get(chap.id, sq.topic) : null
    const hash = crypto.createHash('sha256').update(sq.question).digest('hex').slice(0, 32)
    await db.prepare(`INSERT INTO questions (exam_id, subject_id, chapter_id, topic_id, qtype, question_text, options_json, correct_answer, explanation, difficulty, marks, negative_marks, estimated_time, tags_json, source, content_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(content_hash) DO NOTHING`)
      .run(exam.id, sub?.id || null, chap?.id || null, topic?.id || null, sq.qtype, sq.question, JSON.stringify(sq.options),
        sq.answer, sq.explanation, sq.difficulty, sq.marks, sq.neg, sq.est, JSON.stringify(sq.tags), 'ai', hash)
  }

  // Seed one demo mock test from the question bank
  const jeemain = await db.prepare('SELECT id FROM exams WHERE code = ?').get('JEE-MAIN')
  const bankQuestions = await db.prepare('SELECT id FROM questions WHERE exam_id = ? LIMIT 4').all(jeemain.id)
  if (bankQuestions.length >= 3) {
    const existing = await db.prepare('SELECT id FROM tests WHERE title = ?').get('JEE Main Practice Mock 1')
    if (!existing) {
      const r = await db.prepare(`INSERT INTO tests (exam_id, title, description, kind, config_json, created_by, is_active)
        VALUES (?, ?, 'Seeded demo test from the AI question bank', 'mock', '{"numQuestions":4,"duration":10}', 1, 1) RETURNING id`)
        .run(jeemain.id, 'JEE Main Practice Mock 1')
      for (let i = 0; i < bankQuestions.length; i++) {
        await db.prepare(`INSERT INTO test_questions (test_id, question_id, position) VALUES (?,?,?) ON CONFLICT(test_id, question_id) DO NOTHING`)
          .run(r.lastInsertRowid, bankQuestions[i].id, i)
      }
    }
  }

  console.log('Seed complete.')
  console.log('  Admin login:  admin@examai.app / admin123')
  console.log('  Student login: student@examai.app / student123')
}

export { seed }

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
}
