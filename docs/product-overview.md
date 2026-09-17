# AisePadho — Product & Technical Overview

> AI-powered competitive exam + school learning platform for India.
> B2C self-prep + B2B white-label for schools & coaching institutes — one engine, one question bank.

---

## 1. What AisePadho Is

AisePadho is an interactive learning and test-prep platform where students **practice, take AI-structured mock tests, get instant AI doubt-solving in their own language, and compete** — while schools and coaching institutes run the same platform as **their own branded product** (white-label) with their own uploaded content.

**One-line pitch:** *"Every student gets a personal AI tutor and a full test-prep engine; every school gets its own branded version of it — at ₹299/student/year."*

**Live status:** production code complete (student app, admin panel, B2B institute portal, PDF content pipeline, monetization, marketing suite). Deploy targets: Freebuff managed hosting (current), customer VPS via Coolify (playbook ready — `docs/vps-rollout.md`).

---

## 2. The Problem

| Segment | Pain |
|---|---|
| **Students (JEE/NEET/SSC/…, Class 7–12)** | Coaching is expensive (₹50k–150k/yr); test series are static PDFs; doubt-solving waits for teachers; quality content is English-only |
| **Schools & coaching institutes** | Want an app/online presence but can't afford to build tech; their own question papers are print-only; no visibility into student performance |
| **Platform operator (us)** | AI costs can destroy margins at scale — most AI ed-techs burn money per student |

---

## 3. The Solution — Three Layers

```
┌────────────────────────────────────────────────────────┐
│  Layer 3: WHITE-LABEL (B2B)                            │
│  School/coaching runs AisePadho as THEIR brand:        │
│  own logo, name, colors, custom domain, invite links,  │
│  own uploaded papers → own review → their students     │
├────────────────────────────────────────────────────────┤
│  Layer 2: CONTENT PIPELINE                             │
│  Any exam/class: PDF upload → AI extraction →          │
│  dedup → mandatory human review → question bank        │
├────────────────────────────────────────────────────────┤
│  Layer 1: LEARNING ENGINE (shared, unified)            │
│  Practice · Mocks · Adaptive · Battles · Analytics ·   │
│  AI Tutor · Revision · Rankings · Current Affairs      │
└────────────────────────────────────────────────────────┘
```

The engine is **content-agnostic**: adding a new exam (e.g. "Class 8 School Exam" or a state CET) in the admin panel makes it appear automatically across the landing page, signup, practice, tests, and analytics — no code changes. This is what lets us go from competitive exams to school batches without rebuilding anything.

---

## 4. Complete Feature List

### 4.1 Student learning core
- **Question Bank** — unified, syllabus-mapped (Exam → Subject → Chapter → Topic), supports MCQs with negative marking, year/shift tags for PYQs
- **Practice mode** — topic/chapter-wise practice with instant explanations
- **Mock tests** — real exam simulation (duration, marking scheme per exam), test sessions with resume
- **PYQ import** — platform admin uploads official past-paper PDFs; AI extracts structured questions
- **Adaptive learning** — AI picks questions targeting the student's weak areas based on topic-level mastery stats
- **AI Doubt Solver (Student Helper)** — chat-based tutor; answers in the student's language (Hindi/English/Hinglish mirroring); can explain any question on the platform; white-label aware
- **Revision engine** — spaced-repetition reminders + revision mocks from previously missed questions
- **Focus Areas** — weak-topic drill lists
- **Bookmarks & History** — saved questions, full attempt history, results with per-question breakdown
- **Analytics** — accuracy, speed, topic mastery trends, exam-readiness view

### 4.2 Engagement & social layer
- **Battles** — 1v1 and group quiz battles, real-time scoring, question draws respect institute isolation
- **Rankings / All-India Rank (AIR)** — leaderboards per exam
- **Group study** — group creation with the **group deal** monetization engine (N paid members unlock M free seats — default 2 paid → 1 free, max 3 free); free members get group-space access only
- **Daily Current Affairs** — quiz-based news with optional paid add-on
- **Retention plan hook** — results/history/doubts stored permanently under the paid plan
- **Telegram bot** — daily practice notifications and quiz pushes
- **PWA** — installable mobile app experience, no app-store dependency

