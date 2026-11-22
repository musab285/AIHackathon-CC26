# Relief Message Checker — AI Studio Implementation Specification

> **PROTOTYPE NOTICE:** This is a hackathon prototype, **not an official government or payment service**. All identity, payment, sender registry, and message data are 100% mocked/synthetic. Never use real personal data (CNICs, phone numbers, real OTPs).

## 1. Problem Statement & Core Scope
**One-Sentence Mission:**
> We help **shopkeepers, low-literacy citizens, and community helpers** verify whether a **"relief payment" message** matches an official notice or is a scam, even though **they face low literacy, weak/dropping connections, inconsistent name spellings, shared phones, and spoofed messages where a wrong guess can cost their savings**.

**Build Philosophy (3-Hour Sprint):**
Build **one complete, end-to-end vertical slice** (Citizen / Helper → AI Pipeline → Officer Review → Admin Rule Update → Auditor Trace → Consent Revocation) rather than half-finished extra pages.

---

## 2. Non-Negotiable Safety & Correctness Rules (MUST ENFORCE)

1. **Never Call a Message "Safe" From Score Alone:**
   * A forwarded message's sender name can be spoofed and does not prove authenticity.
   * **Allowed Verdicts ONLY:**
     * `suspicious` — High-confidence scam indicators (auto-warned).
     * `matches_mock_official_notice` — Allowed **ONLY** when confidence `>= official_match_threshold` **AND** the message/reference matches a verified entry in the **Mock Official Notice / Sender Registry** (always include a disclaimer that forwarded sender names can still be spoofed).
     * `needs_non_sensitive_info` — Mid-confidence; ask for safe, non-sensitive context only.
     * `unverified_officer_review` — Low confidence, conflicting signals, or no verified registry match. System explicitly says **"I am not sure"** and routes to a human Department Officer with structured case notes.
   * **Asymmetric Thresholds (Cost of Being Wrong):**
     * Assume a **missed scam costs 10x** more than a **false alarm (1x)**.
     * Default DB-driven thresholds:
       * `scam_auto_threshold = 0.80` → auto-route to `suspicious`
       * `official_match_threshold = 0.95` (+ verified mock registry match required) → `matches_mock_official_notice`
       * `ask_info_threshold = 0.60` → `needs_non_sensitive_info`
       * `< 0.60` (or high score without registry verification) → `unverified_officer_review`

2. **Never Ask for Sensitive "Proof" (Anti-Phishing Guardrail):**
   * Neither the AI, UI, nor Officer "Request More Info" flow may **ever** ask for an OTP, CNIC number, PIN, or bank password.
   * Display a persistent warning banner in the UI: *"Never share OTP, CNIC, or PIN. If uploading a screenshot, hide personal numbers."*
   * Run a lightweight regex guardrail on incoming text to detect and mask accidental CNIC patterns (`\d{5}-\d{7}-\d`) or 4–6 digit OTP codes before persistence, logging a `pii_redacted` event in the audit log.

3. **Bad Data & Name Variants (Candidate Suggestions Only — NEVER Auto-Merge):**
   * Keep `display_name` (original input) and `phonetic_key` (normalized variant key where `Muhammad / Mohammad / Muhammed` produce the same search key).
   * **NEVER** auto-merge two family records based on `phonetic_key` or fuzzy similarity.
   * If a possible match is detected, return a list of `candidate_matches` and require the Community Helper or Department Officer to explicitly confirm whether it is the same person or a new record.

4. **Shared-Phone Privacy (Helper Mode Draft Protection):**
   * Helpers manage up to ~40 families on one shared phone.
   * Do **not** store raw message text in a single shared `localStorage` key.
   * Store minimal offline drafts in `sessionStorage` (or encrypted/namespaced `localStorage` keyed by `draft:{helper_id}:{family_id}`), store only non-sensitive draft metadata/truncated snippet where possible, auto-clear immediately on submit or family switch, and provide an explicit **"Clear Local Drafts / Lock Phone"** button.

5. **Real Consent Control (View, Correct, Withdraw) + Read/Write Audit Trail:**
   * Users/Helpers can **view** who has access, **correct** shared profile/family fields (`PATCH`), and **withdraw** consent (`DELETE`).
   * Withdrawn consent must be enforced **server-side** (queries return `403 Forbidden` or redacted/empty records, and downstream mock API calls are blocked).
   * The append-only `audit_log` must record **both writes AND sensitive reads/actions** (login, case view, AI decision, mock service lookup, rule edit, consent check/denial/correction/withdrawal, officer review).

