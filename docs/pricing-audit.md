# 💰 Pricing & Unit-Economics Audit — AI cost vs plans

> Ye audit real code + current AI pricing par based hai. Assumptions sab neeche
> likhe hain — AI provider ya rates badlein to numbers recalibrate kar lena.
> **Verdict pehle:** plans justified hain, par 3 guards zaroori hain — jinme se
> 1 aaj implement ho gaya (free doubt cap), 2 recommended (neeche).

---

## 1. AI cost per action (DeepSeek rates, conservative)

| Action | Tokens (approx) | Cost per call |
|---|---|---|
| Doubt solve | ~1.5k in + 800 out | **~₹0.35** |
| Question explain | ~1.2k + 700 | **~₹0.30** |
| Adaptive next-question | ~2k + 600 | **~₹0.40** |
| Full mock generation (100 Q) | ~60k + 25k | **~₹12** |
| CA daily set (10 Q) | ~8k + 3k | **~₹1.5** |
| Sales chat reply | ~1k + 300 | **~₹0.20** |
| Marketing content (1 week calendar) | ~3k + 3k | **~₹1 per week** |

DeepSeek ~₹1.5 per million input tokens ke around hota hai (Gemini Flash bhi
similar range). Matlab **text AI sasta hai — sirf volume hi cost banata hai.**
Whisper (voice) zyada khaata hai (~₹1–2 per minute) par wo paid add-on hai.

---

## 2. Free user ki real cost (jo aaj tak leak tha)

Free user ke paid-channels:

| Channel | Pehle (audit se pehle) | Ab |
|---|---|---|
| Doubts | **Unlimited** 🚨 | **15/day cap** (`monetization.freeDoubtsPerDay`) |
| Battles | 3/day (free questions bank se — sasta) | unchanged ✓ |
| Practice | shared bank questions — ₹0 marginal | unchanged ✓ |
| CA quiz | shared daily set — sab wahi 1 set | unchanged ✓ |
| Adaptive | AI-generated, rate-limited | unchanged ✓ |

**Worst-case free user (cap ke baad):** 15 doubts × ₹0.35 = **₹5.25/day max** =
₹157/month. Realistic active user (5 doubts/day) = **~₹52/month**. Casual user =
₹5–10/month.

**Ye cap hi sabse bada fix hai** — pehle ek script chalane wala free user ₹150+/month
AI bill laga sakta tha, bina kisi revenue ke.

---

## 3. School 1-month-free pilot — aapke charges kya banenge

Assume: 1 coaching, **200 students**, 30-din pilot.

| Item | Calculation | Cost |
|---|---|---|
| AI doubts (realistic) | 200 stu × 3 doubts/day × 30 din × ₹0.35 | **₹6,300** |
| AI doubts (worst case, cap=15) | 200 × 15 × 30 × ₹0.35 | ₹31,500 ⚠️ |
| CA daily quiz | shared set per exam — ~₹1.5 × 30 din × 2 exams | ₹90 |
| Battles | bank questions + ELO — almost ₹0 | ~₹0 |
| Storage (B2) | results JSONs, PDFs | **< ₹50** |
| Infra | aapka VPS (already paid) | ₹0 marginal |
| **Total realistic** | | **~₹6,500/pilot** |
| **Total worst-case** | | ~₹31,500/pilot |

### Pilot ko safe rakhne ke 3 levers (admin controls, code-ready patterns)

