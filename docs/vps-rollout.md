# 🚀 VPS Rollout Playbook — Coolify Hosting + Coupon Campaign

> Ye doc aapke (platform admin ke) liye hai — Supabase se apne VPS (10-core/24GB,
> Coolify installed) par move karna, aur social-media coupon rollout chalana.

---

## 1. Hosting — kya host karna hai

**Single-service architecture** (backend khud built frontend serve karta hai):

```
┌─────────────── VPS (Coolify) ───────────────┐
│  1. Postgres container (internal network)   │
│  2. App container:                          │
│     build:  npm install (root)              │
│             + cd frontend && npx vite build │
│     start:  node backend/src/index.js       │
│  (Files B2 par hain — VPS independent)      │
└──────────────────────────────────────────────┘
```

10-core/24GB ek Node service + Postgres ke liye kaafi zyada hai — hazaaron
concurrent users aaram se. Rate limiter Redis ke bina in-process fallback
chalta hai; single instance me Redis ki zaroorat nahi.

### Resource sizing — kitne core / kitna RAM kab

App runtime = 1 Node process + Postgres. Bhari kaam (AI extraction, structuring)
external APIs par hota hai — VPS par sirf CRUD + proxy chalta hai, isliye chhota
container bhi kaafi hai. Jab tak app EK instance hai, Redis kahin nahi chahiye.

| Stage | Users (approx) | App container | Postgres container | Redis |
|---|---|---|---|---|
| **Launch (abhi)** | 0–500 (50–100 concurrent) | 1 core, 1 GB (limit 1.5 GB) | 1 core, 1 GB (shared_buffers 256 MB) | ❌ nahi |
| **Growth** | 500–5,000 (500–1,000 concurrent) | 2 cores, 2 GB | 2 cores, 4 GB (shared_buffers 1 GB) | ❌ nahi |
| **Scale** | 5,000–20,000+ (1,000+ concurrent) | 2–4 cores, 4 GB | 4 cores, 8 GB + tuning | tab bhi sirf multi-instance par |

**Upgrade ke real signals (Coolify stats / hTop):**
- Node RAM limit ke 70%+ par consistent → RAM badhao (memory limit peak me
  hit hoke OOM-kill hone se pehle)
- Peak hours me CPU sustained 60–70%+ → +1 core
- Postgres me slow queries / connection waits → RAM + `max_connections` review

**Redis ka sach (dhyan se):** `utils/redis.js` **Upstash REST client** hai —
local Redis container se connect nahi hota (wo `ioredis`/`redis` client maangta
hai). Matlab:
1. Abhi Redis container banane se is app ko koi fayda nahi — wo use karegi hi
   nahi, in-process cache/rate-limit hi chalega (single instance ke liye sahi).
2. Baaki apps ko Redis chahiye to unka apna Redis container banao — is app se
   koi relation nahi, resources share honge bas.
3. Jab kabhi app **2+ instances** me chalega (shared rate-limit/cache ke liye)
   tab `utils/redis.js` me `ioredis` + `REDIS_URL` support add karna hoga
   (interface same rehta hai, ~1 ghanta ka kaam) — aur tab Coolify me ek Redis
   container is app ke saath dena. Aaj karne ki zaroorat nahi.

**Note:** Coolify deploy ke waqt `npm install` + `vite build` isi VPS par
chalta hai — 1–2 min ke liye CPU spike aayega. Ye transient hai; app container
me 1+ core rehne se deploy dheema nahi hoga.

### Coolify setup steps

1. **Postgres resource** banao (Coolify → New Resource → PostgreSQL).
   Internal connection string copy karo — ye `DATABASE_URL` banega.
2. **App resource** banao (repo se). Build/Start commands:
   - Build: `npm install && npm run build` *(root package.json me `build` script:
     `cd frontend && npx vite build` — pehle se hai)*
   - Start: `node backend/src/index.js`
   - Port: `3001` (backend ka default; Coolify isko expose karega)
3. **Domain** attach karo — Coolify Let's Encrypt SSL khud laga dega.

### Env vars (Coolify app container me set karo)

| Var | Value |
|---|---|
| `DATABASE_URL` | Coolify Postgres ka internal URL |
| `JWT_SECRET` | Naya strong random secret |
| `ADMIN_PASSWORD` | Platform admin password |
| `CRON_SECRET` | Revision/cron ke liye random string |
| `FRONTEND_URL` | `https://<aapka-domain>` |
| `BACKEND_URL` | `https://<aapka-domain>` (single-origin) |
| `B2_KEY_ID` / `B2_APP_KEY` / `B2_BUCKET` / `B2_ENDPOINT` | Backblaze wahi jo abhi hain |
| `TELEGRAM_BOT_TOKEN` | (optional — Admin → AI Config se bhi set hota hai) |