6. **Honest Metrics on Synthetic Data:**
   * Seed ~30 synthetic labeled messages (scams, official-notice matches, and ambiguous edge cases).
   * Display raw error counts (`false_alarms`, `missed_scams`, `human_handoffs`) in `/stats` and the README, explicitly labeled as **results on a small synthetic prototype dataset (N=30)** — no inflated accuracy claims.

---

## 3. Tech Stack & Deployment
* **Backend:** FastAPI, SQLAlchemy 2.0, Alembic migrations, Pydantic v2, `slowapi` (rate limiting), `pytest`.
* **Database:** PostgreSQL (Supabase or Render Postgres) — do not rely on ephemeral SQLite in production.
* **AI Layer:**
  1. **Classification & Confidence Routing:** Deterministic rules engine + lightweight classifier (`scikit-learn` TF-IDF/LogisticRegression OR single LLM call) returning a **Pydantic-validated `AIDecisionOutput` schema** (structured AI output).
  2. **Guardrails & Human Handoff:** Confidence gating + PII redaction + mandatory officer queue.
  3. **Dual Explainability:** Plain-language 1-line user reason (with icon + Urdu/English text) AND full JSON auditor trace (`input_hash`, `rule_version`, `model_version`, `matched_rules`, `confidence`, `registry_check`, `verdict`).
  4. **Voice & Low-Literacy Support:** Browser Web Speech API (`SpeechRecognition` for mic input + `speechSynthesis` for read-aloud in Urdu/English with graceful fallback) + large icon buttons.
* **Frontend:** Next.js (App Router) + Tailwind CSS.
* **Deployment:** Backend on Render/Railway, Frontend on Vercel, Postgres on Supabase/Render.

---

## 4. Repository Structure
```text
relief-checker/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app, CORS, slowapi, /docs
│   │   ├── core/
│   │   │   ├── config.py            # Env vars, DB URL, JWT secret
│   │   │   ├── security.py          # Password hashing, JWT, API key verification
│   │   │   ├── deps.py              # RBAC dependencies, consent guard, audit helper
│   │   │   └── rate_limit.py        # slowapi limiter
│   │   ├── models/                  # SQLAlchemy ORM models
│   │   ├── schemas/                 # Pydantic DTOs + AIDecisionOutput schema
│   │   ├── routers/
│   │   │   ├── auth.py              # Login, /me
│   │   │   ├── cases.py             # Submit, list, detail, escalate, close
│   │   │   ├── families.py          # Helper Mode: list, create, candidate match, correct data
│   │   │   ├── review.py            # Officer queue, decide, request non-sensitive info
│   │   │   ├── rules.py             # Versioned rules & asymmetric thresholds
│   │   │   ├── consent.py           # View, grant, correct, withdraw
│   │   │   ├── audit.py             # Read-only logs & per-case decision traces
│   │   │   ├── stats.py             # Synthetic dataset eval table, false alarms, handoff rate
│   │   │   ├── public_api.py        # POST /v1/check (X-API-Key + rate limited)
│   │   │   └── mock_services.py     # Mock sender/notice registry, identity, payment APIs
│   │   ├── services/
│   │   │   ├── pipeline.py          # Normalize -> PII guard -> Dedupe -> Rules -> AI -> Route
│   │   │   ├── rules_engine.py      # Evaluates active DB rule version (no redeploy needed)
│   │   │   ├── classifier.py        # AI classifier returning Pydantic AIDecisionOutput
│   │   │   ├── name_matcher.py      # Phonetic/transliteration candidate suggester (no auto-merge)
│   │   │   ├── explain.py           # User-friendly reason + full auditor JSON trace
│   │   │   ├── consent_service.py   # Server-side consent enforcement
│   │   │   └── audit_service.py     # Append-only audit writer (reads + writes)
│   │   └── db/
│   │       └── session.py
│   ├── alembic/                     # Database migrations
│   ├── seed/
│   │   └── seed_data.py             # 5 role demo users, families (name variants), ~30 labeled messages
│   └── tests/
│       └── test_core_flows.py       # Tests for RBAC, consent withdrawal, rule versioning, handoff
├── frontend/
│   └── app/
│       ├── layout.tsx               # Shared banner ("PROTOTYPE"), role nav, low-bandwidth styling
│       ├── login/page.tsx           # Demo role quick-login + JWT auth
│       ├── page.tsx                 # Check Message + Helper Mode (family selector, voice, draft-safe)
│       ├── review/page.tsx          # Department Officer Queue (sorted by priority & low confidence)
│       ├── admin/page.tsx           # Live Rule Editor (versioned), Threshold Sliders, Eval Stats
│       └── audit-consent/page.tsx   # Auditor read-only log/trace viewer + Citizen Consent & Data Correction
└── README.md
```

