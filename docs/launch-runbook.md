# 🚀 Aisepadho Launch Runbook — Coaching/School Onboarding, Domain, Telegram & Branding

> Ye doc aapke (platform admin ke) liye hai — ek naya coaching/school client onboard karne se
> lekar apna domain aur Telegram bot setup karne tak, sab kuch step-by-step.

---

## 1. Naya coaching/school onboard karo (10 minute flow)

### Step 1 — Institute banao (aap karo, 1 min)
**Admin Panel → Institutes (B2B) → + New Institute**
- Type: `📚 Coaching` ya `🏫 School`
- Naam + contact email → **30-din trial** auto-activate

### Step 2 — Sub-admin (owner) banao — **password ka jawab**
Usi institute card par click karo → **+ Sub-admin**:
- Owner/principal ka email daalo
- Password field ke saath **🎲 Generate** button hai — strong password turant ban jata hai
- Create karte hi ek **credentials card** khulta hai (email + password + login URL) —
  usse copy karke **WhatsApp par owner ko bhej do**. Baad me ye card dobara nahi dikhega
  (system password ko plain me store nahi karta — sirf aapko dikhane ke liye ek hi baar).

**Owner ko ye message bhejo:**
```
Aapka admin panel ready hai 🎉
🌐 Login: <apni-website>/login
📧 Email: owner@scoaching.com
🔑 Password: Shikhar@4821
Login ke baad password change kar lena (Profile page se).
```

Owner login karta hai → **/admin/institute** par sirf uska dashboard dikhta hai
(uske students, uske stats, uska branding).

### Step 3 — Students ko accounts do (2 tarika)
1. **Invite link (self-serve):** aapke Institutes page par har institute ka onboarding
   section ek **copyable registration link** deta hai:
   `https://<aapka-domain>/register?sch=SCH-XXXX` — WhatsApp par share karo. Students
   code daal ke register karte hain, **automatically us institute me add** ho jate hain.
2. **Bulk CSV:** owner apne dashboard se **CSV import** karta hai —
   ek line per student: `name,email,password`. CSV ke students ko bhi Telegram welcome
   message jata hai (agar bot linked hai).

### Step 4 — Telegram (optional)
Students apne **Doubts page** se bot ko `/start CODE` bhej ke link karte hain. Uske baad:
- doubts Telegram par
- revision reminders
- welcome messages (register/CSV/sub-admin par)

---

## 2. Teachers & Parents ko kya milta hai (aur kaise)

### Teachers (abhi ka scope — simple)
Abhi platform me teacher role alag se nahi hai — **sub-admin (owner) hi teacher ke roop me
kaam karta hai**. Owner ko milta hai:
- 📉 **Weak-topic alerts** — kaunsa topic batch me sabse kamzor hai (dashboard par live)
- 👥 **Students table** — tests, avg score, accuracy per student
- 📄 **CSV export-ready data** — jo teacher Excel me le ja sakta hai

**Phase-2 plan (paid addon ban sakta hai):** `teacher` role — sirf apne batch ke students
+ assignment dene ka feature + parent report trigger.

### Parents (report-first approach)
- Har student ka **Results/Analytics page** print-friendly hai — WhatsApp PDF bhejne ke
  liye. Owner ke dashboard se per-student progress dekha ja sakta hai.
- **Telegram parent channel (phase-2):** parent apna number de, weekly progress message
  auto-jaye. (Ye B2B me school ko sell karna easy hai — "parents ko har hafte report".)
- Pitch me isko aise bolo: *"Har parent ko WhatsApp-style progress report"*
  (detail: `docs/school-pitch.md` Section 3B).

---

## 3. Domain setup — "domain le liya hai, ab kya?"

Aapka frontend Vercel par hai, backend Render (`mocktest-547t.onrender.com`) par. Domain
(`aisepadho.com`) ko frontend par point karna hai:

### Vercel me custom domain
1. Vercel Dashboard → apna project → **Settings → Domains**
2. `aisepadho.com` add karo (aur `www.aisepadho.com`)
3. Registrar (GoDaddy/Namecheap etc.) me **A record** `@ → 76.76.21.21` aur
   **CNAME** `www → cname.vercel-dns.com` set karo
4. SSL auto-issue hota hai (kuch minute)

### Backend ko domain se jodna (zaroori — Telegram + payments ke liye)
Ye **environment variables** Render (backend) me set karo:
| Variable | Value |
|---|---|
| `FRONTEND_URL` | `https://aisepadho.com` |
| `BACKEND_URL` | `https://mocktest-547t.onrender.com` (ya backend ka final URL) |

> **Vercel proxy note:** `frontend/vercel.json` me `/api/*` → Render rewrite already
> configured hai. Matlab **aisepadho.com/api/... khud backend tak pahunch jata hai** —
> isi wajah se Telegram webhook ko aapke domain se hi wire kar sakte ho (next section).

