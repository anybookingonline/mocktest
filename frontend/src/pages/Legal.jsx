import React from 'react'
import { Link } from 'react-router-dom'
import { BrandLogo, useBranding } from '../context/BrandingContext.jsx'

// ---------------------------------------------------------------------------
// Generic legal pages: Privacy Policy, Terms of Use, Refund/Cancellation
// Policy, Cookie Policy. Content is written to match what this app actually
// does (checked against the codebase — AI providers, payment gateways,
// storage, email, cookie/localStorage usage) rather than generic boilerplate.
// This is drafted content, not a substitute for a lawyer's review.
// ---------------------------------------------------------------------------

const ENTITY = 'Aisepadho'
const CONTACT_EMAIL = 'support@aisepadho.com'
const JURISDICTION = 'Indore, Madhya Pradesh, India'
const LAST_UPDATED = '24 September 2026'

const DOCS = {
  privacy: {
    title: 'Privacy Policy',
    sections: [
      ['1. Who we are', `${ENTITY} ("we", "us") operates an AI-powered mock test and practice platform for competitive exam aspirants, and a white-label version for schools and coaching institutes. This policy explains what personal data we collect, why, and what you can do about it.`],
      ['2. What we collect', `Account data: name, email, password (stored as a salted hash — we never see or store your plain-text password), target exam.
Usage data: tests attempted, answers, scores, doubts you ask, bookmarks, streaks, points and rankings.
Payment data: for paid plans/add-ons, our payment gateway partners (Razorpay, Stripe, PhonePe, or UPI) process your card/UPI details directly — we never see or store your full card number or UPI PIN. We keep only the transaction reference, amount and status.
Uploaded content: PDFs you or your institute upload for question extraction; a payment screenshot if you pay via QR/UPI and report it manually.
Optional: your phone/Telegram handle if you link the Telegram tutor bot; audio you record for voice doubts (sent to a speech-to-text provider, not stored by us after transcription).`],
      ['3. How we use it', `To run the product: generate/serve questions, grade tests, track your progress, personalize recommendations, and process payments.
To communicate: transactional emails (welcome, verification, password reset, payment receipts) and, if you opt in, a Telegram tutor bot.
To improve the product and prevent abuse (rate limiting, fraud checks).
We do not sell your personal data.`],
      ['4. Third parties we share data with', `To provide the service, some data is processed by these categories of providers, only as needed for their function:
• AI providers (e.g. DeepSeek, Google Gemini, OpenRouter, or another provider your school/admin may configure) — receive question/doubt text to generate answers, explanations and extracted questions from uploaded PDFs.
• Speech-to-text provider (OpenAI Whisper) — receives your audio only when you use voice doubts.
• Payment gateways (Razorpay, Stripe, PhonePe) — receive what's needed to process your payment; see their own privacy policies.
• File storage (Backblaze B2, when configured) — stores uploaded PDFs and payment-proof screenshots.
• Email delivery (Resend) — sends transactional emails on our behalf.
• Telegram — if you link the Telegram tutor bot, Telegram processes messages exchanged with the bot per its own policy.
• If contextual ads are enabled by the platform admin, an ad-matching provider receives your IP address, browser user-agent and a short snippet of your AI-tutor conversation (never your name or email) to select a relevant sponsored recommendation.
We do not control these providers' own retention or security practices beyond what our agreements with them require.`],
      ['5. Data retention', `Free accounts: test history, results, doubts and bookmarks are automatically deleted after 24 hours. AI usage has daily caps.
Paid accounts: this data is kept for the duration of your active plan (see your plan's retention period), after which the same 24-hour free-tier behaviour applies unless renewed.
Account and payment records are kept as long as needed for legal, accounting and dispute-resolution purposes even after a plan lapses.`],
      ['6. Cookies and local storage', `We primarily use your browser's local storage (not traditional cookies) to keep you signed in and remember preferences like language. See our Cookie Policy for details and how to manage this.`],
      ['7. Your rights', `You can access, correct or request deletion of your personal data, or ask what we hold about you, by writing to ${CONTACT_EMAIL}. We'll respond within a reasonable time and may need to verify your identity first. Deleting your account removes your personal data except what we're legally required to retain (e.g. payment/tax records).`],
      ['8. Children', `The platform is built for school and competitive-exam students, including those under 18. Where a student is a minor, we expect a parent/guardian or the enrolling school/institute to have consented to their use of the platform. We do not knowingly collect more data from minors than is needed to run the product.`],
      ['9. Security', `Passwords are hashed (never stored in plain text), traffic is encrypted in transit (HTTPS), and access to admin tools is role-gated. No system is 100% secure — if we become aware of a breach affecting your data, we'll notify affected users as required by law.`],
      ['10. Changes to this policy', `We may update this policy as the product changes. The "last updated" date below reflects the latest version; continued use after an update means you accept the revised policy.`],
      ['11. Grievance / contact', `For privacy questions, data requests, or grievances under applicable Indian IT rules, contact us at ${CONTACT_EMAIL}.`]
    ]
  },
  terms: {
    title: 'Terms of Use',
    sections: [
      ['1. Acceptance', `By creating an account or using ${ENTITY} ("the platform"), you agree to these Terms. If you're using it on behalf of a school or coaching institute, you confirm you're authorised to accept these Terms for that institute.`],
      ['2. The service', `${ENTITY} provides AI-generated and previous-year practice questions, mock tests, adaptive practice, doubt-solving, and related study/engagement features (battles, groups, revision, current affairs, a Telegram tutor), plus a white-label version for institutes. Features, pricing and free-tier limits may change; we'll try to give reasonable notice of material changes.`],
      ['3. Accounts', `You're responsible for keeping your login credentials confidential and for all activity under your account. One account per person. You must provide accurate information (name, email, target exam) when registering.`],
      ['4. Acceptable use', `Don't: share your account, scrape or bulk-extract content from the platform, attempt to bypass rate limits or paywalls, upload content you don't have the right to upload, use the platform to harass others (in Group Discussions, Battles, etc.), or attempt to disrupt the service (including its AI, payment or infrastructure). We may suspend or terminate accounts that violate this.`],
      ['5. AI-generated content', `Questions, explanations and answers may be generated or structured by AI. While we apply quality checks, AI can occasionally make mistakes (a wrong option, an imprecise explanation). This is practice material, not a guarantee of exam-identical content or accuracy — always cross-check against your own study material for anything you're unsure about.`],
      ['6. Payments and plans', `Paid plans and add-ons are one-time, non-auto-renewing purchases unless stated otherwise at checkout. See our Refund Policy for cancellation/refund terms. Prices are set by the platform admin and may change; a price change doesn't affect a plan you've already purchased.`],
      ['7. User content', `Content you submit (doubts, discussion messages, uploaded PDFs) remains yours, but you grant us a licence to store, process and display it as needed to run the service (e.g. showing your discussion messages to group members, or extracting questions from a PDF you upload). Don't upload content you don't have rights to.`],
      ['8. Intellectual property', `The platform's software, design, and AI-generated question sets belong to ${ENTITY} or our licensors. Previous-year questions sourced from public exam papers remain subject to their original source's rights where applicable; we compile and structure them for study purposes.`],
      ['9. Disclaimers', `The platform is provided "as is". We don't guarantee it will be uninterrupted, error-free, or that it will improve your exam result — outcomes depend on your own effort. To the extent permitted by law, we're not liable for indirect or consequential loss arising from your use of the platform.`],
      ['10. Termination', `You can stop using the platform and delete your account anytime from Settings, or by asking ${CONTACT_EMAIL}. We may suspend or terminate accounts that breach these Terms.`],
      ['11. Governing law', `These Terms are governed by the laws of India. Courts in ${JURISDICTION} have exclusive jurisdiction over any dispute.`],
      ['12. Changes', `We may update these Terms as the product evolves; the "last updated" date reflects the latest version. Continuing to use the platform after an update means you accept the revised Terms.`],
      ['13. Contact', `Questions about these Terms: ${CONTACT_EMAIL}.`]
    ]
  },
  refund: {
    title: 'Refund & Cancellation Policy',
    sections: [
      ['1. One-time payments, no auto-renewal', `All plans and add-ons on ${ENTITY} are one-time purchases — we do not auto-renew or auto-charge you. You choose when to renew or extend.`],
      ['2. Base plan — refundable within 15 days', `If you paid the full listed price for the base plan (Data Retention / Group Plan) — i.e. you did NOT use a coupon or promotional code — you can request a refund within 15 days of the payment date. After 15 days, the payment becomes non-refundable.`],
      ['3. Coupon / promo-code access — non-refundable', `Access obtained via a coupon or promotional code is granted for free — no payment is taken for it, so there is nothing to refund. If you separately made a real payment (not via a coupon) for the same or a different plan, that payment follows Section 2 above.`],
      ['4. Add-ons — always non-refundable', `Add-on purchases (e.g. AI Power Pack, Voice Doubts, Current Affairs Pro, Focus Areas, or any other add-on) are non-refundable under any condition, including within the 15-day window that applies to the base plan. This applies regardless of usage, satisfaction, or any other reason.`],
      ['5. How to request a refund', `If you're eligible under Section 2, go to Plans & Add-ons → Payment history in your account and click "Request refund" next to the payment, or email ${CONTACT_EMAIL} with your registered email and payment reference. We aim to respond within 7 business days.`],
      ['6. How refunds are paid', `Approved refunds are issued to the original payment method (card/UPI/bank account used) via the payment gateway, and may take 5–10 business days to reflect depending on your bank/gateway. For manual UPI/QR payments, we'll coordinate the refund method directly with you.`],
      ['7. What happens to your access after a refund', `Once a refund is processed, the entitlement purchased with that payment (e.g. extended data retention) may be revoked. We'll let you know if that applies to your case.`],
      ['8. Duplicate or failed payments', `If you were charged more than once for the same purchase, or charged but the plan wasn't activated, contact ${CONTACT_EMAIL} — this is fixed outside the above windows since it's our error, not a change-of-mind refund.`]
    ]
  },
  cookies: {
    title: 'Cookie Policy',
    sections: [
      ['1. What we actually use', `Today, ${ENTITY} primarily uses your browser's local storage (not traditional cookies) to keep you signed in and remember preferences like your chosen language. This is "strictly necessary" for the app to work — without it, you'd be logged out on every page reload.`],
      ['2. If cookies or similar tracking are added', `If the platform admin enables features that use cookies or similar tracking technology (for example, third-party analytics, or contextual ads shown alongside the AI tutor), we'll treat those as "non-essential" and only enable them after you've given consent via the cookie banner shown on your first visit.`],
      ['3. Your choice, saved', `When you respond to the cookie banner ("Accept all" or "Essential only"), we save that choice in your browser's local storage so we don't ask again on every visit. You can change your choice anytime — see the "Manage cookie preferences" link in the site footer, or clear your browser's site data to reset it and see the banner again.`],
      ['4. Third-party cookies', `Payment gateways (Razorpay/Stripe/PhonePe) may set their own cookies during checkout, governed by their own cookie policies — we don't control these.`],
      ['5. Questions', `Email ${CONTACT_EMAIL} with any questions about this policy.`]
    ]
  }
}

