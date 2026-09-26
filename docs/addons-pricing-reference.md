# 💰 Aisepadho — Add-ons & Pricing Reference

> As of 2026-09-26. Pulled directly from `backend/src/utils/addons.js` and
> `backend/src/utils/groups.js` — prices/limits are admin-editable in
> Admin → Add-ons and Admin settings, so re-check live values before quoting
> them externally.

---

## 1. Base plan — 1-Year Data Retention

Minimal on purpose: retention + a rate-limit bump only. Everything else is a
paid add-on (monthly or yearly), so it stays non-refundable per the Refund
Policy instead of falling inside the base plan's 15-day refund window.

| | |
|---|---|
| Price | **₹999/year** (code default is ₹499 — confirm `monetization.price` is set to 999 in Admin) |
| Includes | Test history & results, Doubts & AI explanations, Bookmarks & analytics |
| Doubt cap | 50 AI doubts/day (vs. 15/day free) |

---

## 2. Free for everyone (kept free deliberately, not paywalled)

| Feature | Why it stays free |
|---|---|
| 🥊 Quiz Battles | Zero/near-zero marginal cost (shared question bank) — competitive, so it stays a free hook rather than a paywall |
| 👥 Group Study — buy-1-get-N-free mechanic | No cost to the platform to host a group; the referral mechanic (see §4) brings in new signups, so it's a growth lever, not a cost center |
| Practice tests, CA daily quiz (shared set) | Shared bank / shared daily set — near-zero marginal cost per extra user |

---

## 3. Paid add-ons (monthly / yearly)

| Add-on | Description | Monthly | Yearly |
|---|---|---|---|
| ⚡ AI Power Pack | Up to 50 AI doubts/day (fair-use) + unlimited AI mock generation + priority AI queue | ₹29 | ₹199 |
| 💎 AI Max | Everything in AI Power Pack **+** Voice Doubts + Smart Revision Pack + Analytics Pro, bundled | ₹49 | ₹399 |
| 🎙️ Voice Doubts | Speak your doubt — Hindi/English/Hinglish speech-to-text (fair-use daily limit) | ₹15 | ₹49 |
| 📰 Current Affairs Pro | Daily AI-generated CA quiz (10 Qs), exam-specific, monthly revision compilations | ₹19 | ₹99 |
| 🔥 AI Focus Areas | PYQ frequency ranking by topic, priority revision order, auto-refreshed weekly | ₹15 | ₹79 |
| 🔁 Smart Revision Pack | AI spaced-revision mocks, AI flashcards, AI topic summaries | ₹19 | ₹149 |
| 📊 Analytics Pro | Weak-area heatmap, percentile rank estimate + trend, shareable parent report link | ₹19 | ₹149 |

All add-on purchases are **non-refundable in every condition** (per Refund
Policy) — the 15-day refund window applies only to the base retention plan
paid in full, and never to a coupon-assisted purchase.

**AI Max bundling logic:** buying AI Max auto-grants `voiceDoubts`,
`smartRevision`, and `analyticsPro` entitlements alongside `aiPower` — it's
priced at a discount to the sum of the 4 individual yearly prices (₹399 vs.
₹199+₹49+₹149+₹149 = ₹546 if bought separately), positioned as the
"complete AI teacher" tier.

---

## 4. Group Study — the buy-1-get-N-free mechanic

Admin-configurable deal, currently: **2 paying members unlock 1 free seat**
(capped at 3 free seats per group) — `groups.freeAfterPaid` /
`groups.freeSlots` / `groups.maxFree` in Admin settings. Presets available
for other ratios (1 paid → 1/2/3/4/5 free friends) without a redeploy.

- Free-seat members get `group_discussions` chat access auto-granted while
  the group's paid ratio holds.
- **Group Analytics** is a locked teaser for free-seat members — visible so
  they know it exists, but only unlocked for paying/seat-holding members.
- This is intentionally NOT paywalled the same way other features are: it's
  a referral/viral growth lever (new signups from the free friends) as much
  as a revenue feature.

---

## 5. Refund policy summary

| Scenario | Refund |
|---|---|
| Base plan (₹999/year), paid in full | 15-day refund window |
| Base plan, paid using a coupon | Non-refundable |
| Any add-on (monthly or yearly), any payment method | Non-refundable |