---

## 5. Database Schema (PostgreSQL + Alembic)

| Table | Key Columns | Notes |
| :--- | :--- | :--- |
| `users` | `id`, `name`, `email`, `role` (`citizen`, `helper`, `officer`, `admin`, `auditor`), `password_hash`, `created_at` | RBAC enforced server-side. |
| `families` | `id`, `helper_id`, `display_name`, `phonetic_key`, `phone_masked`, `notes`, `updated_at` | `phonetic_key` used **only** for candidate lookup, never auto-merge. |
| `api_keys` | `id`, `user_id`, `key_hash`, `rate_limit_per_min`, `active` | For `POST /v1/check`. |
| `cases` | `id`, `submitted_by`, `family_id` (nullable), `message_text` (PII-redacted), `message_hash`, `sender_claimed`, `payment_ref` (nullable), `status` (`open`, `needs_info`, `in_review`, `resolved`, `closed`), `verdict`, `confidence`, `rule_version`, `assigned_officer`, `created_at` | Tracks full lifecycle. |
| `decisions` | `id`, `case_id`, `verdict`, `confidence`, `user_explanation`, `rule_version`, `model_version`, `auditor_trace` (JSONB), `decided_by` (`ai` or `officer`), `officer_notes`, `created_at` | Immutable history per case. |
| `rules` | `id`, `version`, `name`, `rule_type` (`keyword`, `link`, `pii_request`, `urgency`, `sender_mismatch`), `pattern`, `weight`, `active`, `created_by`, `created_at` | Editing creates a new `version`; old decisions keep their original `rule_version`. |
| `thresholds` | `id`, `version`, `scam_auto_threshold`, `official_match_threshold`, `ask_info_threshold`, `active`, `created_by`, `created_at` | DB-driven; instant effect with zero redeploy. |
| `consents` | `id`, `subject_type` (`user` or `family`), `subject_id`, `grantee_role`, `scope` (`case_review`, `mock_identity`, `mock_payment`), `status` (`active`, `withdrawn`), `granted_at`, `withdrawn_at` | Checked server-side on every read/lookup. |
| `audit_log` | `id`, `actor_id`, `actor_type` (`user`, `ai`, `system`), `action`, `entity_type`, `entity_id`, `payload` (JSONB), `created_at` | **Append-only** (no UPDATE/DELETE routes). Logs both reads and writes. |

---

## 6. AI Decision Pipeline (`services/pipeline.py`)

```python
# Strict Pydantic schema validated on AI output
class AIDecisionOutput(BaseModel):
    predicted_label: Literal["scam", "official_like", "uncertain"]
    confidence: float = Field(ge=0.0, le=1.0)
    scam_signals: list[str]
    plain_reason_en: str
    plain_reason_ur: str
    safe_followup_question: Optional[str] = None  # Must NEVER ask for OTP/CNIC/PIN
```

**Step-by-Step Execution:**
1. **Normalize & PII Guardrail:** Strip extra whitespace, normalize Roman Urdu/English text, redact accidental CNIC/OTP patterns, and record `pii_redacted` if triggered.
2. **Dedupe Check:** Compute SHA-256 `message_hash`. Link to prior cases with the same hash without exposing another family's private data.
3. **Mock Service Checks (Consent-Gated):**
   * Check `consents` table first. If consent is withdrawn, block mock identity/payment lookups and log `consent_denied`.
   * Call `mock_sender_registry(sender_claimed, message_text)` to see if the text/sender matches a mock official notice.
   * If a mock `payment_ref` is present and consent is active, call `mock_payment_service(payment_ref)` to check disbursement status (`valid_pending`, `not_found`, `duplicate_flagged`).
4. **Rules Engine (Active DB Version):** Load `active=True` rules and current `rule_version` from DB. Score links, urgency, OTP/CNIC solicitation, and sender mismatch.
5. **AI Classifier (Pydantic-Validated):** Run classifier/LLM and validate output against `AIDecisionOutput`.
6. **Combine & Asymmetric Router:**
   * Load active `thresholds` from DB.
   * If `scam_score >= scam_auto_threshold` → verdict = `suspicious`, status = `resolved` (with warning + officer escalation option).
   * Else if `official_score >= official_match_threshold` **AND** `registry_match == True` **AND** no red flags → verdict = `matches_mock_official_notice`, status = `resolved` (with spoofed-sender caveat).
   * Else if `confidence >= ask_info_threshold` → verdict = `needs_non_sensitive_info`, status = `needs_info` (safe follow-up only).
   * Else → verdict = `unverified_officer_review`, status = `in_review` (**"I am not sure"** handoff to Department Officer queue with structured case notes).
