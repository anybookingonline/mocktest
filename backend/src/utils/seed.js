import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import db from '../db.js'

const seed = async () => {
  await db.initSchema()

  // Admin account. Password comes from ADMIN_PASSWORD env (required in
  // production — no public default). No demo student is seeded: users register
  // themselves from the app, and the admin can create test users from
  // Admin → Users.
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) {
    console.warn('[seed] ADMIN_PASSWORD not set — admin account NOT created (set it in backend/.env)')
  } else {
    const adminHash = bcrypt.hashSync(adminPassword, 10)
    await db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO NOTHING`)
      .run('Admin', 'admin@examai.app', adminHash, 'admin')
  }

  // Default AI config (placeholders - user adds real keys in Admin > AI Config)
  // Pricing tiers (docs/product-pitch.md): free hook cap, paid soft-cap,
  // addon prices. ON CONFLICT DO NOTHING = admin-set values never overwritten.
  const defaults = {
    'ai.provider': 'deepseek',
    'ai.fallbackEnabled': 'true',
    'deepseek.model': 'deepseek-chat',
    'gemini.model': 'gemini-3.6-flash',
    'gemini.visionModel': 'gemini-3.6-flash',
    'openrouter.model': 'inclusionai/ling-3.0-flash-vl:free',
    'platform.name': 'ExamAI',
    'platform.tagline': 'AI-Powered Mock Test & Practice Platform',
    'monetization.freeDoubtsPerDay': '5',
    'monetization.paidDoubtsPerDay': '50',
    'monetization.price': '999',
    'addons.aiPowerPrice': '199',
    'addons.aiMaxPrice': '399',
    'addons.voicePrice': '99',
    'addons.caPrice': '99',
    'addons.focusPrice': '99'
  }
  for (const [k, v] of Object.entries(defaults)) {
    await db.prepare(`INSERT INTO ai_configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`).run(k, v)
  }

  // Seed exams with FULL syllabus (subject → chapter → topics).
  // Idempotent: ON CONFLICT DO NOTHING throughout, safe to re-run anytime —
  // existing installs gain the missing chapters/topics on next seed run.
  const exams = [
    {
      code: 'JEE-MAIN', name: 'JEE Main', duration_minutes: 180, total_questions: 90, marks_per_question: 4, negative_marks: 1,
      icon: 'gear', description: 'Joint Entrance Examination Main for engineering aspirants',
      subjects: [
        { name: 'Physics', chapters: [
          { name: 'Mechanics', topics: ['Laws of Motion', 'Work, Energy and Power', 'Rotational Motion', 'Kinematics', 'Gravitation', 'Units and Measurements'] },
          { name: 'Electrodynamics', topics: ['Current Electricity', 'Electrostatics', 'Magnetic Effects of Current', 'Electromagnetic Induction', 'Alternating Current'] },
          { name: 'Optics', topics: ['Ray Optics', 'Wave Optics'] },
          { name: 'Modern Physics', topics: ['Dual Nature of Matter', 'Atoms and Nuclei', 'Semiconductor Electronics'] },
          { name: 'Heat and Thermodynamics', topics: ['Thermal Properties', 'Thermodynamics', 'Kinetic Theory of Gases'] },
          { name: 'Waves and Oscillations', topics: ['Simple Harmonic Motion', 'Sound Waves', 'Progressive Waves'] }
        ] },
        { name: 'Chemistry', chapters: [
          { name: 'Physical Chemistry', topics: ['Mole Concept', 'Thermodynamics', 'Chemical Equilibrium', 'Ionic Equilibrium', 'Electrochemistry', 'Chemical Kinetics', 'Solutions', 'Atomic Structure'] },
          { name: 'Organic Chemistry', topics: ['GOC', 'Alkanes & Alkenes', 'Alkyl Halides', 'Alcohols, Phenols and Ethers', 'Aldehydes and Ketones', 'Carboxylic Acids', 'Amines', 'Biomolecules'] },
          { name: 'Inorganic Chemistry', topics: ['Periodic Table', 'Chemical Bonding', 'Coordination Compounds', 'p-Block Elements', 'd and f Block Elements', 'Metallurgy', 'Qualitative Analysis'] }
        ] },
        { name: 'Mathematics', chapters: [
          { name: 'Algebra', topics: ['Quadratic Equations', 'Sequence and Series', 'Complex Numbers', 'Permutations and Combinations', 'Binomial Theorem', 'Matrices and Determinants', 'Probability', 'Sets, Relations and Functions', 'Mathematical Induction'] },
          { name: 'Calculus', topics: ['Limits and Continuity', 'Differentiation', 'Applications of Derivatives', 'Integration', 'Applications of Integrals', 'Differential Equations'] },
          { name: 'Coordinate Geometry', topics: ['Straight Lines', 'Circles', 'Parabola', 'Ellipse', 'Hyperbola', '3D Geometry', 'Vectors'] },
          { name: 'Trigonometry', topics: ['Trigonometric Ratios and Identities', 'Inverse Trigonometry', 'Solution of Triangles'] },
          { name: 'Statistics and Mathematical Reasoning', topics: ['Statistics Basics', 'Mathematical Reasoning'] }
        ] }
      ]
    },
    {
      code: 'NEET', name: 'NEET', duration_minutes: 200, total_questions: 180, marks_per_question: 4, negative_marks: 1,
      icon: 'stethoscope', description: 'National Eligibility cum Entrance Test for medical aspirants',
      subjects: [
        { name: 'Physics', chapters: [
          { name: 'Mechanics', topics: ['Kinematics', 'Laws of Motion', 'Work, Energy and Power', 'Rotational Motion', 'Gravitation', 'Mechanical Properties of Solids and Fluids'] },
          { name: 'Thermodynamics', topics: ['Thermodynamics', 'Kinetic Theory'] },
          { name: 'Oscillations and Waves', topics: ['Oscillations', 'Waves', 'Sound'] },
          { name: 'Electrodynamics', topics: ['Electrostatics', 'Current Electricity', 'Magnetic Effects of Current', 'Electromagnetic Induction', 'Alternating Current', 'Electromagnetic Waves'] },
          { name: 'Optics', topics: ['Ray Optics', 'Wave Optics'] },
          { name: 'Modern Physics', topics: ['Dual Nature of Matter', 'Atoms and Nuclei', 'Semiconductor Devices'] }
        ] },
        { name: 'Chemistry', chapters: [
          { name: 'Physical Chemistry', topics: ['Mole Concept', 'Atomic Structure', 'Thermodynamics', 'Equilibrium', 'Electrochemistry', 'Chemical Kinetics', 'Solutions', 'Surface Chemistry'] },
          { name: 'Inorganic', topics: ['Periodic Table', 'Chemical Bonding', 'Hydrogen and s-Block', 'p-Block Elements', 'd and f Block', 'Coordination Compounds', 'Environmental Chemistry'] },
          { name: 'Organic', topics: ['GOC', 'Hydrocarbons', 'Haloalkanes and Haloarenes', 'Alcohols, Phenols and Ethers', 'Aldehydes, Ketones and Acids', 'Amines', 'Biomolecules', 'Polymers', 'Chemistry in Everyday Life'] }
        ] },
        { name: 'Biology', chapters: [
          { name: 'Botany', topics: ['Plant Kingdom', 'Photosynthesis', 'Cell Cycle and Cell Division', 'Plant Physiology', 'Morphology of Flowering Plants', 'Anatomy of Flowering Plants', 'Ecosystem', 'Biodiversity and Conservation', 'Microbes in Human Welfare', 'Principles of Inheritance'] },
          { name: 'Zoology', topics: ['Human Physiology', 'Genetics', 'Human Reproduction', 'Reproductive Health', 'Evolution', 'Human Health and Disease', 'Biotechnology', 'Structural Organisation in Animals', 'Neural Control and Coordination', 'Chemical Coordination'] }
        ] }
      ]
    },
    {
      code: 'SSC-CGL', name: 'SSC CGL', duration_minutes: 60, total_questions: 100, marks_per_question: 2, negative_marks: 0.5,
      icon: 'gov', description: 'Staff Selection Commission — Combined Graduate Level Examination',
      subjects: [
        { name: 'Quantitative Aptitude', chapters: [
          { name: 'Arithmetic', topics: ['Percentage', 'Time and Work', 'Ratio and Proportion', 'Profit and Loss', 'Simple and Compound Interest', 'Time, Speed and Distance', 'Average', 'Mixtures and Alligation', 'Ages'] },
          { name: 'Number System', topics: ['Number System and LCM/HCF', 'Simplification', 'Surds and Indices', 'Number Series'] },
          { name: 'Algebra and Geometry', topics: ['Algebraic Identities', 'Mensuration', 'Geometry', 'Trigonometry'] },
          { name: 'Data Interpretation', topics: ['Bar Graphs', 'Pie Charts', 'Tables and Data Interpretation'] }
        ] },
        { name: 'Reasoning', chapters: [
          { name: 'Verbal Reasoning', topics: ['Analogy', 'Coding Decoding', 'Syllogism', 'Blood Relations', 'Series Completion', 'Statement and Conclusion', 'Direction Sense', 'Ranking and Order'] },
          { name: 'Non-Verbal', topics: ['Series', 'Figure Counting', 'Mirror Images', 'Paper Folding and Cutting', 'Embedded Figures'] }
        ] },
        { name: 'English', chapters: [
          { name: 'Grammar', topics: ['Spotting Errors', 'Sentence Improvement', 'Fill in the Blanks', 'Active and Passive Voice', 'Direct and Indirect Speech'] },
          { name: 'Vocabulary and Comprehension', topics: ['Synonyms and Antonyms', 'Idioms and Phrases', 'One Word Substitution', 'Spelling Correction', 'Cloze Test', 'Reading Comprehension'] }
        ] },
        { name: 'General Awareness', chapters: [
          { name: 'Static GK', topics: ['Indian Polity', 'Indian History', 'Geography', 'Indian Economy', 'General Science', 'Books and Authors', 'Awards and Honours', 'Sports'] },
          { name: 'Current Affairs', topics: ['National Current Affairs', 'International Current Affairs', 'Science and Technology News', 'Schemes and Policies'] }
        ] }
      ]
    },
    {
      code: 'BANK-PO', name: 'Bank PO / IBPS', duration_minutes: 60, total_questions: 100, marks_per_question: 1, negative_marks: 0.25,
      icon: 'bank', description: 'IBPS/SBI Probationary Officer and Clerk examinations',
      subjects: [
        { name: 'Quantitative Aptitude', chapters: [
          { name: 'Arithmetic', topics: ['Simplification', 'Data Interpretation', 'Percentage', 'Profit and Loss', 'Time and Work', 'Time, Speed and Distance', 'Simple and Compound Interest', 'Ages', 'Boats and Streams', 'Probability'] },
          { name: 'Number Series', topics: ['Wrong Number Series', 'Missing Number Series'] },
          { name: 'Quadratic and Equations', topics: ['Quadratic Equations', 'Linear Equations', 'Quantity Comparison'] }
        ] },
        { name: 'Reasoning', chapters: [
          { name: 'Puzzle', topics: ['Seating Arrangement', 'Syllogism', 'Floor Puzzles', 'Box Puzzles', 'Day and Month Puzzles'] },
          { name: 'Logical Reasoning', topics: ['Coding Decoding', 'Blood Relations', 'Direction Sense', 'Inequality', 'Order and Ranking', 'Data Sufficiency', 'Statement and Assumption'] }
        ] },
        { name: 'English', chapters: [
          { name: 'Comprehension', topics: ['Reading Comprehension', 'Cloze Test'] },
          { name: 'Grammar and Vocabulary', topics: ['Spotting Errors', 'Sentence Improvement', 'Para Jumbles', 'Fillers', 'Word Swap', 'Connectors'] }
        ] },
        { name: 'General and Banking Awareness', chapters: [
          { name: 'Banking Awareness', topics: ['RBI and Monetary Policy', 'Banking History and Structure', 'Financial Markets', 'Government Schemes'] },
          { name: 'Current Affairs and Static GK', topics: ['Current Affairs', 'Static GK', 'Computer Aptitude'] }
        ] }
      ]
    },
    {
      code: 'UPSC', name: 'UPSC CSE', duration_minutes: 120, total_questions: 100, marks_per_question: 2, negative_marks: 0.66,
      icon: 'landmark', description: 'UPSC Civil Services Examination — Prelims',
      subjects: [
        { name: 'General Studies', chapters: [
          { name: 'History', topics: ['Ancient India', 'Modern India', 'Medieval India', 'Art and Culture', 'Freedom Struggle'] },
          { name: 'Polity', topics: ['Constitution', 'Governance', 'Parliament and State Legislatures', 'Judiciary', 'Panchayati Raj', 'Constitutional Bodies'] },
          { name: 'Geography', topics: ['Physical Geography', 'Indian Geography', 'World Geography', 'Mapping'] },
          { name: 'Economy', topics: ['Indian Economy', 'Budgeting', 'Banking Sector', 'Inflation and Monetary Policy', 'Agriculture', 'Industry and Infrastructure'] },
          { name: 'Environment', topics: ['Biodiversity', 'Climate Change', 'Ecology', 'Pollution', 'Environmental Laws and Conventions'] },
          { name: 'Science and Technology', topics: ['Space Technology', 'Biotechnology', 'Defence Technology', 'Nuclear Technology', 'IT and Computers'] },
          { name: 'Current Affairs', topics: ['National Affairs', 'International Affairs', 'Reports and Indices', 'Schemes and Policies'] }
        ] },
        { name: 'CSAT', chapters: [
          { name: 'Quantitative Aptitude', topics: ['Basic Numeracy', 'Data Interpretation', 'Percentage and Ratio', 'Time and Work'] },
          { name: 'Reasoning', topics: ['Logical Reasoning', 'Analytical Reasoning', 'Decision Making', 'Interpersonal Skills'] },
          { name: 'Comprehension', topics: ['Reading Comprehension', 'English Comprehension'] }
        ] }
      ]
    },
    {
      code: 'CAT', name: 'CAT', duration_minutes: 120, total_questions: 66, marks_per_question: 3, negative_marks: 1,
      icon: 'chart', description: 'Common Admission Test for MBA programmes',
      subjects: [
        { name: 'Quant', chapters: [
          { name: 'Arithmetic', topics: ['Percentages', 'Profit and Loss', 'Mixtures', 'Time and Work', 'Time, Speed and Distance', 'Ratios and Proportion', 'Averages', 'Interest'] },
          { name: 'Algebra', topics: ['Inequalities', 'Functions', 'Quadratic Equations', 'Logarithms', 'Progressions'] },
          { name: 'Geometry and Mensuration', topics: ['Triangles and Circles', 'Mensuration', 'Coordinate Geometry', 'Trigonometry'] },
          { name: 'Number System', topics: ['Number Properties', 'Remainders and Divisibility', 'LCM and HCF'] },
          { name: 'Modern Maths', topics: ['Permutation and Combination', 'Probability', 'Set Theory'] }
        ] },
        { name: 'LRDI', chapters: [
          { name: 'Logical Reasoning', topics: ['Arrangements', 'Cubes', 'Games and Tournaments', 'Venn Diagrams', 'Syllogisms', 'Blood Relations'] },
          { name: 'Data Interpretation', topics: ['Tables and Charts', 'Caselets', 'Bar and Line Graphs', 'Pie Charts', 'Data Sufficiency'] }
        ] },
        { name: 'VARC', chapters: [
          { name: 'Verbal', topics: ['RC', 'Para Jumbles', 'Para Summary', 'Odd One Out', 'Sentence Completion'] }
        ] }
      ]
    },
    {
      code: 'GATE', name: 'GATE', duration_minutes: 180, total_questions: 65, marks_per_question: 2, negative_marks: 0.66,
      icon: 'book', description: 'Graduate Aptitude Test in Engineering',
      subjects: [
        { name: 'Engineering Maths', chapters: [
          { name: 'Maths', topics: ['Linear Algebra', 'Calculus', 'Probability', 'Differential Equations', 'Complex Variables', 'Numerical Methods'] }
        ] },
        { name: 'General Aptitude', chapters: [
          { name: 'Numerical Ability', topics: ['Numerical Computation', 'Data Interpretation', 'Estimation'] },
          { name: 'Verbal Ability', topics: ['English Grammar', 'Verbal Analogies', 'Reading Comprehension'] }
        ] },
        { name: 'Core Subject', chapters: [
          { name: 'Core Concepts', topics: ['Core Concepts'] }
        ] }
      ]
    },
    {
      code: 'CUET', name: 'CUET', duration_minutes: 60, total_questions: 50, marks_per_question: 5, negative_marks: 0,
      icon: 'cap', description: 'Common University Entrance Test for undergraduate admissions',
      subjects: [
        { name: 'General Test', chapters: [
          { name: 'GK', topics: ['Current Affairs', 'Static GK'] },
          { name: 'Maths', topics: ['Basic Maths', 'Data Interpretation'] },
          { name: 'Reasoning', topics: ['Logical Reasoning', 'Series', 'Analogy'] }
        ] },
        { name: 'Language', chapters: [
          { name: 'English', topics: ['Vocabulary', 'Comprehension', 'Grammar', 'Verbal Ability'] }
        ] },
        { name: 'Domain Subjects', chapters: [
          { name: 'Physics', topics: ['Mechanics', 'Optics', 'Electricity', 'Modern Physics'] },
          { name: 'Chemistry', topics: ['Physical Chemistry', 'Organic Chemistry', 'Inorganic Chemistry'] },
          { name: 'Biology', topics: ['Botany', 'Zoology', 'Cell Biology', 'Genetics'] },
          { name: 'Mathematics', topics: ['Algebra', 'Calculus', 'Probability', 'Coordinate Geometry'] },
          { name: 'Accountancy', topics: ['Accounting Basics', 'Partnership', 'Company Accounts'] },
          { name: 'Business Studies', topics: ['Nature of Business', 'Management Principles', 'Marketing'] },
          { name: 'Economics', topics: ['Microeconomics', 'Macroeconomics', 'Indian Economy'] },
          { name: 'History', topics: ['Ancient India', 'Medieval India', 'Modern India'] },
          { name: 'Political Science', topics: ['Constitution', 'Political Theory', 'International Relations'] }
        ] }
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
  console.log('  Admin login: admin@examai.app (password = ADMIN_PASSWORD env)')
  console.log('  Students register in-app — no demo accounts are seeded.')
}

export { seed }

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
}
