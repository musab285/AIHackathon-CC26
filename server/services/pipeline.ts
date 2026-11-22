import type {
  AuditorTrace,
  CaseRecord,
  CaseWithDecisions,
  DecisionRecord,
  EvalStatsResponse,
  MockPaymentCheck,
  MockRegistryCheck,
  RuleRecord,
  SyntheticEvalRow,
  ThresholdConfig,
  UserPublic,
} from '../../src/shared/types';
import { SYNTHETIC_DATASET } from '../db/seedData';
import type { RelationalStore } from '../db/store';
import { sha256 } from '../security';
import { classifyMessage, deterministicClassify } from './classifier';
import { lookupMockPayment, lookupMockSenderRegistry } from './mockServices';
import { redactPii } from './piiGuard';
import { routeVerdict } from './router';
import { evaluateRules } from './rulesEngine';

export interface PipelineRunParams {
  store: RelationalStore;
  actor: UserPublic;
  messageText: string;
  senderClaimed: string;
  paymentRef?: string | null;
  familyId?: string | null;
  useGemini?: boolean;
  persistCase?: boolean;
  clientRequestId?: string | null;
}

export interface PipelineRunOutput {
  caseRecord: CaseWithDecisions | null;
  decision: DecisionRecord;
  trace: AuditorTrace;
}