### 4.3 B2B — schools & coaching (white-label)
- **Institute portal (sub-admin dashboard)** — institute's own control panel
- **White-label branding** — institute name, logo, colors; custom domain or `?sch=CODE` invite links; the whole UI (including AI helper naming) follows the institute's brand
- **Student onboarding** — invite codes + CSV bulk import; students auto-join the institute
- **Institute PDF pipeline (self-serve content)** — the school uploads its own test papers/class exams:
  ```
  Sub-admin uploads PDF
    → monthly import quota check (admin-controlled, 0 = disabled)
    → file-hash dedup (same-institute reuse = free, no AI cost)
    → archive to Backblaze B2 (durable copy)
    → background AI extraction (Gemini Vision + DeepSeek structuring;
      handles scanned papers)
    → staging review queue — MANDATORY human gate
    → sub-admin approves/rejects per question (or bulk)
    → approved questions enter the unified bank, tagged to the institute
  ```
- **Content isolation (privacy guarantee)** — institute-uploaded questions carry `institute_id` and are **enforced server-side** to be visible only to that institute's students: never in another institute's practice, mocks, adaptive picks, battles, analytics, or AI-tutor context. Platform/curated questions remain global. Dedup is institute-scoped, so two schools uploading the same paper each get their own private copies — no cross-inheritance.
- **Per-institute AI quotas** — two independent dials: PDF import quota (papers/month) and AI tutor quota (doubts/day). One school's content activity never consumes another's student AI budget.
- **Institute analytics** — platform admin sees per-institute usage, review-queue backlog, and pipeline health

### 4.4 Platform admin
- Dashboard (users, questions, daily activity), **Users** management (plans, manual activation), **Exams** CRUD (any exam/class auto-propagates platform-wide), **Syllabus builder** (subject→chapter→topic tree), **Question Bank** editor, **PDF Import (PYQs)**, **Institutes** (create institutes, set quotas, view stats), **Payments** (verify manual/UPI proofs), **Coupons** (bulk coupon generation, discount tracking), **AI Config** (provider keys, model routing, per-feature limits), **Settings** (branding, prices, feature flags), **Reports**
- **Marketing Studio** — AI-generated weekly content calendar, marketing assets, **school outreach drafts** (admin panel), and the **Sales Helper chatbot** embedded on the public marketing pages (lead capture + coupon-aware sales conversations)

### 4.5 Trust & safety engineering
- Server-side auth (JWT), role separation (platform admin / sub-admin / student)
- Institute scoping enforced in **every** question-retrieval path (verified by automated isolation tests) — not just UI filtering
- Mandatory review gate prevents AI hallucination from reaching students directly
- Rate limiting on AI endpoints; per-user and per-institute quotas

---

## 5. Architecture

**Stack:** Node.js (Express) + PostgreSQL · React (Vite) SPA + PWA · Backblaze B2 (PDF storage) · Gemini + DeepSeek AI providers (configurable via admin) · Upstash (cache/rate-limit) · Telegram Bot API · Razorpay/Stripe/PhonePe/UPI-manual payment rails.

**Key design decisions:**

1. **One unified question bank.** Practice, mocks, adaptive, battles, analytics, and AI tutor all read the same table — a feature for one mode is instantly available to all modes. Institute privacy is an ownership tag + server-side visibility rule, not a separate silo.
2. **AI where it pays, humans where it matters.** AI does extraction/structuring/doubts. A human (sub-admin) approves content before students see it. Every AI-touching surface is quota-bounded.
3. **Cost control is architectural, not aspirational:**
   - File-level dedup: same paper re-uploaded = zero AI calls
   - Question-level dedup: ownership-aware content hashes
   - Zero-marginal-cost features: battles, analytics, revision (pure DB), group study (no AI), current affairs cached daily
   - AI doubts: per-user daily caps; institutes get per-student yearly caps (≤100/year pilot guarantee)
4. **White-label = configuration, not forks.** One deployment serves all institutes; branding resolves per-domain/per-link at runtime.
5. **Ops-light by design:** single Node process + Postgres; PDF heavy lifting happens on AI providers' servers, not ours. Runs comfortably on a 2-core/4GB slice; horizontal path documented.

