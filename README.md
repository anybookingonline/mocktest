# ExamAI — AI-Powered Mock Test & Practice Platform

A full-stack, production-ready platform for competitive exams (**NEET, JEE, UPSC, SSC, Banking, CAT, GATE, CUET** and more) with a complete **Admin Panel** and **Student Portal**.

The platform has two question sources that share **one unified database schema**:

1. **AI-generated questions** (primary) — powered by DeepSeek, with Gemini and OpenRouter as automatic fallbacks.
2. **Previous Year Questions** imported via **Admin PDF upload** — Gemini Vision extracts text, diagrams, graphs, tables, equations and images from any PDF (scanned / image-based / multi-column / low-quality), then DeepSeek structures the content into the standard question schema. Files are hashed so the **same paper is never processed twice**.

---

## Getting Started

```bash
# 1. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 2. Configure environment (see backend/.env.example)
cd backend
cp .env.example .env   # then fill in DATABASE_URL + optional UPSTASH_REDIS_REST_TOKEN

# 3. Seed the database (creates admin/student demo accounts, 8 exams, syllabus, sample questions)
cd backend && node src/utils/seed.js

# 4. Run both services (backend :3001, frontend :5173 with /api proxy)
./start.sh            # or: cd backend && npm run dev  &  cd frontend && npm run dev
```

### Database (production)

The app runs on **PostgreSQL** (Supabase-ready). Set these in `backend/.env`:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres connection string. **Use the IPv4 transaction pooler host** (`aws-0-*.pooler.supabase.com`, user `postgres.<project-ref>`), *not* `db.<ref>.supabase.co` — the direct host resolves only to IPv6, which many sandboxes/VPS cannot reach. |
| `PGSSL` | `false` for pooler with built-in TLS; `true` for strict verify |
| `PGPOOL_MAX` | Pool size (default `10`) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint (optional) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token. Without it the app falls back to an in-process TTL cache automatically |
| `JWT_SECRET` | Long random string — change in production |

The schema is created automatically on server start (`initSchema`) and by `seed.js`; no manual migrations needed.

### Demo accounts

| Role    | Email               | Password   |
|---------|---------------------|------------|
| Admin   | admin@examai.app    | admin123   |
| Student | student@examai.app  | student123 |

---

## AI Configuration (Admin → AI Config)

Configure keys in the admin panel. Keys are stored in the database, never in the repo.

| Provider      | Role                                | Get key at               |
|---------------|-------------------------------------|--------------------------|
| **DeepSeek**  | Primary engine (generation, mocks, doubts, explanations) | platform.deepseek.com |
| **Gemini**    | Fallback engine **and required for PDF Vision extraction** | aistudio.google.com |
| **OpenRouter**| Optional provider with **free LLM models** (e.g. `deepseek/deepseek-chat-v3-0324:free`, `meta-llama/llama-3.3-70b-instruct:free`, `google/gemini-2.0-flash-exp:free`) | openrouter.ai |

Routing: configured primary → automatic fallback chain → OpenRouter. Toggle fallback per your preference. Use **AI Config → "Test connection"** to verify.

---

## Real Exam Simulation Engine

- **Dynamic timer** — counts down with live warnings.
- **Live pace dashboard** — continuously recalibrates *average time per remaining question*. Spending too long on earlier questions automatically shrinks the per-question budget, and the dashboard shows live **speed**, **pace**, **accuracy**, and **completion predictions** ("you will not finish — speed up!").
- **Immediate verification** — every answer is verified instantly.
- **Wrong-answer pause** — on an incorrect answer the test **auto-pauses**, shows the correct solution with the option to **ask the AI tutor** for doubt clearing, then resumes the timer exactly where it stopped.
- Question palette with correct / wrong / review / current states, mark-for-review, skip, and auto-submit on timeout.

## Student Portal

- **Dashboard** — stats, recent tests, AI recommendations, weak-topic bars.
- **Practice** — chapter-wise, topic-wise, speed tests, revision mode, and fully custom test builder with difficulty mix.
- **Mock Tests** — predefined papers plus **"Generate AI Full Mock"** (DeepSeek writes fresh questions on demand).
- **Adaptive Practice** — difficulty auto-adjusts to your performance (correct → harder, wrong → easier) with streak tracking.
- **Doubt Solving** — standalone AI tutor chat + per-question doubts in the exam session and results review.
- **Bookmarks / Review mode / Test History / Leaderboard & Rankings / Analytics** — weak-topic analysis, subject-wise accuracy, score trends, speed analysis and personalized recommendations.

## Admin Panel

- **Exams** — CRUD for exam metadata (duration, marks, negative marking, questions).
- **Syllabus** — build subject → chapter → topic trees; question counts update live.
- **Question Bank** — search/filter by exam, source (AI/PDF/manual), difficulty; add, edit, delete, view.
- **PDF Import** — upload any exam PDF, track background processing status, automatic duplicate detection.
- **AI Config** — provider selection, API keys, models, fallback toggle, connection test.
- **Users, Analytics & Reports, Settings** — user management, platform-wide reports (by exam/source/difficulty, daily activity), and branding settings.

---

## Architecture

```
backend/   Node.js + Express + PostgreSQL (Supabase-ready) — pg pool + SQLite-style query layer
  src/
    index.js                 server entry (initSchema + async error handling)
    db.js                    unified schema (questions shared by AI + PDF sources), SQLite→PG translation
    middleware/auth.js       JWT auth + role guards
    routes/                  auth, exams, questions, tests, attempts, ai, import, analytics, admin
    utils/aiService.js       DeepSeek / Gemini / OpenRouter abstraction with fallback chain + Vision
    utils/aiTasks.js         question generation, PDF extraction→structuring, persistence (dedup)
    utils/redis.js           Upstash Redis cache with in-memory TTL fallback
    utils/seed.js            demo data
frontend/  React 18 + Vite + PWA (manifest + service worker)
  src/pages/student/         dashboard, practice, tests, exam-session, results, adaptive, doubts, bookmarks, history, rankings, analytics
  src/pages/admin/           dashboard, exams, syllabus, questions, pdf-import, ai-config, users, reports, settings
```

### Unified question schema

Both AI-generated and imported questions land in the **same `questions` table** (`source` = `ai | pdf | manual`) with exam / subject / chapter / topic mapping, type, options, correct answer, explanation, difficulty, marks, negative marking, estimated time, year, shift, tags, images and a **content hash** for deduplication — so new question sources can be added without schema changes.

### Scalability notes

- **PostgreSQL** with indexes on exam/subject/chapter/topic/source/difficulty — built for multi-million-question workloads; connection pooling via `PGPOOL_MAX`.
- **Upstash Redis** cache layer (leaderboard/exam-list hot reads) with an automatic in-process TTL fallback, so the app works even without Redis.
- Background PDF processing keeps the API responsive; dedup by file hash prevents redundant Gemini bills.
- PWA-ready frontend (offline-capable service worker) with a mobile-responsive layout.
