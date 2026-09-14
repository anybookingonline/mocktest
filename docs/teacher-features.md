# 👨‍🏫 Teacher Features — Suggestions & Roadmap (Aisepadho)

> Ye doc teacher-facing features ke ideas rakhta hai — kya abhi bana sakte hain,
> kya Phase-2 me, aur kaunse **paid add-ons** ban sakte hain (monetization angle ke saath).
> Current state: teacher role alag se nahi hai — **sub-admin (institute owner) hi teacher ka kaam karta hai**.

---

## 1. Foundation pehle (bina iske kuch nahi chalega)

### A. `teacher` role + batch system ⭐ (sabse zaroori)
- Abhi roles sirf `student` aur `admin` hain. Ek naya **`teacher` role** chahiye:
  - Institute sub-admin teacher ko **batch** assign karega (Batch: "Class 12-A", "SSC Morning", "Bank PO Evening")
  - Teacher sirf **apne batch ke students** ka data dekhe — privacy + scope dono sahi
- DB me bas: `users.role = 'teacher'` + `teacher_batches (teacher_id, batch_name)` mapping
- Sub-admin panel me "Teachers" tab: add teacher, batch assign, remove

### B. Teacher dashboard (`/teacher`)
- Teacher login kare to alag dashboard (InstituteDashboard ka halka version):
  - Apne batch ki **aaj ki activity** (kitne students ne test diya, kaun inactive hai 3+ din)
  - **Weak topics** apne batch ke ( Analytics me already computed hai, sirf filter chahiye)
  - Student-wise summary: avg score, accuracy, last active, stree

---

## 2. Quick wins (1-2 hafte, high impact, low cost)

| Feature | Kya karta hai | Teacher ko kyu chahiye |
|---|---|---|
| **Homework / Assignment dana** | Teacher ek test select kare + due date set kare → batch ke sabko nav me "📌 Homework due" badge | "Class ka homework track karna" — coaching ka daily pain point |
| **One-click batch test** | Teacher topic/chapter select kare → AI usi ka test banaye → poore batch ko assign | Aaj test banane me 30 min lagte hain; 30 second ho jayenge |
| **Student report (print/PDF)** | Har student ka printable report card (tests, accuracy, weak topics, progress graph) | Parent-teacher meeting me wahi ek page kaafi hai |
| **Inactive alerts** | 3+ din se inactive students ki list + Telegram DM (agar student bot linked hai) | "Bachcha gayab ho gaya" — retention teacher ke haath me |
| **Doubt digest** | Teacher ko apne batch ke doubts ka daily/weekly summary (kaunsa topic sabse zyada confuse kar raha hai) | Teaching next class ko target karne ke liye data |

---

## 3. Medium features (Phase-2, 3-4 hafte)

1. **Class-wise leaderboards** — batch ka apna leaderboard (overall AIR ke saath "Batch rank #3")
2. **Custom question sets** — teacher apne questions add kar sake (simple form), AI unhe exam format me convert kare + explanations generate kare
3. **Scheduled tests** — "Sunday 10 AM test" — auto-unlock, auto-close, auto-report
4. **Attendance proxy** — daily quiz completion = attendance; institute ke existing attendance system me export (CSV)
5. **Parent reports automation** ⭐ — har Sunday evening, parent ko (Telegram ya WhatsApp-link) student ka weekly report auto-jaye. **School pitch me iska sabse bada selling point hai** (already pitch doc me phase-2 bola hua hai)

---

## 4. Paid add-on banne wale teacher features (monetization)

| Add-on | Kisko bechein | Pricing idea | Kya naya kharcha aata hai |
|---|---|---|---|
| **Assignment Pack** | Coaching (₹2-5k/month) | Batch size × ₹10-20/student/month | Storage only — AI cost nahi (test DB se) |
| **AI Question Authoring** (teacher ke questions ka polish + explanations) | Coaching + schools | ₹999/month per institute | AI tokens per question (batch of 10 ek call me) — same as existing generation cost |
| **Parent Reports (auto weekly)** | Schools (₹50-100/student/year me bundle) | Institute plan me included from Growth tier | Telegram/WhatsApp send cost — negligible |
| **Advanced Batch Analytics** (topic heatmaps, comparison charts) | Coaching ₹1.5-3k/month | Queries + caching, no AI | Nothing new |
| **Custom branding per batch** | Coaching | Included in Growth plan | None |

**Note:** ye sab existing addon system (`addons.js` + admin pricing UI) me directly fit ho jayenge — naye add-on entries + institute-level entitlement check.

---

## 5. Kya NAHI banana (scope control)

- ❌ Live video classes — Zoom/Meet already exist, teacher wahi use karega
- ❌ Attendance hardware/biometric — out of scope
- ❌ Full LMS (content library, video hosting) — YouTube embed se kaam chalao
- ❌ Grading handwriting/essay — AI accuracy risk, trust issue

---

## 6. Suggested order (aapke school presentation ke hisaab se)

**Demo me dikhane layak (2 hafte):**
1. Teacher role + batch assignment (foundation)
2. Teacher dashboard with weak topics + inactive list
3. One-click batch test (AI) + assignment badge students ko

