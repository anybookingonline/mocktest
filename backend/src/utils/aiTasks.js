import db from '../db.js'
import { aiChat, visionExtract, hashContent } from './aiService.js'
import { scopedContentHash } from './visibility.js'

const QUESTION_SCHEMA = `A JSON object with a "questions" array. Each question MUST have exactly:
{
  "questions": [
    {
      "type": "single" | "multiple" | "numerical" | "integer",
      "question": "question text",
      "options": ["A. option", "B. option", "C. option", "D. option"] (only for single/multiple; for numerical/integer put 4 plausible options OR empty array),
      "correctAnswer": "B" or "option text" or "42" (numeric value),
      "explanation": "crisp 2-4 sentence final solution: concept, key steps, answer",
      "difficulty": "easy" | "medium" | "hard",
      "marks": number,
      "negativeMarks": number,
      "estimatedTime": number (seconds, 60-180),
      "tags": ["topic tags"]
    }
  ]
}
Rules:
- Questions must be exam-accurate, free of errors, and follow the syllabus.
- Include fresh numeric values so each generation is unique (avoid memorized verbatim PYQs).
- correctAnswer must match exactly one of the options (or be the numeric value for numerical/integer types).
- MENTALLY VERIFY before finalizing: recompute every answer from scratch. If a computation gives a value not among the options, quietly change the question's numbers until it does — then write the explanation only for the FINAL version. Never present a question whose correct answer is missing from its options.
- The explanation must read like a polished textbook solution that STARTS directly with the method. It must NEVER mention option-checking, discrepancies, misprints, alternate approaches, recalculations, or corrections of any kind. The student must never see that any revision happened.
CRITICAL OUTPUT RULES:
- Output ONLY the final JSON object. No text before or after it.
- Do NOT show working, reasoning, self-talk, corrections, or drafts anywhere (not in the JSON, not outside it).
- Every string value must contain NO double-quote characters at all.
- Explanation must read like a polished textbook solution, never like internal thinking.`

function examContext(exam) {
  if (!exam) return ''
  return `Exam: ${exam.name} (${exam.duration_minutes} min, ${exam.total_questions} Q, ${exam.marks_per_question} marks, ${exam.negative_marks} negative marks per wrong answer)\n`
}

// ---------------------------------------------------------------------------
// Post-generation gate. AI models occasionally leak their internal
// self-correction into the output (real production example: an explanation
// that argued with itself about options not containing -1, then "adjusted"
// the numbers). Such questions are worse than no question — they destroy
// trust. Every generated question must pass these checks before it can be
// shown to a student; failing ones are dropped (and the caller retries).
// ---------------------------------------------------------------------------
const SELF_TALK_RE = new RegExp([
  're-?evaluat', 'discrepanc', 'misprint',
  'not (in|an?) ?options?', 'not include', 'options? (do|does|is|are) not',
  'options? (are|is) wrong', 'wait[,.!]',
  'let me (check|recalculate|recompute|adjust|try)',
  'i (will|must|need to) (change|adjust|modify|fix|choose|provide|use)',
  'as an ai', 'self-?corr', 'however[,.] (the options|since)'
].join('|'), 'i')

export function validateGeneratedQuestions(list) {
  const ok = []
  for (const q of Array.isArray(list) ? list : []) {
    if (!q || typeof q.question !== 'string' || q.question.trim().length < 8) continue
    if (!q.explanation || typeof q.explanation !== 'string' || q.explanation.trim().length < 10) continue
    const type = q.type || 'single'
    const opts = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()) : []
    const ans = String(q.correctAnswer ?? '').trim()
    if (type === 'single' || type === 'multiple') {
      if (opts.length < 2) continue
      // Answer must be a letter that exists ("B") OR the option text itself
      // (with or without the "A. " prefix).
      const letters = opts.map((o) => o.charAt(0).toUpperCase())
      const letterOk = /^[A-H]$/.test(ans.toUpperCase()) && letters.includes(ans.toUpperCase())
      const textOk = opts.some((o) => o === ans || o.replace(/^[A-H][.)]\s*/i, '').trim() === ans)
      if (!letterOk && !textOk) continue
    } else if (!/^-?\d+(\.\d+)?$/.test(ans.replace(/[,\s₹]/g, ''))) {
      continue // numerical/integer answers must be clean numbers
    }
    if (SELF_TALK_RE.test(q.explanation) || SELF_TALK_RE.test(q.question)) continue
    ok.push(q)
  }
  return ok
}