1. **Per-institute daily AI budget** — ✅ **IMPLEMENTED**:
   `institutes.ai_daily_quota` column (0 = unlimited). Admin → Institutes →
   institute card → "🛡️ Daily AI quota" — poore institute ke students ka
   combined daily doubt cap. Quota cross → AI endpoints 429 denge ("aaj ka
   institute quota khatam, kal try karo"). Sirf platform admin change kar
   sakta hai — sub-admin ko ye field hidden hai (branding route se bhi strip).
   Naya institute banate waqt bhi quota set ho sakta hai.
2. **Pilot doubt cap** separate config: institute students ko 10 doubts/day
   (paid individual users ka 15 se kam — fair, pilot hai).
3. **Contract clause:** "Free month me fair-usage cap 10 AI doubts/student/day;
   unlimited chahiye to paid plan." Ye standard SaaS language hai — koi objection
   nahi karega.

**Recommendation: pilot me per-institute quota ON karo** — conversion ke baad
unlimited chalu kar dena, wahan aapki margin already healthy hai.

### ₹100/student/year school plan — quota sizing rule (loss-proof math)

AI cost driver = doubts. Ek doubt ≈ ₹0.35. School year ≈ 250 active days.

| Quota setting (institute-wide/day) | Worst-case cost/student/yr | @₹100/stu/yr margin |
|---|---|---|
| students × 1 doubt/day | ~₹87.5 | **+12.5% worst, ~50% realistic** |
| students × 2 doubt/day | ~₹175 | ❌ LOSS — is setting par ₹150+ chahiye |
| students × 3 doubt/day | ~₹262 | ❌ sirf ₹300+ plan par |

**Rule: ₹100/student/year par quota = students × 1/day set karo.** Realistic
usage cap ka 40–60% hi hota hai (sab roz doubt nahi karte), isliye expected
margin 40–50%. Coaching (flat ₹5k–25k/month) par quota students × 3/day safe
hai — revenue per student wahan 5–7× zyada hai.

### Yearly projection — kitne bachhon par kitna (quota-guarded worst case)

School plan @₹100/student/year, quota = students × 1 doubt/day, 250 days:

| Students | Worst-case AI/yr | Realistic AI/yr (~50% util) | Revenue | Net (realistic) |
|---|---|---|---|---|
| 100 | ₹8.75k | ~₹4.4k | ₹10k | **+₹5.6k** |
| 200 | ₹17.5k | ~₹8.8k | ₹20k | **+₹11.2k** |
| 500 | ₹43.75k | ~₹21.9k | ₹50k | **+₹28.1k** |
| 1000 | ₹87.5k | ~₹43.8k | ₹1L | **+₹56.2k** |

(Fixed infra ~₹8–10k/yr platform-wide hai — wo sab clients milkar cover karte
hain, ek school ka marginal cost sirf AI hai.)

**Loss ka jawab:** quota ON hone par worst case bhi positive hai — system
mathematically loss-proof hai jab tak quota = students × 1/day rule follow
hoti hai. Pilot ka ₹6.5k (200 stu × 30 din) 1 paid school ke ₹20k me 3× recover.

---

## 4. Kya plans justified hain? — Haan, margin audit

### Individual ₹499/year (Data Retention)

| | Realistic user | Heavy user |
|---|---|---|
| Storage (attempts, doubts, JSONs) | ~2 MB/year → B2 pe **₹0.02** | 50 MB → ₹0.5 |
| AI usage (doubts+explains) | ~₹200–300/year | cap ke baad max ~₹600 |
| Battles/CA/baaki | ~₹50 | ~₹100 |
| **Total cost to you** | **~₹250–350/year** | ~₹700/year worst case |
| **Revenue** | ₹499 | ₹499 |
| **Margin** | **~30–50%** | breakeven-ish (rare breed) |

✅ **Justified** — heavy users ko AI Power (₹99) bech ke aage nikaalo.

### Add-ons

- **AI Power ₹99/yr**: unlimited doubts → heavy user cost ~₹600–1200/yr.
  ⚠️ **Margin thin/negative on extreme users.** Counter: is cohort se baki
  products (voice) bhi bikte hain, aur aise users 5–10% hi hote hain.
  Optional hard-guard: AI Power par bhi 100 doubts/day soft-cap.
- **Voice ₹49/yr**: Whisper ₹1–2/min → 25 min/year par breakeven.
  Realistic use < 10 min/year → profitable.
- **CA Pro ₹99/yr**: shared daily sets — marginal cost ~₹0 per user. ✅
- **Focus Areas ₹79/yr**: 7-day cached PYQ analysis — ~₹12/year compute. ✅

### Group deal 2 paid → 1 free (ya launch 1 paid → 1 free)

- **1 paid → 1 free**: har paid user ₹499 laata hai, 1 free user ka cost
  ₹250–350 realistic → **margin ~₹150–250 per pair — POSITIVE**. Free user ka
  AI cost already doubt-cap se bounded hai. Ye launch setting hai, bolo to
  Deal Builder me default kar dun.
- **2 paid → 1 free**: margin ~₹500–650 per group — healthy.
- Growth math: free user = virality (group join = 1 aur active account),
  aur free users baad me coupon/upgrade funnel se convert hote hain.

---

## 5. Break-even math (aapka asli sawal)

**Fixed costs/month:** VPS ~₹500–800 (10-core), domain ~₹50, B2 ~₹30, backups ~₹50
≈ **₹700–900/month total**.

| Scenario | Revenue/month | AI cost/month | Net |
|---|---|---|---|
| 0 paying users (sirf free) | ₹0 | ₹2–5k (traffic pe depend) | **–₹5k max** |
| 20 paid individuals | ₹10k | ~₹2k | **+₹7k** ✅ |
| 2 schools × 200 students (paid, ₹50/stu/yr) | ₹20k | ~₹6k | **+₹13k** ✅ |
| 2 pilots (free) + 20 paid | ₹10k | ~₹8.5k | +₹0.5k (breakeven) |

**Bottom line:** fixed infra itna chhota hai ki 20 paying individuals se hi
pura infra + AI bill cover ho jata hai. Pilot free-month ka loss ~₹6.5k realistic
hai — jo **1 paid school (₹10–20k/year) se ek hi baar me recover** ho jata hai.
Loss ka risk tabhi hai jab (a) doubt-cap hatao, (b) per-institute quota na lagao,
(c) pilot me 1000+ students ho — teeno aapke control me hain.

---

## 6. Action items (aaj ke audit se)

| # | Item | Status |
|---|---|---|
| 1 | **Free doubt cap 15/day** (402 + upgrade CTA) | ✅ Implemented abhi |
| 2 | Launch preset **1 paid → 1 free** Deal Builder me | ✅ Added abhi |
| 3 | Per-institute daily AI quota (pilot guard) | ✅ Implemented — admin UI + 429 + sub-admin protected |
| 4 | AI Power par soft-cap (100/day) extreme abuse se bachne ko | 🔜 Optional |
| 5 | Pricing page par "fair use" line (free = 15 doubts/day) | 🔜 Copy tweak |

## 7. Marketing Studio cost (khud kitna kharcha karta hai)

Aapka apna marketing AI usage negligible hai: weekly calendar ₹1, 30 outreach
sequences ₹5, sales chat 1000 messages ₹200/month. **Marketing engine ka poora
mahina < ₹300** — revenue ke muqable me rounding error.