7. **Dual Explanation & Audit Write:** Save `Decision` with both `user_explanation` and full `auditor_trace` JSONB, and append an `audit_log` entry.

---

## 7. API Endpoints (Swagger at `/docs`)

* **Auth:** `POST /auth/login`, `GET /auth/me`
* **Cases:** `POST /cases`, `GET /cases`, `GET /cases/{id}`, `POST /cases/{id}/escalate`, `POST /cases/{id}/close`
* **Families (Helper Mode & Bad Data):** `GET /families`, `POST /families` (returns `candidate_matches` if variant found — never auto-merges), `PATCH /families/{id}` (data correction, logged in audit)
* **Officer Review:** `GET /review/queue` (sorted by lowest confidence & highest risk), `POST /review/{id}/decide`, `POST /review/{id}/request-info` (validates no sensitive proof requested)
* **Rules & Thresholds (Admin):** `GET /rules`, `POST /rules`, `PUT /rules/{id}` (creates new version), `GET /thresholds`, `PUT /thresholds`
* **Consent:** `GET /consent`, `POST /consent`, `PATCH /consent/{id}` (update scope/correct data), `DELETE /consent/{id}` (withdraw — immediately blocks server-side access)
* **Audit (Auditor Read-Only):** `GET /audit`, `GET /audit/cases/{id}/trace` (auditor role has zero write endpoints)
* **Stats & Evaluation:** `GET /stats` (synthetic dataset N=30 threshold table, false alarms, missed scams, handoff rate)
* **Public API:** `POST /v1/check` (`X-API-Key` header, rate limited via `slowapi`)
* **Mock DPI Services:** `GET /mock/sender/{sender_id}`, `GET /mock/identity/{ref}`, `GET /mock/payment/{payment_ref}`

---

## 8. Trimmed Frontend (4 Role-Aware Screens)

1. **`/` — Message Checker & Helper Mode (Citizen / Helper):**
   * Top persistent banner: *"PROTOTYPE — Not an official service. Never share OTP, CNIC, or PIN."*
   * Helper Mode family selector + **"New Family"** (shows candidate name matches for *Muhammad/Mohammad/Muhammed* without auto-merging) + **"Clear Local Drafts"** button.
   * Large paste box + **Mic button** (Web Speech API) + **Read-Aloud button** (Urdu/English TTS).
   * Minimal per-family offline draft saving (`draft:{helper_id}:{family_id}`) cleared on submit/switch.
   * Result card with large color-coded icon, verdict badge (`Suspicious`, `Matches Mock Official Notice`, `Needs Safe Info`, `Sent to Officer — I Am Not Sure`), plain-language explanation, and "Escalate to Officer" button.
2. **`/review` — Officer Review Queue (Department Officer):**
   * Priority queue of `unverified_officer_review` and escalated cases with AI case notes, rule version, and mock registry/payment check results.
   * Approve/Flag/Request Safe Info actions (blocks sensitive-info prompts).
3. **`/admin` — Live Rules, Thresholds & Synthetic Eval (Admin):**
   * Rule table + live editor (creates new `rule_version` instantly without redeploy).
   * Asymmetric threshold sliders + live synthetic dataset (N=30) table showing false alarms, missed scams, and human handoffs.
4. **`/audit-consent` — Audit Trace & Consent Control (Auditor / Citizen / Helper):**
   * **Consent Tab:** View active sharing scopes, correct family/profile data, and **Withdraw Consent** (demonstrates immediate server-side `403` / blocked access).
   * **Audit Tab (Read-Only):** Filterable append-only log (reads + writes) and expandable JSON decision trace viewer showing exact `rule_version`, `model_version`, confidence, and inputs.

---

## 9. Coding Instructions for AI Studio
When generating code from this specification:
1. Start with **Phase 1 (Backend Core):** SQLAlchemy models, Alembic initial migration, JWT auth + RBAC dependencies, seed script (`seed_data.py` with 5 roles, name-variant families, and 30 synthetic labeled messages), and Mock Identity/Payment/Sender services.
2. Then **Phase 2 (AI Pipeline & Governance):** `pipeline.py`, `rules_engine.py`, `classifier.py` (with Pydantic `AIDecisionOutput`), `name_matcher.py`, `consent_service.py` (server-side enforcement), and `audit_service.py` (logging reads and writes).
3. Then **Phase 3 (Frontend):** Build the 4 Next.js pages with Web Speech API voice support, per-family isolated drafts, and explicit prototype/anti-phishing warnings.
4. Keep code modular, typed, and immediately runnable with `uvicorn` and `next dev`. Do not skip server-side RBAC or consent checks.