export async function generateQuestionsWithAI({ exam, count = 5, subject = null, chapter = null, topic = null, difficulty = null, seed = null, newsHint = '', language = null }) {
  const ctx = examContext(exam)
  const filters = [
    subject && `Subject: ${subject}`,
    chapter && `Chapter: ${chapter}`,
    topic && `Topic: ${topic}`,
    difficulty && `Difficulty level: ${difficulty}`
  ].filter(Boolean).join('\n')

  // Language policy: Indian exams (UPSC/SSC/Banking) publish bilingual papers,
  // so students can request English, Hindi, or bilingual questions. Regional
  // languages are intentionally not offered — AI translation of technical
  // exam terminology is unreliable and bilingual papers are the standard.
  const LANG_RULE = {
    en: 'Write ALL question text, options and explanations in clear English only.',
    hi: 'Write ALL question text, options and explanations in natural, correct Hindi (Devanagari). Keep standard technical terms bilingual where real exam papers do, e.g. \"demand curve (मांग वक्र)\", \"momentum (संवेग)\". Use the phrasing style of Ncert/official Hindi exam papers.',
    bilingual: 'Write every question and its options TWICE, exactly like real bilingual Indian exam papers: first the English version, then the Hindi version in Devanagari on the next line inside the same question string (format: "English question text\\n\\nहिंदी अनुवाद: ..." — options likewise "A. English option / हिंदी विकल्प"). Explanations: English first, then a short Hindi summary line.'
  }
  const langRule = LANG_RULE[language] || LANG_RULE.en

  const system = `You are a senior question paper setter for Indian competitive exams (NEET, JEE, UPSC, SSC, Banking, CAT, GATE, CUET). Generate high-quality, error-free questions.\n\nLANGUAGE: ${langRule}\n\n${QUESTION_SCHEMA}`
  const user = `${ctx}${filters}\nGenerate ${count} new questions on the given topic(s). Make them non-trivial and exam-like.\n${newsHint || ''}${seed ? `Vary the numbers based on this seed so the set is fresh: "${seed}"` : ''}\nReturn ONLY valid JSON.`

  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const retryNote = attempt > 1
        ? '\n\nIMPORTANT: Your previous response was rejected — either it was not valid JSON, or a question\'s correct answer did not match its options, or the explanation contained visible self-correction/reasoning. Re-verify every computation silently, make sure each answer matches exactly one option, write polished explanations only, and output ONLY the final JSON object. No double-quote characters inside any string value.'
        : ''
      const res = await aiChat({ system, messages: [{ role: 'user', content: user + retryNote }], json: true, action: 'generate_questions', maxTokens: 16384, temperature: 0.3 })
      const list = res.data.questions || []
      const valid = validateGeneratedQuestions(list)
      if (valid.length) return valid
      lastErr = new Error(`AI questions failed validation (${valid.length}/${list.length} passed)`)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('AI generation failed')
}

const DOUBT_LANGUAGE_RULE = `LANGUAGE RULE (follow strictly): Reply in EXACTLY the language the student's doubt is written in. If the student writes in Hinglish (Roman-script Hindi mixed with English), reply in natural Hinglish the same way. If the student writes in Hindi (Devanagari), reply fully in Hindi. If the student writes in English, reply fully in English. Never switch to a different language than the student used, and never mix scripts unless the student did.`

// Socratic mode: never hand over the answer immediately. One small hint or
// guiding question per turn, responding to what the student actually said
// last (not a canned script) — until they ask outright or it's dragged on
// too long, at which point it closes with the full solution so the student
// is never left stuck forever.
const SOCRATIC_MAX_HINT_ROUNDS = 3
function socraticSystemPrompt(hintRound) {
  const mustReveal = hintRound >= SOCRATIC_MAX_HINT_ROUNDS
  return `You are a Socratic exam tutor. Guide the student to the answer themselves — do NOT give the final answer or full method upfront.
- Give ONE small hint or a guiding question per reply (2-4 sentences) that responds specifically to what the student just said or tried. Never repeat a hint you already gave in this conversation.
- If the student explicitly asks for the answer/solution outright ("just tell me", "give up", "answer bata do", "solution do"), give the full step-by-step solution and final answer right away, clearly and completely.
- ${mustReveal ? `This is hint round ${hintRound} — the student has tried enough times. Give the full step-by-step solution and final answer now, so they don't stay stuck.` : `This is hint round ${hintRound} of at most ${SOCRATIC_MAX_HINT_ROUNDS} — keep guiding, don't reveal the answer yet unless they ask for it.`}
${DOUBT_LANGUAGE_RULE}`
}

