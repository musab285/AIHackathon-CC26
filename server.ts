import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CaseRecord,
  CaseWithDecisions,
  ConsentScope,
  DecisionRecord,
  FamilyRecord,
  RuleRecord,
  RuleType,
  ThresholdConfig,
  UserRole,
  Verdict,
} from './src/shared/types';
import { DEMO_PUBLIC_API_KEY } from './server/db/seedData';
import { seedInitialCasesIfEmpty } from './server/db/seedCases';
import { RelationalStore } from './server/db/store';
import {
  type AuthedRequest,
  checkRateLimit,
  createAuthMiddleware,
  requireRoles,
  sha256,
  signAuthToken,
  toPublicUser,
  verifyPassword,
} from './server/security';
import {
  lookupMockIdentity,
  lookupMockPayment,
  lookupMockSenderRegistry,
  MOCK_OFFICIAL_REGISTRY,
} from './server/services/mockServices';
import { computePhoneticKey, findCandidateMatches } from './server/services/nameMatcher';
import { checkSensitiveProofRequest, redactPii } from './server/services/piiGuard';
import { evaluateSyntheticDataset, runVerificationPipeline } from './server/services/pipeline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

const store = new RelationalStore(true);

function attachDecisions(caseRec: CaseRecord): CaseWithDecisions {
  const decisions = store.state.decisions
    .filter((d) => d.case_id === caseRec.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    ...caseRec,
    decisions,
    latest_decision: decisions[0] ?? null,
  };
}

function getCaseSubject(caseRec: CaseRecord): { subjectType: 'user' | 'family'; subjectId: string } {
  if (caseRec.family_id) {
    return { subjectType: 'family', subjectId: caseRec.family_id };
  }
  return { subjectType: 'user', subjectId: caseRec.submitted_by };
}

function isCaseConsentActive(caseRec: CaseRecord, scope: ConsentScope): boolean {
  const { subjectType, subjectId } = getCaseSubject(caseRec);
  return store.hasActiveConsent(subjectType, subjectId, scope);
}