export async function runVerificationPipeline(
  params: PipelineRunParams
): Promise<PipelineRunOutput> {
  const {
    store,
    actor,
    messageText,
    senderClaimed,
    paymentRef = null,
    familyId = null,
    useGemini = false,
    persistCase = true,
    clientRequestId = null,
  } = params;

  const now = new Date().toISOString();

  // Step 1: Normalize & PII Guardrail
  const pii = redactPii(messageText);
  const messageHash = sha256(`${senderClaimed.trim().toLowerCase()}::${pii.sanitizedText.toLowerCase()}`);

  if (pii.piiRedacted && persistCase) {
    store.appendAudit({
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      actor_type: 'system',
      action: 'pii_redacted',
      access_kind: 'security',
      entity_type: 'case_input',
      entity_id: messageHash.slice(0, 12),
      payload: {
        redacted_types: pii.redactedTypes,
        note: 'Accidental CNIC/OTP/IBAN redacted prior to storage',
      },
    });
  }

  // Step 2: Dedupe check (count prior matching hashes without exposing another family's private record)
  const duplicateCount = store.state.cases.filter((c) => c.message_hash === messageHash).length;

  // Step 3: Consent-gated Mock Service Checks
  const subjectType: 'user' | 'family' = familyId ? 'family' : 'user';
  const subjectId = familyId || actor.id;
  const canLookupPayment = store.hasActiveConsent(subjectType, subjectId, 'mock_payment');

  const registryCheck: MockRegistryCheck = lookupMockSenderRegistry(
    senderClaimed,
    pii.sanitizedText
  );

  let paymentCheck: MockPaymentCheck;
  if (paymentRef && paymentRef.trim()) {
    if (!canLookupPayment) {
      paymentCheck = {
        checked: false,
        blocked_by_consent: true,
        payment_ref: paymentRef.trim().toUpperCase(),
        status: 'skipped',
        detail: 'Mock payment lookup blocked server-side because mock_payment consent is withdrawn.',
      };
      if (persistCase) {
        store.appendAudit({
          actor_id: actor.id,
          actor_name: actor.name,
          actor_role: actor.role,
          actor_type: 'system',
          action: 'consent_denied',
          access_kind: 'security',
          entity_type: 'mock_payment',
          entity_id: subjectId,
          payload: {
            scope: 'mock_payment',
            subject_type: subjectType,
            reason: 'Consent withdrawn or inactive',
          },
        });
      }
    } else {
      paymentCheck = lookupMockPayment(paymentRef);
      if (persistCase) {
        store.appendAudit({
          actor_id: actor.id,
          actor_name: actor.name,
          actor_role: actor.role,
          actor_type: 'system',
          action: 'mock_payment_lookup',
          access_kind: 'read',
          entity_type: 'mock_payment',
          entity_id: paymentCheck.payment_ref || 'none',
          payload: { status: paymentCheck.status, subject_id: subjectId },
        });
      }
    }
  } else {
    paymentCheck = lookupMockPayment(null);
  }

  // Step 4: Active DB Rules Engine
  const activeRules = store.getActiveRules();
  const rulesResult = evaluateRules(pii.sanitizedText, senderClaimed, activeRules);

  // Step 5: AI Classifier (Strict AIDecisionOutput schema)
  const classification = await classifyMessage({
    sanitizedText: pii.sanitizedText,
    senderClaimed,
    matchedRules: rulesResult.matchedRules,
    ruleScore: rulesResult.ruleScore,
    registryCheck,
    useGemini,
  });

  // Step 6: Combine & Asymmetric Router
  const activeThresholds = store.getActiveThresholds();
  const routed = routeVerdict({
    ruleScore: rulesResult.ruleScore,
    hasHardRedFlag: rulesResult.hasHardRedFlag,
    aiOutput: classification.output,
    registryCheck,
    paymentCheck,
    thresholds: activeThresholds,
  });

  // Step 7: Dual Explainability & Audit Trace
  const trace: AuditorTrace = {
    input_hash: messageHash,
    pii_redacted: pii.piiRedacted,
    redacted_types: pii.redactedTypes,
    duplicate_case_count: duplicateCount,
    rule_version: rulesResult.ruleVersion,
    threshold_version: activeThresholds.version,
    model_version: classification.modelVersion,
    matched_rules: rulesResult.matchedRules,
    rule_score: rulesResult.ruleScore,
    ai_output: classification.output,
    scam_score: routed.scam_score,
    official_score: routed.official_score,
    confidence: routed.confidence,
    registry_check: registryCheck,
    payment_check: paymentCheck,
    thresholds_applied: {
      scam_auto_threshold: activeThresholds.scam_auto_threshold,
      official_match_threshold: activeThresholds.official_match_threshold,
      ask_info_threshold: activeThresholds.ask_info_threshold,
    },
    verdict: routed.verdict,
    routing_reason: routed.routing_reason,
    evaluated_at: now,
  };

  const caseId = persistCase ? store.nextId('CASE').toUpperCase() : 'PUBLIC-CHECK';
  const decision: DecisionRecord = {
    id: store.nextId('dec'),
    case_id: caseId,
    verdict: routed.verdict,
    confidence: routed.confidence,
    user_explanation_en: routed.user_explanation_en,
    user_explanation_ur: routed.user_explanation_ur,
    safe_followup_question: routed.safe_followup_question,
    rule_version: rulesResult.ruleVersion,
    model_version: classification.modelVersion,
    auditor_trace: trace,
    decided_by: 'ai',
    decided_by_user_id: null,
    officer_notes: null,
    created_at: now,
  };

  if (!persistCase) {
    return { caseRecord: null, decision, trace };
  }

  const family = familyId
    ? store.state.families.find((f) => f.id === familyId) ?? null
    : null;

  const caseRecord: CaseRecord = {
    id: caseId,
    submitted_by: actor.id,
    submitted_by_name: actor.name,
    family_id: family ? family.id : null,
    family_name: family ? family.display_name : null,
    message_text: pii.sanitizedText,
    message_hash: messageHash,
    sender_claimed: senderClaimed.trim(),
    payment_ref: paymentRef?.trim() ? paymentRef.trim().toUpperCase() : null,
    status: routed.status,
    verdict: routed.verdict,
    confidence: routed.confidence,
    rule_version: rulesResult.ruleVersion,
    assigned_officer: routed.verdict === 'unverified_officer_review' ? 'usr-officer-1' : null,
    pii_redacted: pii.piiRedacted,
    duplicate_count: duplicateCount,
    client_request_id: clientRequestId,
    created_at: now,
    updated_at: now,
  };

  store.state.cases.unshift(caseRecord);
  store.state.decisions.unshift(decision);
  store.appendAudit({
    actor_id: actor.id,
    actor_name: actor.name,
    actor_role: actor.role,
    actor_type: 'ai',
    action: 'ai_case_evaluated',
    access_kind: 'decision',
    entity_type: 'case',
    entity_id: caseId,
    payload: {
      verdict: routed.verdict,
      confidence: routed.confidence,
      rule_version: rulesResult.ruleVersion,
      threshold_version: activeThresholds.version,
      model_version: classification.modelVersion,
      registry_matched: registryCheck.matched,
      family_id: caseRecord.family_id,
    },
  });

  return {
    caseRecord: {
      ...caseRecord,
      decisions: [decision],
      latest_decision: decision,
    },
    decision,
    trace,
  };
}

/**
 * Evaluates the N=30 synthetic prototype dataset against the currently active DB rules & thresholds.
 * Explicitly reports raw error counts (false_alarms, missed_scams, human_handoffs) without inflated claims.
 */
