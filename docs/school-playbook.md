# 🏫 Aisepadho — School Playbook
### Schools/Coachings ko kaise cater kar rahe hain — complete onboarding-to-success guide

> **Ye doc kiske liye hai:** Aap (platform owner/team) — school ya coaching ko haath se pakad kar
> free pilot se lekar paying client banane tak ka pura process. Har step me exact clicks, exact
> screens, aur ready-made sales lines ke saath.
>
> Related docs: `school-pitch.md` (sales script), `teacher-features.md` (roadmap), `product-overview.md`

---

## 0. Ek line me model

**Aap dete ho:** school ke naam/brand ka apna AI test platform (white-label web app),
jisme students test dete hain, AI doubts solve karta hai, aur school ko live reports milte hain.
**School deta hai:** students (ya bas ek Excel/CSV). Content banane ki zarurat nahi —
AI aur aapka question-bank engine sab generate karta hai.

```
Aap (Platform)                    School/Coaching                     Students
─────────────────                 ───────────────                     ────────
Institute banate ho      ──────►  Sub-admin login milta hai  ──────►  Invite code ya CSV se
(PW admin → Institutes)           (own dashboard + branding)          accounts auto-create
                                        │                                │
Branding set karte ho     ◄──────────┘  Students monitor karte hain ◄──┘  Tests + AI doubts
(naam, logo, colors)              (weak topics, reports)                  use karte hain
```

---

## 1. Sales phase — pehle meeting (5 min checklist)

Pitch ka pura script `school-pitch.md` me hai. Meeting me ye 5 cheezein confirm karo:

- [ ] **Student count** (pricing tier decide karega — dekho `pricing-audit.md`)
- [ ] **Classes/batches** (kitne groups chahiye — har batch ka alag invite code banega)
- [ ] **Branding material** (logo PNG, school colors, tagline)
- [ ] **Pilot duration** (standard offer: **30-din free pilot**, poore features)
- [ ] **Ek SPOC** (single point of contact — usually IT teacher ya coordinator)

**Kill line** (agar bolne lagen "hamare paas to material hai"):
> "Bilkul sahi — wahi material PDF me daal dijiye, AI usi se practice tests banata hai.
> Aapka content, hamara engine."

---

## 2. Onboarding — aap kya karoge (platform admin, ~15 min)

### Step 2.1 — Institute create karo
1. Admin panel → **🏫 Institutes (White-label B2B)**
2. **New Institute** → naam, trial period details bharo
3. System ek **invite code** generate karta hai: `SCH-XXXXXXXX` (4-byte hex)

### Step 2.2 — Sub-admin (school ka SPOC) banao
1. Institute row par **👤 Sub-admin** → naam + email
2. System **credentials screen dikhata hai — ek baar hi dikhta hai**, screenshot le kar school ko bhejo
3. Ye sub-admin ab apne institute ka **sirf apna data** dekh sakta hai (platform-wide routes
   se blocked hai — security by design, `platformOnly` middleware enforce karta hai)

### Step 2.3 — Branding set karo (ya school se poochh kar)
Sub-admin ya aap, **Institute Dashboard → 🎨 Aapka Branding** me set karo:
- Platform name (school ka naam — poore app me tab-title, sidebar, reports me live rebrand)
- Logo URL
- Primary/accent colors (poori UI theme badal jati hai)

**Student ko lagega ye school ka apna app hai** — aapka naam kisi jagah nahi dikhta.

### Step 2.4 — Students onboarding (do tarike)
| Tarika | Kab use karo | Kaise |
|---|---|---|
| **Invite code** | Students self-join karen | Register page par code daalo → account apne aap institute se link (`?sch=SCH-XXXX` link bhi share kar sakte ho — branding apne aap resolve hoti hai) |
| **Bulk CSV import** | Aapke paas class list hai | Institute Dashboard → **⬆ Bulk CSV Import** → format: `name,email,password` ek line per student (comma ya semicolon, header optional) |

CSV me jo accounts bante hain unhe **Telegram welcome message** bhi jaata hai
(agart student ne bot link kiya ho) — "Aapka account ready hai" ke saath.

### Step 2.5 — Pehla test karwa do (DAY 1 par hi)
School ko bolo: **kal tak har batch ka ek test ho jaye.** Test dene ke 2 raaste:
- Aap/sub-admin **question bank se test** banao (aapke 8 competitive exams ke 374+ topics ready hain)
- School **apna PDF upload** kare (PDF Import se PYQ/practice paper → AI questions banata hai)

> ⚠️ Golden rule: **Day 1 par test nahi hua = pilot dead.** Pehla test hi hook hai —
> score, analysis, aur weak topics dekh kar hi school value samajhta hai.

---

## 3. School ko kya-kya milta hai (feature map — pitch me wahi bolna hai)

