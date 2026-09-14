# 🔑 Credentials Guide — Kis key kahan jaati hai (Env vs Admin Panel)

> Aapka sawal: "backblaze ke credentials de du, add karke check kar loge, aur mujhe
> kis-kis ke credentials dene hain bata do — jo admin me add karne ki fields nahi hain."
> Ye doc uska jawab hai. **Aap sirf ye 3 secrets env me denge:** `B2_*`, `JWT_SECRET`,
> `ADMIN_PASSWORD`. Baaki sab admin panel se hota hai.

---

## TL;DR — Env-only secrets (ye mujhe bhejo, admin panel me inka koi field NAHI hai)

| # | Variable | Kahan milega | Format |
|---|----------|--------------|--------|
| 1 | `B2_KEY_ID` | Backblaze → App Keys | `003xxxxxxxxxxxx0000000001` (24 chars) |
| 2 | `B2_APP_KEY` | Backblaze → App Keys | `K003xxxxxxxxxxxxxxxxxxxxxxx` (31 chars) |
| 3 | `B2_BUCKET_ID` | Backblaze → Buckets → Bucket Details | hex string, e.g. `a1b2c3d4e5f6…` |
| 4 | `JWT_SECRET` | khud generate karo | long random string |
| 5 | `ADMIN_PASSWORD` | khud choose karo | strong admin login password |

`B2_BUCKET_NAME` aur `B2_PUBLIC_BASE_URL` optional hain (bucket ka naam + custom CDN
domain). Ye main bucket details se khud derive kar lunga.

### Kaise bhejein (2 tarika)

- **Settings → Environment (ya Keys tab)** me paste karo — ye **Freebuff Cloud ka
  secure store** hai. Sirf in 5 keys ki values daalni hain.
- Ya chat me directly paste kar do (test ke liye theek hai) — main
  `freebuff-env` se merge kar dunga. Values print nahi hoti, sirf "set" hoti hain.

**JWT_SECRET ready-made (copy kar lo):**

```
x7Kp9mQ2vT8wZ4nR6jF3hL5cB1dG0sY9aE7uX4iN2oP6kM8tV1qW3rZ5yH0jC2b
```

(Chaho to apna longer bhi de sakte ho — bas production me kabhi repo me commit mat karna.)

### Milte hi main kya karunga (automated test)

Main ye steps chalaunga aur report dunga:
1. Keys ko sandbox env me merge karna (`freebuff-env set --file`)
2. `b2_authorize_account` call → auth token verify
3. `b2_get_upload_url` → bucket access verify
4. Ek chhoti test file `diagnostics/b2-selftest-<timestamp>.txt` upload karna
5. Us file ko wapas download karke byte-by-byte compare karna
6. Test file delete karna (bucket clean)
7. `GET /api/health` me `"storage": "b2"` confirm karna

Result ek table me: authorize ✅ / upload ✅ / download ✅ / delete ✅ — sab green
hote hi PDF/PYQ papers + payment proofs B2 par jaane lagenge.

---

## Jo ADMIN PANEL se hota hai (env ki zarurat nahi)

| Cheez | Kahan set karte ho | Note |
|---|---|---|
| AI keys — DeepSeek / Gemini / OpenRouter / Custom (Groq, Mistral…) | Admin → AI Config | DB me stored, masked display, empty-save par wipe nahi hoti |
| OpenAI key (Whisper — Voice Doubts ke liye) | Admin → AI Config | Voice addon ke saath |
| Telegram bot token + username + webhook domain | Admin → AI Config | Wire webhook button bhi wahi hai |
| Payment gateways — Razorpay / Stripe / PhonePe / UPI QR | Admin → Settings | Har gateway ke apne fields |
| Platform branding — naam, tagline, logo, domain, support email | Admin → Settings | Live rebrand |
| Add-on pricing + ON/OFF (AI Power, Voice, CA Pro, Focus) | Admin → AI Config | Plans page par live dikhta hai |
| Feature toggles (Groups, Battles, CA page, Focus page…) | Admin → AI Config | Student nav instantly update |
| Exa search + usage-limit keys (agar enable karna ho) | Admin → AI Config (Exa section) | Monthly quota set kar sakte ho |

In sabko maine isliye env se hata rakha hai — **bina redeploy rotate kar sakte ho.**

---

## Full env-variable reference (baaki sab OPTIONAL — defaults sahi hain)

| Variable | Kab chahiye | Default |
|---|---|---|
| `DATABASE_URL` | already set (Supabase pooler) | — |
| `PGSSL` / `PGPOOL_MAX` | rare tuning | auto |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | multi-instance deploy par | in-process cache fallback |
| `FRONTEND_URL` / `BACKEND_URL` | domain final hone par | request host |
| `RATE_MAX_REQ` etc. | rate-limit tuning | sane defaults |
| `CRON_SECRET` | revision/CA cron external trigger par | internal only |

---

## Quick status check (credentials set hone ke baad)

`GET /api/health` me `storage.mode` dikhta hai:
- `"local"` → B2 configured nahi (dev mode — files `backend/uploads/` me)
- `"b2"` → B2 live ✅

Admin → Settings me **Storage card** ab yahi dikhata hai + **🧪 Test B2 connection**
button — ek click me authorize/upload/download/delete ka live report.

---

*Ye doc bhejne ke baad main turant test chala kar result dunga — bucket me sirf
`diagnostics/` prefix ki ek chhoti test file jayegi jo test ke baad delete ho jati hai.*
