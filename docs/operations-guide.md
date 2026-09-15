# 📘 Aisepadho Operations Guide — Platform Kaise Chalao

> Ye doc **aap (owner/admin) ke liye operating manual** hai — Day-1 setup se lekar
> roz ke operations tak. Naya admin bhi isse padh ke 30 min me platform chala lega.
> In-app guided tour ke saath padho (sidebar ke "?" button se khulta hai).

---

## 1. Mental Model — pehle ye samjho (2 min)

Platform ke **4 layers** hain. Har problem inhi me se ek layer me hoti hai:

| Layer | Kahan | Kya control hota hai |
|---|---|---|
| **Content** | Exams, Syllabus, Question Bank, PDF Import | Kya padhaya jayega |
| **AI** | AI Config | Kaunsa AI, kya generate karega, kaunse features ON |
| **Money** | Payments, AI Config (add-on pricing), Group deal | Kya bechna hai, kitne me |
| **People** | Users, Institutes (B2B) | Kaun use kar raha hai, kiska data |

**Golden rule:** Kuch bhi bina redeploy change hota hai — sab Admin Panel se.
Koi feature student ko nahi dikh raha? Pehle **AI Config → feature toggles** check karo.

---

## 2. Day-1 Setup (naya deployment) — 30 min checklist

```
□ 1. AI Config → API keys daalo (DeepSeek primary, Gemini fallback+Vision)
□ 2. AI Config → "Test connection" → green ho jaye
□ 3. Exams → 8 seeded exams review karo (jo chahiye rakho)
□ 4. Syllabus → ek exam ka subject→chapter→topic tree complete karo
□ 5. PDF Import → 2-3 PYQ papers upload karke verify karo
□ 6. AI Config → feature toggles: jo launch me nahi chahiye wo OFF
□ 7. Settings → branding: name, tagline, logo, support email
□ 8. Payments → UPI-QR ya gateway configure
□ 9. Users → apna admin account verify, demo/test users delete
□ 10. Health check: /api/health → storage: b2, cache mode OK
```

**AI keys kahan se:** `platform.deepseek.com`, `aistudio.google.com` (Gemini — PDF
Vision ke liye REQUIRED), `openrouter.ai` (free models optional). Keys DB me save
hoti hain, repo me kabhi nahi.

---

## 3. Roz ke Operations (10 min/day)

### Subah ka check
1. **Dashboard** → yesterday's signups, attempts, revenue spike/dip?
2. **AI Config → provider status** → sab providers green? (red = students ke doubts ruk rahe)
3. **Payments** → pending QR/proof verifications clear karo (student wait kar raha hai)
4. **Users** → naye signups me suspicious emails? (spam accounts block)

### Hafte ka check (Sunday, 15 min)
- **🎟️ Coupons (Rollout)** → source-wise table dekho: kaunsa campaign (Instagram/Telegram/YouTube) sabse zyada unique users la raha hai — agla content/budget wahi. Expired codes cleanup. (`docs/vps-rollout.md` §3 me campaign playbook)
- **Analytics & Reports** → weekly activity, top exams, weak questions
- **Institutes** → B2B clients ke stats dekho, inactive institute ko call karo
- **AI cache** → hit-rate dekho (low hit-rate = cost badh raha hai)
- **Storage** → B2 files normal growth? (PDF archive)

---

## 4. Feature-by-Feature Operations

### 📄 Content (Exams / Syllabus / Questions / PDF Import)
- **Naya exam** = Exams me create + Syllabus tree + questions (AI ya PDF se)
- **PDF Import flow:** upload → background processing (Gemini Vision) → Question
  Bank me `source=pdf` — duplicate PDF hash se auto-block
- **Question quality check:** Question Bank me filter `source=ai` → sample 5
  questions padho. AI kabhi-kabhi galat answer deta hai — wahi edit/delete karo
- **Time:** ek exam ka full syllabus + 200 questions = ~2 ghante (PDF se)

### 🤖 AI Config (platform ka dimaag)
- **Provider chain:** DeepSeek → Custom → Gemini → OpenRouter. Primary down ho to
  automatic fallback. Ek provider kaafi nahi — kam se kam 2 keys rakho
- **Feature toggles yahin:** Groups, Battles, Voice, Telegram, Current Affairs,
  Focus Areas, Ads. ON karte hi student nav me dikhta hai; OFF = nav gayab + API 403
- **Add-on pricing yahin:** AI Power Pack / Voice / Current Affairs ka price +
  validity + ON/OFF. OFF wale Plans page par dikhte hi nahi
- **Free-seat deal builder:** "N paid → M free" group deal — presets se ya numbers
  se set karo. Har join/leave/payment par server khud recompute karta hai
- **Telegram wiring:** bot token daalo → webhook domain (apna domain) → "Wire
  webhook" click. Bot naam white-label hota hai (Settings ka naam use karta hai)