export default function Legal({ doc }) {
  const brand = useBranding()
  const d = DOCS[doc]
  if (!d) return null

  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="topbar">
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit' }}>
          <BrandLogo />
        </Link>
        <div className="spacer" />
        <Link to="/" className="btn btn-ghost btn-sm">← Home</Link>
      </header>

      <div className="content" style={{ maxWidth: 760, padding: '28px 16px 60px' }}>
        <h1 style={{ marginBottom: 4 }}>{d.title}</h1>
        <p className="tiny muted mb">{brand.platformName || ENTITY} · Last updated {LAST_UPDATED}</p>

        {d.sections.map(([heading, body]) => (
          <div key={heading} className="card mb" style={{ textAlign: 'left' }}>
            <b className="small" style={{ display: 'block', marginBottom: 8 }}>{heading}</b>
            <p className="small muted" style={{ whiteSpace: 'pre-line', lineHeight: 1.7 }}>{body}</p>
          </div>
        ))}

        <p className="tiny muted mt" style={{ textAlign: 'center' }}>
          <Link to="/privacy-policy">Privacy Policy</Link> · <Link to="/terms-of-use">Terms of Use</Link> · <Link to="/refund-policy">Refund Policy</Link> · <Link to="/cookie-policy">Cookie Policy</Link>
        </p>
      </div>
    </div>
  )
}