---

## 4. Telegram bot — webhook Vercel domain se bana hai, kaise theek karein

Problem samajh lo: Telegram **ek hi webhook URL** rakhta hai per bot. Bot banate waqt jo
URL gaya (Vercel wala), wahi kaam kar raha hai — isliye "kaise aur kaha se set karenge" ka
jawab: **ab admin panel se, bina redeploy.**

### Admin panel me (2 min)
**Admin → AI Config → Telegram bot wiring:**
1. **Webhook domain** field me apna final domain daalo: `https://aisepadho.com`
   (https:// ke saath, bina trailing slash)
2. **Save configuration** dabao
3. **🔗 Wire webhook automatically** dabao
   → backend `https://aisepadho.com/api/telegram/webhook` ko Telegram ko `setWebhook`
   bhej dega. Vercel rewrite ki wajah se ye request backend tak pahunchti hai.
4. **/admin/test** (ya bot ko `hi` bhejo) — jawab aaye to done ✅

**Priority order (backend me):** `telegram.webhookDomain` setting → `BACKEND_URL` env →
request ka apna host. Agar webhook domain kisi din badle to sirf field update karo.

### Bot ka naam bhi white-label ho gaya
Bot ke messages me hardcoded "ExamAI" nahi rahega — jo naam Admin → Settings me hoga
(abhi ke liye Aisepadho) wahi bot bolega. Bot username sirf @BotFather se change hota hai
(wo Telegram-side hai, humara control nahi).

---

## 5. Branding — "ExamAI sab jagah likha hai, kaise Aisepadho karun?"

**Answer: Admin Panel → Settings → "Platform branding" card.** Ye fields hain:
| Field | Kya karta hai |
|---|---|
| **App / platform name** | Sidebar logo text, Landing page, tab title, Telegram bot, CSV welcome messages |
| **Tagline** | Landing hero sub-text ("Padho. Test do. Aage badho." — jo aap chahe daalo) |
| **Logo URL** | Sidebar + browser favicon (png/svg ka public URL) |
| **Apna domain** | Aapka official URL (pages/footer me dikhta hai) |
| **Support email** | Footer + parent-report contact |

Save karte hi **live rebrand** hota hai — koi redeploy nahi:
- browser tab title + favicon
- sidebar logo + landing page + login/register pages
- Telegram bot ke messages
- white-label institutes ko bhi platform branding fallback milti hai

**Note:** Landing page ka default title ab "Aisepadho — Padho. Test do. Aage badho." hai
(branded copy DB se aati hai). Aap Settings me kuch bhi change kar sakte ho — "Aisepadho
— AI-Powered Test Practice", "Aisepadho — Selection ki tayari", jo bhi tagline chahiye.

---

## 6. Checklist (launch se pehle)

- [ ] `ADMIN_PASSWORD`, `JWT_SECRET`, `CRON_SECRET` env vars set hain
- [ ] Postgres/Upstash creds rotate ho chuki hain
- [ ] AI keys (DeepSeek/Gemini) Admin → AI Config me configured + "Test connection" green
- [ ] B2 credentials set (PDF/proof storage durable ke liye)
- [ ] Domain Vercel me add + DNS records + SSL green
- [ ] `FRONTEND_URL`/`BACKEND_URL` Render me updated (payments redirect sahi chale)
- [ ] Telegram: botToken + webhook domain field bharke auto-wire dabaya, test message aaya
- [ ] Admin → Settings me branding (Aisepadho + tagline + logo) save kiya
- [ ] Ek test institute banao → sub-admin credentials card se WhatsApp flow test karo
- [ ] Invite link share karke ek test student register karo — institute me dikhe
- [ ] Ek test student ko Telegram link karke welcome message verify karo

---

## 7. Kya-kya ho gaya (recap for owner)

| Area | Status |
|---|---|
| Coaching/School onboarding (institute + sub-admin + invite/CSV) | ✅ Live |
| Sub-admin password: generate + one-time credentials card | ✅ Live |
| Student accounts: invite link / CSV / self-register | ✅ Live |
| Telegram: white-label bot + webhook domain field + auto-wire button | ✅ Live |
| Branding: name/tagline/logo/domain/support email — admin-controlled, no redeploy | ✅ Live |
| Teachers: abhi owner=teacher dashboard (weak topics, student table) | ✅ Live |
| Parents: printable progress + phase-2 Telegram weekly report plan | 📋 Planned |
| Teacher role + parent reports automation | 📋 Phase-2 (paid addon ban sakta hai) |

**Ek line me:** students Telegram+app se padhenge, owner dashboard se manage karega,
aap admin panel se sab control karte ho — aur poora product **Aisepadho** naam se,
**aapke domain** se, **aapke Telegram bot** ke saath chalega. 🚀