**Note:** AI keys (DeepSeek/Gemini), Razorpay, Gravity — ye sab DB me `ai_configs`
table me jaate hain, env ki zaroorat nahi. Step 3 me migrate hongi.

---

## 2. Supabase → VPS Postgres migration

**Aapke case me migration trivial hai — koi user nahi.** Data carry karne ki
zaroorat nahi; fresh start better hai:

1. **Naya DB khali chhodo** — app pehli baar start hone par `initSchema` +
   seed (8 exams + syllabus skeleton) apne aap chala denge.
2. **Sirf `ai_configs` table carry karo** (AI keys, Telegram token, branding,
   feature toggles, pricing, deal builder settings):

   ```bash
   # Supabase se export (apne machine par):
   pg_dump "<SUPABASE_URL>" --table=ai_configs --data-only \
     --column-inserts > ai_configs.sql

   # Naye VPS Postgres me import:
   psql "<COOLIFY_DB_URL>" < ai_configs.sql
   ```

   *(Ya sabse simple: Admin → AI Config me keys dobara paste karo — 10 min, ek baar.)*
3. **Vercel/Render retire** karo — naya single origin hi sab kuch hai.

### Post-deploy 5-minute checklist

- [ ] `GET /api/health` → `{"ok":true, "storage":"b2", ...}`
- [ ] Admin login → AI Config → **Telegram "Wire webhook"** dobara dabao
      (Telegram ka webhook URL naye domain par point hona chahiye)
- [ ] Domain DNS VPS par point + SSL active
- [ ] Ek test student banao → guided tour khud khulega → ek practice test chalao
- [ ] Ek test coupon banao (2 uses) → Plans page par redeem karke verify karo
- [ ] Coolify me Postgres **scheduled backups ON** karo

---

## 3. 🎟️ Coupon rollout campaign (ab built hai)

**Kya bana:** Admin → **🎟️ Coupons (Rollout)** — codes banao, har code me
`source` tag (instagram/telegram/youtube/x/whatsapp) hota hai. Redemption par
student ko plan/add-on days milte hain (existing plan ke **upar extend**),
+10 recognition points, aur aapko source-wise stats milte hain.

### Campaign playbook

**Har platform ka alag code** — yahi attribution hai:

| Platform | Code example | Offer | Kahan post karo |
|---|---|---|---|
| Instagram | `INSTA7` | 7 din pro free | Bio link + reel caption + stories |
| Telegram | `TELEGRAM7` | 7 din pro free | Apne channel + dusre study groups |
| YouTube | `YT500` | 30 din (contest prize) | Video description + pinned comment |
| X/Twitter | `X2026` | 7 din pro free | Launch thread |
| WhatsApp | `WP7` | 7 din pro free | Status + broadcast lists |

**Rules of thumb:**
- **Trial codes (7 din)**: unlimited uses, per-user 1 — viral sharing ke liye
- **Contest prizes (30 din)**: max uses set karo (jitne winners) — abuse-proof
- **Add-on trials**: `AI Power 30 din` code AI ka taste dikhata hai → conversion
  strongest wahan se aata hai
- **Expiry hamesha set karo** (2–4 hafta) — urgency bhi, cleanup bhi

**Weekly ritual (Sunday, 5 min):** Admin → Coupons → source-wise table dekho.
Jo platform sabse zyada **unique users** la raha hai, agla content/budget wahi.

**Funnel check:** Coupons page redemptions vs admin Users count — redemption
bade par signup nahi, to landing page/message problem hai (coupon dikha par
value samajh nahi aayi).

---

## 4. Next round: "Apne Bachhe ko Pro Banao" (Class 7–12 + dropouts)

**Order ye rakho — pehle migrate, phir coupons, phir ye batch:**

1. **Content prep (~1 hafta ka effort):** Class 7–12 ke subject→chapter→topic
   trees (NCERT-aligned) + board PYQs PDF-import se. Engine (adaptive, battles,
   groups, points) content-agnostic hai — sirf syllabus tree + questions chahiye.
2. **Exam cards:** Admin → Exams me `CLASS7`…`CLASS12` codes ke exams banao —
   landing page par automatically naye cards dikhenge.
3. **Positioning:**
   - Parents: "Apne bachhe ko pro banao" — progress reports + group-deal
     ("2 bachhe paid = 1 dost free") school-friend circle me viral
   - Dropouts: "Gap year = pro year" — SSC/Banking track + skill framing
4. **School white-label cross-sell:** ye batch school pitch ka live proof banega
   ("dekhiye, Class 7–12 already live hai").

---

*Related docs: `docs/operations-guide.md` (roz ke operations),
`docs/school-pitch-kit.md` (B2B sales), `docs/launch-runbook.md` (client onboarding).*
