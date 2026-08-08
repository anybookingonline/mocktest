import db from '../db.js'
import { aiChat, visionExtract, hashContent } from './aiService.js'

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
CRITICAL OUTPUT RULES:
- Output ONLY the final JSON object. No text before or after it.
- Do NOT show working, reasoning, self-talk, corrections, or drafts anywhere (not in the JSON, not outside it).
- Every string value must contain NO double-quote characters at all.
- Explanation must read like a polished textbook solution, never like internal thinking.`

function examContext(exam) {
  if (!exam) return ''
  return `Exam: ${exam.name} (${exam.duration_minutes} min, ${exam.total_questions} Q, ${exam.marks_per_question} marks, ${exam.negative_marks} negative marks per wrong answer)\n`
}

export async function generateQuestionsWithAI({ exam, count = 5, subject = null, chapter = null, topic = null, difficulty = null, seed = null }) {
  const ctx = examContext(exam)
  const filters = [
    subject && `Subject: ${subject}`,
    chapter && `Chapter: ${chapter}`,
    topic && `Topic: ${topic}`,
    difficulty && `Difficulty level: ${difficulty}`
  ].filter(Boolean).join('\n')

  const system = `You are a senior question paper setter for Indian competitive exams (NEET, JEE, UPSC, SSC, Banking, CAT, GATE, CUET). Generate high-quality, error-free questions.\n\n${QUESTION_SCHEMA}`
  const user = `${ctx}${filters}\nGenerate ${count} new questions on the given topic(s). Make them non-trivial and exam-like.\n${seed ? `Vary the numbers based on this seed so the set is fresh: "${seed}"` : ''}\nReturn ONLY valid JSON.`

  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const retryNote = attempt > 1
        ? '\n\nIMPORTANT: Your previous response was rejected because it was not valid JSON. This time output ONLY the final JSON object. Absolutely no reasoning, self-corrections, or prose — and no double-quote characters inside any string value.'
        : ''
      const res = await aiChat({ system, messages: [{ role: 'user', content: user + retryNote }], json: true, action: 'generate_questions', maxTokens: 16384, temperature: 0.3 })
      const list = res.data.questions || []
      if (Array.isArray(list) && list.length) return list
      lastErr = new Error('AI returned invalid question structure')
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('AI generation failed')
}

export async function solveDoubtWithAI({ questionText, options, studentMessage, explanation }) {
  const system = `You are a friendly, expert exam coach for Indian competitive exams. Resolve the student's doubt about the question below. Be concise but complete: clarify the concept, show the reasoning, and give an easy memorisation tip if relevant. Answer in the same language the student uses (Hinglish/Hindi/English ok).`
  const user = `QUESTION:\n${questionText}\n${options?.length ? 'OPTIONS:\n' + options.join('\n') : ''}\n${explanation ? 'GIVEN EXPLANATION:\n' + explanation : ''}\n\nSTUDENT DOUBT:\n${studentMessage}`
  const res = await aiChat({ system, messages: [{ role: 'user', content: user }], json: false, action: 'doubt_solving' })
  return res.data.trim()
}

export async function explainQuestionWithAI({ questionText, options, correctAnswer }) {
  const system = `You are an expert exam tutor. Write a crisp, step-by-step solution for the question. Explain the core concept, the method, and common mistakes.`
  const user = `QUESTION:\n${questionText}\n${options?.length ? 'OPTIONS:\n' + options.join('\n') : ''}\nCORRECT ANSWER: ${correctAnswer}\n\nGive a detailed step-by-step solution.`
  const res = await aiChat({ system, messages: [{ role: 'user', content: user }], json: false, action: 'explain' })
  return res.data.trim()
}

// ---------------------------------------------------------------------------
// PDF import pipeline: Gemini Vision understands the PDF -> DeepSeek structures.
// ---------------------------------------------------------------------------

const PDF_EXTRACT_PROMPT = `You are a precise question paper parser. Read the attached exam PDF carefully (it may be scanned, image-based, multi-column, or low quality).
Extract EVERY question along with its options, correct answer (if available), marks, and section. Preserve diagrams/graphs/tables/equations by describing them textually inside the question where needed.
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
Skip answer-key/instructions/cover pages. If a question cannot be read, skip it silently. Do NOT invent questions.`

export async function extractPdfQuestions({ buffer, mimeType }) {
  return visionExtract({ buffer, mimeType, prompt: PDF_EXTRACT_PROMPT })
}

const STRUCTURE_SYSTEM = `You convert extracted question paper data into the platform's canonical question schema. Keep every question verbatim; never alter meaning.`
const STRUCTURE_PROMPT = (extracted, exam) => `The following is raw OCR/vision extraction of an exam paper for ${exam ? exam.name : 'an exam'}. Normalize it into our standard schema.
Canonical question fields: examId, subject, chapter (infer), topic (infer), type, question, options, correctAnswer, explanation (infer a detailed one if missing), difficulty, marks, negativeMarks, estimatedTime, tags, year, shift, source:"pdf".
Output ONLY JSON: { "questions": [ { "examId": ${exam?.id || null}, "subject": "...", "chapter": "...", "topic": "...", "type": "...", "question": "...", "options": [...], "correctAnswer": "...", "explanation": "...", "difficulty": "...", "marks": number, "negativeMarks": number, "estimatedTime": number, "tags": [...], "year": number|null, "shift": "..." } ] }

RAW DATA:
${JSON.stringify(extracted)}`

export async function structureExtractedQuestions(extracted, exam) {
  const res = await aiChat({
    system: STRUCTURE_SYSTEM,
    messages: [{ role: 'user', content: STRUCTURE_PROMPT(extracted, exam) }],
    json: true,
    action: 'structure_pdf'
  })
  return res.data.questions || []
}

// ---------------------------------------------------------------------------
// Persist a batch of questions into the unified question table (dedup by hash)
// ---------------------------------------------------------------------------

export async function persistQuestions(list, { exam, source = 'ai', sourceMeta = null, mapping }) {
  // mapping: { subjectName: subjectId, chapterName: chapterId, topicName: topicId }
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
      subject_id: mapping?.subjectId || null,
      chapter_id: mapping?.chapterId || null,
      topic_id: mapping?.topicId || null,
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