**Phase-2 (presentation ke baad):**
4. Parent weekly reports (Telegram)
5. Class leaderboards + scheduled tests
6. Add-ons activate: Assignment Pack, AI Question Authoring

> Ek line me: **pehle "teacher ko apne batch ka control" do, phir "teacher ko time bachane wale AI tools" do, phir unko add-on me becho.**

---

## 7. Teaching Excellence — "Guru Studio" 🎓 (teachers ko student-jaisa focus)

> Students ke liye jo engine banaya (AI question generation + real weak-topic analytics + points/levels),
> wahi teacher ke liye **padhane ki quality** ka engine ban sakta hai. Ye section workflow features
> (Section 2-3) se alag hai — ye **classroom engagement + pedagogy + personality** ke ideas hain.

### A. Topic-wise Teach Kit 📚 (topic wise studies)
Har topic ka AI-ready "Teach Kit":
- **Concept map** + 2 real-life analogies (Bank PO: percentages = EMI/discount examples)
- **Common misconceptions** — generic AI list nahi, **aapke hi students ke real weak-topic data se** ("is topic me aapke batch ke 62% students galat karte hain")
- **PYQ frequency** — "last 5 years me 8 baar poocha gaya" (platform ke PYQ data se)
- **Difficulty ladder** — easy → tough questions ka teaching order (bank se auto-pick)
- **30-min lesson plan** + end me homework auto-assign (platform test)
- **Board notes mode** — teacher phone par kholo, bade font me explanation + board questions (offline classes ke liye)
- Cost: per topic ek AI call, cache — marginal ~zero

### B. Classroom Live Quiz ⭐⭐ ("puri class diwani" wala feature)
Kahoot-style live quiz, platform ke andar:
- Teacher projector par host screen kholta hai → **4-digit PIN** → students apne phone (app) se join
- 15-second timer, live leaderboard, speed bonus, winner celebration
- **Modes:** Rapid Fire (speed) · Team Battle (class 2-4 teams me split) · Revision Rumble (jin topics ki revision due hai wahi questions)
- **Infra reuse:** battles ka room + polling logic, question bank, points system — **AI cost zero** (bank se)
- Coaching/school demo me ye sabse powerful 5-minute hai — Testbook/Adda247 jaise student-only apps ke paas ye **nahi hai**

### C. Confusion Check (2-second class pulse)
- Class ke beech teacher ek quick poll push kare: "Ye concept clear hai?" → students phone par 👍/👎
- Red >30% to AI **turant ek alternate explanation** de de (dusra analogy)
- Zero AI cost jab tak class green hai

### D. Personality & Soft Skills Pack 🌟 (schools ke liye gold)
- **GD Simulator** — AI 3-4 personas me group discussion chalata hai (moderator, aggressive candidate, quiet one); student feedback: points made, relevance, interruptions
- **One-minute speech** — voice input (existing voice/STT infra reuse) → AI feedback: structure, filler words, pace
- **Interview drills** — exam-specific Q&A practice
- **Personality Report Card** (radar chart): Consistency · Participation · Curiosity (doubts) · Competitiveness (battles) · Communication — parents ko printable
- School pitch me "Personality Development" official language hai (NEP-aligned) — legal-safe wording

### E. Teacher ka apna growth loop
- **Teacher Scorecard** — batch improvement delta (month-over-month class avg), homework completion %, doubt-resolution time → institute ke teachers ka leaderboard (owner ko performance culture)
- **Monday Class Insight Digest** (Telegram) — weak topics + inactive students + suggested week plan
- **Weekly 5-min PD tip** — batch ke weak topic se linked teaching hack
- **Badges + verifiable certificates** — "Top Mentor 2026" (shareable image) — coaching owner ko teacher retention me help, aapko free marketing

### F. Infra reuse map (kitna naya kaam hai)
| Idea | Reuse ho raha | Naya kaam | Marginal cost |
|---|---|---|---|
| Teach Kit | PYQ data, weak-topic analytics, aiTasks | prompt + cache table | ~0 (cached per topic) |
| Classroom Live Quiz | battles rooms + polling + points + bank | host UI + PIN join + projector view | 0 AI |
| Confusion Check | auth + ek chhoti table | 1 endpoint + 2 buttons | 0 |
| GD Simulator | AI service + chat UI pattern | persona prompts | AI per session |
| Speech feedback | voice infra (STT/TTS) | scoring prompt | AI per session |
| Personality radar | points + analytics data | weights + radar chart | 0 |
| Teacher Scorecard | analytics queries | weights + UI | 0 |
| Digest / PD tips | cron + Telegram utils | 2 prompts | ~0 (weekly) |

### G. Monetization
| Product | Kis ko | Pricing idea |
|---|---|---|
| Guru Studio Lite (Teach Kit + Digest + Scorecard) | sab institutes | plans me included (retention value) |
| Classroom Live Quiz | white-label me included; standalone | ₹999/month add-on |
| Soft Skills Pack (GD + Speech + Report Card) | schools + coaching | student add-on ₹79 ya institute bundle |
| AI Question Authoring + Certificates | coaching | ₹999/month (Section 4 me already) |

AI-cost guard: GD/speech sessions par daily cap per institute (existing rate-limit layer reuse).

### H. Kya NAHI (same scope control)
Live video classes, attendance hardware, full LMS — Section 5 wahi rules.