### 💳 Payments & Money
- **UPI-QR flow (zero fee):** student screenshot bhejta hai → Payments page par
  proof → aap verify karke **mark-paid** karo → plan instant activate
- **Gateway (Razorpay/Stripe/PhonePe):** keys Settings me daalo — verify auto ho
  jata hai, sirf disputes dekhne hote hain
- **Refund/issue:** user ko manually activate/deactivate Users page se kar sakte ho
- **Group deal revenue:** 2 paid members = 1 free seat — isliye group jodna CAC
  kam karta hai. Deal builder se tune karo

### 🏫 B2B (Institutes) — school/coaching onboard
**Full onboarding 10 min:**
1. Institutes → **+ New Institute** (type: school/coaching, 30-din trial auto)
2. Institute card → **+ Sub-admin** → owner ka email + 🎲 Generate password →
   credentials card copy → WhatsApp par owner ko bhejo
3. Owner ko bhejo: login URL + email + password + "login ke baad password change"
4. **Invite code** copy karke owner ko do — wo apne students ko share karega
   (`yoursite.com/register?sch=SCH-XXXX` link banake)
5. Ya **Bulk CSV**: owner apne dashboard se `name,email,password` lines bhej ke
   poora class create karwa lega

**Owner ko kya milta hai (aur kya NAHI):**
| Milta hai | Nahi milta |
|---|---|
| Apne students ki list + stats | Platform users dekhna |
| Apna branding (name/colors) | AI keys dekhna/badalna |
| Invite codes + CSV import | Exam/question bank edit |
| Weak-topic analytics | Payments/settings |

**Security (audit-verified):** sub-admin sab B2B routes par hard-scoped hai;
platform routes (users/AI keys/payments) par 403. Rival institute ka data
 kahin nahi dikhta.

### 👥 Students-side (jo aap manage nahi karte, par samajhna zaroori)
- **Adaptive:** difficulty performance se adjust; weak topics auto-target
- **Battles:** 1v1 ELO, free 3/day, paid unlimited
- **Groups:** join code se; 2 paid → 1 free chat seat (aapka deal)
- **Points/Levels:** har action par recognition — retention engine
- **Revision:** 1-3-7-14-30 din spaced cycle + Telegram reminders

---

## 5. Common Problems → 30-second Fixes

| Problem | Kahan dekho | Fix |
|---|---|---|
| "AI questions nahi ban rahe" | AI Config → provider status | Key expire/credit khatam — nayi key ya fallback ON |
| "Student ko feature nahi dikh raha" | AI Config → feature toggles | Toggle ON karo (nav turant aayega) |
| "Plans page khali hai" | AI Config → add-on pricing | Kam se kam 1 add-on ON + price set |
| "Payment verify nahi ho raha" | Payments page | Proof screenshot dekh ke mark-paid manually |
| "Telegram bot jawab nahi de raha" | AI Config → Telegram | "Wire webhook" dobara dabao (domain badla hoga?) |
| "Institute owner login nahi kar paya" | Institutes → sub-admin | Password reset: naya sub-admin banao ya Users me password change |
| "PDF process atak gaya" | PDF Import → status | Gemini Vision key check karo; file re-upload (dedup safe hai) |
| "Storage full / files gayab" | /api/health → storage | "b2" dikhna chahiye; env me B2_* keys check |
| "Rate limit 429 aa raha" | Env: RATE_* | Limits badhao ya Redis add karo (shared counting) |
| "Sab blank/white screen" | Deploy logs | Naya SW version push hua? 1 reload se theek (v4 SW self-heals) |

---

## 6. Escalation Ladder (jab kuch bhi samajh na aaye)

1. **In-app tour** (sidebar "?") — feature ka 30-sec overview
2. **Ye doc** — operations-level jawab
3. **docs/launch-runbook.md** — domain/Telegram/branding setup detail
4. **docs/credentials-guide.md** — kaunsi key kahan jaati hai
5. **docs/teacher-features.md** — teacher roadmap (Guru Studio)
6. **backend/scripts/smoke-*.mjs** — 143 automated checks; koi bug lage to
   `node scripts/smoke-auth.mjs` (etc.) chala ke dekho

---

## 7. Growth Playbook (operations se aage)

- **Har naye student ko:** pehla test karwao (tour khud guide karta hai) —
  Day-1 activation sabse bada retention factor
- **Telegram bot push karo:** linked users 3x zyada wapas aate hain (reminders)
- **Group deal school me:** teacher ko bolo ek group banake — 2 paid = 1 free
  psychology se poora batch convert hota hai
- **B2B pilot:** `/schools` page projector par dikha do — 30-din free pilot
  script `docs/school-pitch.md` me hai
- **Content moat:** jitne zyada PYQ PDFs upload, utna strong platform — AI cost
  bhi girta hai (cache hit)

---

*Last updated: in-app tour + ye guide sync me hain. Feature badle to dono update
karna (Tour.jsx steps + is doc ka section).*
