# Relief Message Checker

> **A multi-role public-interest verification platform that helps flood- and relief-affected families, community helpers, and department officers check suspicious SMS/WhatsApp relief notices safely — without ever asking for OTPs, CNICs, or PINs.**

---

## Prototype & Safety Notice

**PROTOTYPE — Not an official government, BISP, or payment service.**
This application is a hackathon prototype built for **Coder's Cup '26 — The Last Mile: AI on Public Rails (FAST-NUCES Karachi)**. It does not connect to live government databases, NADRA, 8171 SMS gateways, or bank APIs. All sender registries, identity lookups, and payment reference checks use transparent mock Digital Public Infrastructure (DPI) services.

---

## Real vs. Mocked Capabilities

| Component | Status | Implementation Details |
| --- | --- | --- |
| **Multi-Role Auth & Server-Side RBAC** | **Real** | Express API with HMAC-SHA256 signed Bearer tokens held in JS memory (`Authorization: Bearer`), bcrypt-equivalent scrypt password hashing, and server-side role guards across 5 roles (`citizen`, `helper`, `officer`, `admin`, `auditor`). |
| **Asymmetric Safety Routing & Hybrid AI** | **Real** | Deterministic versioned rules engine + optional server-side `@google/genai` structured JSON analysis with asymmetric cost routing (missed scam weighted **10×** heavier than false alarm; refuses to mark official without a verified registry hit). |
| **PII Redaction & Anti-Phishing Guardrails** | **Real** | Automatic pre-storage redaction of accidental CNIC, OTP, PIN, and IBAN strings (`[REDACTED-CNIC]`, `[REDACTED-OTP]`, `[REDACTED-IBAN]`) plus server-side `400` blocking if an officer attempts to ask for sensitive proof. |
| **Phonetic Transliteration Matching** | **Real** | South Asian transliteration normalizer (`Muhammad / Mohammad / Muhammed`, `Tariq / Tareq / Tarik`) suggesting candidate household matches without ever auto-merging records. |
| **Shared-Phone Privacy & Offline-First Queue** | **Real** | Per-family isolated `sessionStorage` drafts (`draft:{helper_id}:{family_id}`) auto-wiped on submit/switch, plus an Offline Simulator and idempotent `client_request_id` sync queue on `POST /api/cases`. |
| **Consent Governance & Append-Only Audit** | **Real** | View, correct, and withdraw consent (`case_review`, `mock_identity`, `mock_payment`) enforced server-side with `HTTP 403` and logged to an append-only audit trail (`read`, `write`, `decision`, `security`) + per-case JSON `AuditorTrace`. |
| **Cloud Persistence (Firebase Firestore)** | **Real** | Provisioned Firebase Auth (Google Sign-In) + Cloud Firestore database with strict Eight-Pillar `firestore.rules` (default-deny, verified-user checks, owner isolation, immutable fields, terminal `closed` lock) mirroring PII-redacted case and consent snapshots. |
| **Public Partner API & OpenAPI Docs** | **Real** | Rate-limited `POST /v1/check` authenticated via `X-API-Key` (SHA-256 hashed), plus OpenAPI 3.0 spec at `GET /openapi.json` and interactive docs at `GET /docs`. |
| **Voice Input & Read-Aloud (EN/UR)** | **Real (Browser API)** | Web Speech API dictation (`en-US` / `ur-PK`) and `speechSynthesis` audio playback of plain-language English & Urdu explanations. |
| **8171 / Relief Sender Registry, Identity & Payment Rails** | **Mocked DPI** | Deterministic mock endpoints (`/api/mock/registry`, `/api/mock/sender/:id`, `/api/mock/identity/:ref`, `/api/mock/payment/:ref`) simulating public rails without touching real citizen data. |

---

## User Roles & Demo Credentials

All 5 roles are accessible via the **One-Click Role Switcher** or manual login (password for all demo accounts: `demo1234`):

| Role | Name | Email | Key Capabilities |
| --- | --- | --- | --- |
| **Community Helper** | Sanaullah Khan | `helper@relief.demo` | Manage up to 40 families, phonetic candidate matching, isolated shared-phone drafts, offline queue sync, consent & data correction |
| **Citizen** | Muhammad Tariq | `citizen@relief.demo` | Check personal messages, speak/listen in English & Urdu, escalate or close own cases, withdraw consent |
| **Department Officer** | Farhana Malik | `officer@relief.demo` | Priority review queue ("I am not sure" handoffs first), record verified decisions, close cases, safe non-sensitive info requests (anti-phishing guarded) |
| **System Admin** | Kamran Qureshi | `admin@relief.demo` | Live versioned rule editor (zero redeploy), asymmetric threshold sliders, N=30 synthetic evaluation table, `/v1/check` & `/docs` |
| **Read-Only Auditor** | Dr. Naila Rasheed | `auditor@relief.demo` | Strictly read-only access (zero write endpoints) to append-only read/write/security audit logs and full JSON `AuditorTrace` inspection |

---

## Honest Prototype Evaluation (N=30 Synthetic Dataset)

We intentionally report **raw error counts** on our 30-message synthetic evaluation set (12 scams, 10 mock official notices, 8 ambiguous forwards) rather than inflated accuracy percentages:

- **Asymmetric Cost Policy**: `missed_scams × 10 + false_alarms × 1`
- **Default Thresholds (`v1`)**: `scam_auto_threshold = 0.80`, `official_match_threshold = 0.95` (+ mandatory Mock Registry match), `ask_info_threshold = 0.60`
- **Baseline Synthetic Results (verified via unit test & live `/api/stats`)**:
  - **Missed Scams (10× cost)**: `0`
  - **Scams Auto-Flagged**: `12 / 12`
  - **Mock Official Matches**: `10 / 10` (all include explicit spoofed-sender caveat)
  - **Human Handoffs (Ambiguous)**: Routed safely to `needs_non_sensitive_info` or `unverified_officer_review` ("I am not sure")

---

## API & Interactive Documentation

- **Interactive API Docs**: `GET /docs`
- **OpenAPI 3.0.3 JSON Spec**: `GET /openapi.json`
- **Public Partner Check Endpoint** (Demo API Key: `rmc_demo_public_key_2026`, rate limit: `20 req/min`):

```bash
curl -X POST http://localhost:3000/v1/check \
  -H "Content-Type: application/json" \
  -H "X-API-Key: rmc_demo_public_key_2026" \
  -d '{
    "sender_claimed": "0301-8842109",
    "message_text": "Urgent BISP grant approved! Pay Rs 500 fee via Easypaisa and reply with your OTP."
  }'
```

---

## Running Locally & Testing

```bash
# 1. Install dependencies
npm install

# 2. Run unit tests (PII redaction, anti-phishing guardrail, phonetic matcher,
#    asymmetric routing, consent enforcement, N=30 eval, offline idempotency, OpenAPI)
npx tsx --test server/services/pipeline.test.ts

# 3. Validate Firestore security rules
npx eslint firestore.rules

# 4. Start full-stack dev server (Express + Vite on port 3000)
npm run dev

# 5. Production build & run
npm run build
npm start
```

### Environment Variables
Copy `.env.example` to `.env` if deploying outside AI Studio:
- `GEMINI_API_KEY` (optional): Enables server-side deep language classification while keeping the deterministic hybrid rules & NLP engine active as a zero-failure fallback.
- `APP_URL`: Deployed origin URL.
- `PORT`: Server port (defaults to `3000`).