export function evaluateSyntheticDataset(
  activeRules: RuleRecord[],
  thresholds: ThresholdConfig,
  liveCases: CaseRecord[]
): EvalStatsResponse {
  let falseAlarms = 0;
  let missedScams = 0;
  let humanHandoffs = 0;
  let scamsCaughtAuto = 0;
  let officialVerifiedMatches = 0;

  const rows: SyntheticEvalRow[] = SYNTHETIC_DATASET.map((sample) => {
    const pii = redactPii(sample.message_text);
    const registryCheck = lookupMockSenderRegistry(sample.sender_claimed, pii.sanitizedText);
    const paymentCheck = lookupMockPayment(sample.payment_ref);
    const rulesResult = evaluateRules(pii.sanitizedText, sample.sender_claimed, activeRules);
    const cls = deterministicClassify({
      sanitizedText: pii.sanitizedText,
      senderClaimed: sample.sender_claimed,
      matchedRules: rulesResult.matchedRules,
      ruleScore: rulesResult.ruleScore,
      registryCheck,
    });
    const routed = routeVerdict({
      ruleScore: rulesResult.ruleScore,
      hasHardRedFlag: rulesResult.hasHardRedFlag,
      aiOutput: cls.output,
      registryCheck,
      paymentCheck,
      thresholds,
    });

    let outcome: SyntheticEvalRow['outcome'] = 'correct';

    if (routed.verdict === 'unverified_officer_review' || routed.verdict === 'needs_non_sensitive_info') {
      humanHandoffs += 1;
      outcome = sample.ground_truth === 'ambiguous' ? 'correct' : 'human_handoff';
    } else if (sample.ground_truth === 'scam') {
      if (routed.verdict === 'suspicious') {
        scamsCaughtAuto += 1;
        outcome = 'correct';
      } else if (routed.verdict === 'matches_mock_official_notice') {
        missedScams += 1;
        outcome = 'missed_scam';
      }
    } else if (sample.ground_truth === 'official') {
      if (routed.verdict === 'matches_mock_official_notice') {
        officialVerifiedMatches += 1;
        outcome = 'correct';
      } else if (routed.verdict === 'suspicious') {
        falseAlarms += 1;
        outcome = 'false_alarm';
      }
    } else if (sample.ground_truth === 'ambiguous') {
      if (routed.verdict === 'suspicious') {
        falseAlarms += 1;
        outcome = 'false_alarm';
      } else if (routed.verdict === 'matches_mock_official_notice') {
        missedScams += 1;
        outcome = 'missed_scam';
      }
    }

    return {
      id: sample.id,
      category: sample.category,
      sender_claimed: sample.sender_claimed || '(blank)',
      snippet: sample.message_text.slice(0, 72) + (sample.message_text.length > 72 ? '...' : ''),
      ground_truth: sample.ground_truth,
      predicted_verdict: routed.verdict,
      scam_score: routed.scam_score,
      official_score: routed.official_score,
      outcome,
    };
  });

  const liveCounts = {
    total: liveCases.length,
    suspicious: liveCases.filter((c) => c.verdict === 'suspicious').length,
    matches_mock_official_notice: liveCases.filter((c) => c.verdict === 'matches_mock_official_notice').length,
    needs_non_sensitive_info: liveCases.filter((c) => c.verdict === 'needs_non_sensitive_info').length,
    unverified_officer_review: liveCases.filter((c) => c.verdict === 'unverified_officer_review').length,
    open_officer_queue: liveCases.filter(
      (c) => c.status === 'in_review' || c.status === 'needs_info'
    ).length,
  };

  return {
    dataset_label: 'Synthetic Prototype Evaluation Set (N=30 — 12 scams, 10 mock official, 8 ambiguous)',
    sample_size: SYNTHETIC_DATASET.length,
    active_rule_version: activeRules.reduce((max, r) => Math.max(max, r.version), 1),
    active_threshold_version: thresholds.version,
    thresholds: {
      scam_auto_threshold: thresholds.scam_auto_threshold,
      official_match_threshold: thresholds.official_match_threshold,
      ask_info_threshold: thresholds.ask_info_threshold,
    },
    metrics: {
      false_alarms: falseAlarms,
      missed_scams: missedScams,
      human_handoffs: humanHandoffs,
      scams_caught_auto: scamsCaughtAuto,
      official_verified_matches: officialVerifiedMatches,
      asymmetric_cost_score: missedScams * 10 + falseAlarms * 1,
    },
    live_case_counts: liveCounts,
    rows,
  };
}
