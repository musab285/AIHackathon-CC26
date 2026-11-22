import type {
  AIDecisionOutput,
  CaseStatus,
  MockPaymentCheck,
  MockRegistryCheck,
  ThresholdConfig,
  Verdict,
} from '../../src/shared/types';
import { checkSensitiveProofRequest } from './piiGuard';

export interface RoutingInput {
  ruleScore: number;
  hasHardRedFlag: boolean;
  aiOutput: AIDecisionOutput;
  registryCheck: MockRegistryCheck;
  paymentCheck: MockPaymentCheck;
  thresholds: Pick<
    ThresholdConfig,
    'scam_auto_threshold' | 'official_match_threshold' | 'ask_info_threshold'
  >;
}

export interface RoutingResult {
  verdict: Verdict;
  status: CaseStatus;
  scam_score: number;
  official_score: number;
  confidence: number;
  user_explanation_en: string;
  user_explanation_ur: string;
  safe_followup_question: string | null;
  routing_reason: string;
}

const DEFAULT_SAFE_FOLLOWUP =
  'Without sharing any OTP, CNIC, or PIN: did you receive this from a personal mobile number, or did someone ask you to pay a registration/processing fee?';

/**
 * Asymmetric Safety Router (Missed Scam = 10x cost vs False Alarm = 1x cost)
 * Never calls a message "Safe" from score alone.
 */