export async function solveDoubtWithAI({ questionText, options, studentMessage, explanation, mode = 'direct', thread = [], hintRound = 0 }) {
  const questionBlock = `QUESTION:\n${questionText}\n${options?.length ? 'OPTIONS:\n' + options.join('\n') : ''}\n${explanation ? 'GIVEN EXPLANATION (reference only — in socratic mode, don\'t reveal until appropriate):\n' + explanation : ''}`

  if (mode === 'socratic') {
    const system = socraticSystemPrompt(hintRound)
    const messages = [
      { role: 'user', content: questionBlock },
      ...thread.flatMap((t) => [{ role: 'user', content: t.message }, { role: 'assistant', content: t.ai_response }]),
      { role: 'user', content: studentMessage }
    ]
    const res = await aiChat({ system, messages, json: false, action: 'doubt_solving_socratic' })
    return res.data.trim()
  }

  // Direct mode (default): straight, complete answer.
  const system = `You are a friendly, expert exam coach for Indian competitive exams. Resolve the student's doubt about the question below. Be concise but complete: clarify the concept, show the reasoning, and give an easy memorisation tip if relevant.\n\n${DOUBT_LANGUAGE_RULE}`
  const user = `${questionBlock}\n\nSTUDENT DOUBT:\n${studentMessage}`
  const res = await aiChat({ system, messages: [{ role: 'user', content: user }], json: false, action: 'doubt_solving' })
  return res.data.trim()
}

export async function explainQuestionWithAI({ questionText, options, correctAnswer, language = null }) {
  // No student message to mirror, so an explicit UI language (when the caller
  // knows the student's preference) steers the explanation; default English.
  const langRule = language === 'hi'
    ? 'Write the explanation in natural Hindi (Devanagari), keeping standard technical terms bilingual like official Hindi exam papers.'
    : language === 'hinglish'
      ? 'Write the explanation in friendly Hinglish (Roman-script Hindi mixed with English) — the tone Indian students actually study in.'
      : 'Write the explanation in clear English.'
  const system = `You are an expert exam tutor. Write a crisp, step-by-step solution for the question. Explain the core concept, the method, and common mistakes.\n\nLANGUAGE: ${langRule}`
  const user = `QUESTION:\n${questionText}\n${options?.length ? 'OPTIONS:\n' + options.join('\n') : ''}\nCORRECT ANSWER: ${correctAnswer}\n\nGive a detailed step-by-step solution.`
  const res = await aiChat({ system, messages: [{ role: 'user', content: user }], json: false, action: 'explain' })
  return res.data.trim()
}

// ---------------------------------------------------------------------------
// PDF import pipeline: Gemini Vision understands the PDF -> DeepSeek structures.
// ---------------------------------------------------------------------------

export const PDF_EXTRACT_PROMPT = `You are a precise question paper parser. Read the attached exam PDF carefully (it may be scanned, image-based, multi-column, or low quality).
Extract EVERY question along with its options, correct answer (if available), marks, and section. Preserve diagrams/graphs/tables/equations by describing them textually inside the question where needed.
If the document also contains an answer key — a separate list/table of question numbers with their correct option (often appended at the end, e.g. after the question paper and instructions) — treat it as the AUTHORITATIVE source for correctAnswer: match each answer to its question by question number and fill it in exactly. Do not skip those pages; read them specifically for this. If no answer key is present, leave correctAnswer as stated in this step (a later step solves it if still missing).
Return ONLY JSON with this exact structure:
{
  "examCode": "exact exam code e.g. JEE-MAIN",
  "year": number or null,
  "shift": "e.g. Jan 27 Shift 1" or null,
  "sections": [
    {
      "subject": "Physics / Chemistry / Maths / etc.",
      "questions": [
        {
          "type": "single | multiple | numerical | integer",
          "question": "full question text (include any figure/graph/table description in [brackets] if relevant)",
          "options": ["A. ...","B. ...","C. ...","D. ..."] ([] if not available),
          "correctAnswer": "letter, option text, or numeric value; null if not stated",
          "marks": number,
          "negativeMarks": number or null,
          "difficulty": "easy | medium | hard (your best guess)",
          "estimatedTime": number in seconds (guess based on difficulty and marks),
          "tags": ["topic tags"]
        }
      ]
    }
  ]
}
Skip cover/instructions pages (but not a genuine answer-key section — see above). If a question cannot be read, skip it silently. Do NOT invent questions.`

