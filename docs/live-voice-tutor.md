# 🎙️ Live Voice Tutor — Architecture & Cost Estimate

> As of 2026-09-26. Numbers below are verified against Gemini's official
> pricing page (ai.google.dev/gemini-api/docs/pricing); avatar-video numbers
> are web-sourced (July 2026) and not yet re-verified against provider pages —
> re-check before committing budget to that part.

---

## 1. Recommendation: voice-only first, avatar video later

Build **Live Voice Tutor as voice-only** (no on-screen avatar) using Gemini's
native Live API. It reuses the existing Gemini-based stack, needs one new
backend relay route, and costs roughly 5–20x less per minute than adding a
talking avatar face. Ship this, measure real usage and willingness-to-pay,
then decide separately whether an avatar layer is worth its much higher cost.

This is **different from the existing Voice Doubts** feature (speech-to-text
input → text output, no audio talk-back). Live Voice Tutor is full-duplex:
the student speaks and the AI speaks back in real time — closer to a phone
call than a chat box.

---

## 2. Architecture

1. **Browser** — mic capture via the Web Audio API/MediaRecorder; streams
   audio to the backend over WebSocket (the Gemini API key must never reach
   the browser).
2. **Backend relay** (new route, e.g. `/api/live-tutor/ws`) — authenticates
   the student (existing JWT), opens a matching WebSocket to Gemini's Live
   API, and pipes audio both directions. This is a new, **stateful** route —
   the existing text/Whisper doubt-solving pipeline (`aiTasks.js`,
   `solveDoubtWithAI`) is request/response and can't be reused as-is.
3. **Gemini Live API** (`gemini-3.8-live`, per `Models.md`) — native
   audio-in, audio-out, no separate STT/TTS step.
4. **Backend relay → Browser** — streamed audio response, played back as it
   arrives (not waited-for-whole).
5. **Session bookkeeping** — start/end timestamps logged per session so the
   backend can enforce a fair-use minutes cap, same pattern as
   `doubtCapFor()` for text doubts.

**Concurrency note:** unlike stateless AI calls today, each active voice
session holds an open WebSocket to both the browser and Gemini for its
duration — plan server capacity per concurrent session, not per request.

---

## 3. Cost estimate

Gemini's official pricing (Standard, paid tier), `gemini-3.8-live` /
`-extended-thinking`:

| Direction | Price |
|---|---|
| Audio input | $0.005/min ($3.00 per million tokens) |
| Audio output | $0.018/min ($12.00 per million tokens) |
| **Combined (full-duplex)** | **$0.023/min ≈ ₹2/min at ₹88/$1** |

Worked examples (illustrative, at ~₹88/$1):

| Usage | Cost |
|---|---|
| 10 min in one session | $0.23 (~₹20) |
| 60 min/month, one active user | $1.38/month (~₹121/month) |
| 60 min/month × 500 active users | $690/month (~₹60,700/month) |

This is a real, usage-linked variable cost — **60x+ higher per minute than a
text AI doubt** (~₹0.35/doubt per the pricing audit). Per the no-"unlimited"
rule, Live Voice Tutor must ship as a **paid add-on with an explicit
fair-use minutes cap** (e.g. "up to 60 min/month"), not as an unlimited perk
bundled into any base plan.

---

## 4. Avatar video option — a separate, much costlier layer

If a talking-face avatar is added on top of voice (Live Voice Tutor → "AI
Avatar Video Tutor"), real-time avatar rendering adds its own per-minute
cost, roughly 5–20x the voice-only cost:

| Provider | Approx. cost | Notes |
|---|---|---|
| Simli (bring-your-own STT/LLM) | <$0.01/min | Cheapest, but Gemini Live cost still applies on top |
| HeyGen (BYO-stack tier) | ~$0.10/min | |
| HeyGen (full managed tier) | ~$0.20/min | |
| Tavus / Anam / D-ID Agents | ~$0.11–0.37/min | Full-stack conversational avatar platforms |

Combined with Gemini Live audio cost, a "BYO-stack" avatar (cheapest
realistic option) would run roughly **$0.03–0.04/min total** — still
meaningfully pricier than voice-only, and best treated as a distinct,
higher-tier add-on rather than baked into the same plan.

---

## 5. Phased rollout

1. **Phase 1 — Voice-only pilot.** Ship Live Voice Tutor as a standalone
   paid add-on with a fair-use minutes cap. Collect real usage-per-user and
   conversion data.
2. **Phase 2 — Decide on avatar.** Only if Phase 1 shows strong demand and
   users indicate willingness to pay more, evaluate adding an avatar layer
   (Simli BYO-stack first, given its lowest cost) as a separate,
   higher-priced add-on tier.
3. **Phase 3 — Optimize.** Once real per-user minute usage is known, revisit
   the minutes cap and price to protect margin (mirrors how `doubtCapFor()`
   and the AI Power Pack cap were tuned after launch).

---

## 6. Open questions and risks

- **Network reliability on mobile India context** — real-time audio over
  WebSocket needs a stable connection; test on throttled/flaky mobile
  networks before launch, not just office wifi.
- **Cost exposure vs. price** — at $0.023/min, a mispriced or uncapped
  add-on could lose money fast; the fair-use cap is not optional.
- **Gemini Live API maturity** — confirm current uptime/stability for
  `gemini-3.8-live` at expected concurrency before committing a paid
  feature to it.
- **Server capacity for concurrent sessions** — stateful WebSocket relays
  behave differently under load than today's stateless AI routes;
  load-test before rollout.
- **Avatar numbers are web-sourced, not yet verified against official
  provider pages** — re-confirm Simli/HeyGen/Tavus pricing directly from
  their own pages before any Phase 2 commitment.