export function routeVerdict(input: RoutingInput): RoutingResult {
  const { ruleScore, hasHardRedFlag, aiOutput, registryCheck, paymentCheck, thresholds } = input;

  // Combine deterministic rule score with AI classifier signal conservatively
  const aiScamComponent =
    aiOutput.predicted_label === 'scam'
      ? aiOutput.confidence
      : aiOutput.predicted_label === 'uncertain'
        ? aiOutput.confidence * 0.45
        : (1 - aiOutput.confidence) * 0.25;

  const paymentDuplicatePenalty = paymentCheck.status === 'duplicate_flagged' ? 0.35 : 0;
  const paymentNotFoundPenalty = paymentCheck.checked && paymentCheck.status === 'not_found' ? 0.15 : 0;

  // Asymmetric blend: take the stronger scam signal so high-risk rules are never diluted by an overconfident LLM
  const blendedScam = Math.min(
    1,
    Math.max(ruleScore, ruleScore * 0.65 + aiScamComponent * 0.55) +
      paymentDuplicatePenalty +
      paymentNotFoundPenalty
  );
  const scamScore = Number(blendedScam.toFixed(3));

  // Official match score requires BOTH clean signals AND verified mock registry match
  let officialScore = 0;
  if (registryCheck.matched && !hasHardRedFlag && scamScore < 0.25) {
    const aiOfficialComponent =
      aiOutput.predicted_label === 'official_like' ? aiOutput.confidence : 0.4;
    const paymentBonus =
      paymentCheck.status === 'valid_pending' || paymentCheck.status === 'disbursed_mock'
        ? 0.03
        : 0;
    officialScore = Number(Math.min(0.99, aiOfficialComponent * 0.88 + 0.15 + paymentBonus).toFixed(3));
  } else {
    // Score alone without registry match is capped below official_match_threshold
    officialScore = Number(
      Math.min(
        Math.max(0, thresholds.official_match_threshold - 0.15),
        aiOutput.predicted_label === 'official_like' ? aiOutput.confidence * 0.65 : 0.1
      ).toFixed(3)
    );
  }

  // Ensure any AI follow-up question passes our anti-phishing guardrail
  let safeFollowup = aiOutput.safe_followup_question;
  if (safeFollowup && !checkSensitiveProofRequest(safeFollowup).allowed) {
    safeFollowup = DEFAULT_SAFE_FOLLOWUP;
  }

  // 1. High-risk scam auto-warning
  if (scamScore >= thresholds.scam_auto_threshold) {
    return {
      verdict: 'suspicious',
      status: 'resolved',
      scam_score: scamScore,
      official_score: officialScore,
      confidence: scamScore,
      user_explanation_en: `${aiOutput.plain_reason_en} Do NOT send money, click links, or share OTP/CNIC/PIN.`,
      user_explanation_ur: `${aiOutput.plain_reason_ur} کوئی پیسے نہ بھیجیں اور OTP، شناختی کارڈ یا PIN ہرگز نہ بتائیں۔`,
      safe_followup_question: null,
      routing_reason: `scam_score (${scamScore}) >= scam_auto_threshold (${thresholds.scam_auto_threshold})`,
    };
  }

  // 2. Verified Mock Official Notice Match (strict dual gate: threshold + verified registry + zero red flags)
  if (
    officialScore >= thresholds.official_match_threshold &&
    registryCheck.matched &&
    !hasHardRedFlag &&
    paymentCheck.status !== 'duplicate_flagged' &&
    paymentCheck.status !== 'not_found'
  ) {
    return {
      verdict: 'matches_mock_official_notice',
      status: 'resolved',
      scam_score: scamScore,
      official_score: officialScore,
      confidence: officialScore,
      user_explanation_en: `${aiOutput.plain_reason_en} Matches mock notice ${registryCheck.notice_id} (${registryCheck.official_program}). Caveat: Forwarded sender names can still be spoofed—verify at an official desk and never pay a fee.`,
      user_explanation_ur: `${aiOutput.plain_reason_ur} یہ پیغام موک سرکاری نوٹس (${registryCheck.sender_id}) سے ملتا ہے، مگر فارورڈ پیغام میں بھیجنے والے کا نام نقلی ہو سکتا ہے۔ سرکاری دفتر سے تصدیق کریں اور کوئی فیس نہ دیں۔`,
      safe_followup_question: null,
      routing_reason: `official_score (${officialScore}) >= official_match_threshold (${thresholds.official_match_threshold}) AND mock registry verified (${registryCheck.notice_id}) with zero red flags`,
    };
  }

  // 3. Mid-confidence: ask non-sensitive clarifying question ONLY when no hard red flag and moderate ambiguity
  const midConfidence = Number(Math.max(aiOutput.confidence, scamScore).toFixed(3));
  if (
    midConfidence >= thresholds.ask_info_threshold &&
    scamScore >= 0.35 &&
    scamScore < thresholds.scam_auto_threshold &&
    !hasHardRedFlag
  ) {
    return {
      verdict: 'needs_non_sensitive_info',
      status: 'needs_info',
      scam_score: scamScore,
      official_score: officialScore,
      confidence: midConfidence,
      user_explanation_en:
        'This message has mixed signals. Please answer one safe question below (never share OTP, CNIC, or PIN), or escalate to a Department Officer.',
      user_explanation_ur:
        'اس پیغام میں کچھ غیر واضح باتیں ہیں۔ نیچے دیے گئے محفوظ سوال کا جواب دیں (OTP، شناختی کارڈ یا PIN ہرگز نہ لکھیں) یا آفیسر کو بھیجیں۔',
      safe_followup_question: safeFollowup || DEFAULT_SAFE_FOLLOWUP,
      routing_reason: `mid-confidence (${midConfidence}) >= ask_info_threshold (${thresholds.ask_info_threshold}) with moderate signals and no hard red flags`,
    };
  }

  // 4. Default Conservative Fallback: Explicitly say "I am not sure" and hand off to Department Officer
  const notSureReason = registryCheck.matched
    ? `Registry matched ${registryCheck.notice_id}, but confidence (${officialScore}) was below threshold (${thresholds.official_match_threshold}) or had conflicting signals.`
    : `No verified mock registry match and scam_score (${scamScore}) below auto-warn threshold (${thresholds.scam_auto_threshold}).`;

  return {
    verdict: 'unverified_officer_review',
    status: 'in_review',
    scam_score: scamScore,
    official_score: officialScore,
    confidence: Number(Math.min(0.59, Math.max(0.25, aiOutput.confidence)).toFixed(3)),
    user_explanation_en:
      'I am not sure about this message. Because a wrong guess could risk your savings, it has been sent to a Department Officer for human verification. Do not act on it until confirmed.',
    user_explanation_ur:
      'مجھے اس پیغام کے بارے میں یقین نہیں ہے۔ آپ کی بچت کے تحفظ کے لیے یہ کیس انسانی جانچ کے لیے ڈپارٹمنٹ آفیسر کو بھیج دیا گیا ہے۔ تصدیق تک کوئی قدم نہ اٹھائیں۔',
    safe_followup_question: null,
    routing_reason: `Human handoff triggered: ${notSureReason}`,
  };
}