export async function extractPdfQuestions({ buffer, mimeType }) {
  return visionExtract({ buffer, mimeType, prompt: PDF_EXTRACT_PROMPT })
}

const STRUCTURE_SYSTEM = `You convert extracted question paper data into the platform's canonical question schema. Keep every question and every option verbatim — never alter their wording or values. If correctAnswer is missing, blank, or unclear (e.g. the source PDF was the question paper only, with no answer key), work it out yourself by actually solving the question from the given options, and fill it in. Never leave correctAnswer empty for a question that has options. Write the explanation as a clean, confident final solution — never mention that the answer key was missing or that you had to solve it yourself.`
const STRUCTURE_PROMPT = (batch, meta, exam) => `The following is raw OCR/vision extraction of ${batch.length} question(s) from an exam paper for ${exam ? exam.name : 'an exam'}${meta.year ? ` (${meta.year}${meta.shift ? ', ' + meta.shift : ''})` : ''}. Normalize it into our standard schema.
Canonical question fields: examId, subject, chapter (infer), topic (infer), type, question, options, correctAnswer (solve it yourself if not given in the raw data — see system instructions), explanation (infer a detailed one if missing), difficulty, marks, negativeMarks, estimatedTime, tags, year, shift, source:"pdf".
Output ONLY JSON: { "questions": [ { "examId": ${exam?.id || null}, "subject": "...", "chapter": "...", "topic": "...", "type": "...", "question": "...", "options": [...], "correctAnswer": "...", "explanation": "...", "difficulty": "...", "marks": number, "negativeMarks": number, "estimatedTime": number, "tags": [...], "year": ${meta.year ?? 'null'}, "shift": ${meta.shift ? `"${meta.shift}"` : 'null'} } ] }

RAW DATA:
${JSON.stringify(batch)}`

// A full paper (e.g. 75 pages / 200+ questions) asked for in one AI call used
// to blow past maxTokens and come back as truncated, unparseable JSON — the
// bigger the PDF, the more likely every provider failed with "invalid JSON".
// Batching bounds each request/response to a fixed size regardless of paper
// length, so a 300-question paper is just as reliable as a 10-question one.
const STRUCTURE_BATCH_SIZE = 15

export async function structureExtractedQuestions(extracted, exam) {
  const sections = extracted.sections || []
  const flat = sections.flatMap((s) => (s.questions || []).map((q) => ({ ...q, subject: q.subject || s.subject })))
  if (!flat.length) return []

  const meta = { year: extracted.year ?? null, shift: extracted.shift ?? null }
  const out = []
  for (let i = 0; i < flat.length; i += STRUCTURE_BATCH_SIZE) {
    const batch = flat.slice(i, i + STRUCTURE_BATCH_SIZE)
    const res = await aiChat({
      system: STRUCTURE_SYSTEM,
      messages: [{ role: 'user', content: STRUCTURE_PROMPT(batch, meta, exam) }],
      json: true,
      action: 'structure_pdf'
    })
    out.push(...(res.data.questions || []))
  }
  return out
}

// ---------------------------------------------------------------------------
// Persist a batch of questions into the unified question table (dedup by hash)
// ---------------------------------------------------------------------------