async function createServer() {
  await seedInitialCasesIfEmpty(store);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const requireAuth = createAuthMiddleware((id) =>
    store.state.users.find((u) => u.id === id)
  );

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      prototype: true,
      gemini_configured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
    });
  });

  // =========================================================
  // AUTH ROUTES
  // =========================================================
  app.get('/api/auth/demo-accounts', (_req, res) => {
    res.json({
      accounts: store.state.users.map(toPublicUser),
      demo_api_key_hint: DEMO_PUBLIC_API_KEY,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const ipKey = `login:${req.ip || 'local'}`;
    const rl = checkRateLimit(ipKey, 40);
    if (!rl.allowed) {
      res.status(429).json({ error: 'Too many login attempts. Please wait a minute.' });
      return;
    }

    const { email, password, demo_role } = req.body ?? {};
    let user = undefined;

    if (typeof demo_role === 'string' && demo_role.trim()) {
      user = store.state.users.find((u) => u.role === demo_role.trim());
      if (!user) {
        res.status(400).json({ error: `Unknown demo role: ${demo_role}` });
        return;
      }
    } else {
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }
      user = store.state.users.find(
        (u) => u.email.toLowerCase() === email.trim().toLowerCase()
      );
      if (!user || !verifyPassword(password, user.password_hash)) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }
    }

    const publicUser = toPublicUser(user);
    const token = signAuthToken(publicUser);

    store.appendAudit({
      actor_id: publicUser.id,
      actor_name: publicUser.name,
      actor_role: publicUser.role,
      actor_type: 'user',
      action: 'user_login',
      access_kind: 'security',
      entity_type: 'user',
      entity_id: publicUser.id,
      payload: { method: demo_role ? 'demo_role_switch' : 'password_login' },
    });

    res.json({ token, user: publicUser });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({
      user: req.user,
      gemini_configured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
    });
  });

  // =========================================================
  // CASES ROUTES (Citizen, Helper, Officer, Admin, Auditor read-only)
  // =========================================================
  app.post(
    '/api/cases',
    requireAuth,
    requireRoles('citizen', 'helper', 'officer', 'admin'),
    async (req: AuthedRequest, res) => {
      try {
        const actor = req.user!;
        const { message_text, sender_claimed = '', payment_ref = null, family_id = null, use_gemini = false } =
          req.body ?? {};

        if (typeof message_text !== 'string' || message_text.trim().length < 6) {
          res.status(400).json({
            error: 'Please enter a relief message of at least 6 characters to verify.',
          });
          return;
        }
        if (message_text.length > 2500) {
          res.status(400).json({ error: 'Message exceeds 2,500 character limit.' });
          return;
        }

        let resolvedFamilyId: string | null = null;
        if (typeof family_id === 'string' && family_id.trim()) {
          const fam = store.state.families.find((f) => f.id === family_id.trim());
          if (!fam) {
            res.status(404).json({ error: 'Selected family record not found.' });
            return;
          }
          if (actor.role === 'helper' && fam.helper_id !== actor.id) {
            res.status(403).json({ error: 'You can only submit cases for families you manage.' });
            return;
          }
          resolvedFamilyId = fam.id;
        }

        const result = await runVerificationPipeline({
          store,
          actor,
          messageText: message_text,
          senderClaimed: typeof sender_claimed === 'string' ? sender_claimed : '',
          paymentRef: typeof payment_ref === 'string' && payment_ref.trim() ? payment_ref : null,
          familyId: resolvedFamilyId,
          useGemini: Boolean(use_gemini),
          persistCase: true,
        });

        res.status(201).json({ case: result.caseRecord });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to evaluate message.';
        res.status(502).json({ error: message });
      }
    }
  );

  app.get('/api/cases', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.user!;
    let visible = [...store.state.cases];

    if (actor.role === 'citizen') {
      visible = visible.filter((c) => c.submitted_by === actor.id);
    } else if (actor.role === 'helper') {
      const managedFamilyIds = new Set(
        store.state.families.filter((f) => f.helper_id === actor.id).map((f) => f.id)
      );
      visible = visible.filter(
        (c) => c.submitted_by === actor.id || (c.family_id !== null && managedFamilyIds.has(c.family_id))
      );
    } else if (actor.role === 'officer') {
      // Server-side consent enforcement: officers cannot read message bodies when case_review consent is withdrawn
      visible = visible.map((c) => {
        if (!isCaseConsentActive(c, 'case_review')) {
          return {
            ...c,
            message_text: '[ACCESS RESTRICTED — Subject withdrew case_review consent]',
            family_name: c.family_name ? '[Redacted — Consent Withdrawn]' : null,
          };
        }
        return c;
      });
    }

    store.appendAudit({
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      actor_type: 'user',
      action: 'cases_list_viewed',
      access_kind: 'read',
      entity_type: 'case',
      entity_id: 'collection',
      payload: { returned_count: visible.length },
    });

    res.json({ cases: visible.map(attachDecisions) });
  });

  app.get('/api/cases/:id', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.user!;
    const found = store.state.cases.find((c) => c.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    // Ownership check for citizens & helpers
    if (actor.role === 'citizen' && found.submitted_by !== actor.id) {
      res.status(403).json({ error: 'Access denied to another user’s case.' });
      return;
    }
    if (actor.role === 'helper' && found.submitted_by !== actor.id) {
      const ownsFam =
        found.family_id !== null &&
        store.state.families.some((f) => f.id === found.family_id && f.helper_id === actor.id);
      if (!ownsFam) {
        res.status(403).json({ error: 'Access denied to unmanaged family case.' });
        return;
      }
    }

    // Server-side consent check for officer access
    if (actor.role === 'officer' && !isCaseConsentActive(found, 'case_review')) {
      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'system',
        action: 'consent_denied',
        access_kind: 'security',
        entity_type: 'case',
        entity_id: found.id,
        payload: { scope: 'case_review', reason: 'Subject withdrew consent' },
      });
      res.status(403).json({
        error: 'Consent withdrawn: server blocked case_review access for this subject.',
      });
      return;
    }

    store.appendAudit({
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      actor_type: 'user',
      action: 'case_viewed',
      access_kind: 'read',
      entity_type: 'case',
      entity_id: found.id,
      payload: { verdict: found.verdict },
    });

    res.json({ case: attachDecisions(found) });
  });

  app.post(
    '/api/cases/:id/escalate',
    requireAuth,
    requireRoles('citizen', 'helper', 'officer', 'admin'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const found = store.state.cases.find((c) => c.id === req.params.id);
      if (!found) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }
      if (actor.role === 'citizen' && found.submitted_by !== actor.id) {
        res.status(403).json({ error: 'Cannot escalate another citizen’s case.' });
        return;
      }

      const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? redactPii(req.body.reason).sanitizedText
        : 'User requested human Department Officer verification.';

      found.status = 'in_review';
      found.verdict = 'unverified_officer_review';
      found.assigned_officer = 'usr-officer-1';
      found.updated_at = new Date().toISOString();

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'case_escalated',
        access_kind: 'write',
        entity_type: 'case',
        entity_id: found.id,
        payload: { reason },
      });

      res.json({ case: attachDecisions(found) });
    }
  );

  app.post(
    '/api/cases/:id/followup',
    requireAuth,
    requireRoles('citizen', 'helper', 'admin'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const found = store.state.cases.find((c) => c.id === req.params.id);
      if (!found) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }
      const answerRaw = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
      if (answerRaw.length < 2) {
        res.status(400).json({ error: 'Please provide a brief non-sensitive answer.' });
        return;
      }
      const pii = redactPii(answerRaw);
      found.message_text = `${found.message_text}\n[Safe Context Provided: ${pii.sanitizedText}]`;
      found.status = 'in_review';
      found.verdict = 'unverified_officer_review';
      found.assigned_officer = 'usr-officer-1';
      found.updated_at = new Date().toISOString();

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'case_followup_submitted',
        access_kind: 'write',
        entity_type: 'case',
        entity_id: found.id,
        payload: { pii_redacted: pii.piiRedacted },
      });

      res.json({ case: attachDecisions(found) });
    }
  );

  app.post(
    '/api/cases/:id/close',
    requireAuth,
    requireRoles('citizen', 'helper', 'officer', 'admin'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const found = store.state.cases.find((c) => c.id === req.params.id);
      if (!found) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }
      if (actor.role === 'citizen' && found.submitted_by !== actor.id) {
        res.status(403).json({ error: 'Cannot close another user’s case.' });
        return;
      }
      found.status = 'closed';
      found.updated_at = new Date().toISOString();

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'case_closed',
        access_kind: 'write',
        entity_type: 'case',
        entity_id: found.id,
        payload: { closed_by_role: actor.role },
      });

      res.json({ case: attachDecisions(found) });
    }
  );

  // =========================================================
  // FAMILIES ROUTES (Helper Mode + Phonetic Candidate Suggestions — NEVER Auto-Merge)
  // =========================================================
  app.get(
    '/api/families',
    requireAuth,
    requireRoles('helper', 'officer', 'admin', 'auditor'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const list =
        actor.role === 'helper'
          ? store.state.families.filter((f) => f.helper_id === actor.id)
          : store.state.families;

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'families_list_viewed',
        access_kind: 'read',
        entity_type: 'family',
        entity_id: 'collection',
        payload: { count: list.length },
      });

      res.json({ families: list });
    }
  );

  app.post(
    '/api/families/candidates',
    requireAuth,
    requireRoles('helper', 'officer', 'admin'),
    (req: AuthedRequest, res) => {
      const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : '';
      if (!displayName) {
        res.json({ phonetic_key: '', candidate_matches: [] });
        return;
      }
      const phoneticKey = computePhoneticKey(displayName);
      const candidates = findCandidateMatches(displayName, store.state.families);
      res.json({ phonetic_key: phoneticKey, candidate_matches: candidates });
    }
  );

  app.post(
    '/api/families',
    requireAuth,
    requireRoles('helper', 'admin'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const {
        display_name,
        phone_masked = '03XX-***-XXXX',
        village_or_ward = '',
        notes = '',
        confirm_new = false,
      } = req.body ?? {};

      if (typeof display_name !== 'string' || display_name.trim().length < 2) {
        res.status(400).json({ error: 'Family display name is required (at least 2 characters).' });
        return;
      }

      const cleanName = display_name.trim();
      const phoneticKey = computePhoneticKey(cleanName);
      const candidateMatches = findCandidateMatches(cleanName, store.state.families);

      // Non-negotiable rule: NEVER auto-merge! Return candidates and require explicit confirmation.
      if (candidateMatches.length > 0 && !confirm_new) {
        store.appendAudit({
          actor_id: actor.id,
          actor_name: actor.name,
          actor_role: actor.role,
          actor_type: 'system',
          action: 'family_candidate_matches_suggested',
          access_kind: 'read',
          entity_type: 'family',
          entity_id: phoneticKey,
          payload: {
            input_name: cleanName,
            phonetic_key: phoneticKey,
            candidates_count: candidateMatches.length,
          },
        });
        res.status(200).json({
          status: 'candidates_found',
          phonetic_key: phoneticKey,
          candidate_matches: candidateMatches,
          message:
            'Possible name-spelling match found. Confirm an existing record or explicitly choose "Create Separate Record" — records are never auto-merged.',
        });
        return;
      }

      const idNum = 101 + store.state.families.length;
      const newFamily: FamilyRecord = {
        id: `FAM-${idNum}`,
        helper_id: actor.role === 'helper' ? actor.id : 'usr-helper-1',
        display_name: cleanName,
        phonetic_key: phoneticKey,
        phone_masked: typeof phone_masked === 'string' && phone_masked.trim()
          ? phone_masked.trim()
          : '03XX-***-XXXX',
        village_or_ward: typeof village_or_ward === 'string' ? village_or_ward.trim() : '',
        notes: typeof notes === 'string' ? redactPii(notes).sanitizedText : '',
        updated_at: new Date().toISOString(),
      };

      store.state.families.unshift(newFamily);
      store.ensureFamilyDefaultConsents(newFamily.id, newFamily.display_name, newFamily.helper_id);

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'family_created',
        access_kind: 'write',
        entity_type: 'family',
        entity_id: newFamily.id,
        payload: {
          display_name: newFamily.display_name,
          phonetic_key: newFamily.phonetic_key,
          confirmed_separate_from_candidates: Boolean(confirm_new && candidateMatches.length > 0),
        },
      });

      res.status(201).json({ status: 'created', family: newFamily });
    }
  );

  app.patch(
    '/api/families/:id',
    requireAuth,
    requireRoles('helper', 'citizen', 'admin'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const fam = store.state.families.find((f) => f.id === req.params.id);
      if (!fam) {
        res.status(404).json({ error: 'Family record not found.' });
        return;
      }
      if (actor.role === 'helper' && fam.helper_id !== actor.id) {
        res.status(403).json({ error: 'You can only edit families assigned to you.' });
        return;
      }

      const before = {
        display_name: fam.display_name,
        phone_masked: fam.phone_masked,
        village_or_ward: fam.village_or_ward,
        notes: fam.notes,
      };

      if (typeof req.body?.display_name === 'string' && req.body.display_name.trim().length >= 2) {
        fam.display_name = req.body.display_name.trim();
        fam.phonetic_key = computePhoneticKey(fam.display_name);
      }
      if (typeof req.body?.phone_masked === 'string' && req.body.phone_masked.trim()) {
        fam.phone_masked = req.body.phone_masked.trim();
      }
      if (typeof req.body?.village_or_ward === 'string') {
        fam.village_or_ward = req.body.village_or_ward.trim();
      }
      if (typeof req.body?.notes === 'string') {
        fam.notes = redactPii(req.body.notes).sanitizedText;
      }
      fam.updated_at = new Date().toISOString();

      // Update consent subject labels for consistency
      for (const c of store.state.consents) {
        if (c.subject_type === 'family' && c.subject_id === fam.id) {
          c.subject_label = `${fam.display_name} (${fam.id})`;
        }
      }

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'family_data_corrected',
        access_kind: 'write',
        entity_type: 'family',
        entity_id: fam.id,
        payload: { before, after: { display_name: fam.display_name, village_or_ward: fam.village_or_ward } },
      });

      res.json({ family: fam });
    }
  );

  // =========================================================
  // OFFICER REVIEW QUEUE ROUTES
  // =========================================================
  app.get(
    '/api/review/queue',
    requireAuth,
    requireRoles('officer', 'admin'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'pending';

      const matching = store.state.cases.filter((c) => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'resolved') return c.status === 'resolved' || c.status === 'closed';
        return c.status === 'in_review' || c.status === 'needs_info' || c.status === 'open';
      });

      // Sort priority: unverified_officer_review first, then lowest confidence, then newest
      const sorted = [...matching].sort((a, b) => {
        const aUnverified = a.verdict === 'unverified_officer_review' ? 0 : 1;
        const bUnverified = b.verdict === 'unverified_officer_review' ? 0 : 1;
        if (aUnverified !== bUnverified) return aUnverified - bUnverified;
        if (a.confidence !== b.confidence) return a.confidence - b.confidence;
        return b.created_at.localeCompare(a.created_at);
      });

      const queueItems = sorted.map((c) => {
        const consentActive = isCaseConsentActive(c, 'case_review');
        const hydrated = attachDecisions(c);
        if (!consentActive) {
          return {
            ...hydrated,
            consent_blocked: true,
            message_text: '[BLOCKED SERVER-SIDE — Subject withdrew case_review consent]',
            family_name: hydrated.family_name ? '[Redacted — Consent Withdrawn]' : null,
          };
        }
        return { ...hydrated, consent_blocked: false };
      });

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'officer_queue_viewed',
        access_kind: 'read',
        entity_type: 'review_queue',
        entity_id: statusFilter,
        payload: { queue_size: queueItems.length },
      });

      res.json({ queue: queueItems });
    }
  );

  app.post(
    '/api/review/:id/decide',
    requireAuth,
    requireRoles('officer', 'admin'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const found = store.state.cases.find((c) => c.id === req.params.id);
      if (!found) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      // Server-side consent enforcement!
      if (!isCaseConsentActive(found, 'case_review')) {
        store.appendAudit({
          actor_id: actor.id,
          actor_name: actor.name,
          actor_role: actor.role,
          actor_type: 'system',
          action: 'consent_denied',
          access_kind: 'security',
          entity_type: 'case',
          entity_id: found.id,
          payload: { attempted_action: 'officer_decide', scope: 'case_review' },
        });
        res.status(403).json({
          error: '403 Forbidden: Subject withdrew case_review consent. Officer review is blocked server-side.',
        });
        return;
      }

      const { verdict, officer_notes = '' } = req.body ?? {};
      const allowedVerdicts: Verdict[] = [
        'suspicious',
        'matches_mock_official_notice',
        'unverified_officer_review',
      ];
      if (!allowedVerdicts.includes(verdict)) {
        res.status(400).json({ error: 'Invalid officer verdict.' });
        return;
      }

      const latestAiDecision = store.state.decisions.find((d) => d.case_id === found.id);
      const registryMatched = Boolean(latestAiDecision?.auditor_trace.registry_check.matched);

      // Even officers cannot mark matches_mock_official_notice unless mock registry matched OR explicit manual registry override note provided
      const cleanNotes = typeof officer_notes === 'string' ? redactPii(officer_notes).sanitizedText : '';
      if (verdict === 'matches_mock_official_notice' && !registryMatched && cleanNotes.length < 10) {
        res.status(400).json({
          error:
            'Message did not match Mock Official Notice Registry automatically. Add a brief verification note (10+ chars) explaining your manual desk confirmation.',
        });
        return;
      }

      const now = new Date().toISOString();
      const explanationEn =
        verdict === 'suspicious'
          ? `Department Officer confirmed this message is SUSPICIOUS. ${cleanNotes || 'Do not send money, click links, or share OTP/CNIC/PIN.'}`
          : verdict === 'matches_mock_official_notice'
            ? `Department Officer confirmed alignment with Mock Official Notice. ${cleanNotes || 'Verify in person at an official desk; forwarded sender names can still be spoofed.'}`
            : `Case remains unverified pending further desk checks. ${cleanNotes}`;

      const explanationUr =
        verdict === 'suspicious'
          ? 'ڈپارٹمنٹ آفیسر نے تصدیق کی ہے کہ یہ پیغام مشکوک / فراڈ ہے۔ پیسے یا OTP/شناختی کارڈ ہرگز نہ دیں۔'
          : verdict === 'matches_mock_official_notice'
            ? 'ڈپارٹمنٹ آفیسر نے موک سرکاری نوٹس سے مطابقت کی تصدیق کی ہے، تاہم دفتر میں ذاتی طور پر تصدیق کریں۔'
            : 'کیس ابھی مزید تصدیق کے لیے زیرِ التواء ہے۔';

      const officerDecision: DecisionRecord = {
        id: store.nextId('dec'),
        case_id: found.id,
        verdict,
        confidence: 1.0,
        user_explanation_en: explanationEn,
        user_explanation_ur: explanationUr,
        safe_followup_question: null,
        rule_version: found.rule_version,
        model_version: 'human-officer-review',
        auditor_trace: {
          ...(latestAiDecision?.auditor_trace ?? {
            input_hash: found.message_hash,
            pii_redacted: found.pii_redacted,
            redacted_types: [],
            duplicate_case_count: found.duplicate_count,
            rule_version: found.rule_version,
            threshold_version: store.getActiveThresholds().version,
            model_version: 'human-officer-review',
            matched_rules: [],
            rule_score: 0,
            ai_output: {
              predicted_label: 'uncertain',
              confidence: 0.5,
              scam_signals: [],
              plain_reason_en: explanationEn,
              plain_reason_ur: explanationUr,
              safe_followup_question: null,
            },
            scam_score: 0,
            official_score: 0,
            confidence: 1,
            registry_check: lookupMockSenderRegistry(found.sender_claimed, found.message_text),
            payment_check: lookupMockPayment(found.payment_ref),
            thresholds_applied: {
              scam_auto_threshold: store.getActiveThresholds().scam_auto_threshold,
              official_match_threshold: store.getActiveThresholds().official_match_threshold,
              ask_info_threshold: store.getActiveThresholds().ask_info_threshold,
            },
            verdict,
            routing_reason: 'Officer review override',
            evaluated_at: now,
          }),
          verdict,
          routing_reason: `Officer ${actor.name} decided "${verdict}"`,
          evaluated_at: now,
        },
        decided_by: 'officer',
        decided_by_user_id: actor.id,
        officer_notes: cleanNotes || null,
        created_at: now,
      };

      found.verdict = verdict;
      found.status = verdict === 'unverified_officer_review' ? 'in_review' : 'resolved';
      found.assigned_officer = actor.id;
      found.updated_at = now;
      store.state.decisions.unshift(officerDecision);

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'officer_decision_recorded',
        access_kind: 'decision',
        entity_type: 'case',
        entity_id: found.id,
        payload: {
          verdict,
          officer_notes: cleanNotes,
          previous_rule_version: found.rule_version,
        },
      });

      res.json({ case: attachDecisions(found) });
    }
  );

  app.post(
    '/api/review/:id/request-info',
    requireAuth,
    requireRoles('officer', 'admin'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const found = store.state.cases.find((c) => c.id === req.params.id);
      if (!found) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      if (!isCaseConsentActive(found, 'case_review')) {
        res.status(403).json({
          error: '403 Forbidden: Subject withdrew case_review consent.',
        });
        return;
      }

      const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
      if (question.length < 8) {
        res.status(400).json({ error: 'Please write a clear non-sensitive question (8+ characters).' });
        return;
      }

      // Non-negotiable Anti-Phishing Guardrail: NEVER ask for OTP, CNIC, PIN, or bank password
      const guard = checkSensitiveProofRequest(question);
      if (!guard.allowed) {
        store.appendAudit({
          actor_id: actor.id,
          actor_name: actor.name,
          actor_role: actor.role,
          actor_type: 'system',
          action: 'anti_phishing_prompt_blocked',
          access_kind: 'security',
          entity_type: 'case',
          entity_id: found.id,
          payload: { violated_terms: guard.violatedTerms },
        });
        res.status(400).json({
          error: `Anti-Phishing Guardrail Blocked: Officers may NEVER request sensitive proof (${guard.violatedTerms.join(', ')}). Ask only safe context (e.g. sender number type, camp location, or whether a fee was demanded).`,
        });
        return;
      }

      const now = new Date().toISOString();
      const latest = store.state.decisions.find((d) => d.case_id === found.id);
      const infoDecision: DecisionRecord = {
        id: store.nextId('dec'),
        case_id: found.id,
        verdict: 'needs_non_sensitive_info',
        confidence: found.confidence,
        user_explanation_en: `Department Officer requested non-sensitive context: "${question}" (Never share OTP, CNIC, or PIN.)`,
        user_explanation_ur: `ڈپارٹمنٹ آفیسر نے محفوظ معلومات طلب کی ہیں (OTP، شناختی کارڈ یا PIN ہرگز نہ دیں): ${question}`,
        safe_followup_question: question,
        rule_version: found.rule_version,
        model_version: 'human-officer-review',
        auditor_trace: latest!.auditor_trace,
        decided_by: 'officer',
        decided_by_user_id: actor.id,
        officer_notes: `Requested safe context: ${question}`,
        created_at: now,
      };

      found.verdict = 'needs_non_sensitive_info';
      found.status = 'needs_info';
      found.updated_at = now;
      store.state.decisions.unshift(infoDecision);

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'officer_requested_safe_info',
        access_kind: 'write',
        entity_type: 'case',
        entity_id: found.id,
        payload: { question },
      });

      res.json({ case: attachDecisions(found) });
    }
  );

  // =========================================================
  // ADMIN RULES & THRESHOLDS (Live Versioning — Zero Redeploy)
  // =========================================================
  app.get(
    '/api/rules',
    requireAuth,
    requireRoles('admin', 'officer', 'auditor'),
    (_req, res) => {
      res.json({
        rules: store.state.rules,
        active_version: store.getLatestRuleVersion(),
      });
    }
  );

  app.post('/api/rules', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const actor = req.user!;
    const { name, rule_type, pattern, weight } = req.body ?? {};
    const validTypes: RuleType[] = ['keyword', 'link', 'pii_request', 'urgency', 'sender_mismatch'];
    if (typeof name !== 'string' || name.trim().length < 3) {
      res.status(400).json({ error: 'Rule name must be at least 3 characters.' });
      return;
    }
    if (!validTypes.includes(rule_type)) {
      res.status(400).json({ error: 'Invalid rule_type.' });
      return;
    }
    if (typeof pattern !== 'string' || pattern.trim().length < 2) {
      res.status(400).json({ error: 'Pattern must be at least 2 characters.' });
      return;
    }
    const numWeight = Number(weight);
    if (!Number.isFinite(numWeight) || numWeight < 0.05 || numWeight > 1.0) {
      res.status(400).json({ error: 'Weight must be between 0.05 and 1.00.' });
      return;
    }

    const nextVersion = store.getLatestRuleVersion() + 1;
    const newRule: RuleRecord = {
      id: store.nextId('rule'),
      version: nextVersion,
      name: name.trim(),
      rule_type,
      pattern: pattern.trim(),
      weight: Number(numWeight.toFixed(2)),
      active: true,
      created_by: actor.id,
      created_at: new Date().toISOString(),
    };

    store.state.rules.unshift(newRule);
    store.appendAudit({
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      actor_type: 'user',
      action: 'rule_created',
      access_kind: 'write',
      entity_type: 'rule',
      entity_id: newRule.id,
      payload: { version: nextVersion, name: newRule.name, weight: newRule.weight },
    });

    res.status(201).json({ rule: newRule, active_version: nextVersion });
  });

  app.put('/api/rules/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const actor = req.user!;
    const existing = store.state.rules.find((r) => r.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Rule not found.' });
      return;
    }

    const { name, rule_type, pattern, weight, active } = req.body ?? {};
    const nextVersion = store.getLatestRuleVersion() + 1;

    // Preserve old rule version immutably by deactivating old row & inserting a new versioned row
    existing.active = false;

    const updatedRule: RuleRecord = {
      id: store.nextId('rule'),
      version: nextVersion,
      name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
      rule_type: (rule_type as RuleType) || existing.rule_type,
      pattern: typeof pattern === 'string' && pattern.trim() ? pattern.trim() : existing.pattern,
      weight:
        weight !== undefined && Number.isFinite(Number(weight))
          ? Number(Math.min(1, Math.max(0.05, Number(weight))).toFixed(2))
          : existing.weight,
      active: typeof active === 'boolean' ? active : true,
      created_by: actor.id,
      created_at: new Date().toISOString(),
    };

    store.state.rules.unshift(updatedRule);
    store.appendAudit({
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      actor_type: 'user',
      action: 'rule_version_updated',
      access_kind: 'write',
      entity_type: 'rule',
      entity_id: updatedRule.id,
      payload: {
        previous_rule_id: existing.id,
        previous_version: existing.version,
        new_version: nextVersion,
        name: updatedRule.name,
        weight: updatedRule.weight,
        active: updatedRule.active,
      },
    });

    res.json({ rule: updatedRule, active_version: nextVersion });
  });

  app.get(
    '/api/thresholds',
    requireAuth,
    requireRoles('admin', 'officer', 'auditor', 'helper', 'citizen'),
    (_req, res) => {
      res.json({
        active: store.getActiveThresholds(),
        history: store.state.thresholds,
      });
    }
  );

  app.put('/api/thresholds', requireAuth, requireRoles('admin'), (req: AuthedRequest, res) => {
    const actor = req.user!;
    const scam = Number(req.body?.scam_auto_threshold);
    const official = Number(req.body?.official_match_threshold);
    const askInfo = Number(req.body?.ask_info_threshold);

    if (
      !Number.isFinite(scam) ||
      !Number.isFinite(official) ||
      !Number.isFinite(askInfo) ||
      scam < 0.5 ||
      scam > 0.99 ||
      official < 0.8 ||
      official > 0.99 ||
      askInfo < 0.3 ||
      askInfo > scam
    ) {
      res.status(400).json({
        error:
          'Invalid thresholds: require 0.30 <= ask_info <= scam_auto <= 0.99 and 0.80 <= official_match <= 0.99.',
      });
      return;
    }

    for (const t of store.state.thresholds) {
      t.active = false;
    }

    const nextVersion = store.state.thresholds.reduce((m, t) => Math.max(m, t.version), 0) + 1;
    const newThr: ThresholdConfig = {
      id: store.nextId('thr'),
      version: nextVersion,
      scam_auto_threshold: Number(scam.toFixed(2)),
      official_match_threshold: Number(official.toFixed(2)),
      ask_info_threshold: Number(askInfo.toFixed(2)),
      active: true,
      created_by: actor.id,
      created_at: new Date().toISOString(),
    };
    store.state.thresholds.unshift(newThr);

    store.appendAudit({
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      actor_type: 'user',
      action: 'thresholds_updated',
      access_kind: 'write',
      entity_type: 'threshold',
      entity_id: newThr.id,
      payload: {
        version: nextVersion,
        scam_auto_threshold: newThr.scam_auto_threshold,
        official_match_threshold: newThr.official_match_threshold,
        ask_info_threshold: newThr.ask_info_threshold,
      },
    });

    res.json({ active: newThr, history: store.state.thresholds });
  });

  // =========================================================
  // CONSENT ROUTES (View, Grant, Correct, Withdraw — Enforced Server-Side)
  // =========================================================
  app.get('/api/consent', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.user!;
    let visible = [...store.state.consents];
    if (actor.role === 'citizen' || actor.role === 'helper') {
      visible = visible.filter((c) => c.owner_user_id === actor.id);
    }

    store.appendAudit({
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      actor_type: 'user',
      action: 'consent_records_viewed',
      access_kind: 'read',
      entity_type: 'consent',
      entity_id: 'collection',
      payload: { count: visible.length },
    });

    res.json({ consents: visible });
  });

  app.post(
    '/api/consent',
    requireAuth,
    requireRoles('citizen', 'helper', 'admin'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const { subject_type, subject_id, scope } = req.body ?? {};
      const validScopes: ConsentScope[] = ['case_review', 'mock_identity', 'mock_payment'];
      if ((subject_type !== 'user' && subject_type !== 'family') || !validScopes.includes(scope)) {
        res.status(400).json({ error: 'Valid subject_type and scope are required.' });
        return;
      }

      const existing = store.state.consents.find(
        (c) => c.subject_type === subject_type && c.subject_id === subject_id && c.scope === scope
      );
      const now = new Date().toISOString();

      if (existing) {
        if (actor.role !== 'admin' && existing.owner_user_id !== actor.id) {
          res.status(403).json({ error: 'Cannot modify another user’s consent.' });
          return;
        }
        existing.status = 'active';
        existing.granted_at = now;
        existing.withdrawn_at = null;
        store.appendAudit({
          actor_id: actor.id,
          actor_name: actor.name,
          actor_role: actor.role,
          actor_type: 'user',
          action: 'consent_granted',
          access_kind: 'write',
          entity_type: 'consent',
          entity_id: existing.id,
          payload: { subject_id, scope },
        });
        res.json({ consent: existing });
        return;
      }

      const created = {
        id: store.nextId('cns'),
        subject_type,
        subject_id: String(subject_id),
        subject_label: String(subject_id),
        owner_user_id: actor.id,
        grantee_role: 'officer' as UserRole,
        scope: scope as ConsentScope,
        status: 'active' as const,
        granted_at: now,
        withdrawn_at: null,
      };
      store.state.consents.push(created);
      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'consent_granted',
        access_kind: 'write',
        entity_type: 'consent',
        entity_id: created.id,
        payload: { subject_id, scope },
      });
      res.status(201).json({ consent: created });
    }
  );

  app.patch(
    '/api/consent/:id',
    requireAuth,
    requireRoles('citizen', 'helper', 'admin'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const consent = store.state.consents.find((c) => c.id === req.params.id);
      if (!consent) {
        res.status(404).json({ error: 'Consent record not found.' });
        return;
      }
      if (actor.role !== 'admin' && consent.owner_user_id !== actor.id) {
        res.status(403).json({ error: 'Cannot update another user’s consent.' });
        return;
      }
      const nextStatus = req.body?.status === 'active' ? 'active' : 'withdrawn';
      consent.status = nextStatus;
      consent.withdrawn_at = nextStatus === 'withdrawn' ? new Date().toISOString() : null;
      if (nextStatus === 'active') {
        consent.granted_at = new Date().toISOString();
      }

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: nextStatus === 'active' ? 'consent_reinstated' : 'consent_withdrawn',
        access_kind: 'security',
        entity_type: 'consent',
        entity_id: consent.id,
        payload: { subject_id: consent.subject_id, scope: consent.scope, status: consent.status },
      });

      res.json({ consent });
    }
  );

  app.delete(
    '/api/consent/:id',
    requireAuth,
    requireRoles('citizen', 'helper', 'admin'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const consent = store.state.consents.find((c) => c.id === req.params.id);
      if (!consent) {
        res.status(404).json({ error: 'Consent record not found.' });
        return;
      }
      if (actor.role !== 'admin' && consent.owner_user_id !== actor.id) {
        res.status(403).json({ error: 'Cannot withdraw another user’s consent.' });
        return;
      }
      consent.status = 'withdrawn';
      consent.withdrawn_at = new Date().toISOString();

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'consent_withdrawn',
        access_kind: 'security',
        entity_type: 'consent',
        entity_id: consent.id,
        payload: {
          subject_type: consent.subject_type,
          subject_id: consent.subject_id,
          scope: consent.scope,
        },
      });

      res.json({
        consent,
        message: 'Consent withdrawn. Server-side access for this scope is now blocked.',
      });
    }
  );

  // =========================================================
  // AUDIT ROUTES (Append-Only — Auditor Role Has ZERO Write Endpoints)
  // =========================================================
  app.get(
    '/api/audit',
    requireAuth,
    requireRoles('auditor', 'admin', 'officer', 'helper', 'citizen'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const accessKind = typeof req.query.access_kind === 'string' ? req.query.access_kind : '';
      const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

      let logs = [...store.state.audit_log];
      if (actor.role === 'citizen') {
        logs = logs.filter((l) => l.actor_id === actor.id || l.entity_id === actor.id);
      } else if (actor.role === 'helper') {
        const famIds = new Set(
          store.state.families.filter((f) => f.helper_id === actor.id).map((f) => f.id)
        );
        logs = logs.filter((l) => l.actor_id === actor.id || famIds.has(l.entity_id));
      }

      if (accessKind && accessKind !== 'all') {
        logs = logs.filter((l) => l.access_kind === accessKind);
      }
      if (search) {
        logs = logs.filter(
          (l) =>
            l.action.toLowerCase().includes(search) ||
            l.actor_name.toLowerCase().includes(search) ||
            l.entity_id.toLowerCase().includes(search) ||
            JSON.stringify(l.payload).toLowerCase().includes(search)
        );
      }

      res.json({ logs: logs.slice(0, 150) });
    }
  );

  app.get(
    '/api/audit/cases/:id/trace',
    requireAuth,
    requireRoles('auditor', 'admin', 'officer'),
    (req: AuthedRequest, res) => {
      const actor = req.user!;
      const found = store.state.cases.find((c) => c.id === req.params.id);
      if (!found) {
        res.status(404).json({ error: 'Case not found.' });
        return;
      }

      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'user',
        action: 'audit_trace_viewed',
        access_kind: 'read',
        entity_type: 'case_trace',
        entity_id: found.id,
        payload: { rule_version: found.rule_version, verdict: found.verdict },
      });

      res.json({
        case: attachDecisions(found),
      });
    }
  );

  // =========================================================
  // SYNTHETIC DATASET EVALUATION STATS (Honest N=30 Prototype Metrics)
  // =========================================================
  app.get('/api/stats', requireAuth, (_req, res) => {
    const stats = evaluateSyntheticDataset(
      store.getActiveRules(),
      store.getActiveThresholds(),
      store.state.cases
    );
    res.json(stats);
  });

  // =========================================================
  // MOCK DPI SERVICES (Sender Registry, Identity, Payment)
  // =========================================================
  app.get('/api/mock/registry', requireAuth, (_req, res) => {
    res.json({ notices: MOCK_OFFICIAL_REGISTRY });
  });

  app.get('/api/mock/sender/:senderId', requireAuth, (req: AuthedRequest, res) => {
    const senderId = String(req.params.senderId);
    const sampleText = typeof req.query.text === 'string' ? req.query.text : 'relief notice';
    const result = lookupMockSenderRegistry(senderId, sampleText);
    res.json(result);
  });

  app.get('/api/mock/identity/:ref', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.user!;
    const ref = String(req.params.ref);
    if (!store.hasActiveConsent('family', ref, 'mock_identity')) {
      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'system',
        action: 'consent_denied',
        access_kind: 'security',
        entity_type: 'mock_identity',
        entity_id: ref,
        payload: { scope: 'mock_identity' },
      });
      res.status(403).json({
        error: `403 Forbidden: mock_identity consent is withdrawn or missing for ${ref}.`,
      });
      return;
    }
    const record = lookupMockIdentity(ref);
    store.appendAudit({
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      actor_type: 'user',
      action: 'mock_identity_lookup',
      access_kind: 'read',
      entity_type: 'mock_identity',
      entity_id: ref,
      payload: { status: record.status },
    });
    res.json(record);
  });

  app.get('/api/mock/payment/:paymentRef', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.user!;
    const paymentRef = String(req.params.paymentRef);
    const subjectId = typeof req.query.subject_id === 'string' ? req.query.subject_id : '';
    const subjectType = req.query.subject_type === 'user' ? 'user' : 'family';

    if (subjectId && !store.hasActiveConsent(subjectType, subjectId, 'mock_payment')) {
      store.appendAudit({
        actor_id: actor.id,
        actor_name: actor.name,
        actor_role: actor.role,
        actor_type: 'system',
        action: 'consent_denied',
        access_kind: 'security',
        entity_type: 'mock_payment',
        entity_id: subjectId,
        payload: { scope: 'mock_payment', payment_ref: paymentRef },
      });
      res.status(403).json({
        error: `403 Forbidden: mock_payment consent is withdrawn for ${subjectId}.`,
      });
      return;
    }

    res.json(lookupMockPayment(paymentRef));
  });

  // =========================================================
  // PUBLIC PARTNER API: POST /v1/check (X-API-Key + Rate Limited)
  // =========================================================
  app.post('/v1/check', async (req, res) => {
    const rawKey = req.headers['x-api-key'];
    if (typeof rawKey !== 'string' || !rawKey.trim()) {
      res.status(401).json({ error: 'Missing X-API-Key header.' });
      return;
    }

    const hashed = sha256(rawKey.trim());
    const keyRecord = store.state.api_keys.find((k) => k.key_hash === hashed && k.active);
    if (!keyRecord) {
      res.status(401).json({ error: 'Invalid or inactive API key.' });
      return;
    }

    const rl = checkRateLimit(`apikey:${keyRecord.id}`, keyRecord.rate_limit_per_min);
    res.setHeader('X-RateLimit-Limit', String(keyRecord.rate_limit_per_min));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.resetInSeconds));
      res.status(429).json({
        error: `Rate limit exceeded (${keyRecord.rate_limit_per_min} req/min). Retry in ${rl.resetInSeconds}s.`,
      });
      return;
    }

    const { message_text, sender_claimed = '', payment_ref = null } = req.body ?? {};
    if (typeof message_text !== 'string' || message_text.trim().length < 6) {
      res.status(400).json({ error: 'message_text (min 6 chars) is required.' });
      return;
    }

    const apiActor = {
      id: keyRecord.id,
      name: keyRecord.label,
      email: 'api@relief.demo',
      role: 'helper' as UserRole,
      created_at: keyRecord.created_at,
    };

    const result = await runVerificationPipeline({
      store,
      actor: apiActor,
      messageText: message_text,
      senderClaimed: typeof sender_claimed === 'string' ? sender_claimed : '',
      paymentRef: typeof payment_ref === 'string' ? payment_ref : null,
      familyId: null,
      useGemini: false,
      persistCase: false,
    });

    store.appendAudit({
      actor_id: keyRecord.id,
      actor_name: keyRecord.label,
      actor_role: 'system',
      actor_type: 'system',
      action: 'public_api_check',
      access_kind: 'decision',
      entity_type: 'v1_check',
      entity_id: result.trace.input_hash.slice(0, 12),
      payload: {
        verdict: result.decision.verdict,
        confidence: result.decision.confidence,
        rule_version: result.trace.rule_version,
        rate_limit_remaining: rl.remaining,
      },
    });

    res.json({
      prototype_notice: 'Mock hackathon prototype — not an official government service.',
      verdict: result.decision.verdict,
      confidence: result.decision.confidence,
      plain_reason_en: result.decision.user_explanation_en,
      plain_reason_ur: result.decision.user_explanation_ur,
      safe_followup_question: result.decision.safe_followup_question,
      pii_redacted: result.trace.pii_redacted,
      rule_version: result.trace.rule_version,
      threshold_version: result.trace.threshold_version,
      registry_check: result.trace.registry_check,
      rate_limit: {
        limit_per_min: keyRecord.rate_limit_per_min,
        remaining: rl.remaining,
      },
    });
  });

  // =========================================================
  // VITE DEV MIDDLEWARE OR PRODUCTION STATIC SERVING
  // =========================================================
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Relief Message Checker server listening on http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start Relief Message Checker server:', err);
  process.exit(1);
});