### A. Students ko (school ke branding me)
- **Adaptive AI practice** — har student ke level ke hisaab se questions
- **Mock tests + PYQs** — school apna PDF daale to usi ka test
- **AI doubt solving** — 15/day (text), voice doubts bhi (Hindi/Hinglish)
- **1v1 Quiz Battles + leaderboards** — competition, streaks, engagement
- **Group study + discussions** — peer learning
- **AI Focus Areas** — kaunsa topic baar-baar exam me aata hai
- **Spaced revision** — bhoolne ke pattern ke hisaab se daily plan

### B. School (sub-admin) ko
- **Live dashboard** — active students, tests taken, avg score/accuracy
- **Weak-topic alerts** — "Class 10 me Algebra weak hai" → teacher ko target karne ka data
- **Student list + reports** — per-student tests, accuracy, last active (printable/PDF-ready)
- **Invite codes** — har batch ka alag code, on/off toggle
- **Bulk CSV** — poori class ek file me

### C. Aap control me
- Institute create/trial/expire — sab aapke admin panel se
- Sub-admin credentials aap hi issue karte ho
- Data institute-wise **isolated** hai — ek school doosre ka data kabhi nahi dekh sakta

---

## 4. Pilot ke 30 din — engagement calendar

| Din | Aap kya karoge | School se kya chahiye |
|---|---|---|
| **Day 0** | Institute + sub-admin + branding + CSV import (upar wale steps) | Logo, colors, student list |
| **Day 1** | Pehla batch test live karwao | 1 period assign karo |
| **Day 3** | Dashboard screenshot school ko bhejo — "dekhoooo kitne active hain" | Kuch nahi |
| **Day 7** | Weak-topic report share karo ("in 3 topics me class weak hai") | Isse teacher ko de |
| **Day 14** | Parent-report sample dikha do (printable) | Parent meeting ki date lo |
| **Day 21** | Usage stats: tests/week, doubts solved, battles | Feedback form (3 sawaal) |
| **Day 30** | **Renewal meeting** — pilot report + pricing proposal | Decision |

**Follow-up message template (Day 3):**
> "Sir, aapke students ne pichhle 3 din me X tests diye, Y doubts solve hue.
> Class 10 me Trigonometry sabse weak mili — aapke teacher ko next class me focus
> karna chahiye. Ye sab automatic milta hai. Pasand aa raha hai to kal call kar
> full setup kar lete hain?"

---

## 5. Objection handling (quick fire)

| Objection | Jawab |
|---|---|
| "Content hamara hai, tumhara kya hai?" | "Engine aapka content use karta hai — PDF daalo, AI questions banata hai. Aapka content, hamara AI." |
| "Bachche phone padhai me use nahi karenge" | "Wahi to — unka phone already distraction hai. Isme battles, streaks, leaderboards hain — same engagement, ab padhai par." |
| "Teachers ka time nahi hai" | "Teacher ko kuch nahi karna. Test banane, checking, analysis — sab AI karta hai. Teacher ko sirf weak-topics ki report milti hai." |
| "Data safe nahi hoga" | "Data institute-wise isolated hai, kisi ko sell nahi karte — likhit policy. Aap export/delete kabhi maang sakte ho." |
| "Mehenga hai" | "Per student per saal ek pizza ke barabar. 30 din free pilot — pasand na aaye to zero." |

---

## 6. Pricing structure (summary — detail `pricing-audit.md` me)

| Institute size | Pricing | Notes |
|---|---|---|
| Small (upto 200 students) | **₹15,000/saal flat** | Setup cost cover; white-label + PDF compiler + parent reports |
| Medium (200–1000) | **₹50/student/saal** | Minimum billing baseline ₹20,000 |
| Large (1000+) | **Custom** | Dedicated app + extra AI budget |

Pilot hamesha **30 din free** — conversion ke baad installation charges (one-time)
alag le sakte ho, usme branding + CSV import + teacher training cover karo.

---

## 7. Ops hygiene (har client ke liye)

- [ ] Sub-admin credentials **secure channel** se (WhatsApp pe plaintext password mat bhejo — call karke batao)
- [ ] Institute ka **SPOC number Telegram par note** karo (support fast hota hai)
- [ ] Har hafte ek baar institute dashboard dekho — **agar 7 din se koi test nahi hua to SPOC ko ping karo** (silent churn ka pehla signal)
- [ ] Trial end se 5 din pehle renewal call schedule karo — achanak mat maango
- [ ] School ke custom requests (naya feature chahiye) ko `teacher-features.md` me log karo — pattern banega to ban jayega

---

## 8. Kya abhi NAHI hai (honest gaps — client se chhupao mat, manage karo)

- **Teacher role** abhi alag se nahi hai — sub-admin hi teacher ka kaam karta hai
  (roadmap me hai: `teacher-features.md` — teacher role + batch assignment + homework)
- **Native app** nahi hai — PWA hai (Android/iOS par "Add to Home Screen" se app jaisa chalta hai)
- **WhatsApp integration** abhi nahi — reports abhi printable/linkable hain

Ye teeno roadmap me hain; client ko bole "coming in Q_next" — date commit mat karo.