export async function persistQuestions(list, { exam, source = 'ai', sourceMeta = null, mapping }) {
  // mapping: one shared { subjectId, chapterId, topicId } for the whole batch
  // (e.g. doubt-practice: a few questions generated for one topic). A
  // question's own subjectId/chapterId/topicId — set per-question by PDF
  // import's mapSyllabus, since one paper spans many subjects — wins when
  // present.
  const insert = await db.prepare(`INSERT INTO questions
    (exam_id, subject_id, chapter_id, topic_id, qtype, question_text, options_json, correct_answer,
     explanation, difficulty, marks, negative_marks, estimated_time, year, shift, tags_json,
     source, source_meta_json, content_hash, usage_count)
    VALUES (@exam_id, @subject_id, @chapter_id, @topic_id, @qtype, @question_text, @options_json,
     @correct_answer, @explanation, @difficulty, @marks, @negative_marks, @estimated_time,
     @year, @shift, @tags_json, @source, @source_meta_json, @content_hash, 0)
    ON CONFLICT (content_hash) DO NOTHING`)

  const created = []
  for (const q of list) {
    if (!q.question) continue
    const opts = Array.isArray(q.options) ? q.options : []
    const type = q.type || 'single'
    const marks = Number(q.marks) || 4
    const neg = q.negativeMarks != null ? Number(q.negativeMarks) : 1
    const est = Number(q.estimatedTime) || 90
    const contentHash = hashContent(JSON.stringify({ question: q.question, options: opts, answer: q.correctAnswer }))
    const r = await insert.run({
      exam_id: exam.id,
      subject_id: q.subjectId ?? mapping?.subjectId ?? null,
      chapter_id: q.chapterId ?? mapping?.chapterId ?? null,
      topic_id: q.topicId ?? mapping?.topicId ?? null,
      qtype: type,
      question_text: String(q.question).trim(),
      options_json: JSON.stringify(opts),
      correct_answer: String(q.correctAnswer ?? ''),
      explanation: q.explanation || '',
      difficulty: q.difficulty || 'medium',
      marks, negative_marks: neg, estimated_time: est,
      year: q.year || null, shift: q.shift || null,
      tags_json: JSON.stringify(q.tags || []),
      source, source_meta_json: JSON.stringify(sourceMeta || {}),
      content_hash: contentHash
    })
    if (r.changes > 0) created.push(q)
  }
  return created.length
}

// ---------------------------------------------------------------------------
// Review queue (Phase 3): park extracted questions in pdf_question_staging
// instead of publishing them to the shared bank. The institute sub-admin then
// approves/rejects each row (or bulk) from their dashboard; only approved rows
// are written to `questions`.
// ---------------------------------------------------------------------------

// Fill the staging table from a structured extraction. Returns {staged, dupes}.
// The duplicate flag is computed up-front (content hash match) so the reviewer
// immediately sees "ye question bank me already hai" without opening anything.
// Dedup is SCOPE-AWARE: an institute's rows are hashed with its id baked in
// (scopedContentHash), so School B uploading the same paper as School A gets
// its OWN independent set instead of silently inheriting A's questions. A dup
// flag for an institute row therefore only fires against global/curated copies
// or that same institute's own earlier copies.
export async function stageExtractedQuestions(list, { importId, instituteId, examId }) {
  // Existing hashes this row could legitimately collide with, for this exam —
  // one query instead of per-row lookups.
  const existing = new Set(
    (instituteId
      ? await db.prepare('SELECT content_hash FROM questions WHERE exam_id = ? AND (institute_id IS NULL OR institute_id = ?)').all(Number(examId), Number(instituteId))
      : await db.prepare('SELECT content_hash FROM questions WHERE exam_id = ? AND institute_id IS NULL').all(Number(examId))
    ).map((r) => r.content_hash)
  )
  let staged = 0, dupes = 0
  for (const q of list) {
    if (!q.question) continue
    const opts = Array.isArray(q.options) ? q.options : []
    const hash = scopedContentHash(JSON.stringify({ question: q.question, options: opts, answer: q.correctAnswer }), instituteId)
    const isDup = existing.has(hash)
    await db.prepare(`INSERT INTO pdf_question_staging
      (import_id, institute_id, exam_id, subject, chapter, topic, qtype, question_text,
       options_json, correct_answer, explanation, difficulty, marks, negative_marks,
       estimated_time, tags_json, status, duplicate, content_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`)
      .run(
        Number(importId), instituteId ? Number(instituteId) : null, Number(examId) || null,
        q.subject || null, q.chapter || null, q.topic || null,
        q.type || 'single', String(q.question).trim(),
        JSON.stringify(opts), String(q.correctAnswer ?? ''), q.explanation || '',
        q.difficulty || 'medium', Number(q.marks) || 4,
        q.negativeMarks != null ? Number(q.negativeMarks) : 1,
        Number(q.estimatedTime) || 90, JSON.stringify(q.tags || []),
        isDup ? 1 : 0, hash
      )
    if (isDup) dupes += 1; else staged += 1
  }
  return { staged, dupes }
}