**Deployment:** Freebuff managed hosting today; customer VPS (Coolify + Postgres 16 + Node 20) with a step-by-step rollout/migration playbook (`docs/vps-rollout.md`), env-var matrix, backup checklist, and scaling triggers.

---

## 6. Monetization

### B2C — students
| Plan | Price | What it is |
|---|---|---|
| Free | ₹0 | Practice + limited daily AI doubts (honest caps, shown in UI) |
| **Data Retention (1-year)** | **₹499/yr** | Full history, results, bookmarks, AI explanations kept for a year |
| Add-ons | admin-priced | AI Power (higher AI limits) · Voice doubts · Current Affairs Pro · Focus Areas+ |
| Group deal | N paid → M free | 2 paid members unlock 1 free seat (max 3 free/group) — viral family/friend loops at zero CAC |

### B2B — schools & coaching
| Item | Price | Notes |
|---|---|---|
| School plan | **₹299/student/year** | White-label + self-serve PDF pipeline + AI tutor |
| Pilot | 1 month free | Risk-free trial; **hard per-student AI cap (≤100/yr)** guarantees bounded pilot loss |
| Import quota | e.g. 20–50 PDFs/month/institute | Admin-tunable per institute |

### Cost realism (why margins hold)
- A ₹299 school seat with a 100-doubt/year cap costs roughly **₹15–30/year in AI** at current provider pricing → **90%+ gross margin** before content costs
- ₹499 B2C with ~15 AI interactions/day cap + heavy non-AI features → AI cost per active user stays a small single-digit percentage of revenue
- School PDF pipeline: dedup + monthly quota + human review mean extraction cost is capped and paid once per unique paper
- All numbers admin-tunable in-app (no redeploy) — pricing/quotas can be tuned against real usage data

### Go-to-market
1. **Coupon-code rollout** on social media (built: bulk coupon engine + discount analytics)
2. **School outreach** (built: AI-generated outreach drafts in Marketing Studio + Sales Helper on the site)
3. **"Apne Bachhe ko Pro Banao"** — Class 7–12 + droppers batches next wave (content-agnostic engine already supports it; admin creates exams → everything auto-propagates)
4. Group-deal virality: students pull their friends in to unlock free seats

---

## 7. What's Built vs. Next

**Built and tested (current state):**
- Full student app (17 screens), admin panel (14 screens), institute portal
- PDF pipeline end-to-end: quota → dedup → B2 archive → AI extraction → mandatory review → bank
- Institute content isolation with automated proof-tests (21-assertion isolation suite, 16-assertion dedup-scope suite, plus pipeline regression suites — all passing)
- Monetization rails: 3 gateways + UPI-manual + coupons + group deal + add-ons
- Marketing suite: content calendar, asset generation, school outreach drafts, Sales Helper
- White-label branding system (domain/invite-code driven)
- Deployment playbooks (Freebuff + customer VPS)

**Next (data-driven, not architectural):**
1. Quota tuning against real usage (papers/month, doubts/day) — config changes only
2. Institute-specific "Notes" field for the support helper (cheap per-school customization)
3. Optional per-institute question-visibility toggle (currently shared-with-platform by design)
4. Regional-language UI packs (AI layer already mirrors user language)

---

## 8. Why This Wins

- **Moat via architecture, not content:** the pipeline (upload → review → bank) plus cost-bounded AI is hard for coaching institutes to replicate; they don't have to — they buy it from us, branded as theirs.
- **Every rupee of AI spend is capped by design** — quotas, dedup, review gates — so growth doesn't blow up costs.
- **One engine, two markets:** B2C students today, B2B schools/coaching tomorrow, new exam verticals with zero engineering.
- **Honest product:** no "unlimited" claims; caps are visible in the UI. Trust compounds with parents and schools.
- **Frugal by default:** runs on a single VPS slice at launch; the same architecture served the scale plan documented in the ops playbook.

---

*Document reflects the codebase as of Sept 2026. Technical reviewers: see `docs/vps-rollout.md` (ops), `backend/scripts/*-smoke.mjs` (verification suites), and `backend/src/utils/visibility.js` (isolation rule).*