// Approve staged rows: write them into the shared question bank (same schema
// mapping as persistQuestions). Rows may belong to different imports; every
// row is re-scoped by its own stored ids. The content_hash stored at staging
// time is ALREADY institute-scoped (scopedContentHash), so the UNIQUE dedup
// constraint can never block School B from publishing its own copy of a paper
// School A also imported — B's hashes differ from A's by construction.
export async function approveStagedQuestions(ids) {
  const clean = (ids || []).map(Number).filter(Boolean)
  if (!clean.length) return { approved: 0, created: 0 }
  const rows = await db.prepare(
    `SELECT * FROM pdf_question_staging WHERE status = 'pending' AND id IN (${clean.map(() => '?').join(',')})`
  ).all(...clean)
  if (!rows.length) return { approved: 0, created: 0 }

  // Group by exam so syllabus mapping is computed once per exam.
  const byExam = new Map()
  for (const row of rows) {
    if (!byExam.has(row.exam_id)) byExam.set(row.exam_id, [])
    byExam.get(row.exam_id).push(row)
  }

  let created = 0
  for (const [examId, group] of byExam) {
    const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(Number(examId))
    if (!exam) continue
    const subjects = await db.prepare('SELECT * FROM subjects WHERE exam_id = ?').all(Number(examId))
    const chapters = await db.prepare('SELECT * FROM chapters WHERE exam_id = ?').all(Number(examId))
    const topics = await db.prepare('SELECT * FROM topics WHERE exam_id = ?').all(Number(examId))
    const getOrCreate = async (tableName, cache, parentCol, parentId, name) => {
      const found = cache.find((x) => x.name.toLowerCase() === String(name).toLowerCase() && (parentId == null || x[parentCol] === parentId))
      if (found) return found.id
      const cols = tableName === 'subjects' ? 'exam_id, name, sort_order' : tableName === 'chapters' ? 'subject_id, exam_id, name, sort_order' : 'chapter_id, exam_id, name, sort_order'
      const marks = tableName === 'subjects' ? '?, ?, 0' : '?, ?, ?, 0'
      const vals = tableName === 'subjects' ? [Number(examId), name] : tableName === 'chapters' ? [parentId, Number(examId), name] : [parentId, Number(examId), name]
      const r = await db.prepare(`INSERT INTO ${tableName} (${cols}) VALUES (${marks})`).run(...vals)
      const id = Number(r.lastInsertRowid)
      cache.push({ id, name, [parentCol]: parentId })
      return id
    }

    const insert = db.prepare(`INSERT INTO questions
      (exam_id, subject_id, chapter_id, topic_id, qtype, question_text, options_json, correct_answer,
       explanation, difficulty, marks, negative_marks, estimated_time, tags_json, source, source_meta_json, content_hash, institute_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (content_hash) DO NOTHING RETURNING id`)

    for (const row of group) {
      let subjectId = null, chapterId = null, topicId = null
      if (row.subject) subjectId = await getOrCreate('subjects', subjects, null, null, row.subject)
      if (row.chapter) chapterId = await getOrCreate('chapters', chapters, 'subject_id', subjectId, row.chapter)
      if (row.topic) topicId = await getOrCreate('topics', topics, 'chapter_id', chapterId, row.topic)
      const r = await insert.run(
        Number(examId), subjectId, chapterId, topicId,
        row.qtype || 'single', row.question_text,
        row.options_json || '[]', row.correct_answer || '',
        row.explanation || '', row.difficulty || 'medium',
        Number(row.marks) || 4, Number(row.negative_marks ?? 1),
        Number(row.estimated_time) || 90, row.tags_json || '[]',
        'pdf', JSON.stringify({ stagedId: row.id, importId: row.import_id, institute: row.institute_id || null }),
        row.content_hash,
        row.institute_id ? Number(row.institute_id) : null
      )
      const qid = r.lastInsertRowid || null
      await db.prepare(`UPDATE pdf_question_staging SET status = 'approved', reviewed_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), question_id = ? WHERE id = ?`)
        .run(qid, row.id)
      if (r.changes > 0) created += 1
    }
  }
  return { approved: rows.length, created }
}

// Reject staged rows (sub-admin decided these are wrong / unreadable / off-topic).
export async function rejectStagedQuestions(ids) {
  const clean = (ids || []).map(Number).filter(Boolean)
  if (!clean.length) return { rejected: 0 }
  const r = await db.prepare(
    `UPDATE pdf_question_staging SET status = 'rejected', reviewed_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE status = 'pending' AND id IN (${clean.map(() => '?').join(',')})`
  ).run(...clean)
  return { rejected: r.changes || 0 }
}
